import { randomUUID } from 'node:crypto';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const PERIOD_LABELS = { afternoon: '下午', evening: '晚上' };

export function newId() {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatSlotLabel(dateStr, period) {
  const d = new Date(`${dateStr}T00:00:00`);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  return `${m}/${day}（${wd}）${PERIOD_LABELS[period] || period}`;
}
