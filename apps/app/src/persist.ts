/**
 * Where the ledger actually lives: this device, and nowhere else.
 *
 * AsyncStorage is one API across all six surfaces — localStorage in the
 * browser and in both Tauri shells, a native store on iOS and Android — so
 * there is no per-platform branch here to get wrong.
 *
 * The rule this file exists to enforce: **a load that failed must never be
 * saved over.** Core distinguishes an empty store from a damaged one; that
 * distinction is worth nothing if the screen calls `save()` anyway. See
 * `useStore` in App.tsx, which holds the refusal.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseStore, serialize, type LoadResult, type Store } from '@acctmind/core';

/**
 * The key carries the store version. A future v2 writes a different key and
 * leaves v1 where it is, so a downgrade finds its own data instead of a file
 * it cannot read.
 */
export const KEY = 'acctmind.store.v1';

export async function load(): Promise<LoadResult> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch (e) {
    // Storage itself being unavailable is not an empty ledger — it is a
    // device that cannot answer. Saying so stops the caller writing.
    return { ok: false, error: `this device could not read its saved data (${String(e)})` };
  }
  return parseStore(raw);
}

/**
 * Write, and let the caller hear about a failure.
 *
 * Deliberately NOT `.catch(() => {})`. A silent write failure is the exact
 * shape of the worst bugs CalMind found: the app says saved, the disk says
 * nothing, and the data is gone at the next launch.
 */
export async function save(store: Store): Promise<void> {
  await AsyncStorage.setItem(KEY, serialize(store));
}

/** For the harnesses, and for a person who wants a clean device. */
export async function clear(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
