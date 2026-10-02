// Turns timed words into practice sentences: [{ start, end, text }].

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m', 'no', 'vol', 'approx']);

export function isSentenceEnd(word) {
  const w = word.trim().replace(/["'”’)\]]+$/, '');
  if (!/[.?!…]$/.test(w)) return false;
  if (/[?!…]$/.test(w)) return true;
  const stem = w.slice(0, -1).toLowerCase().replace(/^["'“‘(]+/, '');
  if (ABBREVIATIONS.has(stem)) return false;
  if (/^[a-z]$/.test(stem)) return false; // an initial like "J."
  return true;
}

const isClauseEnd = word => /[,;:—–]$/.test(word.trim().replace(/["'”’)]+$/, ''));

// Spreads each line's duration over its words in proportion to their length.
export function linesToWords(lines, duration) {
  const words = [];
  lines.forEach((line, i) => {
    const next = lines[i + 1];
    const tokens = line.text.split(/\s+/).filter(Boolean);
    if (!tokens.length) return;
    const estimate = line.start + Math.max(1.5, line.text.length * 0.07);
    let end = line.end ?? next?.start ?? (duration ? Math.min(duration, estimate) : estimate);
    if (next && end > next.start) end = next.start;
    if (end <= line.start) end = line.start + 0.3 * tokens.length;
    const total = tokens.reduce((n, t) => n + t.length + 1, 0);
    let t = line.start;
    for (const token of tokens) {
      const d = ((end - line.start) * (token.length + 1)) / total;
      words.push({ text: token, start: t, end: t + d });
      t += d;
    }
  });
  return words;
}

const PAD_BEFORE = 0.15;
const PAD_AFTER = 0.35;

export function wordsToSegments(words, { maxDuration = 8, minDuration = 1.5, pauseGap = 1.2, duration } = {}) {
  const groups = [];
  let buf = [];
  const span = (from, to = buf.length - 1) => buf[to].end - buf[from].start;
  const flush = (count = buf.length) => {
    if (count > 0) groups.push(buf.slice(0, count));
    buf = buf.slice(count);
  };

  for (const word of [...words].sort((x, y) => x.start - y.start)) {
    const text = word.text.trim();
    if (!text) continue;
    const w = { ...word, text };
    const last = buf[buf.length - 1];
    if (last && w.start - last.end > pauseGap && span(0) >= minDuration) flush();
    buf.push(w);
    if (isSentenceEnd(text)) { flush(); continue; }
    if (span(0) > maxDuration) {
      // Too long without a full stop: cut at the last clause boundary, else here.
      let cut = -1;
      for (let k = buf.length - 2; k > 0; k--) {
        if (isClauseEnd(buf[k].text) && span(0, k) >= minDuration) { cut = k + 1; break; }
      }
      flush(cut > 0 ? cut : buf.length);
    }
  }
  flush();

  // Pad each sentence into the silence around it. When two sentences nearly touch,
  // share the gap, giving most of it to the earlier one (word end times run early).
  const bounds = groups.map(g => ({ start: g[0].start - PAD_BEFORE, end: g[g.length - 1].end + PAD_AFTER }));
  for (let i = 0; i < groups.length - 1; i++) {
    const lastEnd = groups[i][groups[i].length - 1].end;
    const nextStart = groups[i + 1][0].start;
    if (bounds[i].end > bounds[i + 1].start) {
      const boundary = lastEnd + Math.max(0, nextStart - lastEnd) * 0.7;
      bounds[i].end = boundary;
      bounds[i + 1].start = boundary;
    }
  }
  return groups.map((g, i) => {
    const start = Math.max(0, bounds[i].start);
    const end = Math.max(start + 0.2, duration ? Math.min(duration, bounds[i].end) : bounds[i].end);
    return { start: round(start), end: round(end), text: g.map(w => w.text).join(' ') };
  });
}

const round = t => Math.round(t * 100) / 100;

export function transcriptToSegments(lines, duration) {
  return wordsToSegments(linesToWords(lines, duration), { duration });
}

export function mergeWithNext(segments, i) {
  if (i < 0 || i >= segments.length - 1) return segments;
  const a = segments[i], b = segments[i + 1];
  const merged = { start: a.start, end: b.end, text: `${a.text} ${b.text}` };
  return [...segments.slice(0, i), merged, ...segments.slice(i + 2)];
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
