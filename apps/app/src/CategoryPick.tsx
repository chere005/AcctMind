/**
 * Which budget LINE a transaction belongs to — a dropdown you can type into.
 *
 * It picked a category until v4, when the money moved down a level: a
 * category is a heading now and a line is what actually holds a budget, so a
 * line is what a transaction has to be filed against. The rows are grouped
 * under their category, because two lines called `Coffee` in different
 * categories are a real thing to have and a list that showed both without
 * saying which is which would be unusable.
 *
 * The filter is the point. A ledger grows lines faster than anything else in
 * it, and a list of forty is a list nobody scrolls; typing three letters is
 * how a person picks the one they already have in mind. Matching is
 * case-insensitive and on a SUBSTRING, not a prefix, because people remember
 * "groceries" out of "Food & groceries".
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { filterByName, type Category, type Line } from '@acctmind/core';
import { Dot } from './Dot';
import { SPACE, T, TAP } from './theme';

export function CategoryPick({ categories, lines, value, onPick }: {
  categories: readonly Category[];
  lines: readonly Line[];
  value: string | null;
  onPick: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const chosen = lines.find((l) => l.id === value) ?? null;
  const shown = filterByName(lines, query);
  const colorOf = (l: Line) => categories.find((c) => c.id === l.category)?.color ?? T.faint;
  const groupOf = (l: Line) => categories.find((c) => c.id === l.category)?.name ?? '';

  return (
    <>
      <Pressable
        onPress={() => { setQuery(''); setOpen(true); }}
        style={styles.field}
        accessibilityRole="button"
        accessibilityLabel={chosen === null ? 'No category' : chosen.name}
        testID="category-button"
      >
        {chosen !== null && <Dot colors={[colorOf(chosen)]} size={12} />}
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
                {shown.map((l) => (
                  <Pressable
                    key={l.id}
                    onPress={() => { onPick(l.id); setOpen(false); }}
                    style={styles.row}
                    testID={`category-opt-${l.id}`}
                  >
                    <Dot colors={[colorOf(l)]} size={12} />
                    <Text style={styles.rowText} numberOfLines={1}>{l.name}</Text>
                    {/* Which category it sits in. Two lines can share a name
                        across categories, and without this the list offers
                        the same word twice with no way to choose. */}
                    <Text style={styles.rowGroup} numberOfLines={1}>{groupOf(l)}</Text>
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
  rowGroup: { color: T.gold, fontSize: 13, flexShrink: 0 },
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
