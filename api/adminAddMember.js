// 新增成員。取代原本在 Sheets members 分頁手動加一列。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

  const { member_id, name, password } = req.body || {};
  const id = String(member_id || name || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'MISSING_NAME' });

  const existing = await db.collection('members').doc(id).get();
  if (existing.exists) return res.status(409).json({ ok: false, error: 'ALREADY_EXISTS' });

  await db.collection('members').doc(id).set({
    id, name: name || id, type: 'person', active: true,
  });
  await db.collection('member_secrets').doc(id).set({ password: password || '' });

  return res.status(200).json({ ok: true });
}
