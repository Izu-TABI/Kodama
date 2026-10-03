import { describe, expect, it } from 'vitest';
import { encodeBackup, decodeBackup, mergeFolders, mergeMaterials, mergeActivity, mergeTranslations, backupName } from './backup.js';

const header = (extra = {}) => ({ app: 'Kodama', version: 1, materials: [], folders: [], files: [], ...extra });

describe('backup file', () => {
  it('round-trips the header and the files after it', async () => {
    const audio = new Blob(['RIFF....WAVE'], { type: 'audio/wav' });
    const take = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const files = [
      { store: 'media', key: 'm1', type: audio.type, size: audio.size, name: 'lesson.wav' },
      { store: 'recordings', key: 'm1:r1', type: take.type, size: take.size },
    ];
    const blob = encodeBackup(header({ materials: [{ id: 'm1', segments: [] }], files }), [audio, take]);
    const { header: h, parts } = await decodeBackup(blob);
    expect(h.materials[0].id).toBe('m1');
    expect(parts.map(p => p.key)).toEqual(['m1', 'm1:r1']);
    expect(await parts[0].blob.text()).toBe('RIFF....WAVE');
    expect([...new Uint8Array(await parts[1].blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(parts[0].blob.type).toBe('audio/wav');
  });

  it('refuses other files, newer versions and cut-off files', async () => {
    await expect(decodeBackup(new Blob(['hello world, not a backup']))).rejects.toThrow('Kodamaのバックアップではありません');
    await expect(decodeBackup(encodeBackup(header({ version: 9 })))).rejects.toThrow('新しい版');
    const whole = encodeBackup(header({ files: [{ store: 'media', key: 'm', type: '', size: 100 }] }), [new Blob([new Uint8Array(100)])]);
    await expect(decodeBackup(whole.slice(0, whole.size - 10))).rejects.toThrow('途中で切れています');
  });

  it('is named by date', () => {
    expect(backupName(new Date(2026, 9, 3))).toBe('kodama-backup-2026-10-03.kodama');
  });
});

describe('merging a backup', () => {
  it('adds missing folders and lifts orphans to the top', () => {
    const merged = mergeFolders([{ id: 'a', name: 'A', parentId: null }], [
      { id: 'a', name: 'A (old name)', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'gone' },
      { id: 3, name: 'broken' },
    ]);
    expect(merged.map(f => [f.id, f.name, f.parentId])).toEqual([['a', 'A', null], ['b', 'B', 'a'], ['c', 'C', null]]);
  });

  it('keeps the copy practised more recently and drops unknown folders', () => {
    const mine = [{ id: 'x', segments: [], practicedAt: 200, cursor: 9 }, { id: 'y', segments: [], practicedAt: 100 }];
    const theirs = [
      { id: 'x', segments: [], practicedAt: 150, cursor: 1 },
      { id: 'y', segments: [], practicedAt: 300, cursor: 5, folderId: 'f1' },
      { id: 'z', segments: [], createdAt: 50, folderId: 'missing' },
      { id: 'bad' },
    ];
    const { save, added, updated } = mergeMaterials(mine, theirs, new Set(['f1']));
    expect(save.map(m => [m.id, m.folderId])).toEqual([['y', 'f1'], ['z', null]]);
    expect({ added, updated }).toEqual({ added: 1, updated: 1 });
  });

  it('joins practice days, keeping the larger counts', () => {
    const merged = mergeActivity({ days: { '2026-10-01': { n: 10, s: 60 }, '2026-10-02': { n: 3, s: 20 } } },
      { days: { '2026-10-02': { n: 8, s: 10 }, '2026-09-30': { n: 5, s: 30 }, junk: null } });
    expect(merged.days).toEqual({ '2026-10-01': { n: 10, s: 60 }, '2026-10-02': { n: 8, s: 20 }, '2026-09-30': { n: 5, s: 30 } });
  });

  it('fills only the sentences not translated here', () => {
    expect(mergeTranslations(['あ', null], [null, 'い', 'う'])).toEqual(['あ', 'い', 'う']);
  });
});
