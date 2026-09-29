// 計時器：倒數、碼表、輪流計時三合一。
//
// 輪流計時（象棋鐘）是這裡最有價值的一個：點一下換下一位，每人累計時間分開算，
// 用來治「想超久那位」。它吃共用的玩家名單。
//
// 所有時間都從 Date.now() 的差值算，不是靠 interval 累加次數——分頁被切到背景時
// interval 會被瀏覽器降頻，用累加的話時間會少算。
import { escapeHtml, onViewCleanup } from '../app.js';
import { mountPlayerPanel, selectedPlayers } from './players.js';
import { alarm, ding, tick, vibrate, keepAwake, releaseAwake, fmtClock, loadJSON, saveJSON } from './kit.js';

export const id = 'timer';
export const name = '計時器';
export const icon = '⏱️';
export const desc = '倒數、碼表，還有輪流計時（換人按一下）';

const CFG_KEY = 'tools.timer';
const COUNTDOWN_PRESETS = [30, 60, 120, 180, 300, 600, 900, 1800];
const TURN_LIMIT_PRESETS = [0, 30, 60, 90, 120];

let cfg;
let run;          // 執行狀態
let ticker = null;

function loadCfg() {
  const s = loadJSON(CFG_KEY, {});
  return {
    mode: ['countdown', 'stopwatch', 'turns'].includes(s.mode) ? s.mode : 'countdown',
    targetSec: Number(s.targetSec) > 0 ? Number(s.targetSec) : 180,
    turnLimitSec: Number(s.turnLimitSec) >= 0 ? Number(s.turnLimitSec) : 0,
  };
}
function saveCfg() { saveJSON(CFG_KEY, cfg); }

function freshRun() {
  return {
    running: false,
    startedAt: 0,      // 這一段開始跑的時間戳
    accumMs: 0,        // 之前暫停累積的時間
    alarmed: false,    // 倒數歸零的提示音只響一次
    laps: [],
    turnIndex: 0,
    totals: {},        // playerId -> 累計毫秒
    turnAlarmed: false,
  };
}

// 目前這一段（倒數／碼表：已過時間；輪流：這一手已過時間）
function elapsed() {
  return run.accumMs + (run.running ? Date.now() - run.startedAt : 0);
}

export function render(el) {
  cfg = loadCfg();
  run = freshRun();

  el.innerHTML = `
    <div class="seg-control" data-mode>
      <button data-m="countdown">倒數</button>
      <button data-m="stopwatch">碼表</button>
      <button data-m="turns">輪流計時</button>
    </div>

    <div data-players hidden></div>

    <div class="card timer-face">
      <div class="timer-who" data-who hidden></div>
      <div class="timer-display" data-display>0:00</div>
      <div class="card-meta timer-sub" data-sub></div>
    </div>

    <div class="tool-btn-row">
      <button class="btn btn-primary tool-action" data-primary>開始</button>
      <button class="btn" data-secondary>重設</button>
    </div>

    <div class="card" data-config></div>
    <div data-extra></div>
  `;

  const displayEl = el.querySelector('[data-display]');
  const subEl = el.querySelector('[data-sub]');
  const whoEl = el.querySelector('[data-who]');
  const primaryBtn = el.querySelector('[data-primary]');
  const secondaryBtn = el.querySelector('[data-secondary]');
  const configEl = el.querySelector('[data-config]');
  const extraEl = el.querySelector('[data-extra]');
  const playersEl = el.querySelector('[data-players]');

  mountPlayerPanel(playersEl, () => {
    // 名單改了就重來一輪，不然累計時間會對到已經移除的人
    if (cfg.mode === 'turns') { resetRun(); drawAll(); }
  });

  function players() { return selectedPlayers(); }

  function currentPlayer() {
    const list = players();
    if (list.length === 0) return null;
    return list[run.turnIndex % list.length];
  }

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(drawFace, 100);
  }

  function resetRun() {
    stopTicker();
    releaseAwake();
    run = freshRun();
  }

  // ---- 畫面 ----

  function drawFace() {
    const ms = elapsed();

    if (cfg.mode === 'countdown') {
      const remain = cfg.targetSec * 1000 - ms;
      displayEl.textContent = fmtClock(Math.max(remain, 0));
      displayEl.classList.toggle('over', remain <= 0);
      displayEl.classList.toggle('warn', remain > 0 && remain <= 10000);
      subEl.textContent = remain <= 0 ? '時間到' : `共 ${fmtClock(cfg.targetSec * 1000)}`;
      if (remain <= 0 && !run.alarmed) {
        run.alarmed = true;
        alarm();
        vibrate([200, 100, 200, 100, 400]);
        pause();
      }
      return;
    }

    if (cfg.mode === 'stopwatch') {
      displayEl.textContent = fmtClock(ms, { showTenths: true });
      displayEl.classList.remove('over', 'warn');
      subEl.textContent = run.laps.length ? `已計 ${run.laps.length} 次` : '';
      return;
    }

    const p = currentPlayer();
    whoEl.hidden = !p;
    whoEl.textContent = p ? `輪到 ${p.name}` : '';
    displayEl.textContent = fmtClock(ms);
    const limit = cfg.turnLimitSec * 1000;
    const over = limit > 0 && ms >= limit;
    displayEl.classList.toggle('over', over);
    displayEl.classList.toggle('warn', limit > 0 && !over && limit - ms <= 10000);
    if (over && !run.turnAlarmed) {
      run.turnAlarmed = true;
      ding();
      vibrate([150, 80, 150]);
    }
    subEl.textContent = limit > 0
      ? (over ? `超過每手上限 ${fmtClock(limit)}` : `每手上限 ${fmtClock(limit)}`)
      : '這一手已用時間';
    drawTotals();
  }

  // 這個清單每 100ms 就要更新一次。整塊重畫會閃、也會讓 relayout 一直跑，
  // 所以只有「人換了」或「輪到別人了」才重建 DOM，平常只改時間那幾個字。
  let totalsKey = '';
  let totalCells = [];   // 跟 players() 同順序的 <strong>，每次 tick 只改這幾個字

  function drawTotals() {
    const list = players();
    if (list.length === 0) {
      totalsKey = '';
      totalCells = [];
      extraEl.innerHTML = '<p class="card-meta">先在上面挑出這局的玩家（沒有帳號的人可以加成訪客）。</p>';
      return;
    }
    const cur = currentPlayer();
    const key = `${list.map((p) => p.id).join(',')}|${cur ? cur.id : ''}`;
    if (key !== totalsKey) {
      totalsKey = key;
      extraEl.innerHTML = `
        <div class="section-title">各人累計</div>
        <ul class="tool-log">
          ${list.map((p) => `
            <li class="${cur && p.id === cur.id ? 'on' : ''}" data-total-for="${escapeHtml(p.id)}">
              <span>${escapeHtml(p.name)}</span><strong>0:00</strong>
            </li>
          `).join('')}
        </ul>
      `;
      totalCells = [...extraEl.querySelectorAll('[data-total-for] strong')];
    }
    const nowMs = elapsed();
    list.forEach((p, i) => {
      const cell = totalCells[i];
      if (!cell) return;
      const base = run.totals[p.id] || 0;
      cell.textContent = fmtClock(cur && p.id === cur.id ? base + nowMs : base);
    });
  }

  function drawControls() {
    if (cfg.mode === 'turns') {
      primaryBtn.textContent = run.running ? '換下一位' : '開始';
      secondaryBtn.textContent = run.running ? '暫停' : '重設';
    } else {
      const finished = cfg.mode === 'countdown' && !run.running && run.accumMs >= cfg.targetSec * 1000;
      primaryBtn.textContent = run.running ? '暫停'
        : finished ? '重新開始'
        : (run.accumMs > 0 ? '繼續' : '開始');
      secondaryBtn.textContent = cfg.mode === 'stopwatch' && run.running ? '計次' : '重設';
    }
    primaryBtn.disabled = cfg.mode === 'turns' && players().length === 0;
  }

  function drawConfig() {
    if (cfg.mode === 'countdown') {
      const mm = Math.floor(cfg.targetSec / 60);
      const ss = cfg.targetSec % 60;
      configEl.hidden = false;
      configEl.innerHTML = `
        <div class="form-label">倒數長度</div>
        <div class="chip-row">
          ${COUNTDOWN_PRESETS.map((s) => `<button class="chip-btn${s === cfg.targetSec ? ' on' : ''}" data-preset="${s}">${s < 60 ? `${s} 秒` : `${s / 60} 分`}</button>`).join('')}
        </div>
        <div class="stepper-row">
          <label class="stepper-label" for="timer-mm">自訂</label>
          <input class="form-control stepper-input" id="timer-mm" type="number" min="0" max="180" inputmode="numeric" value="${mm}" data-mm> 分
          <input class="form-control stepper-input" type="number" min="0" max="59" inputmode="numeric" value="${ss}" data-ss aria-label="秒"> 秒
        </div>
      `;
      return;
    }
    if (cfg.mode === 'turns') {
      configEl.hidden = false;
      configEl.innerHTML = `
        <div class="form-label">每手時間上限</div>
        <div class="chip-row">
          ${TURN_LIMIT_PRESETS.map((s) => `<button class="chip-btn${s === cfg.turnLimitSec ? ' on' : ''}" data-limit="${s}">${s === 0 ? '不限' : `${s} 秒`}</button>`).join('')}
        </div>
        <p class="card-meta" style="margin:8px 0 0">超過上限只會提醒一聲，不會強制結束這一手。</p>
      `;
      return;
    }
    configEl.hidden = true;
    configEl.innerHTML = '';
  }

  function drawExtra() {
    if (cfg.mode === 'stopwatch') {
      extraEl.innerHTML = run.laps.length
        ? `<div class="section-title">計次</div><ul class="tool-log">${run.laps.map((l, i) => `<li><span>第 ${run.laps.length - i} 次</span><strong>${fmtClock(l, { showTenths: true })}</strong></li>`).join('')}</ul>`
        : '';
      return;
    }
    if (cfg.mode === 'turns') { drawTotals(); return; }
    extraEl.innerHTML = '';
  }

  function drawAll() {
    el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === cfg.mode));
    playersEl.hidden = cfg.mode !== 'turns';
    whoEl.hidden = cfg.mode !== 'turns';
    drawConfig();
    drawControls();
    drawExtra();
    drawFace();
  }

  // ---- 操作 ----

  function start() {
    run.running = true;
    run.startedAt = Date.now();
    keepAwake();
    startTicker();
    drawControls();
  }

  function pause() {
    if (!run.running) return;
    run.accumMs = elapsed();
    run.running = false;
    run.startedAt = 0;
    stopTicker();
    releaseAwake();
    drawControls();
  }

  function nextTurn() {
    const list = players();
    if (list.length === 0) return;
    const p = currentPlayer();
    run.totals[p.id] = (run.totals[p.id] || 0) + elapsed();
    run.turnIndex = (run.turnIndex + 1) % list.length;
    run.accumMs = 0;
    run.startedAt = Date.now();
    run.turnAlarmed = false;
    tick();
    vibrate(20);
    drawFace();
  }

  primaryBtn.addEventListener('click', () => {
    if (cfg.mode === 'turns') {
      if (!run.running) { start(); drawFace(); }
      else nextTurn();
      return;
    }
    if (run.running) { pause(); drawFace(); return; }
    // 倒數已經歸零了，再按「開始」就是重跑一輪
    if (cfg.mode === 'countdown' && elapsed() >= cfg.targetSec * 1000) {
      run.accumMs = 0;
      run.alarmed = false;
    }
    start();
    drawFace();
  });

  secondaryBtn.addEventListener('click', () => {
    if (cfg.mode === 'turns' && run.running) { pause(); drawFace(); return; }
    if (cfg.mode === 'stopwatch' && run.running) {
      run.laps.unshift(elapsed());
      run.laps = run.laps.slice(0, 20);
      tick();
      drawExtra();
      return;
    }
    resetRun();
    drawAll();
  });

  el.querySelector('[data-mode]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || b.dataset.m === cfg.mode) return;
    resetRun();
    cfg.mode = b.dataset.m;
    saveCfg();
    drawAll();
  });

  configEl.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      cfg.targetSec = Number(preset.dataset.preset);
      saveCfg(); resetRun(); drawAll();
      return;
    }
    const limit = e.target.closest('[data-limit]');
    if (limit) {
      cfg.turnLimitSec = Number(limit.dataset.limit);
      saveCfg();
      run.turnAlarmed = false;
      drawConfig();
      drawFace();
    }
  });

  configEl.addEventListener('change', (e) => {
    if (!e.target.matches('[data-mm], [data-ss]')) return;
    const mm = Number(configEl.querySelector('[data-mm]').value) || 0;
    const ss = Number(configEl.querySelector('[data-ss]').value) || 0;
    cfg.targetSec = Math.min(Math.max(mm * 60 + ss, 1), 180 * 60);
    saveCfg(); resetRun(); drawAll();
  });

  drawAll();

  onViewCleanup(() => { stopTicker(); releaseAwake(); });
}
