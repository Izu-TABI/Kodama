import { useMemo, useRef, useState } from 'react';
import { parseTranscript } from '../lib/transcript.js';
import { transcriptToSegments, wordsToSegments, fmtTime } from '../lib/segments.js';
import { parseVideoId } from '../lib/youtube.js';
import { decodeToMono16k, transcribe } from '../lib/asr.js';
import { createMaterial } from '../lib/db.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';

export default function AddMaterial({ initialKind }) {
  const [kind, setKind] = useState(initialKind === 'file' ? 'file' : 'youtube');
  return (
    <main className="page add">
      <header className="masthead">
        <a className="back" href="#/"><Icon name="back" size={14} />教材</a>
      </header>
      <h1 className="page-title">教材を追加</h1>
      <Segmented
        label="追加する方法"
        value={kind}
        options={[['youtube', 'YouTube'], ['file', '音声・動画ファイル']]}
        onChange={setKind}
      />
      {kind === 'youtube' ? <FromYouTube /> : <FromFile />}
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

function FromYouTube() {
  const [url, setUrl] = useState('');
  const [raw, setRaw] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);
  const videoId = parseVideoId(url);
  const lines = useMemo(() => parseTranscript(raw), [raw]);
  const segments = useMemo(() => transcriptToSegments(lines), [lines]);

  async function loadCaptionFile(e) {
    const f = e.target.files?.[0];
    if (f) setRaw(await f.text());
    e.target.value = '';
  }

  async function save() {
    setSaving(true);
    const last = segments[segments.length - 1];
    const m = await createMaterial({
      kind: 'youtube',
      videoId,
      title: title.trim(),
      duration: last.end,
      segments,
    });
    go(`m/${m.id}`);
  }

  return (
    <form className="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <label className="field">
        <span className="field-label">動画のURL</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          autoFocus
        />
        {url && !videoId && <span className="field-note warn">YouTubeの動画URLを入れてください</span>}
      </label>
      {videoId && (
        <img className="thumb" src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" width="240" height="135" />
      )}

      <div className="field">
        <span className="field-label">文字起こし</span>
        <ol className="steps">
          <li>YouTubeで動画を開き、説明欄の下にある「文字起こしを表示」を押す</li>
          <li>出てきた文字起こしを、時刻ごと全部選択してコピーする</li>
          <li>下の欄に貼り付ける</li>
        </ol>
        <textarea
          rows={8}
          spellCheck={false}
          placeholder={'0:00\nSo in college,\n0:03\nI was a government major, …'}
          value={raw}
          onChange={e => setRaw(e.target.value)}
        />
        <span className="field-note">
          字幕ファイル（.srt / .vtt）でも使えます。
          <button type="button" className="link" onClick={() => fileInput.current.click()}>ファイルを読み込む</button>
          <input ref={fileInput} type="file" accept=".srt,.vtt,.txt,text/vtt" hidden onChange={loadCaptionFile} />
        </span>
        {raw.trim() && !lines.length && (
          <span className="field-note warn">時刻（0:00 のような表記）が見つかりません。時刻ごとコピーしてください。</span>
        )}
      </div>

      <Preview segments={segments} />

      <label className="field">
        <span className="field-label">タイトル</span>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="空欄なら動画のタイトルを使います" />
      </label>

      <div className="form-actions">
        <button className="button primary" disabled={!videoId || !segments.length || saving}>追加して練習する</button>
      </div>
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

  const pct = progress?.stage === 'model' && progress.total
    ? progress.loaded / progress.total
    : progress?.stage === 'transcribe' && progress.total ? progress.done / progress.total : null;

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
