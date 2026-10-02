import { useEffect, useMemo, useRef, useState } from 'react';
import { transcriptToSegments, wordsToSegments, fmtTime } from '../lib/segments.js';
import { parseSource } from '../lib/sources.js';
import { lookupUrl } from '../lib/lookup.js';
import { decodeToMono16k, transcribe } from '../lib/asr.js';
import { createMaterial } from '../lib/db.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';

export default function AddMaterial({ initialKind }) {
  const [kind, setKind] = useState(initialKind === 'file' ? 'file' : 'url');
  return (
    <main className="page add">
      <header className="masthead">
        <a className="back" href="#/"><Icon name="back" size={14} />教材</a>
      </header>
      <h1 className="page-title">教材を追加</h1>
      <Segmented
        label="追加する方法"
        value={kind}
        options={[['url', 'YouTube・TED'], ['file', '音声・動画ファイル']]}
        onChange={setKind}
      />
      {kind === 'url' ? <FromUrl /> : <FromFile />}
    </main>
  );
}

function Preview({ segments }) {
  if (!segments.length) return null;
  const shown = segments.slice(0, 4);
  return (
    <div className="preview">
      <p className="preview-head">{segments.length}文に区切りました</p>
      <ol>
        {shown.map((s, i) => (
          <li key={i}><span className="time">{fmtTime(s.start)}</span><span className="script">{s.text}</span></li>
        ))}
      </ol>
      {segments.length > shown.length && <p className="preview-more">ほか {segments.length - shown.length}文</p>}
    </div>
  );
}

const SOURCE_NAME = { youtube: 'YouTube', ted: 'TED' };

function FromUrl() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const source = parseSource(url);
  const sourceKey = source ? `${source.kind}:${source.id}` : '';

  // Fetch the captions as soon as a recognisable URL is in the field.
  useEffect(() => {
    if (!sourceKey) { setState({ status: 'idle' }); return; }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    const t = setTimeout(() => {
      lookupUrl(url.trim(), ctrl.signal)
        .then(info => setState({ status: 'ready', info, segments: transcriptToSegments(info.lines, info.duration) }))
        .catch(e => { if (e.name !== 'AbortError') setState({ status: 'error', message: e.message }); });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
    // Refetch only when the video itself changes, not on every edit to the URL.
  }, [sourceKey]);

  async function save() {
    const { info, segments } = state;
    setSaving(true);
    const m = await createMaterial({
      kind: info.kind,
      title: info.title,
      author: info.author,
      duration: info.duration,
      thumbnail: info.thumbnail,
      sourceUrl: url.trim(),
      segments,
      ...(info.kind === 'youtube' ? { videoId: info.videoId } : { slug: info.slug, hlsUrl: info.hlsUrl }),
    });
    go(`m/${m.id}`);
  }

  return (
    <form className="form" onSubmit={e => { e.preventDefault(); if (state.status === 'ready') save(); }}>
      <label className="field">
        <span className="field-label">動画のURL</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=…　または　https://www.ted.com/talks/…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          autoFocus
        />
        {url.trim() && !source && <span className="field-note warn">YouTubeかTEDの動画のURLを入れてください</span>}
        {!url.trim() && (
          <span className="field-note">人が作成した英語字幕のある動画が使えます。自動生成の字幕しかない動画は使えません。</span>
        )}
      </label>

      {state.status === 'loading' && (
        <p className="field-note loading" aria-live="polite">{SOURCE_NAME[source?.kind]}から字幕を取得しています…</p>
      )}
      {state.status === 'error' && <p className="field-note warn" role="alert">{state.message}</p>}

      {state.status === 'ready' && (
        <>
          <div className="found">
            {state.info.thumbnail && <img src={state.info.thumbnail} alt="" width="160" height="90" />}
            <div className="found-text">
              <p className="found-title">{state.info.title}</p>
              <p className="found-meta">
                {SOURCE_NAME[state.info.kind]}
                {state.info.author && <><span className="sep">·</span>{state.info.author}</>}
                <span className="sep">·</span>{fmtTime(state.info.duration)}
              </p>
            </div>
          </div>
          <Preview segments={state.segments} />
          <div className="form-actions">
            <button className="button primary" disabled={saving}>追加して練習する</button>
          </div>
        </>
      )}
    </form>
  );
}

const STAGE_TEXT = {
  decode: '音声を読み込んでいます',
  model: '文字起こしモデルを準備しています（初回のみ）',
  transcribe: '文字起こししています',
};

function FromFile() {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  function pick(f) {
    if (!f) return;
    if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|m4a|wav|aac|ogg|oga|flac|mp4|m4v|mov|webm)$/i.test(f.name)) {
      setError('音声か動画のファイルを選んでください');
      return;
    }
    abortRef.current?.abort();
    setFile(f);
    setTitle(f.name.replace(/\.[^.]+$/, ''));
    setResult(null);
    setError('');
    run(f);
  }

  async function run(f) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setProgress({ stage: 'decode' });
      const { audio, duration } = await decodeToMono16k(f);
      const words = await transcribe(audio, { signal: ctrl.signal, onProgress: setProgress });
      const segments = wordsToSegments(words, { duration });
      if (!segments.length) throw new Error('英語の音声が見つかりませんでした');
      setResult({ duration, segments });
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || '文字起こしに失敗しました');
    } finally {
      if (abortRef.current === ctrl) setProgress(null);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setFile(null);
    setProgress(null);
  }

  async function save() {
    const m = await createMaterial({
      kind: 'file',
      title: title.trim() || file.name,
      mediaType: file.type.startsWith('video/') ? 'video' : 'audio',
      duration: result.duration,
      segments: result.segments,
    }, file);
    go(`m/${m.id}`);
  }

  const pct = useMemo(() => {
    if (progress?.stage === 'model' && progress.total) return progress.loaded / progress.total;
    if (progress?.stage === 'transcribe' && progress.total) return progress.done / progress.total;
    return null;
  }, [progress]);

  return (
    <form className="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <label
        className={`drop ${dragging ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
      >
        <input type="file" accept="audio/*,video/*" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        {file ? <span className="drop-file">{file.name}</span> : <span>音声・動画ファイルを選ぶ</span>}
        <span className="field-note">mp3・m4a・wav・mp4 など。ここにドロップしても追加できます</span>
      </label>

      {progress && (
        <div className="progress" aria-live="polite">
          <div className="progress-text">
            <span>{STAGE_TEXT[progress.stage]}</span>
            <span className="num">
              {progress.stage === 'model' && progress.total ? `${Math.round(progress.loaded / 1e6)} / ${Math.round(progress.total / 1e6)} MB` : ''}
              {progress.stage === 'transcribe' ? `${fmtTime(progress.done)} / ${fmtTime(progress.total)}` : ''}
            </span>
          </div>
          <div className="bar"><div style={{ transform: `scaleX(${pct ?? 0})` }} className={pct == null ? 'indeterminate' : ''} /></div>
          <button type="button" className="quiet-button" onClick={cancel}>中止</button>
        </div>
      )}
      {!result && !progress && (
        <p className="field-note">音声はこの端末の中で文字起こしされ、外部には送信されません。</p>
      )}
      {error && <p className="field-note warn">{error}</p>}

      {result && (
        <>
          <Preview segments={result.segments} />
          <label className="field">
            <span className="field-label">タイトル</span>
            <input value={title} onChange={e => setTitle(e.target.value)} />
          </label>
          <div className="form-actions">
            <button className="button primary">追加して練習する</button>
          </div>
        </>
      )}
    </form>
  );
}
