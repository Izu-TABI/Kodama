import { useEffect, useState } from 'react';
import { listMaterials, deleteMaterial } from '../lib/db.js';
import { fmtTime } from '../lib/segments.js';
import { go } from '../App.jsx';
import Icon from '../components/Icon.jsx';

const fmtDate = ts => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export default function Library() {
  const [items, setItems] = useState(null);

  useEffect(() => { listMaterials().then(setItems); }, []);

  async function remove(m) {
    if (!confirm(`「${m.title}」を削除しますか？\n録音も消えます。`)) return;
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
            YouTubeの動画か手持ちの音声を、1文ずつに区切ってシャドーイングできます。
            お手本を流しながら録音して、あとから自分の声と聞き比べます。
          </p>
          <div className="intro-actions">
            <a className="button primary" href="#/add/youtube">YouTubeから追加</a>
            <a className="button" href="#/add/file">音声ファイルから追加</a>
          </div>
        </section>
      )}

      {items?.length > 0 && (
        <ol className="materials">
          {items.map(m => {
            const taken = Object.keys(m.takes || {}).length;
            return (
              <li key={m.id}>
                <button className="material" onClick={() => go(`m/${m.id}`)}>
                  <span className="material-title">{m.title}</span>
                  <span className="material-meta">
                    {m.kind === 'youtube' ? 'YouTube' : m.mediaType === 'video' ? '動画ファイル' : '音声ファイル'}
                    <span className="sep">·</span>{m.segments.length}文
                    <span className="sep">·</span>{fmtTime(m.duration)}
                    {m.practicedAt > 0 && <><span className="sep">·</span>{fmtDate(m.practicedAt)}に練習</>}
                    {taken > 0 && <><span className="sep">·</span>録音 {taken}/{m.segments.length}</>}
                  </span>
                </button>
                <button className="quiet-button" onClick={() => remove(m)} aria-label={`${m.title}を削除`}>削除</button>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
