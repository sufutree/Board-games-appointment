import { activeHolders, activeMembers, reloadDynamic } from '../store.js';
import {
  allGamesWithHolders, ownersOf, CATEGORY_GROUPS, CATEGORY_LABELS,
  filterGames, formatPlayers, formatDuration, formatWeight,
} from '../rules.js';
import { writeAction, getSelfId } from '../api.js';
import { renderIdentityBar } from '../identityBar.js';
import { escapeHtml, showToast } from '../app.js';

const BGG_ERROR_LABELS = {
  INVALID_BGG_ID: '看不出來是哪一款遊戲，請貼 BGG 網頁連結或直接輸入 BGG id。',
  BGG_NOT_FOUND: 'BGG 上查無這個 id。',
  BGG_BUSY: 'BGG 目前排隊中，請稍等幾秒再試一次。',
  BGG_FETCH_FAILED: '跟 BGG 要資料失敗，請稍後再試。',
  UNAUTHENTICATED: '請先在上面選擇你的身分。',
};

const WEIGHT_BANDS = {
  light: { max: 2.0, label: '輕度（≤2.0）' },
  medium: { min: 2.0, max: 3.5, label: '中度（2.0–3.5）' },
  heavy: { min: 3.5, label: '重度（≥3.5）' },
};

export async function renderGames(appEl) {
  const allItems = allGamesWithHolders();
  const nonExpansions = allItems.filter((i) => !i.meta.is_expansion);
  const holders = activeHolders();

  appEl.innerHTML = `
    <h1 class="page-title">遊戲庫</h1>
    <div id="identity-bar"></div>

    <div class="card">
      <button type="button" id="add-game-toggle" class="btn btn-sm">＋ 新增遊戲</button>
      <div id="add-game-form" hidden></div>
    </div>

    <div class="filter-bar">
      <input type="text" class="form-control" id="g-keyword" placeholder="搜尋中英文名稱">
      <select class="form-control" id="g-holder">
        <option value="">全部持有者</option>
        ${holders.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`).join('')}
      </select>
    </div>
    <div class="filter-bar">
      <select class="form-control" id="g-category">
        <option value="">全部分類</option>
        ${CATEGORY_GROUPS.map((g) => `
          <optgroup label="${escapeHtml(g.label)}">
            ${g.items.map((it) => `<option value="${it.code}">${escapeHtml(it.label)}</option>`).join('')}
          </optgroup>
        `).join('')}
      </select>
      <input type="number" min="1" class="form-control" id="g-players" placeholder="人數">
      <select class="form-control" id="g-duration">
        <option value="">時長不限</option>
        <option value="30">≤30 分</option>
        <option value="60">≤60 分</option>
        <option value="90">≤90 分</option>
        <option value="120">≤120 分</option>
      </select>
      <select class="form-control" id="g-weight">
        <option value="">複雜度不限</option>
        <option value="light">${WEIGHT_BANDS.light.label}</option>
        <option value="medium">${WEIGHT_BANDS.medium.label}</option>
        <option value="heavy">${WEIGHT_BANDS.heavy.label}</option>
      </select>
    </div>

    <div id="game-detail-panel"></div>
    <div id="game-count" class="card-meta"></div>
    <div id="game-grid"></div>
  `;

  const rerender = () => renderGames(appEl);
  renderIdentityBar(document.getElementById('identity-bar'), activeMembers(), rerender);
  setupAddGameForm();

  const keywordInput = document.getElementById('g-keyword');
  const holderSelect = document.getElementById('g-holder');
  const categorySelect = document.getElementById('g-category');
  const playersInput = document.getElementById('g-players');
  const durationSelect = document.getElementById('g-duration');
  const weightSelect = document.getElementById('g-weight');
  const gridEl = document.getElementById('game-grid');
  const countEl = document.getElementById('game-count');
  const detailPanel = document.getElementById('game-detail-panel');

  let expandedId = null;

  function currentWeightRange() {
    const band = WEIGHT_BANDS[weightSelect.value];
    if (!band) return { weightMin: null, weightMax: null };
    return { weightMin: band.min ?? null, weightMax: band.max ?? null };
  }

  function renderGrid() {
    const { weightMin, weightMax } = currentWeightRange();
    const filtered = filterGames(nonExpansions, {
      keyword: keywordInput.value,
      holderId: holderSelect.value || null,
      category: categorySelect.value || null,
      playerCount: playersInput.value,
      maxDuration: durationSelect.value,
      weightMin,
      weightMax,
    });

    countEl.textContent = `共 ${filtered.length} 款`;

    if (filtered.length === 0) {
      gridEl.innerHTML = '<p class="card-meta">沒有符合篩選條件的遊戲。</p>';
      return;
    }

    gridEl.innerHTML = `<div class="game-grid">${filtered.map((item) => `
      <div class="game-card" data-bgg-id="${item.bggId}">
        ${item.meta.thumbnail ? `<img src="${escapeHtml(item.meta.thumbnail)}" alt="">` : '<div style="width:56px;height:56px;flex-shrink:0;"></div>'}
        <div class="game-card-body">
          <div class="game-card-name">${escapeHtml(item.meta.name_zh || item.meta.name_en || String(item.bggId))}</div>
          <div class="game-card-meta">${formatPlayers(item.meta)} ・ ${formatDuration(item.meta)}</div>
          <div>
            ${item.sources.map((s) => `<span class="source-tag">${escapeHtml(s.label)}</span>`).join('')}
            ${!item.meta.hasData ? '<span class="source-tag missing-tag">缺少遊戲資料</span>' : ''}
          </div>
        </div>
      </div>
    `).join('')}</div>`;

    gridEl.querySelectorAll('.game-card').forEach((card) => {
      card.addEventListener('click', () => {
        expandedId = Number(card.dataset.bggId);
        renderDetail();
        detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderDetail() {
    if (expandedId == null) {
      detailPanel.innerHTML = '';
      return;
    }
    const item = allItems.find((i) => i.bggId === expandedId);
    if (!item) {
      detailPanel.innerHTML = '';
      return;
    }
    const meta = item.meta;
    const owners = ownersOf(item.bggId);
    const expansions = allItems.filter((i) => i.meta.is_expansion && i.meta.parent_bgg_id === item.bggId);

    detailPanel.innerHTML = `
      <div class="game-detail">
        <button type="button" class="btn btn-sm btn-ghost" id="detail-close" style="float:right;">✕ 關閉</button>
        <div class="game-detail-header">
          ${meta.thumbnail ? `<img src="${escapeHtml(meta.thumbnail)}" alt="">` : ''}
          <div>
            <div class="card-title">${escapeHtml(meta.name_zh || meta.name_en || String(item.bggId))}</div>
            ${meta.name_en && meta.name_zh ? `<div class="card-meta">${escapeHtml(meta.name_en)}</div>` : ''}
            ${!meta.hasData ? '<span class="source-tag missing-tag">缺少遊戲資料</span>' : ''}
          </div>
        </div>
        <dl>
          <dt>人數</dt><dd>${formatPlayers(meta)}</dd>
          <dt>時長</dt><dd>${formatDuration(meta)}</dd>
          <dt>複雜度</dt><dd>${formatWeight(meta)}</dd>
          <dt>分類</dt><dd>${meta.category ? escapeHtml(CATEGORY_LABELS[meta.category] || meta.category) : '－'}</dd>
          <dt>在哪裡／誰手上</dt>
          <dd>${owners.length === 0 ? '目前沒有人登記持有。' : owners.map((o) => o.isVenue ? `📍${escapeHtml(o.name)}` : escapeHtml(o.name)).join('、')}</dd>
        </dl>
        ${expansions.length > 0 ? `
          <div class="section-title" style="margin-top:16px;">擴充</div>
          ${expansions.map((ex) => `<div class="expansion-item">－ ${escapeHtml(ex.meta.name_zh || ex.meta.name_en || String(ex.bggId))}</div>`).join('')}
        ` : ''}
      </div>
    `;

    document.getElementById('detail-close').addEventListener('click', () => {
      expandedId = null;
      renderDetail();
    });
  }

  [keywordInput, holderSelect, categorySelect, playersInput, durationSelect, weightSelect].forEach((el) => {
    el.addEventListener('input', renderGrid);
    el.addEventListener('change', renderGrid);
  });

  renderGrid();
  renderDetail();

  // ---- 新增遊戲（貼 BGG 連結，任何登入身分都能用） ----
  function setupAddGameForm() {
    const toggleBtn = document.getElementById('add-game-toggle');
    const formEl = document.getElementById('add-game-form');

    toggleBtn.addEventListener('click', () => {
      const opening = formEl.hidden;
      formEl.hidden = !opening;
      toggleBtn.textContent = opening ? '取消新增' : '＋ 新增遊戲';
      if (opening) renderForm();
    });

    function renderForm() {
      formEl.innerHTML = `
        <div class="form-group">
          <label class="form-label" for="new-game-input">BGG 連結或 BGG id</label>
          <input class="form-control" id="new-game-input" placeholder="例如 https://boardgamegeek.com/boardgame/174430/ 或直接輸入 174430">
        </div>
        <div class="form-group">
          <label class="form-label" for="new-game-name-zh">中文名稱（選填）</label>
          <input class="form-control" id="new-game-name-zh" placeholder="沒填就先只顯示英文名稱">
        </div>
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
          <input type="checkbox" id="new-game-add-collection" checked>
          順便登記進我的收藏
        </label>
        <p id="new-game-error" class="error-text" hidden></p>
        <button type="button" id="new-game-submit" class="btn btn-primary btn-sm">送出</button>
      `;

      document.getElementById('new-game-submit').addEventListener('click', async () => {
        const errorEl = document.getElementById('new-game-error');
        errorEl.hidden = true;
        const bggInput = document.getElementById('new-game-input').value.trim();
        if (!bggInput) {
          errorEl.textContent = '請輸入 BGG 連結或 id。';
          errorEl.hidden = false;
          return;
        }
        const selfId = getSelfId();
        if (!selfId) {
          errorEl.textContent = '請先在上面選擇你的身分。';
          errorEl.hidden = false;
          return;
        }
        const payload = {
          bgg_input: bggInput,
          name_zh: document.getElementById('new-game-name-zh').value.trim() || undefined,
          add_to_collection: document.getElementById('new-game-add-collection').checked,
        };

        const submitBtn = document.getElementById('new-game-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = '查詢中…';
        const member = activeMembers().find((m) => m.id === selfId);
        const result = await writeAction('addGame', payload, selfId, member ? member.name : selfId);
        if (!result.ok) {
          submitBtn.disabled = false;
          submitBtn.textContent = '送出';
          if (result.error !== 'CANCELLED') {
            errorEl.textContent = BGG_ERROR_LABELS[result.error] || `新增失敗：${result.error}`;
            errorEl.hidden = false;
          }
          return;
        }

        await reloadDynamic();
        showToast(`已新增「${result.game.name_zh || result.game.name_en}」。`);
        formEl.hidden = true;
        toggleBtn.textContent = '＋ 新增遊戲';
        rerender();
      });
    }
  }
}
