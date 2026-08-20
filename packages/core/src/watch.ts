/**
 * The watch feed: what the wrist is told, and nothing more.
 *
 * The watch is a separate process in another language. It cannot import this
 * file, so it re-implements the formatting — which means there are two
 * implementations of one rule, and they can drift. `tools/check-watch-feed.sh`
 * is the answer to that: it pushes THIS function's real output through the
 * watch's REAL Swift decoder and drawing code and compares the strings. Two
 * copies with a test between them; not two copies and a hope.
 *
 * The keys are one character each. A WatchConnectivity payload is small and
 * capped, and a feed that grows past the cap does not truncate — it fails to
 * send, silently, which reads on the wrist as an app that has stopped
 * updating. `LIMIT` is the second half of the same defence.
 */
import { formatAmount } from './money';
import { sortTxns, total } from './txn';
import type { Txn } from './types';

/** How many rows the wrist gets. A watch is a glance, not a ledger. */
export const WATCH_LIMIT = 20;

export type WatchRow = {
  /** id */        i: string;
  /** name */      n: string;
  /** amount, in cents — formatted ON the watch, by its own copy of the rule */
  a: number;
  /** date, YYYY-MM-DD */ d: string;
};

export type WatchFeed = {
  v: 1;
  /** The running total, in cents. */
  t: number;
  r: WatchRow[];
};

export function watchFeed(txns: readonly Txn[], limit: number = WATCH_LIMIT): WatchFeed {
  return {
    v: 1,
    // The total counts EVERY transaction, not just the ones sent. A wrist
    // showing the sum of the most recent twenty would be a wrong number
    // presented as a right one.
    t: total(txns),
    r: sortTxns(txns).slice(0, limit).map((x) => ({ i: x.id, n: x.name, a: x.amount, d: x.date })),
  };
}

/**
 * The row strings the watch should draw, computed here so the Swift side has
 * something exact to be checked against. The watch does not call this — it
 * cannot — it re-implements it, and the checker holds the two together.
 */
export function drawnRows(feed: WatchFeed): string[] {
  return feed.r.map((r) => `${r.n} ${formatAmount(r.a)}`);
}
