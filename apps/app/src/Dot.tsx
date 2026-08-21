/**
 * The picker's face: one colour when one thing is selected, the full rainbow
 * when everything is.
 *
 * CalMind's rule and CalMind's exact conic sweep, rendered the same way it is
 * there — SVG, 48 interpolated slices. This was 24 rotated Views for a while,
 * to avoid a dependency; that was optimising for the wrong thing. The whole
 * point of the mark is that it matches the app sitting next to it on the same
 * phone, and "close enough" is precisely what fails that.
 */
import Svg, { Circle, Path } from 'react-native-svg';
import { rainbowAt } from '@acctmind/core';
import { T } from './theme';

/** 48 slices: indistinguishable from a gradient at dot size, on every surface. */
const SLICES = 48;

export function Dot({ colors, size = 16, testID }: {
  colors: readonly string[];
  size?: number;
  testID?: string | undefined;
}) {
  const r = size / 2;

  // No colours at all is not an error — a section with nothing in it yet.
  const one = colors.length === 0 ? T.faint : colors.length === 1 ? colors[0] : null;
  if (one !== undefined && one !== null) {
    return (
      <Svg width={size} height={size} testID={testID}>
        <Circle cx={r} cy={r} r={r} fill={one} />
      </Svg>
    );
  }

  // Several: a pie of every colour, which with everything on is the rainbow.
  const slice = (i: number, n: number, fill: string) => {
    // The seams overlap by a hair. Without it, antialiasing leaves a paler
    // hairline between every pair of slices and the dot looks cross-hatched.
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2 - 0.02;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2 + 0.02;
    const d = `M ${r} ${r} L ${r + r * Math.cos(a0)} ${r + r * Math.sin(a0)} `
      + `A ${r} ${r} 0 0 1 ${r + r * Math.cos(a1)} ${r + r * Math.sin(a1)} Z`;
    return <Path key={i} d={d} fill={fill} />;
  };

  const n = colors.length >= 6 ? SLICES : colors.length;
  return (
    <Svg width={size} height={size} testID={testID}>
      {Array.from({ length: n }, (_, i) =>
        slice(i, n, n === SLICES ? rainbowAt((i + 0.5) / n) : (colors[i] ?? T.faint)))}
    </Svg>
  );
}

/** Every colour there is — what "all of them" looks like. */
export function RainbowDot({ size = 16, testID }: { size?: number; testID?: string }) {
  const r = size / 2;
  return (
    <Svg width={size} height={size} testID={testID}>
      {Array.from({ length: SLICES }, (_, i) => {
        const a0 = (i / SLICES) * 2 * Math.PI - Math.PI / 2 - 0.02;
        const a1 = ((i + 1) / SLICES) * 2 * Math.PI - Math.PI / 2 + 0.02;
        const d = `M ${r} ${r} L ${r + r * Math.cos(a0)} ${r + r * Math.sin(a0)} `
          + `A ${r} ${r} 0 0 1 ${r + r * Math.cos(a1)} ${r + r * Math.sin(a1)} Z`;
        return <Path key={i} d={d} fill={rainbowAt((i + 0.5) / SLICES)} />;
      })}
    </Svg>
  );
}
