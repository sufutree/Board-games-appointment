// 刪除成員（含密碼資料）。真的移除，不是軟刪除；歷史投票/報名紀錄裡對這個
// member_id 的引用會變成查無此人，畫面上會用 id 原文顯示，不會壞掉。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

  const { member_id } = req.body || {};
  if (!member_id) return res.status(400).json({ ok: false, error: 'MISSING_MEMBER_ID' });

  await db.collection('members').doc(String(member_id)).delete();
  await db.collection('member_secrets').doc(String(member_id)).delete();

  return res.status(200).json({ ok: true });
}
