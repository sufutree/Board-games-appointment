// 成團定案：只有發起人（uid === event.creator_id）能做。
// Firestore 的 votes 文件 id 本身就是「事件+時段+成員」去重過的，不用再像
// apps-script/Code.gs 那樣額外挑「每人最新一筆」。
import { db } from './_firebaseAdmin.js';
import { requireAuth } from './_auth.js';
import { nowIso } from './_ids.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const { event_id, slot_id, venue_id, venue_free_text } = req.body || {};
  const eventRef = db.collection('events').doc(event_id);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) return res.status(404).json({ ok: false, error: 'EVENT_NOT_FOUND' });
  const event = eventSnap.data();
  if (event.creator_id !== uid) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const updates = { confirmed_slot_id: slot_id, status: 'confirmed' };
  if (venue_id) {
    updates.venue_id = venue_id;
    updates.venue_free_text = '';
  } else if (venue_free_text) {
    updates.venue_free_text = venue_free_text;
    updates.venue_id = '';
  }
  await eventRef.update(updates);

  const [votesSnap, membersSnap, existingSignupsSnap] = await Promise.all([
    db.collection('votes').where('event_id', '==', event_id).where('slot_id', '==', slot_id).where('ok', '==', true).get(),
    db.collection('members').get(),
    db.collection('signups').where('event_id', '==', event_id).get(),
  ]);
  const activeMemberIds = new Set(membersSnap.docs.map((d) => d.id));
  const okVoterIds = votesSnap.docs
    .map((d) => d.data().member_id)
    .filter((id) => activeMemberIds.has(String(id)));
  const existingSignupIds = new Set(existingSignupsSnap.docs.map((d) => d.data().member_id));

  const batch = db.batch();
  for (const memberId of okVoterIds) {
    if (!existingSignupIds.has(memberId)) {
      batch.set(db.collection('signups').doc(`${event_id}_${memberId}`), {
        event_id, member_id: memberId, joined_at: nowIso(),
      });
      existingSignupIds.add(memberId);
    }
  }
  await batch.commit();

  return res.status(200).json({ ok: true });
}
