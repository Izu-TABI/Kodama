// Practice log for streaks: how many sentences and seconds were practiced each day.
// Kept in this browser only.

const KEY = 'shadowing:activity';

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function readActivity() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    return data && typeof data.days === 'object' ? data : { days: {} };
  } catch {
    return { days: {} };
  }
}

export function logPractice({ sentences = 0, seconds = 0 }, now = new Date()) {
  const data = readActivity();
  const day = (data.days[dayKey(now)] ??= { n: 0, s: 0 });
  day.n += sentences;
  day.s = Math.round((day.s + seconds) * 10) / 10;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  globalThis.dispatchEvent?.(new Event('shadowing:activity'));
  return data;
}

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// The streak counts back from today, or from yesterday while today is still open.
export function summarize(days, today = new Date()) {
  const practiced = d => (days[dayKey(d)]?.n ?? 0) > 0;
  let start = today;
  if (!practiced(today)) start = addDays(today, -1);
  let current = 0;
  for (let d = start; practiced(d); d = addDays(d, -1)) current++;

  const keys = Object.keys(days).filter(k => days[k].n > 0).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const recent = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i - 13);
    return { key: dayKey(d), n: days[dayKey(d)]?.n ?? 0 };
  });
  const t = days[dayKey(today)] ?? { n: 0, s: 0 };
  return { current, best, today: t, recent, totalDays: keys.length };
}
