// Looks up a YouTube video or a TED talk and returns its human-made English
// captions as timed lines. Runs on the server: neither site lets a browser
// make these requests (no CORS).
import { parseSource } from '../src/lib/sources.js';
import { parseTranscript, cleanText } from '../src/lib/transcript.js';

export class LookupError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function request(url, init, what) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...init?.headers },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new LookupError('network', `${what}に接続できませんでした`, 502);
  }
  if (!res.ok) throw new LookupError('upstream', `${what}から読み込めませんでした（${res.status}）`, 502);
  return res.text();
}

async function requestJson(url, init, what) {
  const text = await request(url, init, what);
  try { return JSON.parse(text); } catch { throw new LookupError('upstream', `${what}から読み込めませんでした`, 502); }
}

// ---- YouTube ----------------------------------------------------------------

// YouTube's mobile app clients still get caption URLs that work without a
// proof-of-origin token; the web client's URLs return nothing.
const YT_CLIENTS = [
  { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 },
  { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2' },
];

const isEnglish = code => /^en(\b|-)/i.test(code || '');

// Only captions written by people are accepted. The auto-generated ("asr")
// track also tells us the spoken language.
export function pickCaptionTrack(tracks) {
  const asr = tracks.find(t => t.kind === 'asr');
  if (asr && !isEnglish(asr.languageCode)) {
    throw new LookupError('not_english', '英語の動画ではないようです（音声が英語以外です）');
  }
  const manual = tracks.filter(t => t.kind !== 'asr' && isEnglish(t.languageCode));
  if (!manual.length) {
    if (asr) throw new LookupError('auto_only', 'この動画の英語字幕は自動生成のものだけなので使えません。人が作成した字幕のある動画を選んでください');
    throw new LookupError('no_captions', 'この動画には英語の字幕がないので使えません');
  }
  return manual.find(t => t.languageCode === 'en') || manual[0];
}

export function json3ToLines(json) {
  const lines = [];
  for (const e of json.events ?? []) {
    if (!e.segs) continue;
    const text = cleanText(e.segs.map(s => s.utf8 ?? '').join('').replace(/\n/g, ' '));
    if (!text) continue;
    const start = e.tStartMs / 1000;
    lines.push({ start, end: e.dDurationMs ? start + e.dDurationMs / 1000 : undefined, text });
  }
  return lines.sort((a, b) => a.start - b.start);
}

async function lookupYouTube(videoId) {
  let data;
  for (const client of YT_CLIENTS) {
    data = await requestJson('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { ...client, hl: 'en' } }, videoId }),
    }, 'YouTube');
    if (data.playabilityStatus?.status === 'OK') break;
  }
  const playability = data.playabilityStatus ?? {};
  if (playability.status !== 'OK') {
    if (/bot/i.test(playability.reason || '')) {
      throw new LookupError('blocked', 'YouTubeに一時的にアクセスを断られました。しばらくしてからもう一度試してください', 503);
    }
    if (playability.status === 'LOGIN_REQUIRED') throw new LookupError('login_required', '年齢制限などでログインが必要な動画なので使えません');
    throw new LookupError('unavailable', 'この動画は再生できません（削除・非公開・地域制限など）');
  }
  if (playability.playableInEmbed === false) {
    throw new LookupError('no_embed', 'この動画は他のサイトでの再生が許可されていないので使えません');
  }

  const track = pickCaptionTrack(data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
  const url = new URL(track.baseUrl);
  url.searchParams.set('fmt', 'json3');
  const body = await request(url, {}, 'YouTubeの字幕');
  let lines = [];
  try { lines = json3ToLines(JSON.parse(body)); } catch { /* empty or not JSON */ }
  if (!lines.length) throw new LookupError('empty_captions', 'YouTubeから字幕を受け取れませんでした。しばらくしてからもう一度試してください', 502);

  const v = data.videoDetails ?? {};
  return {
    kind: 'youtube',
    videoId,
    title: v.title || '',
    author: v.author || '',
    duration: Number(v.lengthSeconds) || lines[lines.length - 1].end || 0,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    lines,
  };
}

// ---- TED --------------------------------------------------------------------

async function lookupTed(slug) {
  const query = `query { videos(slug: [${JSON.stringify(slug)}]) { nodes {
    slug title presenterDisplayName duration hlsUrl audioInternalLanguageCode
    primaryImageSet { url aspectRatioName } } } }`;
  const data = await requestJson('https://www.ted.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }, 'TED');
  const talk = data.data?.videos?.nodes?.[0];
  if (!talk) throw new LookupError('not_found', 'TEDのトークが見つかりません', 404);
  if (talk.audioInternalLanguageCode && !isEnglish(talk.audioInternalLanguageCode)) {
    throw new LookupError('not_english', '英語のトークではないようです');
  }
  if (!talk.hlsUrl) throw new LookupError('no_stream', 'このトークは再生できません');

  // The stream starts with TED's intro; its subtitle file is already timed to the stream.
  const meta = await requestJson(talk.hlsUrl.replace('/manifest.m3u8', '/metadata.json'), {}, 'TED');
  const en = meta.subtitles?.find(s => s.code === 'en');
  if (!en?.webvtt) throw new LookupError('no_captions', 'このトークには英語の字幕がないので使えません');
  const lines = parseTranscript(await request(en.webvtt, {}, 'TEDの字幕'));
  if (!lines.length) throw new LookupError('empty_captions', 'TEDから字幕を受け取れませんでした', 502);

  const streamLength = (meta.domains ?? []).reduce((sum, d) => sum + (d.duration || 0), 0);
  const images = talk.primaryImageSet ?? [];
  return {
    kind: 'ted',
    slug: talk.slug,
    title: talk.title || '',
    author: talk.presenterDisplayName || '',
    duration: streamLength || talk.duration || lines[lines.length - 1].end || 0,
    hlsUrl: talk.hlsUrl,
    thumbnail: (images.find(i => i.aspectRatioName === '16x9') || images[0])?.url || '',
    lines,
  };
}

export async function lookup(input) {
  const source = parseSource(input);
  if (!source) throw new LookupError('unsupported_url', 'YouTubeかTEDのURLを入れてください', 400);
  return source.kind === 'youtube' ? lookupYouTube(source.id) : lookupTed(source.id);
}
