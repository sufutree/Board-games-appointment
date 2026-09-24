import { db } from './_firebaseAdmin.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const { event_id } = req.body || {};
  const ref = db.collection('events').doc(event_id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'EVENT_NOT_FOUND' });
  if (snap.data().creator_id !== uid) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  await ref.update({ status: 'cancelled' });
  return res.status(200).json({ ok: true });
}
