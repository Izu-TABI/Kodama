// A small common interface over a <video> element:
// time(), duration(), isPlaying(), isPaused(), play(), pause(), seek(t), setRate(r), setPan(v), destroy().
import { audioContext } from './audio.js';

// Plays an HLS stream (TED) in a <video>. iPhone Safari has no Media Source
// but plays HLS natively; everywhere else hls.js is used, because some
// browsers claim native HLS support they don't have.
export async function attachHls(video, url, onError) {
  const native = video.canPlayType('application/vnd.apple.mpegurl');
  const useNative = native && !('MediaSource' in window);
  if (!useNative) {
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWebVTT: false, subtitleDisplay: false, capLevelToPlayerSize: true });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) onError?.('動画を読み込めませんでした。通信状況を確認してください');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    if (!native) throw new Error('このブラウザではこの動画を再生できません');
  }
  // Native: allow Web Audio (for 重ねて) and keep the stream's own subtitles off.
  video.crossOrigin = 'anonymous';
  const hideTracks = () => { for (const t of video.textTracks) t.mode = 'disabled'; };
  video.textTracks.addEventListener('addtrack', hideTracks);
  video.src = url;
  return () => {
    video.textTracks.removeEventListener('addtrack', hideTracks);
    video.removeAttribute('src');
    video.load();
  };
}

export function mediaElementPlayer(el) {
  let panner = null;
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
    // Routes the element through Web Audio so it can be panned (only done on demand).
    setPan(value) {
      if (!panner) {
        if (!value) return;
        const ac = audioContext();
        panner = ac.createStereoPanner();
        ac.createMediaElementSource(el).connect(panner).connect(ac.destination);
      }
      panner.pan.value = value;
    },
    destroy: () => el.pause(),
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
