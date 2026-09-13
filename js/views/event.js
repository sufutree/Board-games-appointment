import {
  eventById, slotsOfEvent, votesOfEvent, signupsOfEvent,
  activeMembers, memberById, venueById, activeVenues, reloadDynamic,
} from '../store.js';
import {
  computePlayableList, filterGames, formatSlotLabel,
  formatPlayers, formatDuration, formatWeight, venueQualifies,
} from '../rules.js';
import { writeAction, promptPassword, getSelfId, setSelfId, clearSelfId, rememberSecret } from '../api.js';
import { escapeHtml, showToast } from '../app.js';

const STATUS_LABEL = { open: '投票中', confirmed: '已定案', cancelled: '已取消' };

function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

function slotLabel(slot) {
  return slot.label || formatSlotLabel(slot.date, slot.period);
}

function venueDisplay(event) {
  if (event.venue_id) {
    const v = venueById(event.venue_id);
    return v ? v.name : '（場地已刪除）';
  }
  if (event.venue_free_text) return event.venue_free_text;
  return '尚未決定';
}

export async function renderEvent(appEl, eventId) {
  const event = eventById(eventId);
  if (!event) {
    appEl.innerHTML = `
      <div class="error-state">
        <p>找不到這個團，可能已被刪除。</p>
        <a class="btn" href="#/">回首頁</a>
      </div>
    `;
    return;
  }

  const rerender = () => renderEvent(appEl, eventId);

  const slots = slotsOfEvent(event.event_id);
  const votes = votesOfEvent(event.event_id);
  const signups = signupsOfEvent(event.event_id);
  const members = activeMembers();
  const creator = memberById(event.creator_id);
  const selfId = getSelfId();
  const selfIsValid = members.some((m) => m.id === selfId);

  appEl.innerHTML = `
    <div class="card">
      <div class="card-title-row">
        <span class="card-title">${escapeHtml(event.title)}</span>
        <span class="badge badge-${event.status}">${STATUS_LABEL[event.status] || event.status}</span>
      </div>
      <div class="card-meta">發起人：${escapeHtml(creator ? creator.name : '未知')}</div>
      <div class="card-meta">地點：${escapeHtml(venueDisplay(event))}</div>
      ${event.note ? `<div class="card-meta">備註：${escapeHtml(event.note)}</div>` : ''}
    </div>

    <div id="identity-bar"></div>

    <div class="section-title">時段投票</div>
    <div id="vote-section"></div>

    ${event.status === 'open' ? `
      <div class="section-title">定案</div>
      <div id="confirm-section" class="card"></div>
    ` : ''}

    ${event.status === 'confirmed' ? `
      <div class="section-title">報名名單</div>
      <div id="signup-section"></div>
    ` : ''}

    <div class="section-title">可玩清單</div>
    <div id="playable-section"></div>

    ${event.status !== 'cancelled' ? '<div id="cancel-section" style="margin-top:24px;"></div>' : ''}
  `;

  renderIdentityBar();
  renderVoteSection();
  if (event.status === 'open') renderConfirmSection();
  if (event.status === 'confirmed') renderSignupSection();
  renderPlayableSection();
  if (event.status !== 'cancelled') renderCancelControl();

  // ---- 身分列 ----
  function renderIdentityBar() {
    const el = document.getElementById('identity-bar');
    if (selfIsValid) {
      const m = memberById(selfId);
      el.innerHTML = `
        <div class="identity-bar">
          <span>你是：<strong>${escapeHtml(m.name)}</strong></span>
          <a href="#" id="not-me-link">不是我？</a>
        </div>
      `;
      document.getElementById('not-me-link').addEventListener('click', (e) => {
        e.preventDefault();
        clearSelfId();
        rerender();
      });
    } else {
      el.innerHTML = `
        <div class="identity-bar" style="flex-direction: column; align-items: stretch;">
          <span>請先點選你的名字：</span>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${members.map((m) => `<button type="button" class="btn btn-sm" data-member-id="${escapeHtml(m.id)}">${escapeHtml(m.name)}</button>`).join('')}
          </div>
        </div>
      `;
      el.querySelectorAll('button[data-member-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const member = memberById(btn.dataset.memberId);
          const password = await promptPassword(member ? member.name : btn.dataset.memberId, false);
          if (password == null) return; // 使用者取消，留在選擇畫面
          setSelfId(btn.dataset.memberId);
          rememberSecret(btn.dataset.memberId, password);
          rerender();
        });
      });
    }
  }

  // ---- 投票表 ----
  function renderVoteSection() {
    const el = document.getElementById('vote-section');
    const votingOpen = event.status === 'open';

    if (slots.length === 0) {
      el.innerHTML = '<p class="card-meta">這個團沒有候選時段。</p>';
      return;
    }

    function cellContent(member, slot) {
      const vote = votes.find((v) => v.slot_id === slot.slot_id && v.member_id === member.id);
      const ok = vote ? isTrue(vote.ok) : false;
      const answered = !!vote;
      if (votingOpen && member.id === selfId) {
        return `<button type="button" class="vote-cell-btn ${ok ? 'ok' : ''}" data-slot-id="${slot.slot_id}">${ok ? '可以' : '不行'}</button>`;
      }
      if (!answered) return '<span style="color:var(--color-text-muted)">－</span>';
      return ok ? '<span style="color:var(--color-accent)">✓ 可以</span>' : '<span style="color:var(--color-text-muted)">✗ 不行</span>';
    }

    el.innerHTML = `
      <div class="vote-table-wrap">
        <table class="vote-table">
          <thead>
            <tr>
              <th>成員</th>
              ${slots.map((s) => `<th>${escapeHtml(slotLabel(s))}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${members.map((m) => `
              <tr>
                <td>${escapeHtml(m.name)}${m.id === selfId ? '（你）' : ''}</td>
                ${slots.map((s) => `<td>${cellContent(m, s)}</td>`).join('')}
              </tr>
            `).join('')}
            <tr class="vote-count-row">
              <td>可以人數</td>
              ${slots.map((s) => `<td>${votes.filter((v) => v.slot_id === s.slot_id && isTrue(v.ok)).length}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
      ${!selfIsValid && votingOpen ? '<p class="card-meta">請先在上方點選你的名字才能投票。</p>' : ''}
    `;

    if (votingOpen && selfIsValid) {
      el.querySelectorAll('.vote-cell-btn').forEach((btn) => {
        btn.addEventListener('click', () => onVoteToggle(btn.dataset.slotId, btn));
      });
    }
  }

  async function onVoteToggle(slotId, btn) {
    const wasOk = btn.classList.contains('ok');
    const nextOk = !wasOk;
    btn.classList.toggle('ok', nextOk);
    btn.textContent = nextOk ? '可以' : '不行';
    btn.disabled = true;

    const selfVotesMap = new Map();
    for (const s of slots) {
      const existing = votes.find((v) => v.slot_id === s.slot_id && v.member_id === selfId);
      selfVotesMap.set(s.slot_id, existing ? isTrue(existing.ok) : false);
    }
    selfVotesMap.set(slotId, nextOk);

    const payload = {
      event_id: event.event_id,
      member_id: selfId,
      votes: [...selfVotesMap.entries()].map(([sid, ok]) => ({ slot_id: sid, ok })),
    };

    const selfMember = memberById(selfId);
    const result = await writeAction('vote', payload, selfId, selfMember ? selfMember.name : selfId);
    if (!result.ok) {
      btn.disabled = false;
      if (result.error !== 'CANCELLED') showToast(`投票失敗：${result.error}`);
      btn.classList.toggle('ok', wasOk);
      btn.textContent = wasOk ? '可以' : '不行';
      return;
    }
    await reloadDynamic();
    rerender();
  }

  // ---- 定案區 ----
  function renderConfirmSection() {
    const el = document.getElementById('confirm-section');
    const venueAlreadySet = !!(event.venue_id || event.venue_free_text);

    el.innerHTML = `
      <div class="form-group">
        <label class="form-label">選擇定案時段</label>
        ${slots.map((s) => `
          <label style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <input type="radio" name="confirm-slot" value="${s.slot_id}">
            ${escapeHtml(slotLabel(s))}（${votes.filter((v) => v.slot_id === s.slot_id && isTrue(v.ok)).length} 人可以）
          </label>
        `).join('')}
      </div>
      ${venueAlreadySet ? `
        <p class="card-meta">地點：${escapeHtml(venueDisplay(event))}</p>
      ` : `
        <div class="form-group">
          <label class="form-label" for="confirm-venue">地點</label>
          <select class="form-control" id="confirm-venue">
            <option value="">尚未決定</option>
            ${activeVenues().map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('')}
            <option value="__other__">其他（自行輸入）</option>
          </select>
          <input class="form-control" id="confirm-venue-text" placeholder="輸入地點名稱" style="margin-top:8px; display:none;">
          <p id="confirm-venue-warning" class="error-text" hidden></p>
        </div>
      `}
      <p class="form-hint">定案後會把投「可以」的人自動加入報名名單。</p>
      <p id="confirm-error" class="error-text" hidden></p>
      <button type="button" id="confirm-btn" class="btn btn-primary btn-block">定案</button>
    `;

    if (!venueAlreadySet) {
      const venueSel = document.getElementById('confirm-venue');
      const venueText = document.getElementById('confirm-venue-text');
      const venueWarningEl = document.getElementById('confirm-venue-warning');

      function updateVenueWarning() {
        const venue = activeVenues().find((v) => v.id === venueSel.value);
        if (!venue) {
          venueWarningEl.hidden = true;
          return;
        }
        const checked = el.querySelector('input[name="confirm-slot"]:checked');
        const okVoterIds = checked
          ? votes.filter((v) => v.slot_id === checked.value && isTrue(v.ok)).map((v) => v.member_id)
          : [];
        if (venueQualifies(venue, okVoterIds)) {
          venueWarningEl.hidden = true;
          return;
        }
        venueWarningEl.textContent = '⚠️ 目前投「可以」的人裡沒有人在這個場地的開放名單內，仍可定案。';
        venueWarningEl.hidden = false;
      }

      venueSel.addEventListener('change', () => {
        venueText.style.display = venueSel.value === '__other__' ? '' : 'none';
        updateVenueWarning();
      });
      el.querySelectorAll('input[name="confirm-slot"]').forEach((radio) => {
        radio.addEventListener('change', updateVenueWarning);
      });
      updateVenueWarning();
    }

    document.getElementById('confirm-btn').addEventListener('click', async () => {
      const errorEl = document.getElementById('confirm-error');
      errorEl.hidden = true;
      const selected = el.querySelector('input[name="confirm-slot"]:checked');
      if (!selected) {
        errorEl.textContent = '請選擇一個時段。';
        errorEl.hidden = false;
        return;
      }
      const payload = { event_id: event.event_id, slot_id: selected.value };
      if (!venueAlreadySet) {
        const venueSel = document.getElementById('confirm-venue');
        if (venueSel.value === '__other__') {
          const t = document.getElementById('confirm-venue-text').value.trim();
          if (!t) {
            errorEl.textContent = '請輸入地點名稱，或改選「尚未決定」。';
            errorEl.hidden = false;
            return;
          }
          payload.venue_free_text = t;
        } else if (venueSel.value) {
          payload.venue_id = venueSel.value;
        }
      }

      const btn = document.getElementById('confirm-btn');
      btn.disabled = true;
      btn.textContent = '處理中…';
      const result = await writeAction('confirm', payload, event.creator_id, creator ? creator.name : event.creator_id);
      if (!result.ok) {
        btn.disabled = false;
        btn.textContent = '定案';
        if (result.error !== 'CANCELLED') {
          errorEl.textContent = `定案失敗：${result.error}`;
          errorEl.hidden = false;
        }
        return;
      }
      await reloadDynamic();
      showToast('已定案！');
      rerender();
    });
  }

  // ---- 報名名單 ----
  function renderSignupSection() {
    const el = document.getElementById('signup-section');
    const signedIds = new Set(signups.map((s) => s.member_id));
    const notSigned = members.filter((m) => !signedIds.has(m.id));

    el.innerHTML = `
      <ul class="signup-list">
        ${signups.length === 0 ? '<li class="card-meta">目前還沒有人報名。</li>' : signups.map((s) => {
          const m = memberById(s.member_id);
          return `
            <li>
              <span>${escapeHtml(m ? m.name : s.member_id)}</span>
              <button type="button" class="btn btn-sm btn-ghost" data-leave="${escapeHtml(s.member_id)}">退出</button>
            </li>
          `;
        }).join('')}
      </ul>
      ${notSigned.length > 0 ? `
        <div class="form-group" style="display:flex; gap:8px; align-items:center;">
          <select class="form-control" id="join-select">
            ${notSigned.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
          <button type="button" id="join-btn" class="btn btn-primary btn-sm">加入</button>
        </div>
      ` : ''}
    `;

    el.querySelectorAll('button[data-leave]').forEach((btn) => {
      btn.addEventListener('click', () => onToggleSignup(btn.dataset.leave, false, btn));
    });
    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        const memberId = document.getElementById('join-select').value;
        onToggleSignup(memberId, true, joinBtn);
      });
    }
  }

  async function onToggleSignup(memberId, join, btn) {
    btn.disabled = true;
    const targetMember = memberById(memberId);
    const result = await writeAction(
      'toggleSignup',
      { event_id: event.event_id, member_id: memberId, join },
      memberId,
      targetMember ? targetMember.name : memberId,
    );
    if (!result.ok) {
      btn.disabled = false;
      if (result.error !== 'CANCELLED') showToast(`操作失敗：${result.error}`);
      return;
    }
    await reloadDynamic();
    rerender();
  }

  // ---- 可玩清單 ----
  function renderPlayableSection() {
    const el = document.getElementById('playable-section');
    const rawList = computePlayableList(event);
    const pinnedIds = new Set(String(event.game_bgg_ids || '').split(',').map((s) => Number(s.trim())).filter(Boolean));

    el.innerHTML = `
      <div class="filter-bar">
        <input type="number" min="1" class="form-control" id="filter-players" placeholder="人數" value="${signups.length || ''}">
        <select class="form-control" id="filter-duration">
          <option value="">時長不限</option>
          <option value="30">≤30 分</option>
          <option value="60">≤60 分</option>
          <option value="90">≤90 分</option>
          <option value="120">≤120 分</option>
        </select>
        <input type="text" class="form-control" id="filter-keyword" placeholder="關鍵字">
      </div>
      <div id="playable-list"></div>
    `;

    const playersInput = document.getElementById('filter-players');
    const durationSelect = document.getElementById('filter-duration');
    const keywordInput = document.getElementById('filter-keyword');

    function renderList() {
      const listEl = document.getElementById('playable-list');
      if (rawList.length === 0) {
        const reason = (!event.venue_id && signups.length === 0)
          ? '還沒有人報名，也還沒選地點。'
          : '目前沒有可玩的遊戲資料。';
        listEl.innerHTML = `<p class="card-meta">${reason}</p>`;
        return;
      }

      const filtered = filterGames(rawList, {
        playerCount: playersInput.value,
        maxDuration: durationSelect.value,
        keyword: keywordInput.value,
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<p class="card-meta">沒有符合篩選條件的遊戲。</p>';
        return;
      }

      const sorted = [...filtered].sort((a, b) => {
        const aPin = pinnedIds.has(a.bggId) ? 0 : 1;
        const bPin = pinnedIds.has(b.bggId) ? 0 : 1;
        return aPin - bPin;
      });

      listEl.innerHTML = `<div class="game-grid">${sorted.map((item) => renderGameCard(item, pinnedIds.has(item.bggId))).join('')}</div>`;
    }

    playersInput.addEventListener('input', renderList);
    durationSelect.addEventListener('change', renderList);
    keywordInput.addEventListener('input', renderList);
    renderList();
  }

  // ---- 取消團 ----
  function renderCancelControl() {
    const el = document.getElementById('cancel-section');
    el.innerHTML = `<button type="button" id="cancel-event-btn" class="btn btn-danger btn-sm">取消這個團</button>`;
    document.getElementById('cancel-event-btn').addEventListener('click', async () => {
      if (!confirm('確定要取消這個團嗎？')) return;
      const btn = document.getElementById('cancel-event-btn');
      btn.disabled = true;
      const result = await writeAction(
        'cancelEvent',
        { event_id: event.event_id },
        event.creator_id,
        creator ? creator.name : event.creator_id,
      );
      if (!result.ok) {
        btn.disabled = false;
        if (result.error !== 'CANCELLED') showToast(`取消失敗：${result.error}`);
        return;
      }
      await reloadDynamic();
      showToast('已取消這個團。');
      rerender();
    });
  }

  function renderGameCard(item, pinned) {
    const meta = item.meta;
    const sourceTags = item.sources.map((s) => `<span class="source-tag ${s.isVenueHolder ? 'pinned-tag' : ''}">${escapeHtml(s.label)}</span>`).join('');
    return `
      <div class="game-card ${pinned ? 'pinned' : ''}">
        ${meta.thumbnail ? `<img src="${escapeHtml(meta.thumbnail)}" alt="">` : '<div style="width:56px;height:56px;flex-shrink:0;"></div>'}
        <div class="game-card-body">
          <div class="game-card-name">${pinned ? '⭐ 已指定・' : ''}${escapeHtml(meta.name_zh || meta.name_en || String(item.bggId))}</div>
          <div class="game-card-meta">${formatPlayers(meta)} ・ ${formatDuration(meta)} ・ 複雜度 ${formatWeight(meta)}</div>
          <div>
            ${sourceTags}
            ${!meta.hasData ? '<span class="source-tag missing-tag">缺少遊戲資料</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }
}
