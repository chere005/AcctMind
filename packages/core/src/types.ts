/** The shapes every surface agrees on. Nothing here has behavior. */

/**
 * What every synced record has in common.
 *
 * `id`, `created`, `updated` and `deleted` are the merge's entire vocabulary
 * — it reads nothing else — so anything that must survive two devices meeting
 * carries this shape. Accounts and categories are records for exactly that
 * reason: an account that existed on the phone and not the Mac would make
 * half a person's transactions homeless.
 */
export type Record_ = {
  /** Stable, generated once at creation. Never derived from the content. */
  id: string;
  /** Epoch milliseconds. */
  created: number;
  /**
   * Epoch milliseconds of the last edit — the merge clock.
   *
   * Two devices holding the same id keep the higher `updated`. This is the
   * ONLY field merging looks at, which is why it must move on every change,
   * including a delete.
   */
  updated: number;
  /**
   * A tombstone. The record stays, marked dead, because a merge cannot tell
   * "deleted here" from "not yet arrived here" if the row simply vanishes —
   * the other device would helpfully hand it back on the next sync, for ever.
   */
  deleted?: true;
};

/**
 * A place transactions live: a current account, a card, cash in a drawer.
 *
 * Sections on the Transactions tab. Every transaction belongs to exactly one,
 * which is why there is always at least one — see `DEFAULT_ACCOUNT_NAME`.
 */
export type Account = Record_ & {
  name: string;
  /** A hex colour from the palette. Drives the dot and the section header. */
  color: string;
  /** Where it sits in the list. Sparse and re-spaced rather than contiguous. */
  order: number;
};

/**
 * A heading on the Budget tab: a name, a colour, and the lines under it.
 *
 * A category BUDGETS NOTHING of its own. It used to carry the money, and the
 * money moved down to `Line` in v4 — a category's budgeted amount is the sum
 * of its lines, which is a thing to compute and never a thing to store. Two
 * numbers that must agree are two numbers that eventually will not.
 */
export type Category = Record_ & {
  name: string;
  color: string;
  order: number;
};

/**
 * A budget line: money set aside inside a category.
 *
 * The leaf, and what a transaction is actually filed under. Three numbers are
 * shown against one of these and only ONE of them lives here:
 *
 *   · `budget` — set aside. Stored, because it is a decision someone made.
 *   · spent — the sum of this line's transactions. Derived from the ledger.
 *   · available — `budget + spent`. Derived. See budget.ts.
 *
 * A transaction may have NO line — money moves before anyone decides what it
 * was — so the link is nullable in one direction only.
 */
export type Line = Record_ & {
  name: string;
  /** The category this sits under. Always a real category id. */
  category: string;
  /** Money set aside, in integer MINOR UNITS. Never a float, like every amount. */
  budget: number;
  order: number;
};

/** A transaction, as stored. */
export type Txn = Record_ & {
  name: string;
  /** Always a string; absent and empty are the same thing and normalize to ''. */
  description: string;
  /** Integer MINOR UNITS (cents). Negative is money out. Never a float. */
  amount: number;
  /** `YYYY-MM-DD`, on the local calendar. See day.ts for why not a timestamp. */
  date: string;
  /**
   * The account it belongs to. Always set — a transaction with no account
   * would have nowhere to be drawn.
   *
   * Held as an ID rather than by embedding the account, so renaming one
   * renames it everywhere at once and does not have to visit every row.
   */
  account: string;
  /**
   * Where this row sits when the list is ordered by hand.
   *
   * Carried on the record rather than in a device preference because a custom
   * order is a decision about the ledger, not about a screen — drag a row on
   * the phone and the Mac should agree. It is SPARSE (see `REORDER_GAP`) so a
   * single move rewrites one row instead of all of them, which matters when
   * every rewrite is a merge clock bump that has to travel.
   */
  order: number;
  /**
   * The budget category, or null for one nobody has filed yet.
   *
   * Nullable on purpose: money moves before anyone decides what it was, and a
   * required category would mean inventing "Uncategorised" as a real record
   * that then syncs, gets renamed, and can be deleted out from under its rows.
   */
  category: string | null;
};

/** What the add form holds while it is being typed — all strings, all raw. */
export type Draft = {
  name: string;
  description: string;
  /** As typed: `12.50`, `$1,234`, `(5)`. Parsed by money.ts, never by a screen. */
  amount: string;
  date: string;
  /** The account id. A form always has one — see `emptyDraft`. */
  account: string;
  /** The category id, or null for one nobody has filed yet. */
  category: string | null;
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
  v: 4;
  txns: Txn[];
  accounts: Account[];
  categories: Category[];
  lines: Line[];
};

/** What the one account a migrated store gets is called. */
export const DEFAULT_ACCOUNT_NAME = 'Account';

/**
 * Older stores are READ and upgraded rather than refused: refusing one would
 * strand the ledger already sitting on a device. See `parseStore`.
 *
 *   v1 — no `updated`, no tombstones. Could not merge at all.
 *   v2 — merge clocks and tombstones.
 *   v3 — accounts and categories, and every transaction filed under one
 *        account. A v1 or v2 store has neither, so the migration invents a
 *        single account and puts everything in it. That account is a real
 *        record with a real id from the moment it is created, because the
 *        alternative — a magic 'default' string — is a thing two devices can
 *        both invent separately and then never reconcile.
 *   v4 — budget LINES. A category stopped holding money and became a heading;
 *        the money, and the transactions, moved to a line underneath it. The
 *        migration gives every existing category one line carrying its old
 *        name and its old budget, and re-points that category's transactions
 *        at it. The line's id is DERIVED from the category's, for the same
 *        reason v3's account is a real record: two devices upgrading the same
 *        ledger independently have to land on the same ids, or the next merge
 *        shows every budget twice.
 */
export const STORE_VERSION = 4 as const;
