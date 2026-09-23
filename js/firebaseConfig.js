// Firestore POC 專用。到 Firebase Console 建專案 → 新增 Web App，把那裡給的設定貼進來。
// 這組設定本來就是公開的（安全性靠 Firestore Security Rules，不是靠藏這組 key），可以放心 commit。
export const firebaseConfig = {
  apiKey: 'PASTE_ME',
  authDomain: 'PASTE_ME.firebaseapp.com',
  projectId: 'PASTE_ME',
  storageBucket: 'PASTE_ME.appspot.com',
  messagingSenderId: 'PASTE_ME',
  appId: 'PASTE_ME',
};
