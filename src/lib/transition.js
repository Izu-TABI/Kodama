// Smooth page changes. With the View Transitions API the old page fades into
// the new one; the new page gets a moment to load its content (from IndexedDB)
// first, so it doesn't appear empty and then fill in.
import { flushSync } from 'react-dom';

const WAIT = 220; // longest wait for the new page before showing it anyway
let release = null;
let latest = null;

// Screens call this once their content is on screen.
export function pageReady() {
  release?.();
  release = null;
}

const smooth = () =>
  typeof document !== 'undefined' &&
  'startViewTransition' in document &&
  document.visibilityState === 'visible' &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

// `within`: the same screen with other contents (another folder), which only
// cross-fades so that what stays the same doesn't move.
export function changePage(update, { within = false } = {}) {
  if (!smooth()) {
    flushSync(update);
    return;
  }
  const root = document.documentElement;
  root.dataset.transition = within ? 'within' : 'page';
  const transition = document.startViewTransition(async () => {
    const ready = new Promise(resolve => {
      release = resolve;
      setTimeout(resolve, WAIT);
    });
    flushSync(update);
    await ready;
  });
  latest = transition;
  // A quicker page change skips this one; its update still runs, so nothing is lost.
  transition.ready.catch(() => {});
  const done = () => { if (latest === transition) delete root.dataset.transition; };
  transition.finished.then(done, done);
}

// Scroll positions of pages left behind, to return to them where you were.
export const scrollMemory = new Map();
