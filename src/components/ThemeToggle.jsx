import Icon from './Icon.jsx';
import { toggleTheme, useTheme } from '../lib/theme.js';

// In every header, at the right end.
export default function ThemeToggle() {
  const dark = useTheme() === 'dark';
  return (
    <button className="theme-toggle" onClick={e => { e.stopPropagation(); toggleTheme(); }}
      aria-label="ダークモード" aria-pressed={dark} title={dark ? 'ライトモードにする' : 'ダークモードにする'}>
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
