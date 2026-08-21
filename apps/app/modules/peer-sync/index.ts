/**
 * Local-network sync, and a no-op everywhere it does not exist.
 *
 * Same shape as the other two native modules: off Apple,
 * `requireOptionalNativeModule` returns null and every function here reports
 * "not supported" rather than throwing. The web and Android builds import
 * this file happily and get an app with no peer sync, which is the correct
 * outcome — AcctMind is local-first and sync is a bonus.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

/** A frame arrived from a peer. `json` is opaque here — core reads it. */
export type FrameEvent = { peer: string; json: string };
export type PeerEvent = { peer: string };

type Events = {
  onFrame: (e: FrameEvent) => void;
  onPeerReady: (e: PeerEvent) => void;
  onPeerGone: (e: PeerEvent) => void;
};

declare class PeerSyncNative extends NativeModule<Events> {
  isSupported(): boolean;
  newSecret(): string;
  savedSecret(): string | null;
  saveSecret(hex: string): boolean;
  forgetSecret(): boolean;
  start(hex: string, serviceType: string, maxBytes: number): boolean;
  stop(): void;
  peerCount(): number;
  send(peer: string, json: string): boolean;
}

const native = requireOptionalNativeModule<PeerSyncNative>('PeerSync');

export function supported(): boolean {
  try {
    return native?.isSupported() ?? false;
  } catch {
    return false;
  }
}

/** 120 bits of platform randomness, as hex. Throws only if the CSPRNG does. */
export function newSecret(): string | null {
  try {
    return native?.newSecret() ?? null;
  } catch {
    return null;
  }
}

/** The secret from a previous pairing, or null if this device is unpaired. */
export function savedSecret(): string | null {
  try {
    return native?.savedSecret() ?? null;
  } catch {
    return null;
  }
}

export function saveSecret(hex: string): boolean {
  try {
    return native?.saveSecret(hex) ?? false;
  } catch {
    return false;
  }
}

/** Unpair. Stops the link first, so nothing is still talking afterwards. */
export function forgetSecret(): boolean {
  try {
    return native?.forgetSecret() ?? false;
  } catch {
    return false;
  }
}

export function start(hex: string, serviceType: string, maxBytes: number): boolean {
  try {
    return native?.start(hex, serviceType, maxBytes) ?? false;
  } catch {
    return false;
  }
}

export function stop(): void {
  try {
    native?.stop();
  } catch {
    // Stopping something that is not running is not a failure.
  }
}

export function peerCount(): number {
  try {
    return native?.peerCount() ?? 0;
  } catch {
    return 0;
  }
}

export function send(peer: string, json: string): boolean {
  try {
    return native?.send(peer, json) ?? false;
  } catch {
    return false;
  }
}

export function onFrame(handler: (e: FrameEvent) => void): () => void {
  if (native === null) return () => {};
  const sub = native.addListener('onFrame', handler);
  return () => sub.remove();
}

export function onPeerReady(handler: (e: PeerEvent) => void): () => void {
  if (native === null) return () => {};
  const sub = native.addListener('onPeerReady', handler);
  return () => sub.remove();
}

export function onPeerGone(handler: (e: PeerEvent) => void): () => void {
  if (native === null) return () => {};
  const sub = native.addListener('onPeerGone', handler);
  return () => sub.remove();
}
