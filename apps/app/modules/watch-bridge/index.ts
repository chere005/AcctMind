/**
 * The watch link, and a no-op everywhere there is no watch.
 *
 * Absent on the web, on Android, on the Mac, and on an iPhone with no paired
 * watch — all the same "not supported" answer, so there is one path rather
 * than a platform check at every call site.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class WatchBridgeNative extends NativeModule {
  isSupported(): boolean;
  push(feedJson: string): Promise<boolean>;
}

const native = requireOptionalNativeModule<WatchBridgeNative>('WatchBridge');

/** Is there a paired watch with the app installed? */
export function supported(): boolean {
  try {
    return native?.isSupported() ?? false;
  } catch {
    return false;
  }
}

/** Hand the wrist a new snapshot. False means it did not go. */
export async function push(feedJson: string): Promise<boolean> {
  if (native === null) return false;
  try {
    return await native.push(feedJson);
  } catch {
    return false;
  }
}
