//! Defines the `VoiceAdapter` trait that abstracts the voice domain's call
//! backend, letting `VoiceManager` swap between LiveKit and stub implementations.

use crate::shared::error::AppError;

// ---------------------------------------------------------------------------
// VoiceAdapter trait
//
// Each method receives the AppHandle so the adapter can emit Tauri events
// without storing the handle itself, keeping the trait object-safe.
// ---------------------------------------------------------------------------

pub trait VoiceAdapter: Send + Sync {
    fn join_room(
        &self,
        app: &tauri::AppHandle,
        token: &str,
        url: &str,
        room_name: &str,
    ) -> Result<(), AppError>;
    fn leave_room(&self, app: &tauri::AppHandle) -> Result<(), AppError>;
    fn set_muted(&self, app: &tauri::AppHandle, muted: bool) -> Result<(), AppError>;
    fn set_deafened(&self, app: &tauri::AppHandle, deafened: bool) -> Result<(), AppError>;
}
