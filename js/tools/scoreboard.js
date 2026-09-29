// 計分板：多輪多人計分，自動加總與排名。
//
// 分數用 playerId 當 key 存，所以中途加人／退出都不會弄亂既有的分數；
// 取消勾選只是把那一欄藏起來，重新勾回來分數還在。
import { escapeHtml, onViewCleanup } from '../app.js';
import { mountPlayerPanel, selectedPlayers } from './players.js';
import { keepAwake, releaseAwake, tick, loadJSON, saveJSON } from './kit.js';

export const id = 'scoreboard';
export const name = '計分板';
export const icon = '📊';
export const desc = '多輪計分，自動加總排名';

const KEY = 'tools.scoreboard';

let rows;   // [{ playerId: number }]

function load() {
  const saved = loadJSON(KEY, null);
  if (Array.isArray(saved) && saved.length) return saved;
  return [{}];
}
function save() { saveJSON(KEY, rows); }

export function render(el) {
  rows = load();

  el.innerHTML = `
    <div data-players></div>
    <div data-board></div>
  `;

  const boardEl = el.querySelector('[data-board]');

  mountPlayerPanel(el.querySelector('[data-players]'), drawBoard);

  function totals(list) {
    const map = {};
    list.forEach((p) => {
      map[p.id] = rows.reduce((sum, row) => sum + (Number(row[p.id]) || 0), 0);
    });
    return map;
  }

  function drawBoard() {
    const list = selectedPlayers();
    if (list.length === 0) {
      boardEl.innerHTML = '<p class="card-meta">先在上面挑出這局的玩家（沒有帳號的人可以加成訪客）。</p>';
      return;
    }

    const sums = totals(list);
    const best = Math.max(...list.map((p) => sums[p.id]));
    // 同分並列同名次，名次用「比我高分的人數 + 1」算
    const rank = (v) => list.filter((p) => sums[p.id] > v).length + 1;

    boardEl.innerHTML = `
      <div class="vote-table-wrap">
        <table class="vote-table score-table">
          <thead>
            <tr>
              <th>回合</th>
              ${list.map((p) => `<th>${escapeHtml(p.name)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, r) => `
              <tr>
                <td>${r + 1}</td>
                ${list.map((p) => `
                  <td><input class="score-input" type="number" inputmode="numeric"
                    data-r="${r}" data-p="${escapeHtml(p.id)}"
                    value="${row[p.id] == null ? '' : escapeHtml(String(row[p.id]))}"
                    aria-label="第 ${r + 1} 回合 ${escapeHtml(p.name)} 的分數"></td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr class="vote-count-row">
              <td>總分</td>
              ${list.map((p) => `<td class="${sums[p.id] === best && best !== 0 ? 'score-best' : ''}">${sums[p.id]}</td>`).join('')}
            </tr>
            <tr class="vote-count-row">
              <td>名次</td>
              ${list.map((p) => `<td>${rank(sums[p.id])}</td>`).join('')}
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="tool-btn-row">
        <button class="btn btn-primary" data-add>新增一回合</button>
        <button class="btn" data-del ${rows.length <= 1 ? 'disabled' : ''}>刪掉最後一回合</button>
      </div>
      <div class="tool-footer-actions">
        <button class="btn btn-danger btn-sm" data-clear>清空計分板</button>
      </div>
    `;
  }

  // 只重畫總分與名次那兩列，不動 input，不然打字打到一半游標會被重畫踢掉。
  function refreshTotals() {
    const list = selectedPlayers();
    const sums = totals(list);
    const best = Math.max(...list.map((p) => sums[p.id]));
    const footRows = boardEl.querySelectorAll('tfoot tr');
    if (footRows.length < 2) return;
    const cells = (tr) => [...tr.children].slice(1);
    cells(footRows[0]).forEach((td, i) => {
      const v = sums[list[i].id];
      td.textContent = String(v);
      td.classList.toggle('score-best', v === best && best !== 0);
    });
    cells(footRows[1]).forEach((td, i) => {
      const v = sums[list[i].id];
      td.textContent = String(list.filter((p) => sums[p.id] > v).length + 1);
    });
  }

  boardEl.addEventListener('input', (e) => {
    const input = e.target.closest('.score-input');
    if (!input) return;
    const r = Number(input.dataset.r);
    const p = input.dataset.p;
    if (input.value === '') delete rows[r][p];
    else rows[r][p] = Number(input.value);
    save();
    refreshTotals();
  });

  boardEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) {
      rows.push({});
      save(); tick(); drawBoard();
      return;
    }
    if (e.target.closest('[data-del]')) {
      if (rows.length <= 1) return;
      rows.pop();
      save(); drawBoard();
      return;
    }
    if (e.target.closest('[data-clear]')) {
      if (!confirm('確定要清空整個計分板嗎？')) return;
      rows = [{}];
      save(); drawBoard();
    }
  });

  drawBoard();
  keepAwake();
  onViewCleanup(releaseAwake);
}
