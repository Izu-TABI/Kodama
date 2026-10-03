import { useEffect, useRef, useState } from 'react';
import { backupContents, backupName, decodeBackup, makeBackup, restoreBackup } from '../lib/backup.js';

const fmtSize = b => (b >= 1e9 ? `${(b / 1e9).toFixed(1)}GB` : b >= 1e6 ? `${Math.round(b / 1e6)}MB` : `${Math.max(1, Math.round(b / 1e3))}KB`);

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const resultText = ({ added, updated }) =>
  added && updated ? `読み込みました。教材が${added}件増え、${updated}件が新しくなりました。`
    : added ? `読み込みました。教材が${added}件増えました。`
      : updated ? `読み込みました。教材${updated}件が新しくなりました。`
        : '読み込みました。新しく加わる教材はありませんでした。';

// Writing everything to one file, and reading such a file back in.
// onClose(changed): changed is true once a backup has been read in.
export default function BackupDialog({ onClose }) {
  const [contents, setContents] = useState(null);
  const [withFiles, setWithFiles] = useState(true);
  const [writing, setWriting] = useState(false);
  const [picked, setPicked] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const input = useRef(null);
  const busy = writing || progress != null;
  const close = () => { if (!busy) onClose(result != null); };

  useEffect(() => { backupContents().then(setContents).catch(() => setContents({ materials: 0, files: 0, bytes: 0 })); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  async function write() {
    setWriting(true);
    setError('');
    try {
      download(await makeBackup({ withFiles: withFiles && contents?.files > 0 }), backupName());
    } catch {
      setError('書き出せませんでした。');
    }
    setWriting(false);
  }

  async function pick(file) {
    setError('');
    setResult(null);
    try {
      setPicked({ ...(await decodeBackup(file)), name: file.name });
    } catch (e) {
      setError(`${e.message}。`);
    }
  }

  async function read() {
    setProgress({ done: 0, total: picked.parts.length });
    try {
      setResult(await restoreBackup(picked, (done, total) => setProgress({ done, total })));
      setPicked(null);
    } catch {
      setError('読み込めませんでした。');
    }
    setProgress(null);
  }

  const files = picked?.parts.length ?? 0;
  return (
    <div className="dialog-backdrop" onClick={e => { e.stopPropagation(); close(); }}>
      <div className="dialog backup" role="dialog" aria-modal="true" aria-label="バックアップ" onClick={e => e.stopPropagation()}>
        <p className="dialog-title">バックアップ</p>

        <section className="backup-part">
          <h3>書き出す</h3>
          <p>教材、フォルダ、和訳、練習の記録、設定を1つのファイルにまとめて保存します。</p>
          {contents?.files > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={withFiles} onChange={e => setWithFiles(e.target.checked)} />
              音声・動画のファイルと録音も含める（合計{fmtSize(contents.bytes)}）
            </label>
          )}
          <button className="button" onClick={write} disabled={busy || !contents}>{writing ? '書き出しています…' : '書き出す'}</button>
        </section>

        <section className="backup-part">
          <h3>読み込む</h3>
          <p>バックアップのファイルから、教材などを戻します。いまある教材は消えません。</p>
          <input ref={input} type="file" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f); }} />
          {picked ? (
            <>
              <p className="backup-summary num">
                このファイルには、教材{picked.header.materials.length}件とフォルダ{picked.header.folders.length}件が入っています。
                {files > 0 && `音声と録音も${files}件あります。`}
              </p>
              <div className="backup-actions">
                <button className="button" onClick={() => setPicked(null)} disabled={busy}>やめる</button>
                <button className="button primary" onClick={read} disabled={busy}>読み込む</button>
              </div>
            </>
          ) : (
            <button className="button" onClick={() => input.current.click()} disabled={busy}>ファイルを選ぶ</button>
          )}
          {progress && <p className="backup-summary num" role="status">読み込んでいます…　{progress.done} / {progress.total}</p>}
          {result && (
            <p className="backup-summary" role="status">
              {resultText(result)}
            </p>
          )}
        </section>

        {error && <p className="field-note warn" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button" onClick={close} disabled={busy}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
