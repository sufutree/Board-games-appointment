// 共用：對「除了某人以外的所有已訂閱裝置」發推播。目前唯一的使用場景是
// 開新團通知，之後如果要加其他通知時機（成團定案、活動前提醒…）都可以
// 共用這支。
import { db, messaging } from './_firebaseAdmin.js';

export async function notifyOthers(excludeMemberId, notification, link) {
  const snap = await db.collection('push_subscriptions').get();
  const tokens = snap.docs
    .filter((d) => d.data().member_id !== excludeMemberId)
    .map((d) => d.id);
  if (tokens.length === 0) return;

  const res = await messaging.sendEachForMulticast({
    tokens,
    notification,
    webpush: { fcmOptions: { link: link || '/' } },
  });

  // token 過期/裝置解除訂閱會回傳特定錯誤，順便把這些訂閱清掉，避免
  // 每次發通知都對著死掉的 token 重打一次。
  const deletions = [];
  res.responses.forEach((r, i) => {
    if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error && r.error.code)) {
      deletions.push(db.collection('push_subscriptions').doc(tokens[i]).delete());
    }
  });
  if (deletions.length) await Promise.all(deletions);
}
