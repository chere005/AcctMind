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
  /**
   * A row divider, and nothing else.
   *
   * `cardEdge` is a BORDER — it draws the edge of a control, where the eye
   * expects a line. Between two rows of a list a line that strong reads as a
   * table, which is why CalMind carries `lineSoft` (#262626) separately from
   * `line` (#333333) and uses the soft one for every row. Copied at the same
   * value, because these two apps sit on the same phone.
   */
  lineSoft: '#262626',
  /**
   * Section names, and only section names.
   *
   * CalMind's `gold`, at its exact value. A section head is not a row and
   * should not be read as one — it is the label over a group, and in a ledger
   * of grey names and green-or-white amounts, the one warm colour on the
   * screen is what makes the groups findable at a glance. Grey headings over
   * grey rows is what "looks terrible" looked like.
   */
  gold: '#f0b429',
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
