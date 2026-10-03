// Machine translations for the sentences that have no human (TED) translation.
// They are made once, in the background, when a material is added or opened,
// and kept in this browser so they show up instantly afterwards.
import { createStore, get, set, del } from 'idb-keyval';
import { getTranslator, translatorAvailability } from './translate.js';

let opened = null;
const store = () => (opened ??= createStore('shadowing-translations', 'translations'));

export const loadTranslations = async id => (await get(id, store()))?.mt ?? [];
export const deleteTranslations = id => del(id, store());

export const needsMachineTranslation = (segments, mt = []) => segments.some((s, i) => !s.ja && !mt[i]);

// Translates every sentence that has neither a human nor a machine translation yet.
export async function translateMissing(segments, existing, translate, { onProgress, save, signal } = {}) {
  const mt = segments.map((_, i) => existing[i] ?? null);
  const todo = segments.map((_, i) => i).filter(i => !segments[i].ja && !mt[i]);
  let done = 0;
  for (const i of todo) {
    if (signal?.aborted) break;
    try { mt[i] = (await translate(segments[i].text)) || null; } catch { mt[i] = null; }
    done++;
    onProgress?.({ done, total: todo.length, mt });
    if (save && (done % 8 === 0 || done === todo.length)) await save(mt);
  }
  return mt;
}

// One background job per material, shared by every screen that shows it.
const jobs = new Map();

function job(id) {
  if (!jobs.has(id)) jobs.set(id, { state: { status: 'idle', done: 0, total: 0, mt: null }, listeners: new Set(), running: false });
  return jobs.get(id);
}

export function translationState(id) {
  return job(id).state;
}

export function subscribeTranslations(id, fn) {
  const j = job(id);
  j.listeners.add(fn);
  return () => j.listeners.delete(fn);
}

// status: 'idle' | 'preparing' | 'running' | 'done' | 'needs-click' | 'unsupported' | 'failed'
export async function startTranslations(material) {
  const j = job(material.id);
  if (j.running) return;
  j.running = true;
  const emit = patch => {
    j.state = { ...j.state, ...patch };
    j.listeners.forEach(fn => fn(j.state));
  };
  try {
    const existing = await loadTranslations(material.id);
    if (!needsMachineTranslation(material.segments, existing)) return emit({ status: 'done', mt: existing });

    const availability = await translatorAvailability();
    if (availability === 'unsupported' || availability === 'unavailable') return emit({ status: 'unsupported', mt: existing });

    emit({ status: 'preparing', mt: existing });
    let translator;
    try {
      translator = await getTranslator();
    } catch {
      // The language pack has to be downloaded first, which needs a click —
      // unless a download started elsewhere has finished meanwhile.
      if (await translatorAvailability() !== 'available') return emit({ status: 'needs-click', mt: existing });
      try { translator = await getTranslator(); } catch { return emit({ status: 'needs-click', mt: existing }); }
    }
    emit({ status: 'running', mt: existing });
    const mt = await translateMissing(material.segments, existing, text => translator.translate(text), {
      onProgress: p => emit({ status: 'running', done: p.done, total: p.total, mt: p.mt }),
      save: mt => set(material.id, { mt }, store()),
    });
    emit({ status: 'done', mt });
  } catch {
    emit({ status: 'failed' });
  } finally {
    j.running = false;
  }
}
