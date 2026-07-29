//! Overlay domain entry point — re-exports the overlay window's Tauri commands.
//! This domain has no manager: the overlay is stateless, just an event relay.

mod commands;

pub use commands::*;
