import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { getMaterial, saveMaterial, getMedia, saveRecording, getRecording, pruneRecordings } from '../lib/db.js';
import { mediaElementPlayer, youtubePlayer, playRange } from '../lib/players.js';
import { Mic, decodeBlob, playClip, mediaToRecording, audioContext } from '../lib/audio.js';
import { fmtTime } from '../lib/segments.js';
import { usePrefs } from '../lib/prefs.js';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';

// Keep recording a little after the model ends: shadowers trail behind it.
const TAIL = 0.9;

const sleep = (ms, signal) => new Promise(resolve => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// The model reaches the ear this much later than the player reports (large on
// Bluetooth); line the recording up with what was actually heard.
const heardLatency = () => audioContext().outputLatency || 0;

const indexAt = (segments, t) => {
  let k = 0;
  for (let i = 0; i < segments.length; i++) if (segments[i].start <= t + 0.01) k = i;
  return k;
};

export default function Practice({ id }) {
  const [m, setM] = useState(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [prefs, setPrefs] = usePrefs();
  const [busy, setBusy] = useState(null);
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(() => new Set());
  const [mediaUrl, setMediaUrl] = useState(null);

  const mRef = useRef(null);
  const playerRef = useRef(null);
  const micRef = useRef(null);
  const abortRef = useRef(null);
  const clipRef = useRef(null);
  const levelRef = useRef(null);
  const ytHost = useRef(null);
  const videoRef = useRef(null);
  const rowRefs = useRef([]);
  mRef.current = m;

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
        setMediaUrl(url);
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
  }, [id]);

  const update = useCallback(patch => {
    const next = { ...mRef.current, ...patch };
    mRef.current = next;
    setM(next);
    saveMaterial(next);
  }, []);

  // Create the player once the media host exists.
  const kind = m?.kind;
  const videoId = m?.videoId;
  useEffect(() => {
    if (!kind) return;
    let player, cancelled = false;
    (async () => {
      try {
        if (kind === 'youtube') {
          player = await youtubePlayer(ytHost.current, videoId, {
            onError: setError,
            onTitle: title => { if (title && !mRef.current?.title) update({ title }); },
          });
        } else {
          if (!mediaUrl || !videoRef.current) return;
          player = mediaElementPlayer(videoRef.current);
        }
        await player.ready;
        if (cancelled) return player.destroy();
        const d = player.duration();
        if (d && Math.abs(d - (mRef.current.duration || 0)) > 1) update({ duration: d });
        playerRef.current = player;
        setReady(true);
      } catch (e) {
        if (cancelled) player?.destroy();
        else setError(e.message);
      }
    })();
    return () => { cancelled = true; playerRef.current = null; setReady(false); player?.destroy(); };
  }, [kind, videoId, mediaUrl, update]);

  useEffect(() => { if (ready) playerRef.current.setRate(prefs.rate); }, [ready, prefs.rate]);

  // Remember where we are.
  useEffect(() => {
    if (!m || m.cursor === index) return;
    const t = setTimeout(() => update({ cursor: index }), 400);
    return () => clearTimeout(t);
  }, [index, m, update]);

  // Keep the current sentence in view.
  useEffect(() => {
    rowRefs.current[index]?.scrollIntoView({ block: busy === 'through' || busy === 'listen' ? 'center' : 'nearest', behavior: 'smooth' });
  }, [index, busy]);

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
    try {
      await fn(ctrl.signal);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'うまく再生できませんでした');
    } finally {
      if (abortRef.current === ctrl) { abortRef.current = null; setBusy(null); }
    }
  }, [stopAll]);

  // --- Playback ------------------------------------------------------------

  const playModel = (i, signal, opts) => {
    const s = mRef.current.segments[i];
    return playRange(playerRef.current, s.start, s.end, { signal, ...opts });
  };

  const playMine = async (i, signal, { pan = 0, offset = 0 } = {}) => {
    const take = mRef.current.takes?.[i];
    if (!take) return;
    const blob = await getRecording(take.rec);
    if (!blob) throw new Error('録音が見つかりません');
    const buffer = await decodeBlob(take.rec, blob);
    if (signal.aborted) return;
    const clip = playClip(buffer, Math.max(0, take.from - 0.1) + offset, take.to, { pan });
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
  // Both at once; with a local file the model goes left and you go right.
  const overlay = i => run('overlay', async signal => {
    const player = playerRef.current;
    const take = mRef.current.takes?.[i];
    if (!take) return;
    const blob = await getRecording(take.rec);
    const buffer = await decodeBlob(take.rec, blob);
    const panned = !!player.setPan;
    if (panned) player.setPan(-1);
    let mine = null;
    const s = mRef.current.segments[i];
    try {
      await playModel(i, signal, {
        onTick: t => {
          if (mine) return;
          const late = Math.max(0, (t - s.start) / prefs.rate);
          mine = playClip(buffer, take.from + late, take.to, { pan: panned ? 1 : 0 });
          clipRef.current = mine;
          signal.addEventListener('abort', mine.stop, { once: true });
        },
      });
      if (mine && !signal.aborted) await mine.done;
    } finally {
      if (panned) player.setPan(0);
    }
  });

  // --- Recording -----------------------------------------------------------

  // The mic stays open between takes (no start-up gap, no Bluetooth profile
  // switching) and is released after a short idle period.
  const idleRef = useRef(null);
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

  function releaseMicLater() {
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => micRef.current?.close(), 30000);
  }

  async function storeTakes(blob, makeTakes) {
    if (!blob?.size) return;
    const key = await saveRecording(mRef.current.id, blob);
    const takes = { ...mRef.current.takes, ...makeTakes(key) };
    const next = { ...mRef.current, takes, practicedAt: Date.now() };
    setM(next);
    await saveMaterial(next);
    pruneRecordings(next);
  }

  const recordOne = i => run('record', async signal => {
    audioContext();
    await openMic();
    const mic = micRef.current;
    const s = mRef.current.segments[i];
    const recStart = await mic.start();
    meter(signal);
    const samples = [];
    const now = () => (performance.now() - recStart) / 1000;
    try {
      await playModel(i, signal, { onTick: t => samples.push({ media: t, rec: now() }) });
      if (!signal.aborted) await sleep(TAIL * 1000, signal);
    } finally {
      const end = now();
      const blob = await mic.stop();
      releaseMicLater();
      if (samples.length) {
        const from = Math.max(0, mediaToRecording(samples, s.start, prefs.rate) + heardLatency());
        await storeTakes(blob, key => ({ [i]: { rec: key, from, to: end, at: Date.now() } }));
      }
    }
  });

  const recordThrough = start => run('through', async signal => {
    audioContext();
    await openMic();
    const mic = micRef.current;
    const segs = mRef.current.segments;
    const recStart = await mic.start();
    meter(signal);
    const samples = [];
    const now = () => (performance.now() - recStart) / 1000;
    let reached = segs[start].start;
    try {
      reached = await playRange(playerRef.current, segs[start].start, segs[segs.length - 1].end, {
        signal,
        onTick: t => {
          samples.push({ media: t, rec: now() });
          setIndex(indexAt(segs, t));
        },
      });
      if (!signal.aborted) await sleep(TAIL * 1000, signal);
    } finally {
      const end = now();
      const blob = await mic.stop();
      releaseMicLater();
      if (samples.length) {
        await storeTakes(blob, key => {
          const out = {};
          for (let k = start; k < segs.length && segs[k].start < reached; k++) {
            const from = Math.max(0, mediaToRecording(samples, segs[k].start, prefs.rate) + heardLatency());
            const to = Math.min(end, mediaToRecording(samples, Math.min(segs[k].end, reached), prefs.rate) + TAIL * 0.7);
            out[k] = { rec: key, from, to, at: Date.now() };
          }
          return out;
        });
      }
    }
  });

  const listenThrough = start => run('listen', async signal => {
    const segs = mRef.current.segments;
    await playRange(playerRef.current, segs[start].start, segs[segs.length - 1].end, {
      signal,
      onTick: t => setIndex(indexAt(segs, t)),
    });
  });

  // --- Navigation & keys ---------------------------------------------------

  const move = useCallback(d => {
    stopAll();
    setIndex(i => Math.max(0, Math.min((mRef.current?.segments.length ?? 1) - 1, i + d)));
  }, [stopAll]);

  const select = i => {
    if (i !== index) stopAll();
    setIndex(i);
  };

  const toggle = (kind, action) => (busy === kind ? stopAll() : action(index));

  const primary = () => {
    if (busy) return stopAll();
    if (prefs.mode === 'through') recordThrough(index);
    else recordOne(index);
  };

  const keyRef = useRef();
  keyRef.current = e => {
    if (!ready || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const hasTake = !!m?.takes?.[index];
    const k = e.key.toLowerCase();
    if (e.key === ' ') { e.preventDefault(); primary(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'Enter') { e.preventDefault(); listenModel(index); }
    else if (k === 'm' && hasTake) listenMine(index);
    else if (k === 'c' && hasTake) compare(index);
    else if (k === 'o' && hasTake) overlay(index);
    else if (k === 'escape') stopAll();
  };
  useEffect(() => {
    const down = e => keyRef.current(e);
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
  const take = m.takes?.[index];
  const recording = busy === 'record' || busy === 'through';
  const anyTake = Object.keys(m.takes || {}).length > 0;
  const toggleReveal = i => setRevealed(r => {
    const n = new Set(r);
    n.has(i) ? n.delete(i) : n.add(i);
    return n;
  });
  const showsVideo = m.kind === 'youtube' || m.mediaType === 'video';

  return (
    <main className={`practice ${showsVideo ? 'with-video' : 'audio-only'}`}>
      <aside className="stage">
        <header className="masthead">
          <a className="back" href="#/"><Icon name="back" size={14} />教材</a>
        </header>
        <h1 className="practice-title">{m.title || '　'}</h1>

        {m.kind === 'youtube'
          ? <div className="screen" ref={ytHost} />
          : <div className={showsVideo ? 'screen' : 'screen-hidden'}>
              {mediaUrl && <video ref={videoRef} src={mediaUrl} playsInline preload="auto" />}
            </div>}
        {!showsVideo && <Timeline segments={segs} index={index} duration={m.duration} onSelect={select} />}

        <div className="settings">
          <Segmented label="練習" value={prefs.mode} options={[['single', '1文ずつ'], ['through', '通し']]}
            onChange={mode => { stopAll(); setPrefs({ mode }); }} />
          <Segmented label="速度" value={prefs.rate} options={[[0.75, '0.75'], [1, '1.0'], [1.25, '1.25']]}
            onChange={rate => setPrefs({ rate })} />
          <Segmented label="英文" value={prefs.showText} options={[[true, '表示'], [false, '隠す']]}
            onChange={showText => { setPrefs({ showText }); setRevealed(new Set()); }} />
        </div>

        {!anyTake && <p className="hint">スピーカーで流すとお手本の音も録音されます。ヘッドホンをつけて練習してください。</p>}
        {error && <p className="hint warn" role="alert">{error}</p>}
        <p className="keys">Space 録音／停止　←→ 文の移動　Enter お手本　M 自分　C 続けて　O 重ねて</p>
      </aside>

      <ol className="script-list">
        {segs.map((s, i) => {
          const hidden = !prefs.showText && !revealed.has(i);
          return (
            <li
              key={i}
              ref={el => { rowRefs.current[i] = el; }}
              className={`row ${i === index ? 'current' : ''}`}
              onClick={() => select(i)}
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
                {m.takes?.[i] && <span className="taken">録音あり</span>}
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

        <div className="main-actions">
          <button
            className={`button record ${recording ? 'active' : ''}`}
            onClick={e => { e.currentTarget.blur(); primary(); }}
            disabled={!ready}
          >
            <Icon name={busy ? 'stop' : 'record'} size={14} />
            {busy ? '止める' : prefs.mode === 'through' ? '通しで録音' : '録音'}
            {recording && <span className="level"><span ref={levelRef} /></span>}
          </button>
          {prefs.mode === 'through' && !busy && (
            <button className="button" onClick={() => listenThrough(index)} disabled={!ready}>
              <Icon name="play" size={14} />通しで聞く
            </button>
          )}
        </div>

        <div className="review" role="group" aria-label="聞き比べ">
          <TextAction active={busy === 'model'} disabled={!ready} onClick={() => toggle('model', listenModel)}
            title="お手本だけを聞く">お手本</TextAction>
          <TextAction active={busy === 'mine'} disabled={!ready || !take} onClick={() => toggle('mine', listenMine)}
            title="自分の録音を聞く">自分</TextAction>
          <TextAction active={busy === 'compare'} disabled={!ready || !take} onClick={() => toggle('compare', compare)}
            title="お手本のあとに自分の録音">続けて</TextAction>
          <TextAction active={busy === 'overlay'} disabled={!ready || !take} onClick={() => toggle('overlay', overlay)}
            title={m.kind === 'file' ? '左耳にお手本、右耳に自分の声を同時に' : 'お手本と自分の声を同時に'}>重ねて</TextAction>
        </div>
      </footer>
    </main>
  );
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
