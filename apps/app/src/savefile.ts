/**
 * Hand the person a file — the NATIVE half, which on this app is a
 * clipboard rather than a share sheet.
 *
 * CalMind's canon (`CoreMind/canon/app/src/savefile.ts`) writes the text to
 * the cache directory and opens the iOS share sheet. That is the better
 * gesture and it is deliberately NOT what this does: it needs
 * `expo-file-system` and `expo-sharing`, and adding two native modules to
 * this app means a prebuild and a fresh binary on the phone before an export
 * works at all. `expo-clipboard` is already here, already compiled into
 * every build that exists, and a CSV on the clipboard pastes into Numbers,
 * Mail or a message — which is where an exported budget was going anyway.
 *
 * `consumers/AcctMind.tsv` carries this as a `fork` for that reason, so the
 * day the share sheet is worth two dependencies the canon copy is one file
 * away.
 *
 * Returns what to TELL the person, because the two halves of this shim
 * succeed in visibly different ways and only the caller has a toast.
 */
import * as Clipboard from 'expo-clipboard';

export async function saveTextFile(_name: string, text: string): Promise<string> {
  await Clipboard.setStringAsync(text);
  return 'Copied to the clipboard';
}
