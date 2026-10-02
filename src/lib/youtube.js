const ID = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoId(input) {
  const s = (input || '').trim();
  if (ID.test(s)) return s;
  let url;
  try { url = new URL(s.includes('://') ? s : `https://${s}`); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return ID.test(url.pathname.slice(1, 12)) ? url.pathname.slice(1, 12) : null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const v = url.searchParams.get('v');
  if (v && ID.test(v)) return v;
  const m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  return m ? m[1] : null;
}

let apiPromise;
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('YouTubeに接続できませんでした')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}
