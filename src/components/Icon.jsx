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
  folder: <path d="M1.75 3.25h4.5l1.5 1.75h6.5v7.75H1.75z" {...line} strokeWidth="1.3" strokeLinejoin="round" />,
  audio: <path d="M3 7v2M5.25 5v6M7.5 2.75v10.5M9.75 5.5v5M12 7v2" {...line} strokeWidth="1.4" strokeLinecap="round" />,
  video: <><rect x="1.75" y="3.25" width="12.5" height="9.5" {...line} strokeWidth="1.3" /><path d="M6.5 6v4l3.5-2z" /></>,
  disclosure: <path d="M6 4l4.5 4L6 12z" />,
  check: <path d="M3.5 8.5l3 3 6-7" {...line} strokeWidth="1.7" />,
  more: <><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></>,
  moon: <path d="M13.31 9.42A5.5 5.5 0 1 1 6.58 2.69 4.8 4.8 0 0 0 13.31 9.42z" {...line} strokeWidth="1.3" strokeLinejoin="round" />,
  sun: <><circle cx="8" cy="8" r="2.9" {...line} strokeWidth="1.3" /><path d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.33 3.33l1.21 1.21M11.46 11.46l1.21 1.21M3.33 12.67l1.21-1.21M11.46 4.54l1.21-1.21" {...line} strokeWidth="1.3" strokeLinecap="round" /></>,
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
