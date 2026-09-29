// 桌邊小工具的總覽頁與分派。
//
// 這些工具跟站上其他頁面的性質不一樣：不吃 Firestore、不需要登入，
// 就算 bootstrap 失敗（現場沒網路）也要能開，所以 js/app.js 的 router
// 對 #/tools 有特別放行。
import { escapeHtml } from '../app.js';
import * as timer from '../tools/timer.js';
import * as dice from '../tools/dice.js';
import * as starter from '../tools/starter.js';
import * as teams from '../tools/teams.js';
import * as bracket from '../tools/bracket.js';
import * as scoreboard from '../tools/scoreboard.js';
import * as woodfish from '../tools/woodfish.js';

// 排序＝總覽頁的顯示順序，照現場使用頻率由高到低排。
const TOOLS = [timer, dice, starter, teams, scoreboard, bracket, woodfish];

function renderIndex(appEl) {
  appEl.innerHTML = `
    <h1 class="page-title">桌邊小工具</h1>
    <p class="card-meta">開桌當下用的小東西。設定和紀錄都存在這台裝置上，用的時候不會連網路。</p>
    <div class="tool-grid">
      ${TOOLS.map((t) => `
        <a class="tool-tile" href="#/tools/${t.id}">
          <span class="tool-tile-icon" aria-hidden="true">${t.icon}</span>
          <span class="tool-tile-name">${escapeHtml(t.name)}</span>
          <span class="tool-tile-desc">${escapeHtml(t.desc)}</span>
        </a>
      `).join('')}
    </div>
  `;
}

export async function renderTools(appEl, toolId) {
  if (!toolId) { renderIndex(appEl); return; }

  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) {
    appEl.innerHTML = `
      <div class="empty-state">
        <p>找不到這個小工具。</p>
        <a class="btn btn-primary" href="#/tools">回到小工具列表</a>
      </div>
    `;
    return;
  }

  appEl.innerHTML = `
    <div class="tool-header">
      <a class="btn btn-sm btn-ghost" href="#/tools">‹ 小工具</a>
      <h1 class="page-title" style="margin:0">${tool.icon} ${escapeHtml(tool.name)}</h1>
    </div>
    <div data-tool-body></div>
  `;

  tool.render(appEl.querySelector('[data-tool-body]'));
}
