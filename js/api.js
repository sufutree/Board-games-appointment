// 寫入動作的統一入口。資料庫已經全面搬到 Firestore：
// - vote / toggleSignup / toggleCollection / submitCorrection /
//   submitVenueCollection（高頻或使用者自助動作）：瀏覽器直接寫 Firestore，
//   不再打任何後端。
// - createEvent / confirm / cancelEvent / updateEventDetails / setOwnPassword /
//   addGame（低頻、邏輯較複雜的動作）：全部合併打 /api/action.js 這一支
//   Vercel Serverless Function（Vercel Hobby 方案一次部署最多 12 支
//   function，所以不是每個動作各自開一支），帶目前登入身分的 Firebase ID
//   token，用 body 的 action 欄位分派。
// 「本人是誰」不再是密碼快取，而是真正的 Firebase 登入 session（見 firebase.js）。
import { doc, collection, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, loginAs, getIdToken, getSelfId } from './firebase.js';

export { getSelfId, clearSelfId } from './firebase.js';

// 跳出密碼輸入框，回傳使用者輸入的密碼（可以是空字串，代表這個人還沒設密碼）；取消則回傳 null。
export function promptPassword(memberLabel, showError) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('secret-modal');
    const desc = document.getElementById('secret-desc');
    const input = document.getElementById('secret-input');
    const errorEl = document.getElementById('secret-error');
    const confirmBtn = document.getElementById('secret-confirm');
    const cancelBtn = document.getElementById('secret-cancel');

    desc.textContent = memberLabel
      ? `請輸入「${memberLabel}」的密碼，或使用主密碼：`
      : '請輸入密碼：';
    errorEl.hidden = !showError;
    input.value = '';
    overlay.hidden = false;
    input.focus();

    function cleanup() {
      overlay.hidden = true;
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    }
    function onConfirm() {
      const val = input.value;
      cleanup();
      resolve(val);
    }
    function onCancel() {
      cleanup();
      resolve(null);
    }
    function onKeydown(e) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

// 純驗證＋登入用：用在「點自己的名字」選身分的當下。跟原本的差別是，這裡驗證
// 成功「就是」登入成功（背後會拿到一個真正的 Firebase 登入 session），不是
// 驗完之後還要另外記一次「我是誰」。
export async function verifySecret(memberId, secret) {
  return loginAs(memberId, secret);
}

// 目前登入的身分自己改自己的密碼，要再輸一次目前密碼確認。
export async function changeOwnPassword(currentPassword, newPassword) {
  return callApi('setOwnPassword', { current_password: currentPassword, new_password: newPassword });
}

// 確保目前的登入身分就是 requiredMemberId，不是的話（或還沒登入）跳密碼框、
// 用輸入的密碼登入。跟原本「密碼快取」的差別：現在同一時間只會有一個人是
// 登入狀態，換人一定要重新輸入密碼（沒有快取多人密碼這件事了）。
async function ensureLoggedInAs(requiredMemberId, memberLabel) {
  if (getSelfId() === requiredMemberId) return { ok: true };

  let secret = await promptPassword(memberLabel, false);
  if (secret == null) return { ok: false, error: 'CANCELLED' };

  let result = await loginAs(requiredMemberId, secret);
  while (!result.ok && result.error === 'BAD_SECRET') {
    secret = await promptPassword(memberLabel, true);
    if (secret == null) return { ok: false, error: 'CANCELLED' };
    result = await loginAs(requiredMemberId, secret);
  }
  return result;
}

// 執行一個需要登入身分的寫入動作。
// requiredMemberId：這個動作「本人」是誰（投票者、報名/退出者、發起人…）。
// memberLabel：該成員的顯示名稱，用在密碼輸入框的提示文字。
export async function writeAction(action, payload, requiredMemberId, memberLabel) {
  const authResult = await ensureLoggedInAs(requiredMemberId, memberLabel);
  if (!authResult.ok) return authResult;

  if (action === 'vote') return doVote(payload);
  if (action === 'toggleSignup') return doToggleSignup(payload);
  if (action === 'toggleCollection') return doToggleCollection(payload);
  if (action === 'submitCorrection') return doSubmitCorrection(payload, requiredMemberId, memberLabel);
  if (action === 'submitVenueCollection') return doSubmitVenueCollection(payload, requiredMemberId, memberLabel);
  if (action === 'submitTagProposal') return doSubmitTagProposal(payload, requiredMemberId, memberLabel);
  return callApi(action, payload);
}

// 「我也有這款」／取消。holder_id 一律是自己（登入身分），不能幫別人登記。
async function doToggleCollection(payload) {
  const { holder_id, bgg_id, name_zh, has } = payload;
  const docId = `${holder_id}_${bgg_id}`;
  try {
    if (has) {
      await setDoc(doc(db, 'collections', docId), { holder_id, bgg_id, name_zh: name_zh || '', note: '' });
    } else {
      await deleteDoc(doc(db, 'collections', docId));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

// 回報遊戲資料可能有誤，送給 admin 審核。送出後不能自己再改。
async function doSubmitCorrection(payload, submittedBy, submittedByName) {
  const { bgg_id, field, current_value, suggested_value, note } = payload;
  try {
    const ref = doc(collection(db, 'game_corrections'));
    await setDoc(ref, {
      bgg_id, field, current_value: current_value ?? '', suggested_value, note: note || '',
      submitted_by: submittedBy, submitted_by_name: submittedByName || submittedBy,
      submitted_at: new Date().toISOString(), status: 'pending',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

// 提議「幫某個場地新增這款遊戲」，送給 admin 審核，通過才會真的登記進
// collections。跟 doSubmitCorrection 一樣：送出後不能自己再改。
async function doSubmitVenueCollection(payload, submittedBy, submittedByName) {
  const { venue_id, bgg_id, name_zh } = payload;
  try {
    const ref = doc(collection(db, 'venue_collection_requests'));
    await setDoc(ref, {
      venue_id, bgg_id, name_zh: name_zh || '',
      submitted_by: submittedBy, submitted_by_name: submittedByName || submittedBy,
      submitted_at: new Date().toISOString(), status: 'pending',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

// 提議一個全新的標籤，送給 admin 審核，通過才會正式變成標籤選項；如果有
// 指定 apply_to_bgg_id，通過時會順便把這個標籤加到那款遊戲上。
async function doSubmitTagProposal(payload, submittedBy, submittedByName) {
  const { label, group_code, group_label, apply_to_bgg_id } = payload;
  try {
    const ref = doc(collection(db, 'tag_proposals'));
    await setDoc(ref, {
      label, group_code: group_code || 'other', group_label: group_label || '其他',
      apply_to_bgg_id: apply_to_bgg_id ?? null,
      submitted_by: submittedBy, submitted_by_name: submittedByName || submittedBy,
      submitted_at: new Date().toISOString(), status: 'pending',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

async function doVote(payload) {
  const { event_id, member_id, votes } = payload;
  try {
    for (const v of votes) {
      const docId = `${event_id}_${v.slot_id}_${member_id}`;
      await setDoc(doc(db, 'votes', docId), {
        event_id, slot_id: v.slot_id, member_id, ok: v.ok, updated_at: new Date().toISOString(),
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

async function doToggleSignup(payload) {
  const { event_id, member_id, join } = payload;
  const docId = `${event_id}_${member_id}`;
  try {
    if (join) {
      await setDoc(doc(db, 'signups', docId), { event_id, member_id, joined_at: new Date().toISOString() });
    } else {
      await deleteDoc(doc(db, 'signups', docId));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

async function callApi(action, payload) {
  const token = await getIdToken();
  if (!token) return { ok: false, error: 'UNAUTHENTICATED' };
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'NETWORK_ERROR' };
  }
}
