// Everything stays in this browser (IndexedDB): materials, their media files,
// recordings and folders.
import { createStore, get, set, del, values, keys, delMany } from 'idb-keyval';
import { deleteTranslations } from './translations.js';

const materials = createStore('shadowing-materials', 'materials');
const media = createStore('shadowing-media', 'media');
const recordings = createStore('shadowing-recordings', 'recordings');
const meta = createStore('shadowing-meta', 'meta');

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function listMaterials() {
  const all = await values(materials);
  return all.sort((a, b) => (b.practicedAt || b.createdAt) - (a.practicedAt || a.createdAt));
}

export const getMaterial = id => get(id, materials);

export async function saveMaterial(m) {
  await set(m.id, m, materials);
  return m;
}

export async function updateMaterial(id, patch) {
  const m = await getMaterial(id);
  return m ? saveMaterial({ ...m, ...patch }) : null;
}

export async function createMaterial(fields, file) {
  navigator.storage?.persist?.().catch(() => {});
  const id = uid();
  const m = { id, cursor: 0, takes: {}, favorite: false, folderId: null, createdAt: Date.now(), practicedAt: 0, ...fields };
  if (file) {
    m.mediaId = id;
    await set(id, file, media);
  }
  return saveMaterial(m);
}

export const getMedia = id => get(id, media);

export async function deleteMaterial(id) {
  const m = await getMaterial(id);
  if (m?.mediaId) await del(m.mediaId, media);
  const recs = (await keys(recordings)).filter(k => String(k).startsWith(`${id}:`));
  await delMany(recs, recordings);
  await deleteTranslations(id);
  await del(id, materials);
}

export async function saveRecording(materialId, blob) {
  const key = `${materialId}:${uid()}`;
  await set(key, blob, recordings);
  return key;
}

export const getRecording = key => get(key, recordings);

// Drops recordings that no sentence refers to any more.
export async function pruneRecordings(m) {
  const used = new Set(Object.values(m.takes || {}).map(t => t.rec));
  const stale = (await keys(recordings)).filter(k => String(k).startsWith(`${m.id}:`) && !used.has(k));
  if (stale.length) await delMany(stale, recordings);
}

// ---- Folders ------------------------------------------------------------------
// Folders nest through parentId (null = top level); materials sit in folderId.

export async function listFolders() {
  return ((await get('folders', meta)) ?? []).map(f => ({ ...f, parentId: f.parentId ?? null }));
}

const saveFolders = folders => set('folders', folders, meta);

export async function createFolder(name, parentId = null) {
  const folder = { id: uid(), name, parentId, createdAt: Date.now() };
  await saveFolders([...(await listFolders()), folder]);
  return folder;
}

export async function renameFolder(id, name) {
  await saveFolders((await listFolders()).map(f => (f.id === id ? { ...f, name } : f)));
}

// Moves folders and materials into `target` (null = top level).
export async function moveItems({ folderIds = [], materialIds = [] }, target) {
  if (folderIds.length) {
    const ids = new Set(folderIds);
    await saveFolders((await listFolders()).map(f => (ids.has(f.id) ? { ...f, parentId: target } : f)));
  }
  for (const id of materialIds) await updateMaterial(id, { folderId: target });
}

// Deletes folders together with everything inside them.
export async function deleteFolders(folderIds, materialIds) {
  for (const id of materialIds) await deleteMaterial(id);
  const gone = new Set(folderIds);
  await saveFolders((await listFolders()).filter(f => !gone.has(f.id)));
}
