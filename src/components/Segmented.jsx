export default function Segmented({ label, value, options, onChange }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {label && <span className="seg-label">{label}</span>}
      <div className="seg-options">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={value === v ? 'on' : ''}
            onClick={e => { onChange(v); e.currentTarget.blur(); }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
