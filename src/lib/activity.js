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
  const t = days[dayKey(today)] ?? { n: 0, s: 0 };
  return { current, best, today: t, totalDays: keys.length };
}

// Darker squares for more sentences, like GitHub's contribution graph.
export const levelOf = n => (n <= 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : n < 60 ? 3 : 4);

// About a year as GitHub draws it: one column per week (Sunday first), the
// last column holding today; days after today are left out.
export function calendar(days, today = new Date(), weeks = 53) {
  const end = new Date(today);
  end.setHours(12, 0, 0, 0);
  const start = addDays(end, -end.getDay() - (weeks - 1) * 7);
  const columns = [];
  let practiced = 0, sentences = 0;
  for (let w = 0; w < weeks; w++) {
    const column = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const key = dayKey(date);
      const future = date > end;
      const n = future ? 0 : days[key]?.n ?? 0;
      if (n > 0) { practiced++; sentences += n; }
      column.push({ key, n, level: levelOf(n), future, month: date.getMonth() + 1, day: date.getDate() });
    }
    columns.push(column);
  }
  // A month is labelled at the first week that starts in it; a label with
  // no room before the next one is dropped.
  const months = [];
  columns.forEach((column, i) => {
    if (i === 0 || column[0].month !== columns[i - 1][0].month) months.push({ column: i, label: `${column[0].month}月` });
  });
  if (months.length > 1 && months[1].column - months[0].column < 3) months.shift();
  return { columns, months, practiced, sentences };
}
