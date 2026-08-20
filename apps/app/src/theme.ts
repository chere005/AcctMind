/**
 * One palette, six surfaces.
 *
 * Values only — no logic, and nothing platform-specific. A screen that wants
 * a colour asks here so that the phone, the browser and the desktop shells
 * cannot drift apart one hex code at a time.
 */
export const T = {
  bg: '#111111',
  card: '#1c1c1e',
  cardEdge: '#2c2c2e',
  field: '#000000',
  text: '#f2f2f7',
  dim: '#8e8e93',
  faint: '#48484a',
  accent: '#0a84ff',
  danger: '#ff453a',
  /** Money in: the ledger's only other colour with a meaning. */
  positive: '#30d158',
} as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/**
 * The smallest a control may be drawn, in points.
 *
 * 44 is Apple's figure and the one CalMind settled on after `hitSlop` turned
 * out to be a no-op under react-native-web — a control is exactly as big as
 * it is drawn in a browser, and bigger on native, so the web is the size
 * that has to be right.
 */
export const TAP = 44;
