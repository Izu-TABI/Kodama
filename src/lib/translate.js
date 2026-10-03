// Free machine translation for sentences with no human translation:
// Chrome's built-in on-device translator where available, else a Google 翻訳 link.

export const googleTranslateUrl = text =>
  `https://translate.google.com/?sl=en&tl=ja&op=translate&text=${encodeURIComponent(text)}`;

const PAIR = { sourceLanguage: 'en', targetLanguage: 'ja' };

export function canTranslateOnDevice() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

// 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
export async function translatorAvailability() {
  if (!canTranslateOnDevice()) return 'unsupported';
  try { return await self.Translator.availability(PAIR); } catch { return 'unsupported'; }
}

let translator = null;

// The first call may download the language pack, which Chrome only allows
// right after a click; call it from a click handler when that's possible.
export function getTranslator() {
  if (!canTranslateOnDevice()) return Promise.reject(new Error('unsupported'));
  translator ??= self.Translator.create(PAIR).catch(e => { translator = null; throw e; });
  return translator;
}

export async function translateOnDevice(text) {
  try {
    return await (await getTranslator()).translate(text);
  } catch {
    return null;
  }
}

// Starts downloading the language pack while a click still counts as one.
export function warmUpTranslator() {
  if (canTranslateOnDevice()) getTranslator().catch(() => {});
}
