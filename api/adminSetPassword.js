// 重設某個成員的密碼（留空＝清空，該成員下次登入不用密碼）。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

  const { member_id, new_password } = req.body || {};
  if (!member_id) return res.status(400).json({ ok: false, error: 'MISSING_MEMBER_ID' });

  const memberSnap = await db.collection('members').doc(String(member_id)).get();
  if (!memberSnap.exists) return res.status(404).json({ ok: false, error: 'MEMBER_NOT_FOUND' });

  await db.collection('member_secrets').doc(String(member_id)).set({ password: new_password || '' });

  return res.status(200).json({ ok: true });
}
