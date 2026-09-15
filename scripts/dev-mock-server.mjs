// 開發用的本機模擬後端 —— 只在本機預覽用，不是正式的 Apps Script，不進部署。
//
// 用同一套 GET/POST 合約（見 apps-script/Code.gs）模擬 Google Sheets 的行為，
// 讓還沒有真正部署 Apps Script 之前，就能在瀏覽器裡完整跑一次「開團→投票→定案→報名」流程。
//
// 用法：
//   node scripts/dev-mock-server.mjs
// 然後在瀏覽器打開 index.html 時加上 ?api=http://localhost:8788 這個參數，
// 例如 http://localhost:8791/?api=http://localhost:8788
//
// 權限模型跟 apps-script/Code.gs 一致：每個成員自己的密碼（members.password，留空代表
// 還沒設密碼、先不擋），加上主密碼 MASTER_PASSWORD 可以做任何人的任何動作。
// 種子資料裡故意讓「測試-阿明」設了密碼（1234），其他人留空，方便同時示範兩種情境。
// 資料存在記憶體＋scripts/.dev-mock-data.json，重啟伺服器不會遺失，想重置就直接刪掉那個檔案。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '.dev-mock-data.json');
const PORT = 8788;
const MASTER_PASSWORD = 'sufutree';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const PERIOD_LABELS = { afternoon: '下午', evening: '晚上' };

function formatSlotLabel(dateStr, period) {
  const d = new Date(`${dateStr}T00:00:00`);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  return `${m}/${day}（${wd}）${PERIOD_LABELS[period] || period}`;
}

function newId() {
  return crypto.randomUUID().slice(0, 8);
}

function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

function seedData() {
  return {
    members: [
      { id: 'test_sufu', name: '測試-Sufu', type: 'person', active: true, password: '' },
      { id: 'test_ming', name: '測試-阿明', type: 'person', active: true, password: '1234' },
      { id: 'test_hua', name: '測試-阿華', type: 'person', active: true, password: '' },
      { id: 'test_club', name: '測試-桌遊社', type: 'group', active: true, password: '' },
    ],
    venues: [
      { id: 'test_sufu_home', name: '測試-Sufu家', holder_id: 'test_sufu', note: '有大桌', active: true },
      { id: 'test_club_room', name: '測試-社團教室', holder_id: 'test_club', note: '', active: true },
    ],
    collections: [
      { holder_id: 'test_ming', bgg_id: 68448, name_zh: '', note: '' },
      { holder_id: 'test_ming', bgg_id: 175640, name_zh: '', note: '' },
      { holder_id: 'test_hua', bgg_id: 217861, name_zh: '', note: '' },
      { holder_id: 'test_club', bgg_id: 224517, name_zh: '', note: '' },
      { holder_id: 'test_club', bgg_id: 999999999, name_zh: '一款查無資料的測試遊戲', note: '故意示範缺資料的狀況' },
    ],
    events: [],
    slots: [],
    votes: [],
    signups: [],
  };
}

function loadStore() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch {
      console.warn('[dev-mock-server] 資料檔損毀，改用預設種子資料。');
    }
  }
  return seedData();
}

let store = loadStore();

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function stripPassword(member) {
  const { password, ...rest } = member;
  return rest;
}

function bootstrap() {
  return {
    ok: true,
    members: store.members.map(stripPassword),
    venues: store.venues,
    collections: store.collections,
    events: store.events,
    slots: store.slots,
    votes: store.votes,
    signups: store.signups,
  };
}

// 跟 apps-script/Code.gs 的 checkAuth 邏輯一致。
function checkAuth(memberId, providedSecret) {
  if (providedSecret === MASTER_PASSWORD) return true;
  const member = store.members.find((m) => m.id === memberId);
  if (!member) return false;
  const storedPassword = member.password || '';
  if (storedPassword === '') return true;
  return providedSecret === storedPassword;
}

function findEvent(eventId) {
  return store.events.find((e) => e.event_id === eventId) || null;
}

function createEvent(payload) {
  const eventId = newId();
  const event = {
    event_id: eventId,
    created_at: new Date().toISOString(),
    creator_id: payload.creator_id,
    title: payload.title,
    status: 'open',
    venue_id: payload.venue_id || '',
    venue_free_text: payload.venue_free_text || '',
    confirmed_slot_id: '',
    game_bgg_ids: (payload.game_bgg_ids || []).join(','),
    note: payload.note || '',
  };
  store.events.push(event);

  const slots = (payload.slots || []).map((s) => {
    const slot = {
      slot_id: newId(),
      event_id: eventId,
      date: s.date,
      period: s.period,
      label: formatSlotLabel(s.date, s.period),
    };
    store.slots.push(slot);
    return slot;
  });

  return { ok: true, event_id: eventId, event, slots };
}

function vote(payload) {
  const { event_id, member_id, votes: voteList } = payload;
  (voteList || []).forEach((v) => {
    const existing = store.votes.find((row) => row.event_id === event_id && row.slot_id === v.slot_id && row.member_id === member_id);
    if (existing) {
      existing.ok = v.ok;
      existing.updated_at = new Date().toISOString();
    } else {
      store.votes.push({ event_id, slot_id: v.slot_id, member_id, ok: v.ok, updated_at: new Date().toISOString() });
    }
  });
  return { ok: true };
}

function confirm(payload) {
  const { event_id, slot_id } = payload;
  const event = store.events.find((e) => e.event_id === event_id);
  if (!event) throw new Error('EVENT_NOT_FOUND');

  event.confirmed_slot_id = slot_id;
  event.status = 'confirmed';
  if (payload.venue_id) {
    event.venue_id = payload.venue_id;
    event.venue_free_text = '';
  } else if (payload.venue_free_text) {
    event.venue_free_text = payload.venue_free_text;
    event.venue_id = '';
  }

  const okVoters = store.votes
    .filter((v) => v.event_id === event_id && v.slot_id === slot_id && isTrue(v.ok))
    .map((v) => v.member_id);

  const existingIds = new Set(store.signups.filter((s) => s.event_id === event_id).map((s) => s.member_id));
  okVoters.forEach((memberId) => {
    if (!existingIds.has(memberId)) {
      store.signups.push({ event_id, member_id: memberId, joined_at: new Date().toISOString() });
      existingIds.add(memberId);
    }
  });

  return { ok: true };
}

function toggleSignup(payload) {
  const { event_id, member_id, join } = payload;
  if (join) {
    const exists = store.signups.some((s) => s.event_id === event_id && s.member_id === member_id);
    if (!exists) store.signups.push({ event_id, member_id, joined_at: new Date().toISOString() });
  } else {
    store.signups = store.signups.filter((s) => !(s.event_id === event_id && s.member_id === member_id));
  }
  return { ok: true };
}

function updateGames(payload) {
  const event = store.events.find((e) => e.event_id === payload.event_id);
  if (!event) throw new Error('EVENT_NOT_FOUND');
  event.game_bgg_ids = (payload.game_bgg_ids || []).join(',');
  return { ok: true };
}

function cancelEvent(payload) {
  const event = store.events.find((e) => e.event_id === payload.event_id);
  if (!event) throw new Error('EVENT_NOT_FOUND');
  event.status = 'cancelled';
  return { ok: true };
}

// 每個 action 對應「本人」member_id 要怎麼從 payload 找出來。
const REQUIRED_MEMBER = {
  createEvent: (p) => p.creator_id,
  vote: (p) => p.member_id,
  confirm: (p) => { const ev = findEvent(p.event_id); return ev ? ev.creator_id : null; },
  toggleSignup: (p) => p.member_id,
  updateGames: (p) => { const ev = findEvent(p.event_id); return ev ? ev.creator_id : null; },
  cancelEvent: (p) => { const ev = findEvent(p.event_id); return ev ? ev.creator_id : null; },
};

const ACTIONS = { createEvent, vote, confirm, toggleSignup, updateGames, cancelEvent };

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.searchParams.get('action') === 'bootstrap') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bootstrap()));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let payload;
      try {
        // js/api.js 的 postOnce() 一律把 body 用 Base64 編碼送出（繞過正式 Apps
        // Script 對 text/plain 中文解碼不可靠的問題），這裡跟 apps-script/Code.gs
        // 的 doPost 一樣要先解 Base64 才能 JSON.parse，不然真正的前端請求一律
        // BAD_REQUEST。
        const raw = Buffer.from(body, 'base64').toString('utf-8');
        payload = JSON.parse(raw);
      } catch {
        res.end(JSON.stringify({ ok: false, error: 'BAD_REQUEST' }));
        return;
      }
      if (payload.action === 'verifySecret') {
        res.end(JSON.stringify(checkAuth(payload.member_id, payload.secret) ? { ok: true } : { ok: false, error: 'BAD_SECRET' }));
        return;
      }

      const action = ACTIONS[payload.action];
      if (!action) {
        res.end(JSON.stringify({ ok: false, error: 'UNKNOWN_ACTION' }));
        return;
      }
      const requiredMemberId = REQUIRED_MEMBER[payload.action](payload);
      if (requiredMemberId == null) {
        res.end(JSON.stringify({ ok: false, error: 'EVENT_NOT_FOUND' }));
        return;
      }
      if (!checkAuth(requiredMemberId, payload.secret)) {
        res.end(JSON.stringify({ ok: false, error: 'BAD_SECRET' }));
        return;
      }
      try {
        const result = action(payload);
        save();
        res.end(JSON.stringify(result));
      } catch (err) {
        res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
});

save();
server.listen(PORT, () => {
  console.log(`[dev-mock-server] 監聽 http://localhost:${PORT}`);
  console.log(`[dev-mock-server] 主密碼固定為: ${MASTER_PASSWORD}（可以做任何人的任何動作）`);
  console.log('[dev-mock-server] 測試-阿明 的個人密碼是 1234，其他人都還沒設密碼（留空可直接通過）。');
  console.log('[dev-mock-server] 這是本機測試用的假後端，正式上線請改用 apps-script/Code.gs 部署的真正 Apps Script。');
});
