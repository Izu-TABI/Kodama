import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { getMaterial, saveMaterial, getMedia } from '../lib/db.js';
import { attachHls, mediaElementPlayer, youtubePlayer, playRange } from '../lib/players.js';
import { fmtTime } from '../lib/segments.js';
import { usePrefs } from '../lib/prefs.js';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';

// Pause between repeats of the same sentence.
const REPEAT_GAP = 700;

const sleep = (ms, signal) => new Promise(resolve => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

const indexAt = (segments, t) => {
  let k = 0;
  for (let i = 0; i < segments.length; i++) if (segments[i].start <= t + 0.01) k = i;
  return k;
};

const SOURCE_NAME = { youtube: 'YouTube', ted: 'TED' };

export default function Practice({ id }) {
  const [m, setM] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [prefs, setPrefs] = usePrefs();
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(() => new Set());
  const [fileUrl, setFileUrl] = useState(null);

  const mRef = useRef(null);
  const prefsRef = useRef(prefs);
  const playerRef = useRef(null);
  const abortRef = useRef(null);
  const ytHost = useRef(null);
  const videoRef = useRef(null);
  const rowRefs = useRef([]);
  mRef.current = m;
  prefsRef.current = prefs;

  // Load the material.
  useEffect(() => {
    let url;
    getMaterial(id).then(async mat => {
      if (!mat) return setMissing(true);
      setM(mat);
      setIndex(Math.min(mat.cursor || 0, mat.segments.length - 1));
      if (mat.kind === 'file') {
        const blob = await getMedia(mat.mediaId);
        if (!blob) return setError('元のファイルが見つかりません');
        url = URL.createObjectURL(blob);
        setFileUrl(url);
      }
    });
    return () => {
      abortRef.current?.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  const update = useCallback(patch => {
    const next = { ...mRef.current, ...patch };
    mRef.current = next;
    setM(next);
    saveMaterial(next);
  }, []);

  // Create the player once its element exists.
  const kind = m?.kind;
  const videoId = m?.videoId;
  const hlsUrl = m?.hlsUrl;
  useEffect(() => {
    if (!kind) return;
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
        if (kind === 'youtube') {
          player = await youtubePlayer(ytHost.current, videoId, {
            onError: setError,
            onTitle: title => { if (title && !mRef.current?.title) update({ title }); },
          });
        } else {
          const video = videoRef.current;
          if (!video || (kind === 'file' && !fileUrl)) return;
          if (kind === 'ted') detach = await attachHls(video, hlsUrl, setError);
          if (cancelled) return dispose();
          player = mediaElementPlayer(video);
        }
        if (cancelled) return dispose();
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
  }, [kind, videoId, hlsUrl, fileUrl, update]);

  useEffect(() => { if (ready) playerRef.current.setRate(prefs.rate); }, [ready, prefs.rate]);

  // Remember where we are.
  useEffect(() => {
    if (!m || m.cursor === index) return;
    const t = setTimeout(() => update({ cursor: index }), 400);
    return () => clearTimeout(t);
  }, [index, m, update]);

  // Keep the current sentence in view.
  useEffect(() => {
    rowRefs.current[index]?.scrollIntoView({ block: playing && prefs.mode === 'through' ? 'center' : 'nearest', behavior: 'smooth' });
  }, [index, playing, prefs.mode]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const run = useCallback(async fn => {
    stop();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPlaying(true);
    setError('');
    if (Date.now() - (mRef.current.practicedAt || 0) > 60000) update({ practicedAt: Date.now() });
    try {
      await fn(ctrl.signal);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'うまく再生できませんでした');
    } finally {
      if (abortRef.current === ctrl) { abortRef.current = null; setPlaying(false); }
    }
  }, [stop, update]);

  // One sentence, repeated as many times as set ("ずっと" = until stopped).
  const playSentence = useCallback(i => run(async signal => {
    const s = mRef.current.segments[i];
    for (let n = 0; ; n++) {
      const reached = await playRange(playerRef.current, s.start, s.end, { signal });
      // Stopped, or paused from the player's own controls.
      if (signal.aborted || reached < s.end - 0.1) return;
      const repeat = prefsRef.current.repeat;
      if (repeat !== 0 && n + 1 >= repeat) return;
      await sleep(REPEAT_GAP, signal);
      if (signal.aborted) return;
    }
  }), [run]);

  // From sentence i to the end, following along in the script.
  const playThrough = useCallback(i => run(async signal => {
    const segs = mRef.current.segments;
    await playRange(playerRef.current, segs[i].start, segs[segs.length - 1].end, {
      signal,
      onTick: t => setIndex(indexAt(segs, t)),
    });
  }), [run]);

  const play = useCallback(i => {
    setIndex(i);
    if (prefsRef.current.mode === 'through') playThrough(i);
    else playSentence(i);
  }, [playSentence, playThrough]);

  const move = useCallback(d => {
    stop();
    setIndex(i => Math.max(0, Math.min((mRef.current?.segments.length ?? 1) - 1, i + d)));
  }, [stop]);

  const primary = () => (playing ? stop() : play(index));

  const keyRef = useRef();
  keyRef.current = e => {
    if (!ready || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Enter' && /^(BUTTON|A)$/.test(e.target.tagName)) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); primary(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'Escape') stop();
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

  const segs = m.segments;
  const toggleReveal = i => setRevealed(r => {
    const n = new Set(r);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });
  const showsVideo = m.kind !== 'file' || m.mediaType === 'video';
  const through = prefs.mode === 'through';

  return (
    <main className={`practice ${showsVideo ? 'with-video' : 'audio-only'}`}>
      <aside className="stage">
        <header className="masthead">
          <a className="back" href="#/"><Icon name="back" size={14} />教材</a>
        </header>
        <h1 className="practice-title">{m.title || '　'}</h1>
        {m.author && (
          <p className="practice-meta">
            {SOURCE_NAME[m.kind]}<span className="sep">·</span>{m.author}
            {m.sourceUrl && <><span className="sep">·</span><a href={m.sourceUrl} target="_blank" rel="noreferrer">元のページ</a></>}
          </p>
        )}

        {m.kind === 'youtube'
          ? <div className="screen" ref={ytHost} />
          : <div className={showsVideo ? 'screen' : 'screen-hidden'}>
              <video ref={videoRef} src={m.kind === 'file' ? fileUrl ?? undefined : undefined} playsInline preload="auto" />
            </div>}
        {!showsVideo && <Timeline segments={segs} index={index} duration={m.duration} onSelect={i => { stop(); setIndex(i); }} />}

        <div className="settings">
          <Segmented label="練習" value={prefs.mode} options={[['single', '1文ずつ'], ['through', '通し']]}
            onChange={mode => { stop(); setPrefs({ mode }); }} />
          <Segmented label="速度" value={prefs.rate} options={[[0.75, '0.75'], [1, '1.0'], [1.25, '1.25']]}
            onChange={rate => setPrefs({ rate })} />
          <Segmented label="英文" value={prefs.showText} options={[[true, '表示'], [false, '隠す']]}
            onChange={showText => { setPrefs({ showText }); setRevealed(new Set()); }} />
          {!through && (
            <Segmented label="くり返し" value={prefs.repeat} options={[[1, '1回'], [3, '3回'], [0, 'ずっと']]}
              onChange={repeat => setPrefs({ repeat })} />
          )}
        </div>

        {error && <p className="hint warn" role="alert">{error}</p>}
        <p className="keys">Space 再生／停止　←→ 文の移動　文をクリックでそこから再生</p>
      </aside>

      <ol className="script-list">
        {segs.map((s, i) => {
          const hidden = !prefs.showText && !revealed.has(i);
          return (
            <li
              key={i}
              ref={el => { rowRefs.current[i] = el; }}
              className={`row ${i === index ? 'current' : ''} ${i === index && playing ? 'playing' : ''}`}
              onClick={() => (ready ? play(i) : setIndex(i))}
            >
              <span className="row-num">{String(i + 1).padStart(2, '0')}</span>
              <span className={`script ${hidden ? 'hidden' : ''}`}>
                {s.text.split(' ').map((w, k) => <Fragment key={k}>{k > 0 && ' '}<span className="w">{w}</span></Fragment>)}
              </span>
              <span className="row-meta">
                {!prefs.showText && i === index && (
                  <button className="peek" onClick={e => { e.stopPropagation(); toggleReveal(i); }}>
                    {hidden ? '英文を見る' : '隠す'}
                  </button>
                )}
                <span className="time">{fmtTime(s.start)}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <footer className="transport">
        <div className="nav">
          <button className="icon-button" onClick={() => move(-1)} disabled={index === 0} aria-label="前の文"><Icon name="prev" /></button>
          <span className="num">{index + 1} / {segs.length}</span>
          <button className="icon-button" onClick={() => move(1)} disabled={index === segs.length - 1} aria-label="次の文"><Icon name="next" /></button>
        </div>
        <button
          className={`button play ${playing ? 'active' : ''}`}
          onClick={e => { e.currentTarget.blur(); primary(); }}
          disabled={!ready}
        >
          <Icon name={playing ? 'stop' : 'play'} size={14} />
          {playing ? '止める' : through ? '通しで再生' : 'この文を再生'}
        </button>
        <span className="transport-note num">
          {!ready && !error ? '読み込み中…'
            : through ? (playing ? '' : `${index + 1}文目から最後まで`)
            : prefs.repeat === 0 ? '止めるまでくり返し' : prefs.repeat > 1 ? `${prefs.repeat}回くり返し` : ''}
        </span>
      </footer>
    </main>
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
