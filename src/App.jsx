import { useEffect, useRef, useState } from 'react';
import { changePage, scrollMemory } from './lib/transition.js';
import Library from './screens/Library.jsx';
import AddMaterial from './screens/AddMaterial.jsx';
import Practice from './screens/Practice.jsx';
import Guide from './screens/Guide.jsx';

// Folders and favorites are all the library screen.
const screenOf = hash => {
  const page = hash.replace(/^#\/?/, '').split('/')[0];
  return page === '' || page === 'f' || page === 'fav' ? 'library' : page;
};

function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash);
  const current = useRef(location.hash);
  useEffect(() => {
    const on = () => {
      const from = current.current;
      scrollMemory.set(from, window.scrollY);
      current.current = location.hash;
      // A new page starts at the top; the library puts itself back where it was.
      changePage(() => {
        window.scrollTo(0, 0);
        setHash(location.hash);
      }, { within: screenOf(from) === screenOf(location.hash) });
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export const go = path => { location.hash = `#/${path}`; };

export default function App() {
  const [page, arg, sub] = useHashRoute();
  if (page === 'add') return <AddMaterial folderId={sub} />;
  if (page === 'f' && arg) return <Library folderId={arg} />;
  if (page === 'fav') return <Library view="favorites" />;
  if (page === 'guide') return <Guide standalone />;
  if (page === 'm' && arg) {
    const index = sub != null && /^\d+$/.test(sub) ? Number(sub) : undefined;
    return <Practice key={`${arg}/${sub ?? ''}`} id={arg} initialIndex={index} />;
  }
  return <Library />;
}
