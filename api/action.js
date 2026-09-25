// 一般使用者（登入身分）的所有寫入動作，合併成一支 function。
// 原因：Vercel Hobby 方案一次部署最多 12 支 Serverless Functions，原本
// login/createEvent/confirm/cancelEvent/updateEventDetails/setOwnPassword/
// addGame 各自一支，加上 admin 那幾支很快就超過上限，所以比照原本
// apps-script/Code.gs 的 doPost 用一個 action 欄位分派到底。
import { db, auth } from './_firebaseAdmin.js';
import { requireAuth, checkSecret } from './_auth.js';
import { extractBggId, fetchBggData } from './_bgg.js';
import { newId, nowIso, formatSlotLabel } from './_ids.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const { action } = req.body || {};

  if (action === 'login') return login(req, res);

  // 其餘動作都要求先登入。
  const uid = await requireAuth(req, res);
  if (!uid) return;

  if (action === 'createEvent') return createEvent(req, res, uid);
  if (action === 'confirm') return confirm(req, res, uid);
  if (action === 'cancelEvent') return cancelEvent(req, res, uid);
  if (action === 'updateEventDetails') return updateEventDetails(req, res, uid);
  if (action === 'setOwnPassword') return setOwnPassword(req, res, uid);
  if (action === 'addGame') return addGame(req, res, uid);

  return res.status(400).json({ ok: false, error: 'UNKNOWN_ACTION' });
}

// 帳號（username）+ 密碼驗證＋發 Firebase 登入權杖。username 是英文/拼音
// 帳號，跟顯示用的中文姓名分開，先查 usernames 對照表換出真正的
// member_id，再走原本的密碼驗證。驗證成功後不只是回 ok:true，還會多發
// 一個自訂權杖給前端去換成真正的登入狀態，之後投票/報名可以直接用這個
// 身分寫 Firestore，不用再打這支 API。
async function login(req, res) {
  const { username, secret } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const usernameSnap = await db.collection('usernames').doc(String(username)).get();
  if (!usernameSnap.exists) return res.status(200).json({ ok: false, error: 'BAD_SECRET' });
  const member_id = usernameSnap.data().member_id;

  const ok = await checkSecret(db, member_id, secret);
  if (!ok) return res.status(200).json({ ok: false, error: 'BAD_SECRET' });

  const token = await auth.createCustomToken(String(member_id));
  return res.status(200).json({ ok: true, token });
}

// 開團。發起人就是目前登入的身分（uid），不用再另外傳 creator_id / secret。
async function createEvent(req, res, uid) {
  const { title, venue_id, venue_free_text, venue_type, online_platform, game_bgg_ids, note, slots } = req.body || {};

  const eventId = newId();
  const eventRow = {
    event_id: eventId,
    created_at: nowIso(),
    creator_id: uid,
    title: title || '',
    status: 'open',
    venue_type: venue_type === 'online' ? 'online' : 'physical',
    venue_id: venue_type === 'online' ? '' : (venue_id || ''),
    venue_free_text: venue_free_text || '',
    online_platform: venue_type === 'online' ? (online_platform || 'other') : '',
    confirmed_slot_id: '',
    game_bgg_ids: (game_bgg_ids || []).join(','),
    note: note || '',
  };
  await db.collection('events').doc(eventId).set(eventRow);

  const slotRows = [];
  for (const s of (slots || [])) {
    const slotId = newId();
    const row = {
      slot_id: slotId,
      event_id: eventId,
      date: s.date,
      period: s.period,
      label: formatSlotLabel(s.date, s.period),
    };
    await db.collection('slots').doc(slotId).set(row);
    slotRows.push(row);
  }

  return res.status(200).json({ ok: true, event_id: eventId, event: eventRow, slots: slotRows });
}

// 成團定案：只有發起人（uid === event.creator_id）能做。Firestore 的 votes
// 文件 id 本身就是「事件+時段+成員」去重過的，不用再挑「每人最新一筆」。
async function confirm(req, res, uid) {
  const { event_id, slot_id, venue_id, venue_free_text } = req.body || {};
  const eventRef = db.collection('events').doc(event_id);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) return res.status(404).json({ ok: false, error: 'EVENT_NOT_FOUND' });
  const event = eventSnap.data();
  if (event.creator_id !== uid) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const updates = { confirmed_slot_id: slot_id, status: 'confirmed' };
  if (venue_id) {
    updates.venue_id = venue_id;
    updates.venue_free_text = '';
  } else if (venue_free_text) {
    updates.venue_free_text = venue_free_text;
    updates.venue_id = '';
  }
  await eventRef.update(updates);

  const [votesSnap, membersSnap, existingSignupsSnap] = await Promise.all([
    db.collection('votes').where('event_id', '==', event_id).where('slot_id', '==', slot_id).where('ok', '==', true).get(),
    db.collection('members').get(),
    db.collection('signups').where('event_id', '==', event_id).get(),
  ]);
  const activeMemberIds = new Set(membersSnap.docs.map((d) => d.id));
  const okVoterIds = votesSnap.docs
    .map((d) => d.data().member_id)
    .filter((id) => activeMemberIds.has(String(id)));
  const existingSignupIds = new Set(existingSignupsSnap.docs.map((d) => d.data().member_id));

  const batch = db.batch();
  for (const memberId of okVoterIds) {
    if (!existingSignupIds.has(memberId)) {
      batch.set(db.collection('signups').doc(`${event_id}_${memberId}`), {
        event_id, member_id: memberId, joined_at: nowIso(),
      });
      existingSignupIds.add(memberId);
    }
  }
  await batch.commit();

  return res.status(200).json({ ok: true });
}

async function cancelEvent(req, res, uid) {
  const { event_id } = req.body || {};
  const ref = db.collection('events').doc(event_id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'EVENT_NOT_FOUND' });
  if (snap.data().creator_id !== uid) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  await ref.update({ status: 'cancelled' });
  return res.status(200).json({ ok: true });
}

// 成團後發起人仍可調整指定遊戲與地點。
async function updateEventDetails(req, res, uid) {
  const { event_id, game_bgg_ids, venue_id, venue_free_text, venue_type, online_platform } = req.body || {};
  const ref = db.collection('events').doc(event_id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'EVENT_NOT_FOUND' });
  if (snap.data().creator_id !== uid) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const updates = { game_bgg_ids: (game_bgg_ids || []).join(',') };
  if (venue_type === 'online') {
    updates.venue_type = 'online';
    updates.online_platform = online_platform || 'other';
    updates.venue_free_text = venue_free_text || '';
    updates.venue_id = '';
  } else {
    updates.venue_type = 'physical';
    updates.online_platform = '';
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
  }
  await ref.update(updates);

  return res.status(200).json({ ok: true });
}

// 登入身分自己改自己的密碼，不需要主密碼。要求再輸入一次目前密碼，避免
// 裝置忘記登出被別人接手亂改。
async function setOwnPassword(req, res, uid) {
  const { current_password, new_password } = req.body || {};
  const ok = await checkSecret(db, uid, current_password);
  if (!ok) return res.status(200).json({ ok: false, error: 'BAD_SECRET' });

  await db.collection('member_secrets').doc(uid).set({ password: new_password || '' });
  return res.status(200).json({ ok: true });
}

// 使用者自建遊戲：貼 BGG 連結或 BGG id，抓後設資料 upsert 進 games，
// 選填順便登記進自己的收藏（collections）。任何登入身分都能用。
function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// BGG 連結還是要貼（用來取得 bgg_id 當識別碼），但 BGG 目前需要申請 API
// 權杖才能自動抓資料（見 api/_bgg.js），權杖核准前 fetchBggData 大概率會
// 失敗。這裡刻意把它當成「best effort」：抓不到就 bggData 為 null，改用
// 使用者手動填的欄位；權杖核准後可以再讓使用者「回報資料有誤」補齊。
async function addGame(req, res, uid) {
  const {
    bgg_input, name_zh, name_en, min_players, max_players, playing_time, thumbnail,
    add_to_collection,
  } = req.body || {};
  const bggId = extractBggId(bgg_input);
  if (!bggId) return res.status(400).json({ ok: false, error: 'INVALID_BGG_ID' });

  let bggData = null;
  try {
    bggData = await fetchBggData(bggId);
  } catch {
    bggData = null;
  }

  const gameRef = db.collection('games').doc(String(bggId));
  const existingSnap = await gameRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : {};

  const finalNameZh = name_zh || existing.name_zh || (bggData && bggData.name_en) || null;
  if (!finalNameZh) {
    return res.status(400).json({ ok: false, error: 'MISSING_NAME' });
  }

  const gameRow = {
    bgg_id: bggId,
    name_zh: finalNameZh,
    name_en: name_en || (bggData && bggData.name_en) || existing.name_en || null,
    thumbnail: thumbnail || (bggData && bggData.thumbnail) || existing.thumbnail || null,
    min_players: numOrNull(min_players) ?? (bggData && bggData.min_players) ?? existing.min_players ?? null,
    max_players: numOrNull(max_players) ?? (bggData && bggData.max_players) ?? existing.max_players ?? null,
    playing_time: numOrNull(playing_time) ?? (bggData && bggData.playing_time) ?? existing.playing_time ?? null,
    min_playtime: (bggData && bggData.min_playtime) ?? existing.min_playtime ?? null,
    max_playtime: (bggData && bggData.max_playtime) ?? existing.max_playtime ?? null,
    weight: (bggData && bggData.weight) ?? existing.weight ?? null,
    year: (bggData && bggData.year) ?? existing.year ?? null,
    tags: Array.isArray(existing.tags) ? existing.tags : [],
    is_expansion: (bggData && bggData.is_expansion) ?? existing.is_expansion ?? false,
    parent_bgg_id: (bggData && bggData.parent_bgg_id) ?? existing.parent_bgg_id ?? null,
  };
  await gameRef.set(gameRow);

  if (add_to_collection) {
    await db.collection('collections').doc(`${uid}_${bggId}`).set({
      holder_id: uid, bgg_id: bggId, name_zh: gameRow.name_zh || '', note: '',
    });
  }

  return res.status(200).json({ ok: true, game: gameRow, bgg_fetch_ok: !!bggData });
}
