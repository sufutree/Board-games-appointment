// 簡易後台：新增成員、重設密碼、審核使用者回報的遊戲資料訂正。取代原本
// 直接編輯 Sheets members 分頁的做法。只認主密碼，跟一般使用者的 Firebase
// 登入身分無關，所以不放進主導覽列，知道網址（#/admin）的人才會用到。
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { activeMembers, activeVenues, reloadDynamic, getGameMeta } from '../store.js';
import { db } from '../firebase.js';
import { CATEGORY_LABELS } from '../rules.js';
import { escapeHtml, showToast } from '../app.js';

const ADMIN_ERROR_LABELS = {
  BAD_MASTER_PASSWORD: '主密碼錯誤。',
  ALREADY_EXISTS: '已經有同名成員了，換一個名字或直接用「重設密碼」。',
  MEMBER_NOT_FOUND: '找不到這個成員。',
  MISSING_NAME: '請輸入姓名。',
  MISSING_MEMBER_ID: '請選擇成員。',
};

const CORRECTION_FIELD_LABELS = {
  name_zh: '中文名稱', category: '分類', min_players: '最少人數',
  max_players: '最多人數', playing_time: '遊玩時間（分鐘）', is_expansion: '是否為擴充', other: '其他',
};

function correctionValueLabel(field, value) {
  if (field === 'category') return CATEGORY_LABELS[value] || value;
  if (field === 'is_expansion') return value === 'true' || value === true ? '是' : '否';
  return value;
}

// 主密碼存在 sessionStorage：每個成功動作都會整頁重畫一次（renderAdmin
// 重寫 innerHTML），如果不存起來，密碼欄每次都會被清空，變成每按一次
// 按鈕就要重打一次密碼。分頁關閉就會清掉，不是永久記住。
const MASTER_STORAGE_KEY = 'bgt_admin_master';
function getSavedMaster() {
  try {
    return sessionStorage.getItem(MASTER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}
function saveMaster(value) {
  try {
    sessionStorage.setItem(MASTER_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

export async function renderAdmin(appEl) {
  const members = activeMembers();
  const venues = activeVenues();
  const [correctionsSnap, venueReqSnap] = await Promise.all([
    getDocs(query(collection(db, 'game_corrections'), where('status', '==', 'pending'))),
    getDocs(query(collection(db, 'venue_collection_requests'), where('status', '==', 'pending'))),
  ]);
  const pendingCorrections = correctionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const pendingVenueRequests = venueReqSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  appEl.innerHTML = `
    <h1 class="page-title">管理</h1>
    <div class="form-group">
      <label class="form-label" for="admin-master">主密碼</label>
      <input type="password" class="form-control" id="admin-master" placeholder="輸入主密碼才能操作" autocomplete="off" value="${escapeHtml(getSavedMaster())}">
    </div>

    <div class="card">
      <div class="section-title">待審核的資料訂正（${pendingCorrections.length}）</div>
      ${pendingCorrections.length === 0 ? '<p class="card-meta">目前沒有待審核的項目。</p>' : pendingCorrections.map((c) => {
        const meta = getGameMeta(c.bgg_id);
        return `
          <div class="card" style="margin-bottom:8px;">
            <div class="card-meta">遊戲：${escapeHtml(meta.name_zh || meta.name_en || String(c.bgg_id))}</div>
            <div class="card-meta">欄位：${escapeHtml(CORRECTION_FIELD_LABELS[c.field] || c.field)}</div>
            ${c.field !== 'other' ? `
              <div class="card-meta">目前：${escapeHtml(correctionValueLabel(c.field, c.current_value) || '（空）')} → 建議：${escapeHtml(correctionValueLabel(c.field, c.suggested_value))}</div>
            ` : ''}
            ${c.note ? `<div class="card-meta">備註：${escapeHtml(c.note)}</div>` : ''}
            <div class="card-meta">回報人：${escapeHtml(c.submitted_by_name || c.submitted_by)}</div>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button type="button" class="btn btn-sm btn-primary" data-correction-id="${escapeHtml(c.id)}" data-correction-action="approve">通過</button>
              <button type="button" class="btn btn-sm btn-ghost" data-correction-id="${escapeHtml(c.id)}" data-correction-action="reject">駁回</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="card">
      <div class="section-title">待審核的場地收藏提議（${pendingVenueRequests.length}）</div>
      ${pendingVenueRequests.length === 0 ? '<p class="card-meta">目前沒有待審核的項目。</p>' : pendingVenueRequests.map((r) => {
        const meta = getGameMeta(r.bgg_id);
        const venue = venues.find((v) => v.id === r.venue_id);
        return `
          <div class="card" style="margin-bottom:8px;">
            <div class="card-meta">場地：${escapeHtml(venue ? venue.name : r.venue_id)}</div>
            <div class="card-meta">遊戲：${escapeHtml(meta.name_zh || meta.name_en || String(r.bgg_id))}</div>
            <div class="card-meta">提議人：${escapeHtml(r.submitted_by_name || r.submitted_by)}</div>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button type="button" class="btn btn-sm btn-primary" data-venuereq-id="${escapeHtml(r.id)}" data-venuereq-action="approve">通過</button>
              <button type="button" class="btn btn-sm btn-ghost" data-venuereq-id="${escapeHtml(r.id)}" data-venuereq-action="reject">駁回</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="card">
      <div class="section-title">新增地點</div>
      <div class="form-group">
        <label class="form-label" for="new-venue-name">名稱</label>
        <input class="form-control" id="new-venue-name" placeholder="會同時當作識別 id，之後不能改">
      </div>
      <div class="form-group">
        <label class="form-label">開放名單（誰能開這個場地，不選＝誰都能選）</label>
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          ${members.map((m) => `
            <label style="display:flex; align-items:center; gap:4px;">
              <input type="checkbox" class="new-venue-unlock-member" value="${escapeHtml(m.id)}"> ${escapeHtml(m.name)}
            </label>
          `).join('')}
        </div>
      </div>
      <p id="add-venue-error" class="error-text" hidden></p>
      <button type="button" id="add-venue-btn" class="btn btn-primary btn-sm">新增</button>
    </div>

    <div class="card">
      <div class="section-title">刪除地點</div>
      ${venues.length === 0 ? '<p class="card-meta">目前沒有地點。</p>' : `
        <div class="form-group">
          <label class="form-label" for="delete-venue-select">地點</label>
          <select class="form-control" id="delete-venue-select">
            ${venues.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name)}</option>`).join('')}
          </select>
        </div>
        <p class="form-hint">歷史事件裡引用這個地點的紀錄不會被清掉，只是之後會顯示「場地已刪除」。</p>
        <p id="delete-venue-error" class="error-text" hidden></p>
        <button type="button" id="delete-venue-btn" class="btn btn-danger btn-sm">刪除</button>
      `}
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

    <div class="card">
      <div class="section-title">刪除成員</div>
      ${members.length === 0 ? '<p class="card-meta">目前沒有成員。</p>' : `
        <div class="form-group">
          <label class="form-label" for="delete-member-select">成員</label>
          <select class="form-control" id="delete-member-select">
            ${members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </div>
        <p class="form-hint">會把這個人跟密碼一起刪掉。歷史投票/報名紀錄不會被清掉，只是之後畫面上會顯示查無此人。</p>
        <p id="delete-member-error" class="error-text" hidden></p>
        <button type="button" id="delete-member-btn" class="btn btn-danger btn-sm">刪除</button>
      `}
    </div>
  `;

  const masterInput = document.getElementById('admin-master');
  masterInput.addEventListener('input', () => saveMaster(masterInput.value));

  document.querySelectorAll('button[data-correction-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      let data;
      try {
        const res = await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            master_password: masterInput.value,
            op: 'reviewCorrection',
            correction_id: btn.dataset.correctionId,
            action: btn.dataset.correctionAction,
          }),
        });
        data = await res.json();
      } catch {
        data = { ok: false, error: 'NETWORK_ERROR' };
      }
      if (!data.ok) {
        btn.disabled = false;
        showToast(ADMIN_ERROR_LABELS[data.error] || `處理失敗：${data.error}`);
        return;
      }
      await reloadDynamic();
      showToast(btn.dataset.correctionAction === 'approve' ? '已通過並更新資料。' : '已駁回。');
      renderAdmin(appEl);
    });
  });

  document.querySelectorAll('button[data-venuereq-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      let data;
      try {
        const res = await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            master_password: masterInput.value,
            op: 'reviewVenueCollection',
            request_id: btn.dataset.venuereqId,
            action: btn.dataset.venuereqAction,
          }),
        });
        data = await res.json();
      } catch {
        data = { ok: false, error: 'NETWORK_ERROR' };
      }
      if (!data.ok) {
        btn.disabled = false;
        showToast(ADMIN_ERROR_LABELS[data.error] || `處理失敗：${data.error}`);
        return;
      }
      await reloadDynamic();
      showToast(btn.dataset.venuereqAction === 'approve' ? '已通過並登記進場地收藏。' : '已駁回。');
      renderAdmin(appEl);
    });
  });

  document.getElementById('add-venue-btn').addEventListener('click', async () => {
    const errorEl = document.getElementById('add-venue-error');
    errorEl.hidden = true;
    const name = document.getElementById('new-venue-name').value.trim();
    if (!name) {
      errorEl.textContent = '請輸入名稱。';
      errorEl.hidden = false;
      return;
    }
    const unlockIds = [...document.querySelectorAll('.new-venue-unlock-member:checked')].map((el) => el.value);

    const btn = document.getElementById('add-venue-btn');
    btn.disabled = true;
    btn.textContent = '處理中…';
    let data;
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ master_password: masterInput.value, op: 'addVenue', name, unlock_member_ids: unlockIds }),
      });
      data = await res.json();
    } catch {
      data = { ok: false, error: 'NETWORK_ERROR' };
    }
    btn.disabled = false;
    btn.textContent = '新增';
    if (!data.ok) {
      errorEl.textContent = data.error === 'ALREADY_EXISTS' ? '已經有同名地點了。' : (ADMIN_ERROR_LABELS[data.error] || `新增失敗：${data.error}`);
      errorEl.hidden = false;
      return;
    }
    await reloadDynamic();
    showToast(`已新增「${name}」。`);
    renderAdmin(appEl);
  });

  const deleteVenueBtn = document.getElementById('delete-venue-btn');
  if (deleteVenueBtn) {
    deleteVenueBtn.addEventListener('click', async () => {
      const errorEl = document.getElementById('delete-venue-error');
      errorEl.hidden = true;
      const venueId = document.getElementById('delete-venue-select').value;
      const venue = venues.find((v) => v.id === venueId);
      if (!confirm(`確定要刪除「${venue ? venue.name : venueId}」嗎？這個動作沒辦法復原。`)) return;

      deleteVenueBtn.disabled = true;
      deleteVenueBtn.textContent = '處理中…';
      let data;
      try {
        const res = await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ master_password: masterInput.value, op: 'deleteVenue', venue_id: venueId }),
        });
        data = await res.json();
      } catch {
        data = { ok: false, error: 'NETWORK_ERROR' };
      }
      deleteVenueBtn.disabled = false;
      deleteVenueBtn.textContent = '刪除';
      if (!data.ok) {
        errorEl.textContent = ADMIN_ERROR_LABELS[data.error] || `刪除失敗：${data.error}`;
        errorEl.hidden = false;
        return;
      }
      await reloadDynamic();
      showToast(`已刪除「${venue ? venue.name : venueId}」。`);
      renderAdmin(appEl);
    });
  }

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
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_password: masterInput.value,
          op: 'addMember',
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
        const res = await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            master_password: masterInput.value,
            op: 'setPassword',
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

  const deleteBtn = document.getElementById('delete-member-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const errorEl = document.getElementById('delete-member-error');
      errorEl.hidden = true;
      const memberId = document.getElementById('delete-member-select').value;
      const member = members.find((m) => m.id === memberId);
      if (!confirm(`確定要刪除「${member ? member.name : memberId}」嗎？這個動作沒辦法復原。`)) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = '處理中…';
      let data;
      try {
        const res = await fetch('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ master_password: masterInput.value, op: 'deleteMember', member_id: memberId }),
        });
        data = await res.json();
      } catch {
        data = { ok: false, error: 'NETWORK_ERROR' };
      }
      deleteBtn.disabled = false;
      deleteBtn.textContent = '刪除';
      if (!data.ok) {
        errorEl.textContent = ADMIN_ERROR_LABELS[data.error] || `刪除失敗：${data.error}`;
        errorEl.hidden = false;
        return;
      }
      await reloadDynamic();
      showToast(`已刪除「${member ? member.name : memberId}」。`);
      renderAdmin(appEl);
    });
  }
}
