import { describe, expect, it, beforeEach } from 'vitest';
import { streamUrl, decodeTalk, parseTedSlug, searchTalks, alignTranslation, joinJapanese, imageUrl } from './ted.js';
import { baseForms, normalizeWord, lookupWord, senses, setDictionaryLoader } from './dict.js';
import { summarize, dayKey } from './activity.js';
import { translateMissing, needsMachineTranslation } from './translations.js';

describe('TED catalog', () => {
  it('expands packed stream keys', () => {
    expect(streamUrl('2597:9294')).toBe('https://hls.ted.com/project_masters/2597/manifest.m3u8?intro_master_id=9294');
    expect(streamUrl('12055', 'metadata.json')).toBe('https://hls.ted.com/project_masters/12055/metadata.json');
    expect(streamUrl('https://x.test/a/manifest.m3u8?k=1', 'metadata.json')).toBe('https://x.test/a/metadata.json?k=1');
  });

  it('expands packed thumbnails', () => {
    expect(imageUrl('p:abc/x.jpg', 240)).toBe('https://pi.tedcdn.com/r/talkstar-photos.s3.amazonaws.com/uploads/abc/x.jpg?w=240');
    expect(imageUrl('a:talk_1/y.jpg')).toBe('https://pi.tedcdn.com/r/talkstar-assets.s3.amazonaws.com/production/talks/talk_1/y.jpg');
    expect(imageUrl('e:abc_2880x1620.jpg', 240)).toBe('https://pi.tedcdn.com/r/pe.tedcdn.com/images/ted/abc_2880x1620.jpg?w=240');
    expect(imageUrl('https://pe.tedcdn.com/images/other/z.jpg', 120)).toBe('https://pi.tedcdn.com/r/pe.tedcdn.com/images/other/z.jpg?w=120');
    expect(imageUrl('')).toBe('');
    expect(decodeTalk(['s', 't', 'p', 1, 2020, 3, '9', 0, 1, 'p:z.jpg'], 0).image).toBe('p:z.jpg');
  });

  it('recognises talk URLs', () => {
    const slug = 'tim_urban_inside_the_mind_of_a_master_procrastinator';
    for (const s of [
      `https://www.ted.com/talks/${slug}`,
      `https://www.ted.com/talks/${slug}?language=ja`,
      `https://www.ted.com/talks/${slug}/transcript`,
      `https://embed.ted.com/talks/${slug}`,
      `ted.com/talks/lang/en/${slug}`,
    ]) expect(parseTedSlug(s)).toBe(slug);
    expect(parseTedSlug('https://www.ted.com/playlists/1/x')).toBeNull();
    expect(parseTedSlug('procrastinator')).toBeNull();
  });

  const talks = [
    ['a_short', 'Short and sweet', 'Ann Lee', 300, 2020, 10, '1', 0, 1],
    ['b_brene', 'The power of vulnerability', 'Brené Brown', 1200, 2011, 900, '2', 0, 1],
    ['c_mid', 'A middle talk', 'Carl Mid', 600, 2024, 50, '3', 1, 0],
  ].map(decodeTalk);

  it('searches titles and speakers, ignoring accents and case', () => {
    expect(searchTalks(talks, { query: 'brene' }).map(t => t.slug)).toEqual(['b_brene']);
    expect(searchTalks(talks, { query: 'TALK mid' }).map(t => t.slug)).toEqual(['c_mid']);
  });

  it('filters by length and Japanese translation, and sorts', () => {
    expect(searchTalks(talks, { length: 'short' }).map(t => t.slug)).toEqual(['a_short']);
    expect(searchTalks(talks, { length: 'longer' }).map(t => t.slug)).toEqual(['b_brene']);
    expect(searchTalks(talks, { japanese: true }).map(t => t.slug)).toEqual(['a_short', 'b_brene']);
    expect(searchTalks(talks, { sort: 'popular' }).map(t => t.slug)).toEqual(['b_brene', 'c_mid', 'a_short']);
  });

  it('gives each sentence the translated cues that fall in it', () => {
    const segments = [{ start: 4, end: 10.9 }, { start: 10.9, end: 15.4 }];
    const cues = [
      { start: 4.03, end: 5.52, text: '大学では' },
      { start: 6.85, end: 8.51, text: '政治専攻だったので' },
      { start: 8.51, end: 10.81, text: 'レポートを沢山 書かなければなりませんでした' },
      { start: 10.81, end: 12.5, text: '普通の学生が レポートを書く場合' },
      { start: 12.5, end: 15.37, text: '作業量はこんな感じに' },
    ];
    expect(alignTranslation(segments, cues)).toEqual([
      '大学では 政治専攻だったので レポートを沢山書かなければなりませんでした',
      '普通の学生がレポートを書く場合 作業量はこんな感じに',
    ]);
    expect(joinJapanese('I said 「OK」 で')).toBe('I said 「OK」で');
  });
});

describe('dictionary', () => {
  const data = {
    d: { day: '〈C〉日,1日 / 昼間 / 時代', days: 'たいてい昼間は', decide: '〈事〉を決める,決定する / 決心する', decided: '『明白な』,決定的な / (人・態度・性格などが)『断固とした』,ぐらつかない' },
    g: { go: '行く,進む / 動く,作動する / 去る,出発する', good: 'よい,上等な / 親切な' },
    w: { went: 'goの過去' },
    h: { heavy: '重い,重量のある / 激しい', heavier: undefined },
    b: { better: '(『good』 の比較級;最上級は 『best』)『いっそうよい』,もっとすぐれた' },
    p: { plan: '計画,案 / 〈事〉を計画する' },
    c: { constructor: '建設者' },
  };
  beforeEach(() => setDictionaryLoader(async name => JSON.parse(JSON.stringify(data[name] ?? {}))));

  it('normalises words from the script', () => {
    expect(normalizeWord('“Papers,”')).toBe('papers');
    expect(normalizeWord('don’t')).toBe("don't");
    expect(normalizeWord('--')).toBe('');
  });

  it('derives dictionary forms', () => {
    expect(baseForms('planned')).toContain('plan');
    expect(baseForms('heavier')).toContain('heavy');
    expect(baseForms('studies')).toContain('study');
    expect(baseForms('making')).toContain('make');
    expect(baseForms('running')).toContain('run');
    expect(baseForms("don't")).toContain('do');
    expect(baseForms("won't")).toContain('will');
    expect(baseForms("student's")).toContain('student');
  });

  it('shows the dictionary form first when the exact entry is thin', async () => {
    expect((await lookupWord('Days')).entries.map(e => e.head)).toEqual(['day', 'days']);
    expect((await lookupWord('went')).entries.map(e => e.head)).toEqual(['go', 'went']);
    expect((await lookupWord('heavier,')).entries.map(e => e.head)).toEqual(['heavy']);
    expect((await lookupWord('planned')).entries.map(e => e.head)).toEqual(['plan']);
  });

  it('keeps a substantial exact entry first', async () => {
    expect((await lookupWord('decided')).entries.map(e => e.head)).toEqual(['decided', 'decide']);
    expect((await lookupWord('better')).entries.map(e => e.head)).toEqual(['better', 'good']);
  });

  it('treats object property names as ordinary words', async () => {
    expect((await lookupWord('constructor')).entries).toEqual([{ head: 'constructor', meaning: '建設者' }]);
    expect((await lookupWord('toString')).entries).toEqual([]);
  });

  it('splits senses', () => {
    expect(senses('『行く』,進む / 動く / 去る', 2)).toEqual(['行く,進む', '動く']);
  });
});

describe('streaks', () => {
  const at = s => new Date(`${s}T09:00:00`);
  const days = Object.fromEntries(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-02', '2026-10-03'].map(k => [k, { n: 5, s: 60 }]));

  it('counts back from today', () => {
    const s = summarize(days, at('2026-10-03'));
    expect(s.current).toBe(2);
    expect(s.best).toBe(3);
    expect(s.today.n).toBe(5);
    expect(s.recent).toHaveLength(14);
    expect(s.recent[13]).toEqual({ key: '2026-10-03', n: 5 });
  });

  it('keeps the streak open until today ends', () => {
    expect(summarize(days, at('2026-10-04')).current).toBe(2);
    expect(summarize(days, at('2026-10-05')).current).toBe(0);
  });

  it('uses local dates', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('machine translations', () => {
  const segments = [{ text: 'Hello.', ja: 'こんにちは。' }, { text: 'Good morning.' }, { text: 'Thank you.' }, { text: 'Bye.' }];

  it('translates only sentences without any translation, resuming saved work', async () => {
    const asked = [];
    const saves = [];
    const progress = [];
    const mt = await translateMissing(segments, [null, '（保存済み）'], async text => { asked.push(text); return `訳:${text}`; }, {
      onProgress: p => progress.push(`${p.done}/${p.total}`),
      save: async m => saves.push([...m]),
    });
    expect(asked).toEqual(['Thank you.', 'Bye.']);
    expect(mt).toEqual([null, '（保存済み）', '訳:Thank you.', '訳:Bye.']);
    expect(progress).toEqual(['1/2', '2/2']);
    expect(saves.at(-1)).toEqual(mt);
  });

  it('keeps going when one sentence fails', async () => {
    const mt = await translateMissing(segments, [], async text => { if (text === 'Good morning.') throw new Error('x'); return 'ok'; });
    expect(mt).toEqual([null, null, 'ok', 'ok']);
    expect(needsMachineTranslation(segments, mt)).toBe(true);
    expect(needsMachineTranslation(segments, [null, 'a', 'b', 'c'])).toBe(false);
  });
});
