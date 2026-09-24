// 使用者自建遊戲：貼 BGG 連結或 BGG id，抓後設資料 upsert 進 games，
// 選填順便登記進自己的收藏（collections）。任何登入身分都能用。
import { db } from './_firebaseAdmin.js';
import { requireAuth } from './_auth.js';
import { extractBggId, fetchBggData } from './_bgg.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const { bgg_input, name_zh, add_to_collection } = req.body || {};
  const bggId = extractBggId(bgg_input);
  if (!bggId) return res.status(400).json({ ok: false, error: 'INVALID_BGG_ID' });

  let bggData;
  try {
    bggData = await fetchBggData(bggId);
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message === 'BGG_BUSY' ? 'BGG_BUSY' : 'BGG_FETCH_FAILED' });
  }
  if (!bggData) return res.status(404).json({ ok: false, error: 'BGG_NOT_FOUND' });

  const gameRef = db.collection('games').doc(String(bggId));
  const existingSnap = await gameRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : {};

  const gameRow = {
    bgg_id: bggId,
    name_zh: name_zh || existing.name_zh || null,
    name_en: bggData.name_en ?? existing.name_en ?? null,
    thumbnail: bggData.thumbnail ?? existing.thumbnail ?? null,
    min_players: bggData.min_players ?? existing.min_players ?? null,
    max_players: bggData.max_players ?? existing.max_players ?? null,
    playing_time: bggData.playing_time ?? existing.playing_time ?? null,
    min_playtime: bggData.min_playtime ?? existing.min_playtime ?? null,
    max_playtime: bggData.max_playtime ?? existing.max_playtime ?? null,
    weight: bggData.weight ?? existing.weight ?? null,
    year: bggData.year ?? existing.year ?? null,
    category: existing.category ?? null,
    is_expansion: bggData.is_expansion ?? existing.is_expansion ?? false,
    parent_bgg_id: bggData.parent_bgg_id ?? existing.parent_bgg_id ?? null,
  };
  await gameRef.set(gameRow);

  if (add_to_collection) {
    await db.collection('collections').doc(`${uid}_${bggId}`).set({
      holder_id: uid, bgg_id: bggId, name_zh: gameRow.name_zh || '', note: '',
    });
  }

  return res.status(200).json({ ok: true, game: gameRow });
}
