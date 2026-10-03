// In-house monochrome icons, drawn on a 16px grid.
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };
const paths = {
  play: <path d="M4 2.5v11l9-5.5z" />,
  record: <circle cx="8" cy="8" r="5" />,
  stop: <rect x="3.5" y="3.5" width="9" height="9" />,
  prev: <path d="M10.5 2.5 5 8l5.5 5.5" {...line} strokeWidth="1.6" />,
  next: <path d="M5.5 2.5 11 8l-5.5 5.5" {...line} strokeWidth="1.6" />,
  back: <path d="M7 3 2 8l5 5M2.5 8H14" {...line} />,
  plus: <path d="M8 2.5v11M2.5 8h11" {...line} />,
  star: <path d="M8 1.8l1.85 3.95 4.3.5-3.2 2.95.85 4.25L8 11.3l-3.8 2.15.85-4.25-3.2-2.95 4.3-.5z" {...line} strokeWidth="1.3" strokeLinejoin="round" />,
  starred: <path d="M8 1.8l1.85 3.95 4.3.5-3.2 2.95.85 4.25L8 11.3l-3.8 2.15.85-4.25-3.2-2.95 4.3-.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />,
  out: <path d="M6 3H3v10h10v-3M9 2.5h4.5V7M13.5 2.5 7.5 8.5" {...line} strokeWidth="1.3" />,
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
