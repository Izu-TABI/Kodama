// Backups: everything Kodama keeps in this browser, in one file, and back.
// The file is "KODAMA1\n", the length of a JSON header (4 bytes), the header,
// then the audio/video files and recordings one after another, so that neither
// writing nor reading it needs the files in memory.
import {
  listMaterials, listFolders, saveMaterial, saveFolders,
  getMedia, putMedia, getRecording, listRecordings, putRecording,
} from './db.js';
import { loadTranslations, saveTranslations } from './translations.js';

const MAGIC = 'KODAMA1\n';
const VERSION = 1;
// Practice log, practice settings and the theme. (Sort order and open folders stay per device.)
const STORAGE_KEYS = ['shadowing:activity', 'shadowing:prefs', 'shadowing:theme'];

export function encodeBackup(header, blobs = []) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, json.length, true);
  return new Blob([MAGIC, length, json, ...blobs], { type: 'application/octet-stream' });
}

export async function decodeBackup(file) {
  const fail = message => { throw new Error(message); };
  const start = MAGIC.length + 4;
  const head = new Uint8Array(await file.slice(0, start).arrayBuffer());
  if (head.length < start || new TextDecoder().decode(head.subarray(0, MAGIC.length)) !== MAGIC) fail('Kodamaのバックアップではありません');
  const length = new DataView(head.buffer).getUint32(MAGIC.length, true);
  let header;
  try { header = JSON.parse(await file.slice(start, start + length).text()); } catch { fail('バックアップを読めませんでした'); }
  if (header?.app !== 'Kodama' || !Array.isArray(header.materials) || !Array.isArray(header.folders)) fail('バックアップを読めませんでした');
  if (header.version > VERSION) fail('新しい版のKodamaで作られたバックアップです');
  let offset = start + length;
  const parts = (Array.isArray(header.files) ? header.files : []).map(f => {
    const part = { ...f, blob: file.slice(offset, offset + f.size, f.type) };
    offset += f.size;
    return part;
  });
  if (offset > file.size) fail('バックアップのファイルが途中で切れています');
  return { header, parts };
}

// Sizes of what a backup would hold, for the dialog.
export async function backupContents() {
  const materials = await listMaterials();
  let files = 0, bytes = 0;
  for (const m of materials) {
    const blob = m.mediaId && await getMedia(m.mediaId);
    if (blob) { files++; bytes += blob.size; }
  }
  for (const [, blob] of await listRecordings()) { files++; bytes += blob.size; }
  return { materials: materials.length, files, bytes };
}

export async function makeBackup({ withFiles = true } = {}) {
  const [materials, folders] = await Promise.all([listMaterials(), listFolders()]);
  const translations = {};
  for (const m of materials) {
    const mt = await loadTranslations(m.id);
    if (mt.some(Boolean)) translations[m.id] = mt;
  }
  const files = [];
  const blobs = [];
  const add = (store, key, blob) => {
    files.push({ store, key, type: blob.type, size: blob.size, ...(blob.name ? { name: blob.name } : {}) });
    blobs.push(blob);
  };
  if (withFiles) {
    for (const m of materials) {
      const blob = m.mediaId && await getMedia(m.mediaId);
      if (blob) add('media', m.mediaId, blob);
    }
    for (const [key, blob] of await listRecordings()) add('recordings', key, blob);
  }
  const storage = {};
  for (const key of STORAGE_KEYS) {
    try { const value = localStorage.getItem(key); if (value != null) storage[key] = value; } catch { /* storage unavailable */ }
  }
  return encodeBackup({ app: 'Kodama', version: VERSION, exportedAt: new Date().toISOString(), materials, folders, translations, storage, files }, blobs);
}

export const backupName = (d = new Date()) =>
  `kodama-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.kodama`;

// ---- Putting a backup back -------------------------------------------------
// Nothing here is removed: what is missing is added, and a material that is
// on both sides keeps the copy practised more recently.

const lastUsed = m => m.practicedAt || m.createdAt || 0;
const isMaterial = m => m && typeof m.id === 'string' && Array.isArray(m.segments);
const isFolder = f => f && typeof f.id === 'string' && typeof f.name === 'string';

export function mergeFolders(mine, theirs) {
  const byId = new Map(mine.map(f => [f.id, f]));
  for (const f of theirs) if (isFolder(f) && !byId.has(f.id)) byId.set(f.id, { ...f, parentId: f.parentId ?? null });
  // A folder whose parent didn't come along goes to the top level.
  return [...byId.values()].map(f => (f.parentId && !byId.has(f.parentId) ? { ...f, parentId: null } : f));
}

// Which incoming materials to save: new ones, and newer copies of ones already here.
export function mergeMaterials(mine, theirs, folderIds) {
  const byId = new Map(mine.map(m => [m.id, m]));
  const save = [];
  let added = 0;
  for (const m of theirs) {
    if (!isMaterial(m)) continue;
    const here = byId.get(m.id);
    if (here && lastUsed(here) >= lastUsed(m)) continue;
    if (!here) added++;
    save.push({ ...m, folderId: m.folderId && folderIds.has(m.folderId) ? m.folderId : null });
  }
  return { save, added, updated: save.length - added };
}

// Practice days from both sides; a day on both keeps the larger counts.
export function mergeActivity(mine, theirs) {
  const days = { ...(mine?.days ?? {}) };
  for (const [day, v] of Object.entries(theirs?.days ?? {})) {
    if (!v || typeof v.n !== 'number') continue;
    const here = days[day];
    days[day] = here ? { n: Math.max(here.n, v.n), s: Math.max(here.s ?? 0, v.s ?? 0) } : { n: v.n, s: v.s ?? 0 };
  }
  return { ...(mine ?? {}), days };
}

// Sentence translations: the ones already here stay; missing ones are filled in.
export const mergeTranslations = (mine = [], theirs = []) =>
  Array.from({ length: Math.max(mine.length, theirs.length) }, (_, i) => mine[i] || theirs[i] || null);

export async function restoreBackup({ header, parts }, onProgress) {
  const folders = mergeFolders(await listFolders(), header.folders);
  await saveFolders(folders);
  const { save, added, updated } = mergeMaterials(await listMaterials(), header.materials, new Set(folders.map(f => f.id)));
  for (const m of save) await saveMaterial(m);

  for (const [id, mt] of Object.entries(header.translations ?? {})) {
    if (Array.isArray(mt)) await saveTranslations(id, mergeTranslations(await loadTranslations(id), mt));
  }

  let done = 0;
  for (const p of parts) {
    const blob = p.name ? new File([p.blob], p.name, { type: p.type }) : p.blob;
    if (p.store === 'media' && !(await getMedia(p.key))) await putMedia(p.key, blob);
    if (p.store === 'recordings' && !(await getRecording(p.key))) await putRecording(p.key, blob);
    onProgress?.(++done, parts.length);
  }

  const storage = header.storage ?? {};
  try {
    if (storage['shadowing:activity']) {
      const mine = JSON.parse(localStorage.getItem('shadowing:activity') || '{}');
      localStorage.setItem('shadowing:activity', JSON.stringify(mergeActivity(mine, JSON.parse(storage['shadowing:activity']))));
      globalThis.dispatchEvent?.(new Event('shadowing:activity'));
    }
    // Settings come along only where this browser has none yet.
    for (const key of ['shadowing:prefs', 'shadowing:theme']) {
      if (storage[key] != null && localStorage.getItem(key) == null) localStorage.setItem(key, storage[key]);
    }
  } catch { /* storage unavailable or a damaged entry: the materials are back regardless */ }
  return { added, updated, files: parts.length };
}
