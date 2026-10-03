// Importing many audio/video files: each is transcribed in turn (one Whisper
// worker), saved as a material in its folder, then machine-translated in the
// background. The queue outlives screen changes; closing the tab stops it.
import { decodeToMono16k, transcribe } from './asr.js';
import { wordsToSegments } from './segments.js';
import { createMaterial, createFolder, listFolders } from './db.js';
import { startTranslations } from './translations.js';
import { isMediaFile, titleOf } from './files.js';
import { freeName } from './tree.js';

let items = [];
let seq = 0;
let running = false;
let current = null; // AbortController of the file being transcribed
const listeners = new Set();

const emit = () => listeners.forEach(fn => fn(items));
const patch = (id, change) => {
  items = items.map(it => (it.id === id ? { ...it, ...change } : it));
  emit();
};

export const importItems = () => items;
export function subscribeImports(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const importing = () => items.some(it => it.status === 'waiting' || it.status === 'working');

// Creates the dropped folder structure under `target` and queues the media files.
// Returns how many files were queued and how many were skipped (not audio/video).
export async function queueImport(found, target) {
  const media = found.filter(f => isMediaFile(f.file));
  const folderIds = new Map();
  const folders = await listFolders();
  // Each dropped folder becomes a new folder ("Podcast 2" if the name is taken there).
  const folderFor = async dirs => {
    let parent = target;
    for (let i = 0; i < dirs.length; i++) {
      const path = dirs.slice(0, i + 1).join('/');
      if (!folderIds.has(path)) {
        const name = freeName(dirs[i], folders.filter(f => f.parentId === parent));
        const created = await createFolder(name, parent);
        folders.push(created);
        folderIds.set(path, created.id);
      }
      parent = folderIds.get(path);
    }
    return parent;
  };
  for (const { file, dirs } of media) {
    const folderId = await folderFor(dirs);
    items = [...items, { id: ++seq, file, name: titleOf(file), folderId, status: 'waiting', progress: null }];
  }
  emit();
  pump();
  return { queued: media.length, skipped: found.length - media.length, folders: folderIds.size };
}

export function cancelImport(id) {
  const it = items.find(x => x.id === id);
  if (!it) return;
  if (it.status === 'working') current?.abort();
  if (it.status === 'waiting' || it.status === 'working') patch(id, { status: 'cancelled' });
}

export function clearFinished() {
  items = items.filter(it => it.status === 'waiting' || it.status === 'working');
  emit();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (let it; (it = items.find(x => x.status === 'waiting'));) {
      const ctrl = new AbortController();
      current = ctrl;
      patch(it.id, { status: 'working', progress: { stage: 'decode' } });
      try {
        const { audio, duration } = await decodeToMono16k(it.file);
        const words = await transcribe(audio, { signal: ctrl.signal, onProgress: p => patch(it.id, { progress: p }) });
        const segments = wordsToSegments(words, { duration });
        if (!segments.length) throw new Error('英語の音声が見つかりませんでした');
        const m = await createMaterial({
          kind: 'file',
          title: it.name,
          mediaType: it.file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(it.file.name) ? 'video' : 'audio',
          duration,
          segments,
          folderId: it.folderId,
        }, it.file);
        patch(it.id, { status: 'done', progress: null, materialId: m.id });
        startTranslations(m);
      } catch (e) {
        if (e.name === 'AbortError') continue;
        patch(it.id, { status: 'failed', progress: null, error: e.message || '読み込めませんでした' });
      }
    }
  } finally {
    running = false;
    current = null;
  }
}

// Leaving the page would lose what is still waiting.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', e => {
    if (importing()) { e.preventDefault(); e.returnValue = ''; }
  });
}
