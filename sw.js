// 最小 service worker：目前只用來讓瀏覽器判定這個網站「可安裝」，還沒做
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
