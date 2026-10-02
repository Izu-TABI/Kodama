// Main-thread side of the Whisper worker.

let worker = null;
let seq = 0;

function getWorker() {
  worker ??= new Worker(new URL('./asr.worker.js', import.meta.url), { type: 'module' });
  return worker;
}

export async function decodeToMono16k(file) {
  const data = await file.arrayBuffer();
  const probe = new OfflineAudioContext(1, 1, 16000);
  let decoded;
  try {
    decoded = await probe.decodeAudioData(data);
  } catch {
    throw new Error('このファイルの音声を読み込めませんでした。mp3・m4a・wav・mp4 などを試してください');
  }
  const ctx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return { audio: rendered.getChannelData(0), duration: decoded.duration };
}

// onProgress receives { stage: 'decode' | 'model' | 'transcribe', loaded?, total?, done? }.
export function transcribe(audio, { onProgress, signal } = {}) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const cleanup = () => { w.removeEventListener('message', onMessage); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => {
      cleanup();
      worker.terminate();
      worker = null;
      reject(new DOMException('aborted', 'AbortError'));
    };
    const onMessage = ({ data }) => {
      if (data.type === 'model') return onProgress?.({ stage: 'model', loaded: data.loaded, total: data.total });
      if (data.id !== id) return;
      if (data.type === 'ready') onProgress?.({ stage: 'transcribe', done: 0, total: audio.length / 16000 });
      if (data.type === 'progress') onProgress?.({ stage: 'transcribe', done: data.done, total: data.total });
      if (data.type === 'result') { cleanup(); resolve(data.words); }
      if (data.type === 'error') { cleanup(); reject(new Error(data.message)); }
    };
    w.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort);
    // Copy so the caller keeps its buffer.
    const copy = audio.slice();
    w.postMessage({ type: 'transcribe', id, audio: copy }, [copy.buffer]);
  });
}
