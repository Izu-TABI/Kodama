import { describe, expect, it } from 'vitest';
import {
  folderPath, isWithin, subtree, sortItems, visibleRows, countInside, freeName, canMoveInto, parentOf, parseKey,
} from './tree.js';

const folders = [
  { id: 'a', name: '朝の練習', parentId: null },
  { id: 'b', name: '単語', parentId: 'a' },
  { id: 'c', name: '深い', parentId: 'b' },
  { id: 'd', name: 'Business', parentId: null },
];
const materials = [
  { id: '1', title: 'Talk 10', folderId: null, practicedAt: 5, duration: 300 },
  { id: '2', title: 'Talk 2', folderId: null, practicedAt: 9, duration: 100 },
  { id: '3', title: 'lesson', folderId: 'a', practicedAt: 0, duration: 50 },
  { id: '4', title: 'deep one', folderId: 'c' },
  { id: '5', title: 'orphan', folderId: 'gone' },
];

describe('tree', () => {
  it('walks paths and containment', () => {
    expect(folderPath(folders, 'c').map(f => f.id)).toEqual(['a', 'b', 'c']);
    expect(isWithin(folders, 'c', 'a')).toBe(true);
    expect(isWithin(folders, 'a', 'c')).toBe(false);
    expect(isWithin(folders, 'a', 'a')).toBe(true);
  });

  it('collects everything inside a folder', () => {
    const t = subtree(folders, materials, 'a');
    expect([...t.folderIds].sort()).toEqual(['a', 'b', 'c']);
    expect(t.materialIds.sort()).toEqual(['3', '4']);
  });

  it('treats dangling parents as the top level', () => {
    expect(parentOf(folders, materials[4])).toBeNull();
    expect(countInside(folders, materials, null)).toBe(5); // a, d, 1, 2, orphan
  });

  it('sorts names naturally and by other columns', () => {
    expect(sortItems(materials.slice(0, 2)).map(m => m.title)).toEqual(['Talk 2', 'Talk 10']);
    expect(sortItems(materials.slice(0, 2), { key: 'practiced', dir: 'desc' }).map(m => m.id)).toEqual(['2', '1']);
    expect(sortItems(materials.slice(0, 3), { key: 'length' }).map(m => m.id)).toEqual(['3', '2', '1']);
  });

  it('lists folders first and expands in place', () => {
    const rows = visibleRows(folders, materials, null, new Set(['a']), { key: 'name', dir: 'asc' });
    expect(rows.map(r => `${'  '.repeat(r.depth)}${r.item.name ?? r.item.title}`)).toEqual([
      'Business', '朝の練習', '  単語', '  lesson', 'orphan', 'Talk 2', 'Talk 10',
    ]);
  });

  it('finds a free name', () => {
    expect(freeName('新規フォルダ', [{ name: '新規フォルダ' }, { name: '新規フォルダ 2' }])).toBe('新規フォルダ 3');
    expect(freeName('X', [])).toBe('X');
  });

  it('refuses to move a folder into itself or its insides', () => {
    expect(canMoveInto(folders, ['f:a', 'm:1'], 'c')).toBe(false);
    expect(canMoveInto(folders, ['f:a'], 'a')).toBe(false);
    expect(canMoveInto(folders, ['f:b'], 'd')).toBe(true);
    expect(canMoveInto(folders, ['m:1'], null)).toBe(true);
    expect(parseKey('f:abc')).toEqual({ kind: 'folder', id: 'abc' });
  });
});
