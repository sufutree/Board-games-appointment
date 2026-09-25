// 寫入動作的統一入口。資料庫已經全面搬到 Firestore：
// - vote / toggleSignup / toggleCollection / submitCorrection /
//   submitVenueCollection / submitTagProposal（高頻或使用者自助動作）：
//   瀏覽器直接寫 Firestore，不再打任何後端。
// - createEvent / confirm / cancelEvent / updateEventDetails / setOwnPassword /
//   addGame（低頻、邏輯較複雜的動作）：全部合併打 /api/action.js 這一支
//   Vercel Serverless Function（Vercel Hobby 方案一次部署最多 12 支
//   function，所以不是每個動作各自開一支），帶目前登入身分的 Firebase ID
//   token，用 body 的 action 欄位分派。
//
// 「本人是誰」是真正的 Firebase 登入 session（見 firebase.js），永遠是目前
// 登入的那個人在操作；不再有「登入成某個特定角色」這種事——需要特定身分
// （例如只有發起人能定案）的動作，一律由伺服器用 uid 檢查權限，前端只負責
// 「有沒有登入」，登入身分對不對是伺服器的事，前端最多把 FORBIDDEN 顯示成
// 錯誤訊息。呼叫端要先自己用 identityBar.js 的 requireSelfId() 確保已登入，
// 這裡不再自動跳登入視窗（避免循環 import：identityBar.js 已經依賴這個檔案）。
import { doc, collection, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, loginAs, getIdToken, getSelfId } from './firebase.js';
import { memberById, reloadDynamic } from './store.js';

export { getSelfId, clearSelfId } from './firebase.js';

// 帳號＋密碼登入。
export async function verifySecret(username, secret) {
  return loginAs(username, secret);
}

// 自己改自己的顯示姓名／帳號／密碼，欄位都選填（沒填就不動），但要再輸入
// 一次目前密碼確認身分。成功後重新載入 store，讓改名之類的變動馬上反映在
// 畫面上。
export async function updateProfile({ current_password, new_name, new_username, new_password }) {
  const result = await callApi('updateProfile', { current_password, new_name, new_username, new_password });
  if (result.ok) await reloadDynamic();
  return result;
}

// 執行一個寫入動作。呼叫端要先確保已經登入（identityBar.js 的
// requireSelfId()），這裡不再處理「還沒登入」的情況，只單純按 action 分派。
export async function writeAction(action, payload) {
  if (action === 'vote') return doVote(payload);
  if (action === 'toggleSignup') return doToggleSignup(payload);
  if (action === 'toggleCollection') return doToggleCollection(payload);
  if (action === 'submitCorrection') return doSubmitCorrection(payload);
  if (action === 'submitVenueCollection') return doSubmitVenueCollection(payload);
  if (action === 'submitTagProposal') return doSubmitTagProposal(payload);
  return callApi(action, payload);
}

function selfLabel() {
  const id = getSelfId();
  const m = memberById(id);
  return m ? m.name : id;
}

// 投票，member_id 一律是自己，不能幫別人投。
async function doVote(payload) {
  const { event_id, votes } = payload;
  const member_id = getSelfId();
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

// 報名／退出，member_id 一律是自己。
async function doToggleSignup(payload) {
  const { event_id, join } = payload;
  const member_id = getSelfId();
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

// 「我也有這款」／取消。holder_id 一律是自己（登入身分），不能幫別人登記。
async function doToggleCollection(payload) {
  const { bgg_id, name_zh, has } = payload;
  const holder_id = getSelfId();
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
async function doSubmitCorrection(payload) {
  const { bgg_id, field, current_value, suggested_value, note } = payload;
  try {
    const ref = doc(collection(db, 'game_corrections'));
    await setDoc(ref, {
      bgg_id, field, current_value: current_value ?? '', suggested_value, note: note || '',
      submitted_by: getSelfId(), submitted_by_name: selfLabel(),
      submitted_at: new Date().toISOString(), status: 'pending',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

// 提議「幫某個場地新增這款遊戲」，送給 admin 審核，通過才會真的登記進
// collections。跟 doSubmitCorrection 一樣：送出後不能自己再改。
async function doSubmitVenueCollection(payload) {
  const { venue_id, bgg_id, name_zh } = payload;
  try {
    const ref = doc(collection(db, 'venue_collection_requests'));
    await setDoc(ref, {
      venue_id, bgg_id, name_zh: name_zh || '',
      submitted_by: getSelfId(), submitted_by_name: selfLabel(),
      submitted_at: new Date().toISOString(), status: 'pending',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || 'FIRESTORE_ERROR' };
  }
}

// 提議一個全新的標籤，送給 admin 審核，通過才會正式變成標籤選項；如果有
// 指定 apply_to_bgg_id，通過時會順便把這個標籤加到那款遊戲上。
async function doSubmitTagProposal(payload) {
  const { label, group_code, group_label, apply_to_bgg_id } = payload;
  try {
    const ref = doc(collection(db, 'tag_proposals'));
    await setDoc(ref, {
      label, group_code: group_code || 'other', group_label: group_label || '其他',
      apply_to_bgg_id: apply_to_bgg_id ?? null,
      submitted_by: getSelfId(), submitted_by_name: selfLabel(),
      submitted_at: new Date().toISOString(), status: 'pending',
    });
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
