/**
 * Which category a transaction belongs to — a dropdown you can type into.
 *
 * The filter is the point. A ledger grows categories faster than anything
 * else in it, and a list of forty is a list nobody scrolls; typing three
 * letters is how a person picks the one they already have in mind. Matching
 * is case-insensitive and on a SUBSTRING, not a prefix, because people
 * remember "groceries" out of "Food & groceries".
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { filterByName, type Category } from '@acctmind/core';
import { Dot } from './Dot';
import { SPACE, T, TAP } from './theme';

export function CategoryPick({ categories, value, onPick }: {
  categories: readonly Category[];
  value: string | null;
  onPick: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const chosen = categories.find((c) => c.id === value) ?? null;
  const shown = filterByName(categories, query);

  return (
    <>
      <Pressable
        onPress={() => { setQuery(''); setOpen(true); }}
        style={styles.field}
        accessibilityRole="button"
        accessibilityLabel={chosen === null ? 'No category' : chosen.name}
        testID="category-button"
      >
        {chosen !== null && <Dot colors={[chosen.color]} size={12} />}
        <Text style={[styles.value, chosen === null && styles.none]} testID="category-value">
          {chosen?.name ?? 'None'}
        </Text>
        <Text style={styles.chev}>⌄</Text>
      </Pressable>

      {open && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          {/* Its own window: the app's safe area does not reach in here. */}
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
            <Pressable style={[styles.menu, { marginTop: insets.top + SPACE.xl }]} onPress={() => {}}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Filter"
                placeholderTextColor={T.faint}
                autoFocus
                autoCorrect={false}
                style={styles.search}
                testID="category-filter"
              />
              <ScrollView keyboardShouldPersistTaps="handled">
                {/* Always offered, and never filtered away: "none" is a real
                    answer, not a category that happens to match nothing. */}
                <Pressable
                  onPress={() => { onPick(null); setOpen(false); }}
                  style={styles.row}
                  testID="category-none"
                >
                  <Text style={[styles.rowText, styles.none]}>None</Text>
                </Pressable>
                {shown.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => { onPick(c.id); setOpen(false); }}
                    style={styles.row}
                    testID={`category-opt-${c.id}`}
                  >
                    <Dot colors={[c.color]} size={12} />
                    <Text style={styles.rowText} numberOfLines={1}>{c.name}</Text>
                  </Pressable>
                ))}
                {shown.length === 0 && (
                  <Text style={styles.nothing} testID="category-nomatch">
                    Nothing matches “{query.trim()}”.
                  </Text>
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    // T.card with a hairline, matching `styles.input` in AddTransaction.
    // It was T.field — pure black, no border — so on the one form that shows
    // all four boxes at once, Category was visibly a different control from
    // Name, Description and Amount.
    minHeight: TAP, backgroundColor: T.card, borderRadius: 10,
    paddingHorizontal: SPACE.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  value: { color: T.text, fontSize: 17, flex: 1 },
  none: { color: T.dim },
  chev: { color: T.dim, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#00000088' },
  menu: {
    marginHorizontal: SPACE.lg, maxHeight: 380, borderRadius: 14,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    overflow: 'hidden',
  },
  search: {
    minHeight: TAP, color: T.text, fontSize: 17, paddingHorizontal: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    minHeight: TAP, paddingHorizontal: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  rowText: { color: T.text, fontSize: 16, flex: 1 },
  nothing: { color: T.dim, fontSize: 15, padding: SPACE.lg },
});
