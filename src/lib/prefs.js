import { useEffect, useState } from 'react';

const KEY = 'shadowing:prefs';
const DEFAULTS = { mode: 'single', rate: 1, showText: true, showJa: false, repeat: 1, record: false };

function read() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(read);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  }, [prefs]);
  return [prefs, patch => setPrefs(p => ({ ...p, ...patch }))];
}
