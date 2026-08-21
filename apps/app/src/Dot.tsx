/**
 * The picker's face: one colour when one thing is selected, the full rainbow
 * when everything is.
 *
 * CalMind's rule and CalMind's exact conic sweep, drawn without SVG — this
 * project has no vector dependency and one dot does not justify adding one.
 * The rainbow is a ring of thin absolutely-positioned slivers, which at dot
 * size is indistinguishable from a gradient and renders identically on the
 * web, a phone and a Mac.
 */
import { StyleSheet, View } from 'react-native';
import { rainbowAt } from '@acctmind/core';
import { T } from './theme';

const SLICES = 24;

export function Dot({ colors, size = 16, testID }: {
  colors: readonly string[];
  size?: number;
  testID?: string | undefined;
}) {
  const r = size / 2;
  // No colours at all is not an error — a section with nothing in it yet.
  if (colors.length === 0) {
    return <View testID={testID} style={[dotBase(size), { backgroundColor: T.faint }]} />;
  }
  if (colors.length === 1) {
    return <View testID={testID} style={[dotBase(size), { backgroundColor: colors[0] }]} />;
  }
  return (
    <View testID={testID} style={[dotBase(size), styles.clip]}>
      {Array.from({ length: SLICES }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: r, top: 0, width: r, height: size,
            backgroundColor: colors.length >= SLICES / 2
              ? rainbowAt((i + 0.5) / SLICES)
              : colors[i % colors.length],
            transform: [
              { translateX: -r }, { rotate: `${(i * 360) / SLICES}deg` }, { translateX: r },
            ],
          }}
        />
      ))}
    </View>
  );
}

/** Every colour there is — what "all of them" looks like. */
export function RainbowDot({ size = 16, testID }: { size?: number; testID?: string }) {
  return <Dot colors={Array.from({ length: SLICES }, (_, i) => rainbowAt(i / SLICES))} size={size} testID={testID} />;
}

const dotBase = (size: number) => ({ width: size, height: size, borderRadius: size / 2 });
const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
