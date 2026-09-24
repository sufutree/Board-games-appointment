// 向 BGG XML API 抓單一款遊戲的後設資料。解析邏輯跟 scripts/build-games.mjs
// 的 parseBggXml 刻意保持一致，只是這裡只抓一款、給使用者即時新增遊戲用。
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractBggId(input) {
  if (!input) return null;
  const asNumber = Number(input);
  if (Number.isFinite(asNumber) && String(input).trim() === String(asNumber)) return asNumber;
  const m = String(input).match(/boardgame(?:expansion)?\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function numAttr(node) {
  if (node == null) return null;
  const v = typeof node === 'object' ? node['@_value'] : node;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBggXml(xmlText) {
  const doc = xmlParser.parse(xmlText);
  const items = doc.items && doc.items.item
    ? (Array.isArray(doc.items.item) ? doc.items.item : [doc.items.item])
    : [];
  if (items.length === 0) return null;
  const item = items[0];

  const names = Array.isArray(item.name) ? item.name : [item.name].filter(Boolean);
  const primaryName = names.find((n) => n['@_type'] === 'primary') || names[0] || {};

  const links = Array.isArray(item.link) ? item.link : [item.link].filter(Boolean);
  const isExpansion = item['@_type'] === 'boardgameexpansion';
  let parentBggId = null;
  if (isExpansion) {
    const parentLink = links.find((l) => l['@_type'] === 'boardgameexpansion' && l['@_inbound'] === 'true');
    if (parentLink) parentBggId = Number(parentLink['@_id']);
  }

  const weight = item.statistics && item.statistics.ratings && item.statistics.ratings.averageweight
    ? Number(item.statistics.ratings.averageweight['@_value'])
    : null;

  return {
    bgg_id: Number(item['@_id']),
    name_en: primaryName['@_value'] || null,
    thumbnail: item.thumbnail || null,
    min_players: numAttr(item.minplayers),
    max_players: numAttr(item.maxplayers),
    playing_time: numAttr(item.playingtime),
    min_playtime: numAttr(item.minplaytime),
    max_playtime: numAttr(item.maxplaytime),
    weight,
    year: numAttr(item.yearpublished),
    is_expansion: isExpansion,
    parent_bgg_id: parentBggId,
  };
}

// 使用者當場等結果，重試次數／間隔都刻意壓低，避免請求拖太久；真的遇到 BGG
// 排隊中（202）失敗，前端可以請使用者晚點再試一次。
export async function fetchBggData(bggId) {
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.status === 202) {
      await sleep(1500);
      continue;
    }
    if (!res.ok) throw new Error('BGG_HTTP_' + res.status);
    const text = await res.text();
    return parseBggXml(text);
  }
  throw new Error('BGG_BUSY');
}
