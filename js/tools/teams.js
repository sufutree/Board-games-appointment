// 分組器：把選到的人隨機拆成幾桌／幾隊。
//
// 人數除不盡時把餘數平均灑到前面幾組（8 人分 3 組 → 3/3/2），不是讓最後一組
// 特別少。現場拆桌最常遇到的就是除不盡。
import { escapeHtml } from '../app.js';
import { mountPlayerPanel, selectedPlayers } from './players.js';
import { shuffle, ding, vibrate, loadJSON, saveJSON } from './kit.js';

export const id = 'teams';
export const name = '分組';
export const icon = '👥';
export const desc = '隨機拆桌、分隊，除不盡也分得平均';

const CFG_KEY = 'tools.teams';
const LABELS = ['第一桌', '第二桌', '第三桌', '第四桌', '第五桌', '第六桌', '第七桌', '第八桌'];

let cfg;

function loadCfg() {
  const s = loadJSON(CFG_KEY, {});
  return {
    by: s.by === 'size' ? 'size' : 'groups',
    groups: Math.min(Math.max(Number(s.groups) || 2, 2), 8),
    size: Math.min(Math.max(Number(s.size) || 4, 2), 12),
  };
}

// 回傳每組的人數，總和一定等於 total。
function groupSizes(total, groupCount) {
  const base = Math.floor(total / groupCount);
  const extra = total % groupCount;
  return Array.from({ length: groupCount }, (_, i) => base + (i < extra ? 1 : 0));
}

export function render(el) {
  cfg = loadCfg();

  el.innerHTML = `
    <div data-players></div>

    <div class="card">
      <div class="seg-control" data-by>
        <button data-b="groups">分成幾組</button>
        <button data-b="size">每組幾人</button>
      </div>
      <div class="stepper" data-stepper>
        <button class="btn stepper-btn" data-delta="-1" aria-label="減少">−</button>
        <output class="stepper-value" data-out></output>
        <button class="btn stepper-btn" data-delta="1" aria-label="增加">＋</button>
      </div>
      <p class="card-meta" data-plan style="text-align:center;margin:8px 0 0"></p>
    </div>

    <button class="btn btn-primary btn-block tool-action" data-go>隨機分組</button>

    <div data-result></div>
  `;

  const outEl = el.querySelector('[data-out]');
  const planEl = el.querySelector('[data-plan]');
  const goBtn = el.querySelector('[data-go]');
  const resultEl = el.querySelector('[data-result]');

  mountPlayerPanel(el.querySelector('[data-players]'), () => {
    resultEl.innerHTML = '';
    sync();
  });

  // 依目前設定算出實際會分成幾組（每組幾人模式要反推組數）。
  function plannedGroupCount(total) {
    if (cfg.by === 'groups') return Math.min(cfg.groups, total);
    return Math.max(1, Math.ceil(total / cfg.size));
  }

  function sync() {
    el.querySelectorAll('[data-b]').forEach((b) => b.classList.toggle('on', b.dataset.b === cfg.by));
    outEl.textContent = cfg.by === 'groups' ? `${cfg.groups} 組` : `每組 ${cfg.size} 人`;

    const total = selectedPlayers().length;
    goBtn.disabled = total < 2;
    if (total < 2) {
      planEl.textContent = '至少要選 2 個人';
      return;
    }
    const n = plannedGroupCount(total);
    planEl.textContent = `${total} 人 → ${groupSizes(total, n).join(' / ')} 人`;
  }

  function go() {
    const list = selectedPlayers();
    if (list.length < 2) return;
    const n = plannedGroupCount(list.length);
    const pool = shuffle(list);
    const sizes = groupSizes(list.length, n);

    const groups = [];
    let cursor = 0;
    for (const size of sizes) {
      groups.push(pool.slice(cursor, cursor + size));
      cursor += size;
    }

    ding();
    vibrate([25, 50, 25]);

    resultEl.innerHTML = `
      <div class="group-grid">
        ${groups.map((g, i) => `
          <div class="card group-card">
            <div class="group-card-title">${escapeHtml(LABELS[i] || `第 ${i + 1} 組`)}<span class="card-meta">${g.length} 人</span></div>
            <ul class="group-members">
              ${g.map((p) => `<li>${escapeHtml(p.name)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-block" data-go>重抽一次</button>
    `;
  }

  el.addEventListener('click', (e) => {
    const by = e.target.closest('[data-b]');
    if (by) {
      cfg.by = by.dataset.b;
      saveJSON(CFG_KEY, cfg);
      resultEl.innerHTML = '';
      sync();
      return;
    }
    const step = e.target.closest('[data-delta]');
    if (step) {
      const d = Number(step.dataset.delta);
      if (cfg.by === 'groups') cfg.groups = Math.min(Math.max(cfg.groups + d, 2), 8);
      else cfg.size = Math.min(Math.max(cfg.size + d, 2), 12);
      saveJSON(CFG_KEY, cfg);
      sync();
      return;
    }
    // 底下「重抽一次」也是 data-go，一起接
    if (e.target.closest('[data-go]')) go();
  });

  sync();
}
