// Runs Whisper in the browser (WebGPU when available, otherwise WASM).
// Audio is cut at quiet points into windows of at most 30 s so progress is
// measurable and words are never split between windows.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL = 'onnx-community/whisper-base.en_timestamped';
const SR = 16000;
const FRAME = 320; // 20 ms

let asrPromise = null;
const files = new Map();

async function hasWebGPU() {
  try { return !!(self.navigator?.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
}

function load() {
  asrPromise ??= (async () => {
    const webgpu = await hasWebGPU();
    return pipeline('automatic-speech-recognition', MODEL, {
      device: webgpu ? 'webgpu' : 'wasm',
      dtype: webgpu
        ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
        : { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback: info => {
        if (info.status !== 'progress' || !info.total) return;
        files.set(info.file, { loaded: info.loaded, total: info.total });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        self.postMessage({ type: 'model', loaded, total });
      },
    });
  })().catch(e => { asrPromise = null; throw e; });
  return asrPromise;
}

function frameEnergy(audio) {
  const n = Math.floor(audio.length / FRAME);
  const e = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * FRAME, end = i + FRAME; i < end; i++) s += audio[i] * audio[i];
    e[f] = s / FRAME;
  }
  return e;
}

export function windows(audio) {
  const energy = frameEnergy(audio);
  const n = energy.length;
  const maxLen = Math.floor((29.5 * SR) / FRAME);
  const minLen = Math.floor((15 * SR) / FRAME);
  const quiet = 10; // look for 200 ms of quiet
  const out = [];
  let s = 0;
  while (s < n) {
    if (n - s <= maxLen) { out.push([s, n]); break; }
    let best = s + maxLen - quiet, bestE = Infinity, sum = 0;
    for (let f = s + minLen; f < s + minLen + quiet; f++) sum += energy[f];
    for (let f = s + minLen; f + quiet < s + maxLen; f++) {
      if (sum < bestE) { bestE = sum; best = f; }
      sum += energy[f + quiet] - energy[f];
    }
    const cut = best + quiet / 2;
    out.push([s, cut]);
    s = cut;
  }
  return out.map(([a, b]) => [a * FRAME, Math.min(audio.length, b * FRAME)]);
}

function rms(audio) {
  let s = 0;
  for (let i = 0; i < audio.length; i++) s += audio[i] * audio[i];
  return Math.sqrt(s / Math.max(1, audio.length));
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;
  const { id, audio } = data;
  try {
    const asr = await load();
    self.postMessage({ type: 'ready', id });
    const words = [];
    const total = audio.length / SR;
    for (const [a, b] of windows(audio)) {
      const part = audio.subarray(a, b);
      const offset = a / SR;
      if (rms(part) > 0.002) {
        const out = await asr(part, { return_timestamps: 'word' });
        const length = part.length / SR;
        for (const c of out.chunks ?? []) {
          const [s, e] = c.timestamp;
          // Whisper sees each window padded to 30 s and sometimes invents words
          // in that silence; they carry times past the real end of the window.
          if (!c.text.trim() || s == null || s >= length - 0.05) continue;
          const start = offset + s;
          const prev = words[words.length - 1];
          if (prev && start < prev.start) continue;
          words.push({ text: c.text.trim(), start, end: offset + Math.min(e ?? s, length) });
        }
      }
      self.postMessage({ type: 'progress', id, done: b / SR, total });
    }
    self.postMessage({ type: 'result', id, words });
  } catch (e) {
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
};
