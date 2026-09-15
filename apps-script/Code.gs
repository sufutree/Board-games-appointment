/**
 * 桌遊揪團站 — Apps Script Web App
 *
 * 部署設定：
 *   - Deploy as: Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * 權限模型：
 *   - members 分頁多一欄 password，每個成員自己的密碼（明碼存放，跟指導書 §11
 *     「密碼不是真的安全」的既有假設一致）。欄位留空代表這個人還沒設密碼，此時
 *     任何密碼（包含空字串）都算通過，方便逐步導入不用一次卡住所有人。
 *   - MASTER_PASSWORD 是只有 Sufu 知道的主密碼，可以做任何人的任何動作。是刻意
 *     固定寫在這裡（不放指令碼屬性），所以修改密碼要直接改這個檔案再重新部署。
 *   - 每個寫入動作都對應一個「本人」member_id：投票/報名退出是操作者自己，
 *     開團/定案/取消/編輯地點與指定遊戲是該團的發起人 creator_id。
 */

const MASTER_PASSWORD = 'sufutree';

const SHEETS = {
  members: 'members',
  venues: 'venues',
  collections: 'collections',
  games: 'games',
  events: 'events',
  slots: 'slots',
  votes: 'votes',
  signups: 'signups',
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const PERIOD_LABELS = { afternoon: '下午', evening: '晚上' };

function doGet(e) {
  resetRequestCache();
  const action = e.parameter && e.parameter.action;
  if (action === 'bootstrap') {
    return jsonOutput(bootstrapCached());
  }
  return jsonOutput({ ok: false, error: 'UNKNOWN_ACTION' });
}

function doPost(e) {
  resetRequestCache();
  let payload;
  try {
    // e.postData.contents 對 text/plain 內容的 UTF-8 多位元組字元（中文）解碼
    // 不可靠，e.postData 本身也沒有可用的方法能明確指定編碼重新解碼一次。改用
    // Base64 傳輸（js/api.js 的 utf8ToBase64()）：body 本身是純 ASCII，不會被
    // 誤判編碼，這裡用 Utilities.newBlob() 包出一個「真的」Blob 才能呼叫
    // getDataAsString('UTF-8') 明確還原。
    const bytes = Utilities.base64Decode(e.postData.contents);
    const raw = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    payload = JSON.parse(raw);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'BAD_REQUEST' });
  }

  try {
    switch (payload.action) {
      case 'createEvent':
        if (!checkAuth(payload.creator_id, payload.secret)) return jsonOutput({ ok: false, error: 'BAD_SECRET' });
        return jsonOutput(createEvent(payload));
      case 'vote':
        if (!checkAuth(payload.member_id, payload.secret)) return jsonOutput({ ok: false, error: 'BAD_SECRET' });
        return jsonOutput(vote(payload));
      case 'confirm': {
        const ev = findEvent(payload.event_id);
        if (!ev) return jsonOutput({ ok: false, error: 'EVENT_NOT_FOUND' });
        if (!checkAuth(ev.creator_id, payload.secret)) return jsonOutput({ ok: false, error: 'BAD_SECRET' });
        return jsonOutput(confirm(payload));
      }
      case 'verifySecret':
        return jsonOutput(checkAuth(payload.member_id, payload.secret) ? { ok: true } : { ok: false, error: 'BAD_SECRET' });
      case 'toggleSignup':
        if (!checkAuth(payload.member_id, payload.secret)) return jsonOutput({ ok: false, error: 'BAD_SECRET' });
        return jsonOutput(toggleSignup(payload));
      case 'updateEventDetails': {
        const ev = findEvent(payload.event_id);
        if (!ev) return jsonOutput({ ok: false, error: 'EVENT_NOT_FOUND' });
        if (!checkAuth(ev.creator_id, payload.secret)) return jsonOutput({ ok: false, error: 'BAD_SECRET' });
        return jsonOutput(updateEventDetails(payload));
      }
      case 'cancelEvent': {
        const ev = findEvent(payload.event_id);
        if (!ev) return jsonOutput({ ok: false, error: 'EVENT_NOT_FOUND' });
        if (!checkAuth(ev.creator_id, payload.secret)) return jsonOutput({ ok: false, error: 'BAD_SECRET' });
        return jsonOutput(cancelEvent(payload));
      }
      default:
        return jsonOutput({ ok: false, error: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message || err) });
  }
}

// 驗證某個寫入動作是否有權以 memberId 的身分執行：
// 主密碼永遠過；否則要對上該成員自己在 members 分頁設定的密碼；
// 該成員密碼欄位留空 = 還沒設密碼，先不擋。
function checkAuth(memberId, providedSecret) {
  if (providedSecret === MASTER_PASSWORD) return true;
  const member = readAll(SHEETS.members).find((m) => m.id === memberId);
  if (!member) return false;
  // 密碼欄如果整欄看起來像數字（例如 1234），Sheets 會存成 number 型別，
  // 這裡統一轉成字串比較，避免 "1234" !== 1234 這種型別不一致的假錯誤。
  const storedPassword = member.password != null ? String(member.password) : '';
  if (storedPassword === '') return true;
  return String(providedSecret) === storedPassword;
}

function findEvent(eventId) {
  return readAll(SHEETS.events).find((row) => row.event_id === eventId) || null;
}

// 絕對不要把密碼透過 bootstrap 傳到瀏覽器（每個訪客都會收到 bootstrap 的內容）。
function stripPassword(member) {
  const { password, ...rest } = member;
  return rest;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// bootstrap 快取：GET ?action=bootstrap 是每個訪客一開頁面就會打的請求，
// 用 CacheService（跨請求、所有訪客共用）快取 20 秒，把「大家幾乎同時開頁面」
// 的重複讀取變成一次 Sheets 讀取＋N 次快取命中。任何寫入動作成功後都會呼叫
// invalidateBootstrapCache() 主動清掉，所以最多延遲 20 秒看到新資料，不會有
// 「快取比使用者自己剛做的操作還舊」的情況。
// ---------------------------------------------------------------------------
const BOOTSTRAP_CACHE_KEY = 'bootstrap_v1';
const BOOTSTRAP_CACHE_TTL_SECONDS = 20;

function bootstrapCached() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(BOOTSTRAP_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (err) {
      // 壞掉的快取內容，當作沒快取繼續往下重新讀取。
    }
  }
  const data = bootstrap();
  try {
    cache.put(BOOTSTRAP_CACHE_KEY, JSON.stringify(data), BOOTSTRAP_CACHE_TTL_SECONDS);
  } catch (err) {
    // CacheService 單筆快取上限 100KB，資料量超過時就不快取，不影響功能。
  }
  return data;
}

function invalidateBootstrapCache() {
  try {
    CacheService.getScriptCache().remove(BOOTSTRAP_CACHE_KEY);
  } catch (err) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// 一次性初始化：在 Apps Script 編輯器選這個函式後按「執行」，自動建立所有
// 分頁與表頭列。可以重複執行，已經存在的分頁不會被清空或刪除，只會確保表頭
// 列是正確的（例如把 venues 的 holder_id 表頭改名成 unlock_member_ids）。
// ---------------------------------------------------------------------------
function setupSheets() {
  const headers = {
    members: ['id', 'name', 'type', 'active', 'password'],
    venues: ['id', 'name', 'unlock_member_ids', 'note', 'active'],
    collections: ['holder_id', 'bgg_id', 'name_zh', 'note'],
    games: ['bgg_id', 'name_zh', 'name_en', 'thumbnail', 'min_players', 'max_players',
      'playing_time', 'min_playtime', 'max_playtime', 'weight', 'year',
      'category', 'is_expansion', 'parent_bgg_id'],
    events: ['event_id', 'created_at', 'creator_id', 'title', 'status', 'venue_id', 'venue_free_text', 'confirmed_slot_id', 'game_bgg_ids', 'note'],
    slots: ['slot_id', 'event_id', 'date', 'period', 'label'],
    votes: ['event_id', 'slot_id', 'member_id', 'ok', 'updated_at'],
    signups: ['event_id', 'member_id', 'joined_at'],
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(headers).forEach((name) => {
    const row = headers[name];
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const range = sheet.getRange(1, 1, 1, row.length);
    range.setValues([row]);
    range.setFontWeight('bold');
  });

  Logger.log('分頁與表頭已建立/更新完成：' + Object.keys(headers).join('、'));
}

// ---------------------------------------------------------------------------
// Sheet 讀寫 helper
// ---------------------------------------------------------------------------

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error(`找不到分頁：${name}`);
  return sheet;
}

// ---------------------------------------------------------------------------
// 單次 doGet/doPost 執行內的讀取快取：同一次請求常常對同一分頁重複呼叫
// readAll（例如 checkAuth 讀一次 members，action 本身可能又讀一次），改成
// 快取結果、寫入後才失效，把「一次請求對同一分頁重讀好幾次」的 Sheets API
// 呼叫收斂成最多一次。resetRequestCache() 由 doGet/doPost 在最開頭呼叫，
// 避免 Apps Script 偶發的執行環境重用讓快取跨請求殘留，造成讀到舊資料。
// ---------------------------------------------------------------------------
let _readCache = {};
let _headerCache = {};

function resetRequestCache() {
  _readCache = {};
  _headerCache = {};
}

function getHeaders(sheetName) {
  if (_headerCache[sheetName]) return _headerCache[sheetName];
  const sheet = getSheet(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  _headerCache[sheetName] = headers;
  return headers;
}

// 讀取整張表為物件陣列，第一列為欄位名。
function readAll(sheetName) {
  if (_readCache[sheetName]) return _readCache[sheetName];
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  let rows;
  if (values.length < 2) {
    rows = [];
  } else {
    const headers = values[0];
    rows = values.slice(1)
      .filter((row) => row.some((cell) => cell !== '' && cell !== null))
      .map((row) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = normalizeCell(row[i]); });
        return obj;
      });
  }
  _readCache[sheetName] = rows;
  return rows;
}

function normalizeCell(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return val;
}

// 依 header 順序把一個物件寫成新的一列。
function appendObject(sheetName, obj) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  const row = headers.map((h) => (obj[h] !== undefined ? obj[h] : ''));
  sheet.appendRow(row);
  delete _readCache[sheetName];
}

// 找出符合條件的資料列（0-based，不含表頭），回傳 -1 表示找不到。
function findRowIndex(sheetName, predicate) {
  const rows = readAll(sheetName);
  return rows.findIndex(predicate);
}

function findAllRowIndexes(sheetName, predicate) {
  const rows = readAll(sheetName);
  const result = [];
  rows.forEach((row, i) => { if (predicate(row)) result.push(i); });
  return result;
}

// 用欄位名更新指定資料列（dataRowIndex 為 0-based，不含表頭）。
function updateRowByIndex(sheetName, dataRowIndex, updates) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheetName);
  const sheetRow = dataRowIndex + 2; // +1 表頭 +1 轉 1-based
  Object.keys(updates).forEach((key) => {
    const col = headers.indexOf(key);
    if (col === -1) return;
    sheet.getRange(sheetRow, col + 1).setValue(updates[key]);
  });
  delete _readCache[sheetName];
}

function deleteRowByIndex(sheetName, dataRowIndex) {
  const sheet = getSheet(sheetName);
  sheet.deleteRow(dataRowIndex + 2);
  delete _readCache[sheetName];
}

function newId() {
  return Utilities.getUuid().slice(0, 8);
}

function nowIso() {
  return new Date().toISOString();
}

function formatSlotLabel(dateStr, period) {
  const d = new Date(`${dateStr}T00:00:00`);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  return `${m}/${day}（${wd}）${PERIOD_LABELS[period] || period}`;
}

function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

// 同一人對同一時段偶爾會留下不只一筆投票紀錄，只採計 updated_at 最新的一筆。
function latestVotesFor(eventId, slotId) {
  const rows = readAll(SHEETS.votes).filter((v) => v.event_id === eventId && v.slot_id === slotId);
  const latestByMember = new Map();
  rows.forEach((v) => {
    const existing = latestByMember.get(v.member_id);
    if (!existing || String(v.updated_at) > String(existing.updated_at)) {
      latestByMember.set(v.member_id, v);
    }
  });
  return [...latestByMember.values()];
}

// ---------------------------------------------------------------------------
// 端點實作
// ---------------------------------------------------------------------------

function bootstrap() {
  return {
    ok: true,
    members: readAll(SHEETS.members).map(stripPassword),
    venues: readAll(SHEETS.venues),
    collections: readAll(SHEETS.collections),
    games: readAll(SHEETS.games),
    events: readAll(SHEETS.events),
    slots: readAll(SHEETS.slots),
    votes: readAll(SHEETS.votes),
    signups: readAll(SHEETS.signups),
  };
}

function createEvent(payload) {
  const eventId = newId();
  const eventRow = {
    event_id: eventId,
    created_at: nowIso(),
    creator_id: payload.creator_id,
    title: payload.title,
    status: 'open',
    venue_id: payload.venue_id || '',
    venue_free_text: payload.venue_free_text || '',
    confirmed_slot_id: '',
    game_bgg_ids: (payload.game_bgg_ids || []).join(','),
    note: payload.note || '',
  };
  appendObject(SHEETS.events, eventRow);

  const slotRows = (payload.slots || []).map((s) => {
    const slotId = newId();
    const row = {
      slot_id: slotId,
      event_id: eventId,
      date: s.date,
      period: s.period,
      label: formatSlotLabel(s.date, s.period),
    };
    appendObject(SHEETS.slots, row);
    return row;
  });

  invalidateBootstrapCache();
  return { ok: true, event_id: eventId, event: eventRow, slots: slotRows };
}

function vote(payload) {
  const { event_id, member_id, votes: voteList } = payload;
  (voteList || []).forEach((v) => {
    const idx = findRowIndex(SHEETS.votes, (row) =>
      row.event_id === event_id && row.slot_id === v.slot_id && row.member_id === member_id);
    if (idx === -1) {
      appendObject(SHEETS.votes, {
        event_id, slot_id: v.slot_id, member_id, ok: v.ok, updated_at: nowIso(),
      });
    } else {
      updateRowByIndex(SHEETS.votes, idx, { ok: v.ok, updated_at: nowIso() });
    }
  });
  invalidateBootstrapCache();
  return { ok: true };
}

function confirm(payload) {
  const { event_id, slot_id } = payload;
  const eventIdx = findRowIndex(SHEETS.events, (row) => row.event_id === event_id);
  if (eventIdx === -1) throw new Error('EVENT_NOT_FOUND');

  const updates = { confirmed_slot_id: slot_id, status: 'confirmed' };
  if (payload.venue_id) {
    updates.venue_id = payload.venue_id;
    updates.venue_free_text = '';
  } else if (payload.venue_free_text) {
    updates.venue_free_text = payload.venue_free_text;
    updates.venue_id = '';
  }
  updateRowByIndex(SHEETS.events, eventIdx, updates);

  // 只採計目前還在名單上的成員、且每人只算最新一次投票（同一人同一時段偶爾
  // 會留下不只一筆紀錄，只認最新那筆，避免把已經改成「不行」的舊票也算進去）。
  const activeMemberIds = new Set(readAll(SHEETS.members).map((m) => m.id));
  const okVoters = latestVotesFor(event_id, slot_id)
    .filter((v) => isTrue(v.ok) && activeMemberIds.has(v.member_id))
    .map((v) => v.member_id);

  const existingSignups = readAll(SHEETS.signups).filter((s) => s.event_id === event_id);
  const existingMemberIds = new Set(existingSignups.map((s) => s.member_id));

  okVoters.forEach((memberId) => {
    if (!existingMemberIds.has(memberId)) {
      appendObject(SHEETS.signups, { event_id, member_id: memberId, joined_at: nowIso() });
      existingMemberIds.add(memberId);
    }
  });

  invalidateBootstrapCache();
  return { ok: true };
}

function toggleSignup(payload) {
  const { event_id, member_id, join } = payload;
  if (join) {
    const exists = findRowIndex(SHEETS.signups, (row) => row.event_id === event_id && row.member_id === member_id);
    if (exists === -1) {
      appendObject(SHEETS.signups, { event_id, member_id, joined_at: nowIso() });
    }
  } else {
    const idxs = findAllRowIndexes(SHEETS.signups, (row) => row.event_id === event_id && row.member_id === member_id);
    idxs.sort((a, b) => b - a).forEach((idx) => deleteRowByIndex(SHEETS.signups, idx));
  }
  invalidateBootstrapCache();
  return { ok: true };
}

// 成團後發起人仍可調整指定遊戲與地點。
function updateEventDetails(payload) {
  const { event_id, game_bgg_ids, venue_id, venue_free_text } = payload;
  const idx = findRowIndex(SHEETS.events, (row) => row.event_id === event_id);
  if (idx === -1) throw new Error('EVENT_NOT_FOUND');
  const updates = { game_bgg_ids: (game_bgg_ids || []).join(',') };
  if (venue_id) {
    updates.venue_id = venue_id;
    updates.venue_free_text = '';
  } else if (venue_free_text) {
    updates.venue_free_text = venue_free_text;
    updates.venue_id = '';
  } else {
    updates.venue_id = '';
    updates.venue_free_text = '';
  }
  updateRowByIndex(SHEETS.events, idx, updates);
  invalidateBootstrapCache();
  return { ok: true };
}

function cancelEvent(payload) {
  const { event_id } = payload;
  const idx = findRowIndex(SHEETS.events, (row) => row.event_id === event_id);
  if (idx === -1) throw new Error('EVENT_NOT_FOUND');
  updateRowByIndex(SHEETS.events, idx, { status: 'cancelled' });
  invalidateBootstrapCache();
  return { ok: true };
}
