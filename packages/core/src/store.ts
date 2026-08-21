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

import {
  DEFAULT_ACCOUNT_NAME, STORE_VERSION,
  type Account, type Category, type Record_, type Store, type Txn,
} from './types';
import { isDay } from './day';
import { PALETTE } from './palette';

/** A load either produced a store, or failed and must not be written over. */
export type LoadResult =
  | { ok: true; store: Store; dropped: number; migrated: boolean }
  | { ok: false; error: string };

/** Versions this build can READ. It writes STORE_VERSION and nothing else. */
export const READABLE_VERSIONS = [1, 2, STORE_VERSION] as const;

export function emptyStore(): Store {
  return { v: STORE_VERSION, txns: [], accounts: [], categories: [] };
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

  let dropped = 0;
  /** Read a list of records, dropping the unreadable and the duplicated. */
  const readAll = <R extends { id: string }>(
    raw: unknown, one: (row: unknown) => R | null,
  ): R[] => {
    if (!Array.isArray(raw)) return [];
    const out: R[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      const r = one(row);
      // A duplicate id is damage too — it makes deletes ambiguous. Keep the
      // first and count the rest, rather than letting a delete remove two.
      if (r === null || seen.has(r.id)) { dropped++; continue; }
      seen.add(r.id);
      out.push(r);
    }
    return out;
  };

  const accounts = readAll(obj['accounts'], normalizeAccount);
  const categories = readAll(obj['categories'], normalizeCategory);
  const txns = readAll(obj['txns'], normalizeTxn);

  /*
   * Every transaction must have an account that exists.
   *
   * Three ways it might not: an older store that predates accounts, a row
   * whose account was dropped as damaged just now, or a merge that delivered
   * transactions before the account record caught up. All three end the same
   * way — rows with nowhere to be drawn — so a home is made for them rather
   * than dropping the rows, which would lose real money over a bookkeeping
   * detail.
   */
  const known = new Set(accounts.map((a) => a.id));
  const homeless = txns.filter((t) => !known.has(t.account));
  if (homeless.length > 0) {
    const fallback = accounts.find((a) => a.deleted !== true) ?? adoptAccount(txns);
    if (!known.has(fallback.id)) accounts.push(fallback);
    for (const t of homeless) t.account = fallback.id;
  }

  // A category that has gone is forgotten rather than fabricated: unlike an
  // account, "no category" is a state the model already has.
  const cats = new Set(categories.map((c) => c.id));
  for (const t of txns) if (t.category !== null && !cats.has(t.category)) t.category = null;

  return { ok: true, store: { v: STORE_VERSION, txns, accounts, categories }, dropped, migrated };
}

/**
 * The account a store without one gets.
 *
 * Its id is derived from the oldest transaction rather than randomly, so that
 * two devices migrating the SAME v2 ledger independently — which is exactly
 * what happens when an old phone and an old Mac both update — arrive at the
 * same id and merge into one account instead of two identical ones nobody
 * can tell apart. With no transactions at all there is nothing to derive
 * from and nothing to be inconsistent about.
 */
function adoptAccount(txns: readonly Txn[]): Account {
  const oldest = txns.reduce<Txn | null>(
    (best, t) => (best === null || t.created < best.created ? t : best), null);
  const created = oldest?.created ?? 0;
  return {
    id: `acct-${oldest?.id ?? 'first'}`,
    name: DEFAULT_ACCOUNT_NAME,
    color: PALETTE[0],
    order: 0,
    created,
    updated: created,
  };
}

/** The shared part of every record: id, clocks, tombstone. */
function normalizeRecord(r: Record<string, unknown>): Record_ | null {
  const id = r['id'];
  if (typeof id !== 'string' || id === '') return null;
  const created = r['created'];
  const createdN = typeof created === 'number' && Number.isFinite(created) ? created : 0;
  const updated = r['updated'];
  const updatedN = typeof updated === 'number' && Number.isFinite(updated) ? updated : createdN;
  return {
    id,
    created: createdN,
    updated: updatedN,
    ...(r['deleted'] === true ? { deleted: true as const } : {}),
  };
}

/** A colour we recognise, or the palette's first. Never an arbitrary string. */
function normalizeColor(v: unknown): string {
  return typeof v === 'string' && (PALETTE as readonly string[]).includes(v) ? v : PALETTE[0];
}

export function normalizeAccount(row: unknown): Account | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const base = normalizeRecord(r);
  if (base === null) return null;
  const name = r['name'];
  if (typeof name !== 'string') return null;
  const order = r['order'];
  return {
    ...base,
    name,
    color: normalizeColor(r['color']),
    order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
  };
}

export function normalizeCategory(row: unknown): Category | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const base = normalizeRecord(r);
  if (base === null) return null;
  const name = r['name'];
  if (typeof name !== 'string') return null;
  const budget = r['budget'];
  // Same rule as an amount: a float here is a file written by something that
  // did not follow the rule, not a rounding question.
  if (budget !== undefined && (typeof budget !== 'number' || !Number.isSafeInteger(budget))) {
    return null;
  }
  const order = r['order'];
  return {
    ...base,
    name,
    color: normalizeColor(r['color']),
    budget: budget ?? 0,
    order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
  };
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

  const account = r['account'];
  const category = r['category'];

  return {
    id,
    name,
    description: typeof description === 'string' ? description : '',
    amount,
    date,
    // An older store has no account. Left as '' it fails the "does this
    // account exist" check in parseStore and is adopted there, which is the
    // one place that can see the whole store and choose a home.
    account: typeof account === 'string' ? account : '',
    category: typeof category === 'string' && category !== '' ? category : null,
    // Absent in every store before custom ordering existed. Zero is not a
    // fallback here, it is the real value for "never dragged".
    order: typeof r['order'] === 'number' && Number.isFinite(r['order']) ? r['order'] : 0,
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

/**
 * A store guaranteed to have somewhere to put a transaction.
 *
 * The invariant every screen depends on: there is ALWAYS at least one live
 * account. Without it a fresh install has no section to draw, the + has no
 * account to hand the form, and `validateDraft` refuses every transaction
 * with "Pick an account" — a dead end reached by doing nothing wrong.
 *
 * Returns the store unchanged when one already exists, so it is safe to call
 * on every load rather than only on the ones that need it.
 */
export function ensureAccount(store: Store, id: string, now: number): Store {
  if (store.accounts.some((a) => a.deleted !== true)) return store;
  return {
    ...store,
    accounts: [...store.accounts, {
      id,
      name: DEFAULT_ACCOUNT_NAME,
      color: PALETTE[0],
      order: 0,
      created: now,
      updated: now,
    }],
  };
}

/** Add, replace and remove for the other two record kinds. */
export function putAccount(store: Store, account: Account): Store {
  const has = store.accounts.some((a) => a.id === account.id);
  return {
    ...store,
    accounts: has
      ? store.accounts.map((a) => (a.id === account.id ? account : a))
      : [...store.accounts, account],
  };
}

export function putCategory(store: Store, category: Category): Store {
  const has = store.categories.some((c) => c.id === category.id);
  return {
    ...store,
    categories: has
      ? store.categories.map((c) => (c.id === category.id ? category : c))
      : [...store.categories, category],
  };
}
