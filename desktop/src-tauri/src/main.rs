// AcctMind desktop — the same web export in a native window, for macOS and
// Windows. Behaviour lives in the shared JavaScript; Rust opens the window,
// and since 2026-09-21 it also reads and writes ONE FILE.
//
// That file is the exception the original rule ("if this file ever grows a
// feature, that feature exists on two of six surfaces and is in the wrong
// language") was written to prevent, and it is not one. Nothing below
// DECIDES anything: it moves an opaque string between the webview and a
// path, exactly as the Swift modules on the phone move one between the
// webview and NSUbiquitousKeyValueStore. Every rule about what that string
// means — merging, pruning, whether to publish at all — is `planSync` in
// packages/core, shared by all six surfaces. A webview cannot open a file;
// that is the whole of why this is here.
//
// Sean, 2026-09-21: "store file in an iCloud Drive container both read."
// The Tauri shell has none of the app's native modules and never will, so
// an ordinary path in iCloud Drive is the only thing it and the phone can
// both see. See core/src/ubiquity.ts.
//
// No sign-in here, deliberately: the doorway gates the WEB app because the
// web app is on the open internet. The desktop shell carries its own copy of
// the bundle and reads a ledger that never leaves the machine, so there is
// nothing for a password to protect.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

/// The container's folder name, as the FILESYSTEM spells it: the
/// identifier `iCloud.com.seancheren.acctmind` with every `.` turned into
/// a `~`. Apple's rule.
///
/// Written out rather than derived, and hardcoded rather than passed in
/// from JavaScript. The Swift module does the same, and core's
/// `ubiquityFolder` pins the spelling with a test — three copies of one
/// string, each pointing at the others, and NO path arriving from the
/// webview. A `write(path, value)` command would let anything running in
/// that window write anywhere on the disk; this one can only ever touch a
/// single file.
const CONTAINER: &str = "iCloud~com~seancheren~acctmind";
const STORE_FILE: &str = "store.json";

/// `~/Library/Mobile Documents/<container>/Documents/store.json`, or None
/// when there is no home to hang it off.
///
/// Windows has no such thing and answers None, which is the same "one
/// fewer transport" every non-Apple surface reports.
fn store_path() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let home = std::env::var_os("HOME")?;
    let mut path = PathBuf::from(home);
    path.push("Library/Mobile Documents");
    path.push(CONTAINER);
    path.push("Documents");
    path.push(STORE_FILE);
    Some(path)
}

/// The shared file's contents, or None when there is not one yet.
///
/// None is "nothing up there", NOT an empty ledger — `planSync`'s first
/// rule depends on telling those apart, and an unreadable file (iCloud has
/// not downloaded it, the folder is not there, macOS refused us) is also
/// None rather than an error: the app is local-first and a missing
/// transport must never look like a missing ledger.
#[tauri::command]
fn icloud_read() -> Option<String> {
    std::fs::read_to_string(store_path()?).ok()
}

/// Write the ledger out. `false` means it did not go.
///
/// The Documents folder is created if it is absent — the container exists
/// before Documents does, and the very first write would otherwise fail
/// for a reason nobody could act on.
///
/// Written to a neighbour and RENAMED, which on macOS is atomic within one
/// filesystem: a reader on another device must never see half a ledger,
/// and iCloud uploads whatever is at the path when it looks.
#[tauri::command]
fn icloud_write(value: String) -> bool {
    let Some(path) = store_path() else { return false };
    let Some(dir) = path.parent() else { return false };
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let temp = dir.join("store.json.writing");
    if std::fs::write(&temp, value).is_err() {
        return false;
    }
    if std::fs::rename(&temp, &path).is_err() {
        let _ = std::fs::remove_file(&temp);
        return false;
    }
    true
}

/// Is the container there at all?
///
/// The DIRECTORY, not the file: a Mac signed into iCloud with this app's
/// container known to the account has the folder whether or not anything
/// has written the ledger into it yet, and "no file yet" is a normal first
/// run rather than an unavailable transport.
#[tauri::command]
fn icloud_available() -> bool {
    store_path()
        .and_then(|p| p.parent().map(|d| d.is_dir()))
        .unwrap_or(false)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            icloud_read,
            icloud_write,
            icloud_available
        ])
        .run(tauri::generate_context!())
        .expect("error while running AcctMind");
}
