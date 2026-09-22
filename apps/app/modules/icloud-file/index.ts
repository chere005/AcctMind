/**
 * The shared file in iCloud Drive, and a no-op everywhere it does not exist.
 *
 * Same shape as the other native modules: off Apple,
 * `requireOptionalNativeModule` returns null and every function here reports
 * "unavailable" rather than throwing. The web and Android builds import this
 * happily and get an app with one fewer transport, which is the correct
 * outcome — AcctMind is local-first and sync is a bonus.
 *
 * THE TAURI MAC APP DOES NOT COME THROUGH HERE. It is the web bundle, so
 * this module is the null branch for it; it reaches the same file by PATH,
 * through `src/icloudfile.web.ts`. Two readers of one document, which is the
 * whole point of choosing a document (see the Swift module's header).
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

type Events = {
  /** The file changed underneath us. Carries nothing — ask `pull`. */
  onRemoteChange: () => void;
};

declare class ICloudFileNative extends NativeModule<Events> {
  isAvailable(): Promise<boolean>;
  get(): Promise<string | null>;
  set(value: string): Promise<boolean>;
  watch(): Promise<void>;
}

const native = requireOptionalNativeModule<ICloudFileNative>('ICloudFile');

/**
 * Is the container reachable? False when signed out of iCloud, and off
 * Apple entirely.
 *
 * ASYNC, unlike the key-value module's — resolving a ubiquity container
 * blocks, and Apple says not to do it on the main thread.
 */
export async function available(): Promise<boolean> {
  if (native === null) return false;
  try {
    return await native.isAvailable();
  } catch {
    return false;
  }
}

/**
 * The shared file's contents.
 *
 * `null` means there is not one yet — NOT an empty ledger. `planSync`'s
 * first rule turns on being able to tell those apart.
 */
export async function pull(): Promise<string | null> {
  if (native === null) return null;
  try {
    return await native.get();
  } catch {
    return null;
  }
}

/** Write the ledger out. `false` means it did not go. Never throws. */
export async function push(value: string): Promise<boolean> {
  if (native === null) return false;
  try {
    return await native.set(value);
  } catch {
    return false;
  }
}

/**
 * Say when the file changes, and start watching for it.
 *
 * Returns the unsubscribe. Calling it more than once is safe; the native
 * side keeps one query.
 */
export function onRemoteChange(handler: () => void): () => void {
  if (native === null) return () => {};
  try {
    const sub = native.addListener('onRemoteChange', handler);
    void native.watch();
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
