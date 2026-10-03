// The library as a file tree: folders (nested by parentId) holding materials (by folderId).
// Pure helpers, shared by the list view, the move dialog and the importer.

export const folderKey = id => `f:${id}`;
export const materialKey = id => `m:${id}`;
export const parseKey = key => ({ kind: key[0] === 'f' ? 'folder' : 'material', id: key.slice(2) });

// Missing or dangling parents count as the top level.
export function parentOf(folders, item) {
  const parent = item.parentId ?? item.folderId ?? null;
  return parent && folders.some(f => f.id === parent) ? parent : null;
}

export function folderPath(folders, id) {
  const path = [];
  const seen = new Set();
  for (let f = folders.find(x => x.id === id); f && !seen.has(f.id); f = folders.find(x => x.id === f.parentId)) {
    seen.add(f.id);
    path.unshift(f);
  }
  return path;
}

// True when `id` is `ancestor` itself or somewhere inside it.
export function isWithin(folders, id, ancestor) {
  return folderPath(folders, id).some(f => f.id === ancestor);
}

export function subtree(folders, materials, id) {
  const folderIds = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (!folderIds.has(f.id) && folderIds.has(f.parentId)) { folderIds.add(f.id); grew = true; }
    }
  }
  return { folderIds, materialIds: materials.filter(m => folderIds.has(m.folderId)).map(m => m.id) };
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
const nameOf = item => item.name ?? item.title ?? '';

const BY = {
  name: (a, b) => collator.compare(nameOf(a), nameOf(b)),
  practiced: (a, b) => (a.practicedAt || 0) - (b.practicedAt || 0),
  added: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  length: (a, b) => (a.duration || 0) - (b.duration || 0),
};

export function sortItems(items, { key = 'name', dir = 'asc' } = {}) {
  const by = BY[key] ?? BY.name;
  const sign = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => sign * by(a, b) || collator.compare(nameOf(a), nameOf(b)));
}

export function childrenOf(folders, materials, parentId) {
  return {
    folders: folders.filter(f => parentOf(folders, f) === parentId),
    materials: materials.filter(m => parentOf(folders, m) === parentId),
  };
}

// Rows as the list view shows them: folders first, expanded folders followed by their contents.
export function visibleRows(folders, materials, parentId, expanded, sort, depth = 0) {
  const { folders: fs, materials: ms } = childrenOf(folders, materials, parentId);
  const rows = [];
  // Folders sort by name, except when sorting by date added.
  for (const f of sortItems(fs, sort.key === 'added' ? sort : { key: 'name', dir: sort.key === 'name' ? sort.dir : 'asc' })) {
    rows.push({ kind: 'folder', key: folderKey(f.id), item: f, depth });
    if (expanded.has(f.id)) rows.push(...visibleRows(folders, materials, f.id, expanded, sort, depth + 1));
  }
  for (const m of sortItems(ms, sort)) rows.push({ kind: 'material', key: materialKey(m.id), item: m, depth });
  return rows;
}

export function countInside(folders, materials, id) {
  const { folders: fs, materials: ms } = childrenOf(folders, materials, id);
  return fs.length + ms.length;
}

// A name not yet used among the siblings: 新規フォルダ, 新規フォルダ 2, …
export function freeName(base, siblings) {
  const taken = new Set(siblings.map(nameOf));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

// Folders the selection may move into: not into a moved folder or anything inside it.
export function canMoveInto(folders, keys, target) {
  for (const key of keys) {
    const { kind, id } = parseKey(key);
    if (kind === 'folder' && target && isWithin(folders, target, id)) return false;
  }
  return true;
}
