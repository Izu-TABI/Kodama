import { useEffect, useState } from 'react';
import { canMoveInto, sortItems } from '../lib/tree.js';
import Icon from './Icon.jsx';

// Pick where the selected items go: the top level or any folder they may move into.
export default function MoveDialog({ folders, keys, current, onMove, onClose }) {
  const [target, setTarget] = useState(current);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = [];
  const walk = (parentId, depth) => {
    for (const f of sortItems(folders.filter(x => x.parentId === parentId))) {
      rows.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);

  return (
    <div className="dialog-backdrop" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="移動先" onClick={e => e.stopPropagation()}>
        <p className="dialog-title">{keys.length}件の移動先</p>
        <ul className="dialog-tree">
          <li>
            <button className={`tree-item ${target === null ? 'on' : ''}`} onClick={() => setTarget(null)} onDoubleClick={() => onMove(null)}>
              すべての教材
            </button>
          </li>
          {rows.map(({ folder, depth }) => {
            const allowed = canMoveInto(folders, keys, folder.id);
            return (
              <li key={folder.id}>
                <button
                  className={`tree-item ${target === folder.id ? 'on' : ''}`}
                  style={{ '--depth': depth }}
                  disabled={!allowed}
                  onClick={() => setTarget(folder.id)}
                  onDoubleClick={() => onMove(folder.id)}
                >
                  <Icon name="folder" size={14} />{folder.name}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>キャンセル</button>
          <button className="button primary" onClick={() => onMove(target)}>ここに移動</button>
        </div>
      </div>
    </div>
  );
}
