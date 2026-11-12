const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return validDate(value < 1e12 ? value * 1000 : value);
  }
  const numeric = Number(value);
  if (String(value).trim() !== '' && Number.isFinite(numeric) && numeric > 0) {
    return validDate(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  return validDate(value);
}

function beijingDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function beijingHeader(date = new Date()) {
  const day = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', weekday: 'short'
  }).format(date);
  return beijingDate(date) + ' ' + day;
}

function formatBeijingTime(value) {
  const date = parseTimestamp(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function inWindow(date, now = new Date(), hours = 24) {
  if (!date) return false;
  const ts = date.getTime();
  return ts <= now.getTime() + 5 * 60 * 1000 &&
    ts >= now.getTime() - hours * 60 * 60 * 1000;
}

module.exports = { DAY_MS, parseTimestamp, beijingDate, beijingHeader, formatBeijingTime, inWindow };
