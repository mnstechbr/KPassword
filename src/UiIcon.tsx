const paths = {
  vault: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
  assistant: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  shield: "m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5z",
  backup: "M7 17H5a4 4 0 0 1-1-8 7 7 0 0 1 13-2 5 5 0 0 1 2 10h-2M12 21V11m-4 4 4-4 4 4",
  settings: "m9 3-1 3-3 1-2 3 2 2-1 3 2 3h3l2 3 3-1 1-3 3-1 2-3-2-2 1-3-2-3h-3l-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
  key: "M14 3a6 6 0 1 1-4 10L3 20v-4l7-7a6 6 0 0 1 4-6M17 7h.01",
  note: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h5",
  card: "M2 5h20v14H2zM2 10h20M6 15h4",
  identity: "M3 4h18v16H3zM8 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4M5 16c0-4 6-4 6 0M14 9h4M14 13h4",
  license: "M6 2h12v14H6zM9 16v6l3-2 3 2v-6M9 6h6M9 10h6",
  copy: "M9 9h12v12H9zM15 9V3H3v12h6",
  edit: "m15 4 5 5M4 20l1-5L17 3l4 4L9 19z",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  menu: "M4 6h16M4 12h16M4 18h16",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11",
  system: "M3 4h18v13H3zM8 21h8M12 17v4",
} as const;

export function UiIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="uiIcon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
