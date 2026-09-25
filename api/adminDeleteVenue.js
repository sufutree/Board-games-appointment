// 刪除地點。歷史事件裡對這個 venue_id 的引用會變成「（場地已刪除）」，
// 事件本身不會壞掉（見 js/views/event.js 的 venueDisplay）。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

  const { venue_id } = req.body || {};
  if (!venue_id) return res.status(400).json({ ok: false, error: 'MISSING_VENUE_ID' });

  await db.collection('venues').doc(String(venue_id)).delete();

  return res.status(200).json({ ok: true });
}
