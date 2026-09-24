// 簡易後台：新增成員、重設密碼。取代原本直接編輯 Sheets members 分頁的做法。
// 只認主密碼，跟一般使用者的 Firebase 登入身分無關，所以不放進主導覽列，
// 知道網址（#/admin）的人才會用到。
import { activeMembers, reloadDynamic } from '../store.js';
import { escapeHtml, showToast } from '../app.js';

const ADMIN_ERROR_LABELS = {
  BAD_MASTER_PASSWORD: '主密碼錯誤。',
  ALREADY_EXISTS: '已經有同名成員了，換一個名字或直接用「重設密碼」。',
  MEMBER_NOT_FOUND: '找不到這個成員。',
  MISSING_NAME: '請輸入姓名。',
  MISSING_MEMBER_ID: '請選擇成員。',
};

export async function renderAdmin(appEl) {
  const members = activeMembers();

  appEl.innerHTML = `
    <h1 class="page-title">管理</h1>
    <div class="form-group">
      <label class="form-label" for="admin-master">主密碼</label>
      <input type="password" class="form-control" id="admin-master" placeholder="輸入主密碼才能操作" autocomplete="off">
    </div>

    <div class="card">
      <div class="section-title">新增成員</div>
      <div class="form-group">
        <label class="form-label" for="new-member-name">姓名</label>
        <input class="form-control" id="new-member-name" placeholder="會同時當作識別 id，之後不能改">
      </div>
      <div class="form-group">
        <label class="form-label" for="new-member-password">初始密碼（選填）</label>
        <input class="form-control" id="new-member-password" placeholder="留空＝這個人第一次登入不用密碼">
      </div>
      <p id="add-member-error" class="error-text" hidden></p>
      <button type="button" id="add-member-btn" class="btn btn-primary btn-sm">新增</button>
    </div>

    <div class="card">
      <div class="section-title">重設密碼</div>
      ${members.length === 0 ? '<p class="card-meta">目前沒有成員。</p>' : `
        <div class="form-group">
          <label class="form-label" for="reset-member-select">成員</label>
          <select class="form-control" id="reset-member-select">
            ${members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="reset-member-password">新密碼</label>
          <input class="form-control" id="reset-member-password" placeholder="留空＝清空密碼，下次登入不用密碼">
        </div>
        <p id="reset-password-error" class="error-text" hidden></p>
        <button type="button" id="reset-password-btn" class="btn btn-primary btn-sm">更新</button>
      `}
    </div>
  `;

  const masterInput = document.getElementById('admin-master');

  document.getElementById('add-member-btn').addEventListener('click', async () => {
    const errorEl = document.getElementById('add-member-error');
    errorEl.hidden = true;
    const name = document.getElementById('new-member-name').value.trim();
    if (!name) {
      errorEl.textContent = ADMIN_ERROR_LABELS.MISSING_NAME;
      errorEl.hidden = false;
      return;
    }

    const btn = document.getElementById('add-member-btn');
    btn.disabled = true;
    btn.textContent = '處理中…';
    let data;
    try {
      const res = await fetch('/api/adminAddMember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_password: masterInput.value,
          member_id: name,
          name,
          password: document.getElementById('new-member-password').value,
        }),
      });
      data = await res.json();
    } catch {
      data = { ok: false, error: 'NETWORK_ERROR' };
    }
    btn.disabled = false;
    btn.textContent = '新增';
    if (!data.ok) {
      errorEl.textContent = ADMIN_ERROR_LABELS[data.error] || `新增失敗：${data.error}`;
      errorEl.hidden = false;
      return;
    }
    await reloadDynamic();
    showToast(`已新增「${name}」。`);
    renderAdmin(appEl);
  });

  const resetBtn = document.getElementById('reset-password-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const errorEl = document.getElementById('reset-password-error');
      errorEl.hidden = true;
      const memberId = document.getElementById('reset-member-select').value;

      resetBtn.disabled = true;
      resetBtn.textContent = '處理中…';
      let data;
      try {
        const res = await fetch('/api/adminSetPassword', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            master_password: masterInput.value,
            member_id: memberId,
            new_password: document.getElementById('reset-member-password').value,
          }),
        });
        data = await res.json();
      } catch {
        data = { ok: false, error: 'NETWORK_ERROR' };
      }
      resetBtn.disabled = false;
      resetBtn.textContent = '更新';
      if (!data.ok) {
        errorEl.textContent = ADMIN_ERROR_LABELS[data.error] || `更新失敗：${data.error}`;
        errorEl.hidden = false;
        return;
      }
      showToast('密碼已更新。');
      document.getElementById('reset-member-password').value = '';
    });
  }
}
