// Recognises the URLs materials can come from. Shared by the browser and the server.
import { parseVideoId } from './youtube.js';

export function parseTedSlug(input) {
  const s = (input || '').trim();
  let url;
  try { url = new URL(s.includes('://') ? s : `https://${s}`); } catch { return null; }
  if (!/(^|\.)ted\.com$/.test(url.hostname)) return null;
  const m = /^\/talks\/(?:lang\/[\w-]+\/)?([\w-]+)/.exec(url.pathname);
  return m ? m[1] : null;
}

export function parseSource(input) {
  const yt = parseVideoId(input);
  if (yt) return { kind: 'youtube', id: yt };
  const ted = parseTedSlug(input);
  if (ted) return { kind: 'ted', id: ted };
  return null;
}
