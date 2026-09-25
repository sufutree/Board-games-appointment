// 可玩清單計算、篩選、已結束判定、分類代碼表。
import { store, allOwnerships, getGameMeta, holderName, venueById, signupsOfEvent } from './store.js';

// §3.3 可玩清單 = (所有已報名玩家各自的收藏) ∪ (該場地自己的收藏)
export function computePlayableList(event) {
  const holderIds = new Set();
  let venueHolderId = null;

  if (event.venue_id) {
    venueHolderId = event.venue_id;
    holderIds.add(event.venue_id);
  }

  const signups = signupsOfEvent(event.event_id);
  for (const s of signups) {
    holderIds.add(s.member_id);
  }

  if (holderIds.size === 0) return [];

  const ownerships = allOwnerships().filter((o) => holderIds.has(o.holder_id));

  const map = new Map();
  for (const o of ownerships) {
    if (!map.has(o.bgg_id)) {
      map.set(o.bgg_id, { bggId: o.bgg_id, nameZhFallback: o.name_zh, sources: [] });
    }
    const entry = map.get(o.bgg_id);
    if (o.name_zh && !entry.nameZhFallback) entry.nameZhFallback = o.name_zh;
    const isVenueHolder = venueHolderId != null && o.holder_id === venueHolderId;
    const label = isVenueHolder ? '場地現有' : `${holderName(o.holder_id)} 可帶來`;
    if (!entry.sources.some((s) => s.holderId === o.holder_id)) {
      entry.sources.push({ holderId: o.holder_id, label, isVenueHolder });
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      meta: getGameMeta(entry.bggId, entry.nameZhFallback),
    }))
    .sort((a, b) => (a.meta.name_zh || '').localeCompare(b.meta.name_zh || '', 'zh-Hant'));
}

// 篩選：查無 BGG 資料的遊戲不受人數／時長／複雜度篩選排除。
export function filterGames(list, { playerCount, maxDuration, weightMin, weightMax, keyword, tag, holderId } = {}) {
  const kw = (keyword || '').trim().toLowerCase();
  return list.filter((item) => {
    const meta = item.meta;

    if (kw) {
      const hay = `${meta.name_zh || ''} ${meta.name_en || ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }

    if (tag && !(meta.tags || []).includes(tag)) return false;

    if (holderId && !item.sources.some((s) => s.holderId === holderId)) return false;

    if (!meta.hasData) return true;

    if (playerCount) {
      const pc = Number(playerCount);
      if (meta.min_players != null && pc < meta.min_players) return false;
      if (meta.max_players != null && pc > meta.max_players) return false;
    }

    if (maxDuration) {
      const maxD = Number(maxDuration);
      const duration = meta.playing_time ?? meta.max_playtime;
      if (duration != null && duration > maxD) return false;
    }

    if (weightMin != null && meta.weight != null && meta.weight < weightMin) return false;
    if (weightMax != null && meta.weight != null && meta.weight > weightMax) return false;

    return true;
  });
}

// 遊戲庫用：games.json 與 Sheets collections 的聯集，附上每款目前的持有者。
export function allGamesWithHolders() {
  const ownerships = allOwnerships();
  const ownershipsByBgg = new Map();
  for (const o of ownerships) {
    if (!ownershipsByBgg.has(o.bgg_id)) ownershipsByBgg.set(o.bgg_id, []);
    ownershipsByBgg.get(o.bgg_id).push(o);
  }

  const allBggIds = new Set([
    ...Object.keys(store.games).map(Number),
    ...ownershipsByBgg.keys(),
  ]);

  const result = [];
  for (const bggId of allBggIds) {
    const owns = ownershipsByBgg.get(bggId) || [];
    const withNameZh = owns.find((o) => o.name_zh);
    const nameZhFallback = withNameZh ? withNameZh.name_zh : null;
    const sources = [];
    const seen = new Set();
    for (const o of owns) {
      if (seen.has(o.holder_id)) continue;
      seen.add(o.holder_id);
      sources.push({ holderId: o.holder_id, label: holderName(o.holder_id) });
    }
    result.push({ bggId, sources, meta: getGameMeta(bggId, nameZhFallback) });
  }

  return result.sort((a, b) => (a.meta.name_zh || '').localeCompare(b.meta.name_zh || '', 'zh-Hant'));
}

// 反查用：某款遊戲目前在哪些持有者手上（人／群體，或是場地自己）。
export function ownersOf(bggId) {
  const id = Number(bggId);
  const ownerships = allOwnerships().filter((o) => o.bgg_id === id);
  const holderIds = [...new Set(ownerships.map((o) => o.holder_id))];
  return holderIds.map((holderId) => ({
    holderId,
    name: holderName(holderId),
    isVenue: !!venueById(holderId),
  }));
}

// 場地「誰能開」名單：unlock_member_ids 逗號分隔，空白＝誰都能選。
// 只是前端提醒用，不做任何攔截。
export function venueUnlockIds(venue) {
  return String(venue.unlock_member_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function venueQualifies(venue, participantIds) {
  const list = venueUnlockIds(venue);
  if (list.length === 0) return true;
  return participantIds.some((id) => list.includes(id));
}

// §6.5 已結束判定
export function isEventEnded(event, slots) {
  if (event.status !== 'confirmed') return false;
  const slot = slots.find((s) => s.slot_id === event.confirmed_slot_id);
  if (!slot || !slot.date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const slotDate = new Date(`${slot.date}T00:00:00`);
  return slotDate < today;
}

export const PERIOD_LABELS = {
  afternoon: '下午',
  evening: '晚上',
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 產生候選時段顯示用文字，例：「10/4（六）下午」
export function formatSlotLabel(dateStr, period) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return `${dateStr} ${PERIOD_LABELS[period] || period}`;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  return `${m}/${day}（${wd}）${PERIOD_LABELS[period] || period}`;
}

// 分類已經改成可複選的標籤，活的清單存在 Firestore 的 tags 集合（見
// admin 後台的標籤管理），不再是這裡的寫死常數。要拿標籤清單／分組請用
// store.js 的 activeTags() / tagGroups() / tagLabel()。

export function formatPlayers(meta) {
  if (meta.min_players == null && meta.max_players == null) return '－';
  if (meta.min_players === meta.max_players) return `${meta.min_players} 人`;
  return `${meta.min_players ?? '?'}–${meta.max_players ?? '?'} 人`;
}

export function formatDuration(meta) {
  const t = meta.playing_time ?? meta.max_playtime;
  if (t == null) return '－';
  return `${t} 分鐘`;
}

export function formatWeight(meta) {
  if (meta.weight == null) return '－';
  return meta.weight.toFixed(1);
}
