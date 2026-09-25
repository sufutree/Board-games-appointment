import {
  activeHolders, activeMembers, activeVenues, reloadDynamic, allOwnerships,
  activeTags, tagGroups, tagLabel,
} from '../store.js';
import {
  allGamesWithHolders, ownersOf,
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
  MISSING_MEMBER_ID: '請先在上面選擇你的身分。',
};

const CORRECTION_FIELDS = {
  name_zh: '中文名稱',
  tags: '標籤',
  min_players: '最少人數',
  max_players: '最多人數',
  playing_time: '遊玩時間（分鐘）',
  is_expansion: '是否為擴充',
  other: '其他（自由描述）',
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
      <select class="form-control" id="g-tag">
        <option value="">全部標籤</option>
        ${tagGroups().map((g) => `
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
  const tagSelect = document.getElementById('g-tag');
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
      tag: tagSelect.value || null,
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
            ${(item.meta.tags || []).map((t) => `<span class="source-tag">${escapeHtml(tagLabel(t))}</span>`).join('')}
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
    const selfId = getSelfId();
    const iHaveIt = !!selfId && allOwnerships().some((o) => o.holder_id === selfId && o.bgg_id === item.bggId);

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
          <dt>標籤</dt><dd>${(meta.tags || []).length ? meta.tags.map((t) => escapeHtml(tagLabel(t))).join('、') : '－'}</dd>
          <dt>在哪裡／誰手上</dt>
          <dd>${owners.length === 0 ? '目前沒有人登記持有。' : owners.map((o) => o.isVenue ? `📍${escapeHtml(o.name)}` : escapeHtml(o.name)).join('、')}</dd>
        </dl>
        ${expansions.length > 0 ? `
          <div class="section-title" style="margin-top:16px;">擴充</div>
          ${expansions.map((ex) => `<div class="expansion-item">－ ${escapeHtml(ex.meta.name_zh || ex.meta.name_en || String(ex.bggId))}</div>`).join('')}
        ` : ''}
        <div style="display:flex; gap:8px; margin-top:16px; flex-wrap:wrap;">
          <button type="button" id="toggle-have-btn" class="btn btn-sm ${iHaveIt ? '' : 'btn-primary'}">${iHaveIt ? '✓ 我也有（點一下移除）' : '＋ 我也有這款'}</button>
          <button type="button" id="propose-venue-toggle" class="btn btn-sm btn-ghost">幫場地登記這款</button>
          <button type="button" id="report-correction-toggle" class="btn btn-sm btn-ghost">回報資料有誤</button>
        </div>
        <div id="propose-venue-form" hidden></div>
        <div id="correction-form" hidden></div>
      </div>
    `;

    document.getElementById('toggle-have-btn').addEventListener('click', async () => {
      if (!selfId) {
        showToast(BGG_ERROR_LABELS.MISSING_MEMBER_ID);
        return;
      }
      const member = activeMembers().find((m) => m.id === selfId);
      const btn = document.getElementById('toggle-have-btn');
      btn.disabled = true;
      const result = await writeAction('toggleCollection', {
        holder_id: selfId, bgg_id: item.bggId, name_zh: meta.name_zh, has: !iHaveIt,
      }, selfId, member ? member.name : selfId);
      btn.disabled = false;
      if (!result.ok) {
        if (result.error !== 'CANCELLED') showToast(`操作失敗：${result.error}`);
        return;
      }
      await reloadDynamic();
      renderDetail();
    });

    setupCorrectionForm(item, meta);
    setupProposeVenueForm(item, meta);

    document.getElementById('detail-close').addEventListener('click', () => {
      expandedId = null;
      renderDetail();
    });
  }

  [keywordInput, holderSelect, tagSelect, playersInput, durationSelect, weightSelect].forEach((el) => {
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
          <label class="form-label" for="new-game-name-zh">中文名稱（BGG 抓不到資料時必填）</label>
          <input class="form-control" id="new-game-name-zh" placeholder="沒填就先只顯示英文名稱">
        </div>
        <p class="form-hint">BGG 目前需要申請 API 權杖才能自動抓資料，申請核准前可能抓不到，以下欄位可以先手動填，之後再回來訂正也可以。</p>
        <div class="form-group">
          <label class="form-label" for="new-game-name-en">英文名稱（選填）</label>
          <input class="form-control" id="new-game-name-en">
        </div>
        <div class="form-group" style="display:flex; gap:8px;">
          <div style="flex:1;">
            <label class="form-label" for="new-game-min-players">最少人數（選填）</label>
            <input type="number" min="1" class="form-control" id="new-game-min-players">
          </div>
          <div style="flex:1;">
            <label class="form-label" for="new-game-max-players">最多人數（選填）</label>
            <input type="number" min="1" class="form-control" id="new-game-max-players">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="new-game-playing-time">遊戲時間（分鐘，選填）</label>
          <input type="number" min="1" class="form-control" id="new-game-playing-time">
        </div>
        <div class="form-group">
          <label class="form-label" for="new-game-thumbnail">縮圖網址（選填）</label>
          <input class="form-control" id="new-game-thumbnail">
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
          errorEl.textContent = '請輸入 BGG 連結或 id（就算 BGG 暫時抓不到資料，還是要靠這個知道是哪一款）。';
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
          name_en: document.getElementById('new-game-name-en').value.trim() || undefined,
          min_players: document.getElementById('new-game-min-players').value || undefined,
          max_players: document.getElementById('new-game-max-players').value || undefined,
          playing_time: document.getElementById('new-game-playing-time').value || undefined,
          thumbnail: document.getElementById('new-game-thumbnail').value.trim() || undefined,
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
            errorEl.textContent = result.error === 'MISSING_NAME'
              ? 'BGG 暫時抓不到資料，請至少手動填中文名稱。'
              : (BGG_ERROR_LABELS[result.error] || `新增失敗：${result.error}`);
            errorEl.hidden = false;
          }
          return;
        }

        await reloadDynamic();
        showToast(result.bgg_fetch_ok
          ? `已新增「${result.game.name_zh || result.game.name_en}」。`
          : `已用手動填寫的資料新增「${result.game.name_zh}」（BGG 資料暫時抓不到，之後可以再訂正）。`);
        formEl.hidden = true;
        toggleBtn.textContent = '＋ 新增遊戲';
        rerender();
      });
    }
  }

  // ---- 回報資料訂正（分類／中文名稱／人數…可能 BGG 抓錯或本來就有誤） ----
  function setupCorrectionForm(item, meta) {
    const toggleBtn = document.getElementById('report-correction-toggle');
    const formEl = document.getElementById('correction-form');

    toggleBtn.addEventListener('click', () => {
      const opening = formEl.hidden;
      formEl.hidden = !opening;
      toggleBtn.textContent = opening ? '取消回報' : '回報資料有誤';
      if (opening) renderForm();
    });

    function currentValueFor(field) {
      if (field === 'name_zh') return meta.name_zh || '';
      if (field === 'min_players') return meta.min_players ?? '';
      if (field === 'max_players') return meta.max_players ?? '';
      if (field === 'playing_time') return meta.playing_time ?? '';
      if (field === 'is_expansion') return meta.is_expansion ? '是' : '否';
      return '';
    }

    function renderForm() {
      formEl.innerHTML = `
        <div class="form-group">
          <label class="form-label" for="correction-field">要訂正的欄位</label>
          <select class="form-control" id="correction-field">
            ${Object.entries(CORRECTION_FIELDS).map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
        <p class="card-meta" id="correction-current"></p>
        <div class="form-group" id="correction-value-group"></div>
        <div class="form-group">
          <label class="form-label" for="correction-note">補充說明（選填）</label>
          <textarea class="form-control" id="correction-note" placeholder="例如：BGG 官方頁面寫的是…、或這款其實是某某的擴充"></textarea>
        </div>
        <p id="correction-error" class="error-text" hidden></p>
        <button type="button" id="correction-submit" class="btn btn-primary btn-sm">送出給管理員審核</button>
      `;

      const fieldSelect = document.getElementById('correction-field');
      const currentEl = document.getElementById('correction-current');
      const valueGroup = document.getElementById('correction-value-group');
      const currentTagCodes = meta.tags || [];

      function renderValueInput() {
        const field = fieldSelect.value;
        if (field === 'tags') {
          currentEl.textContent = `目前的標籤：${currentTagCodes.length ? currentTagCodes.map(tagLabel).join('、') : '（無）'}`;
          valueGroup.innerHTML = `
            <label class="form-label">勾選這款遊戲該有的標籤</label>
            ${tagGroups().map((g) => `
              <div style="margin-bottom:6px;">
                <strong>${escapeHtml(g.label)}</strong><br>
                ${g.items.map((t) => `
                  <label style="display:inline-flex; align-items:center; gap:4px; margin-right:12px;">
                    <input type="checkbox" class="tag-checkbox" value="${escapeHtml(t.code)}" ${currentTagCodes.includes(t.code) ? 'checked' : ''}>
                    ${escapeHtml(t.label)}
                  </label>
                `).join('')}
              </div>
            `).join('')}
            <p class="form-hint">清單裡沒有你要的標籤？下面填一個新的（送出後這次勾選的既有標籤會先忽略，等新標籤通過再回來調整）。</p>
            <label class="form-label" for="new-tag-name">提議新標籤（選填）</label>
            <input class="form-control" id="new-tag-name" placeholder="新標籤名稱">
            <select class="form-control" id="new-tag-group" style="margin-top:8px;">
              ${tagGroups().map((g) => `<option value="${g.code}" data-label="${escapeHtml(g.label)}">${escapeHtml(g.label)}</option>`).join('')}
            </select>
          `;
          return;
        }
        currentEl.textContent = field === 'other' ? '' : `目前的值：${currentValueFor(field) || '（空）'}`;
        if (field === 'is_expansion') {
          valueGroup.innerHTML = `
            <label class="form-label" for="correction-value">建議改成</label>
            <select class="form-control" id="correction-value">
              <option value="true">是（擴充）</option>
              <option value="false">否（本體）</option>
            </select>
          `;
        } else if (field === 'other') {
          valueGroup.innerHTML = '';
        } else if (['min_players', 'max_players', 'playing_time'].includes(field)) {
          valueGroup.innerHTML = `
            <label class="form-label" for="correction-value">建議改成</label>
            <input type="number" min="0" class="form-control" id="correction-value">
          `;
        } else {
          valueGroup.innerHTML = `
            <label class="form-label" for="correction-value">建議改成</label>
            <input class="form-control" id="correction-value">
          `;
        }
      }
      fieldSelect.addEventListener('change', renderValueInput);
      renderValueInput();

      document.getElementById('correction-submit').addEventListener('click', async () => {
        const errorEl = document.getElementById('correction-error');
        errorEl.hidden = true;
        const field = fieldSelect.value;
        const note = document.getElementById('correction-note').value.trim();

        const selfId = getSelfId();
        if (!selfId) {
          errorEl.textContent = BGG_ERROR_LABELS.MISSING_MEMBER_ID;
          errorEl.hidden = false;
          return;
        }
        const member = activeMembers().find((m) => m.id === selfId);
        const submitBtn = document.getElementById('correction-submit');

        if (field === 'tags') {
          const newTagName = document.getElementById('new-tag-name').value.trim();
          submitBtn.disabled = true;
          submitBtn.textContent = '送出中…';
          let result;
          if (newTagName) {
            const groupSelect = document.getElementById('new-tag-group');
            result = await writeAction('submitTagProposal', {
              label: newTagName,
              group_code: groupSelect.value,
              group_label: groupSelect.selectedOptions[0].dataset.label,
              apply_to_bgg_id: item.bggId,
            }, selfId, member ? member.name : selfId);
          } else {
            const checkedCodes = [...document.querySelectorAll('.tag-checkbox:checked')].map((el) => el.value);
            result = await writeAction('submitCorrection', {
              bgg_id: item.bggId,
              field: 'tags',
              current_value: JSON.stringify(currentTagCodes),
              suggested_value: JSON.stringify(checkedCodes),
              note,
            }, selfId, member ? member.name : selfId);
          }
          submitBtn.disabled = false;
          submitBtn.textContent = '送出給管理員審核';
          if (!result.ok) {
            if (result.error !== 'CANCELLED') {
              errorEl.textContent = `送出失敗：${result.error}`;
              errorEl.hidden = false;
            }
            return;
          }
          showToast('已送出，等管理員審核。');
          formEl.hidden = true;
          toggleBtn.textContent = '回報資料有誤';
          return;
        }

        const valueInput = document.getElementById('correction-value');
        const suggestedValue = valueInput ? valueInput.value.trim() : '';
        if (field !== 'other' && !suggestedValue) {
          errorEl.textContent = '請輸入建議的新值。';
          errorEl.hidden = false;
          return;
        }
        if (field === 'other' && !note) {
          errorEl.textContent = '請說明是哪裡有問題。';
          errorEl.hidden = false;
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '送出中…';
        const result = await writeAction('submitCorrection', {
          bgg_id: item.bggId,
          field,
          current_value: currentValueFor(field),
          suggested_value: suggestedValue,
          note,
        }, selfId, member ? member.name : selfId);
        submitBtn.disabled = false;
        submitBtn.textContent = '送出給管理員審核';
        if (!result.ok) {
          if (result.error !== 'CANCELLED') {
            errorEl.textContent = `送出失敗：${result.error}`;
            errorEl.hidden = false;
          }
          return;
        }
        showToast('已送出，等管理員審核。');
        formEl.hidden = true;
        toggleBtn.textContent = '回報資料有誤';
      });
    }
  }

  // ---- 幫場地登記這款遊戲（要 admin 審核才會真的生效） ----
  function setupProposeVenueForm(item, meta) {
    const toggleBtn = document.getElementById('propose-venue-toggle');
    const formEl = document.getElementById('propose-venue-form');
    const venues = activeVenues();

    toggleBtn.addEventListener('click', () => {
      const opening = formEl.hidden;
      formEl.hidden = !opening;
      toggleBtn.textContent = opening ? '取消' : '幫場地登記這款';
      if (opening) renderForm();
    });

    function renderForm() {
      if (venues.length === 0) {
        formEl.innerHTML = '<p class="card-meta">目前沒有任何場地。</p>';
        return;
      }
      formEl.innerHTML = `
        <div class="form-group">
          <label class="form-label" for="propose-venue-select">場地</label>
          <select class="form-control" id="propose-venue-select">
            ${venues.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('')}
          </select>
        </div>
        <p class="form-hint">送出後要等管理員審核通過，才會真的加進那個場地的收藏。</p>
        <p id="propose-venue-error" class="error-text" hidden></p>
        <button type="button" id="propose-venue-submit" class="btn btn-primary btn-sm">送出給管理員審核</button>
      `;

      document.getElementById('propose-venue-submit').addEventListener('click', async () => {
        const errorEl = document.getElementById('propose-venue-error');
        errorEl.hidden = true;
        const selfId = getSelfId();
        if (!selfId) {
          errorEl.textContent = BGG_ERROR_LABELS.MISSING_MEMBER_ID;
          errorEl.hidden = false;
          return;
        }
        const venueId = document.getElementById('propose-venue-select').value;
        const member = activeMembers().find((m) => m.id === selfId);

        const submitBtn = document.getElementById('propose-venue-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = '送出中…';
        const result = await writeAction('submitVenueCollection', {
          venue_id: venueId, bgg_id: item.bggId, name_zh: meta.name_zh,
        }, selfId, member ? member.name : selfId);
        submitBtn.disabled = false;
        submitBtn.textContent = '送出給管理員審核';
        if (!result.ok) {
          if (result.error !== 'CANCELLED') {
            errorEl.textContent = `送出失敗：${result.error}`;
            errorEl.hidden = false;
          }
          return;
        }
        showToast('已送出，等管理員審核。');
        formEl.hidden = true;
        toggleBtn.textContent = '幫場地登記這款';
      });
    }
  }
}
