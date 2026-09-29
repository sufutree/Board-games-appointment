// 桌邊小工具共用的玩家名單。
//
// 來源有兩個：站上的正式成員（store.members，來自 Firestore）跟現場才加的訪客
// （只存在這台裝置的 localStorage，不會寫回資料庫——現場路過一起玩一場的人
// 不該變成站上的帳號）。勾選狀態也記在本機，換一個工具不用重勾一次。
//
// bootstrap 失敗（現場沒網路）時 activeMembers() 會是空陣列，這時只剩訪客可用，
// 工具本身照常運作。

import { activeMembers } from '../store.js';
import { escapeHtml } from '../app.js';
import { loadJSON, saveJSON } from './kit.js';

const GUESTS_KEY = 'tools.guests';
const SELECTED_KEY = 'tools.selectedPlayers';

function guests() {
  const list = loadJSON(GUESTS_KEY, []);
  return Array.isArray(list) ? list.filter((g) => g && g.id && g.name) : [];
}

function setGuests(list) { saveJSON(GUESTS_KEY, list); }

function selectedIds() {
  const list = loadJSON(SELECTED_KEY, []);
  return new Set(Array.isArray(list) ? list : []);
}

function setSelectedIds(set) { saveJSON(SELECTED_KEY, [...set]); }

// 成員在前、訪客在後，兩邊都照原本的順序，這樣每次重畫位置不會跳。
export function roster() {
  const members = activeMembers().map((m) => ({ id: m.id, name: m.name, guest: false }));
  const gs = guests().map((g) => ({ id: g.id, name: g.name, guest: true }));
  return [...members, ...gs];
}

// 目前勾選的玩家，照 roster 順序。工具都用這個當輸入。
export function selectedPlayers() {
  const sel = selectedIds();
  return roster().filter((p) => sel.has(p.id));
}

export function addGuest(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const list = guests();
  // 同名訪客擋掉，不然抽起始玩家抽出「小明」會不知道是哪個小明
  if (list.some((g) => g.name === trimmed)) return null;
  if (roster().some((p) => p.name === trimmed)) return null;
  const guest = { id: `g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: trimmed };
  setGuests([...list, guest]);
  // 新增的訪客預設就是要玩的人，直接勾起來
  const sel = selectedIds();
  sel.add(guest.id);
  setSelectedIds(sel);
  return guest;
}

export function removeGuest(id) {
  setGuests(guests().filter((g) => g.id !== id));
  const sel = selectedIds();
  sel.delete(id);
  setSelectedIds(sel);
}

function toggle(id) {
  const sel = selectedIds();
  if (sel.has(id)) sel.delete(id); else sel.add(id);
  setSelectedIds(sel);
}

function selectAll(on) {
  setSelectedIds(on ? new Set(roster().map((p) => p.id)) : new Set());
}

function panelInnerHtml() {
  const list = roster();
  const sel = selectedIds();
  const count = list.filter((p) => sel.has(p.id)).length;

  const chips = list.map((p) => `
    <span class="player-chip${sel.has(p.id) ? ' on' : ''}" data-toggle="${escapeHtml(p.id)}" role="button" tabindex="0" aria-pressed="${sel.has(p.id)}">
      ${escapeHtml(p.name)}${p.guest ? `<button class="chip-del" data-del="${escapeHtml(p.id)}" title="刪除訪客 ${escapeHtml(p.name)}" aria-label="刪除訪客 ${escapeHtml(p.name)}">×</button>` : ''}
    </span>
  `).join('');

  const empty = list.length === 0
    ? '<p class="card-meta">還沒有可選的玩家。成員名單需要連上網路才會載入，現在可以先用下面的欄位新增訪客。</p>'
    : '';

  return `
    <div class="tool-players-head">
      <strong>參加的人（已選 ${count} 人）</strong>
      <span class="tool-players-actions">
        <button class="btn btn-sm btn-ghost" data-all="1">全選</button>
        <button class="btn btn-sm btn-ghost" data-all="0">全不選</button>
      </span>
    </div>
    ${empty}
    <div class="player-chips">${chips}</div>
    <form class="guest-add" data-guest-form>
      <input class="form-control" data-guest-input placeholder="新增訪客姓名" autocomplete="off" maxlength="20">
      <button class="btn btn-sm" type="submit">加入</button>
    </form>
  `;
}

// 把玩家選擇面板掛到 el 上。選擇有變動就呼叫 onChange，讓工具重算結果。
// 回傳 refresh()，工具在自己重畫時可以同步更新面板上的人數。
export function mountPlayerPanel(el, onChange = () => {}) {
  el.className = 'card tool-players';
  const draw = () => { el.innerHTML = panelInnerHtml(); };
  draw();

  const changed = () => { draw(); onChange(); };

  el.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      removeGuest(del.dataset.del);
      changed();
      return;
    }
    const all = e.target.closest('[data-all]');
    if (all) {
      selectAll(all.dataset.all === '1');
      changed();
      return;
    }
    const chip = e.target.closest('[data-toggle]');
    if (chip) {
      toggle(chip.dataset.toggle);
      changed();
    }
  });

  // chip 是 span，鍵盤操作要自己接
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const chip = e.target.closest('[data-toggle]');
    if (!chip) return;
    e.preventDefault();
    toggle(chip.dataset.toggle);
    changed();
  });

  el.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-guest-form]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('[data-guest-input]');
    const added = addGuest(input.value);
    input.value = '';
    if (added) changed();
    // 現場常常要一次補好幾個訪客，重畫之後把焦點放回輸入格，可以連著打
    const next = el.querySelector('[data-guest-input]');
    if (next) next.focus();
  });

  return draw;
}
