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
/// IT WILL NOT CREATE THE CONTAINER, and that is the important line here.
/// A ubiquity container is registered by the SYSTEM, the first time an app
/// holding the entitlement resolves it — which on this app means the phone
/// launching once. `create_dir_all` under `Mobile Documents` would happily
/// make a directory of that name anyway, and iCloud would never adopt it:
/// the desktop would report a successful write, every time, into a folder
/// nothing on earth syncs. A sync that says it worked is worse than one
/// that says it cannot.
///
/// So the container must already be there. `Documents` INSIDE it is ours
/// to make — that one is an ordinary subfolder and the first write would
/// otherwise fail for a reason nobody could act on.
///
/// Written to a neighbour and RENAMED, which on macOS is atomic within one
/// filesystem: a reader on another device must never see half a ledger,
/// and iCloud uploads whatever is at the path when it looks.
#[tauri::command]
fn icloud_write(value: String) -> bool {
    let Some(path) = store_path() else { return false };
    let Some(dir) = path.parent() else { return false };
    match dir.parent() {
        Some(container) if container.is_dir() => {}
        _ => return false,
    }
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
/// THE CONTAINER, not `Documents` and not the file. A Mac signed into
/// iCloud has the container folder once the account knows about it — which
/// happens when the phone first launches — and everything inside it is
/// ours to create. Asking about `Documents` instead would report "no
/// iCloud" on a perfectly good container that simply has not been written
/// to yet, which is the state every first run is in.
#[tauri::command]
fn icloud_available() -> bool {
    store_path()
        .and_then(|p| p.parent().and_then(|d| d.parent()).map(|c| c.is_dir()))
        .unwrap_or(false)
}

/// What the container looks like from in here, in one line.
///
/// THE POINT IS THE DIFFERENCE BETWEEN "not there" AND "not allowed".
/// `is_dir()` answers false for both, and on 2026-09-22 that cost an hour:
/// the container existed, the Mac app published nothing, and neither end
/// could say which of the two it was. macOS protects `~/Library/Mobile
/// Documents` under TCC, so an app without the entitlement or Full Disk
/// Access is refused — and refused silently, which is the one thing a sync
/// must never be.
///
/// `symlink_metadata` is what separates them: it reports NotFound for a
/// path that is not there and PermissionDenied for one we may not look at.
#[tauri::command]
fn icloud_status() -> String {
    let Some(path) = store_path() else { return "not macOS".into() };
    let Some(container) = path.parent().and_then(|d| d.parent()) else {
        return "no container path".into();
    };
    match std::fs::symlink_metadata(container) {
        Ok(m) if m.is_dir() => match std::fs::read_dir(container) {
            Ok(_) => format!("container readable; file {}", if path.is_file() { "present" } else { "absent" }),
            Err(e) => format!("container present but unreadable: {e}"),
        },
        Ok(_) => "container path is not a directory".into(),
        Err(e) => format!("container unavailable: {e}"),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            icloud_read,
            icloud_write,
            icloud_available,
            icloud_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running AcctMind");
}
