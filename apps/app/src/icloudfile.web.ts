/**
 * The shared file in iCloud Drive — the WEB half, which is really the Tauri
 * Mac shell.
 *
 * In a browser there is no such file and every function here reports
 * "unavailable", exactly as the native modules do off Apple. Inside the
 * desktop shell `window.__TAURI__` is present and the three commands in
 * `desktop/src-tauri/src/main.rs` do the reading and writing.
 *
 * WHY THIS EXISTS AT ALL. The Tauri app is this same web bundle in a
 * window; it has none of the app's Expo modules, so it can never see
 * NSUbiquitousKeyValueStore or the Bonjour link. An ordinary path in iCloud
 * Drive is the one thing it and the phone can both reach, which is why Sean
 * chose a document over CloudKit (2026-09-21).
 *
 * NO POLLING AND NO EVENTS. macOS gives the shell no notification when
 * iCloud replaces the file underneath it, and a timer in here would be a
 * second answer to "when do we sync" living on one surface only. The
 * desktop reads on launch and after its own writes, which is what a
 * single-window app that is open while you use it actually needs; the phone,
 * which is the device that goes away and comes back, has the metadata query.
 */
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Tauri's own bridge, or null in a browser.
 *
 * `withGlobalTauri` in tauri.conf.json is what puts it there. Importing
 * `@tauri-apps/api` instead would make every surface carry a dependency
 * that only one of them can use.
 */
/*
 * AND THE CSP IS NOT IN THE WAY, which is worth writing down because it
 * looks as though it should be. `desktop/check-assets.sh` asserts
 * `connect-src 'self'` and nothing else — "the desktop talks to nothing but
 * itself" — and Tauri v2 reaches Rust on macOS through a native
 * `postMessage` handler injected into WKWebView, not a request, so no
 * directive applies. It was widened to `ipc: http://ipc.localhost` for
 * half an hour on 2026-09-22 and put back: that is the WINDOWS transport,
 * and on Windows a blocked call throws, `catch` answers false, and false
 * is the right answer there anyway — `store_path()` returns None off macOS.
 */
function bridge(): Invoke | null {
  const w = globalThis as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } };
  return w.__TAURI__?.core?.invoke ?? null;
}

export async function available(): Promise<boolean> {
  const invoke = bridge();
  if (invoke === null) return false;
  try {
    return await invoke<boolean>('icloud_available');
  } catch {
    return false;
  }
}

/** The file's contents, or null when there is not one yet. Never throws. */
export async function pull(): Promise<string | null> {
  const invoke = bridge();
  if (invoke === null) return null;
  try {
    return await invoke<string | null>('icloud_read');
  } catch {
    return null;
  }
}

/** Write the ledger out. `false` means it did not go. Never throws. */
export async function push(value: string): Promise<boolean> {
  const invoke = bridge();
  if (invoke === null) return false;
  try {
    return await invoke<boolean>('icloud_write', { value });
  } catch {
    return false;
  }
}

/**
 * What the container looks like from in here, in one line, for the Devices
 * screen to show.
 *
 * It exists because `available()` answers false for two very different
 * reasons — the folder is not there, and macOS will not let us look —
 * and on 2026-09-22 an hour went into not knowing which. See the Rust
 * command; `symlink_metadata` is what tells them apart.
 */
export async function status(): Promise<string> {
  const invoke = bridge();
  if (invoke === null) return 'not the desktop app';
  try {
    return await invoke<string>('icloud_status');
  } catch (e) {
    return `the bridge refused: ${String(e)}`;
  }
}

/** Nothing tells the shell when the file changes. See the header. */
export function onRemoteChange(_handler: () => void): () => void {
  return () => {};
}
