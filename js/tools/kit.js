// 桌邊小工具共用的基礎設施。
//
// 這批工具的使用情境跟站上其他頁面相反：是在桌邊當下用的，現場網路常常很差，
// 所以刻意全部純本機——不讀寫 Firestore，狀態一律存 localStorage，沒網路也能用。

// ---- 音效 ----
// 不用音檔，直接用 Web Audio 合成，省下載也不會有檔案漏掉的問題。
// 瀏覽器規定 AudioContext 要在使用者互動之後才能出聲，所以延遲到第一次
// 真的要發聲時才建立（那時一定已經點過按鈕了）。
let audioCtx = null;
function ctx() {
  if (audioCtx === false) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { audioCtx = false; return null; }
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function beep({ freq = 880, duration = 0.12, type = 'sine', gain = 0.18, delay = 0 } = {}) {
  const ac = ctx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// 白噪音短促一下，用來做骰子碰撞、敲擊瞬間的顆粒感。
function noiseBurst({ duration = 0.05, gain = 0.15, delay = 0 } = {}) {
  const ac = ctx();
  if (!ac) return;
  const frames = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // 尾巴衰減，不然聽起來像被硬切斷
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ac.createBufferSource();
  const g = ac.createGain();
  src.buffer = buf;
  g.gain.value = gain;
  src.connect(g).connect(ac.destination);
  src.start(ac.currentTime + delay);
}

// 骰子落桌：幾聲間隔不規則的碰撞。
export function diceSound() {
  for (let i = 0; i < 5; i += 1) {
    noiseBurst({ duration: 0.04, gain: 0.12 - i * 0.015, delay: i * 0.055 + Math.random() * 0.02 });
  }
}

// 木魚「叩」：音高快速下滑的三角波，加一點雜訊當敲擊瞬間。
export function woodBlock() {
  const ac = ctx();
  if (!ac) return;
  const t0 = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(440, t0);
  osc.frequency.exponentialRampToValueAtTime(150, t0 + 0.06);
  g.gain.setValueAtTime(0.35, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + 0.15);
  noiseBurst({ duration: 0.025, gain: 0.1 });
}

// 時間到：三聲。
export function alarm() {
  beep({ freq: 988, duration: 0.18, type: 'square', gain: 0.2, delay: 0 });
  beep({ freq: 988, duration: 0.18, type: 'square', gain: 0.2, delay: 0.26 });
  beep({ freq: 1319, duration: 0.35, type: 'square', gain: 0.2, delay: 0.52 });
}

// 抽選定格、換人之類的短提示。
export function tick() { beep({ freq: 1200, duration: 0.04, type: 'square', gain: 0.08 }); }
export function ding() { beep({ freq: 1568, duration: 0.3, type: 'sine', gain: 0.2 }); }

// ---- 震動 ----
// iOS Safari 完全不支援 navigator.vibrate，所以震動只能當加分，
// 不能是唯一的回饋（每個用到的地方都同時有畫面變化或聲音）。
export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* 不支援就算了 */ }
}

// ---- 螢幕恆亮 ----
// 計時器、計分板開著時螢幕不能暗掉。Wake Lock 在 iOS 要 16.4 以上，
// 不支援或被拒絕就靜靜放棄，不影響功能本身。
let wakeLock = null;
let wantAwake = false;

async function acquire() {
  if (!wantAwake || wakeLock) return;
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* 不支援或被拒絕 */ }
}

// 切到別的分頁再切回來時，系統會自動釋放 wake lock，要重新要一次。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
});

export function keepAwake() { wantAwake = true; acquire(); }
export function releaseAwake() {
  wantAwake = false;
  if (wakeLock) { try { wakeLock.release(); } catch { /* 已經被釋放了 */ } wakeLock = null; }
}

// ---- 小工具函式 ----

// Fisher-Yates，就地洗牌後回傳新陣列。
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

// ---- 本機儲存 ----
// 無痕模式、封鎖 cookie 的瀏覽器讀寫會直接丟例外，包起來當作沒存過處理，
// 工具本身還是要能用（只是重開會忘記設定）。
export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

export function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存不了就算了 */ }
}

// ---- 時間格式 ----
// 1 小時以內顯示 m:ss，超過才補上小時，免得短計時看起來一堆 0。
export function fmtClock(ms, { showTenths = false } = {}) {
  const neg = ms < 0;
  const total = Math.abs(ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const tenth = Math.floor((total % 1000) / 100);
  const pad = (n) => String(n).padStart(2, '0');
  let out;
  if (h > 0) out = `${h}:${pad(m)}:${pad(s)}`;
  else out = `${m}:${pad(s)}`;
  if (showTenths && h === 0) out += `.${tenth}`;
  return (neg ? '-' : '') + out;
}
