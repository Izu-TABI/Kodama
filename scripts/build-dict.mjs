// Builds public/dict/<letter>.json from EJDict-hand, a public-domain (CC0)
// English–Japanese dictionary: https://github.com/kujirahand/EJDict
// One file per first letter so a lookup only downloads the part it needs.
import { mkdirSync, writeFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/kujirahand/EJDict/master/src/';
const OUT = new URL('../public/dict/', import.meta.url);

export const bucketOf = key => (/^[a-z]/.test(key) ? key[0] : '_');

const buckets = {};
let entries = 0;
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  const res = await fetch(`${SRC}${letter}.txt`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${letter}.txt: ${res.status}`);
  for (const line of (await res.text()).split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const meaning = line.slice(tab + 1).trim();
    for (const head of line.slice(0, tab).split(',')) {
      const key = head.trim().toLowerCase();
      if (!key || !meaning) continue;
      // No prototype, so headwords like "constructor" are just words.
      const bucket = (buckets[bucketOf(key)] ??= Object.create(null));
      if (!bucket[key]) { bucket[key] = meaning; entries++; }
      else if (!bucket[key].includes(meaning)) bucket[key] += ` / ${meaning}`;
    }
  }
}

mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [name, words] of Object.entries(buckets)) {
  const json = JSON.stringify(words);
  bytes += json.length;
  writeFileSync(new URL(`${name}.json`, OUT), json);
}
console.log(`${entries} entries in ${Object.keys(buckets).length} files, ${(bytes / 1e6).toFixed(2)} MB`);
