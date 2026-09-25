// 後台的所有動作，合併成一支 function（原因見 api/action.js 開頭註解：
// Vercel Hobby 方案一次部署最多 12 支 Serverless Functions）。
// 分派欄位刻意叫 op，不叫 action，因為審核類動作（reviewCorrection／
// reviewVenueCollection）本來就有自己的 action 欄位（approve/reject），
// 兩個分派欄位混在一起會撞名。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

const NUMBER_FIELDS = ['min_players', 'max_players', 'playing_time', 'min_playtime', 'max_playtime', 'year'];

function normalizeCorrectionValue(field, raw) {
  if (NUMBER_FIELDS.includes(field)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (field === 'is_expansion') return raw === 'true' || raw === true;
  return raw;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

  const { op } = req.body || {};
  if (op === 'addMember') return addMember(req, res);
  if (op === 'deleteMember') return deleteMember(req, res);
  if (op === 'setPassword') return setPassword(req, res);
  if (op === 'addVenue') return addVenue(req, res);
  if (op === 'deleteVenue') return deleteVenue(req, res);
  if (op === 'reviewCorrection') return reviewCorrection(req, res);
  if (op === 'reviewVenueCollection') return reviewVenueCollection(req, res);

  return res.status(400).json({ ok: false, error: 'UNKNOWN_OP' });
}

// 新增成員。取代原本在 Sheets members 分頁手動加一列。
async function addMember(req, res) {
  const { member_id, name, password } = req.body || {};
  const id = String(member_id || name || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'MISSING_NAME' });

  const existing = await db.collection('members').doc(id).get();
  if (existing.exists) return res.status(409).json({ ok: false, error: 'ALREADY_EXISTS' });

  await db.collection('members').doc(id).set({ id, name: name || id, type: 'person', active: true });
  await db.collection('member_secrets').doc(id).set({ password: password || '' });

  return res.status(200).json({ ok: true });
}

// 刪除成員（含密碼資料）。真的移除，不是軟刪除；歷史投票/報名紀錄裡對這個
// member_id 的引用會變成查無此人，畫面上會用 id 原文顯示，不會壞掉。
async function deleteMember(req, res) {
  const { member_id } = req.body || {};
  if (!member_id) return res.status(400).json({ ok: false, error: 'MISSING_MEMBER_ID' });

  await db.collection('members').doc(String(member_id)).delete();
  await db.collection('member_secrets').doc(String(member_id)).delete();

  return res.status(200).json({ ok: true });
}

// 重設某個成員的密碼（留空＝清空，該成員下次登入不用密碼）。
async function setPassword(req, res) {
  const { member_id, new_password } = req.body || {};
  if (!member_id) return res.status(400).json({ ok: false, error: 'MISSING_MEMBER_ID' });

  const memberSnap = await db.collection('members').doc(String(member_id)).get();
  if (!memberSnap.exists) return res.status(404).json({ ok: false, error: 'MEMBER_NOT_FOUND' });

  await db.collection('member_secrets').doc(String(member_id)).set({ password: new_password || '' });

  return res.status(200).json({ ok: true });
}

// 新增地點。取代原本在 Sheets venues 分頁手動加一列。
async function addVenue(req, res) {
  const { name, unlock_member_ids, note } = req.body || {};
  const id = String(name || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'MISSING_NAME' });

  const existing = await db.collection('venues').doc(id).get();
  if (existing.exists) return res.status(409).json({ ok: false, error: 'ALREADY_EXISTS' });

  await db.collection('venues').doc(id).set({
    id,
    name: id,
    unlock_member_ids: Array.isArray(unlock_member_ids) ? unlock_member_ids.join(',') : (unlock_member_ids || ''),
    note: note || '',
    active: true,
  });

  return res.status(200).json({ ok: true });
}

// 刪除地點。歷史事件裡對這個 venue_id 的引用會變成「（場地已刪除）」，
// 事件本身不會壞掉（見 js/views/event.js 的 venueDisplay）。
async function deleteVenue(req, res) {
  const { venue_id } = req.body || {};
  if (!venue_id) return res.status(400).json({ ok: false, error: 'MISSING_VENUE_ID' });

  await db.collection('venues').doc(String(venue_id)).delete();

  return res.status(200).json({ ok: true });
}

// 審核使用者回報的資料訂正。通過的話把值寫回 games（型別自動轉換），
// 「其他」類型沒有對應欄位可以直接套用，通過只是標記已讀，不會自動寫入。
async function reviewCorrection(req, res) {
  const { correction_id, action } = req.body || {};
  if (!correction_id) return res.status(400).json({ ok: false, error: 'MISSING_CORRECTION_ID' });

  const ref = db.collection('game_corrections').doc(String(correction_id));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const correction = snap.data();

  if (action === 'approve') {
    if (correction.field !== 'other') {
      const value = normalizeCorrectionValue(correction.field, correction.suggested_value);
      await db.collection('games').doc(String(correction.bgg_id)).set({ [correction.field]: value }, { merge: true });
    }
    await ref.update({ status: 'approved', reviewed_at: new Date().toISOString() });
  } else if (action === 'reject') {
    await ref.update({ status: 'rejected', reviewed_at: new Date().toISOString() });
  } else {
    return res.status(400).json({ ok: false, error: 'BAD_ACTION' });
  }

  return res.status(200).json({ ok: true });
}

// 審核「幫某個場地新增遊戲」的提議。通過就把它寫進 collections（holder_id
// 直接是場地 id，跟成員收藏共用同一張表，本來的資料模型就支援這樣用）。
async function reviewVenueCollection(req, res) {
  const { request_id, action } = req.body || {};
  if (!request_id) return res.status(400).json({ ok: false, error: 'MISSING_REQUEST_ID' });

  const ref = db.collection('venue_collection_requests').doc(String(request_id));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const reqData = snap.data();

  if (action === 'approve') {
    await db.collection('collections').doc(`${reqData.venue_id}_${reqData.bgg_id}`).set({
      holder_id: reqData.venue_id, bgg_id: reqData.bgg_id, name_zh: reqData.name_zh || '', note: '',
    });
    await ref.update({ status: 'approved', reviewed_at: new Date().toISOString() });
  } else if (action === 'reject') {
    await ref.update({ status: 'rejected', reviewed_at: new Date().toISOString() });
  } else {
    return res.status(400).json({ ok: false, error: 'BAD_ACTION' });
  }

  return res.status(200).json({ ok: true });
}
