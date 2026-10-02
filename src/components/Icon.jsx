// In-house monochrome icons, drawn on a 16px grid.
const paths = {
  play: <path d="M4 2.5v11l9-5.5z" />,
  record: <circle cx="8" cy="8" r="5" />,
  stop: <rect x="3.5" y="3.5" width="9" height="9" />,
  prev: <path d="M10.5 2.5 5 8l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  next: <path d="M5.5 2.5 11 8l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  back: <path d="M7 3 2 8l5 5M2.5 8H14" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  plus: <path d="M8 2.5v11M2.5 8h11" fill="none" stroke="currentColor" strokeWidth="1.5" />,
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
