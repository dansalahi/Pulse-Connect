use crate::shared::error::AppError;

use super::adapter::VoiceAdapter;

// ---------------------------------------------------------------------------
// StubAdapter — deterministic no-op for testing / stretch tasks
// ---------------------------------------------------------------------------

pub struct StubAdapter;

impl StubAdapter {
    pub fn new() -> Self { Self }
}

impl VoiceAdapter for StubAdapter {
    fn join_room(
        &self,
        _app: &tauri::AppHandle,
        token: &str,
        url: &str,
        room_name: &str,
    ) -> Result<(), AppError> {
        tracing::info!(token, url, room = room_name, "StubAdapter: join_room (no-op)");
        Ok(())
    }

    fn leave_room(&self, _app: &tauri::AppHandle) -> Result<(), AppError> {
        tracing::info!("StubAdapter: leave_room (no-op)");
        Ok(())
    }

    fn set_muted(&self, _app: &tauri::AppHandle, muted: bool) -> Result<(), AppError> {
        tracing::info!(muted, "StubAdapter: set_muted (no-op)");
        Ok(())
    }

    fn set_deafened(&self, _app: &tauri::AppHandle, deafened: bool) -> Result<(), AppError> {
        tracing::info!(deafened, "StubAdapter: set_deafened (no-op)");
        Ok(())
    }
}
