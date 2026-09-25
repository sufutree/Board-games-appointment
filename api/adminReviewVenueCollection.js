// 審核「幫某個場地新增遊戲」的提議。通過就把它寫進 collections（holder_id
// 直接是場地 id，跟成員收藏共用同一張表，本來的資料模型就支援這樣用）。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

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
