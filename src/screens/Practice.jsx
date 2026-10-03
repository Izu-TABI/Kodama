import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getMaterial, saveMaterial, getMedia, saveRecording, getRecording, pruneRecordings } from '../lib/db.js';
import { attachHls, mediaElementPlayer, playRange } from '../lib/players.js';
import { Mic, decodeBlob, playClip, mediaToRecording, audioContext } from '../lib/audio.js';
import { streamUrl, imageUrl } from '../lib/ted.js';
import { getTranslator, googleTranslateUrl } from '../lib/translate.js';
import { loadTranslations, startTranslations, subscribeTranslations, translationState } from '../lib/translations.js';
import { logPractice } from '../lib/activity.js';
import { fmtTime } from '../lib/segments.js';
import { usePrefs } from '../lib/prefs.js';
import { pageReady } from '../lib/transition.js';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';
import LookupPopover from '../components/LookupPopover.jsx';

// Pause between repeats of the same sentence.
const REPEAT_GAP = 700;
// Keep recording a little after the model ends: shadowers trail behind it.
const TAIL = 0.9;
// The model reaches the ear this much later than the player reports (large on
// Bluetooth); line recordings up with what was actually heard.
const heardLatency = () => audioContext().outputLatency || 0;

const sleep = (ms, signal) => new Promise(resolve => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// Puts a sentence a little above the middle of what's visible: below a
// pinned video (phones) and above the controls at the bottom. On opening, a
// sentence already above that height stays put (so the first sentences keep
// the title and settings in view); one further down is brought up to it.
// Returns whether the sentence was moved.
function placeAtReadingHeight(row, { opening }) {
  const controls = document.querySelector('.transport')?.offsetHeight ?? 0;
  const screen = document.querySelector('.practice.with-video .screen');
  const pinned = screen && getComputedStyle(screen).position === 'sticky' ? screen.offsetHeight : 0;
  const visible = window.innerHeight - controls - pinned;
  const r = row.getBoundingClientRect();
  const target = pinned + visible * 0.42 - Math.min(r.height, visible * 0.6) / 2;
  const delta = r.top - target;
  if (opening && delta <= 0) return false;
  if (Math.abs(delta) > 4) window.scrollBy({ top: delta, behavior: opening ? 'auto' : 'smooth' });
  return true;
}

const indexAt = (segments, t) => {
  let k = 0;
  for (let i = 0; i < segments.length; i++) if (segments[i].start <= t + 0.01) k = i;
  return k;
};

// Sentences fully heard between two media times.
const sentencesBetween = (segments, from, to) => segments.filter(s => s.start >= from - 0.05 && s.end <= to + 0.05).length;

const toggled = (set, i) => {
  const n = new Set(set);
  if (n.has(i)) n.delete(i);
  else n.add(i);
  return n;
};

export default function Practice({ id, initialIndex }) {
  const [m, setM] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [prefs, setPrefs] = usePrefs();
  const [busy, setBusy] = useState(null);
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(() => new Set());
  const [jaOpen, setJaOpen] = useState(() => new Set());
  const [mt, setMt] = useState([]);
  const [translation, setTranslation] = useState({ status: 'idle' });
  const [lookup, setLookup] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(() => !matchMedia('(max-width: 640px)').matches);

  const mRef = useRef(null);
  const prefsRef = useRef(prefs);
  const playerRef = useRef(null);
  const abortRef = useRef(null);
  const clipRef = useRef(null);
  const micRef = useRef(null);
  const idleRef = useRef(null);
  const levelRef = useRef(null);
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const rowRefs = useRef([]);
  mRef.current = m;
  prefsRef.current = prefs;

  // Load the material.
  useEffect(() => {
    let url;
    getMaterial(id).then(async mat => {
      if (!mat) return setMissing(true);
      setM(mat);
      const start = Number.isInteger(initialIndex) && initialIndex < mat.segments.length ? initialIndex : mat.cursor || 0;
      setIndex(Math.min(start, mat.segments.length - 1));
      if (mat.kind === 'file') {
        const blob = await getMedia(mat.mediaId);
        if (!blob) return setError('元のファイルが見つかりません');
        url = URL.createObjectURL(blob);
        setFileUrl(url);
      }
    });
    micRef.current = new Mic();
    return () => {
      abortRef.current?.abort();
      clipRef.current?.stop();
      clearTimeout(idleRef.current);
      micRef.current?.close();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, initialIndex]);

  // Translations: human (TED) ones come with the material; the rest are
  // machine-translated in the background, once, and kept.
  useEffect(() => {
    if (!m?.id) return;
    let alive = true;
    const apply = state => {
      if (!alive) return;
      setTranslation(state);
      if (state.mt) setMt(state.mt);
    };
    loadTranslations(m.id).then(saved => alive && setMt(saved));
    const unsubscribe = subscribeTranslations(m.id, apply);
    apply(translationState(m.id));
    startTranslations(m);
    return () => { alive = false; unsubscribe(); };
    // Only when a different material opens, not on every change to it.
  }, [m?.id]);

  const update = useCallback(patch => {
    const next = { ...mRef.current, ...patch };
    mRef.current = next;
    setM(next);
    saveMaterial(next);
  }, []);

  // Create the player once its element exists.
  const kind = m?.kind;
  const tedSource = m ? (m.stream ? streamUrl(m.stream) : m.hlsUrl) : null;
  useEffect(() => {
    if (kind !== 'ted' && kind !== 'file') return;
    let player = null, detach = null, cancelled = false;
    // Safe to call more than once; whatever exists so far is released.
    const dispose = () => {
      player?.destroy();
      player = null;
      detach?.();
      detach = null;
    };
    (async () => {
      try {
        const video = videoRef.current;
        if (!video || (kind === 'file' && !fileUrl)) return;
        if (kind === 'ted') detach = await attachHls(video, tedSource, setError);
        if (cancelled) return dispose();
        player = mediaElementPlayer(video);
        await player.ready;
        if (cancelled) return dispose();
        playerRef.current = player;
        setReady(true);
      } catch (e) {
        if (cancelled) dispose();
        else setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      playerRef.current = null;
      setReady(false);
      dispose();
    };
  }, [kind, tedSource, fileUrl]);

  useEffect(() => { if (ready) playerRef.current.setRate(prefs.rate); }, [ready, prefs.rate]);

  // Remember where we are.
  useEffect(() => {
    if (!m || m.cursor === index) return;
    const t = setTimeout(() => update({ cursor: index }), 400);
    return () => clearTimeout(t);
  }, [index, m, update]);

  // Keep the sentence being read at a steady reading height instead of
  // letting it drift down to the controls.
  const placedOnce = useRef(false);
  useLayoutEffect(() => {
    const row = rowRefs.current[index];
    if (!row) return;
    if (placedOnce.current) {
      placeAtReadingHeight(row, { opening: false });
      return;
    }
    placedOnce.current = true;
    // Placed before the page is shown, so it doesn't jump after the fade.
    const moved = placeAtReadingHeight(row, { opening: true });
    pageReady();
    // The web font and the notes above the script settle a moment later and
    // shift the sentence a little; put it back once they have.
    let cancelled = false;
    document.fonts.ready.then(() => setTimeout(() => {
      if (!cancelled && moved) placeAtReadingHeight(row, { opening: false });
    }, 250));
    return () => { cancelled = true; };
  }, [index, m?.id]);

  const stopAll = useCallback(() => {
    abortRef.current?.abort();
    clipRef.current?.stop();
  }, []);

  const run = useCallback(async (kind, fn) => {
    stopAll();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(kind);
    setError('');
    if (Date.now() - (mRef.current.practicedAt || 0) > 60000) update({ practicedAt: Date.now() });
    try {
      await fn(ctrl.signal);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'うまく再生できませんでした');
    } finally {
      if (abortRef.current === ctrl) { abortRef.current = null; setBusy(null); }
    }
  }, [stopAll, update]);

  const logSentences = (count, seconds) => {
    if (count > 0) logPractice({ sentences: count, seconds: seconds / prefsRef.current.rate });
  };

  // --- Listening -----------------------------------------------------------

  const playModel = (i, signal, opts) => {
    const s = mRef.current.segments[i];
    return playRange(playerRef.current, s.start, s.end, { signal, ...opts });
  };

  // One sentence, repeated as many times as set ("ずっと" = until stopped).
  const playSentence = i => run('play', async signal => {
    const s = mRef.current.segments[i];
    for (let n = 0; ; n++) {
      const reached = await playModel(i, signal);
      // Stopped, or paused from the player's own controls.
      if (signal.aborted || reached < s.end - 0.1) return;
      logSentences(1, s.end - s.start);
      const repeat = prefsRef.current.repeat;
      if (repeat !== 0 && n + 1 >= repeat) return;
      await sleep(REPEAT_GAP, signal);
      if (signal.aborted) return;
    }
  });

  // From sentence i to the end, following along in the script.
  const playThrough = i => run('through', async signal => {
    const segs = mRef.current.segments;
    const from = segs[i].start;
    const reached = await playRange(playerRef.current, from, segs[segs.length - 1].end, {
      signal,
      onTick: t => setIndex(indexAt(segs, t)),
    });
    logSentences(sentencesBetween(segs, from, reached), reached - from);
  });

  // --- Recording -----------------------------------------------------------

  // The mic stays open between takes (no start-up gap, no Bluetooth profile
  // switching) and is released after a short idle period.
  async function openMic() {
    clearTimeout(idleRef.current);
    try {
      await micRef.current.open();
    } catch (e) {
      throw new Error(e.name === 'NotAllowedError'
        ? 'マイクが使えません。ブラウザの設定でこのサイトのマイクを許可してください'
        : e.message || 'マイクを開けませんでした');
    }
  }

  function releaseMicLater() {
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => micRef.current?.close(), 30000);
  }

  function meter(signal) {
    const tick = () => {
      if (signal.aborted || !micRef.current?.recording) {
        if (levelRef.current) levelRef.current.style.transform = 'scaleX(0)';
        return;
      }
      if (levelRef.current) levelRef.current.style.transform = `scaleX(${micRef.current.level()})`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function storeTakes(blob, makeTakes) {
    if (!blob?.size) return;
    const key = await saveRecording(mRef.current.id, blob);
    const next = { ...mRef.current, takes: { ...mRef.current.takes, ...makeTakes(key) }, practicedAt: Date.now() };
    mRef.current = next;
    setM(next);
    await saveMaterial(next);
    pruneRecordings(next);
  }

  // Records while the model plays, sentence i alone or (through) on to the end.
  const record = (i, through) => run(through ? 'through-record' : 'record', async signal => {
    audioContext();
    await openMic();
    const mic = micRef.current;
    const segs = mRef.current.segments;
    const from = segs[i].start;
    const to = through ? segs[segs.length - 1].end : segs[i].end;
    const recStart = await mic.start();
    meter(signal);
    const samples = [];
    const now = () => (performance.now() - recStart) / 1000;
    let reached = from;
    try {
      reached = await playRange(playerRef.current, from, to, {
        signal,
        onTick: t => {
          samples.push({ media: t, rec: now() });
          if (through) setIndex(indexAt(segs, t));
        },
      });
      if (!signal.aborted) await sleep(TAIL * 1000, signal);
    } finally {
      const end = now();
      const blob = await mic.stop();
      releaseMicLater();
      if (samples.length) {
        const rate = prefsRef.current.rate;
        const at = t => mediaToRecording(samples, t, rate);
        await storeTakes(blob, key => {
          const out = {};
          for (let k = i; k < segs.length && segs[k].start < reached && (through || k === i); k++) {
            const take = { rec: key, from: Math.max(0, at(segs[k].start) + heardLatency()), to: end, at: Date.now() };
            if (through) take.to = Math.min(end, at(Math.min(segs[k].end, reached)) + TAIL * 0.7);
            out[k] = take;
          }
          return out;
        });
        logSentences(through ? sentencesBetween(segs, from, reached) : reached >= to - 0.1 ? 1 : 0, reached - from);
      }
    }
  });

  // --- Reviewing a take ----------------------------------------------------

  const playMine = async (i, signal, { pan = 0 } = {}) => {
    const take = mRef.current.takes?.[i];
    if (!take) return;
    const blob = await getRecording(take.rec);
    if (!blob) throw new Error('録音が見つかりません');
    const buffer = await decodeBlob(take.rec, blob);
    if (signal.aborted) return;
    const clip = playClip(buffer, Math.max(0, take.from - 0.1), take.to, { pan });
    clipRef.current = clip;
    signal.addEventListener('abort', clip.stop, { once: true });
    await clip.done;
  };

  const listenModel = i => run('model', signal => playModel(i, signal));
  const listenMine = i => run('mine', signal => playMine(i, signal));
  const compare = i => run('compare', async signal => {
    await playModel(i, signal);
    if (signal.aborted) return;
    await sleep(350, signal);
    if (!signal.aborted) await playMine(i, signal);
  });
  // Both at once: the model in the left ear, you in the right.
  const overlay = i => run('overlay', async signal => {
    const player = playerRef.current;
    const take = mRef.current.takes?.[i];
    if (!take) return;
    const buffer = await decodeBlob(take.rec, await getRecording(take.rec));
    const s = mRef.current.segments[i];
    let mine = null;
    try {
      player.setPan(-1);
      await playModel(i, signal, {
        onTick: t => {
          if (mine) return;
          const late = Math.max(0, (t - s.start) / prefsRef.current.rate);
          mine = playClip(buffer, take.from + late, take.to, { pan: 1 });
          clipRef.current = mine;
          signal.addEventListener('abort', mine.stop, { once: true });
        },
      });
      if (mine && !signal.aborted) await mine.done;
    } finally {
      player.setPan(0);
    }
  });

  // --- Translation & favorite ----------------------------------------------

  // The language pack downloads only after a click.
  const translateNow = () => {
    getTranslator().then(() => startTranslations(mRef.current)).catch(() => setTranslation({ status: 'unsupported' }));
  };

  const toggleFavorite = () => update({ favorite: !mRef.current.favorite });

  // --- Navigation & keys ---------------------------------------------------

  const move = useCallback(d => {
    stopAll();
    setIndex(i => Math.max(0, Math.min((mRef.current?.segments.length ?? 1) - 1, i + d)));
  }, [stopAll]);

  const through = prefs.mode === 'through';
  const recordMode = prefs.record;

  const start = i => {
    setIndex(i);
    if (recordMode) record(i, through);
    else if (through) playThrough(i);
    else playSentence(i);
  };
  const primary = () => (busy ? stopAll() : start(index));
  const toggleReview = (kind, action) => (busy === kind ? stopAll() : action(index));

  function onRowClick(e, i) {
    // A finished text selection is handled on mouseup.
    if (window.getSelection()?.toString().trim()) return;
    if (e.target.closest('.row-actions')) return;
    const word = e.target.closest('.w');
    const englishShown = prefs.showText || revealed.has(i);
    if (word && i === index && englishShown) {
      setLookup({ text: word.textContent, anchor: word.getBoundingClientRect() });
      return;
    }
    // Recording only starts from the button, never from a stray click.
    if (!ready || recordMode) { if (i !== index) stopAll(); setIndex(i); return; }
    start(i);
  }

  // Selecting several words translates them.
  function onMouseUp() {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim();
    if (!text || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!listRef.current?.contains(el) || el.closest('.script.hidden') || !el.closest('.script')) return;
    setLookup({ text: text.slice(0, 600), anchor: range.getBoundingClientRect() });
  }

  const keyRef = useRef();
  keyRef.current = e => {
    if (!ready || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Enter' && /^(BUTTON|A)$/.test(e.target.tagName)) return;
    const hasTake = !!m?.takes?.[index];
    const k = e.key.toLowerCase();
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); primary(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'Escape') { if (lookup) setLookup(null); else stopAll(); }
    else if (k === 'f') toggleFavorite();
    else if (k === 'j') setJaOpen(o => toggled(o, index));
    else if (k === 'm' && hasTake) listenMine(index);
    else if (k === 'c' && hasTake) compare(index);
    else if (k === 'o' && hasTake) overlay(index);
  };
  useEffect(() => {
    const down = e => keyRef.current(e);
    // Space on a focused button would also click it.
    const up = e => { if (e.key === ' ' && e.target.tagName === 'BUTTON') e.preventDefault(); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);

  if (missing) {
    return (
      <main className="page">
        <header className="masthead"><a className="back" href="#/"><Icon name="back" size={14} />教材</a></header>
        <p className="empty">この教材は見つかりませんでした。</p>
      </main>
    );
  }
  if (!m) return <main className="page" />;
  if (m.kind !== 'ted' && m.kind !== 'file') {
    return (
      <main className="page">
        <header className="masthead"><a className="back" href="#/"><Icon name="back" size={14} />教材</a></header>
        <p className="empty">この教材は今のバージョンでは開けません。教材一覧から削除してください。</p>
      </main>
    );
  }

  const segs = m.segments;
  const take = m.takes?.[index];
  const jaOf = i => segs[i].ja || mt[i] || '';
  const hasTranslations = segs.some((s, i) => s.ja || mt[i]);
  const missingJa = segs.filter((s, i) => !s.ja && !mt[i]).length;
  const showsVideo = m.kind === 'ted' || m.mediaType === 'video';
  const recording = busy === 'record' || busy === 'through-record';
  const anyTake = Object.keys(m.takes || {}).length > 0;

  const primaryLabel = busy ? '止める'
    : recordMode ? (through ? '通しで録音' : '録音')
    : through ? '通しで再生' : 'この文を再生';
  const note = !ready && !error ? '読み込み中…'
    : through ? (busy ? '' : `${index + 1}文目から最後まで`)
    : recordMode ? ''
    : prefs.repeat === 0 ? '止めるまでくり返し' : prefs.repeat > 1 ? `${prefs.repeat}回くり返し` : '';

  return (
    <main className={`practice ${showsVideo ? 'with-video' : 'audio-only'}`}>
      <aside className="stage">
        <header className="masthead">
          <a className="back" href={m.folderId ? `#/f/${m.folderId}` : '#/'}><Icon name="back" size={14} />教材</a>
          <button className="settings-toggle" onClick={() => setSettingsOpen(o => !o)} aria-expanded={settingsOpen}>
            {settingsOpen ? '設定を閉じる' : '設定'}
          </button>
        </header>
        <div className="title-row">
          <h1 className="practice-title">{m.title || '　'}</h1>
          <button className={`star ${m.favorite ? 'on' : ''}`} onClick={toggleFavorite} aria-pressed={!!m.favorite}
            title={m.favorite ? 'お気に入りから外す (F)' : 'お気に入りにする (F)'} aria-label="お気に入り">
            <Icon name={m.favorite ? 'starred' : 'star'} size={18} />
          </button>
        </div>
        {m.kind === 'ted' && (
          <p className="practice-meta">
            TED<span className="sep">·</span>{m.author}
            <span className="sep">·</span><a href={m.sourceUrl} target="_blank" rel="noreferrer">ted.com</a>
            <span className="sep">·</span><a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.ja" target="_blank" rel="noreferrer">CC BY-NC-ND 4.0</a>
          </p>
        )}

        <div className={showsVideo ? 'screen' : 'screen-hidden'}>
          <video
            ref={videoRef}
            src={m.kind === 'file' ? fileUrl ?? undefined : undefined}
            poster={m.kind === 'ted' && m.image ? imageUrl(m.image, 960) : undefined}
            playsInline
            preload="auto"
          />
        </div>
        {!showsVideo && <Timeline segments={segs} index={index} duration={m.duration} onSelect={i => { stopAll(); setIndex(i); }} />}

        <div className={`settings ${settingsOpen ? 'open' : ''}`}>
          {/* Sound on one side, text on the other. くり返し stays put when it doesn't apply,
              so the rows below it don't jump while you click. */}
          <div className="settings-group" role="group" aria-label="再生と録音">
            <Segmented label="練習" value={prefs.mode} options={[['single', '1文ずつ'], ['through', '通し']]}
              onChange={mode => { stopAll(); setPrefs({ mode }); }} />
            <Segmented label="くり返し" value={prefs.repeat} options={[[1, '1回'], [3, '3回'], [0, 'ずっと']]}
              onChange={repeat => setPrefs({ repeat })}
              disabled={through || recordMode} note="1文ずつで、録音しないときに使えます" />
            <Segmented label="速度" value={prefs.rate} options={[[0.75, '0.75'], [1, '1.0'], [1.25, '1.25']]}
              onChange={rate => setPrefs({ rate })} />
            <Segmented label="録音" value={prefs.record} options={[[false, 'しない'], [true, 'する']]}
              onChange={rec => { stopAll(); setPrefs({ record: rec }); }} />
          </div>
          <div className="settings-group" role="group" aria-label="表示">
            <Segmented label="英文" value={prefs.showText} options={[[true, '表示'], [false, '隠す']]}
              onChange={showText => { setPrefs({ showText }); setRevealed(new Set()); }} />
            {hasTranslations && (
              <Segmented label="和訳" value={prefs.showJa} options={[[true, '表示'], [false, '隠す']]}
                onChange={showJa => { setPrefs({ showJa }); setJaOpen(new Set()); }} />
            )}
          </div>
        </div>

        <TranslationNote state={translation} missing={missingJa} onStart={translateNow} />
        {recordMode && !anyTake && <p className="hint">録音は、この端末の中にだけ保存されます。スピーカーだとお手本の音も入るので、ヘッドホンをつけてください。</p>}
        {error && <p className="hint warn" role="alert">{error}</p>}
        <p className="keys">Space 再生／停止　←→ 文の移動　単語をクリックで意味　J 和訳　F お気に入り</p>
      </aside>

      <ol className="script-list" ref={listRef} onMouseUp={onMouseUp}>
        {segs.map((s, i) => {
          const hidden = !prefs.showText && !revealed.has(i);
          const ja = jaOf(i);
          const showJa = ja && (prefs.showJa || jaOpen.has(i));
          const isCurrent = i === index;
          return (
            <li
              key={i}
              ref={el => { rowRefs.current[i] = el; }}
              className={`row ${isCurrent ? 'current' : ''} ${isCurrent && busy ? 'busy' : ''}`}
              onClick={e => onRowClick(e, i)}
            >
              <span className="row-num">{String(i + 1).padStart(2, '0')}</span>
              <div className="row-body">
                <p className={`script ${hidden ? 'hidden' : ''}`}>
                  {s.text.split(' ').map((w, k) => <Fragment key={k}>{k > 0 && ' '}<span className="w">{w}</span></Fragment>)}
                </p>
                {showJa && <p className="ja">{ja}{!s.ja && <span className="tag">機械翻訳</span>}</p>}
                {!ja && isCurrent && prefs.showJa && /preparing|running/.test(translation.status) && <p className="ja pending">和訳を作っています…</p>}
                {isCurrent && (!prefs.showJa || !ja || !prefs.showText) && (
                  <div className="row-actions">
                    {ja && !prefs.showJa && (
                      <button className="act" onClick={() => setJaOpen(o => toggled(o, i))}>{showJa ? '和訳を隠す' : '和訳'}</button>
                    )}
                    {!ja && !/preparing|running/.test(translation.status) && (
                      <a className="act" href={googleTranslateUrl(s.text)} target="_blank" rel="noreferrer">
                        Google翻訳で和訳<Icon name="out" size={11} />
                      </a>
                    )}
                    {!prefs.showText && (
                      <button className="act" onClick={() => setRevealed(r => toggled(r, i))}>
                        {hidden ? '英文を見る' : '英文を隠す'}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <span className="row-meta">
                {m.takes?.[i] && <span className="taken">録音</span>}
                <span className="time">{fmtTime(s.start)}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <footer className={`transport ${take ? 'has-review' : ''}`}>
        <div className="nav">
          <button className="icon-button" onClick={() => move(-1)} disabled={index === 0} aria-label="前の文"><Icon name="prev" /></button>
          <span className="num">{index + 1} / {segs.length}</span>
          <button className="icon-button" onClick={() => move(1)} disabled={index === segs.length - 1} aria-label="次の文"><Icon name="next" /></button>
        </div>
        <button
          className={`button play ${recordMode ? 'record' : ''} ${busy ? 'active' : ''} ${recording ? 'recording' : ''}`}
          onClick={e => { e.currentTarget.blur(); primary(); }}
          disabled={!ready}
        >
          <Icon name={busy ? 'stop' : recordMode ? 'record' : 'play'} size={14} />
          {primaryLabel}
          {recording && <span className="level"><span ref={levelRef} /></span>}
        </button>
        {take ? (
          <div className="review" role="group" aria-label="録音の聞き比べ">
            <TextAction active={busy === 'model'} disabled={!ready} onClick={() => toggleReview('model', listenModel)}>お手本</TextAction>
            <TextAction active={busy === 'mine'} disabled={!ready} onClick={() => toggleReview('mine', listenMine)}>自分</TextAction>
            <TextAction active={busy === 'compare'} disabled={!ready} onClick={() => toggleReview('compare', compare)}
              title="お手本のあとに自分の録音">続けて</TextAction>
            <TextAction active={busy === 'overlay'} disabled={!ready} onClick={() => toggleReview('overlay', overlay)}
              title="左耳にお手本、右耳に自分の声を同時に">重ねて</TextAction>
          </div>
        ) : (
          <span className="transport-note num">{note}</span>
        )}
      </footer>

      {lookup && <LookupPopover text={lookup.text} anchor={lookup.anchor} onClose={() => setLookup(null)} />}
    </main>
  );
}

// Where the machine translations stand, shown only while there is something to say.
function TranslationNote({ state, missing, onStart }) {
  if (!missing) return null;
  if (state.status === 'preparing') return <p className="hint">和訳の準備をしています…</p>;
  if (state.status === 'running') {
    return <p className="hint num">和訳を作っています　{state.done ?? 0} / {state.total || missing}</p>;
  }
  if (state.status === 'needs-click') {
    return (
      <div className="hint">
        <p>機械翻訳で{missing}文を訳します。初回は翻訳データを読み込みます。</p>
        <button className="link-button" onClick={onStart}>和訳を作る</button>
      </div>
    );
  }
  if (state.status === 'unsupported') {
    return <p className="hint">このブラウザでは和訳を自動で作れません（PC版Chromeのみ可能）。<br />文ごとにGoogle翻訳する形式となります。</p>;
  }
  if (state.status === 'failed') {
    return <p className="hint warn">和訳を作れませんでした。<button className="link-button" onClick={onStart}>もう一度</button></p>;
  }
  return null;
}

function TextAction({ active, children, onClick, ...rest }) {
  return (
    <button className={`text-action ${active ? 'on' : ''}`} onClick={e => { e.currentTarget.blur(); onClick(); }} {...rest}>
      <Icon name={active ? 'stop' : 'play'} size={10} />{children}
    </button>
  );
}

function Timeline({ segments, index, duration, onSelect }) {
  if (!duration) return null;
  const s = segments[index];
  return (
    <div className="timeline" aria-hidden="true">
      {segments.map((seg, i) => (
        <span
          key={i}
          className={i === index ? 'on' : ''}
          style={{ left: `${(seg.start / duration) * 100}%`, width: `${((seg.end - seg.start) / duration) * 100}%` }}
          onClick={() => onSelect(i)}
        />
      ))}
      <span className="timeline-label num">{fmtTime(s.start)} / {fmtTime(duration)}</span>
    </div>
  );
}
