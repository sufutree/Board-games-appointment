// 新增地點。取代原本在 Sheets venues 分頁手動加一列。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

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
