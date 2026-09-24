// 共用：驗證 Authorization: Bearer <Firebase ID token>，回傳 uid（＝member_id）。
// 驗證失敗直接把 401 寫回去、回傳 null，呼叫端看到 null 就直接 return。
import { auth } from './_firebaseAdmin.js';

export async function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    return null;
  }
  try {
    const decoded = await auth.verifyIdToken(match[1]);
    return decoded.uid;
  } catch {
    res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    return null;
  }
}

// 密碼驗證邏輯，跟原本 apps-script/Code.gs 的 checkAuth 語義完全一致：
// 主密碼永遠過；否則要對上 member_secrets 裡該成員自己的密碼；密碼欄留空＝
// 還沒設密碼，先不擋。
export async function checkSecret(db, memberId, secret) {
  if (secret === process.env.MASTER_PASSWORD) return true;
  const snap = await db.collection('member_secrets').doc(String(memberId)).get();
  if (!snap.exists) return false;
  const stored = snap.data().password || '';
  if (stored === '') return true;
  return String(secret) === String(stored);
}
