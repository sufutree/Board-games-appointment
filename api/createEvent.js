// 開團。發起人就是目前登入的身分（uid），不用再另外傳 creator_id / secret。
import { db } from './_firebaseAdmin.js';
import { requireAuth } from './_auth.js';
import { newId, nowIso, formatSlotLabel } from './_ids.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const { title, venue_id, venue_free_text, game_bgg_ids, note, slots } = req.body || {};

  const eventId = newId();
  const eventRow = {
    event_id: eventId,
    created_at: nowIso(),
    creator_id: uid,
    title: title || '',
    status: 'open',
    venue_id: venue_id || '',
    venue_free_text: venue_free_text || '',
    confirmed_slot_id: '',
    game_bgg_ids: (game_bgg_ids || []).join(','),
    note: note || '',
  };
  await db.collection('events').doc(eventId).set(eventRow);

  const slotRows = [];
  for (const s of (slots || [])) {
    const slotId = newId();
    const row = {
      slot_id: slotId,
      event_id: eventId,
      date: s.date,
      period: s.period,
      label: formatSlotLabel(s.date, s.period),
    };
    await db.collection('slots').doc(slotId).set(row);
    slotRows.push(row);
  }

  return res.status(200).json({ ok: true, event_id: eventId, event: eventRow, slots: slotRows });
}
