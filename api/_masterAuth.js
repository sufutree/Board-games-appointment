// 管理用端點的共用驗證：只認主密碼，跟 Firebase 登入身分無關（這是 Sufu
// 專用的後台功能，不是「以某個成員身分」做的動作）。
export function checkMasterPassword(req, res) {
  const { master_password } = req.body || {};
  if (master_password !== process.env.MASTER_PASSWORD) {
    res.status(403).json({ ok: false, error: 'BAD_MASTER_PASSWORD' });
    return false;
  }
  return true;
}
