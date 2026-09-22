/**
 * The tab bar's marks, drawn rather than typed.
 *
 * Emoji would be one line each and are not an option: the same glyph is a
 * different picture on a phone, in Safari and in the desktop shell, and two
 * of the six surfaces draw some of them in monochrome. CalMind draws its tab
 * icons as SVG for exactly this reason and this bar sits next to it.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { T } from './theme';

/** Budget: a ring with one slice filled — a category taking its share. */
export function BudgetIcon({ color = T.dim, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} fill="none" />
      {/* A third of the pie, filled. It had a hole punched in the middle at
          first, which at 22 points read as a bite taken out of a circle
          rather than as a share of one. */}
      <Path d="M12 12 L12 3 A9 9 0 0 1 19.79 16.5 Z" fill={color} />
    </Svg>
  );
}

/** Transactions: rows in a ledger. */
export function ListIcon({ color = T.dim, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {[6, 12, 18].map((y) => (
        <Rect key={y} x={3} y={y - 1.25} width={18} height={2.5} rx={1.25} fill={color} />
      ))}
    </Svg>
  );
}

/**
 * A stroked cross.
 *
 * Not a `+` in a Text: the line box reserves descender space a plus never
 * uses, so it sits a couple of points below the centre of a round button —
 * CalMind measured 2.56px on a 44pt one, which is the most visible place in
 * either app to get it wrong. A path has no baseline to be low against.
 */
export function PlusMark({ color = '#ffffff', size = 26 }: { color?: string; size?: number }) {
  const half = size / 2;
  const arm = size * 0.32;
  return (
    <Svg width={size} height={size}>
      <Path
        d={`M${half - arm} ${half} H${half + arm} M${half} ${half - arm} V${half + arm}`}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ *
 * Row controls.
 *
 * Drawn rather than typed, and this is where it matters most: these sit in a
 * 30-point circle, where a text glyph's baseline offset is a visible fraction
 * of the button. `✎` and `⧉` also render as two different pictures across the
 * six surfaces, and one of them is monochrome on a phone and colour on the
 * web.
 * ------------------------------------------------------------------ */

/** Edit: a pencil. */
export function PencilIcon({ color = T.text, size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 20 L4 16 L16 4 L20 8 L8 20 Z M14 6 L18 10"
        stroke={color} strokeWidth={2} fill="none"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Duplicate: one card behind another. */
export function DuplicateIcon({ color = T.text, size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={3} width={13} height={13} rx={2.5} stroke={color} strokeWidth={2} fill="none" />
      <Rect x={8} y={8} width={13} height={13} rx={2.5} stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  );
}

/** Copy: a clipboard, because the destination is the system clipboard. */
export function ClipboardIcon({ color = T.text, size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={4} width={16} height={18} rx={2.5} stroke={color} strokeWidth={2} fill="none" />
      <Rect x={8.5} y={1.5} width={7} height={5} rx={1.5} fill={color} />
    </Svg>
  );
}

/** Delete: a cross. */
export function XIcon({ color = '#ffffff', size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M6 6 L18 18 M18 6 L6 18"
        stroke={color} strokeWidth={2.5} strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Import: an arrow going INTO a tray.
 *
 * Deliberately the mirror of `ShareIcon`'s arrow-leaving-a-box, because the
 * two sit in the same bar and the direction is the only thing telling them
 * apart at 15 points.
 */
export function ImportIcon({ color = T.text, size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3v11" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M7.5 9.5 12 14l4.5-4.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 17v2.5h16V17" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Settings: a cog — Sean, 2026-09-21, replacing the hamburger he asked for
 * half a minute earlier. A hamburger says "more of the same list"; a cog
 * says "things about the app", which is what is behind it.
 *
 * EIGHT TEETH AS ONE PATH, not eight rotated rectangles. A cog drawn as
 * separate shapes has eight seams where the tooth meets the ring, and at 18
 * points a hairline seam is a visible notch on a dark background — the tab
 * icons in this file avoid the same thing by never abutting two fills.
 */
export function CogIcon({ color = T.text, size = 18 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.9 7.9 0 0 0-1.7-1L15 3.2h-4l-.3 2.6a7.9 7.9 0 0 0-1.7 1l-2.4-1-2 3.5L6.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.9 7.9 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.9 7.9 0 0 0 1.7-1l2.4 1 2-3.5z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={13} cy={12} r={2.6} stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

/**
 * Reconcile: a hammer. Sean's pick, 2026-09-15.
 *
 * Drawn as a head and a handle rather than a glyph, for the reason every icon
 * in this file is: no single character renders as a hammer across a browser,
 * a phone and a Mac, and the ones that come close fall back to a box on at
 * least one of them.
 */
export function HammerIcon({ color = T.dim, size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* The head, struck through at an angle so it reads at 14 points. */}
      <Path
        d="M3.5 9.5 9 4l3 3-5.5 5.5z"
        stroke={color} strokeWidth={2} strokeLinejoin="round"
      />
      {/* The handle. */}
      <Path
        d="M10.5 10.5 20 20"
        stroke={color} strokeWidth={2} strokeLinecap="round"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ *
 * The Budget tab's four money columns.
 *
 * Words, until 2026-09-15. At 56 points a column — which is what four money
 * columns plus a checkbox leave on a phone — `BUDGETED` and `AVAILABLE` broke
 * mid-word and drew as `BUDGETE / D` and `AVAILABL / E`. A header that has to
 * be deciphered is worse than no header, and shortening them to `BUD` and
 * `AVL` trades one unreadable thing for another.
 *
 * So: four marks, each about what its column MEANS rather than what it is
 * called, and each legible at 13 points where the words were not.
 * ------------------------------------------------------------------ */

/**
 * Needs — a FLAG. What the line is aiming at.
 *
 * A target (concentric circles) was the first pick and it was the wrong one:
 * at 13 points the inner ring closes up and it reads as a filled dot, which
 * is what the colour dots beside a category name already are. A flag has a
 * diagonal nobody else here has, so it is told apart by silhouette rather
 * than by detail — the only thing that survives at this size.
 */
/**
 * Bring this UP to what has moved — the pick bar's third button.
 *
 * A plain arrow rather than a copy of `ReceiptIcon`, which is what the SPENT
 * column wears. The button is not "spent"; it is "make assigned equal it",
 * and drawing it with the column's own mark would read as a filter.
 */
export function UpArrowIcon({ color = T.dim, size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 20V5" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path
        d="M5.5 11.5 12 5l6.5 6.5"
        stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  );
}

export function FlagIcon({ color = T.dim, size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5.5 21V3.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M5.5 4.5h13l-3 4 3 4h-13z"
        fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Budgeted — an envelope, which is where the whole method comes from.
 *
 * Kept from the first pass: a wide rectangle with a V in it is unlike
 * anything else in this row at any size.
 */
export function EnvelopeIcon({ color = T.dim, size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18v12H3z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path d="m3.5 6.5 8.5 6.5 8.5-6.5" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Spent — a RECEIPT. Money that has already gone, and the paper that says so.
 *
 * Third attempt. An up-arrow competed with the chevron on the category
 * heading two lines above it; a shopping bag, blown up, read as a TRASH CAN —
 * which is the worst possible confusion to put one column away from a delete
 * button. A receipt's torn bottom edge is a shape nothing else here has.
 */
export function ReceiptIcon({ color = T.dim, size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5.5 3h13v18l-2.2-1.6-2.2 1.6-2.1-1.6L9.9 21l-2.2-1.6L5.5 21z"
        stroke={color} strokeWidth={2} strokeLinejoin="round"
      />
      <Path d="M9 8h6M9 12h6" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * Available — a COIN. What is still there.
 *
 * Third attempt here too. A wallet was a rounded rectangle with a dot and so
 * was indistinguishable from the envelope beside it; a stack of coins, blown
 * up, was the standard DATABASE cylinder. A ring with a bar through it is
 * round where its three neighbours are angular, which is the only thing that
 * survives at 14 points — and it is the one shape here that is a coin whether
 * or not you work out the bar is a dollar sign.
 */
export function CoinIcon({ color = T.dim, size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={2} />
      <Path d="M12 7.5v9" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M14.2 10a2.4 2.4 0 0 0-2.2-1.2c-1.4 0-2.4.8-2.4 1.9s1 1.6 2.4 1.6 2.4.5 2.4 1.6-1 1.9-2.4 1.9A2.4 2.4 0 0 1 9.8 14"
        stroke={color} strokeWidth={1.7} strokeLinecap="round"
      />
    </Svg>
  );
}
