// AcctMind desktop — the same web export in a native window, for macOS and
// Windows. All behavior lives in the shared JavaScript; Rust opens the window
// and nothing else. If this file ever grows a feature, that feature exists on
// two of six surfaces and is in the wrong language.
//
// No sign-in here, deliberately: the doorway gates the WEB app because the
// web app is on the open internet. The desktop shell carries its own copy of
// the bundle and reads a ledger that never leaves the machine, so there is
// nothing for a password to protect.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running AcctMind");
}
