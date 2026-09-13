import { store, activeMembers, slotsOfEvent, votesOfEvent, signupsOfEvent, venueById, memberById, getGameMeta } from '../store.js';
import { isEventEnded } from '../rules.js';
import { escapeHtml } from '../app.js';

function venueLabel(event) {
  if (event.venue_id) {
    const v = venueById(event.venue_id);
    return v ? v.name : '（場地已刪除）';
  }
  if (event.venue_free_text) return event.venue_free_text;
  return '地點未定';
}

function gamesLabel(event) {
  const ids = (event.game_bgg_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return '';
  return ids.map((id) => getGameMeta(id).name_zh).join('、');
}

function renderOpenCard(event) {
  const slots = slotsOfEvent(event.event_id);
  const votes = votesOfEvent(event.event_id);
  const totalMembers = activeMembers().length;
  const votedMemberIds = new Set(votes.map((v) => v.member_id));
  const creator = memberById(event.creator_id);

  const slotPills = slots.map((s) => {
    const count = votes.filter((v) => v.slot_id === s.slot_id && isTrue(v.ok)).length;
    return `<span class="slot-pill">${escapeHtml(s.label)}・${count} 人可以</span>`;
  }).join('');

  return `
    <a class="card-link" href="#/event/${event.event_id}">
      <div class="card">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(event.title)}</span>
          <span class="badge badge-open">投票中</span>
        </div>
        <div class="card-meta">發起人：${escapeHtml(creator ? creator.name : '未知')} ・ 地點：${escapeHtml(venueLabel(event))}</div>
        <div class="card-meta">已投票 ${votedMemberIds.size} ／ ${totalMembers} 人</div>
        <div class="slot-list">${slotPills}</div>
      </div>
    </a>
  `;
}

function renderConfirmedCard(event) {
  const slots = slotsOfEvent(event.event_id);
  const slot = slots.find((s) => s.slot_id === event.confirmed_slot_id);
  const signups = signupsOfEvent(event.event_id);
  const games = gamesLabel(event);

  return `
    <a class="card-link" href="#/event/${event.event_id}">
      <div class="card">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(event.title)}</span>
          <span class="badge badge-confirmed">已定案</span>
        </div>
        <div class="card-meta">時間：${escapeHtml(slot ? slot.label : '未定')}</div>
        <div class="card-meta">地點：${escapeHtml(venueLabel(event))}</div>
        <div class="card-meta">報名人數：${signups.length} 人</div>
        ${games ? `<div class="card-meta">指定遊戲：${escapeHtml(games)}</div>` : ''}
      </div>
    </a>
  `;
}

function renderCancelledCard(event) {
  return `
    <a class="card-link" href="#/event/${event.event_id}">
      <div class="card">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(event.title)}</span>
          <span class="badge badge-cancelled">已取消</span>
        </div>
      </div>
    </a>
  `;
}

function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

export async function renderHome(appEl) {
  const events = store.events;
  const openEvents = events.filter((e) => e.status === 'open');
  const confirmedEvents = events.filter((e) => e.status === 'confirmed' && !isEventEnded(e, store.slots));
  const endedEvents = events.filter((e) => e.status === 'confirmed' && isEventEnded(e, store.slots));
  const cancelledEvents = events.filter((e) => e.status === 'cancelled');

  const hasAnything = openEvents.length || confirmedEvents.length || endedEvents.length || cancelledEvents.length;

  if (!hasAnything) {
    appEl.innerHTML = `
      <div class="empty-state">
        <p>目前沒有進行中的團。</p>
        <a class="btn btn-primary" href="#/new">開新團</a>
      </div>
    `;
    return;
  }

  appEl.innerHTML = `
    <h1 class="page-title">桌遊揪團</h1>

    <div class="section-title">投票中</div>
    ${openEvents.length ? openEvents.map(renderOpenCard).join('') : '<p class="card-meta">目前沒有投票中的團。</p>'}

    <div class="section-title">已定案</div>
    ${confirmedEvents.length ? confirmedEvents.map(renderConfirmedCard).join('') : '<p class="card-meta">目前沒有已定案的團。</p>'}

    ${cancelledEvents.length ? `
      <details class="collapse-section">
        <summary>已取消（${cancelledEvents.length}）</summary>
        ${cancelledEvents.map(renderCancelledCard).join('')}
      </details>
    ` : ''}

    ${endedEvents.length ? `
      <details class="collapse-section">
        <summary>已結束（${endedEvents.length}）</summary>
        ${endedEvents.map(renderConfirmedCard).join('')}
      </details>
    ` : ''}
  `;
}
