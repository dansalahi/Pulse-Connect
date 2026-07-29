//! Application bootstrap layer: wires together the Tauri `setup()` routine
//! and process-lifetime state (e.g. cold-start timing) shared across `app`.

pub mod setup;
pub mod state;
