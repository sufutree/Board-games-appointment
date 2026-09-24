// 審核使用者回報的資料訂正。通過的話把值寫回 games（type 自動轉換），
// 「其他」類型沒有對應欄位可以直接套用，通過只是標記已讀，不會自動寫入。
import { db } from './_firebaseAdmin.js';
import { checkMasterPassword } from './_masterAuth.js';

const NUMBER_FIELDS = ['min_players', 'max_players', 'playing_time', 'min_playtime', 'max_playtime', 'year'];

function normalizeValue(field, raw) {
  if (NUMBER_FIELDS.includes(field)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (field === 'is_expansion') return raw === 'true' || raw === true;
  return raw;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!checkMasterPassword(req, res)) return;

  const { correction_id, action } = req.body || {};
  if (!correction_id) return res.status(400).json({ ok: false, error: 'MISSING_CORRECTION_ID' });

  const ref = db.collection('game_corrections').doc(String(correction_id));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const correction = snap.data();

  if (action === 'approve') {
    if (correction.field !== 'other') {
      const value = normalizeValue(correction.field, correction.suggested_value);
      await db.collection('games').doc(String(correction.bgg_id)).set({ [correction.field]: value }, { merge: true });
    }
    await ref.update({ status: 'approved', reviewed_at: new Date().toISOString() });
  } else if (action === 'reject') {
    await ref.update({ status: 'rejected', reviewed_at: new Date().toISOString() });
  } else {
    return res.status(400).json({ ok: false, error: 'BAD_ACTION' });
  }

  return res.status(200).json({ ok: true });
}
