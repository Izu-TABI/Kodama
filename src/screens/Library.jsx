import { useEffect, useState } from 'react';
import { listMaterials, deleteMaterial, listFavorites } from '../lib/db.js';
import { readActivity, summarize } from '../lib/activity.js';
import { fmtTime } from '../lib/segments.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Segmented from '../components/Segmented.jsx';

const fmtDate = ts => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const fmtMinutes = s => (s < 60 ? `${Math.round(s)}秒` : `${Math.round(s / 60)}分`);

export default function Library() {
  const [items, setItems] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [tab, setTab] = useState('materials');
  const [activity, setActivity] = useState(() => summarize(readActivity().days));

  useEffect(() => {
    listMaterials().then(setItems);
    listFavorites().then(setFavorites);
    const refresh = () => setActivity(summarize(readActivity().days));
    addEventListener('shadowing:activity', refresh);
    addEventListener('focus', refresh);
    return () => { removeEventListener('shadowing:activity', refresh); removeEventListener('focus', refresh); };
  }, []);

  async function remove(m) {
    if (!confirm(`「${m.title}」を削除しますか？\n録音とお気に入りも消えます。`)) return;
    await deleteMaterial(m.id);
    setItems(await listMaterials());
    setFavorites(await listFavorites());
  }

  return (
    <main className="page library">
      <header className="masthead">
        <span className="wordmark">Shadowing</span>
        {items?.length > 0 && (
          <a className="text-button" href="#/add/ted"><Icon name="plus" size={14} />教材を追加</a>
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
          <div className="library-tabs">
            <Segmented
              value={tab}
              options={[['materials', `教材 ${items.length}`], ['favorites', `お気に入り ${favorites.length}`]]}
              onChange={setTab}
            />
          </div>

          {tab === 'materials' && (
            <ol className="materials">
              {items.map(m => (
                <li key={m.id}>
                  <button className="material" onClick={() => go(`m/${m.id}`)}>
                    <span className="material-title">{m.title}</span>
                    <span className="material-meta">
                      {m.kind === 'ted' ? 'TED' : m.mediaType === 'video' ? '動画ファイル' : '音声ファイル'}
                      {m.author && <><span className="sep">·</span>{m.author}</>}
                      <span className="sep">·</span>{m.segments.length}文
                      <span className="sep">·</span>{fmtTime(m.duration)}
                      {m.practicedAt > 0 && <><span className="sep">·</span>{fmtDate(m.practicedAt)}に練習</>}
                    </span>
                  </button>
                  <button className="quiet-button" onClick={() => remove(m)} aria-label={`${m.title}を削除`}>削除</button>
                </li>
              ))}
            </ol>
          )}

          {tab === 'favorites' && (
            favorites.length === 0
              ? <p className="empty">練習中の文の「お気に入り」を押すと、ここに集まります。</p>
              : <ol className="favorites">
                  {favorites.map(f => (
                    <li key={`${f.material.id}:${f.index}`}>
                      <button className="favorite" onClick={() => go(`m/${f.material.id}/${f.index}`)}>
                        <span className="favorite-text">{f.segment.text}</span>
                        {(f.segment.ja || f.segment.mt) && <span className="favorite-ja">{f.segment.ja || f.segment.mt}</span>}
                        <span className="favorite-source">{f.material.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
          )}
        </>
      )}

      <footer className="credits">
        <p>
          TEDのトークは、TEDがCC BY-NC-ND 4.0で公開している動画と字幕を、TEDの配信からそのまま再生しています。このアプリはTEDとは関係ありません。
          英和辞書はEJDict-hand（パブリックドメイン）を使っています。
        </p>
        <p>教材・録音・練習の記録は、このブラウザの中にだけ保存されます。</p>
      </footer>
    </main>
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
