// Free machine translation for sentences that have no human translation:
// Chrome's built-in on-device translator where available, else a Google 翻訳 link.

export const googleTranslateUrl = text =>
  `https://translate.google.com/?sl=en&tl=ja&op=translate&text=${encodeURIComponent(text)}`;

export function canTranslateOnDevice() {
  return typeof self !== 'undefined' && 'Translator' in self;
}

let translator = null;

// Must be first called from a click: the language pack may need downloading.
export async function translateOnDevice(text) {
  if (!canTranslateOnDevice()) return null;
  try {
    if (!translator) {
      const availability = await self.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' });
      if (availability === 'unavailable') return null;
      translator = self.Translator.create({ sourceLanguage: 'en', targetLanguage: 'ja' }).catch(e => { translator = null; throw e; });
    }
    return await (await translator).translate(text);
  } catch {
    return null;
  }
}
