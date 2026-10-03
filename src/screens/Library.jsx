import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  listMaterials, updateMaterial, listFolders, createFolder, renameFolder, moveItems, deleteFolders,
} from '../lib/db.js';
import {
  folderKey, materialKey, parseKey, folderPath, subtree, sortItems, visibleRows, countInside, freeName, canMoveInto,
} from '../lib/tree.js';
import { importItems, subscribeImports, queueImport, cancelImport, clearFinished } from '../lib/imports.js';
import { filesFromInput, entriesFromDrop } from '../lib/files.js';
import { warmUpTranslator } from '../lib/translate.js';
import { imageUrl, loadCatalog } from '../lib/ted.js';
import { readActivity, summarize, calendar } from '../lib/activity.js';
import { fmtTime } from '../lib/segments.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import MoveDialog from '../components/MoveDialog.jsx';
import Guide from './Guide.jsx';

const SORT_KEY = 'shadowing:sort';
const EXPANDED_KEY = 'shadowing:expanded';
const DRAG_TYPE = 'application/x-shadowing-items';

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

const fmtDate = ts => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};
const fmtMinutes = s => (s < 60 ? `${Math.round(s)}秒` : `${Math.round(s / 60)}分`);
const kindLabel = m => (m.kind === 'ted' ? 'TED' : m.mediaType === 'video' ? '動画' : '音声');

function useMedia(query) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

function useImports() {
  const [list, setList] = useState(importItems);
  useEffect(() => subscribeImports(setList), []);
  return list;
}

export default function Library({ folderId = null, view = 'files' }) {
  const [materials, setMaterials] = useState(null);
  const [folders, setFolders] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set(readJson(EXPANDED_KEY, [])));
  const [sort, setSort] = useState(() => readJson(SORT_KEY, { key: 'name', dir: 'asc' }));
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [moving, setMoving] = useState(null);
  const [menu, setMenu] = useState(null);
  const [dropOn, setDropOn] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [days, setDays] = useState(() => readActivity().days);
  const activity = useMemo(() => summarize(days), [days]);
  const touch = useMedia('(hover: none)');
  const imports = useImports();
  const fileInput = useRef(null);
  const dragKeys = useRef([]);
  const listRef = useRef(null);

  const reload = useCallback(async () => {
    const [ms, fs] = await Promise.all([listMaterials(), listFolders()]);
    setMaterials(ms);
    setFolders(fs);
  }, []);

  useEffect(() => {
    reload();
    const refresh = () => setDays(readActivity().days);
    addEventListener('shadowing:activity', refresh);
    addEventListener('focus', refresh);
    return () => { removeEventListener('shadowing:activity', refresh); removeEventListener('focus', refresh); };
  }, [reload]);

  // TED talks added before thumbnails existed get theirs from the catalog.
  useEffect(() => {
    const missing = materials?.filter(m => m.kind === 'ted' && m.image == null) ?? [];
    if (!missing.length) return;
    loadCatalog().then(async ({ talks }) => {
      const bySlug = new Map(talks.map(t => [t.slug, t.image]));
      for (const m of missing) await updateMaterial(m.id, { image: bySlug.get(m.slug) ?? '' });
      reload();
    }).catch(() => {});
  }, [materials, reload]);

  // Imports add folders and materials: show them as they appear.
  const importChanges = imports.length + imports.filter(it => it.status !== 'waiting' && it.status !== 'working').length;
  useEffect(() => { if (importChanges) reload(); }, [importChanges, reload]);

  // A new place starts with nothing selected.
  useEffect(() => {
    setSelected(new Set());
    setAnchor(null);
    setRenaming(null);
    setMenu(null);
    setSelectMode(false);
  }, [folderId, view]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const favorites = view === 'favorites';
  const here = folderId && folders.some(f => f.id === folderId) ? folderId : null;
  const path = here ? folderPath(folders, here) : [];
  const rows = useMemo(() => {
    if (!materials) return [];
    if (favorites) {
      return sortItems(materials.filter(m => m.favorite), sort).map(m => ({ kind: 'material', key: materialKey(m.id), item: m, depth: 0 }));
    }
    return visibleRows(folders, materials, here, expanded, sort);
  }, [materials, folders, here, expanded, sort, favorites]);

  const byKey = key => rows.find(r => r.key === key);
  const nameOfKey = key => {
    const { kind, id } = parseKey(key);
    return kind === 'folder' ? folders.find(f => f.id === id)?.name : materials?.find(m => m.id === id)?.title;
  };
  const placeName = id => (id ? folders.find(f => f.id === id)?.name ?? 'フォルダ' : 'すべての教材');

  // --- Actions ---------------------------------------------------------------

  const open = row => go(row.kind === 'folder' ? `f/${row.item.id}` : `m/${row.item.id}`);

  const toggleExpand = id => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeJson(EXPANDED_KEY, [...next]);
    return next;
  });

  const changeSort = key => setSort(prev => {
    const next = prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' };
    writeJson(SORT_KEY, next);
    return next;
  });

  const split = keys => ({
    folderIds: keys.filter(k => k.startsWith('f:')).map(k => k.slice(2)),
    materialIds: keys.filter(k => k.startsWith('m:')).map(k => k.slice(2)),
  });

  async function moveKeys(all, target) {
    const keys = all.filter(key => {
      const { kind, id } = parseKey(key);
      const item = kind === 'folder' ? folders.find(f => f.id === id) : materials.find(m => m.id === id);
      return (kind === 'folder' ? item?.parentId : item?.folderId) !== target;
    });
    if (!keys.length || !canMoveInto(folders, keys, target)) return;
    await moveItems(split(keys), target);
    await reload();
    setNotice(`${keys.length === 1 ? `「${nameOfKey(keys[0])}」` : `${keys.length}件`}を「${placeName(target)}」に移動しました`);
  }

  async function removeKeys(keys) {
    if (!keys.length) return;
    const { folderIds, materialIds } = split(keys);
    const allFolders = new Set();
    const allMaterials = new Set(materialIds);
    for (const id of folderIds) {
      const t = subtree(folders, materials, id);
      t.folderIds.forEach(x => allFolders.add(x));
      t.materialIds.forEach(x => allMaterials.add(x));
    }
    const inside = allMaterials.size - materialIds.length;
    const label = keys.length === 1 ? `「${nameOfKey(keys[0])}」` : `${keys.length}件`;
    if (!confirm(`${label}を削除しますか？${inside > 0 ? `\nフォルダの中の教材${inside}件も削除されます。` : ''}\n録音と和訳も消えます。`)) return;
    await deleteFolders([...allFolders], [...allMaterials]);
    setSelected(new Set());
    await reload();
  }

  async function setFavorite(keys, value) {
    for (const id of split(keys).materialIds) await updateMaterial(id, { favorite: value });
    await reload();
  }

  async function newFolder() {
    const f = await createFolder(freeName('新規フォルダ', folders.filter(x => x.parentId === here)), here);
    await reload();
    const key = folderKey(f.id);
    setSelected(new Set([key]));
    setAnchor(key);
    setRenaming(key);
  }

  async function commitRename(key, name) {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === nameOfKey(key)) return;
    const { kind, id } = parseKey(key);
    if (kind === 'folder') await renameFolder(id, trimmed);
    else await updateMaterial(id, { title: trimmed });
    await reload();
  }

  async function importFrom(read, target) {
    const found = await read();
    if (!found.length) return;
    const r = await queueImport(found, target);
    if (r.folders) {
      await reload();
      if (target) setExpanded(prev => new Set(prev).add(target));
    }
    setNotice(r.queued
      ? `${r.queued}件を読み込みます${r.skipped ? `（音声・動画ではない${r.skipped}件は除きました）` : ''}`
      : '音声・動画のファイルが見つかりませんでした');
  }

  const pickFiles = () => {
    warmUpTranslator();
    fileInput.current?.click();
  };

  // --- Selection -------------------------------------------------------------

  const selectOnly = key => { setSelected(new Set([key])); setAnchor(key); };

  function onRowClick(e, row, index) {
    if (renaming) return;
    e.stopPropagation();
    setMenu(null);
    if (touch && !selectMode) return open(row);
    if (touch || e.metaKey || e.ctrlKey) {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        return next;
      });
      setAnchor(row.key);
      return;
    }
    if (e.shiftKey && anchor) {
      const a = rows.findIndex(r => r.key === anchor);
      const [from, to] = a < index ? [a, index] : [index, a];
      setSelected(new Set(rows.slice(from, to + 1).map(r => r.key)));
      return;
    }
    selectOnly(row.key);
  }

  function onContextMenu(e, row) {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(row.key)) selectOnly(row.key);
    setMenu({ x: e.clientX, y: e.clientY });
  }

  // Finder-like keys while nothing else has focus.
  const keyRef = useRef();
  keyRef.current = e => {
    if (renaming || moving || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const index = rows.findIndex(r => r.key === anchor);
    const step = d => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, (index < 0 ? (d > 0 ? -1 : rows.length) : index) + d))];
      if (!next) return;
      if (e.shiftKey && anchor) setSelected(prev => new Set(prev).add(next.key));
      else setSelected(new Set([next.key]));
      setAnchor(next.key);
      listRef.current?.querySelector(`[data-key="${next.key}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    const one = selected.size === 1 ? byKey([...selected][0]) : null;
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' && one) { e.preventDefault(); open(one); }
    else if (e.key === 'ArrowRight' && one?.kind === 'folder' && !expanded.has(one.item.id)) toggleExpand(one.item.id);
    else if (e.key === 'ArrowLeft' && one?.kind === 'folder' && expanded.has(one.item.id)) toggleExpand(one.item.id);
    else if ((e.key === 'Backspace' || e.key === 'Delete') && selected.size) { e.preventDefault(); removeKeys([...selected]); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(rows.map(r => r.key))); }
    else if (e.key === 'Escape') { setMenu(null); setSelected(new Set()); }
  };
  useEffect(() => {
    const down = e => keyRef.current(e);
    addEventListener('keydown', down);
    return () => removeEventListener('keydown', down);
  }, []);

  // --- Drag and drop ---------------------------------------------------------

  function onDragStart(e, row) {
    const keys = selected.has(row.key) ? [...selected] : [row.key];
    if (!selected.has(row.key)) selectOnly(row.key);
    dragKeys.current = keys;
    e.dataTransfer.setData(DRAG_TYPE, keys.join(','));
    e.dataTransfer.setData('text/plain', keys.map(nameOfKey).join('\n'));
    e.dataTransfer.effectAllowed = 'move';
  }

  // Props that make an element take drops into `target` (a folder id, or null for the top level).
  const dropTarget = (target, id) => ({
    onDragOver: e => {
      const types = [...e.dataTransfer.types];
      const internal = types.includes(DRAG_TYPE);
      if (!internal && !types.includes('Files')) return;
      if (internal && !canMoveInto(folders, dragKeys.current, target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
      setDropOn(id);
    },
    onDragLeave: e => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropOn(d => (d === id ? null : d));
    },
    onDrop: e => {
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null);
      if ([...e.dataTransfer.types].includes(DRAG_TYPE)) moveKeys(dragKeys.current, target);
      else importFrom(entriesFromDrop(e.dataTransfer), target);
    },
  });

  // --- Rendering -------------------------------------------------------------

  const keys = [...selected];
  const single = keys.length === 1 ? byKey(keys[0]) : null;
  const selectedMaterials = split(keys).materialIds.map(id => materials?.find(m => m.id === id)).filter(Boolean);
  const allFavorite = selectedMaterials.length > 0 && selectedMaterials.every(m => m.favorite);
  // The start screen gives way as soon as something is being read in.
  const empty = materials && materials.length === 0 && folders.length === 0 && imports.length === 0;
  const actions = [
    single && { label: '開く', run: () => open(single) },
    single && { label: '名前を変更', run: () => setRenaming(single.key) },
    !favorites && { label: '移動…', run: () => setMoving(keys) },
    selectedMaterials.length > 0 && { label: allFavorite ? 'お気に入りから外す' : 'お気に入りにする', run: () => setFavorite(keys, !allFavorite) },
    { label: '削除', run: () => removeKeys(keys), danger: true },
  ].filter(Boolean);

  const fileField = (
    <input
      ref={fileInput}
      type="file"
      multiple
      accept="audio/*,video/*"
      hidden
      onChange={e => {
        const found = filesFromInput(e.target.files);
        e.target.value = '';
        importFrom(async () => found, favorites ? null : here);
      }}
    />
  );

  // New users see the guide until something is in the library.
  if (empty) {
    return <>{fileField}<Guide onPickFiles={pickFiles} dropProps={dropTarget(null, 'here')} /></>;
  }

  return (
    <main className="page library" onClick={() => { setMenu(null); if (!touch) setSelected(new Set()); }}>
      <header className="masthead">
        <span className="wordmark">Kodama</span>
        <a className="text-button" href="#/guide">使い方</a>
      </header>

      {fileField}

      {materials && !empty && (
        <>
          {activity.totalDays > 0 && <Activity activity={activity} days={days} />}

          <nav className="views" aria-label="表示">
            <a className={`view ${!favorites ? 'on' : ''}`} href="#/">教材</a>
            <a className={`view ${favorites ? 'on' : ''}`} href="#/fav">お気に入り</a>
          </nav>

          <div className="toolbar" onClick={e => e.stopPropagation()}>
            {favorites
              ? <p className="crumbs"><span className="crumb on">お気に入りの教材</span></p>
              : (
                <nav className="crumbs" aria-label="場所">
                  <button className={`crumb ${!here ? 'on' : ''} ${dropOn === 'crumb:' ? 'drop' : ''}`} onClick={() => go('')} {...dropTarget(null, 'crumb:')}>
                    すべての教材
                  </button>
                  {path.map(f => (
                    <span key={f.id} className="crumb-step">
                      <span className="crumb-sep" aria-hidden="true">›</span>
                      <button
                        className={`crumb ${f.id === here ? 'on' : ''} ${dropOn === `crumb:${f.id}` ? 'drop' : ''}`}
                        onClick={() => go(`f/${f.id}`)}
                        {...dropTarget(f.id, `crumb:${f.id}`)}
                      >
                        {f.name}
                      </button>
                    </span>
                  ))}
                </nav>
              )}
            <div className="tools">
              {touch && selectMode && keys.length === 0 ? (
                <>
                  <span className="tool-count">選ぶものをタップ</span>
                  <button className="tool" onClick={() => setSelectMode(false)}>完了</button>
                </>
              ) : keys.length > 0 ? (
                <>
                  <span className="tool-count num">{keys.length}件を選択</span>
                  {actions.map(a => <button key={a.label} className={`tool ${a.danger ? 'danger' : ''}`} onClick={a.run}>{a.label}</button>)}
                  <button className="tool" onClick={() => { setSelected(new Set()); setSelectMode(false); }}>選択を解除</button>
                </>
              ) : (
                <>
                  {!favorites && <button className="tool" onClick={newFolder}><Icon name="folder" size={14} />新規フォルダ</button>}
                  <button className="tool" onClick={pickFiles}><Icon name="audio" size={14} />ファイルを読み込む</button>
                  <a className="tool" href={here && !favorites ? `#/add/ted/${here}` : '#/add/ted'}><Icon name="plus" size={14} />TEDから追加</a>
                  {touch && rows.length > 0 && <button className="tool" onClick={() => setSelectMode(true)}>選択</button>}
                </>
              )}
            </div>
          </div>
          {notice && <p className="notice" role="status">{notice}</p>}

          <ImportPanel items={imports} placeName={placeName} />

          <div
            className={`file-list ${dropOn === 'here' ? 'drop' : ''}`}
            ref={listRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label="教材"
            {...(favorites ? {} : dropTarget(here, 'here'))}
          >
            <div className="file-head" aria-hidden="true">
              <SortHead label="名前" k="name" sort={sort} onSort={changeSort} className="name" />
              <span className="cell kind">種類</span>
              <SortHead label="長さ" k="length" sort={sort} onSort={changeSort} className="length" />
              <SortHead label="最終練習" k="practiced" sort={sort} onSort={changeSort} className="practiced" />
              <span className="cell star-cell" />
            </div>
            {rows.map((row, i) => (
              <FileRow
                key={row.key}
                row={row}
                selected={selected.has(row.key)}
                selectMode={touch && selectMode}
                expanded={row.kind === 'folder' && expanded.has(row.item.id)}
                count={row.kind === 'folder' ? countInside(folders, materials, row.item.id) : 0}
                renaming={renaming === row.key}
                drop={dropOn === row.key}
                draggable={!touch && renaming !== row.key}
                place={favorites && row.item.folderId ? placeName(row.item.folderId) : ''}
                onClick={e => onRowClick(e, row, i)}
                onDoubleClick={() => !touch && open(row)}
                onContextMenu={e => onContextMenu(e, row)}
                onDragStart={e => onDragStart(e, row)}
                dropProps={row.kind === 'folder' ? dropTarget(row.item.id, row.key)
                  : row.depth > 0 ? dropTarget(row.item.folderId, folderKey(row.item.folderId)) : null}
                onToggle={() => toggleExpand(row.item.id)}
                onFavorite={() => setFavorite([row.key], !row.item.favorite)}
                onRename={name => commitRename(row.key, name)}
                onCancelRename={() => setRenaming(null)}
              />
            ))}
            {rows.length === 0 && (
              <p className="empty">
                {favorites
                  ? '教材の ☆ を押すと、ここに集まります。'
                  : touch
                    ? 'このフォルダは空です。「ファイルを読み込む」か「TEDから追加」で入れられます。'
                    : 'このフォルダは空です。ファイルやフォルダをここにドロップするか、「ファイルを読み込む」「TEDから追加」で入れられます。'}
              </p>
            )}
          </div>
        </>
      )}

      {menu && keys.length > 0 && (
        <ul className="context-menu" style={{ left: Math.min(menu.x, innerWidth - 200), top: Math.min(menu.y, innerHeight - 220) }} role="menu"
          onClick={e => e.stopPropagation()}>
          {actions.map(a => (
            <li key={a.label}>
              <button role="menuitem" className={a.danger ? 'danger' : ''} onClick={() => { setMenu(null); a.run(); }}>{a.label}</button>
            </li>
          ))}
        </ul>
      )}

      {moving && (
        <MoveDialog
          folders={folders}
          keys={moving}
          current={here}
          onMove={target => { setMoving(null); moveKeys(moving, target); }}
          onClose={() => setMoving(null)}
        />
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

function SortHead({ label, k, sort, onSort, className }) {
  const on = sort.key === k;
  return (
    <button className={`cell head ${className} ${on ? 'on' : ''}`} onClick={() => onSort(k)}>
      {label}{on && <span className="sort-dir">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );
}

function Thumb({ row }) {
  if (row.kind === 'folder') return <span className="thumb icon-thumb"><Icon name="folder" size={18} /></span>;
  const m = row.item;
  if (m.kind === 'ted' && m.image) {
    return <span className="thumb"><img src={imageUrl(m.image, 120)} alt="" loading="lazy" /></span>;
  }
  return <span className="thumb icon-thumb"><Icon name={m.kind === 'ted' || m.mediaType === 'video' ? 'video' : 'audio'} size={17} /></span>;
}

function FileRow({
  row, selected, selectMode, expanded, count, renaming, drop, draggable, place,
  onClick, onDoubleClick, onContextMenu, onDragStart, dropProps, onToggle, onFavorite, onRename, onCancelRename,
}) {
  const folder = row.kind === 'folder';
  const item = row.item;
  const name = folder ? item.name : item.title;
  const meta = folder
    ? `フォルダ · ${count}項目`
    : [kindLabel(item), fmtTime(item.duration), item.practicedAt ? `${fmtDate(item.practicedAt)}に練習` : '', place].filter(Boolean).join(' · ');
  return (
    <div
      className={`file-row ${selected ? 'selected' : ''} ${drop ? 'drop' : ''}`}
      data-key={row.key}
      role="option"
      aria-selected={selected}
      draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      {...(dropProps ?? {})}
    >
      <span className="cell name" style={{ '--depth': row.depth }}>
        {selectMode && <span className={`check ${selected ? 'on' : ''}`} aria-hidden="true">{selected && <Icon name="check" size={12} />}</span>}
        {folder
          ? (
            <button className={`disclosure ${expanded ? 'open' : ''}`} aria-label={expanded ? '閉じる' : '開く'} aria-expanded={expanded}
              onClick={e => { e.stopPropagation(); onToggle(); }} onDoubleClick={e => e.stopPropagation()}>
              <Icon name="disclosure" size={10} />
            </button>
          )
          : <span className="disclosure" aria-hidden="true" />}
        <Thumb row={row} />
        <span className="name-text">
          {renaming
            ? <NameInput initial={name} onSubmit={onRename} onCancel={onCancelRename} />
            : <span className="file-name">{name}</span>}
          <span className="file-meta">{meta}</span>
        </span>
      </span>
      <span className="cell kind">{folder ? 'フォルダ' : kindLabel(item)}</span>
      <span className="cell length num">{folder ? `${count}項目` : fmtTime(item.duration)}</span>
      <span className="cell practiced num">{!folder && item.practicedAt ? fmtDate(item.practicedAt) : '—'}</span>
      <span className="cell star-cell">
        {!folder && (
          <button className={`star ${item.favorite ? 'on' : ''}`} aria-pressed={!!item.favorite}
            aria-label={item.favorite ? 'お気に入りから外す' : 'お気に入りにする'}
            onClick={e => { e.stopPropagation(); onFavorite(); }} onDoubleClick={e => e.stopPropagation()}>
            <Icon name={item.favorite ? 'starred' : 'star'} size={14} />
          </button>
        )}
      </span>
    </div>
  );
}

function NameInput({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial);
  const ref = useRef(null);
  // Enter, Esc and leaving the field all end editing, but only the first counts.
  const finished = useRef(false);
  const finish = fn => { if (!finished.current) { finished.current = true; fn(); } };
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      className="rename"
      value={name}
      maxLength={120}
      aria-label="名前"
      onChange={e => setName(e.target.value)}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(() => onSubmit(name));
        if (e.key === 'Escape') finish(onCancel);
      }}
      onBlur={() => finish(() => onSubmit(name))}
    />
  );
}

const STAGE = { decode: '音声を読み込み中', model: '文字起こしの準備中（初回のみ）', transcribe: '文字起こし中' };

// What is being read in. Finished files only count; the ones still going (or
// failed) are listed.
function ImportPanel({ items, placeName }) {
  if (!items.length) return null;
  const pending = items.filter(it => it.status === 'waiting' || it.status === 'working');
  const shown = items.filter(it => it.status !== 'done' && it.status !== 'cancelled');
  const done = items.filter(it => it.status === 'done').length;
  const total = items.filter(it => it.status !== 'cancelled').length;
  return (
    <section className="imports" aria-label="読み込み" onClick={e => e.stopPropagation()}>
      <p className="imports-head num">
        {pending.length ? `読み込み中　${done} / ${total}` : `${done}件の読み込みが終わりました`}
        {!pending.length && <button className="link-button" onClick={clearFinished}>閉じる</button>}
      </p>
      {shown.length > 0 && (
        <ol>
          {shown.map(it => {
            const p = it.progress;
            const pct = p?.stage === 'transcribe' && p.total ? p.done / p.total : p?.stage === 'model' && p.total ? p.loaded / p.total : null;
            return (
              <li key={it.id} className={`import ${it.status}`}>
                <span className="import-name">{it.name}<span className="import-place">{placeName(it.folderId)}</span></span>
                <span className="import-status num">
                  {it.status === 'waiting' && '待機中'}
                  {it.status === 'working' && (
                    <>
                      {STAGE[p?.stage] ?? '準備中'}
                      {p?.stage === 'transcribe' && ` ${fmtTime(p.done)} / ${fmtTime(p.total)}`}
                      {p?.stage === 'model' && p.total ? ` ${Math.round(p.loaded / 1e6)} / ${Math.round(p.total / 1e6)} MB` : ''}
                    </>
                  )}
                  {it.status === 'failed' && <span className="warn">{it.error}</span>}
                </span>
                {pending.includes(it) && <button className="quiet-button" onClick={() => cancelImport(it.id)}>取り消す</button>}
                {it.status === 'working' && (
                  <span className="bar"><span style={{ transform: `scaleX(${pct ?? 0})` }} className={pct == null ? 'indeterminate' : ''} /></span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {pending.length > 0 && <p className="field-note">読み込みが終わるまで、このタブは閉じないでください。</p>}
    </section>
  );
}

// Practice over the past year, drawn like GitHub's contribution graph.
const WEEKDAYS = ['', '月', '', '水', '', '金', ''];

// One week = a 9px square column plus a 3px gap; the weekday labels take 18px.
const weeksThatFit = width => Math.max(8, Math.min(53, Math.floor((width - 18 + 3) / 12)));

function Activity({ activity, days }) {
  const { current, best, today } = activity;
  const box = useRef(null);
  // As many weeks as fit: a year on a wide screen, fewer on a phone.
  const [weeks, setWeeks] = useState(53);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setWeeks(weeksThatFit(el.clientWidth));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const cal = useMemo(() => calendar(days, new Date(), weeks), [days, weeks]);
  const span = weeks >= 52 ? 'この1年' : `この${Math.max(1, Math.round((weeks * 7) / 30.4))}か月`;
  return (
    <section className="activity" aria-label="練習の記録">
      <div className="activity-head">
        <div className="streak-figure">
          <span className="big num">{current}</span>
          <span className="unit">日連続</span>
        </div>
        <p className="streak-today num">
          今日 {today.n}文{today.s > 0 && <><span className="sep">·</span>{fmtMinutes(today.s)}</>}
          {best > current && <><span className="sep">·</span>最長 {best}日</>}
        </p>
      </div>
      <div className="heatmap-box" ref={box}>
        <div className="heatmap" style={{ '--weeks': cal.columns.length }}>
          <div className="heatmap-months" aria-hidden="true">
            {cal.months.map(m => <span key={m.column} style={{ gridColumnStart: m.column + 1 }}>{m.label}</span>)}
          </div>
          <div className="heatmap-weekdays" aria-hidden="true">
            {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="heatmap-grid" role="img" aria-label={`${span}で${cal.practiced}日練習`}>
            {cal.columns.flatMap(column => column.map(c => (
              <span key={c.key} className={`day l${c.level} ${c.future ? 'future' : ''}`}
                title={c.future ? undefined : `${c.month}月${c.day}日　${c.n ? `${c.n}文` : '練習なし'}`} />
            )))}
          </div>
          <p className="heatmap-foot">
            <span className="num">{span}で{cal.practiced}日・{cal.sentences.toLocaleString('ja-JP')}文</span>
            <span className="legend" aria-hidden="true">
              少ない{[0, 1, 2, 3, 4].map(l => <span key={l} className={`day l${l}`} />)}多い
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
