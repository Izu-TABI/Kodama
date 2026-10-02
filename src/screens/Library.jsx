import { useEffect, useState } from 'react';
import { listMaterials, deleteMaterial } from '../lib/db.js';
import { fmtTime } from '../lib/segments.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';

const SOURCE_LABEL = { youtube: 'YouTube', ted: 'TED' };

const fmtDate = ts => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export default function Library() {
  const [items, setItems] = useState(null);

  useEffect(() => { listMaterials().then(setItems); }, []);

  async function remove(m) {
    if (!confirm(`「${m.title}」を削除しますか？`)) return;
    await deleteMaterial(m.id);
    setItems(await listMaterials());
  }

  return (
    <main className="page library">
      <header className="masthead">
        <span className="wordmark">Shadowing</span>
        {items?.length > 0 && (
          <a className="text-button" href="#/add"><Icon name="plus" size={14} />教材を追加</a>
        )}
      </header>

      {items && items.length === 0 && (
        <section className="intro">
          <h1>聞こえた英語を、すぐ後ろから追いかける。</h1>
          <p>
            YouTubeやTEDの動画、手持ちの音声を1文ずつに区切ってシャドーイングできます。
            字幕は自動で取り込み、英文を隠したり、速度を変えたり、1文をくり返したりしながら練習できます。
          </p>
          <div className="intro-actions">
            <a className="button primary" href="#/add/url">YouTube・TEDから追加</a>
            <a className="button" href="#/add/file">音声ファイルから追加</a>
          </div>
        </section>
      )}

      {items?.length > 0 && (
        <ol className="materials">
          {items.map(m => (
            <li key={m.id}>
              <button className="material" onClick={() => go(`m/${m.id}`)}>
                <span className="material-title">{m.title}</span>
                <span className="material-meta">
                  {SOURCE_LABEL[m.kind] || (m.mediaType === 'video' ? '動画ファイル' : '音声ファイル')}
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
    </main>
  );
}
