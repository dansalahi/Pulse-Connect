//! Production `VoiceAdapter` implementation: emits Tauri events for the
//! frontend to act on, since the actual LiveKit/WebRTC connection is driven
//! from JS, not Rust.

use std::sync::Arc;
use tokio::sync::RwLock;

use tauri::Emitter;

use crate::shared::error::AppError;

use super::adapter::VoiceAdapter;

// ---------------------------------------------------------------------------
// LiveKitAdapter — emits Tauri events; the frontend drives the actual WebRTC
// ---------------------------------------------------------------------------

pub struct LiveKitAdapter {
    /// Reserved for future Rust-side room tracking.
    #[allow(dead_code)]
    room: Arc<RwLock<Option<String>>>,
}

impl LiveKitAdapter {
    pub fn new() -> Self {
        Self { room: Arc::new(RwLock::new(None)) }
    }
}

impl VoiceAdapter for LiveKitAdapter {
    fn join_room(
        &self,
        app: &tauri::AppHandle,
        token: &str,
        url: &str,
        room_name: &str,
    ) -> Result<(), AppError> {
        tracing::info!(room = room_name, "LiveKitAdapter: join_room");
        let _ = app.emit(
            "voice_join",
            serde_json::json!({ "token": token, "url": url, "room_name": room_name }),
        );
        Ok(())
    }

    fn leave_room(&self, app: &tauri::AppHandle) -> Result<(), AppError> {
        tracing::info!("LiveKitAdapter: leave_room");
        let _ = app.emit("voice_leave", ());
        Ok(())
    }

    fn set_muted(&self, app: &tauri::AppHandle, muted: bool) -> Result<(), AppError> {
        tracing::info!(muted, "LiveKitAdapter: set_muted");
        let _ = app.emit("voice_muted", serde_json::json!({ "muted": muted }));
        Ok(())
    }

    fn set_deafened(&self, app: &tauri::AppHandle, deafened: bool) -> Result<(), AppError> {
        tracing::info!(deafened, "LiveKitAdapter: set_deafened");
        let _ = app.emit("voice_deafened", serde_json::json!({ "deafened": deafened }));
        Ok(())
    }
}
