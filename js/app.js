import { store, loadAll, activeMembers } from './store.js';
import { waitForAuthReady } from './firebase.js';
import { getSelfId } from './api.js';
import { initHeaderIdentity, openIdentityModal } from './identityBar.js';
import { renderHome } from './views/home.js';
import { renderNewEvent } from './views/newEvent.js';
import { renderEvent } from './views/event.js';
import { renderGames } from './views/games.js';
import { renderAdmin } from './views/admin.js';
import { renderTools } from './views/tools.js';
import { pushSupported, notificationPermission, listenForegroundMessages } from './push.js';

const appEl = document.getElementById('app');

export function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

// bootstrap 是否已經失敗過。用旗標而不是看 store.loadError，因為在 loadAll
// 之前就掛掉（例如 Firebase Auth 連不上）時 loadError 還是空的。
let bootFailed = false;

// 換頁時要收掉的東西（計時器的 interval、螢幕恆亮的 wake lock 之類）。
// 只有桌邊小工具會用到——其他頁面都是畫完就沒有背景活動。
let viewCleanup = null;
export function onViewCleanup(fn) { viewCleanup = fn; }
function runViewCleanup() {
  if (!viewCleanup) return;
  const fn = viewCleanup;
  viewCleanup = null;
  try { fn(); } catch (err) { console.error(err); }
}

function renderLoading() {
  appEl.innerHTML = `<div class="loading">載入中，請稍候…</div>`;
}

function renderLoadError() {
  appEl.innerHTML = `
    <div class="error-state">
      <p>資料載入失敗，請檢查網路連線。</p>
      <p class="card-meta">桌邊小工具不需要網路，可以直接用。</p>
      <div class="retry-row">
        <button id="retry-load" class="btn btn-primary">重試</button>
        <a class="btn" href="#/tools">開小工具</a>
      </div>
    </div>
  `;
  document.getElementById('retry-load').addEventListener('click', boot);
}

function parseRoute() {
  const hash = location.hash || '#/';
  const path = hash.slice(1) || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { view: 'home' };
  if (parts[0] === 'new') return { view: 'new' };
  if (parts[0] === 'games') return { view: 'games' };
  if (parts[0] === 'admin') return { view: 'admin' };
  if (parts[0] === 'tools') return { view: 'tools', id: parts[1] || null };
  if (parts[0] === 'event' && parts[1]) return { view: 'event', id: parts[1] };
  return { view: 'home' };
}

export async function router() {
  const route = parseRoute();

  // 小工具全部是純本機的（不讀寫 Firestore），所以 bootstrap 失敗——現場
  // 網路爛的時候——照樣要能開。其他頁面沒有資料就真的沒東西可顯示。
  if (!store.loaded && route.view !== 'tools') {
    if (bootFailed) renderLoadError();
    return;
  }

  runViewCleanup();
  window.scrollTo(0, 0);
  try {
    if (route.view === 'home') await renderHome(appEl);
    else if (route.view === 'new') await renderNewEvent(appEl);
    else if (route.view === 'event') await renderEvent(appEl, route.id);
    else if (route.view === 'games') await renderGames(appEl);
    else if (route.view === 'admin') await renderAdmin(appEl);
    else if (route.view === 'tools') await renderTools(appEl, route.id);
    else await renderHome(appEl);
  } catch (err) {
    console.error(err);
    appEl.innerHTML = `
      <div class="error-state">
        <p>畫面顯示發生錯誤：${escapeHtml(err.message || String(err))}</p>
        <div class="retry-row"><button id="retry-route" class="btn btn-primary">重試</button></div>
      </div>
    `;
    document.getElementById('retry-route').addEventListener('click', router);
  }
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function boot() {
  renderLoading();
  try {
    await waitForAuthReady();
    await loadAll();
    initHeaderIdentity(activeMembers(), router);
    await router();
    // 開啟網站主動問一次「你是誰」，可以直接取消當作先不登入逛逛；
    // 不 await，讓畫面先顯示出來，視窗疊在上面，不擋住瀏覽。
    if (!getSelfId()) openIdentityModal();
    // 上次已經同意過通知權限的話，重新整理/重新打開 app 要重新接上前景
    // 訊息監聽（js/push.js 那個 listener 只在還活著的分頁生命週期內有效，
    // 每次開機都要重掛一次，不是掛一次就永久有效）。
    if (pushSupported() && notificationPermission() === 'granted') {
      listenForegroundMessages();
    }
  } catch (err) {
    console.error(err);
    bootFailed = true;
    // 停在小工具頁（或直接用捷徑開進來）的話就照樣畫出來，不要被
    // 載入失敗的畫面蓋掉——桌邊要用的就是這幾個工具。
    if (parseRoute().view === 'tools') await router();
    else renderLoadError();
  }
}

window.addEventListener('hashchange', router);
boot();

// 註冊 service worker，讓瀏覽器判定這個網站可以「安裝」（不是只能加捷徑）。
// 失敗（例如舊瀏覽器不支援）就算了，不影響網站本身能不能用。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
