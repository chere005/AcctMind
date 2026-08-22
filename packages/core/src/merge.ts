/**
 * Merging two copies of the ledger.
 *
 * AcctMind syncs between a phone and a Mac, with no
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
import type { Record_, Store } from './types';
import { STORE_VERSION } from './types';

/**
 * The winner between two versions of one record.
 *
 * Ties keep the incumbent, which is what makes re-applying an echo a no-op
 * rather than a change — a device that hears its own write back must not
 * treat it as news, or two devices can bounce a record between them for ever.
 */
export function pickTxn<R extends Record_>(mine: R, theirs: R): R {
  return theirs.updated > mine.updated ? theirs : mine;
}

/**
 * Merge one collection of records by id.
 *
 * Generic over the record shape because the merge reads only `id` and
 * `updated` — accounts and categories need exactly the same treatment as
 * transactions, and writing it three times would be three chances to get the
 * tie rule subtly different on one of them.
 */
export function mergeRecords<R extends Record_>(mine: readonly R[], theirs: readonly R[]): R[] {
  const byId = new Map<string, R>();
  for (const r of mine) byId.set(r.id, r);
  for (const r of theirs) {
    const have = byId.get(r.id);
    byId.set(r.id, have === undefined ? r : pickTxn(have, r));
  }
  return [...byId.values()];
}

/**
 * Merge two stores into the one both devices will agree on.
 *
 * Order-independent: `merge(a, b)` and `merge(b, a)` differ only when two
 * records have the SAME id and the SAME `updated`, and in that case they are
 * two claims about one record at one instant, which no rule can separate.
 */
export function mergeStores(mine: Store, theirs: Store): Store {
  return {
    v: STORE_VERSION,
    txns: mergeRecords(mine.txns, theirs.txns),
    // Accounts, categories and lines merge too, and must: a transaction points
    // at an account and a line by id, so a record that reached only one device
    // would leave its rows with nowhere to be drawn on the other.
    accounts: mergeRecords(mine.accounts, theirs.accounts),
    categories: mergeRecords(mine.categories, theirs.categories),
    lines: mergeRecords(mine.lines, theirs.lines),
  };
}

/** What the screens show: everything that is not a tombstone. */
export function live<R extends Record_>(recs: readonly R[]): R[] {
  return recs.filter((r) => r.deleted !== true);
}

/**
 * Mark a record dead. The row stays, so the delete can travel.
 *
 * The payload is kept rather than blanked. A tombstone is bigger that way,
 * which `prune` answers, and the gain is that a delete arriving on a device
 * that never saw the record still produces a complete row — so a later
 * undelete, or a person reading the raw store, has something to look at.
 */
export function tombstone<R extends Record_>(txn: R, now: number): R {
  // Through `touch`, not `now`. A delete is an edit and needs the same clock
  // guarantee: `pickTxn` breaks a tie by keeping the incumbent, so a delete
  // stamped with the same millisecond the record was last written ties with
  // the LIVE copy on another device and loses. The row comes back, and
  // nothing anywhere reports a failure. Written as `updated: now` this was a
  // real hole, found while making delete a thing a person can actually tap.
  return { ...touch(txn, now), deleted: true };
}

/** Bump the merge clock. Every edit goes through here or it will not travel. */
export function touch<R extends Record_>(txn: R, now: number): R {
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
  const fresh = <R extends Record_>(recs: readonly R[]): R[] =>
    recs.filter((r) => r.deleted !== true || now - r.updated < ttl);
  return {
    ...store,
    txns: fresh(store.txns),
    accounts: fresh(store.accounts),
    categories: fresh(store.categories),
    lines: fresh(store.lines),
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
  const byId = <R extends Record_>(recs: readonly R[]): R[] =>
    [...recs].sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...store,
    txns: byId(store.txns),
    accounts: byId(store.accounts),
    categories: byId(store.categories),
    lines: byId(store.lines),
  };
}

/**
 * A store as text, with record order AND key order settled.
 *
 * `JSON.stringify` writes keys in insertion order, so the same account built
 * by a literal and by `normalizeTxn`'s spread serialize differently while
 * being the same account. Comparing those strings answers "has anything
 * changed?" with yes, for ever: each device sees the other's copy as news,
 * publishes, and is answered. Sorting the keys is what stops that, and it is
 * the same fix CalMind's `canon()` carries, for the same reason.
 */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

/** Do these two hold the same ledger? Order-insensitive, by construction. */
export function sameStore(a: Store, b: Store): boolean {
  return stable(canonical(a)) === stable(canonical(b));
}
