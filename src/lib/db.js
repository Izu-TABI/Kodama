// Everything stays in this browser (IndexedDB): materials and their media files.
import { createStore, get, set, del, values } from 'idb-keyval';

const materials = createStore('shadowing-materials', 'materials');
const media = createStore('shadowing-media', 'media');

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
  const m = { id, cursor: 0, createdAt: Date.now(), practicedAt: 0, ...fields };
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
  await del(id, materials);
}
