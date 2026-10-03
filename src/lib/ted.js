// TED talks: the bundled catalog, search, and loading a talk's subtitles.
// hls.ted.com allows browser requests (CORS), so only the catalog needs building ahead of time.
import { parseTranscript } from './transcript.js';
import { transcriptToSegments } from './segments.js';

export const KIND_LABEL = { 1: 'TEDx', 2: 'TED-Ed', 3: 'TED Institute', 6: 'TED Salon' };

// "2597:9294" ↔ https://hls.ted.com/project_masters/2597/manifest.m3u8?intro_master_id=9294
export function streamUrl(stream, file = 'manifest.m3u8') {
  if (stream.includes('/')) return stream.replace('/manifest.m3u8', `/${file}`);
  const [id, intro] = stream.split(':');
  return `https://hls.ted.com/project_masters/${id}/${file}${intro ? `?intro_master_id=${intro}` : ''}`;
}

export function decodeTalk(row, order) {
  const [slug, title, speaker, duration, year, views, stream, kind, ja, image = ''] = row;
  return { slug, title, speaker, duration, year, views, stream, kind, ja: !!ja, image, order };
}

const RESIZER = 'https://pi.tedcdn.com/r/';
const IMAGE_PREFIX = {
  'p:': `${RESIZER}talkstar-photos.s3.amazonaws.com/uploads/`,
  'a:': `${RESIZER}talkstar-assets.s3.amazonaws.com/production/talks/`,
  'e:': `${RESIZER}pe.tedcdn.com/images/ted/`,
  'r:': RESIZER,
};

// A talk's thumbnail through TED's image resizer, about `width` pixels wide
// (the original files run to megabytes).
export function imageUrl(packed, width) {
  if (!packed) return '';
  const prefix = IMAGE_PREFIX[packed.slice(0, 2)];
  let url = prefix ? prefix + packed.slice(2) : packed;
  if (!url.startsWith(RESIZER)) url = RESIZER + url.replace(/^https?:\/\//, '');
  return width ? `${url}?w=${width}` : url;
}

let catalogPromise = null;
export function loadCatalog() {
  catalogPromise ??= fetch('/ted/catalog.json')
    .then(r => {
      if (!r.ok) throw new Error('TEDの一覧を読み込めませんでした');
      return r.json();
    })
    .then(data => ({ updated: data.updated, talks: data.talks.map(decodeTalk) }))
    .catch(e => { catalogPromise = null; throw e; });
  return catalogPromise;
}

export function parseTedSlug(input) {
  const s = (input || '').trim();
  if (!/ted\.com/i.test(s)) return null;
  let url;
  try { url = new URL(s.includes('://') ? s : `https://${s}`); } catch { return null; }
  if (!/(^|\.)ted\.com$/.test(url.hostname)) return null;
  const m = /^\/talks\/(?:lang\/[\w-]+\/)?([\w-]+)/.exec(url.pathname);
  return m ? m[1] : null;
}

const fold = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const LENGTHS = {
  all: [0, Infinity],
  short: [0, 6 * 60],
  medium: [6 * 60, 12 * 60],
  long: [12 * 60, 20 * 60],
  longer: [20 * 60, Infinity],
};

export function searchTalks(talks, { query = '', length = 'all', japanese = false, sort = 'new' } = {}) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const [min, max] = LENGTHS[length] ?? LENGTHS.all;
  const hits = talks.filter(t => {
    if (t.duration < min || t.duration >= max) return false;
    if (japanese && !t.ja) return false;
    if (!terms.length) return true;
    const hay = fold(`${t.title} ${t.speaker}`);
    return terms.every(term => hay.includes(term));
  });
  return sort === 'popular' ? hits.sort((a, b) => b.views - a.views) : hits.sort((a, b) => a.order - b.order);
}

// Spreads translated cues over the English sentences by time: each cue goes to
// the sentence that contains its midpoint (TED's translations reuse its English timing).
export function alignTranslation(segments, cues) {
  const parts = segments.map(() => []);
  for (const c of cues) {
    const mid = (c.start + (c.end ?? c.start)) / 2;
    let k = segments.findIndex(s => mid >= s.start && mid < s.end);
    if (k < 0) {
      let best = Infinity;
      segments.forEach((s, i) => {
        const d = Math.min(Math.abs(mid - s.start), Math.abs(mid - s.end));
        if (d < best) { best = d; k = i; }
      });
    }
    if (k >= 0) parts[k].push(joinJapanese(c.text));
  }
  // TED's Japanese subtitles have little punctuation; keep a space where one cue ends.
  return parts.map(p => p.join(' '));
}

// Removes the spaces that line breaks leave between Japanese characters.
export const joinJapanese = s => s.replace(/([^\x00-\x7F])\s+(?=[^\x00-\x7F])/g, '$1').trim();

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

// Loads a talk's English subtitles (and TED's Japanese translation when there is one).
export async function loadTalk(talk) {
  let meta;
  try {
    meta = JSON.parse(await getText(streamUrl(talk.stream, 'metadata.json')));
  } catch {
    throw new Error('TEDから字幕を読み込めませんでした。通信状況を確認してください');
  }
  const subs = meta.subtitles ?? [];
  const en = subs.find(s => s.code === 'en');
  if (!en) throw new Error('このトークには英語の字幕がないので使えません');
  const duration = (meta.domains ?? []).reduce((sum, d) => sum + (d.duration || 0), 0) || talk.duration;
  const lines = parseTranscript(await getText(en.webvtt));
  if (!lines.length) throw new Error('字幕を読み込めませんでした');
  const segments = transcriptToSegments(lines, duration);

  const ja = subs.find(s => s.code === 'ja');
  if (ja) {
    try {
      const translated = alignTranslation(segments, parseTranscript(await getText(ja.webvtt)));
      translated.forEach((text, i) => { if (text) segments[i].ja = text; });
    } catch { /* the talk still works without the translation */ }
  }
  return { duration, segments, hasJapanese: segments.some(s => s.ja) };
}
