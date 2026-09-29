// 抽起始玩家：抽一個人，或直接排出完整的先後順位。
//
// 抽完會一併列出從那人開始的順時針順序——現場真正想知道的其實是「我後面是誰」，
// 不是只有第一個人是誰。
import { escapeHtml, onViewCleanup } from '../app.js';
import { mountPlayerPanel, selectedPlayers } from './players.js';
import { shuffle, tick, ding, vibrate, loadJSON, saveJSON } from './kit.js';

export const id = 'starter';
export const name = '抽起始玩家';
export const icon = '🎯';
export const desc = '隨機決定誰先手，或排出完整順位';

const CFG_KEY = 'tools.starter';

let mode;
let spinTimer = null;

export function render(el) {
  mode = loadJSON(CFG_KEY, {}).mode === 'order' ? 'order' : 'one';

  el.innerHTML = `
    <div data-players></div>

    <div class="seg-control" data-mode>
      <button data-m="one">抽一個人</button>
      <button data-m="order">排完整順位</button>
    </div>

    <button class="btn btn-primary btn-block tool-action" data-draw>開始抽</button>

    <div data-result></div>
  `;

  const resultEl = el.querySelector('[data-result]');
  const drawBtn = el.querySelector('[data-draw]');

  mountPlayerPanel(el.querySelector('[data-players]'), () => {
    stopSpin();
    resultEl.innerHTML = '';
    syncMode();
  });

  function syncMode() {
    el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    const n = selectedPlayers().length;
    drawBtn.disabled = n < 2;
    drawBtn.textContent = n < 2 ? '至少要選 2 個人' : '開始抽';
  }

  function stopSpin() {
    if (spinTimer) { clearTimeout(spinTimer); spinTimer = null; }
  }

  // 從 winner 開始，照名單順序繞一圈，這就是實際坐著的順時針順序。
  function clockwiseFrom(list, winnerId) {
    const start = list.findIndex((p) => p.id === winnerId);
    return [...list.slice(start), ...list.slice(0, start)];
  }

  function renderSpinning(list, highlightId) {
    resultEl.innerHTML = `
      <div class="card draw-stage">
        <div class="draw-names">
          ${list.map((p) => `<span class="draw-name${p.id === highlightId ? ' on' : ''}">${escapeHtml(p.name)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  function renderWinner(list, winner) {
    const order = clockwiseFrom(list, winner.id);
    resultEl.innerHTML = `
      <div class="card draw-stage settled">
        <div class="card-meta">起始玩家</div>
        <div class="draw-winner">${escapeHtml(winner.name)}</div>
      </div>
      <div class="section-title">接下來的順序（順時針）</div>
      <ol class="tool-order">
        ${order.map((p, i) => `<li class="${i === 0 ? 'on' : ''}"><span class="order-no">${i + 1}</span><span>${escapeHtml(p.name)}</span></li>`).join('')}
      </ol>
    `;
  }

  function renderOrder(order) {
    resultEl.innerHTML = `
      <div class="card draw-stage settled">
        <div class="card-meta">先手</div>
        <div class="draw-winner">${escapeHtml(order[0].name)}</div>
      </div>
      <div class="section-title">完整順位</div>
      <ol class="tool-order">
        ${order.map((p, i) => `<li class="${i === 0 ? 'on' : ''}"><span class="order-no">${i + 1}</span><span>${escapeHtml(p.name)}</span></li>`).join('')}
      </ol>
    `;
  }

  function draw() {
    stopSpin();
    const list = selectedPlayers();
    if (list.length < 2) return;

    const finalOrder = shuffle(list);
    const winner = finalOrder[0];

    // 名字快速輪播，間隔愈拉愈長，最後停在中獎的人身上——
    // 等速跑到一半直接定格會沒有「慢慢停下來」的感覺。
    let i = 0;
    let delay = 60;
    const step = () => {
      renderSpinning(list, list[i % list.length].id);
      tick();
      i += 1;
      delay *= 1.12;
      if (delay < 260) {
        spinTimer = setTimeout(step, delay);
        return;
      }
      spinTimer = null;
      ding();
      vibrate([30, 60, 120]);
      if (mode === 'one') renderWinner(list, winner);
      else renderOrder(finalOrder);
    };
    step();
  }

  el.querySelector('[data-mode]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || b.dataset.m === mode) return;
    mode = b.dataset.m;
    saveJSON(CFG_KEY, { mode });
    stopSpin();
    resultEl.innerHTML = '';
    syncMode();
  });

  drawBtn.addEventListener('click', draw);

  syncMode();
  onViewCleanup(stopSpin);
}
