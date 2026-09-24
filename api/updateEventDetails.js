// 成團後發起人仍可調整指定遊戲與地點。
import { db } from './_firebaseAdmin.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const { event_id, game_bgg_ids, venue_id, venue_free_text, venue_type, online_platform } = req.body || {};
  const ref = db.collection('events').doc(event_id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'EVENT_NOT_FOUND' });
  if (snap.data().creator_id !== uid) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const updates = { game_bgg_ids: (game_bgg_ids || []).join(',') };
  if (venue_type === 'online') {
    updates.venue_type = 'online';
    updates.online_platform = online_platform || 'other';
    updates.venue_free_text = venue_free_text || '';
    updates.venue_id = '';
  } else {
    updates.venue_type = 'physical';
    updates.online_platform = '';
    if (venue_id) {
      updates.venue_id = venue_id;
      updates.venue_free_text = '';
    } else if (venue_free_text) {
      updates.venue_free_text = venue_free_text;
      updates.venue_id = '';
    } else {
      updates.venue_id = '';
      updates.venue_free_text = '';
    }
  }
  await ref.update(updates);

  return res.status(200).json({ ok: true });
}
