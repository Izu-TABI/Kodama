import { describe, expect, it } from 'vitest';
import { parseTranscript, parseStamp, cleanText } from './transcript.js';
import { isSentenceEnd, linesToWords, wordsToSegments, transcriptToSegments, mergeWithNext, fmtTime } from './segments.js';
import { parseVideoId } from './youtube.js';

describe('parseStamp', () => {
  it('reads m:ss, h:mm:ss and fractions', () => {
    expect(parseStamp('0:07')).toBe(7);
    expect(parseStamp('12:34')).toBe(754);
    expect(parseStamp('1:02:03')).toBe(3723);
    expect(parseStamp('00:00:01,500')).toBe(1.5);
    expect(parseStamp('00:01.25')).toBe(1.25);
    expect(parseStamp('hello')).toBeNull();
  });
});

describe('parseTranscript', () => {
  it('reads the YouTube copy with timestamps on their own lines', () => {
    const raw = '0:00\nSo in college,\n0:03\n2 seconds\nI was a government major,\n0:05\nwhich means I had to write a lot of papers.';
    expect(parseTranscript(raw)).toEqual([
      { start: 0, text: 'So in college,' },
      { start: 3, text: 'I was a government major,' },
      { start: 5, text: 'which means I had to write a lot of papers.' },
    ]);
  });

  it('reads timestamps and text on one line, dropping non-speech', () => {
    const raw = '0:00 [Music]\n0:04 Hello there. (Laughter)\n1:02:03 >> Bye.';
    expect(parseTranscript(raw)).toEqual([
      { start: 4, text: 'Hello there.' },
      { start: 3723, text: 'Bye.' },
    ]);
  });

  it('reads SRT', () => {
    const raw = '1\n00:00:01,000 --> 00:00:03,500\nHello\nworld.\n\n2\n00:00:04,000 --> 00:00:06,000\n<i>Next</i> line.\n';
    expect(parseTranscript(raw)).toEqual([
      { start: 1, end: 3.5, text: 'Hello world.' },
      { start: 4, end: 6, text: 'Next line.' },
    ]);
  });

  it('drops rolled-up repeats in YouTube auto VTT', () => {
    const raw = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000 align:start\nwe are going\n\n00:00:02.000 --> 00:00:04.000\nwe are going\nto the park\n';
    expect(parseTranscript(raw).map(l => l.text)).toEqual(['we are going', 'to the park']);
  });

  it('cleans entities and markers', () => {
    expect(cleanText('>> it&#39;s  fine ♪')).toBe("it's fine");
  });
});

describe('isSentenceEnd', () => {
  it('handles punctuation, quotes and abbreviations', () => {
    expect(isSentenceEnd('papers.')).toBe(true);
    expect(isSentenceEnd('really?"')).toBe(true);
    expect(isSentenceEnd('Mr.')).toBe(false);
    expect(isSentenceEnd('J.')).toBe(false);
    expect(isSentenceEnd('U.S.')).toBe(false);
    expect(isSentenceEnd('college,')).toBe(false);
  });
});

describe('segments', () => {
  it('spreads line time over words', () => {
    const words = linesToWords([{ start: 0, text: 'ab cd' }, { start: 2, text: 'ef.' }], 4);
    expect(words[0]).toEqual({ text: 'ab', start: 0, end: 1 });
    expect(words[1].end).toBe(2);
    expect(words[2].end).toBe(3.5); // last line: estimated from its length, not stretched to the end
  });

  it('splits caption lines into sentences across line boundaries', () => {
    const segs = transcriptToSegments([
      { start: 0, text: 'So in college, I was a' },
      { start: 2, text: 'government major. Now, when' },
      { start: 4, text: 'a student writes a paper.' },
    ], 6);
    expect(segs.map(s => s.text)).toEqual([
      'So in college, I was a government major.',
      'Now, when a student writes a paper.',
    ]);
    expect(segs[0].start).toBe(0);
    expect(segs[1].end).toBe(6);
    expect(segs[0].end).toBeLessThanOrEqual(segs[1].start + 0.001);
  });

  it('pads Whisper words without overlapping neighbours', () => {
    const segs = wordsToSegments([
      { text: ' So', start: 0.74, end: 0.84 },
      { text: ' major.', start: 1, end: 1.2 },
      { text: ' Now', start: 1.4, end: 1.6 },
      { text: ' go.', start: 1.6, end: 2 },
    ]);
    expect(segs).toEqual([
      { start: 0.59, end: 1.34, text: 'So major.' },
      { start: 1.34, end: 2.35, text: 'Now go.' },
    ]);
  });

  it('cuts unpunctuated text at a comma or by length', () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ text: i === 10 ? 'w,' : 'w', start: i * 0.5, end: i * 0.5 + 0.5 }));
    const segs = wordsToSegments(words, { maxDuration: 10 });
    expect(segs[0].text.split(' ').length).toBe(11);
    expect(segs.every(s => s.end - s.start <= 11)).toBe(true);
  });

  it('breaks at long pauses', () => {
    const segs = wordsToSegments([
      { text: 'one', start: 0, end: 1 }, { text: 'two', start: 1, end: 2 },
      { text: 'three', start: 4, end: 5 },
    ]);
    expect(segs.map(s => s.text)).toEqual(['one two', 'three']);
  });

  it('merges neighbours', () => {
    const merged = mergeWithNext([{ start: 0, end: 1, text: 'a' }, { start: 1, end: 2, text: 'b' }, { start: 2, end: 3, text: 'c' }], 0);
    expect(merged).toEqual([{ start: 0, end: 2, text: 'a b' }, { start: 2, end: 3, text: 'c' }]);
  });

  it('formats time', () => {
    expect(fmtTime(65.9)).toBe('1:05');
    expect(fmtTime(3723)).toBe('1:02:03');
  });
});

describe('parseVideoId', () => {
  it('accepts common URL shapes', () => {
    for (const s of [
      'https://www.youtube.com/watch?v=arj7oStGLkU&t=10s',
      'https://youtu.be/arj7oStGLkU?si=x',
      'youtube.com/shorts/arj7oStGLkU',
      'https://m.youtube.com/watch?v=arj7oStGLkU',
      'https://www.youtube.com/embed/arj7oStGLkU',
      'arj7oStGLkU',
    ]) expect(parseVideoId(s)).toBe('arj7oStGLkU');
    expect(parseVideoId('https://example.com/watch?v=arj7oStGLkU')).toBeNull();
    expect(parseVideoId('hello')).toBeNull();
  });
});
