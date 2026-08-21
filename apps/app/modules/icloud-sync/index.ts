/**
 * iCloud key-value sync, and a no-op everywhere it does not exist.
 *
 * The native side is Apple-only. On the web, on Android, and in any Node
 * harness, `requireOptionalNativeModule` returns null and every function here
 * degrades to "iCloud is unavailable" — which is also exactly what an iPhone
 * with no iCloud account reports, so there is ONE unavailable path rather than
 * a platform check at every call site. AcctMind is local-first; sync is a
 * bonus, and a missing module must never be an error.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

export type RemoteChange = {
  /** NSUbiquitousKeyValueStoreChangeReasonKey, or -1 if absent. */
  reason: number;
  /** The remote store as it stands now, or null if there has never been one. */
  value: string | null;
};

type Events = {
  onRemoteChange: (event: RemoteChange) => void;
};

declare class ICloudSyncNative extends NativeModule<Events> {
  isAvailable(): boolean;
  get(): Promise<string | null>;
  set(value: string): Promise<boolean>;
  remainingBytes(): number;
}

const native = requireOptionalNativeModule<ICloudSyncNative>('ICloudSync');

/** Is iCloud usable right now? False when signed out, and off Apple entirely. */
export function available(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

/**
 * The remote copy.
 *
 * `null` means there has never been one — NOT an empty ledger. The caller
 * must not merge an absent remote into a present local and conclude that
 * everything was deleted.
 */
export async function pull(): Promise<string | null> {
  if (native === null) return null;
  try {
    return await native.get();
  } catch {
    return null;
  }
}

/**
 * Publish the local copy. `false` means it did not go — too big, or no iCloud.
 *
 * Never throws and never silently succeeds: a write that stops syncing
 * without saying so is the failure this whole module has to avoid.
 */
export async function push(value: string): Promise<boolean> {
  if (native === null) return false;
  try {
    return await native.set(value);
  } catch {
    return false;
  }
}

/** Roughly how many bytes are left of iCloud's one-megabyte allowance. */
export function remainingBytes(): number {
  try {
    return native?.remainingBytes() ?? 0;
  } catch {
    return 0;
  }
}

/** Listen for another device's write. Returns the unsubscribe. */
export function subscribe(onChange: (e: RemoteChange) => void): () => void {
  if (native === null) return () => {};
  const sub = native.addListener('onRemoteChange', onChange);
  return () => sub.remove();
}
