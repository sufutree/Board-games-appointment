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
