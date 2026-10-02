import { describe, expect, it } from 'vitest';
import { pickCaptionTrack, json3ToLines, lookup } from './lookup.js';
import { parseSource, parseTedSlug } from '../src/lib/sources.js';

const track = (languageCode, kind) => ({ languageCode, kind, baseUrl: `https://x/${languageCode}/${kind || 'manual'}` });

describe('pickCaptionTrack', () => {
  it('takes human-made English captions', () => {
    expect(pickCaptionTrack([track('ja'), track('en'), track('en', 'asr')]).baseUrl).toBe('https://x/en/manual');
    expect(pickCaptionTrack([track('en-GB')]).languageCode).toBe('en-GB');
    expect(pickCaptionTrack([track('en-US'), track('en')]).languageCode).toBe('en');
  });

  it('refuses auto-generated only, missing or non-English captions', () => {
    expect(() => pickCaptionTrack([track('en', 'asr')])).toThrow(expect.objectContaining({ code: 'auto_only' }));
    expect(() => pickCaptionTrack([])).toThrow(expect.objectContaining({ code: 'no_captions' }));
    expect(() => pickCaptionTrack([track('ja')])).toThrow(expect.objectContaining({ code: 'no_captions' }));
    // English subtitles on a video whose speech is Hindi.
    expect(() => pickCaptionTrack([track('en'), track('hi', 'asr')])).toThrow(expect.objectContaining({ code: 'not_english' }));
  });
});

describe('json3ToLines', () => {
  it('reads YouTube timed text events', () => {
    const lines = json3ToLines({
      events: [
        { tStartMs: 0, dDurationMs: 900000, id: 1 },
        { tStartMs: 12645, dDurationMs: 1370, segs: [{ utf8: 'So in college,' }] },
        { tStartMs: 16937, dDurationMs: 2462, segs: [{ utf8: 'which means I had\na lot of papers.' }] },
        { tStartMs: 19000, dDurationMs: 1000, segs: [{ utf8: '(Laughter)' }] },
        { tStartMs: 20000, segs: [{ utf8: '\n' }] },
      ],
    });
    expect(lines).toEqual([
      { start: 12.645, end: 14.015, text: 'So in college,' },
      { start: 16.937, end: 19.399, text: 'which means I had a lot of papers.' },
    ]);
  });
});

describe('sources', () => {
  it('recognises TED talk URLs', () => {
    const slug = 'tim_urban_inside_the_mind_of_a_master_procrastinator';
    for (const s of [
      `https://www.ted.com/talks/${slug}`,
      `https://www.ted.com/talks/${slug}?language=ja`,
      `https://www.ted.com/talks/${slug}/transcript`,
      `https://embed.ted.com/talks/${slug}`,
      `ted.com/talks/lang/en/${slug}`,
    ]) expect(parseTedSlug(s)).toBe(slug);
    expect(parseTedSlug('https://www.ted.com/playlists/1/x')).toBeNull();
    expect(parseTedSlug('https://notted.com/talks/x')).toBeNull();
  });

  it('tells YouTube and TED apart', () => {
    expect(parseSource('https://youtu.be/arj7oStGLkU')).toEqual({ kind: 'youtube', id: 'arj7oStGLkU' });
    expect(parseSource('https://www.ted.com/talks/a_b')).toEqual({ kind: 'ted', id: 'a_b' });
    expect(parseSource('https://vimeo.com/1')).toBeNull();
  });

  it('rejects other sites before any request', async () => {
    await expect(lookup('https://vimeo.com/1')).rejects.toMatchObject({ code: 'unsupported_url', status: 400 });
  });
});
