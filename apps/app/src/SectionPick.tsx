/**
 * The section picker: CalMind's round colour button, dropping a menu of
 * everything with All at the top.
 *
 * One component for both tabs — Accounts on Transactions, Categories on
 * Budget — because they are the same gesture on the same shape of record,
 * and two copies would drift the moment one of them got a feature.
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dot, RainbowDot } from './Dot';
import { SPACE, T, TAP } from './theme';

export type Section = { id: string; name: string; color: string };

export function SectionPick({
  label, sections, value, onPick, visible, onOpen, onClose, onManage, compact = false,
}: {
  /** What these sections are called, for the All row and the screen reader. */
  label: string;
  sections: readonly Section[];
  /** The selected section id, or null for all of them. */
  value: string | null;
  onPick: (id: string | null) => void;
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The last row of the menu, exactly as the suite's folder pick has it. */
  onManage: () => void;
  /**
   * The top bar's face: the dot in a ring, with no name beside it.
   *
   * CalMind's folder picker is exactly this — a ringed circle in the bar —
   * and the bar has no room for a name next to four other controls on a
   * phone. Which section is chosen is still legible from the list itself,
   * which shows that section and no other.
   */
  compact?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const active = sections.find((s) => s.id === value) ?? null;

  return (
    <>
      <Pressable
        onPress={onOpen}
        style={compact ? styles.hit : styles.button}
        accessibilityRole="button"
        accessibilityLabel={active === null ? `All ${label}` : active.name}
        testID="section-pick"
      >
        {compact ? (
          // 44 to press, 32 to look at — see TopBar for why the two differ.
          <View style={styles.ring}>
            {active === null
              ? <RainbowDot size={18} testID="section-dot" />
              : <Dot colors={[active.color]} size={18} testID="section-dot" />}
          </View>
        ) : (
          <>
            {/* One section shows its colour; all of them show the rainbow. */}
            {active === null
              ? <RainbowDot size={18} testID="section-dot" />
              : <Dot colors={[active.color]} size={18} testID="section-dot" />}
            <Text style={styles.buttonText} numberOfLines={1} testID="section-pick-label">
              {active === null ? `All ${label}` : active.name}
            </Text>
            <Text style={styles.chev}>⌄</Text>
          </>
        )}
      </Pressable>

      {visible && (
        <Modal transparent animationType="fade" onRequestClose={onClose}>
          {/* Its own window: the app's safe area does not reach in here. */}
          <Pressable style={styles.backdrop} onPress={onClose} testID="section-menu-backdrop">
            <Pressable style={[styles.menu, { marginTop: insets.top + TAP }]} onPress={() => {}}>
              <ScrollView>
                <Row
                  name={`All ${label}`}
                  on={value === null}
                  onPress={() => { onPick(null); onClose(); }}
                  testID="section-all"
                >
                  <RainbowDot size={16} />
                </Row>
                {sections.map((s) => (
                  <Row
                    key={s.id}
                    name={s.name}
                    on={value === s.id}
                    onPress={() => { onPick(s.id); onClose(); }}
                    testID={`section-${s.id}`}
                  >
                    <Dot colors={[s.color]} size={16} />
                  </Row>
                ))}
                {/* Last, and the only way in: accounts and categories are
                    made on the manage screen, so there is one place that
                    knows how to name and colour one. */}
                <Pressable
                  onPress={() => { onClose(); onManage(); }}
                  style={[styles.row, styles.manage]}
                  testID="section-manage"
                >
                  <Text style={styles.manageText}>Manage {label}</Text>
                </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

function Row({ name, on, onPress, testID, children }: {
  name: string; on: boolean; onPress: () => void; testID: string; children: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={styles.row} testID={testID}>
      {children}
      <Text style={[styles.rowText, on && styles.rowOn]} numberOfLines={1}>{name}</Text>
      {on && <Text style={styles.tick}>✓</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    minHeight: TAP, paddingRight: SPACE.sm,
  },
  buttonText: { color: T.text, fontSize: 15, fontWeight: '600', maxWidth: 160 },
  hit: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    backgroundColor: T.card, alignItems: 'center', justifyContent: 'center',
  },
  chev: { color: T.dim, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#00000088' },
  menu: {
    marginHorizontal: SPACE.lg, maxHeight: 420, borderRadius: 14,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    minHeight: TAP, paddingHorizontal: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  rowText: { color: T.text, fontSize: 16, flex: 1 },
  rowOn: { fontWeight: '700' },
  tick: { color: T.accent, fontSize: 16, fontWeight: '700' },
  manage: { borderBottomWidth: 0 },
  manageText: { color: T.accent, fontSize: 16, fontWeight: '600' },
});
