import { useEffect, useState } from 'react';
import Library from './screens/Library.jsx';
import AddMaterial from './screens/AddMaterial.jsx';
import Practice from './screens/Practice.jsx';

function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export const go = path => { location.hash = `#/${path}`; };

export default function App() {
  const [page, arg, sub] = useHashRoute();
  useEffect(() => { window.scrollTo(0, 0); }, [page, arg]);
  if (page === 'add') return <AddMaterial initialKind={arg} folderId={sub} />;
  if (page === 'm' && arg) {
    const index = sub != null && /^\d+$/.test(sub) ? Number(sub) : undefined;
    return <Practice key={`${arg}/${sub ?? ''}`} id={arg} initialIndex={index} />;
  }
  return <Library />;
}
