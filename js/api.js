// Apps Script 讀寫封裝。
const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzl2oHDC3sr6Yr3E71ZfqYbXff1LMWMiMoAEsRZqTXrn01g6KM9aEDIGEgXsELHoAz0aw/exec';

// 開發用：網址加 ?api=http://localhost:8788 可暫時指向本機模擬後端（見 scripts/dev-mock-server.mjs），
// 不用改這個檔案就能在正式網址設定好之前先預覽整個流程。正式部署不要帶這個參數即可。
const devApiOverride = new URLSearchParams(location.search).get('api');
export const APPS_SCRIPT_URL = devApiOverride || DEFAULT_APPS_SCRIPT_URL;

// 權限模型：每個成員有自己的密碼（存在 Sheets members 分頁的 password 欄），
// 只有 Sufu 知道的主密碼（固定值，見 apps-script/Code.gs 的 MASTER_PASSWORD）可以做任何人的任何動作。
// 每個寫入動作都對應一個「本人」member_id：投票/報名是操作者自己，開團/定案/取消是發起人。
//
// 「我是誰」（畫面顯示用）跟「密碼快取」是兩件分開的事：
// - SELF_ID_KEY 只存目前選定顯示用的 member id。
// - KNOWN_SECRETS_KEY 存這台裝置上「曾經驗證成功過」的每一個人的密碼，不限於目前選定的自己。
//   任何一個動作只要曾經對某個 member_id 輸對過密碼，之後不管是誰在畫面上被選為「自己」，
//   只要動作需要那個 member_id 的密碼，都不會再問一次。
const SELF_ID_KEY = 'bgt_self_id';
const KNOWN_SECRETS_KEY = 'bgt_known_secrets'; // { [member_id]: secret }

export function getSelfId() {
  try {
    return localStorage.getItem(SELF_ID_KEY) || '';
  } catch {
    return '';
  }
}

export function setSelfId(memberId) {
  try {
    localStorage.setItem(SELF_ID_KEY, memberId);
  } catch {
    // localStorage 不可用時忽略，之後的動作會改成每次詢問密碼。
  }
}

export function clearSelfId() {
  try {
    localStorage.removeItem(SELF_ID_KEY);
  } catch {
    // ignore
  }
}

function getKnownSecrets() {
  try {
    return JSON.parse(localStorage.getItem(KNOWN_SECRETS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getKnownSecret(memberId) {
  const secrets = getKnownSecrets();
  return Object.prototype.hasOwnProperty.call(secrets, memberId) ? secrets[memberId] : null;
}

export function rememberSecret(memberId, secret) {
  try {
    const secrets = getKnownSecrets();
    secrets[memberId] = secret;
    localStorage.setItem(KNOWN_SECRETS_KEY, JSON.stringify(secrets));
  } catch {
    // ignore
  }
}

export function forgetSecret(memberId) {
  try {
    const secrets = getKnownSecrets();
    delete secrets[memberId];
    localStorage.setItem(KNOWN_SECRETS_KEY, JSON.stringify(secrets));
  } catch {
    // ignore
  }
}

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

export async function bootstrap() {
  const res = await fetch(`${APPS_SCRIPT_URL}?action=bootstrap`);
  if (!res.ok) throw new Error('NETWORK_ERROR');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'UNKNOWN_ERROR');
  return data;
}

// 執行一個需要密碼的寫入動作。payload 不含 action/secret，由這裡補上。
// requiredMemberId：這個動作「本人」是誰（投票者、報名/退出者、發起人…）。
// memberLabel：該成員的顯示名稱，用在密碼輸入框的提示文字。
// 只要 requiredMemberId 這個人之前在這台裝置上輸對過密碼，就直接用快取的密碼，不用再問。
export async function writeAction(action, payload, requiredMemberId, memberLabel) {
  let secret = getKnownSecret(requiredMemberId);

  if (secret == null) {
    secret = await promptPassword(memberLabel, false);
    if (secret == null) return { ok: false, error: 'CANCELLED' };
  }

  let result = await postOnce(action, payload, secret);

  if (!result.ok && result.error === 'BAD_SECRET') {
    forgetSecret(requiredMemberId);
    secret = await promptPassword(memberLabel, true);
    if (secret == null) return { ok: false, error: 'CANCELLED' };
    result = await postOnce(action, payload, secret);
  }

  if (result.ok) rememberSecret(requiredMemberId, secret);

  return result;
}

async function postOnce(action, payload, secret) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, secret, ...payload }),
    });
    if (!res.ok) return { ok: false, error: 'NETWORK_ERROR' };
    return await res.json();
  } catch {
    return { ok: false, error: 'NETWORK_ERROR' };
  }
}
