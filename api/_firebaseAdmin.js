// 共用 Admin SDK 初始化。檔名開頭 _ 讓 Vercel 不要把這個檔案當成一支 API route。
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('缺少環境變數 FIREBASE_SERVICE_ACCOUNT_JSON');
  return JSON.parse(raw);
}

if (!getApps().length) {
  initializeApp({ credential: cert(loadServiceAccount()) });
}

export const db = getFirestore();
export const auth = getAuth();
