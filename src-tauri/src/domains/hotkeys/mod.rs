//! Public surface of the hotkeys domain: re-exports `commands` (Tauri IPC
//! wrappers) and `manager` (`HotkeyManager`, `HotkeyAction`, `HotkeyBinding`).

mod commands;
mod manager;

pub use commands::*;
pub use manager::*;
