/**
 * The colours an account or a category may be.
 *
 * A closed set, not free hex. Two reasons, and the second is the real one:
 * every colour here clears 3:1 against the dark card so a dot is never a
 * guess, and a fixed list means the picker, the section header and the
 * rainbow all draw from one place instead of agreeing by coincidence.
 *
 * The values are CalMind's `APP_PALETTES.reminders`, matched deliberately —
 * these two apps sit next to each other on the same phone, and a blue that is
 * nearly the same blue reads as a mistake.
 */
export const PALETTE = [
  '#4c8bf0', // blue
  '#ea5853', // red
  '#66d695', // green
  '#f39849', // orange
  '#9e5ce0', // violet
  '#929aaa', // grey
] as const;

export type PaletteColor = (typeof PALETTE)[number];

/**
 * The anchors of the "everything" rainbow, as an ANGULAR sweep.
 *
 * CalMind's exact conic gradient. Kept here rather than in a component so the
 * picker's dot and any future chart cannot drift apart, and so a native port
 * replaying the spec has the numbers.
 */
export const RAINBOW = ['#60a5fa', '#34d399', '#facc15', '#f472b6', '#60a5fa'] as const;

/**
 * The colour at `t` around that sweep, `t` in [0, 1).
 *
 * Written out rather than delegated to a gradient because there is no conic
 * primitive in SVG and none in React Native at all; the dot is drawn as a
 * ring of slices, and every surface has to compute the same slice colours.
 */
export function rainbowAt(t: number): string {
  const span = RAINBOW.length - 1;
  const seg = Math.min(span - 1, Math.floor(t * span));
  const f = t * span - seg;
  const parse = (c: string): [number, number, number] =>
    [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
  const a = parse(RAINBOW[seg] ?? RAINBOW[0]);
  const b = parse(RAINBOW[seg + 1] ?? RAINBOW[0]);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * f);
  return `rgb(${mix(a[0], b[0])},${mix(a[1], b[1])},${mix(a[2], b[2])})`;
}

/** The next colour for a new section, cycling rather than always blue. */
export function nextColor(used: readonly string[]): string {
  const counts = PALETTE.map((c) => used.filter((u) => u === c).length);
  let best = 0;
  for (let i = 1; i < counts.length; i++) if ((counts[i] ?? 0) < (counts[best] ?? 0)) best = i;
  return PALETTE[best] ?? PALETTE[0];
}
