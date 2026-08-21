/**
 * A round switch, used by the header and by the add form.
 *
 * Shared rather than copied because there are now two of them on two screens,
 * and a control that is 44 points in one place and 40 in another is exactly
 * the drift this project keeps a single theme file to avoid.
 *
 * Drawn at TAP, never padded up to it: `hitSlop` is a no-op under
 * react-native-web, so a control is precisely as big as it is drawn in a
 * browser and bigger on native. The web is the size that has to be right.
 */
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { T, TAP } from './theme';

export function Toggle({ label, on, onPress, accessibilityLabel, testID, style, children }: {
  label?: string;
  on: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
  style?: ViewStyle | undefined;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.toggle, on && styles.toggleOn, style]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {children ?? <Text style={[styles.text, on && styles.textOn]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: TAP, height: TAP, borderRadius: TAP / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  toggleOn: { backgroundColor: T.accent, borderColor: T.accent },
  text: { color: T.dim, fontSize: 15, fontWeight: '600' },
  textOn: { color: '#ffffff' },
});
