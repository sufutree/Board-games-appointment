// 推播通知：目前唯一的通知時機是「有人開新團」（api/action.js 的
// createEvent 觸發），這裡只負責「使用者按下開啟通知」之後的訂閱流程。
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getMessaging, getToken } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, VAPID_PUBLIC_KEY } from './firebaseConfig.js';
import { db, getSelfId } from './firebase.js';

export function pushSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && VAPID_PUBLIC_KEY !== 'PASTE_ME';
}

export function notificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

// 使用者主動按下「開啟通知」才會呼叫：跳瀏覽器權限詢問、拿 FCM token、
// 存進 Firestore 綁自己的 member_id。回傳 { ok, error? }。
export async function enableNotifications() {
  if (!pushSupported()) return { ok: false, error: 'UNSUPPORTED' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'PERMISSION_DENIED' };

  try {
    const registration = await navigator.serviceWorker.ready;
    // firebase-messaging 只認自己的 app 實例；用同一組設定另外開一個，
    // 跟 firebase.js 那個各自獨立，不會互相干擾。
    const app = getApps().find((a) => a.name === 'messaging') || initializeApp(firebaseConfig, 'messaging');
    const messaging = getMessaging(app);
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
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || err.message || 'PUSH_ERROR' };
  }
}
