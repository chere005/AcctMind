/**
 * The shared file in iCloud Drive — the NATIVE half.
 *
 * On a phone this is the Expo module, which reaches the ubiquity container
 * through FileManager and NSFileCoordinator. The `.web.ts` beside this file
 * is the other half: the Tauri Mac shell, which reaches the SAME document by
 * path because it is the web bundle and has no native modules at all.
 *
 * One document, two readers, and neither of them decides anything — see
 * `planSync` in core, and core/src/ubiquity.ts for why a file rather than
 * the key-value store.
 */
import * as native from '../modules/icloud-file';

export const available = native.available;
export const pull = native.pull;
export const push = native.push;
export const onRemoteChange = native.onRemoteChange;
