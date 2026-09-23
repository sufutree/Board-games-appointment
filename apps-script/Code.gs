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

// --- Firestore POC ---------------------------------------------------------
// 讀取路徑（bootstrap）維持打 Sheets 不變；這裡只是「順便」把每次成功的寫入
// 鏡像一份到 Firestore，讓前端可以選擇改讀 Firestore 來比較體感速度。
// Sheets 永遠是唯一事實來源／唯一驗證密碼的地方，Firestore 鏡像失敗只記 log
// 不會讓原本的寫入動作失敗。
//
// 設定步驟：
//   1. Firebase Console 建立專案、啟用 Firestore（Native mode）。
//   2. 把下面 FIRESTORE_PROJECT_ID 換成該專案的 Project ID。
//   3. 這個 Apps Script 專案的「專案設定」→「Google Cloud Platform (GCP) 專案」
//      改成跟 Firestore 同一個 GCP 專案（Firebase 專案背後就是一個 GCP 專案，
//      專案 ID／專案編號在 Firebase Console 的專案設定可以找到）。
//   4. 編輯器上方選單「檢視」→「顯示 manifest 檔案」，appsscript.json 的
//      oauthScopes 陣列要包含 "https://www.googleapis.com/auth/datastore"
//      （沒有這個 appsscript.json 沒有 oauthScopes 欄位時，Apps Script 會自動
//      偵測所用到的服務所需的範圍，但 UrlFetchApp + getOAuthToken() 這種手動
//      組 token 的用法偵測不到，要手動加這行）。
//   5. 存檔、部署新版本後，在編輯器選 migrateAllToFirestore 執行一次，把現有
//      Sheets 資料匯入 Firestore 當初始快照。之後所有寫入動作會自動鏡像。
const FIRESTORE_PROJECT_ID = 'PASTE_ME';

function firestoreEnabled() {
  return FIRESTORE_PROJECT_ID && FIRESTORE_PROJECT_ID !== 'PASTE_ME';
}

function firestoreDocUrl(collectionName, docId) {
  return 'https://firestore.googleapis.com/v1/projects/' + FIRESTORE_PROJECT_ID +
    '/databases/(default)/documents/' + collectionName + '/' + encodeURIComponent(String(docId));
}

function firestoreSet(collectionName, docId, obj) {
  if (!firestoreEnabled()) return;
  try {
    const res = UrlFetchApp.fetch(firestoreDocUrl(collectionName, docId), {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ fields: toFirestoreFields(obj) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) {
      Logger.log('Firestore 鏡像寫入失敗 (' + collectionName + '/' + docId + '): ' + res.getContentText());
    }
  } catch (err) {
    Logger.log('Firestore 鏡像寫入例外 (' + collectionName + '/' + docId + '): ' + err);
  }
}

function firestoreDelete(collectionName, docId) {
  if (!firestoreEnabled()) return;
  try {
    const res = UrlFetchApp.fetch(firestoreDocUrl(collectionName, docId), {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300 && res.getResponseCode() !== 404) {
      Logger.log('Firestore 鏡像刪除失敗 (' + collectionName + '/' + docId + '): ' + res.getContentText());
    }
  } catch (err) {
    Logger.log('Firestore 鏡像刪除例外 (' + collectionName + '/' + docId + '): ' + err);
  }
}

function toFirestoreFields(obj) {
  const fields = {};
  Object.keys(obj).forEach((key) => {
    const v = obj[key];
    if (v === undefined) return;
    fields[key] = toFirestoreValue(v);
  });
  return fields;
}

function toFirestoreValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

// 一次性：把現有 Sheets 資料整批匯入 Firestore，當作 Firestore 這邊的初始快照。
// 之後手動改 Sheet 上的 members/venues/games/collections（不經過寫入 API 的部分）
// 要記得重跑一次這個函式，Firestore 才會跟著更新；events/slots/votes/signups
// 這些走寫入 API 的資料，寫入當下就會自動鏡像，不用重跑。
function migrateAllToFirestore() {
  if (!firestoreEnabled()) {
    throw new Error('先把 FIRESTORE_PROJECT_ID 換成你的 Firebase 專案 ID，再執行這個函式。');
  }
  readAll(SHEETS.members).map(stripPassword).forEach((m) => firestoreSet('members', m.id, m));
  readAll(SHEETS.venues).forEach((v) => firestoreSet('venues', v.id, v));
  readAll(SHEETS.collections).forEach((c) => firestoreSet('collections', c.holder_id + '_' + c.bgg_id, c));
  readAll(SHEETS.games).forEach((g) => firestoreSet('games', g.bgg_id, g));
  readAll(SHEETS.events).forEach((e) => firestoreSet('events', e.event_id, e));
  readAll(SHEETS.slots).forEach((s) => firestoreSet('slots', s.slot_id, s));
  readAll(SHEETS.votes).forEach((v) => firestoreSet('votes', v.event_id + '_' + v.slot_id + '_' + v.member_id, v));
  readAll(SHEETS.signups).forEach((s) => firestoreSet('signups', s.event_id + '_' + s.member_id, s));
  Logger.log('Firestore 初始匯入完成。');
}
// --- Firestore POC end ------------------------------------------------------

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

// 這些欄位存的是逗號分隔的多個 ID（例如 "332772,385685"）。Google Sheets 對
// 「看起來像數字」的字串會自動轉型成 number（用該地區的千分位規則解讀逗號），
// 於是 "332772,385685" 會被存成 332772385685 這個單一數字，逗號整個消失，
// 讀回來 split(',') 就變成一個查無此遊戲的巨大 ID。寫入這些欄位前一律把儲存
// 格式鎖定成純文字（'@'），避免這個自動轉型。
const TEXT_COLUMNS = {
  events: ['game_bgg_ids'],
  venues: ['unlock_member_ids'],
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
  const member = readAll(SHEETS.members).find((m) => idEq(m.id, memberId));
  if (!member) return false;
  // 密碼欄如果整欄看起來像數字（例如 1234），Sheets 會存成 number 型別，
  // 這裡統一轉成字串比較，避免 "1234" !== 1234 這種型別不一致的假錯誤。
  const storedPassword = member.password != null ? String(member.password) : '';
  if (storedPassword === '') return true;
  return String(providedSecret) === storedPassword;
}

function findEvent(eventId) {
  return readAll(SHEETS.events).find((row) => idEq(row.event_id, eventId)) || null;
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
  const rowIndex = sheet.getLastRow() + 1;
  const range = sheet.getRange(rowIndex, 1, 1, row.length);
  (TEXT_COLUMNS[sheetName] || []).forEach((colName) => {
    const col = headers.indexOf(colName);
    if (col !== -1) range.getCell(1, col + 1).setNumberFormat('@');
  });
  range.setValues([row]);
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
  const textCols = TEXT_COLUMNS[sheetName] || [];
  Object.keys(updates).forEach((key) => {
    const col = headers.indexOf(key);
    if (col === -1) return;
    const cell = sheet.getRange(sheetRow, col + 1);
    if (textCols.includes(key)) cell.setNumberFormat('@');
    cell.setValue(updates[key]);
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

// newId() 產生的 id（event_id／slot_id）是 UUID 前 8 碼的英數字串，剛好幾個字
// 都是數字的機率不低（約 2%），這種「看起來像數字」的字串寫進 Google Sheets
// 會被自動轉型成 number（跟 checkAuth 那裡處理密碼欄位是同一種 Sheets 行為）。
// 但從前端 payload 來的永遠是 JS 字串，用 === 比對字串跟數字一律是 false，
// 導致 findRowIndex 永遠找不到既有列、每次都新增一筆——這正是「同一人同一
// 時段投票會累積很多筆」的根本原因。所有 id 比對一律用 idEq()，不要用 ===。
function idEq(a, b) {
  return String(a) === String(b);
}

// 同一人對同一時段偶爾會留下不只一筆投票紀錄，只採計 updated_at 最新的一筆。
function latestVotesFor(eventId, slotId) {
  const rows = readAll(SHEETS.votes).filter((v) => idEq(v.event_id, eventId) && idEq(v.slot_id, slotId));
  const latestByMember = new Map();
  rows.forEach((v) => {
    const key = String(v.member_id);
    const existing = latestByMember.get(key);
    if (!existing || String(v.updated_at) > String(existing.updated_at)) {
      latestByMember.set(key, v);
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
  firestoreSet('events', eventId, eventRow);

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
    firestoreSet('slots', slotId, row);
    return row;
  });

  invalidateBootstrapCache();
  return { ok: true, event_id: eventId, event: eventRow, slots: slotRows };
}

function vote(payload) {
  const { event_id, member_id, votes: voteList } = payload;
  (voteList || []).forEach((v) => {
    const idx = findRowIndex(SHEETS.votes, (row) =>
      idEq(row.event_id, event_id) && idEq(row.slot_id, v.slot_id) && idEq(row.member_id, member_id));
    const voteRow = { event_id, slot_id: v.slot_id, member_id, ok: v.ok, updated_at: nowIso() };
    if (idx === -1) {
      appendObject(SHEETS.votes, voteRow);
    } else {
      updateRowByIndex(SHEETS.votes, idx, { ok: voteRow.ok, updated_at: voteRow.updated_at });
    }
    // Firestore 文件 id 直接用三個欄位組合，同一人同一時段的票永遠覆寫同一份
    // 文件，天生就不會有 Sheets 那邊曾經發生過的重複列問題。
    firestoreSet('votes', event_id + '_' + v.slot_id + '_' + member_id, voteRow);
  });
  invalidateBootstrapCache();
  return { ok: true };
}

function confirm(payload) {
  const { event_id, slot_id } = payload;
  const eventIdx = findRowIndex(SHEETS.events, (row) => idEq(row.event_id, event_id));
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
  mirrorEventById(event_id);

  // 只採計目前還在名單上的成員、且每人只算最新一次投票（同一人同一時段偶爾
  // 會留下不只一筆紀錄，只認最新那筆，避免把已經改成「不行」的舊票也算進去）。
  const activeMemberIds = new Set(readAll(SHEETS.members).map((m) => String(m.id)));
  const okVoters = latestVotesFor(event_id, slot_id)
    .filter((v) => isTrue(v.ok) && activeMemberIds.has(String(v.member_id)))
    .map((v) => v.member_id);

  const existingSignups = readAll(SHEETS.signups).filter((s) => idEq(s.event_id, event_id));
  const existingMemberIds = new Set(existingSignups.map((s) => String(s.member_id)));

  okVoters.forEach((memberId) => {
    if (!existingMemberIds.has(String(memberId))) {
      const signupRow = { event_id, member_id: memberId, joined_at: nowIso() };
      appendObject(SHEETS.signups, signupRow);
      firestoreSet('signups', event_id + '_' + memberId, signupRow);
      existingMemberIds.add(String(memberId));
    }
  });

  invalidateBootstrapCache();
  return { ok: true };
}

function toggleSignup(payload) {
  const { event_id, member_id, join } = payload;
  if (join) {
    const exists = findRowIndex(SHEETS.signups, (row) => idEq(row.event_id, event_id) && idEq(row.member_id, member_id));
    if (exists === -1) {
      const signupRow = { event_id, member_id, joined_at: nowIso() };
      appendObject(SHEETS.signups, signupRow);
      firestoreSet('signups', event_id + '_' + member_id, signupRow);
    }
  } else {
    const idxs = findAllRowIndexes(SHEETS.signups, (row) => idEq(row.event_id, event_id) && idEq(row.member_id, member_id));
    idxs.sort((a, b) => b - a).forEach((idx) => deleteRowByIndex(SHEETS.signups, idx));
    firestoreDelete('signups', event_id + '_' + member_id);
  }
  invalidateBootstrapCache();
  return { ok: true };
}

// 成團後發起人仍可調整指定遊戲與地點。
function updateEventDetails(payload) {
  const { event_id, game_bgg_ids, venue_id, venue_free_text } = payload;
  const idx = findRowIndex(SHEETS.events, (row) => idEq(row.event_id, event_id));
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
  mirrorEventById(event_id);
  invalidateBootstrapCache();
  return { ok: true };
}

function cancelEvent(payload) {
  const { event_id } = payload;
  const idx = findRowIndex(SHEETS.events, (row) => idEq(row.event_id, event_id));
  if (idx === -1) throw new Error('EVENT_NOT_FOUND');
  updateRowByIndex(SHEETS.events, idx, { status: 'cancelled' });
  mirrorEventById(event_id);
  invalidateBootstrapCache();
  return { ok: true };
}

// updateRowByIndex 只改欄位，不會回傳整列；要鏡像完整最新狀態到 Firestore，
// 便宜行事直接重讀一次該列（readAll 有 request 內快取，寫入當下已經失效重讀）。
function mirrorEventById(eventId) {
  const row = readAll(SHEETS.events).find((r) => idEq(r.event_id, eventId));
  if (row) firestoreSet('events', eventId, row);
}
