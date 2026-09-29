// 骰子：多顆、任意面數、加減修正值，附最近的擲骰紀錄。
import { escapeHtml, onViewCleanup } from '../app.js';
import { diceSound, vibrate, loadJSON, saveJSON } from './kit.js';

export const id = 'dice';
export const name = '骰子';
export const icon = '🎲';
export const desc = 'D4 到 D100，多顆一起擲，可加修正值';

const CFG_KEY = 'tools.dice';
const PRESETS = [4, 6, 8, 10, 12, 20, 100];

let cfg;
let history = [];
let rolling = null;   // 擲骰動畫的 interval id

function loadCfg() {
  const saved = loadJSON(CFG_KEY, {});
  return {
    sides: Number(saved.sides) > 1 ? Number(saved.sides) : 6,
    count: Math.min(Math.max(Number(saved.count) || 1, 1), 12),
    modifier: Number(saved.modifier) || 0,
  };
}

function saveCfg() { saveJSON(CFG_KEY, cfg); }

function rollOnce() {
  return Array.from({ length: cfg.count }, () => 1 + Math.floor(Math.random() * cfg.sides));
}

function notation() {
  const mod = cfg.modifier === 0 ? '' : (cfg.modifier > 0 ? ` + ${cfg.modifier}` : ` − ${Math.abs(cfg.modifier)}`);
  return `${cfg.count}D${cfg.sides}${mod}`;
}

function resultHtml(values, settled) {
  const sum = values.reduce((a, b) => a + b, 0) + cfg.modifier;
  const dieSize = values.length > 6 ? ' small' : '';
  const faces = values.map((v) => `<span class="die${dieSize}">${v}</span>`).join('');
  return `
    <div class="dice-sum${settled ? '' : ' rolling'}">${sum}</div>
    <div class="dice-faces">${faces}</div>
    ${values.length > 1 || cfg.modifier !== 0
      ? `<div class="card-meta dice-breakdown">${escapeHtml(notation())}　=　${values.join(' + ')}${cfg.modifier ? (cfg.modifier > 0 ? ` + ${cfg.modifier}` : ` − ${Math.abs(cfg.modifier)}`) : ''}</div>`
      : ''}
  `;
}

function historyHtml() {
  if (history.length === 0) return '';
  return `
    <div class="section-title">最近的紀錄</div>
    <ul class="tool-log">
      ${history.map((h) => `<li><span>${escapeHtml(h.label)}</span><strong>${h.sum}</strong></li>`).join('')}
    </ul>
  `;
}

export function render(el) {
  cfg = loadCfg();
  history = [];

  el.innerHTML = `
    <div class="card">
      <div class="form-label">面數</div>
      <div class="chip-row" data-sides>
        ${PRESETS.map((s) => `<button class="chip-btn" data-side="${s}">D${s}</button>`).join('')}
      </div>
      <div class="stepper-row">
        <label class="stepper-label" for="dice-custom-sides">自訂面數</label>
        <input class="form-control stepper-input" id="dice-custom-sides" type="number" min="2" max="1000" inputmode="numeric">
      </div>

      <div class="form-label" style="margin-top:14px">顆數</div>
      <div class="stepper" data-stepper="count">
        <button class="btn stepper-btn" data-delta="-1" aria-label="減少顆數">−</button>
        <output class="stepper-value" data-out="count"></output>
        <button class="btn stepper-btn" data-delta="1" aria-label="增加顆數">＋</button>
      </div>

      <div class="form-label" style="margin-top:14px">修正值</div>
      <div class="stepper" data-stepper="modifier">
        <button class="btn stepper-btn" data-delta="-1" aria-label="減少修正值">−</button>
        <output class="stepper-value" data-out="modifier"></output>
        <button class="btn stepper-btn" data-delta="1" aria-label="增加修正值">＋</button>
      </div>
    </div>

    <button class="btn btn-primary btn-block tool-action" data-roll>擲骰</button>

    <div class="card dice-result" data-result>
      <p class="card-meta" style="text-align:center;margin:0">按下「擲骰」</p>
    </div>

    <div data-history></div>
  `;

  const resultEl = el.querySelector('[data-result]');
  const historyEl = el.querySelector('[data-history]');
  const customSides = el.querySelector('#dice-custom-sides');

  function syncControls() {
    el.querySelectorAll('[data-side]').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.side) === cfg.sides);
    });
    customSides.value = PRESETS.includes(cfg.sides) ? '' : String(cfg.sides);
    el.querySelector('[data-out="count"]').textContent = String(cfg.count);
    el.querySelector('[data-out="modifier"]').textContent = cfg.modifier > 0 ? `+${cfg.modifier}` : String(cfg.modifier);
  }
  syncControls();

  function stopRolling() {
    if (rolling) { clearInterval(rolling); rolling = null; }
  }

  function roll() {
    stopRolling();
    diceSound();
    vibrate([18, 40, 18, 40, 24]);

    // 先亂跳一下再定格，不然結果直接冒出來沒有「擲」的感覺
    const startedAt = Date.now();
    const SPIN_MS = 520;
    rolling = setInterval(() => {
      if (Date.now() - startedAt >= SPIN_MS) {
        stopRolling();
        const values = rollOnce();
        const sum = values.reduce((a, b) => a + b, 0) + cfg.modifier;
        resultEl.innerHTML = resultHtml(values, true);
        history.unshift({ label: `${notation()}　${values.join('、')}`, sum });
        history = history.slice(0, 10);
        historyEl.innerHTML = historyHtml();
        return;
      }
      resultEl.innerHTML = resultHtml(rollOnce(), false);
    }, 60);
  }

  el.addEventListener('click', (e) => {
    const side = e.target.closest('[data-side]');
    if (side) {
      cfg.sides = Number(side.dataset.side);
      saveCfg(); syncControls();
      return;
    }
    const step = e.target.closest('[data-delta]');
    if (step) {
      const key = step.closest('[data-stepper]').dataset.stepper;
      const delta = Number(step.dataset.delta);
      if (key === 'count') cfg.count = Math.min(Math.max(cfg.count + delta, 1), 12);
      else cfg.modifier = Math.min(Math.max(cfg.modifier + delta, -99), 99);
      saveCfg(); syncControls();
      return;
    }
    if (e.target.closest('[data-roll]')) roll();
  });

  customSides.addEventListener('change', () => {
    const n = Math.round(Number(customSides.value));
    if (Number.isFinite(n) && n >= 2 && n <= 1000) cfg.sides = n;
    saveCfg(); syncControls();
  });

  onViewCleanup(stopRolling);
}

