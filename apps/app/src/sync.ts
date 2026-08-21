/**
 * Keeping the phone and the Mac in step, with nothing in the middle.
 *
 * Both run the SAME iOS binary — the Mac under "Designed for iPad" — so they
 * share a bundle identifier and therefore share one iCloud key-value store.
 * Neither is a server and neither is in charge; each publishes its own copy
 * and merges whatever it finds, and `packages/core`'s merge makes that safe
 * to do in any order, any number of times.
 *
 * The three rules this file exists to hold:
 *
 *  1. **An absent remote is not an empty ledger.** The first device to sync
 *     finds nothing up there. Merging "nothing" into a full local store must
 *     publish the local store, never conclude everything was deleted.
 *  2. **Only publish when the result differs from what is already up there.**
 *     Otherwise every device answers every notification with a write, each
 *     write wakes the others, and the two of them talk for ever over a ledger
 *     nobody changed.
 *  3. **A failed publish is reported, not swallowed.** iCloud's quota is one
 *     megabyte and exceeding it fails SILENTLY at the system level: the value
 *     stays readable on the device that wrote it and never reaches another.
 */
import { mergeStores, sameStore, parseStore, prune, serialize, type Store } from '@acctmind/core';
import * as iCloud from '../modules/icloud-sync';

export type SyncOutcome = {
  /** What both devices should now hold. */
  store: Store;
  /** Did the local copy change? Then save it and re-render. */
  changedLocally: boolean;
  /** Did we publish? */
  published: boolean;
  /** Set when a publish was refused — the ledger outgrew iCloud's megabyte. */
  tooBig: boolean;
};

/** Is sync switched on for this device at all? */
export function available(): boolean {
  return iCloud.available();
}

/**
 * Merge iCloud into `local` and publish the result if it is news up there.
 *
 * `remote` may be handed in by the change notification, which already carries
 * the new value — saving a round trip and, more importantly, removing the
 * window where a fresh `pull()` could return something older than the value
 * that triggered us.
 */
export async function reconcile(local: Store, remote?: string | null): Promise<SyncOutcome> {
  if (!iCloud.available()) {
    return { store: local, changedLocally: false, published: false, tooBig: false };
  }

  const raw = remote === undefined ? await iCloud.pull() : remote;

  // Rule 1. Nothing up there yet: this device is the first, so publish and
  // change nothing locally.
  if (raw === null) {
    const ok = await iCloud.push(serialize(local));
    return { store: local, changedLocally: false, published: ok, tooBig: !ok };
  }

  const parsed = parseStore(raw);
  if (!parsed.ok) {
    // Damaged remote. Same rule as a damaged local store: do not act on it,
    // and above all do not overwrite the local ledger with it. Publishing
    // ours over it IS safe and is how a corrupt remote heals.
    const ok = await iCloud.push(serialize(local));
    return { store: local, changedLocally: false, published: ok, tooBig: !ok };
  }

  const merged = prune(mergeStores(local, parsed.store), Date.now());

  // Rule 2. Publish only if what we hold differs from what is up there.
  const published = sameStore(merged, parsed.store) ? false : await iCloud.push(serialize(merged));
  const tooBig = !sameStore(merged, parsed.store) && !published;

  return {
    store: merged,
    changedLocally: !sameStore(merged, local),
    published,
    tooBig,
  };
}

/** Publish after a local edit. Returns false if it did not go. */
export async function publish(store: Store): Promise<boolean> {
  if (!iCloud.available()) return false;
  return iCloud.push(serialize(store));
}

/** Another device wrote. The value it wrote comes with the notification. */
export function onRemoteChange(handler: (remote: string | null) => void): () => void {
  return iCloud.subscribe((e) => handler(e.value));
}
