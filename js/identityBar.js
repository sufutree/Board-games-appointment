// 身分選擇：一個頁首固定的「你是：XXX／登入」列 + 一個彈出視窗選成員，
// 取代原本每個頁面（event.js、games.js）各自畫一大排名字按鈕、卡在頁面
// 中間打斷操作的做法。選完就把視窗收起來，不佔用頁面版面。
import { memberById } from './store.js';
import { getSelfId, clearSelfId, verifySecret, promptPassword } from './api.js';
import { escapeHtml } from './app.js';

let currentMembers = [];
let onIdentityChange = null;

// app.js 開機時呼叫一次：members 是完整成員清單，onChange 在登入狀態改變
// （登入成功或登出）後被呼叫，通常是重新畫目前路由，因為投票、報名這些
// 畫面都跟登入身分有關。
export function initHeaderIdentity(members, onChange) {
  currentMembers = members;
  onIdentityChange = onChange;
  renderHeaderIdentity();
}

// 成員名單變動（例如 admin 新增/刪除成員）後呼叫，讓彈出視窗的選項跟著更新。
export function updateHeaderIdentityMembers(members) {
  currentMembers = members;
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
      <a href="#" id="header-logout-link">登出</a>
    `;
    document.getElementById('header-logout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await clearSelfId();
      renderHeaderIdentity();
      if (onIdentityChange) onIdentityChange();
    });
    return;
  }

  el.innerHTML = `<a href="#" id="header-login-link">登入</a>`;
  document.getElementById('header-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    openIdentityModal();
  });
}

// 彈出「你是哪一位？」視窗。回傳 Promise<boolean>，true＝登入成功，
// false＝使用者取消。呼叫端（event.js／games.js 裡「請先登入」的連結）
// 可以自己 await 這個結果決定要不要重畫畫面。
export function openIdentityModal() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('identity-modal');
    const listEl = document.getElementById('identity-modal-list');
    const cancelBtn = document.getElementById('identity-modal-cancel');

    listEl.innerHTML = currentMembers.map((m) => `
      <button type="button" class="btn btn-sm" data-member-id="${escapeHtml(m.id)}">${escapeHtml(m.name)}</button>
    `).join('');
    overlay.hidden = false;

    function finish(result) {
      overlay.hidden = true;
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onCancel() {
      finish(false);
    }
    cancelBtn.addEventListener('click', onCancel);

    listEl.querySelectorAll('button[data-member-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const memberId = btn.dataset.memberId;
        const member = memberById(memberId);
        const label = member ? member.name : memberId;
        const allButtons = listEl.querySelectorAll('button[data-member-id]');

        let password = await promptPassword(label, false);
        if (password == null) return; // 使用者取消密碼框，留在選人清單

        allButtons.forEach((b) => { b.disabled = true; });
        btn.textContent = `${label}（驗證中…）`;

        let result = await verifySecret(memberId, password);
        while (!result.ok) {
          password = await promptPassword(label, true);
          if (password == null) {
            allButtons.forEach((b) => { b.disabled = false; });
            btn.textContent = label;
            return;
          }
          btn.textContent = `${label}（驗證中…）`;
          result = await verifySecret(memberId, password);
        }

        renderHeaderIdentity();
        if (onIdentityChange) onIdentityChange();
        finish(true);
      });
    });
  });
}
