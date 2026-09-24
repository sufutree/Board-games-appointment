// 登入身分自己改自己的密碼，不需要主密碼。要求再輸入一次目前密碼，避免
// 裝置忘記登出被別人接手亂改。
import { db } from './_firebaseAdmin.js';
import { requireAuth, checkSecret } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const { current_password, new_password } = req.body || {};
  const ok = await checkSecret(db, uid, current_password);
  if (!ok) return res.status(200).json({ ok: false, error: 'BAD_SECRET' });

  await db.collection('member_secrets').doc(uid).set({ password: new_password || '' });
  return res.status(200).json({ ok: true });
}
