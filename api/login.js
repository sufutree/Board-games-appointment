// 密碼驗證＋發 Firebase 登入權杖。取代原本 apps-script/Code.gs 的 verifySecret，
// 但這裡驗證成功後不只是回 ok:true，還會多發一個自訂權杖給前端去換成真正的
// 登入狀態，之後投票/報名可以直接用這個身分寫 Firestore，不用再打這支 API。
import { db, auth } from './_firebaseAdmin.js';
import { checkSecret } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const { member_id, secret } = req.body || {};
  if (!member_id) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const ok = await checkSecret(db, member_id, secret);
  if (!ok) return res.status(200).json({ ok: false, error: 'BAD_SECRET' });

  const token = await auth.createCustomToken(String(member_id));
  return res.status(200).json({ ok: true, token });
}
