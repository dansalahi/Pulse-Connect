//! Voice domain entry point — re-exports voice call commands and `VoiceManager`.
//! Adapter implementations (LiveKit, stub) stay private; callers only see the
//! `VoiceAdapter` trait surface through the manager.

mod adapter;
mod commands;
mod livekit;
mod manager;
mod stub;

pub use commands::*;
pub use manager::*;
