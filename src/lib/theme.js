// Light or dark: light unless chosen otherwise, kept in this browser.
// index.html applies a saved choice before the first paint.
import { useSyncExternalStore } from 'react';
import { changePage } from './transition.js';

const KEY = 'shadowing:theme';
const listeners = new Set();
const saved = () => {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
};
let theme = saved();

function apply(next) {
  theme = next;
  const root = document.documentElement;
  if (next === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--paper').trim());
  listeners.forEach(l => l());
}

export function toggleTheme() {
  const next = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  changePage(() => apply(next), { within: true, wait: false });
}

// Another tab changed it.
globalThis.addEventListener?.('storage', e => { if (e.key === KEY) apply(saved()); });

const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };
export const useTheme = () => useSyncExternalStore(subscribe, () => theme);
