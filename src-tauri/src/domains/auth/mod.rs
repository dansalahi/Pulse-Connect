//! Public surface of the auth domain: re-exports `commands` (Tauri IPC
//! wrappers) and `manager` (`AuthManager`, `AuthUser`) for use by `app` and
//! other domains that need the current session or access token.

mod commands;
mod manager;

pub use commands::*;
pub use manager::*;
