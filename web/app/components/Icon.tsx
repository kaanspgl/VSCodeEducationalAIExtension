const PATHS = {
  play: "m7 5 10 7-10 7V5Z",
  send: "m4 4 16 8-16 8 3-8-3-8Zm3 8h9",
  plus: "M12 5v14M5 12h14",
  folder: "M3 7h7l2 2h9v10H3V7Z",
  chart: "M5 19v-6m7 6V5m7 14v-9",
  close: "m6 6 12 12M18 6 6 18",
  chevron: "m9 5 7 7-7 7",
  down: "M12 5v14m-6-6 6 6 6-6",
  exit: "M14 4h5v16h-5M10 8l-4 4 4 4m-4-4h9",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
  check: "m5 12 5 5 9-10",
  terminal: "M4 5h16v14H4V5Zm3 4 3 3-3 3m5 0h5",
  chat: "M4 5h16v11H9l-5 4V5Z",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  up: "M12 19V5m-6 6 6-6 6 6",
  diff: "M8 4v10m-4-6h8M16 10v10m-4-4h8",
} as const;

/** Small line icons drawn inline, so nothing is fetched (the platform also runs on a closed lab network). */
export function Icon({ name, size = 14 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
