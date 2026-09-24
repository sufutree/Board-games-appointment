// 集中管理 Firebase App / Auth / Firestore 的初始化與登入狀態，前端所有跟
// Firebase 有關的存取都經過這裡，避免各檔案各自 initializeApp() 導致重複初始化。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, signInWithCustomToken, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebaseConfig.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

let currentUid = null;
let resolveReady;
const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

onAuthStateChanged(auth, (user) => {
  currentUid = user ? user.uid : null;
  resolveReady();
});

// app.js 開機時要 await 這個，確保「畫面上顯示我是誰」不會因為 Firebase Auth
// 本地持久化狀態還沒讀完，而在重新整理後短暫誤判成「還沒選身分」。
export function waitForAuthReady() {
  return readyPromise;
}

// 取代原本存在 localStorage 的 bgt_self_id：現在「我是誰」就是目前的 Firebase
// 登入身分本身，不用另外維護一份。
export function getSelfId() {
  return currentUid || '';
}

export function clearSelfId() {
  return signOut(auth);
}

// 密碼驗證＋登入。跟 /api/login 換一個 Firebase 自訂權杖，再拿去換成真正的
// 登入狀態（signInWithCustomToken）。取代原本 apps-script 的 verifySecret。
export async function loginAs(memberId, secret) {
  let data;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, secret }),
    });
    data = await res.json();
  } catch {
    return { ok: false, error: 'NETWORK_ERROR' };
  }
  if (!data.ok) return data;
  await signInWithCustomToken(auth, data.token);
  return { ok: true };
}

export async function getIdToken() {
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}

const BOOTSTRAP_COLLECTIONS = ['members', 'venues', 'collections', 'games', 'events', 'slots', 'votes', 'signups'];

export async function firestoreBootstrap() {
  const snapshots = await Promise.all(
    BOOTSTRAP_COLLECTIONS.map((name) => getDocs(collection(db, name))),
  );
  const out = { ok: true };
  BOOTSTRAP_COLLECTIONS.forEach((name, i) => {
    out[name] = snapshots[i].docs.map((d) => d.data());
  });
  return out;
}
