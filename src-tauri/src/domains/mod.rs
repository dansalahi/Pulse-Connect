//! Domain layer root: groups the app's business-logic domains (auth, friends,
//! hotkeys, overlay, telemetry, voice), each split into `manager` (logic) and
//! `commands` (`#[tauri::command]` wrappers).

pub mod auth;
pub mod friends;
pub mod hotkeys;
pub mod overlay;
pub mod telemetry;
pub mod voice;
