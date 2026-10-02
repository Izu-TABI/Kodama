// A small common interface over a <video> element and the YouTube player:
// time(), duration(), isPlaying(), isPaused(), play(), pause(), seek(t), setRate(r), destroy().
import { loadYouTubeApi } from './youtube.js';

// Plays an HLS stream in a <video>: with hls.js wherever Media Source exists
// (some browsers claim native HLS support they don't have), natively otherwise.
export async function attachHls(video, url, onError) {
  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) {
    if (!video.canPlayType('application/vnd.apple.mpegurl')) throw new Error('このブラウザではこの動画を再生できません');
    video.src = url;
    return () => { video.removeAttribute('src'); video.load(); };
  }
  const hls = new Hls({ enableWebVTT: false, subtitleDisplay: false, capLevelToPlayerSize: true });
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) onError?.('動画を読み込めませんでした。通信状況を確認してください');
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}

export function mediaElementPlayer(el) {
  const waitFor = (event, check) => new Promise(resolve => {
    if (check()) return resolve();
    el.addEventListener(event, resolve, { once: true });
  });
  const ready = new Promise((resolve, reject) => {
    if (el.readyState >= 1) return resolve();
    el.addEventListener('loadedmetadata', resolve, { once: true });
    el.addEventListener('error', () => reject(new Error('動画・音声を読み込めませんでした')), { once: true });
  });
  return {
    kind: 'media',
    ready,
    time: () => el.currentTime,
    duration: () => el.duration,
    isPlaying: () => !el.paused && !el.ended && el.readyState > 2,
    isPaused: () => el.paused || el.ended,
    async play() {
      await el.play();
      await waitFor('playing', () => el.readyState > 2 && !el.paused);
    },
    pause: () => el.pause(),
    seek: t => { el.currentTime = t; },
    setRate: r => { el.playbackRate = r; el.preservesPitch = true; },
    destroy: () => el.pause(),
  };
}

const YT_ERRORS = {
  2: '動画のURLが正しくありません',
  5: 'この動画はブラウザで再生できません',
  100: '動画が見つかりません（削除されたか非公開です）',
  101: 'この動画は埋め込み再生が許可されていません',
  150: 'この動画は埋め込み再生が許可されていません',
};

export async function youtubePlayer(container, videoId, { onError, onTitle } = {}) {
  const YT = await loadYouTubeApi();
  const host = document.createElement('div');
  container.appendChild(host);
  let player;
  let rate = 1;
  let state = -1;
  // getCurrentTime() updates in coarse steps; extrapolate between them.
  let lastRaw = 0, lastAt = 0;
  const playingWaiters = new Set();

  const ready = new Promise((resolve, reject) => {
    player = new YT.Player(host, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, iv_load_policy: 3, cc_load_policy: 0, origin: location.origin },
      events: {
        onReady: () => {
          onTitle?.(player.getVideoData?.().title);
          resolve();
        },
        onStateChange: e => {
          state = e.data;
          lastRaw = player.getCurrentTime();
          lastAt = performance.now();
          if (state === YT.PlayerState.PLAYING) { playingWaiters.forEach(f => f()); playingWaiters.clear(); }
        },
        onPlaybackRateChange: e => { rate = e.data; },
        // Keep YouTube's own captions off; the script is shown (or hidden) by the app.
        onApiChange: () => { if (player.getOptions?.().includes('captions')) player.unloadModule?.('captions'); },
        onError: e => {
          const message = YT_ERRORS[e.data] || '動画を再生できませんでした';
          onError?.(message);
          reject(new Error(message));
        },
      },
    });
  });

  const isPlaying = () => state === YT.PlayerState.PLAYING;
  return {
    kind: 'youtube',
    ready,
    time() {
      const raw = player.getCurrentTime?.() ?? 0;
      const now = performance.now();
      if (raw !== lastRaw) { lastRaw = raw; lastAt = now; }
      return isPlaying() ? lastRaw + ((now - lastAt) / 1000) * rate : lastRaw;
    },
    duration: () => player.getDuration?.() || 0,
    isPlaying,
    isPaused: () => state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED,
    play() {
      if (isPlaying()) return Promise.resolve();
      const p = new Promise(resolve => playingWaiters.add(resolve));
      player.playVideo();
      return p;
    },
    pause: () => player.pauseVideo?.(),
    seek: t => { player.seekTo(t, true); lastRaw = t; lastAt = performance.now(); },
    setRate: r => {
      player.setPlaybackRate(r);
      rate = player.getPlaybackRate?.() ?? r;
    },
    destroy: () => { player?.destroy?.(); host.remove(); },
  };
}

// Plays [from, to) and pauses at `to`. onTick(time) is called every frame while
// playing. Resolves with the last time reached when it ends, is aborted via
// signal, or is paused from the player's own controls.
export async function playRange(player, from, to, { onTick, signal } = {}) {
  player.seek(from);
  await player.play();
  return new Promise(resolve => {
    let t = from;
    const step = () => {
      if (signal?.aborted) { player.pause(); return resolve(t); }
      if (player.isPaused()) return resolve(t);
      t = player.time();
      if (player.isPlaying()) onTick?.(t);
      if (t >= to - 0.02) { player.pause(); return resolve(to); }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
