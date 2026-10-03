// Builds public/ted/catalog.json: every English TED talk with a playable stream
// and English subtitles, flagged when TED also has a Japanese translation.
// TED's site has no CORS, so the browser can't search it; the catalog is
// built ahead of time (weekly in CI) and shipped with the app.
//
// Row: [slug, title, speaker, seconds, year, views, stream, kind, hasJapanese, image]
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/ted/catalog.json', import.meta.url);
const PAGE = 50; // the API's maximum
const FIELDS = 'slug title presenterDisplayName duration hlsUrl audioInternalLanguageCode publishedAt viewedCount type { name } primaryImageSet { url aspectRatioName }';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(after) {
  const args = `first: ${PAGE}${after ? `, after: ${JSON.stringify(after)}` : ''}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://www.ted.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'shadowing-catalog/1.0' },
        body: JSON.stringify({ query: `query { videos(${args}) { totalCount pageInfo { endCursor hasNextPage } nodes { ${FIELDS} } } }` }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.json();
      if (!body.data?.videos) throw new Error(JSON.stringify(body.errors ?? body).slice(0, 200));
      return body.data.videos;
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(2000 * attempt);
    }
  }
}

// https://hls.ted.com/project_masters/2597/manifest.m3u8?intro_master_id=9294 → "2597:9294"
export function packStream(url) {
  const m = /^https:\/\/hls\.ted\.com\/project_masters\/(\d+)\/manifest\.m3u8(?:\?intro_master_id=(\d+))?$/.exec(url);
  return m ? (m[2] ? `${m[1]}:${m[2]}` : m[1]) : url;
}

// Thumbnail URLs share long prefixes; keep only what differs.
export function packImage(url) {
  return (url || '')
    .replace('https://pi.tedcdn.com/r/talkstar-photos.s3.amazonaws.com/uploads/', 'p:')
    .replace('https://pi.tedcdn.com/r/talkstar-assets.s3.amazonaws.com/production/talks/', 'a:')
    .replace('https://pe.tedcdn.com/images/ted/', 'e:')
    .replace('https://pi.tedcdn.com/r/', 'r:');
}

const KIND = { 'TED Stage Talk': 0, 'TEDx Talk': 1, 'TED-Ed Original': 2, 'TED Institute Talk': 3, 'Best of Web': 4, 'Original Content': 5, 'TED Salon Talk': 6 };

// "2597:9294" → the stream's metadata.json (lists its subtitle languages).
export function metadataUrl(stream) {
  const [id, intro] = stream.split(':');
  return stream.includes('/')
    ? stream.replace('/manifest.m3u8', '/metadata.json')
    : `https://hls.ted.com/project_masters/${id}/metadata.json${intro ? `?intro_master_id=${intro}` : ''}`;
}

async function subtitleLanguages(stream) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(metadataUrl(stream), { signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return [];
      const meta = await res.json();
      return (meta.subtitles ?? []).map(s => s.code);
    } catch {
      await sleep(1000 * attempt);
    }
  }
  return null; // unknown
}

const talks = [];
const images = new Map();
const types = {};
let after = null, total = 0, skipped = 0;
do {
  const v = await page(after);
  total = v.totalCount;
  for (const n of v.nodes) {
    types[n.type?.name] = (types[n.type?.name] || 0) + 1;
    if (!n.hlsUrl || !/^en/i.test(n.audioInternalLanguageCode || '')) { skipped++; continue; }
    talks.push([
      n.slug,
      n.title,
      n.presenterDisplayName || '',
      n.duration || 0,
      Number((n.publishedAt || '').slice(0, 4)) || 0,
      n.viewedCount || 0,
      packStream(n.hlsUrl),
      KIND[n.type?.name] ?? 9,
    ]);
    const images16x9 = (n.primaryImageSet ?? []).filter(i => i.aspectRatioName === '16x9');
    images.set(n.slug, packImage((images16x9[0] ?? n.primaryImageSet?.[0])?.url));
  }
  after = v.pageInfo.hasNextPage ? v.pageInfo.endCursor : null;
  process.stdout.write(`\r${talks.length + skipped} / ${total}`);
  await sleep(150);
} while (after);

// Check subtitles, a few at a time.
let checked = 0, noEnglish = 0;
const queue = [...talks];
const kept = new Set();
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let t; (t = queue.shift());) {
    const langs = await subtitleLanguages(t[6]);
    if (langs && !langs.includes('en')) noEnglish++;
    else { t.push(langs?.includes('ja') ? 1 : 0, images.get(t[0]) || ''); kept.add(t); }
    if (++checked % 100 === 0) process.stdout.write(`\rsubtitles ${checked} / ${talks.length}`);
  }
}));
const final = talks.filter(t => kept.has(t));
console.log(`\n${noEnglish} without English subtitles dropped; ${final.filter(t => t[8]).length} have Japanese`);

mkdirSync(new URL('.', OUT), { recursive: true });
// One talk per line keeps the file diff-friendly.
const json = `{"updated":${JSON.stringify(new Date().toISOString())},"talks":[\n${final.map(t => JSON.stringify(t)).join(',\n')}\n]}\n`;
writeFileSync(OUT, json);
console.log(`${final.length} talks written (${skipped} skipped: not English or no stream), ${(json.length / 1e6).toFixed(2)} MB`);
console.log('types:', types);
