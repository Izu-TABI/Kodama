// A row of options; `disabled` keeps it in place (no selection shown) and `note` says why.
export default function Segmented({ label, value, options, onChange, disabled = false, note }) {
  return (
    <div className={`seg ${disabled ? 'disabled' : ''}`} role="radiogroup" aria-label={label}
      aria-disabled={disabled || undefined} title={disabled ? note : undefined}>
      {label && <span className="seg-label">{label}</span>}
      <div className="seg-options">
        {options.map(([v, text]) => {
          const on = !disabled && value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? 'on' : ''}
              disabled={disabled}
              onClick={e => { onChange(v); e.currentTarget.blur(); }}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
