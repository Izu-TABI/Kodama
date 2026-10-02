// Parses pasted transcripts into timed lines: [{ start, end?, text }].
// Accepts YouTube's "Show transcript" copy (timestamp lines followed by text,
// or timestamp and text on one line), SRT and WebVTT.

const STAMP = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;
const LEADING_STAMP = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/;
// Accessibility labels YouTube puts next to timestamps ("2 seconds", "1分5秒").
const DURATION_LABEL = /^(\d+\s*(hours?|minutes?|seconds?|時間|分|秒)[,\s]*)+$/i;
const CUE_TIMING = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

export function parseStamp(s) {
  const m = STAMP.exec(s.trim());
  if (!m) return null;
  const [, h, mm, ss, frac] = m;
  return (Number(h) || 0) * 3600 + Number(mm) * 60 + Number(ss) + (frac ? Number(`0.${frac.padEnd(3, '0')}`) : 0);
}

// Removes non-speech annotations and speaker markers.
export function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\[[^\]]{1,40}\]|\((?:laughter|applause|music|cheers|laughs|音楽|拍手|笑)[^)]*\)|（[^）]{1,20}）/gi, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/^\s*(>>|-|–)\s*/, '')
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCues(raw) {
  const lines = [];
  const blocks = raw.replace(/\r/g, '').split(/\n\s*\n/);
  let prev = [];
  for (const block of blocks) {
    const rows = block.split('\n');
    const i = rows.findIndex(r => CUE_TIMING.test(r));
    if (i < 0) continue;
    const [, a, b] = CUE_TIMING.exec(rows[i]);
    const start = parseStamp(a), end = parseStamp(b);
    if (start == null) continue;
    // YouTube's auto-generated VTT repeats the previous line in each cue (roll-up captions).
    const texts = rows.slice(i + 1).map(cleanText).filter(Boolean);
    const fresh = texts.filter(t => !prev.includes(t));
    prev = texts;
    if (fresh.length) lines.push({ start, end: end ?? undefined, text: fresh.join(' ') });
  }
  return lines;
}

function parseStampList(raw) {
  const lines = [];
  let current = null;
  for (const row of raw.replace(/\r/g, '').split('\n')) {
    const t = row.trim();
    if (!t) continue;
    const alone = parseStamp(t);
    if (alone != null) {
      current = { start: alone, text: '' };
      lines.push(current);
      continue;
    }
    const lead = LEADING_STAMP.exec(t);
    if (lead && parseStamp(lead[1]) != null) {
      current = { start: parseStamp(lead[1]), text: cleanText(lead[2]) };
      lines.push(current);
      continue;
    }
    if (!current || DURATION_LABEL.test(t)) continue;
    const text = cleanText(t);
    if (text) current.text = current.text ? `${current.text} ${text}` : text;
  }
  return lines.filter(l => l.text);
}

export function parseTranscript(raw) {
  if (!raw || !raw.trim()) return [];
  const lines = /-->/.test(raw) ? parseCues(raw) : parseStampList(raw);
  return lines.sort((a, b) => a.start - b.start);
}
