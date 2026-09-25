// 身分：一個頁首固定的「你是：XXX／登入」列 + 一個彈出視窗做帳號密碼登入，
// 取代原本每個頁面（event.js、games.js）各自畫一大排名字按鈕、卡在頁面
// 中間打斷操作的做法，也取代「點名字再輸密碼」——現在是正規的帳號＋密碼
// 表單，一次送出。
import { memberById } from './store.js';
import { getSelfId, clearSelfId, verifySecret, updateProfile } from './api.js';
import { escapeHtml, showToast } from './app.js';

let onIdentityChange = null;

// app.js 開機時呼叫一次：onChange 在登入狀態改變（登入成功或登出）後被
// 呼叫，通常是重新畫目前路由，因為投票、報名這些畫面都跟登入身分有關。
export function initHeaderIdentity(members, onChange) {
  onIdentityChange = onChange;
  renderHeaderIdentity();
}

// 目前沒有頁面會動態改變成員清單後需要重畫頁首，保留這個函式名稱只是
// 為了介面穩定，之後真的需要時再擴充。
export function updateHeaderIdentityMembers() {
  renderHeaderIdentity();
}

function renderHeaderIdentity() {
  const el = document.getElementById('header-identity');
  if (!el) return;
  const selfId = getSelfId();
  const member = selfId ? memberById(selfId) : null;

  if (selfId && member) {
    el.innerHTML = `
      <span>你是：<strong>${escapeHtml(member.name)}</strong></span>
      <a href="#" id="header-edit-profile-link">修改資訊</a>
      <a href="#" id="header-logout-link">登出</a>
    `;
    document.getElementById('header-logout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await clearSelfId();
      renderHeaderIdentity();
      if (onIdentityChange) onIdentityChange();
    });
    document.getElementById('header-edit-profile-link').addEventListener('click', (e) => {
      e.preventDefault();
      openProfileModal(member);
    });
    return;
  }

  el.innerHTML = `<a href="#" id="header-login-link">登入</a>`;
  document.getElementById('header-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    openIdentityModal();
  });
}

// 需要登入身分才能做的動作統一走這個：已登入就直接回傳 selfId，沒登入就
// 跳出登入視窗，成功回傳新的 selfId，取消回傳 null。
export async function requireSelfId() {
  const selfId = getSelfId();
  if (selfId) return selfId;
  const loggedIn = await openIdentityModal();
  return loggedIn ? getSelfId() : null;
}

// 彈出帳號＋密碼登入視窗。回傳 Promise<boolean>，true＝登入成功，
// false＝使用者取消。
export function openIdentityModal() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('identity-modal');
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const cancelBtn = document.getElementById('identity-modal-cancel');
    const submitBtn = document.getElementById('identity-modal-submit');

    usernameInput.value = '';
    passwordInput.value = '';
    errorEl.hidden = true;
    overlay.hidden = false;
    usernameInput.focus();

    function cleanup() {
      overlay.hidden = true;
      cancelBtn.removeEventListener('click', onCancel);
      submitBtn.removeEventListener('click', onSubmit);
      usernameInput.removeEventListener('keydown', onKeydown);
      passwordInput.removeEventListener('keydown', onKeydown);
    }
    function onCancel() {
      cleanup();
      resolve(false);
    }
    function onKeydown(e) {
      if (e.key === 'Enter') onSubmit();
      if (e.key === 'Escape') onCancel();
    }
    async function onSubmit() {
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!username) {
        errorEl.textContent = '請輸入帳號。';
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '登入中…';
      const result = await verifySecret(username, password);
      submitBtn.disabled = false;
      submitBtn.textContent = '登入';
      if (!result.ok) {
        errorEl.textContent = '帳號或密碼錯誤。';
        errorEl.hidden = false;
        return;
      }
      cleanup();
      renderHeaderIdentity();
      if (onIdentityChange) onIdentityChange();
      resolve(true);
    }

    cancelBtn.addEventListener('click', onCancel);
    submitBtn.addEventListener('click', onSubmit);
    usernameInput.addEventListener('keydown', onKeydown);
    passwordInput.addEventListener('keydown', onKeydown);
  });
}

// 彈出「修改資訊」視窗：顯示姓名／帳號／密碼都可以改，都選填（沒填就不
// 動），但要再輸入一次目前密碼確認身分。
function openProfileModal(member) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('profile-modal');
    const nameInput = document.getElementById('profile-name');
    const usernameInput = document.getElementById('profile-username');
    const passwordInput = document.getElementById('profile-password');
    const currentInput = document.getElementById('profile-current-password');
    const errorEl = document.getElementById('profile-error');
    const cancelBtn = document.getElementById('profile-modal-cancel');
    const submitBtn = document.getElementById('profile-modal-submit');

    nameInput.value = member.name || '';
    usernameInput.value = member.username || '';
    passwordInput.value = '';
    currentInput.value = '';
    errorEl.hidden = true;
    overlay.hidden = false;
    nameInput.focus();

    function cleanup() {
      overlay.hidden = true;
      cancelBtn.removeEventListener('click', onCancel);
      submitBtn.removeEventListener('click', onSubmit);
    }
    function onCancel() {
      cleanup();
      resolve(false);
    }
    async function onSubmit() {
      const current_password = currentInput.value;
      if (!current_password) {
        errorEl.textContent = '請輸入目前密碼以確認身分。';
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '儲存中…';
      const result = await updateProfile({
        current_password,
        new_name: nameInput.value.trim(),
        new_username: usernameInput.value.trim(),
        new_password: passwordInput.value,
      });
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存';
      if (!result.ok) {
        errorEl.textContent = result.error === 'BAD_SECRET' ? '目前密碼不對，沒有任何變更。'
          : result.error === 'USERNAME_TAKEN' ? '這個帳號已經有人用了。'
          : `更新失敗：${result.error}`;
        errorEl.hidden = false;
        return;
      }
      cleanup();
      renderHeaderIdentity();
      if (onIdentityChange) onIdentityChange();
      showToast('資訊已更新。');
      resolve(true);
    }

    cancelBtn.addEventListener('click', onCancel);
    submitBtn.addEventListener('click', onSubmit);
  });
}
