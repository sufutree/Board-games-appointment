import { activeMembers, activeVenues, reloadDynamic } from '../store.js';
import { allGamesWithHolders, venueQualifies } from '../rules.js';
import { writeAction } from '../api.js';
import { escapeHtml, showToast } from '../app.js';

const MAX_SLOTS = 4;
const MIN_SLOTS = 1;

export async function renderNewEvent(appEl) {
  const members = activeMembers();
  const venues = activeVenues();

  const state = {
    slots: [
      { date: '', period: 'afternoon' },
    ],
    selectedGames: [],
  };

  appEl.innerHTML = `
    <h1 class="page-title">開新團</h1>
    <form id="new-event-form" novalidate>
      <div class="form-group">
        <label class="form-label" for="f-title">團名</label>
        <input class="form-control" id="f-title" placeholder="例如：週末來玩重策">
      </div>

      <div class="form-group">
        <label class="form-label" for="f-creator">發起人</label>
        <select class="form-control" id="f-creator">
          ${members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">候選時段</label>
        <div id="slot-rows"></div>
        <button type="button" id="add-slot" class="btn btn-sm">再加一個時段</button>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-venue">地點</label>
        <select class="form-control" id="f-venue">
          <option value="">尚未決定</option>
          ${venues.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('')}
          <option value="__other__">其他（自行輸入）</option>
        </select>
        <input class="form-control" id="f-venue-text" placeholder="輸入地點名稱" style="margin-top:8px; display:none;">
        <p id="venue-warning" class="error-text" hidden></p>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-game-search">想玩的遊戲</label>
        <p class="form-hint">有指定想玩的嗎？寫出來比較叫得動人。</p>
        <input class="form-control" id="f-game-search" placeholder="搜尋遊戲名稱…" autocomplete="off">
        <div id="game-picker-results" class="game-picker-results" hidden></div>
        <div id="selected-games" class="selected-games"></div>
      </div>

      <div class="form-group">
        <label class="form-label" for="f-note">備註</label>
        <textarea class="form-control" id="f-note" placeholder="選填"></textarea>
      </div>

      <p id="form-error" class="error-text" hidden></p>
      <button type="submit" id="submit-btn" class="btn btn-primary btn-block">送出</button>
    </form>
  `;

  const slotRowsEl = document.getElementById('slot-rows');
  const addSlotBtn = document.getElementById('add-slot');
  const creatorSelect = document.getElementById('f-creator');
  const venueSelect = document.getElementById('f-venue');
  const venueTextInput = document.getElementById('f-venue-text');
  const venueWarningEl = document.getElementById('venue-warning');
  const gameSearchInput = document.getElementById('f-game-search');
  const gamePickerResults = document.getElementById('game-picker-results');
  const selectedGamesEl = document.getElementById('selected-games');
  const formErrorEl = document.getElementById('form-error');
  const form = document.getElementById('new-event-form');

  function renderSlotRows() {
    slotRowsEl.innerHTML = state.slots.map((slot, i) => `
      <div class="slot-row" data-index="${i}">
        <input type="date" class="form-control slot-date" value="${slot.date}">
        <div class="period-toggle">
          <button type="button" data-period="afternoon" class="${slot.period === 'afternoon' ? 'active' : ''}">下午</button>
          <button type="button" data-period="evening" class="${slot.period === 'evening' ? 'active' : ''}">晚上</button>
        </div>
        ${state.slots.length > MIN_SLOTS ? '<button type="button" class="slot-remove" title="移除">✕</button>' : ''}
      </div>
    `).join('');
  }

  slotRowsEl.addEventListener('input', (e) => {
    if (e.target.classList.contains('slot-date')) {
      const row = e.target.closest('.slot-row');
      const idx = Number(row.dataset.index);
      state.slots[idx].date = e.target.value;
    }
  });

  slotRowsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.slot-row');
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (e.target.dataset.period) {
      state.slots[idx].period = e.target.dataset.period;
      row.querySelectorAll('.period-toggle button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.period === state.slots[idx].period);
      });
    } else if (e.target.classList.contains('slot-remove')) {
      state.slots.splice(idx, 1);
      renderSlotRows();
    }
  });

  addSlotBtn.addEventListener('click', () => {
    if (state.slots.length >= MAX_SLOTS) return;
    state.slots.push({ date: '', period: 'afternoon' });
    renderSlotRows();
    if (state.slots.length >= MAX_SLOTS) addSlotBtn.disabled = true;
  });

  renderSlotRows();

  venueSelect.addEventListener('change', () => {
    venueTextInput.style.display = venueSelect.value === '__other__' ? '' : 'none';
    updateVenueWarning();
  });
  creatorSelect.addEventListener('change', updateVenueWarning);

  function updateVenueWarning() {
    const venue = venues.find((v) => v.id === venueSelect.value);
    if (!venue || !creatorSelect.value || venueQualifies(venue, [creatorSelect.value])) {
      venueWarningEl.hidden = true;
      return;
    }
    venueWarningEl.textContent = '⚠️ 發起人目前不在這個場地的開放名單內，仍可送出。';
    venueWarningEl.hidden = false;
  }
  updateVenueWarning();

  function renderSelectedGames() {
    selectedGamesEl.innerHTML = state.selectedGames.map((g) => `
      <span class="selected-game-chip" data-bgg-id="${g.bggId}">
        ${escapeHtml(g.name)}
        <button type="button" aria-label="移除">✕</button>
      </span>
    `).join('');
  }

  selectedGamesEl.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    const chip = e.target.closest('.selected-game-chip');
    const bggId = Number(chip.dataset.bggId);
    state.selectedGames = state.selectedGames.filter((g) => g.bggId !== bggId);
    renderSelectedGames();
  });

  let allGames = null;
  gameSearchInput.addEventListener('input', () => {
    const kw = gameSearchInput.value.trim().toLowerCase();
    if (!kw) {
      gamePickerResults.hidden = true;
      gamePickerResults.innerHTML = '';
      return;
    }
    if (!allGames) allGames = allGamesWithHolders();
    const selectedIds = new Set(state.selectedGames.map((g) => g.bggId));
    const matches = allGames.filter((item) => {
      if (selectedIds.has(item.bggId)) return false;
      const hay = `${item.meta.name_zh || ''} ${item.meta.name_en || ''}`.toLowerCase();
      return hay.includes(kw);
    }).slice(0, 20);

    if (matches.length === 0) {
      gamePickerResults.hidden = false;
      gamePickerResults.innerHTML = '<div class="game-picker-item">沒有符合的遊戲</div>';
      return;
    }

    gamePickerResults.hidden = false;
    gamePickerResults.innerHTML = matches.map((item) => `
      <div class="game-picker-item" data-bgg-id="${item.bggId}">
        ${item.meta.thumbnail ? `<img src="${escapeHtml(item.meta.thumbnail)}" alt="">` : ''}
        <span>${escapeHtml(item.meta.name_zh || item.meta.name_en || String(item.bggId))}</span>
      </div>
    `).join('');
  });

  gamePickerResults.addEventListener('click', (e) => {
    const row = e.target.closest('.game-picker-item');
    if (!row || !row.dataset.bggId) return;
    const bggId = Number(row.dataset.bggId);
    const item = allGames.find((g) => g.bggId === bggId);
    if (!item) return;
    state.selectedGames.push({ bggId, name: item.meta.name_zh || item.meta.name_en || String(bggId) });
    renderSelectedGames();
    gameSearchInput.value = '';
    gamePickerResults.hidden = true;
    gamePickerResults.innerHTML = '';
  });

  function showError(msg) {
    formErrorEl.textContent = msg;
    formErrorEl.hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formErrorEl.hidden = true;

    const title = document.getElementById('f-title').value.trim();
    if (!title) return showError('請輸入團名。');

    const creatorId = document.getElementById('f-creator').value;
    if (!creatorId) return showError('請選擇發起人。');

    if (state.slots.some((s) => !s.date)) return showError('請完整填寫每個候選時段的日期。');

    const payload = {
      creator_id: creatorId,
      title,
      slots: state.slots.map((s) => ({ date: s.date, period: s.period })),
      game_bgg_ids: state.selectedGames.map((g) => g.bggId),
      note: document.getElementById('f-note').value.trim() || undefined,
    };

    if (venueSelect.value === '__other__') {
      const freeText = venueTextInput.value.trim();
      if (!freeText) return showError('請輸入地點名稱，或改選「尚未決定」。');
      payload.venue_free_text = freeText;
    } else if (venueSelect.value) {
      payload.venue_id = venueSelect.value;
    }

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '送出中…';

    const creatorMember = members.find((m) => m.id === creatorId);
    const result = await writeAction('createEvent', payload, creatorId, creatorMember ? creatorMember.name : creatorId);

    if (!result.ok) {
      submitBtn.disabled = false;
      submitBtn.textContent = '送出';
      if (result.error !== 'CANCELLED') showError(`建立失敗：${result.error}`);
      return;
    }

    await reloadDynamic();
    showToast('已建立新團！');
    location.hash = `#/event/${result.event_id}`;
  });
}
