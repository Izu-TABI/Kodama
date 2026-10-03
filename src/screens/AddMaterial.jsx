import { useEffect, useMemo, useState } from 'react';
import { fmtTime } from '../lib/segments.js';
import { loadCatalog, searchTalks, parseTedSlug, loadTalk, imageUrl, KIND_LABEL } from '../lib/ted.js';
import { createMaterial, listMaterials, listFolders } from '../lib/db.js';
import { folderPath } from '../lib/tree.js';
import { canTranslateOnDevice, warmUpTranslator } from '../lib/translate.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';

const PAGE = 30;
const fmtCount = n => n.toLocaleString('ja-JP');

// Adding TED talks. (Audio and video files are read in from the library.)
export default function AddMaterial({ folderId }) {
  const [folders, setFolders] = useState([]);
  useEffect(() => { listFolders().then(setFolders); }, []);
  const target = folderId && folders.some(f => f.id === folderId) ? folderId : null;
  const back = target ? `#/f/${target}` : '#/';
  const path = target ? folderPath(folders, target).map(f => f.name).join(' › ') : '';

  return (
    <main className="page add">
      <header className="masthead">
        <a className="back" href={back}><Icon name="back" size={14} />教材</a>
      </header>
      <h1 className="page-title">TEDから追加</h1>
      {path && <p className="field-note destination">追加先：{path}</p>}
      <FromTed folderId={target} />
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
      {!canTranslateOnDevice() && (
        <p className="field-note">このブラウザでは和訳を自動で作れないので、「和訳あり」のトークがおすすめです。</p>
      )}

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
                  <span className="talk-thumb">{t.image && <img src={imageUrl(t.image, 240)} alt="" loading="lazy" />}</span>
                  <span className="talk-text">
                    <span className="talk-title">{t.title}</span>
                    <span className="talk-meta">
                      {t.speaker}
                      <span className="sep">·</span>{fmtTime(t.duration)}
                      {t.year > 0 && <><span className="sep">·</span>{t.year}</>}
                      {KIND_LABEL[t.kind] && <><span className="sep">·</span>{KIND_LABEL[t.kind]}</>}
                      {t.ja && <><span className="sep">·</span>和訳あり</>}
                      {added.has(t.slug) && <><span className="sep">·</span><span className="added">追加済み</span></>}
                    </span>
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
    // The click lets Chrome download its translator for the sentences TED hasn't translated.
    if (state.segments.some(s => !s.ja)) warmUpTranslator();
    const m = await createMaterial({
      folderId,
      kind: 'ted',
      slug: talk.slug,
      stream: talk.stream,
      image: talk.image,
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
      <div className="talk-hero">
        {talk.image && <img src={imageUrl(talk.image, 640)} alt="" />}
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
