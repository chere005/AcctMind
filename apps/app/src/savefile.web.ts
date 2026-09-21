/**
 * Hand the person a file — the WEB half, which is also the desktop half:
 * the Tauri shells serve this same bundle.
 *
 * CoreMind canon's `savefile.web.ts` byte for byte in everything that
 * matters, and the note there is the one worth keeping: the object URL is
 * revoked on a DELAY, because revoking it synchronously races the start of
 * the download in WebKit and hands the person an empty file.
 *
 * The media type is the one difference — this app exports a CSV, and a
 * browser told `application/json` will happily offer to save `.csv` as JSON.
 */
export async function saveTextFile(name: string, text: string): Promise<string> {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Saved ${name}`;
}
