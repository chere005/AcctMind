/**
 * Merging two copies of the ledger.
 *
 * AcctMind syncs between a phone, a Mac and a watch through iCloud, with no
 * server anywhere. Nothing arbitrates, so the rule has to be one that gives
 * the same answer whichever device applies it, in whatever order things
 * arrive, however many times they arrive:
 *
 *   **per-record last-write-wins on `updated`, ties keeping the incumbent.**
 *
 * That makes merging commutative, associative and idempotent — the three
 * properties that let a device apply an update it has already seen, or apply
 * two updates in the wrong order, and still land where every other device
 * lands. `spec/merge.json` pins all three as cases, because they are exactly
 * the ones a plausible-looking implementation gets wrong.
 *
 * What this deliberately does NOT do is merge two edits to the SAME
 * transaction field by field. If the phone renames a row while the Mac
 * changes its amount, one of them wins whole. Field-level merging needs a
 * per-field clock, and for a ledger someone edits by hand on one device at a
 * time, that is a large amount of machinery to prevent a rare and visible
 * loss rather than a common and silent one.
 */
import type { Store, Txn } from './types';
import { STORE_VERSION } from './types';

/**
 * The winner between two versions of one record.
 *
 * Ties keep the incumbent, which is what makes re-applying an echo a no-op
 * rather than a change — a device that hears its own write back must not
 * treat it as news, or two devices can bounce a record between them for ever.
 */
export function pickTxn(mine: Txn, theirs: Txn): Txn {
  return theirs.updated > mine.updated ? theirs : mine;
}

/**
 * Merge two stores into the one both devices will agree on.
 *
 * Order-independent: `merge(a, b)` and `merge(b, a)` differ only when two
 * records have the SAME id and the SAME `updated`, and in that case they are
 * two claims about one record at one instant, which no rule can separate.
 */
export function mergeStores(mine: Store, theirs: Store): Store {
  const byId = new Map<string, Txn>();
  for (const t of mine.txns) byId.set(t.id, t);
  for (const t of theirs.txns) {
    const have = byId.get(t.id);
    byId.set(t.id, have === undefined ? t : pickTxn(have, t));
  }
  return { v: STORE_VERSION, txns: [...byId.values()] };
}

/** What the screens show: everything that is not a tombstone. */
export function live(txns: readonly Txn[]): Txn[] {
  return txns.filter((t) => t.deleted !== true);
}

/**
 * Mark a record dead. The row stays, so the delete can travel.
 *
 * The payload is kept rather than blanked. A tombstone is bigger that way,
 * which `prune` answers, and the gain is that a delete arriving on a device
 * that never saw the record still produces a complete row — so a later
 * undelete, or a person reading the raw store, has something to look at.
 */
export function tombstone(txn: Txn, now: number): Txn {
  return { ...txn, deleted: true, updated: now };
}

/** Bump the merge clock. Every edit goes through here or it will not travel. */
export function touch(txn: Txn, now: number): Txn {
  // `Math.max(now, txn.updated + 1)`, not `now`: two edits inside the same
  // millisecond would otherwise tie, and a tie keeps the incumbent — so the
  // second edit would be silently dropped by the next merge. A clock that
  // went backwards (a device with the wrong time, or one that just corrected
  // itself) would do the same thing for longer.
  return { ...txn, updated: Math.max(now, txn.updated + 1) };
}

/**
 * How long a tombstone is kept: 90 days.
 *
 * They cannot be kept for ever — iCloud's key-value store is one megabyte for
 * the whole ledger, and a tombstone costs nearly what a live row costs. They
 * also cannot be dropped promptly: a device that has been in a drawer since
 * before the delete will re-upload the record as new, and the deletion
 * un-happens. Ninety days is the bet that no device is offline longer than a
 * season; a device that IS gets its old rows back, which is wrong but visible,
 * rather than losing rows, which is wrong and silent.
 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function prune(store: Store, now: number, ttl: number = TOMBSTONE_TTL_MS): Store {
  return {
    ...store,
    txns: store.txns.filter((t) => t.deleted !== true || now - t.updated < ttl),
  };
}

/**
 * The same store, in a form two devices will serialize identically.
 *
 * Merging builds its result from a Map, so record ORDER depends on which side
 * was iterated first — two devices that agree completely would still produce
 * different JSON. That matters because "has anything actually changed?" is
 * answered by comparing serialized stores, and without this every merge would
 * look like a change and every device would re-publish on every sync, for
 * ever.
 */
export function canonical(store: Store): Store {
  return {
    ...store,
    txns: [...store.txns].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Do these two hold the same ledger? Order-insensitive, by construction. */
export function sameStore(a: Store, b: Store): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
