/**
 * The cog in the top right, and the menu under it.
 *
 * Sean, 2026-09-21: "add a user icon in the top right similar to CalMind..
 * it's not actually a logged in user but i want the drop down menu to
 * include 'import from csv', 'export budget', 'whole dollars' (which has a
 * checkbox toggle)", then, immediately: "actually a cog icon, not
 * hamburger". CalMind's is an account pill with a username in it; this app
 * has no account, so the ring holds a cog and means what it looks like.
 *
 * WHY A MENU AT ALL. The three things in it were three different kinds of
 * control in three different places: `.00` was a round toggle in the bar,
 * Import was a small arrow on whichever account heading you happened to be
 * looking at, and Export did not exist. None of them is about the SCREEN —
 * the bar is for the screen — and none is pressed more than once in a
 * session. One place for "things about the app" is what the bar has been
 * missing, and it is CalMind's answer to the same question.
 *
 * THE MENU HANGS OFF THE BUTTON, measured, and that is not a detail. CalMind
 * pinned its menu `right: 16` inside a Modal — 16 from the window's edge —
 * and on a window wider than the app's own column the menu flew off to the
 * side, nowhere near the cog that opened it. The measurement is taken and
 * the menu opened INSIDE the callback, because measuring is asynchronous and
 * opening first draws one frame at the fallback position.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, monthLabel } from '@acctmind/core';
import { CogIcon } from './Icons';
import * as shared from './icloudfile';
import { TipBubble, useTip } from './Tip';
import { SPACE, T, TAP } from './theme';
import { TOPBAR_CTRL } from './TopBar';

/** Wide enough for the longest row, narrow enough to hang off a 44pt ring. */
const MENU_W = 212;

/** "Sep 21, 2026" — the full month name does not fit between two arrows here. */
const shortDay = (day: string): string =>
  `${monthLabel(day).slice(0, 3)} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`;

export function AppMenu({ onImport, onExport, whole, onWhole, start, onStart, offer }: {
  /** Open the CSV import. Absent on a surface that cannot read a file. */
  onImport?: (() => void) | undefined;
  /** Write the budget out. Absent nowhere — every surface can hand over text. */
  onExport: () => void;
  /** Are bare digits read as whole dollars? */
  whole: boolean;
  onWhole: (next: boolean) => void;
  /** The budget's first day, `YYYY-MM-DD`, or null for none. A ledger setting. */
  start: string | null;
  onStart: (next: string | null) => void;
  /** What an unset start offers: the latest reconcile, else the 1st of the Budget tab's month. */
  offer: string;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  /** One line about the shared file — see where it is drawn. */
  const [syncNote, setSyncNote] = useState('iCloud: checking…');
  // Asked each time the menu OPENS rather than held: the container can
  // appear or go away from outside this app entirely, and a cached answer
  // would be the stale thing the row exists to replace.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void shared.status().then((s) => { if (alive) setSyncNote(`iCloud: ${s}`); });
    return () => { alive = false; };
  }, [open]);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const btn = useRef<View>(null);
  const tip = useTip();

  const openMenu = () => {
    const node = btn.current as unknown as
      { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, w, h) => { setAnchor({ x, y, w, h }); setOpen(true); });
    } else {
      // No measurement available: the corner is better than no menu.
      setAnchor(null);
      setOpen(true);
    }
  };

  return (
    <>
      <Pressable
        ref={btn}
        onPress={openMenu}
        onHoverIn={tip.hover.onHoverIn}
        onHoverOut={tip.hover.onHoverOut}
        style={styles.hit}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        accessibilityState={{ expanded: open }}
        testID="app-menu-button"
      >
        <TipBubble text="Settings" shown={tip.shown} />
        <View style={styles.ring}><CogIcon /></View>
      </Pressable>

      {open && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} testID="app-menu-backdrop">
            {/* The menu itself swallows its own taps; without this the first
                press on any row closes the menu through the backdrop. */}
            <Pressable
              onPress={() => {}}
              style={[
                styles.menu,
                anchor
                  // Right edges aligned, hanging 6 under the ring. max(8)
                  // keeps it on screen in a window narrower than the menu.
                  ? {
                    top: anchor.y + anchor.h + 6,
                    left: Math.max(8, anchor.x + anchor.w - MENU_W),
                    width: MENU_W,
                  }
                  : { top: insets.top + TAP + 8, right: SPACE.lg, width: MENU_W },
              ]}
            >
              {/* Absent rather than disabled where a surface cannot read a
                  file: a row that is present and inert is a row you press
                  twice before believing it. */}
              {onImport !== undefined && (
                <Pressable
                  style={styles.row}
                  onPress={() => { setOpen(false); onImport(); }}
                  accessibilityRole="button"
                  testID="menu-import"
                >
                  <Text style={styles.rowText}>Import from CSV</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.row}
                onPress={() => { setOpen(false); onExport(); }}
                accessibilityRole="button"
                testID="menu-export"
              >
                <Text style={styles.rowText}>Export budget</Text>
              </Pressable>
              {/*
                A SETTING, not an action, so it keeps the menu OPEN and shows
                its state in a box. The two above leave for somewhere else
                and closing behind them is right; flipping a toggle and
                having the menu vanish makes you reopen it to see whether it
                took.
              */}
              {/*
                BUDGET START — Sean, 2026-09-25: "an option under the options
                drop down for Starting Month", then "i basically started on
                i think 9/21 after doing a reconcile". A DAY, for that second
                sentence; nothing dated before it counts against a line.

                A setting like the box below, so it keeps the menu open. Unset,
                it offers the latest reconcile — where his budget began — and
                set, it steps a day at a time and × clears.
              */}
              <View style={styles.startWrap} testID="menu-start">
                <View style={styles.startHead}>
                  <Text style={styles.rowText}>Budget starts</Text>
                  {start !== null && (
                    <Pressable
                      onPress={() => onStart(null)}
                      style={styles.startBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Clear the starting month"
                      testID="menu-start-clear"
                    >
                      <Text style={styles.startArrow}>×</Text>
                    </Pressable>
                  )}
                </View>
                {start === null ? (
                  <Pressable
                    onPress={() => onStart(offer)}
                    style={styles.startSet}
                    accessibilityRole="button"
                    accessibilityLabel={`Start the budget on ${shortDay(offer)}`}
                    testID="menu-start-set"
                  >
                    <Text style={styles.startNone}>Not set — use {shortDay(offer)}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.startSteps}>
                    <Pressable
                      onPress={() => onStart(addDays(start, -1))}
                      style={styles.startBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Start a day earlier"
                      testID="menu-start-prev"
                    >
                      <Text style={styles.startArrow}>‹</Text>
                    </Pressable>
                    <Text style={styles.startMonth} testID="menu-start-day">{shortDay(start)}</Text>
                    <Pressable
                      onPress={() => onStart(addDays(start, 1))}
                      style={styles.startBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Start a day later"
                      testID="menu-start-next"
                    >
                      <Text style={styles.startArrow}>›</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <Pressable
                style={[styles.row, styles.last]}
                onPress={() => onWhole(!whole)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: whole }}
                accessibilityLabel="Enter whole dollars"
                testID="menu-whole"
              >
                <Text style={styles.rowText}>Whole dollars</Text>
                <View style={[styles.box, whole && styles.boxOn]} testID="menu-whole-box">
                  {whole && <Text style={styles.boxTick}>✓</Text>}
                </View>
              </Pressable>

              {/*
                WHETHER SYNC IS WORKING, in a sentence, at the foot.
                
                Not a control — the only row here that does nothing when
                pressed — and it earns the exception. The peer link reports
                itself on the Devices screen and iCloud's megabyte gets a
                banner; the shared file had nothing at all, so "it is not
                syncing" and "it is syncing and there was nothing to send"
                looked exactly alike. On 2026-09-22 that cost an hour with
                1,948 transactions sitting on one Mac.
                
                THE COG, not Devices, because Devices is not there on every
                surface: it is drawn only when the peer module exists, so
                the Tauri Mac app — the surface this transport was built
                for — has no such screen at all.
              */}
              <View style={styles.note} testID="menu-sync">
                <Text style={styles.noteText}>{syncNote}</Text>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // 44 over 32, the bar's shape everywhere — see TopBar's CircleBtn and the
  // note there about hitSlop being a no-op on the web.
  hit: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: TOPBAR_CTRL, height: TOPBAR_CTRL, borderRadius: TOPBAR_CTRL / 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    backgroundColor: T.card, alignItems: 'center', justifyContent: 'center',
  },
  // The one row that is not a control: no tap target, no 44, and dimmer
  // than the rows above it so the eye reads it as a statement.
  note: {
    paddingHorizontal: SPACE.md, paddingTop: SPACE.sm, paddingBottom: SPACE.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.cardEdge,
  },
  noteText: { color: T.faint, fontSize: 11, lineHeight: 15 },
  backdrop: { flex: 1, backgroundColor: '#00000088' },
  menu: {
    position: 'absolute', borderRadius: 14,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: TAP, paddingHorizontal: SPACE.lg, gap: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  last: { borderBottomWidth: 0 },
  startWrap: {
    paddingLeft: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  startHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TAP },
  startSteps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  startSet: { minHeight: TAP, justifyContent: 'center', paddingRight: SPACE.lg },
  startNone: { color: T.dim, fontSize: 14 },
  startBtn: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  startArrow: { color: T.text, fontSize: 20 },
  startMonth: { color: T.text, fontSize: 16, fontVariant: ['tabular-nums'] },
  rowText: { color: T.text, fontSize: 16, flexShrink: 1 },
  // The ledger's own checkbox, at the same 15 points — see the cleared box
  // on a transaction row. One shape for "this is on" across the app.
  box: {
    width: 15, height: 15, borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.dim,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: T.accent, borderColor: T.accent },
  boxTick: { color: '#ffffff', fontSize: 10, lineHeight: 12 },
});
