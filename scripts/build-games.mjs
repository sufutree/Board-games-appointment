// 只在本機執行，不進部署（見 .vercelignore 排除 scripts/）。
//
// 用途：讀取兩份 xlsx，向 BGG 抓後設資料，輸出 ../data/games.json 與 ../data/collections.json。
//
// 用法：
//   cd scripts
//   npm install
//   node build-games.mjs
//   node build-games.mjs --collections-csv=./collections-export.csv   # 選填，見 §7 第 6 點
//
// 輸入檔案（放在專案根目錄，跟 index.html 同一層）：
//   自然樹的桌遊清單.xlsx   主檔，Sufu 的收藏，每個分頁對應一個分類代碼
//   桌遊資料庫.xlsx         代理商售價／連結補充資料
//
// 若檔名或欄位跟這裡的假設不同，請直接調整下面 CONFIG 區塊，不要憑空更動輸出格式。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  mainListFile: path.join(ROOT, '自然樹的桌遊清單.xlsx'),
  retailerDbFile: path.join(ROOT, '桌遊資料庫.xlsx'),
  outGamesJson: path.join(ROOT, 'data', 'games.json'),
  outCollectionsJson: path.join(ROOT, 'data', 'collections.json'),
  mainListHolderId: 'sufu',
  bggBatchSize: 20,
  bggBatchSleepMs: 2000,
  bgg202RetryMs: 5000,
  bgg202MaxRetries: 5,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg === '--offline') { args.offline = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function extractBggId(url) {
  if (!url) return null;
  const m = String(url).match(/boardgame(?:expansion)?\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 1. 讀取主檔（自然樹的桌遊清單.xlsx）：每個分頁 = 一個分類代碼
// ---------------------------------------------------------------------------
// 分頁名稱格式為「代碼 中文標籤」（例：「S-WP 工擺」），只取代碼部分。
// 「總覽」分頁是分類統計摘要，不是遊戲清單，略過。
const SKIP_SHEETS = new Set(['總覽']);

function categoryCodeFromSheetName(sheetName) {
  return sheetName.trim().split(/\s+/)[0];
}

function readMainList(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[警告] 找不到主檔：${filePath}，跳過。`);
    return [];
  }
  const wb = XLSX.readFile(filePath);
  const entries = [];
  const skippedNoBgg = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName.trim())) continue;
    const category = categoryCodeFromSheetName(sheetName);
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    for (const row of rows) {
      const nameZh = pick(row, '桌遊中文名稱', '中文名', '中文名稱');
      if (!nameZh) continue; // 空白列

      const bggUrl = pick(row, 'BGG網頁連結', 'BGG連結', 'BGG 連結', 'bgg_url', 'BGG網址');
      const bggId = extractBggId(bggUrl);
      if (!bggId) {
        skippedNoBgg.push(nameZh);
        continue;
      }

      entries.push({
        bgg_id: bggId,
        category,
        name_zh: nameZh || null,
        name_en: pick(row, '桌遊英文名稱', '英文名', '英文名稱') || null,
        bgg_url: bggUrl,
        retailer_url: pick(row, '台灣代理商商品連結', '代理商連結', '代理商連結網址') || null,
        retail_price: numOrNull(pick(row, '台灣官方售價', '售價', '代理商售價')),
        retailer: pick(row, '台灣代理商名稱', '代理商') || null,
        purchase_year: pick(row, '購買年份') || null,
        note: pick(row, '備註') || null,
      });
    }
  }

  if (skippedNoBgg.length > 0) {
    console.warn(`[警告] 主檔中有 ${skippedNoBgg.length} 款遊戲沒有 BGG 連結，因為資料模型以 bgg_id 為主鍵，這些遊戲不會出現在網站上：`);
    console.warn('  ' + skippedNoBgg.join('、'));
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 2. 讀取代理商資料庫（桌遊資料庫.xlsx）：補充售價/連結，不含分類
// ---------------------------------------------------------------------------
function readRetailerDb(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[警告] 找不到代理商資料庫：${filePath}，跳過。`);
    return [];
  }
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const entries = [];
  for (const row of rows) {
    const bggUrl = pick(row, 'BGG網頁連結', 'BGG連結', 'BGG 連結', 'bgg_url');
    const bggId = extractBggId(bggUrl);
    if (!bggId) continue;

    entries.push({
      bgg_id: bggId,
      name_zh: pick(row, '桌遊中文名稱', '中文名', '中文名稱') || null,
      name_en: pick(row, '桌遊英文名稱', '英文名', '英文名稱') || null,
      bgg_url: bggUrl,
      retailer_url: pick(row, '台灣代理商商品連結', '代理商商品連結', '代理商連結') || null,
      retail_price: numOrNull(pick(row, '台灣官方售價', '官方售價', '售價')),
      retailer: pick(row, '台灣代理商名稱', '代理商') || null,
    });
  }
  return entries;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 3. 選填：Sheets collections 分頁匯出的 CSV，把朋友收藏裡缺資料的 bgg_id 一併抓
// ---------------------------------------------------------------------------
function readCollectionsCsv(filePath) {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) {
    console.warn(`[警告] 找不到 collections CSV：${filePath}，跳過。`);
    return [];
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = headerLine.split(',').map((h) => h.trim());
  return lines.map((line) => {
    const cells = line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// 4. 呼叫 BGG XMLAPI2
// ---------------------------------------------------------------------------
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

async function fetchBggBatch(ids) {
  const url = `https://boardgamegeek.com/xmlapi2/thing?id=${ids.join(',')}&stats=1`;

  for (let attempt = 0; attempt < CONFIG.bgg202MaxRetries; attempt++) {
    const res = await fetch(url);
    if (res.status === 202) {
      console.log(`  BGG 排隊中，${CONFIG.bgg202RetryMs / 1000} 秒後重試… (${attempt + 1}/${CONFIG.bgg202MaxRetries})`);
      await sleep(CONFIG.bgg202RetryMs);
      continue;
    }
    if (!res.ok) throw new Error(`BGG 回應錯誤：HTTP ${res.status}`);
    const text = await res.text();
    return parseBggXml(text);
  }
  throw new Error(`BGG 一直回傳 202，放棄批次：${ids.join(',')}`);
}

function parseBggXml(xmlText) {
  const doc = xmlParser.parse(xmlText);
  const items = doc.items && doc.items.item
    ? (Array.isArray(doc.items.item) ? doc.items.item : [doc.items.item])
    : [];

  return items.map((item) => {
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
      weight: weight,
      year: numAttr(item.yearpublished),
      is_expansion: isExpansion,
      parent_bgg_id: parentBggId,
    };
  });
}

function numAttr(node) {
  if (node == null) return null;
  const v = typeof node === 'object' ? node['@_value'] : node;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchAllBggData(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  const result = new Map();

  for (let i = 0; i < unique.length; i += CONFIG.bggBatchSize) {
    const batch = unique.slice(i, i + CONFIG.bggBatchSize);
    console.log(`抓取 BGG 資料 ${i + 1}-${i + batch.length} / ${unique.length}`);
    const items = await fetchBggBatch(batch);
    for (const item of items) result.set(item.bgg_id, item);
    if (i + CONFIG.bggBatchSize < unique.length) await sleep(CONFIG.bggBatchSleepMs);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs();

  const mainEntries = readMainList(CONFIG.mainListFile);
  const retailerEntries = readRetailerDb(CONFIG.retailerDbFile);
  const csvRows = readCollectionsCsv(args['collections-csv']);

  const retailerByBggId = new Map(retailerEntries.map((e) => [e.bgg_id, e]));

  const csvBggIds = csvRows
    .map((r) => Number(r.bgg_id))
    .filter((id) => Number.isFinite(id));

  const allBggIds = [
    ...mainEntries.map((e) => e.bgg_id),
    ...retailerEntries.map((e) => e.bgg_id),
    ...csvBggIds,
  ];

  if (allBggIds.length === 0) {
    console.error('沒有任何可辨識的 BGG id，請確認輸入檔案存在且欄位正確。中止。');
    process.exit(1);
  }

  let bggData;
  if (args.offline) {
    console.log('[--offline] 略過向 BGG 抓取，人數／時長／複雜度／縮圖會是空的，之後拿掉這個參數重跑即可補齊。');
    bggData = new Map();
  } else {
    bggData = await fetchAllBggData(allBggIds);
  }

  const games = {};

  function upsertGame(bggId, extra) {
    const key = String(bggId);
    const bgg = bggData.get(bggId) || {};
    const existing = games[key] || {};
    const retailer = retailerByBggId.get(bggId) || {};

    games[key] = {
      bgg_id: bggId,
      name_zh: extra.name_zh ?? existing.name_zh ?? null,
      name_en: bgg.name_en ?? extra.name_en ?? existing.name_en ?? null,
      bgg_url: extra.bgg_url || existing.bgg_url || `https://boardgamegeek.com/boardgame/${bggId}/`,
      thumbnail: bgg.thumbnail ?? existing.thumbnail ?? null,
      min_players: bgg.min_players ?? existing.min_players ?? null,
      max_players: bgg.max_players ?? existing.max_players ?? null,
      playing_time: bgg.playing_time ?? existing.playing_time ?? null,
      min_playtime: bgg.min_playtime ?? existing.min_playtime ?? null,
      max_playtime: bgg.max_playtime ?? existing.max_playtime ?? null,
      weight: bgg.weight ?? existing.weight ?? null,
      year: bgg.year ?? existing.year ?? null,
      category: extra.category ?? existing.category ?? null,
      retailer_url: extra.retailer_url ?? retailer.retailer_url ?? existing.retailer_url ?? null,
      retail_price: extra.retail_price ?? retailer.retail_price ?? existing.retail_price ?? null,
      retailer: extra.retailer ?? retailer.retailer ?? existing.retailer ?? null,
      is_expansion: bgg.is_expansion ?? existing.is_expansion ?? false,
      parent_bgg_id: bgg.parent_bgg_id ?? existing.parent_bgg_id ?? null,
    };
  }

  for (const e of mainEntries) upsertGame(e.bgg_id, e);
  for (const e of retailerEntries) if (!games[String(e.bgg_id)]) upsertGame(e.bgg_id, e);
  for (const id of csvBggIds) if (!games[String(id)]) upsertGame(id, {});

  const collections = mainEntries.map((e) => ({
    holder_id: CONFIG.mainListHolderId,
    bgg_id: e.bgg_id,
  }));

  fs.mkdirSync(path.dirname(CONFIG.outGamesJson), { recursive: true });
  fs.writeFileSync(CONFIG.outGamesJson, JSON.stringify(games, null, 2));
  fs.writeFileSync(CONFIG.outCollectionsJson, JSON.stringify(collections, null, 2));

  console.log(`完成。games.json：${Object.keys(games).length} 款，collections.json：${collections.length} 筆。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
