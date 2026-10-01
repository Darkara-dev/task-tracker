// Все даты считаем по Москве, храним как 'YYYY-MM-DD'

export function todayMsk() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatRu(iso) {
  if (!iso) return 'без срока';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function toIso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// "15.10", "15.10.26", "15.10.2026", "15/10" -> 'YYYY-MM-DD' или null
export function parseRuDate(text) {
  const m = String(text).trim().match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2}|\d{4}))?$/);
  if (!m) return null;
  const day = +m[1], mon = +m[2];
  let year = m[3] ? +m[3] : null;
  if (year !== null && year < 100) year += 2000;
  const today = todayMsk();
  if (year === null) {
    year = +today.slice(0, 4);
    const cand = toIso(year, mon, day);
    if (cand && cand < today) year += 1; // дата уже прошла — значит, следующий год
  }
  return toIso(year, mon, day);
}
