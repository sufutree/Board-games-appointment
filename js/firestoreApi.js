// Firestore POC 專用讀取路徑。Code.gs 把每次成功的寫入鏡像成同樣形狀的文件，
// 所以這裡讀出來的東西跟 Apps Script 的 bootstrap() 回傳格式刻意做成一致，
// store.js 完全不用改解析邏輯，只需要換資料來源。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebaseConfig.js';

const COLLECTION_NAMES = ['members', 'venues', 'collections', 'games', 'events', 'slots', 'votes', 'signups'];

let db = null;
function getDb() {
  if (!db) db = getFirestore(initializeApp(firebaseConfig));
  return db;
}

export async function firestoreBootstrap() {
  const database = getDb();
  const snapshots = await Promise.all(
    COLLECTION_NAMES.map((name) => getDocs(collection(database, name))),
  );
  const out = { ok: true };
  COLLECTION_NAMES.forEach((name, i) => {
    out[name] = snapshots[i].docs.map((d) => d.data());
  });
  return out;
}
