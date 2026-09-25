// bootstrap 資料的載入、快取與合併邏輯。資料庫已經全面搬到 Firestore，
// Apps Script／Google Sheets 不再是任何讀寫的路徑。
import { firestoreBootstrap } from './firebase.js';

export const store = {
  loaded: false,
  loadError: null,

  games: {},            // bgg_id(string) -> 遊戲後設資料
  members: [],
  venues: [],
  sheetCollections: [],  // 所有持有者（成員或場地）的收藏
  events: [],
  slots: [],
  votes: [],
  signups: [],
  tags: [],             // 可複選的遊戲標籤清單，見 admin 後台的標籤管理
};

let listeners = [];
export function onChange(fn) {
  listeners.push(fn);
}
function notify() {
  listeners.forEach((fn) => fn());
}

export async function loadAll() {
  store.loadError = null;
  try {
    const boot = await firestoreBootstrap();
    store.games = gamesArrayToMap(boot.games || []);
    store.members = boot.members || [];
    store.venues = boot.venues || [];
    store.sheetCollections = boot.collections || [];
    store.events = boot.events || [];
    store.slots = boot.slots || [];
    store.votes = boot.votes || [];
    store.signups = boot.signups || [];
    store.tags = boot.tags || [];
    store.loaded = true;
  } catch (err) {
    store.loadError = err.message || 'LOAD_FAILED';
    throw err;
  } finally {
    notify();
  }
}

// 寫入動作後呼叫，重新從 Firestore 抓最新狀態（規模小，簡單優先於局部更新）。
export async function reloadDynamic() {
  const boot = await firestoreBootstrap();
  store.games = gamesArrayToMap(boot.games || []);
  store.members = boot.members || [];
  store.venues = boot.venues || [];
  store.sheetCollections = boot.collections || [];
  store.events = boot.events || [];
  store.slots = boot.slots || [];
  store.votes = boot.votes || [];
  store.signups = boot.signups || [];
  store.tags = boot.tags || [];
  notify();
}

// ---- 基本查詢 helper ----

export function activeMembers() {
  return store.members.filter((m) => m.type === 'person' && isTrue(m.active));
}

// 所有持有者（person + group），用於篩選「持有者」下拉選單。
export function activeHolders() {
  return store.members.filter((m) => isTrue(m.active));
}

export function memberById(id) {
  return store.members.find((m) => m.id === id) || null;
}

export function venueById(id) {
  return store.venues.find((v) => v.id === id) || null;
}

export function activeVenues() {
  return store.venues.filter((v) => v.id && isTrue(v.active));
}

// 持有者可能是人／群體（members），也可能是場地自己（venues）。
export function holderName(holderId) {
  const m = memberById(holderId);
  if (m) return m.name;
  const v = venueById(holderId);
  if (v) return v.name;
  return holderId;
}

export function eventById(id) {
  return store.events.find((e) => e.event_id === id) || null;
}

const PERIOD_ORDER = { afternoon: 0, evening: 1 };

// 依日期＋時段由近到遠排序，不依賴發起人建立候選時段的先後順序。
export function slotsOfEvent(eventId) {
  return store.slots
    .filter((s) => s.event_id === eventId)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const pa = PERIOD_ORDER[a.period] ?? 99;
      const pb = PERIOD_ORDER[b.period] ?? 99;
      return pa - pb;
    });
}

export function votesOfEvent(eventId) {
  return store.votes.filter((v) => v.event_id === eventId);
}

export function signupsOfEvent(eventId) {
  return store.signups.filter((s) => s.event_id === eventId);
}

// 所有持有者的收藏，來自 Sheets collections 分頁（含 Sufu，手動維護）。
export function allOwnerships() {
  return store.sheetCollections
    .filter((c) => c.holder_id && c.bgg_id !== '' && c.bgg_id != null)
    .map((c) => ({
      holder_id: c.holder_id,
      bgg_id: Number(c.bgg_id),
      name_zh: c.name_zh || null,
      note: c.note || null,
    }))
    .filter((c) => Number.isFinite(c.bgg_id));
}

// Sheets games 分頁讀出來的是字串陣列，轉成 bgg_id(string) -> 物件的 map，
// 並把數字/布林欄位轉成正確型別（Sheet 裡的空白會是 ''，統一轉成 null）。
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v) {
  return v === '' || v === null || v === undefined ? null : String(v);
}
function normalizeGameRow(row) {
  return {
    bgg_id: Number(row.bgg_id),
    name_zh: strOrNull(row.name_zh),
    name_en: strOrNull(row.name_en),
    thumbnail: strOrNull(row.thumbnail),
    min_players: numOrNull(row.min_players),
    max_players: numOrNull(row.max_players),
    playing_time: numOrNull(row.playing_time),
    min_playtime: numOrNull(row.min_playtime),
    max_playtime: numOrNull(row.max_playtime),
    weight: numOrNull(row.weight),
    year: numOrNull(row.year),
    tags: Array.isArray(row.tags) ? row.tags : [],
    is_expansion: isTrue(row.is_expansion),
    parent_bgg_id: numOrNull(row.parent_bgg_id),
  };
}
function gamesArrayToMap(rows) {
  const map = {};
  for (const row of rows) {
    if (!row.bgg_id) continue;
    map[String(row.bgg_id)] = normalizeGameRow(row);
  }
  return map;
}

// 取得遊戲後設資料；查無資料時回傳帶 hasData:false 的替代物件。
export function getGameMeta(bggId, fallbackNameZh) {
  const key = String(bggId);
  const g = store.games[key];
  if (g) return { ...g, hasData: true };
  return {
    bgg_id: Number(bggId),
    name_zh: fallbackNameZh || `未知遊戲 (${bggId})`,
    name_en: null,
    thumbnail: null,
    min_players: null,
    max_players: null,
    playing_time: null,
    min_playtime: null,
    max_playtime: null,
    weight: null,
    year: null,
    tags: [],
    is_expansion: false,
    parent_bgg_id: null,
    hasData: false,
  };
}

function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

// ---- 標籤 helper（取代原本單選的 category） ----

export function activeTags() {
  return store.tags
    .filter((t) => isTrue(t.active))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function tagLabel(code) {
  const t = store.tags.find((tag) => tag.code === code);
  return t ? t.label : code;
}

// 依 group_code 分組，picker／篩選介面用，組內照 order 排序（相近的標籤
// 排在一起是使用者指定的順序，不是字母或建立時間）。沒有對應群組的標籤
// 歸進「其他」。activeTags() 已經排過序，Map 的插入順序讓群組本身也會
// 照第一個成員的 order 出現（機制在前、主題在後）。
export function tagGroups() {
  const groups = new Map();
  activeTags().forEach((t) => {
    const key = t.group_code || 'other';
    if (!groups.has(key)) groups.set(key, { code: key, label: t.group_label || '其他', items: [] });
    groups.get(key).items.push(t);
  });
  return [...groups.values()];
}
