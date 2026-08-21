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
