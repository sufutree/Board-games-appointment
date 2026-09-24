// 共用的「你是：xxx／請先點選你的名字」身分選擇元件。原本只有 event.js
// 有這段邏輯；games.js 要做「使用者自建遊戲」也需要知道操作者是誰，所以
// 把這段抽出來共用。
import { memberById } from './store.js';
import { getSelfId, clearSelfId, verifySecret, promptPassword } from './api.js';
import { escapeHtml } from './app.js';

// container：要畫進去的 DOM 元素。members：可選的成員清單。
// onChange：身分改變（登入成功或登出）後呼叫，通常用來 rerender 整個畫面。
export function renderIdentityBar(container, members, onChange) {
  const selfId = getSelfId();
  const selfIsValid = members.some((m) => m.id === selfId);

  if (selfIsValid) {
    const m = memberById(selfId);
    container.innerHTML = `
      <div class="identity-bar">
        <span>你是：<strong>${escapeHtml(m ? m.name : selfId)}</strong></span>
        <a href="#" id="not-me-link">不是我？</a>
      </div>
    `;
    container.querySelector('#not-me-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await clearSelfId();
      onChange();
    });
    return;
  }

  container.innerHTML = `
    <div class="identity-bar" style="flex-direction: column; align-items: stretch;">
      <span>請先點選你的名字：</span>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${members.map((m) => `<button type="button" class="btn btn-sm" data-member-id="${escapeHtml(m.id)}">${escapeHtml(m.name)}</button>`).join('')}
      </div>
    </div>
  `;
  container.querySelectorAll('button[data-member-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const memberId = btn.dataset.memberId;
      const member = memberById(memberId);
      const label = member ? member.name : memberId;
      const allButtons = container.querySelectorAll('button[data-member-id]');

      let password = await promptPassword(label, false);
      if (password == null) return; // 使用者取消，留在選擇畫面

      allButtons.forEach((b) => { b.disabled = true; });
      btn.textContent = `${label}（驗證中…）`;

      let result = await verifySecret(memberId, password);
      while (!result.ok) {
        password = await promptPassword(label, true);
        if (password == null) {
          allButtons.forEach((b) => { b.disabled = false; });
          btn.textContent = label;
          return; // 使用者取消，留在選擇畫面
        }
        btn.textContent = `${label}（驗證中…）`;
        result = await verifySecret(memberId, password);
      }

      onChange();
    });
  });
}
