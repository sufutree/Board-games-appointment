// 排賽程：循環賽（每個人都要對上每個人）與單淘汰賽表。
import { escapeHtml } from '../app.js';
import { mountPlayerPanel, selectedPlayers } from './players.js';
import { shuffle, ding, loadJSON, saveJSON } from './kit.js';

export const id = 'bracket';
export const name = '排賽程';
export const icon = '🏆';
export const desc = '循環賽對戰表、單淘汰賽晉級表';

const CFG_KEY = 'tools.bracket';
const BYE = { id: '__bye__', name: '輪空' };

let mode;

// 循環賽用經典的「轉圈法」：固定第一個人，其餘每輪順時針轉一格。
// 人數是奇數就補一個「輪空」，該輪對到輪空的人就是這輪休息。
function roundRobin(players) {
  const list = players.length % 2 === 0 ? [...players] : [...players, BYE];
  const n = list.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r += 1) {
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) {
      pairs.push([list[i], list[n - 1 - i]]);
    }
    rounds.push(pairs);
    // 第一個位置不動，其他人整體旋轉
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// 單淘汰：補輪空補到 2 的次方，第一輪是實際配對，之後幾輪先留成「勝者對勝者」。
function singleElimination(players) {
  let size = 1;
  while (size < players.length) size *= 2;
  const seeded = [...players];
  while (seeded.length < size) seeded.push(BYE);

  const first = [];
  for (let i = 0; i < size; i += 2) first.push([seeded[i], seeded[i + 1]]);

  const rounds = [first];
  let remaining = first.length;
  while (remaining > 1) {
    remaining = Math.floor(remaining / 2);
    rounds.push(Array.from({ length: remaining }, () => null));
  }
  return rounds;
}

function roundTitle(mode_, index, total) {
  if (mode_ === 'rr') return `第 ${index + 1} 輪`;
  const left = total - index;
  if (left === 1) return '決賽';
  if (left === 2) return '四強';
  if (left === 3) return '八強';
  return `第 ${index + 1} 輪`;
}

function pairHtml(pair) {
  if (!pair) {
    return `<li class="match pending"><span class="vs-side">勝者</span><span class="vs">vs</span><span class="vs-side">勝者</span></li>`;
  }
  const [a, b] = pair;
  if (a.id === BYE.id || b.id === BYE.id) {
    const real = a.id === BYE.id ? b : a;
    return `<li class="match bye"><span class="vs-side">${escapeHtml(real.name)}</span><span class="vs">輪空</span></li>`;
  }
  return `<li class="match"><span class="vs-side">${escapeHtml(a.name)}</span><span class="vs">vs</span><span class="vs-side">${escapeHtml(b.name)}</span></li>`;
}

export function render(el) {
  mode = loadJSON(CFG_KEY, {}).mode === 'ko' ? 'ko' : 'rr';

  el.innerHTML = `
    <div data-players></div>

    <div class="seg-control" data-mode>
      <button data-m="rr">循環賽</button>
      <button data-m="ko">單淘汰</button>
    </div>

    <p class="card-meta" data-plan style="text-align:center"></p>

    <button class="btn btn-primary btn-block tool-action" data-go>排賽程</button>

    <div data-result></div>
  `;

  const planEl = el.querySelector('[data-plan]');
  const goBtn = el.querySelector('[data-go]');
  const resultEl = el.querySelector('[data-result]');

  mountPlayerPanel(el.querySelector('[data-players]'), () => {
    resultEl.innerHTML = '';
    sync();
  });

  function sync() {
    el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    const n = selectedPlayers().length;
    goBtn.disabled = n < 3;
    if (n < 3) {
      planEl.textContent = '至少要選 3 個人';
      return;
    }
    if (mode === 'rr') {
      const rounds = n % 2 === 0 ? n - 1 : n;
      const matches = (n * (n - 1)) / 2;
      planEl.textContent = `${n} 人 → 共 ${rounds} 輪、${matches} 場${n % 2 ? '（每輪有一人輪空）' : ''}`;
    } else {
      let size = 1;
      while (size < n) size *= 2;
      planEl.textContent = `${n} 人 → ${Math.log2(size)} 輪淘汰${size > n ? `（${size - n} 人第一輪輪空）` : ''}`;
    }
  }

  function go() {
    const list = selectedPlayers();
    if (list.length < 3) return;
    // 每次都先洗牌，不然賽程順序會永遠跟名單順序綁在一起
    const pool = shuffle(list);
    const rounds = mode === 'rr' ? roundRobin(pool) : singleElimination(pool);
    ding();

    resultEl.innerHTML = `
      ${rounds.map((pairs, i) => `
        <div class="section-title">${escapeHtml(roundTitle(mode, i, rounds.length))}</div>
        <ul class="match-list">${pairs.map(pairHtml).join('')}</ul>
      `).join('')}
      <button class="btn btn-block" data-go>重排一次</button>
    `;
  }

  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) {
      if (m.dataset.m === mode) return;
      mode = m.dataset.m;
      saveJSON(CFG_KEY, { mode });
      resultEl.innerHTML = '';
      sync();
      return;
    }
    if (e.target.closest('[data-go]')) go();
  });

  sync();
}
