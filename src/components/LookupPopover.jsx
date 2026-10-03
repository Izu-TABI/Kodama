import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lookupWord, senses, weblioUrl } from '../lib/dict.js';
import { canTranslateOnDevice, googleTranslateUrl, translateOnDevice } from '../lib/translate.js';
import Icon from './Icon.jsx';

// Meaning of a tapped word (English–Japanese dictionary), or a translation of selected text.
export default function LookupPopover({ text, anchor, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 8 });
  const single = !/\s/.test(text.trim());

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 12;
    const bottomLimit = window.innerHeight - (document.querySelector('.transport')?.offsetHeight ?? 0) - margin;
    let top = anchor.bottom + 8;
    if (top + height > bottomLimit && anchor.top - height - 8 > margin) top = anchor.top - height - 8;
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
    setPos({ left, top });
  }, [anchor, text]);

  useEffect(() => {
    const onDown = e => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    const onScroll = e => { if (!ref.current?.contains(e.target)) onClose(); };
    // Let the click that opened the popover finish first.
    const t = setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div className="popover" ref={ref} style={pos} role="dialog" aria-label={single ? '単語の意味' : '和訳'}>
      {single ? <WordEntries word={text} /> : <Translation text={text} />}
    </div>
  );
}

function WordEntries({ word }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    lookupWord(word).then(r => alive && setResult(r)).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [word]);

  if (error) return <p className="pop-note warn">{error}</p>;
  if (!result) return <p className="pop-note">調べています…</p>;
  return (
    <>
      {result.entries.length === 0 && <p className="pop-head">{result.word || word}</p>}
      {result.entries.map(e => (
        <section key={e.head} className="pop-entry">
          <p className="pop-head">{e.head}</p>
          <ol className="pop-senses">
            {senses(e.meaning).map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </section>
      ))}
      {result.entries.length === 0 && <p className="pop-note">辞書に見つかりませんでした</p>}
      <p className="pop-links">
        <a href={weblioUrl(result.word || word)} target="_blank" rel="noreferrer">Weblioで詳しく<Icon name="out" size={11} /></a>
      </p>
    </>
  );
}

function Translation({ text }) {
  const [state, setState] = useState(() => (canTranslateOnDevice() ? { status: 'loading' } : { status: 'none' }));
  useEffect(() => {
    if (!canTranslateOnDevice()) return;
    let alive = true;
    translateOnDevice(text).then(ja => alive && setState(ja ? { status: 'done', ja } : { status: 'none' }));
    return () => { alive = false; };
  }, [text]);

  return (
    <>
      <p className="pop-source">{text}</p>
      {state.status === 'loading' && <p className="pop-note">翻訳しています…</p>}
      {state.status === 'done' && <p className="pop-ja">{state.ja}<span className="tag">機械翻訳</span></p>}
      <p className="pop-links">
        <a href={googleTranslateUrl(text)} target="_blank" rel="noreferrer">Google翻訳で見る<Icon name="out" size={11} /></a>
      </p>
    </>
  );
}
