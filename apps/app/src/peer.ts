/**
 * The local-network link, wired to the ledger.
 *
 * The native module moves opaque strings between two devices. This file is
 * the only place that knows those strings are ledgers, and even here the
 * decisions are not made: `planSync` in core answers all three questions —
 * what to hold, whether to save it, what to send back — and it is the same
 * function iCloud sync uses, tested in `packages/core/test/peer.test.ts`
 * against the peer path specifically.
 *
 * THE SECRET IS THE NETWORK. One secret is shared by every device the person
 * has paired, the way a wifi password is: showing the code on one device and
 * typing it on a second joins the second to the first, and typing it on a
 * third joins all three. So `myCode` returns the EXISTING secret when there
 * is one and only mints a new one for a device that has never paired —
 * minting on every view would silently evict the devices already paired.
 *
 * WHAT STOPS TWO DEVICES TALKING FOR EVER. Two things, deliberately at
 * different levels. Here: never hand a peer bytes it was just handed, which
 * combined with `planSync`'s "publish only when it is news" settles a real
 * exchange in two frames. In the native layer: a token bucket on what
 * ARRIVES, which is not about our own logic being right but about a peer on
 * an open wifi network that is not running our logic at all.
 */
import {
  PEER_MAX_BYTES, PEER_SERVICE, formatPairCode, parsePairCode, planSync, serialize,
  type Store,
} from '@acctmind/core';
import * as native from '../modules/peer-sync';

/** What the app has to supply for the link to be worth running. */
export type Wiring = {
  /**
   * The ledger as it stands at the moment a frame arrives — read, not
   * captured. `null` means the app is still loading or could not read its
   * own store, and in both cases nothing may be merged into it.
   */
  current: () => Store | null;
  /** A merge produced something this device did not have. Save and redraw. */
  merged: (store: Store) => void;
  /** How many devices are connected right now. */
  status: (peers: number) => void;
};

let wiring: Wiring | null = null;
const connected = new Set<string>();
/** Per peer, the last bytes we handed it. See the header. */
const lastSent = new Map<string, string>();

export function supported(): boolean {
  return native.supported();
}

/** Has this device ever been paired? */
export function paired(): boolean {
  return native.savedSecret() !== null;
}

/**
 * The code to read out to another device.
 *
 * Mints a secret on a device that has never paired — which is what makes
 * showing the code the act of forming the group — and returns the existing
 * one otherwise.
 */
export function myCode(): string | null {
  let hex = native.savedSecret();
  if (hex === null) {
    hex = native.newSecret();
    if (hex === null || !native.saveSecret(hex)) return null;
    restart();
  }
  try {
    return formatPairCode(hex);
  } catch {
    // `formatPairCode` throws on a secret that is not 15 bytes of hex, which
    // means what came out of the Keychain is not what went in. Returning null
    // puts a sentence on the pairing screen; letting it throw would take the
    // whole app down on the way to a screen about syncing.
    return null;
  }
}

/** Join the group whose code this is. */
export function acceptCode(typed: string): { ok: true } | { ok: false; error: string } {
  const parsed = parsePairCode(typed);
  if (!parsed.ok) return parsed;
  if (!native.saveSecret(parsed.secretHex)) {
    return { ok: false, error: 'This device would not store the pairing secret.' };
  }
  restart();
  return { ok: true };
}

/** Leave the group. The link stops before the secret goes. */
export function unpair(): void {
  native.forgetSecret();
  connected.clear();
  lastSent.clear();
  wiring?.status(0);
}

/**
 * Subscribe to the link and start it if this device is paired.
 *
 * Returns the teardown, so React's effect cleanup does the right thing and
 * a fast refresh does not leave two sets of listeners merging every frame
 * twice.
 */
export function attach(w: Wiring): () => void {
  wiring = w;

  const subs = [
    native.onPeerReady(({ peer }) => {
      connected.add(peer);
      w.status(connected.size);
      // Open with our whole ledger. The peer answers only if it has news.
      const store = w.current();
      if (store !== null) handTo(peer, serialize(store));
    }),
    native.onPeerGone(({ peer }) => {
      connected.delete(peer);
      lastSent.delete(peer);
      w.status(connected.size);
    }),
    native.onFrame(({ peer, json }) => {
      const local = w.current();
      // Never merge into a store this device could not read. The local copy
      // is the thing in doubt; merging would launder the damage into it.
      if (local === null) return;
      const plan = planSync(local, json, Date.now());
      if (plan.save) w.merged(plan.store);
      if (plan.publish !== null) handTo(peer, plan.publish);
    }),
  ];

  restart();

  return () => {
    for (const off of subs) off();
    native.stop();
    connected.clear();
    lastSent.clear();
    wiring = null;
  };
}

/** Push a local edit to whoever is connected. */
export function publish(store: Store): void {
  if (connected.size === 0) return;
  const bytes = serialize(store);
  for (const peer of connected) handTo(peer, bytes);
}

function handTo(peer: string, bytes: string): void {
  // The same ledger twice is the echo that starts a conversation nobody
  // needs. Rule 2 in core stops it in the general case; this stops it even
  // when the two devices are already agreed and something re-triggers a push.
  if (lastSent.get(peer) === bytes) return;
  lastSent.set(peer, bytes);
  native.send(peer, bytes);
}

function restart(): void {
  const hex = native.savedSecret();
  if (hex === null) {
    native.stop();
    return;
  }
  native.start(hex, PEER_SERVICE, PEER_MAX_BYTES);
}
