import { describe, expect, it } from 'vitest';
import { entriesFromDrop, filesFromInput, isMediaFile } from './files.js';

// Minimal stand-ins for the browser's FileSystemEntry objects.
const file = name => ({ isFile: true, name, file: ok => ok({ name, type: name.endsWith('.wav') ? 'audio/wav' : 'text/plain' }) });
const dir = (name, children) => {
  let read = false;
  return {
    isDirectory: true,
    name,
    createReader: () => ({ readEntries: ok => { ok(read ? [] : children); read = true; } }),
  };
};

describe('files', () => {
  it('walks dropped folders and keeps their path', async () => {
    const tree = dir('Podcast', [file('a.wav'), dir('Week 1', [file('b.wav'), file('notes.txt')])]);
    const read = entriesFromDrop({ items: [{ kind: 'file', webkitGetAsEntry: () => tree }, { kind: 'file', webkitGetAsEntry: () => file('c.wav') }] });
    const found = await read();
    expect(found.map(f => `${f.dirs.join('/')}|${f.file.name}`)).toEqual([
      'Podcast|a.wav', 'Podcast/Week 1|b.wav', 'Podcast/Week 1|notes.txt', '|c.wav',
    ]);
    expect(found.filter(f => isMediaFile(f.file)).length).toBe(3);
  });

  it('falls back to plain files and reads picked folders', async () => {
    const read = entriesFromDrop({ items: [], files: [{ name: 'x.mp3', type: 'audio/mpeg' }] });
    expect((await read()).map(f => f.file.name)).toEqual(['x.mp3']);
    expect(filesFromInput([{ name: 'y.m4a', type: '', webkitRelativePath: 'Top/Sub/y.m4a' }])[0].dirs).toEqual(['Top', 'Sub']);
    expect(isMediaFile({ name: 'clip.MOV', type: '' })).toBe(true);
  });
});
