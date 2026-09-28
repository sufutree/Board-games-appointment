// Firestore POC 專用。到 Firebase Console 建專案 → 新增 Web App，把那裡給的設定貼進來。
// 這組設定本來就是公開的（安全性靠 Firestore Security Rules，不是靠藏這組 key），可以放心 commit。
export const firebaseConfig = {
  apiKey: 'AIzaSyBUdLuq_ltR3S9JQpWRk5BRnJ63zfxoKAU',
  authDomain: 'board-games-appointmen.firebaseapp.com',
  projectId: 'board-games-appointmen',
  storageBucket: 'board-games-appointmen.firebasestorage.app',
  messagingSenderId: '1080375976690',
  appId: '1:1080375976690:web:d368db6624eb6e7ce9e66b',
};

// 推播通知（Web Push）要用的 VAPID 公鑰，跟上面的 apiKey 不一樣，沒辦法
// 用指令生成/查詢，只能手動去 Firebase Console →專案設定→Cloud Messaging
// 分頁→「Web Push 憑證」→產生金鑰組，把那組「金鑰組」貼在這裡。
// 沒設定的話 js/push.js 的 enableNotifications() 會直接失敗（不影響其他
// 功能，只是通知按鈕按了沒反應）。
export const VAPID_PUBLIC_KEY = 'BDnzl54OWt4qxaPH9i4b8O9pmxVDUlYR6644liT9GlLP1aQBUwwBeKsIWVO4X5mX7LzlywYPMLzh9rfpUIi_mLE';
