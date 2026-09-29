// 敲木魚：功德計數器。純娛樂，但現場抽卡前敲兩下的儀式感意外好用。
import { onViewCleanup } from '../app.js';
import { woodBlock, vibrate, loadJSON, saveJSON } from './kit.js';

export const id = 'woodfish';
export const name = '敲木魚';
export const icon = '🪘';
export const desc = '功德 +1，抽卡前先求個運氣';

const KEY = 'tools.woodfish';

let state;
let autoTimer = null;

function today() {
  // 用本地時區的日期字串當「今天」，跨日自動歸零今日功德
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load() {
  const s = loadJSON(KEY, {});
  const day = today();
  return {
    total: Number(s.total) || 0,
    day,
    dayCount: s.day === day ? (Number(s.dayCount) || 0) : 0,
  };
}

function save() { saveJSON(KEY, state); }

export function render(el) {
  state = load();

  el.innerHTML = `
    <div class="woodfish-wrap">
      <div class="woodfish-stats">
        <div><span class="woodfish-num" data-total>${state.total}</span><span class="card-meta">累計功德</span></div>
        <div><span class="woodfish-num" data-day>${state.dayCount}</span><span class="card-meta">今日功德</span></div>
      </div>

      <button class="woodfish-btn" data-knock aria-label="敲木魚">
        <svg viewBox="0 0 120 100" aria-hidden="true">
          <ellipse cx="60" cy="56" rx="50" ry="40" fill="#8a5a33"/>
          <ellipse cx="60" cy="52" rx="50" ry="40" fill="#a06b3d"/>
          <ellipse cx="46" cy="38" rx="16" ry="10" fill="#b9814f" opacity="0.7"/>
          <path d="M22 58 Q60 78 98 58" stroke="#5f3c20" stroke-width="7" fill="none" stroke-linecap="round"/>
          <circle cx="86" cy="40" r="5" fill="#5f3c20"/>
        </svg>
        <span class="woodfish-hint">點一下</span>
      </button>

      <div class="woodfish-float" data-float aria-hidden="true"></div>

      <div class="card woodfish-auto">
        <label class="switch-row">
          <input type="checkbox" data-auto>
          <span>自動敲</span>
        </label>
        <div class="stepper-row">
          <label class="stepper-label" for="woodfish-rate">每秒 <output data-rate-out>2</output> 下</label>
          <input id="woodfish-rate" type="range" min="1" max="10" step="1" value="2" data-rate>
        </div>
      </div>

      <div class="tool-footer-actions">
        <button class="btn btn-danger btn-sm" data-reset>歸零功德</button>
      </div>
    </div>
  `;

  const totalEl = el.querySelector('[data-total]');
  const dayEl = el.querySelector('[data-day]');
  const floatEl = el.querySelector('[data-float]');
  const btn = el.querySelector('[data-knock]');
  const autoBox = el.querySelector('[data-auto]');
  const rateInput = el.querySelector('[data-rate]');
  const rateOut = el.querySelector('[data-rate-out]');

  function knock() {
    // 跨日的話今日功德要先歸零，不然開著過午夜會繼續累加到昨天那筆
    const day = today();
    if (state.day !== day) { state.day = day; state.dayCount = 0; }
    state.total += 1;
    state.dayCount += 1;
    save();
    totalEl.textContent = String(state.total);
    dayEl.textContent = String(state.dayCount);

    woodBlock();
    vibrate(12);

    btn.classList.remove('knocking');
    // 強制 reflow，連點時動畫才會重新播放而不是被忽略
    void btn.offsetWidth;
    btn.classList.add('knocking');

    const span = document.createElement('span');
    span.className = 'merit-pop';
    span.textContent = '功德 +1';
    span.style.left = `${40 + Math.random() * 20}%`;
    floatEl.appendChild(span);
    setTimeout(() => span.remove(), 1100);
  }

  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  function syncAuto() {
    stopAuto();
    rateOut.textContent = rateInput.value;
    if (autoBox.checked) autoTimer = setInterval(knock, 1000 / Number(rateInput.value));
  }

  btn.addEventListener('click', knock);
  autoBox.addEventListener('change', syncAuto);
  rateInput.addEventListener('input', syncAuto);

  el.querySelector('[data-reset]').addEventListener('click', () => {
    if (!confirm('確定要把累計功德歸零嗎？')) return;
    stopAuto();
    autoBox.checked = false;
    state = { total: 0, day: today(), dayCount: 0 };
    save();
    totalEl.textContent = '0';
    dayEl.textContent = '0';
  });

  onViewCleanup(stopAuto);
}
