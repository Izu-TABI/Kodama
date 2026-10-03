// English–Japanese word lookup with EJDict-hand (public domain), one file per first letter.

const files = new Map();
let fetchBucket = name => fetch(`/dict/${name}.json`).then(r => {
  if (!r.ok) throw new Error('辞書を読み込めませんでした');
  return r.json();
});

// For tests.
export function setDictionaryLoader(loader) {
  fetchBucket = loader;
  files.clear();
}

const bucketOf = key => (/^[a-z]/.test(key) ? key[0] : '_');

function bucket(key) {
  const name = bucketOf(key);
  if (!files.has(name)) files.set(name, fetchBucket(name).catch(e => { files.delete(name); throw e; }));
  return files.get(name);
}

async function entry(key) {
  const words = await bucket(key);
  return Object.hasOwn(words, key) ? words[key] : null;
}

export function normalizeWord(raw) {
  return raw
    .replace(/[’‘`]/g, "'")
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '')
    .replace(/^'+|'+$/g, '')
    .toLowerCase();
}

// Dictionary forms a word may come from: "planned" → plan, "heavier" → heavy, "don't" → do.
export function baseForms(w) {
  const out = [];
  const add = s => { if (s && s.length > 1 && s !== w && !out.includes(s)) out.push(s); };
  const stems = (s, suffixLength) => {
    const stem = s.slice(0, -suffixLength);
    add(stem + 'e');
    add(stem);
    if (/([^aeiou])\1$/.test(stem)) add(stem.slice(0, -1)); // planned → plan
  };
  let m;
  if ((m = /^(.+)n't$/.exec(w))) add({ wo: 'will', ca: 'can', sha: 'shall' }[m[1]] ?? m[1]);
  if ((m = /^(.+)'(s|re|ve|ll|d|m)$/.exec(w))) add(m[1]);
  if ((m = /^(.+s)'$/.exec(w))) add(m[1]);
  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/(s|x|z|ch|sh|o)es$/.test(w)) add(w.slice(0, -2));
  if (/[^s]s$/.test(w)) add(w.slice(0, -1));
  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
  else if (/ed$/.test(w)) stems(w, 2);
  if (/ying$/.test(w)) add(w.slice(0, -4) + 'ie');
  if (/ing$/.test(w)) stems(w, 3);
  if (/ier$/.test(w)) add(w.slice(0, -3) + 'y');
  else if (/er$/.test(w)) stems(w, 2);
  if (/iest$/.test(w)) add(w.slice(0, -4) + 'y');
  else if (/est$/.test(w)) stems(w, 3);
  if (/ily$/.test(w)) add(w.slice(0, -3) + 'y');
  else if (/ly$/.test(w)) add(w.slice(0, -2));
  return out;
}

// "goの過去", "『good』 の比較級" → the word they point to.
const POINTER = /『?([a-z]+)』?\s*の(?:過去分詞|過去|複数形|比較級|最上級|三人称単数|現在分詞|短縮形|縮約形)/gi;

// Up to three entries, most useful first: a substantial exact match, the word
// an inflected form points to, then dictionary forms (richer entries first).
export async function lookupWord(raw) {
  const word = normalizeWord(raw);
  if (!word) return { word, entries: [] };
  const exact = await entry(word);
  const found = [];
  const seen = new Set();
  const push = (head, meaning) => {
    if (meaning && !seen.has(head) && found.length < 3) { seen.add(head); found.push({ head, meaning }); }
  };
  if (exact && exact.length >= 20) push(word, exact);
  for (const m of (exact ?? '').matchAll(POINTER)) {
    const target = m[1].toLowerCase();
    if (target !== word) push(target, await entry(target));
  }
  const lemmas = [];
  for (const form of baseForms(word)) {
    const meaning = await entry(form);
    if (meaning) lemmas.push({ head: form, meaning });
  }
  lemmas.sort((a, b) => b.meaning.length - a.meaning.length).forEach(l => push(l.head, l.meaning));
  if (exact) push(word, exact);
  return { word, entries: found };
}

// Splits an entry into senses for display, without the emphasis brackets.
// A bracket between two English words stands for a space (《『manage to』do》).
export function senses(meaning, limit = 6) {
  return meaning
    .split(/\s*\/\s*/)
    .map(s => s.replace(/(?<=[A-Za-z])[『』](?=[A-Za-z])/g, ' ').replace(/[『』]/g, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

export const weblioUrl = word => `https://ejje.weblio.jp/content/${encodeURIComponent(word)}`;
