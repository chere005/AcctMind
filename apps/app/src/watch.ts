/**
 * Keeping the wrist in step.
 *
 * A no-op everywhere there is no watch — the web, Android, the Mac, and an
 * iPhone with no paired watch — so callers never have to ask which surface
 * they are on.
 *
 * The wrist gets a FEED, not the store: the twenty most recent rows and the
 * total of all of them, built by `watchFeed` in core. Sending the whole
 * ledger would be both larger than the channel wants and more than a glance
 * needs, and the total has to count every transaction rather than the twenty
 * that were sent — a wrist showing the sum of the visible rows would be a
 * wrong number presented as a right one.
 */
import { live, watchFeed, type Store } from '@acctmind/core';
import * as bridge from '../modules/watch-bridge';

/** Is there a wrist to talk to? */
export function supported(): boolean {
  return bridge.supported();
}

/**
 * Push the current ledger to the watch. False means it did not go.
 *
 * Tombstones are filtered before the feed is built: a deleted row must not
 * appear on the wrist, and the watch has no merge of its own to work it out.
 */
export async function pushToWatch(store: Store): Promise<boolean> {
  if (!bridge.supported()) return false;
  return bridge.push(JSON.stringify(watchFeed(live(store.txns))));
}
