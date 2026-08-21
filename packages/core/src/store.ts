/**
 * The local store: reading it, writing it, and the difference between empty
 * and broken.
 *
 * AcctMind keeps everything on the device. There is no server copy to fall
 * back on, which makes one distinction the most important thing in this file:
 * **a store that will not parse is not an empty store.** Returning `[]` for a
 * damaged file reads as "you have no transactions", and the very next write
 * saves that emptiness over the only copy. So a damaged read is an error the
 * caller has to handle, and `save()` must never run on top of one.
 */

import { STORE_VERSION, type Store, type Txn } from './types';
import { isDay } from './day';

/** A load either produced a store, or failed and must not be written over. */
export type LoadResult =
  | { ok: true; store: Store; dropped: number; migrated: boolean }
  | { ok: false; error: string };

/** Versions this build can READ. It writes STORE_VERSION and nothing else. */
export const READABLE_VERSIONS = [1, STORE_VERSION] as const;

export function emptyStore(): Store {
  return { v: STORE_VERSION, txns: [] };
}

/** Serialize for the device. Compact — nothing reads this by eye but us. */
export function serialize(store: Store): string {
  return JSON.stringify(store);
}

/**
 * Read what a device handed back.
 *
 * `null` or `''` means the app has never saved here — a genuinely new
 * install, and an empty store is the right answer. Anything else that fails
 * to parse is damage, and says so.
 *
 * Individual records that are malformed are DROPPED rather than failing the
 * whole load, and the count comes back so the caller can say so. One bad row
 * should not cost someone the other four hundred.
 */
export function parseStore(raw: string | null | undefined): LoadResult {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { ok: true, store: emptyStore(), dropped: 0, migrated: false };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'the saved data is not readable JSON' };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'the saved data is not a store' };
  }

  const obj = data as Record<string, unknown>;
  const version = obj['v'];
  // OLDER is upgraded; NEWER is refused. The asymmetry is the point: a v1
  // store is a real ledger on a real device and refusing it would strand it,
  // while a v3 store is one this build cannot understand, and the only thing
  // worse than not showing it is overwriting it with a downgrade.
  if (!READABLE_VERSIONS.includes(version as 1 | typeof STORE_VERSION)) {
    return { ok: false, error: `the saved data is version ${String(version)}, and this app reads ${READABLE_VERSIONS.join(' and ')}` };
  }
  const migrated = version !== STORE_VERSION;
  if (!Array.isArray(obj['txns'])) {
    return { ok: false, error: 'the saved data has no transaction list' };
  }

  const txns: Txn[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const row of obj['txns']) {
    const t = normalizeTxn(row);
    // A duplicate id is damage too — it makes deletes ambiguous. Keep the
    // first and count the rest, rather than letting a delete remove two.
    if (t === null || seen.has(t.id)) { dropped++; continue; }
    seen.add(t.id);
    txns.push(t);
  }

  return { ok: true, store: { v: STORE_VERSION, txns }, dropped, migrated };
}

/**
 * Coerce one unknown row into a transaction, or reject it.
 *
 * Strict about the things arithmetic depends on — the amount must be a safe
 * integer, the date must be a real day — and forgiving about the rest, where
 * a missing description is just an empty one.
 */
export function normalizeTxn(row: unknown): Txn | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const id = r['id'];
  if (typeof id !== 'string' || id === '') return null;

  const name = r['name'];
  if (typeof name !== 'string') return null;

  const amount = r['amount'];
  // A float here is not a rounding question, it is a file written by
  // something that did not follow the rule. Reject it rather than trunc it.
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) return null;

  const date = r['date'];
  if (!isDay(date)) return null;

  const created = r['created'];
  const createdN = typeof created === 'number' && Number.isFinite(created) ? created : 0;

  // A v1 record has no merge clock. Seeding it from `created` is the only
  // honest choice: it is the last moment we KNOW the record was written, so
  // an edit made on any device afterwards outranks it, which is the answer
  // we want. Seeding from `now` instead would make every device's copy of
  // every old row claim to be the newest, and the first merge would be a
  // coin toss between two full ledgers.
  const updated = r['updated'];
  const updatedN = typeof updated === 'number' && Number.isFinite(updated) ? updated : createdN;

  const description = r['description'];

  return {
    id,
    name,
    description: typeof description === 'string' ? description : '',
    amount,
    date,
    created: createdN,
    updated: updatedN,
    // Only the literal `true` is a tombstone; anything else is a live record.
    ...(r['deleted'] === true ? { deleted: true as const } : {}),
  };
}

/** Add one, returning a new store. Nothing here mutates what it is given. */
export function addTxn(store: Store, txn: Txn): Store {
  return { ...store, txns: [...store.txns, txn] };
}

/** Remove by id. A miss is not an error — the row is gone either way. */
export function removeTxn(store: Store, id: string): Store {
  return { ...store, txns: store.txns.filter((t) => t.id !== id) };
}

/** Replace one in place, by id. Used by an edit; a miss changes nothing. */
export function updateTxn(store: Store, txn: Txn): Store {
  return { ...store, txns: store.txns.map((t) => (t.id === txn.id ? txn : t)) };
}
