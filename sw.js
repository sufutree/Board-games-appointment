// 最小 service worker：主要用來讓瀏覽器判定這個網站「可安裝」，還沒做
// 離線快取。fetch 事件單純直接放行給網路，不攔截、不快取，避免使用者
// 安裝後看到舊資料（這個站的資料變動頻繁，先不做快取比較安全）。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // 故意不呼叫 event.respondWith()，全部交給瀏覽器預設處理。
});

// 推播通知：app 不在前景（分頁沒開著/背景）時，FCM 會直接把訊息丟給
// service worker，要靠這裡顯示系統通知。用 compat 版是因為 service
// worker 註冊成 classic script（沒有 type: module），才能相容 Safari/iOS
// ——firebaseConfig.js 那份 ES module 沒辦法直接 import 進來，設定值只好
// 在這裡重複一份。
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBUdLuq_ltR3S9JQpWRk5BRnJ63zfxoKAU',
  authDomain: 'board-games-appointmen.firebaseapp.com',
  projectId: 'board-games-appointmen',
  storageBucket: 'board-games-appointmen.firebasestorage.app',
  messagingSenderId: '1080375976690',
  appId: '1:1080375976690:web:d368db6624eb6e7ce9e66b',
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const link = (payload.fcmOptions && payload.fcmOptions.link) || (payload.data && payload.data.link) || '/';
  self.registration.showNotification(title || '桌遊揪團', {
    body: body || '',
    icon: '/icons/icon-192.png',
    data: { link },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(self.clients.openWindow(link));
});
