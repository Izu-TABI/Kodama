import { useEffect, useRef, useState } from 'react';
import {
  listMaterials, deleteMaterial, updateMaterial,
  listFolders, createFolder, renameFolder, deleteFolder,
} from '../lib/db.js';
import { readActivity, summarize } from '../lib/activity.js';
import { fmtTime } from '../lib/segments.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';

const SHELF_KEY = 'shadowing:shelf';

const fmtDate = ts => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const fmtMinutes = s => (s < 60 ? `${Math.round(s)}秒` : `${Math.round(s / 60)}分`);

function readShelf() {
  try { return localStorage.getItem(SHELF_KEY) || 'all'; } catch { return 'all'; }
}

export default function Library() {
  const [items, setItems] = useState(null);
  const [folders, setFolders] = useState([]);
  const [shelf, setShelfState] = useState(readShelf);
  const [editing, setEditing] = useState(null); // { mode: 'create' | 'rename', name }
  const [activity, setActivity] = useState(() => summarize(readActivity().days));

  const reload = async () => {
    const [ms, fs] = await Promise.all([listMaterials(), listFolders()]);
    setItems(ms);
    setFolders(fs);
  };

  useEffect(() => {
    reload();
    const refresh = () => setActivity(summarize(readActivity().days));
    addEventListener('shadowing:activity', refresh);
    addEventListener('focus', refresh);
    return () => { removeEventListener('shadowing:activity', refresh); removeEventListener('focus', refresh); };
  }, []);

  const setShelf = id => {
    setShelfState(id);
    setEditing(null);
    try { localStorage.setItem(SHELF_KEY, id); } catch { /* storage unavailable */ }
  };

  const folder = folders.find(f => f.id === shelf) ?? null;
  // A folder that no longer exists falls back to すべて.
  const current = shelf === 'favorites' || folder ? shelf : 'all';
  const shown = !items ? [] : current === 'all' ? items
    : current === 'favorites' ? items.filter(m => m.favorite)
    : items.filter(m => m.folderId === current);

  async function patchMaterial(id, patch) {
    await updateMaterial(id, patch);
    setItems(list => list.map(m => (m.id === id ? { ...m, ...patch } : m)));
  }

  async function remove(m) {
    if (!confirm(`「${m.title}」を削除しますか？\n録音と和訳も消えます。`)) return;
    await deleteMaterial(m.id);
    reload();
  }

  async function submitFolder(name) {
    const trimmed = name.trim();
    if (!trimmed) return setEditing(null);
    if (editing.mode === 'create') {
      const f = await createFolder(trimmed);
      await reload();
      setShelf(f.id);
    } else {
      await renameFolder(folder.id, trimmed);
      await reload();
      setEditing(null);
    }
  }

  async function removeFolder() {
    if (!confirm(`フォルダ「${folder.name}」を削除しますか？\n中の教材は消えず、「すべて」に残ります。`)) return;
    await deleteFolder(folder.id);
    await reload();
    setShelf('all');
  }

  const count = id => (id === 'all' ? items.length
    : id === 'favorites' ? items.filter(m => m.favorite).length
    : items.filter(m => m.folderId === id).length);
  const addHref = folder ? `#/add/ted/${folder.id}` : '#/add/ted';

  return (
    <main className="page library">
      <header className="masthead">
        <span className="wordmark">Shadowing</span>
        {items?.length > 0 && (
          <a className="text-button" href={addHref}>
            <Icon name="plus" size={14} />{folder ? `「${folder.name}」に追加` : '教材を追加'}
          </a>
        )}
      </header>

      {items && items.length === 0 && (
        <section className="intro">
          <h1>聞こえた英語を、すぐ後ろから追いかける。</h1>
          <p>
            TEDのトークや手持ちの音声を1文ずつに区切って、シャドーイングできます。
            わからない単語はタップで意味を、文は和訳を見られます。
          </p>
          <div className="intro-actions">
            <a className="button primary" href="#/add/ted">TEDから選ぶ</a>
            <a className="button" href="#/add/file">音声ファイルから追加</a>
          </div>
        </section>
      )}

      {items?.length > 0 && (
        <>
          <Streak activity={activity} />

          <nav className="shelves" aria-label="教材の分類">
            <ShelfTab active={current === 'all'} onClick={() => setShelf('all')} label="すべて" count={count('all')} />
            <ShelfTab active={current === 'favorites'} onClick={() => setShelf('favorites')} label="お気に入り" count={count('favorites')} />
            {folders.map(f => (
              editing?.mode === 'rename' && f.id === current
                ? <FolderName key={f.id} initial={f.name} onSubmit={submitFolder} onCancel={() => setEditing(null)} />
                : <ShelfTab key={f.id} active={current === f.id} onClick={() => setShelf(f.id)} label={f.name} count={count(f.id)} />
            ))}
            {editing?.mode === 'create'
              ? <FolderName initial="" onSubmit={submitFolder} onCancel={() => setEditing(null)} />
              : <button className="shelf-add" onClick={() => setEditing({ mode: 'create' })}><Icon name="plus" size={12} />フォルダを作る</button>}
          </nav>
          {folder && !editing && (
            <div className="shelf-actions">
              <button className="act" onClick={() => setEditing({ mode: 'rename' })}>名前を変える</button>
              <button className="act" onClick={removeFolder}>フォルダを削除</button>
            </div>
          )}

          {shown.length === 0 && (
            <p className="empty">
              {current === 'favorites'
                ? '教材の ☆ を押すと、ここに集まります。'
                : 'このフォルダはまだ空です。教材の「フォルダ」から移すか、上の「追加」から入れられます。'}
            </p>
          )}

          <ol className="materials">
            {shown.map(m => {
              const inFolder = folders.find(f => f.id === m.folderId);
              return (
                <li key={m.id}>
                  <button className="material" onClick={() => go(`m/${m.id}`)}>
                    <span className="material-title">{m.title}</span>
                    <span className="material-meta">
                      {m.kind === 'ted' ? 'TED' : m.mediaType === 'video' ? '動画ファイル' : '音声ファイル'}
                      {m.author && <><span className="sep">·</span>{m.author}</>}
                      <span className="sep">·</span>{m.segments.length}文
                      <span className="sep">·</span>{fmtTime(m.duration)}
                      {m.practicedAt > 0 && <><span className="sep">·</span>{fmtDate(m.practicedAt)}に練習</>}
                      {inFolder && current !== inFolder.id && <><span className="sep">·</span>{inFolder.name}</>}
                    </span>
                  </button>
                  <div className="material-actions">
                    <button
                      className={`star ${m.favorite ? 'on' : ''}`}
                      onClick={() => patchMaterial(m.id, { favorite: !m.favorite })}
                      aria-pressed={!!m.favorite}
                      aria-label={m.favorite ? 'お気に入りから外す' : 'お気に入りにする'}
                      title={m.favorite ? 'お気に入りから外す' : 'お気に入りにする'}
                    >
                      <Icon name={m.favorite ? 'starred' : 'star'} size={15} />
                    </button>
                    {folders.length > 0 && (
                      <select
                        className="folder-select"
                        value={m.folderId ?? ''}
                        onChange={e => patchMaterial(m.id, { folderId: e.target.value || null })}
                        aria-label="フォルダ"
                      >
                        <option value="">フォルダなし</option>
                        {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    )}
                    <button className="quiet-button" onClick={() => remove(m)} aria-label={`${m.title}を削除`}>削除</button>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <footer className="credits">
        <p>
          TEDのトークは、TEDがCC BY-NC-ND 4.0で公開している動画と字幕を、TEDの配信からそのまま再生しています。このアプリはTEDとは関係ありません。
          英和辞書はEJDict-hand（パブリックドメイン）を使っています。
        </p>
        <p>教材・録音・和訳・練習の記録は、このブラウザの中にだけ保存されます。</p>
      </footer>
    </main>
  );
}

function ShelfTab({ active, onClick, label, count }) {
  return (
    <button className={`shelf ${active ? 'on' : ''}`} onClick={onClick} aria-pressed={active}>
      {label}<span className="shelf-count num">{count}</span>
    </button>
  );
}

function FolderName({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial);
  const ref = useRef(null);
  // Enter, Esc and leaving the field all end editing, but only the first counts.
  const finished = useRef(false);
  const finish = fn => { if (!finished.current) { finished.current = true; fn(); } };
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form className="folder-form" onSubmit={e => { e.preventDefault(); finish(() => onSubmit(name)); }}>
      <input
        ref={ref}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') finish(onCancel); }}
        onBlur={() => finish(() => onSubmit(name))}
        placeholder="フォルダ名"
        maxLength={30}
        aria-label="フォルダ名"
      />
    </form>
  );
}

function Streak({ activity }) {
  const { current, best, today, recent } = activity;
  return (
    <section className="streak" aria-label="練習の記録">
      <div className="streak-figure">
        <span className="big num">{current}</span>
        <span className="unit">日連続</span>
      </div>
      <div className="streak-detail">
        <p className="streak-today num">
          今日 {today.n}文{today.s > 0 && <><span className="sep">·</span>{fmtMinutes(today.s)}</>}
          {best > current && <><span className="sep">·</span>最長 {best}日</>}
        </p>
        <ol className="streak-days" aria-label="この2週間">
          {recent.map((d, i) => (
            <li key={d.key} className={`${d.n > 0 ? 'done' : ''} ${i === recent.length - 1 ? 'today' : ''}`} title={`${d.key}　${d.n}文`} />
          ))}
        </ol>
      </div>
    </section>
  );
}
