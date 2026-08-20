/** The shapes every surface agrees on. Nothing here has behavior. */

/** A transaction, as stored. */
export type Txn = {
  /** Stable, generated once at creation. Never derived from the content. */
  id: string;
  name: string;
  /** Always a string; absent and empty are the same thing and normalize to ''. */
  description: string;
  /** Integer MINOR UNITS (cents). Negative is money out. Never a float. */
  amount: number;
  /** `YYYY-MM-DD`, on the local calendar. See day.ts for why not a timestamp. */
  date: string;
  /** Epoch milliseconds. Breaks ties between two transactions on one day. */
  created: number;
};

/** What the add form holds while it is being typed — all strings, all raw. */
export type Draft = {
  name: string;
  description: string;
  /** As typed: `12.50`, `$1,234`, `(5)`. Parsed by money.ts, never by a screen. */
  amount: string;
  date: string;
};

/** Which fields a draft got wrong. An empty object means it is good. */
export type DraftErrors = Partial<Record<keyof Draft, string>>;

/**
 * The whole local store, as one serializable object.
 *
 * `v` is the on-disk version. It exists from the first commit because adding
 * one later means guessing what the unversioned files were — and there are
 * six surfaces holding copies of this, so the first migration will not be
 * able to reach them all at once.
 */
export type Store = {
  v: 1;
  txns: Txn[];
};

export const STORE_VERSION = 1 as const;
