//! Public surface of the friends domain: re-exports `commands` (Tauri IPC
//! wrappers) and `manager` (`FriendsManager`, `Friend`, `BlockedUser`, etc.).

mod commands;
mod manager;

pub use commands::*;
pub use manager::*;
