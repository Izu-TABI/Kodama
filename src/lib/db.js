// Everything stays in this browser (IndexedDB): materials, their media files and recordings.
import { createStore, get, set, del, values, keys, delMany } from 'idb-keyval';

const materials = createStore('shadowing-materials', 'materials');
const media = createStore('shadowing-media', 'media');
const recordings = createStore('shadowing-recordings', 'recordings');

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

export async function createMaterial(fields, file) {
  navigator.storage?.persist?.().catch(() => {});
  const id = uid();
  const m = { id, takes: {}, cursor: 0, createdAt: Date.now(), practicedAt: 0, ...fields };
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
