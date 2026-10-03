import { useEffect, useMemo, useRef, useState } from 'react';
import { wordsToSegments, fmtTime } from '../lib/segments.js';
import { loadCatalog, searchTalks, parseTedSlug, loadTalk, KIND_LABEL } from '../lib/ted.js';
import { decodeToMono16k, transcribe } from '../lib/asr.js';
import { createMaterial, listMaterials, listFolders } from '../lib/db.js';
import { canTranslateOnDevice, getTranslator } from '../lib/translate.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';

// Machine translation starts as soon as the material is added; the click on
// 追加 lets Chrome download its language pack if it hasn't yet.
function warmUpTranslator(needed) {
  if (needed && canTranslateOnDevice()) getTranslator().catch(() => {});
}

export default function AddMaterial({ initialKind, folderId }) {
  const [kind, setKind] = useState(initialKind === 'file' ? 'file' : 'ted');
  const [folder, setFolder] = useState(null);
  useEffect(() => {
    if (folderId) listFolders().then(fs => setFolder(fs.find(f => f.id === folderId) ?? null));
  }, [folderId]);
  return (
    <main className="page add">
      <header className="masthead">
        <a className="back" href="#/"><Icon name="back" size={14} />教材</a>
      </header>
      <h1 className="page-title">教材を追加</h1>
      <div className="add-head">
        <Segmented
          label="追加する方法"
          value={kind}
          options={[['ted', 'TEDから選ぶ'], ['file', '音声・動画ファイル']]}
          onChange={setKind}
        />
        {folder && <p className="field-note">追加先：{folder.name}</p>}
      </div>
      {kind === 'ted' ? <FromTed folderId={folder?.id ?? null} /> : <FromFile folderId={folder?.id ?? null} />}
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
          <li key={i}>
            <span className="time">{fmtTime(s.start)}</span>
            <span className="preview-text">
              <span className="script">{s.text}</span>
              {s.ja && <span className="ja">{s.ja}</span>}
            </span>
          </li>
        ))}
      </ol>
      {segments.length > shown.length && <p className="preview-more">ほか {segments.length - shown.length}文</p>}
    </div>
  );
}

const PAGE = 30;
const fmtCount = n => n.toLocaleString('ja-JP');

function FromTed({ folderId }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [length, setLength] = useState('all');
  const [japanese, setJapanese] = useState(false);
  const [sort, setSort] = useState('new');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState(null);
  const [added, setAdded] = useState(() => new Map());

  useEffect(() => {
    loadCatalog().then(setCatalog).catch(e => setError(e.message));
    listMaterials().then(ms => setAdded(new Map(ms.filter(m => m.kind === 'ted').map(m => [m.slug, m.id]))));
  }, []);

  const slug = parseTedSlug(query);
  const results = useMemo(() => {
    if (!catalog) return [];
    if (slug) return catalog.talks.filter(t => t.slug === slug);
    return searchTalks(catalog.talks, { query, length, japanese, sort });
  }, [catalog, slug, query, length, japanese, sort]);

  useEffect(() => { setLimit(PAGE); }, [query, length, japanese, sort]);

  if (selected) {
    return <TalkDetail talk={selected} addedId={added.get(selected.slug)} folderId={folderId} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="form">
      <label className="field">
        <span className="field-label">さがす</span>
        <input
          type="search"
          placeholder="タイトル・話し手（英語）、またはTEDのURL"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      </label>
      <div className="filters">
        <Segmented label="長さ" value={length}
          options={[['all', 'すべて'], ['short', '〜6分'], ['medium', '6〜12分'], ['long', '12〜20分'], ['longer', '20分〜']]}
          onChange={setLength} />
        <Segmented label="和訳" value={japanese} options={[[false, 'すべて'], [true, 'あり']]} onChange={setJapanese} />
        <Segmented label="並び" value={sort} options={[['new', '新しい順'], ['popular', '人気順']]} onChange={setSort} />
      </div>

      {error && <p className="field-note warn">{error}</p>}
      {!catalog && !error && <p className="field-note loading">TEDのトーク一覧を読み込んでいます…</p>}
      {catalog && (
        <div className="talks">
          <p className="talks-count">
            {fmtCount(results.length)}本
            {slug && !results.length && '　このトークは一覧にありません（一覧は週に1回更新されます）'}
          </p>
          <ol>
            {results.slice(0, limit).map(t => (
              <li key={t.slug}>
                <button className="talk" onClick={() => setSelected(t)}>
                  <span className="talk-title">{t.title}</span>
                  <span className="talk-meta">
                    {t.speaker}
                    <span className="sep">·</span>{fmtTime(t.duration)}
                    {t.year > 0 && <><span className="sep">·</span>{t.year}</>}
                    {KIND_LABEL[t.kind] && <><span className="sep">·</span>{KIND_LABEL[t.kind]}</>}
                    {t.ja && <><span className="sep">·</span>和訳あり</>}
                    {added.has(t.slug) && <><span className="sep">·</span><span className="added">追加済み</span></>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {results.length > limit && (
            <button className="button more" onClick={() => setLimit(l => l + PAGE)}>もっと見る</button>
          )}
        </div>
      )}
    </div>
  );
}

function TalkDetail({ talk, addedId, folderId, onBack }) {
  const [state, setState] = useState({ status: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTalk(talk)
      .then(r => alive && setState({ status: 'ready', ...r }))
      .catch(e => alive && setState({ status: 'error', message: e.message }));
    return () => { alive = false; };
  }, [talk]);

  async function save() {
    setSaving(true);
    warmUpTranslator(state.segments.some(s => !s.ja));
    const m = await createMaterial({
      folderId,
      kind: 'ted',
      slug: talk.slug,
      stream: talk.stream,
      title: talk.title,
      author: talk.speaker,
      duration: state.duration,
      segments: state.segments,
      sourceUrl: `https://www.ted.com/talks/${talk.slug}`,
    });
    go(`m/${m.id}`);
  }

  return (
    <div className="form talk-detail">
      <button className="back" onClick={onBack}><Icon name="back" size={14} />一覧に戻る</button>
      <div>
        <p className="found-title">{talk.title}</p>
        <p className="found-meta">
          TED<span className="sep">·</span>{talk.speaker}
          <span className="sep">·</span>{fmtTime(talk.duration)}
          {talk.year > 0 && <><span className="sep">·</span>{talk.year}</>}
          <span className="sep">·</span>
          <a href={`https://www.ted.com/talks/${talk.slug}`} target="_blank" rel="noreferrer">ted.com<Icon name="out" size={11} /></a>
        </p>
      </div>

      {state.status === 'loading' && <p className="field-note loading">字幕を読み込んでいます…</p>}
      {state.status === 'error' && <p className="field-note warn">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          <p className="field-note">
            {state.hasJapanese
              ? 'TEDの日本語訳があります（ボランティアの翻訳者による訳）'
              : canTranslateOnDevice()
                ? 'TEDの日本語訳はありません。追加すると機械翻訳で和訳を作ります'
                : 'TEDの日本語訳はありません。このブラウザでは和訳を自動で作れないので、和訳ありのトークがおすすめです'}
          </p>
          <Preview segments={state.segments} />
        </>
      )}

      <div className="form-actions">
        {addedId
          ? <button className="button primary" onClick={() => go(`m/${addedId}`)}>追加済み・練習する</button>
          : <button className="button primary" onClick={save} disabled={state.status !== 'ready' || saving}>追加して練習する</button>}
      </div>
    </div>
  );
}

const STAGE_TEXT = {
  decode: '音声を読み込んでいます',
  model: '文字起こしモデルを準備しています（初回のみ）',
  transcribe: '文字起こししています',
};

function FromFile({ folderId }) {
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
    warmUpTranslator(true);
    const m = await createMaterial({
      folderId,
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
        <p className="field-note">
          音声はこの端末の中で文字起こしされ、外部には送信されません。初回は文字起こし用のデータ（約210MB）を読み込むので、PCでの利用がおすすめです。
        </p>
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
