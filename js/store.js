// bootstrap 資料的載入、快取與合併邏輯。
import { bootstrap } from './api.js';

export const store = {
  loaded: false,
  loadError: null,

  games: {},            // bgg_id(string) -> 遊戲後設資料 (data/games.json)
  staticCollections: [], // data/collections.json，Sufu 的收藏
  members: [],
  venues: [],
  sheetCollections: [],  // Sheets collections 分頁：其他持有者的收藏
  events: [],
  slots: [],
  votes: [],
  signups: [],
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
    const [gamesRes, collectionsRes, boot] = await Promise.all([
      fetch('data/games.json').then((r) => r.json()),
      fetch('data/collections.json').then((r) => r.json()),
      bootstrap(),
    ]);
    store.games = gamesRes || {};
    store.staticCollections = collectionsRes || [];
    store.members = boot.members || [];
    store.venues = boot.venues || [];
    store.sheetCollections = boot.collections || [];
    store.events = boot.events || [];
    store.slots = boot.slots || [];
    store.votes = boot.votes || [];
    store.signups = boot.signups || [];
    store.loaded = true;
  } catch (err) {
    store.loadError = err.message || 'LOAD_FAILED';
    throw err;
  } finally {
    notify();
  }
}

// 寫入動作後呼叫，重新從 Apps Script 抓最新狀態（規模小，簡單優先於局部更新）。
export async function reloadDynamic() {
  const boot = await bootstrap();
  store.members = boot.members || [];
  store.venues = boot.venues || [];
  store.sheetCollections = boot.collections || [];
  store.events = boot.events || [];
  store.slots = boot.slots || [];
  store.votes = boot.votes || [];
  store.signups = boot.signups || [];
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
  return store.venues.filter((v) => isTrue(v.active));
}

export function holderName(holderId) {
  const m = memberById(holderId);
  return m ? m.name : holderId;
}

export function eventById(id) {
  return store.events.find((e) => e.event_id === id) || null;
}

export function slotsOfEvent(eventId) {
  return store.slots.filter((s) => s.event_id === eventId);
}

export function votesOfEvent(eventId) {
  return store.votes.filter((v) => v.event_id === eventId);
}

export function signupsOfEvent(eventId) {
  return store.signups.filter((s) => s.event_id === eventId);
}

// 所有持有者的收藏，合併 repo 靜態資料與 Sheets 資料，統一欄位。
// 目前先不合併 store.staticCollections（Sufu 的預設收藏 data/collections.json），
// 網站上暫時不顯示這批資料；要恢復的話把 fromStatic 加回 concat 即可。
export function allOwnerships() {
  const fromSheet = store.sheetCollections.map((c) => ({
    holder_id: c.holder_id,
    bgg_id: Number(c.bgg_id),
    name_zh: c.name_zh || null,
    note: c.note || null,
  }));
  return fromSheet;
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
    category: null,
    is_expansion: false,
    parent_bgg_id: null,
    hasData: false,
  };
}

function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}
