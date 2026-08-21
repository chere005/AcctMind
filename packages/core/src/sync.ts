/**
 * What to do when a remote copy shows up — decided here, performed elsewhere.
 *
 * `planSync` is a pure function of (what this device holds, what the remote
 * says) and returns three answers: what to hold now, whether that differs
 * from what was on the disk, and what — if anything — to publish. All the
 * iCloud machinery lives in the app; none of the RULES do, so they can be
 * tested without a device, an Apple account, or a network.
 *
 * The three rules, and the failure each one prevents:
 *
 *  1. **An absent remote is not an empty ledger.** The first device to sync
 *     finds nothing up there. Treating that as "the remote says zero
 *     transactions" and merging it would be harmless today — merging cannot
 *     delete — but it is one refactor away from being catastrophic, and it
 *     reads as though the ledger was checked when it never was.
 *  2. **Publish only when the result is news.** Otherwise each device answers
 *     every notification with a write, each write wakes the others, and two
 *     devices talk for ever about a ledger nobody changed.
 *  3. **A remote we cannot read is not authority.** Damaged JSON up there
 *     must not touch the local ledger. Publishing ours over it is safe and is
 *     how a corrupt remote heals.
 */
import { mergeStores, prune, sameStore } from './merge';
import { parseStore, serialize } from './store';
import type { Store } from './types';

export type SyncPlan = {
  /** What this device should hold from now on. */
  store: Store;
  /** True when that differs from what was passed in — so save it. */
  save: boolean;
  /** The bytes to publish, or null when the remote is already correct. */
  publish: string | null;
  /** Why, for a log or a test to read. */
  reason: 'no-remote' | 'unreadable-remote' | 'merged' | 'already-agreed';
};

export function planSync(local: Store, remoteRaw: string | null, now: number): SyncPlan {
  // Rule 1.
  if (remoteRaw === null) {
    return { store: local, save: false, publish: serialize(local), reason: 'no-remote' };
  }

  // Rule 3.
  const parsed = parseStore(remoteRaw);
  if (!parsed.ok) {
    return { store: local, save: false, publish: serialize(local), reason: 'unreadable-remote' };
  }

  const merged = prune(mergeStores(local, parsed.store), now);

  // Rule 2. Compared against the REMOTE, not against the local copy: the
  // question "does the remote need updating?" is not the same question as
  // "did anything change here?", and answering the second one instead is
  // what starts the ping-pong.
  const remoteIsCurrent = sameStore(merged, parsed.store);

  return {
    store: merged,
    save: !sameStore(merged, local),
    publish: remoteIsCurrent ? null : serialize(merged),
    reason: remoteIsCurrent ? 'already-agreed' : 'merged',
  };
}
