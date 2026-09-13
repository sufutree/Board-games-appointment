import { store, loadAll } from './store.js';
import { renderHome } from './views/home.js';
import { renderNewEvent } from './views/newEvent.js';
import { renderEvent } from './views/event.js';
import { renderGames } from './views/games.js';

const appEl = document.getElementById('app');

export function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function renderLoading() {
  appEl.innerHTML = `<div class="loading">載入中，請稍候…（首次載入 Apps Script 可能需要幾秒）</div>`;
}

function renderLoadError() {
  appEl.innerHTML = `
    <div class="error-state">
      <p>資料載入失敗，請檢查網路連線。</p>
      <div class="retry-row"><button id="retry-load" class="btn btn-primary">重試</button></div>
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
  if (parts[0] === 'event' && parts[1]) return { view: 'event', id: parts[1] };
  return { view: 'home' };
}

export async function router() {
  if (!store.loaded) return;
  const route = parseRoute();
  window.scrollTo(0, 0);
  try {
    if (route.view === 'home') await renderHome(appEl);
    else if (route.view === 'new') await renderNewEvent(appEl);
    else if (route.view === 'event') await renderEvent(appEl, route.id);
    else if (route.view === 'games') await renderGames(appEl);
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
    await loadAll();
    await router();
  } catch (err) {
    console.error(err);
    renderLoadError();
  }
}

window.addEventListener('hashchange', router);
boot();
