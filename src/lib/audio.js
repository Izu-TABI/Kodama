// Shared Web Audio context, microphone recorder and clip playback.

let ctx = null;
export function audioContext() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export class Mic {
  stream = null;
  analyser = null;
  recorder = null;
  chunks = [];
  startedAt = 0;

  async open() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザでは録音できません');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ac = audioContext();
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 1024;
    ac.createMediaStreamSource(this.stream).connect(this.analyser);
    this.levelBuf = new Float32Array(this.analyser.fftSize);
  }

  // Resolves with performance.now() at the moment recording actually began.
  start() {
    this.chunks = [];
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    return new Promise(resolve => {
      this.recorder.onstart = () => { this.startedAt = performance.now(); resolve(this.startedAt); };
      this.recorder.start();
    });
  }

  get recording() { return this.recorder?.state === 'recording'; }

  stop() {
    const r = this.recorder;
    if (!r || r.state === 'inactive') return Promise.resolve(null);
    return new Promise(resolve => {
      r.onstop = () => resolve(new Blob(this.chunks, { type: r.mimeType || 'audio/webm' }));
      r.stop();
    });
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let s = 0;
    for (const v of this.levelBuf) s += v * v;
    return Math.min(1, Math.sqrt(s / this.levelBuf.length) * 4);
  }

  close() {
    if (this.recording) this.recorder.stop();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.analyser = null;
  }
}

const decoded = new Map();
export async function decodeBlob(key, blob) {
  if (!decoded.has(key)) {
    decoded.set(key, blob.arrayBuffer().then(b => audioContext().decodeAudioData(b)).catch(e => { decoded.delete(key); throw e; }));
  }
  return decoded.get(key);
}

// Plays part of an AudioBuffer. Returns { stop, done } where done resolves when it ends.
export function playClip(buffer, from, to, { pan = 0 } = {}) {
  const ac = audioContext();
  const src = ac.createBufferSource();
  src.buffer = buffer;
  let node = src;
  if (pan) {
    const p = ac.createStereoPanner();
    p.pan.value = pan;
    src.connect(p);
    node = p;
  }
  node.connect(ac.destination);
  const start = Math.max(0, from);
  const length = Math.max(0.05, Math.min(buffer.duration, to) - start);
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });
  src.onended = () => resolveDone();
  src.start(0, start, length);
  return { stop: () => { try { src.stop(); } catch { /* already stopped */ } }, done };
}

// Maps a media time to a recording time using samples taken while both ran.
export function mediaToRecording(samples, t, rate = 1) {
  if (!samples.length) return 0;
  const i = samples.findIndex(s => s.media >= t);
  if (i === 0) return samples[0].rec - (samples[0].media - t) / rate;
  if (i < 0) {
    const last = samples[samples.length - 1];
    return last.rec + (t - last.media) / rate;
  }
  const a = samples[i - 1], b = samples[i];
  const k = b.media === a.media ? 0 : (t - a.media) / (b.media - a.media);
  return a.rec + k * (b.rec - a.rec);
}
