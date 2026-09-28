// 推播通知：目前唯一的通知時機是「有人開新團」（api/action.js 的
// createEvent 觸發），這裡只負責「使用者按下開啟通知」之後的訂閱流程。
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, VAPID_PUBLIC_KEY } from './firebaseConfig.js';
import { db, getSelfId } from './firebase.js';

export function pushSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && VAPID_PUBLIC_KEY !== 'PASTE_ME';
}

export function notificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function getMessagingApp() {
  const app = getApps().find((a) => a.name === 'messaging') || initializeApp(firebaseConfig, 'messaging');
  return getMessaging(app);
}

// FCM 對「app 開著在前景」跟「背景/沒開」是分開處理的：背景訊息會直接送給
// service worker（sw.js 的 onBackgroundMessage，瀏覽器自動跳系統通知）；
// 前景訊息會送進正在跑的分頁本身，瀏覽器不會自動跳通知，要自己接住手動
// 顯示，不然就會悄悄消失——這支就是在補這一段。用
// registration.showNotification() 而不是 `new Notification()`，因為
// Android 上已安裝的 PWA 有些情況不給直接用 Notification 建構子。
let foregroundListenerAttached = false;
export function listenForegroundMessages() {
  if (foregroundListenerAttached || !pushSupported()) return;
  foregroundListenerAttached = true;
  const messaging = getMessagingApp();
  onMessage(messaging, async (payload) => {
    const { title, body } = payload.notification || {};
    const link = (payload.fcmOptions && payload.fcmOptions.link) || (payload.data && payload.data.link) || '/';
    const registration = await navigator.serviceWorker.ready;
    registration.showNotification(title || '桌遊揪團', { body: body || '', icon: '/icons/icon-192.png', data: { link } });
  });
}

// 使用者主動按下「開啟通知」才會呼叫：跳瀏覽器權限詢問、拿 FCM token、
// 存進 Firestore 綁自己的 member_id。回傳 { ok, error? }。
export async function enableNotifications() {
  if (!pushSupported()) return { ok: false, error: 'UNSUPPORTED' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'PERMISSION_DENIED' };

  try {
    const registration = await navigator.serviceWorker.ready;
    const messaging = getMessagingApp();
    const token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, error: 'NO_TOKEN' };

    const memberId = getSelfId();
    await setDoc(doc(db, 'push_subscriptions', token), {
      member_id: memberId,
      token,
      created_at: new Date().toISOString(),
    });
    listenForegroundMessages();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || err.message || 'PUSH_ERROR' };
  }
}
