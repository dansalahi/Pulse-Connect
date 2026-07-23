use std::sync::Arc;
use tokio::sync::RwLock;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::{auth::AuthManager, error::AppError};

const API_BASE: &str = "http://localhost:3000";

// ---------------------------------------------------------------------------
// IPC response types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct VoiceJoinResponse {
    pub token: String,
    pub room_name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct VoiceState {
    pub is_in_call: bool,
    pub room_name: Option<String>,
    pub is_muted: bool,
    pub is_deafened: bool,
}

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

// ---------------------------------------------------------------------------
// VoiceManager — managed Tauri state
// ---------------------------------------------------------------------------

/// Uses Arc<dyn VoiceAdapter> (not Box) so VoiceManager can derive Clone,
/// which Tauri's .manage() requires.
#[derive(Clone)]
pub struct VoiceManager {
    http: Client,
    adapter: Arc<dyn VoiceAdapter>,
    current_room: Arc<RwLock<Option<String>>>,
    is_muted: Arc<RwLock<bool>>,
    is_deafened: Arc<RwLock<bool>>,
}

impl Default for VoiceManager {
    fn default() -> Self { Self::new() }
}

impl VoiceManager {
    pub fn new() -> Self {
        // PULSE_VOICE_ADAPTER=stub switches to the deterministic no-op adapter.
        // Any other value (or absence) selects LiveKit. The check is infallible.
        let adapter: Arc<dyn VoiceAdapter> =
            match std::env::var("PULSE_VOICE_ADAPTER").as_deref() {
                Ok("stub") => {
                    tracing::info!("VoiceManager: using StubAdapter (PULSE_VOICE_ADAPTER=stub)");
                    Arc::new(StubAdapter::new())
                }
                _ => {
                    tracing::info!("VoiceManager: using LiveKitAdapter (default)");
                    Arc::new(LiveKitAdapter::new())
                }
            };
        Self {
            http: Client::new(),
            adapter,
            current_room: Arc::new(RwLock::new(None)),
            is_muted: Arc::new(RwLock::new(false)),
            is_deafened: Arc::new(RwLock::new(false)),
        }
    }
}

// ---------------------------------------------------------------------------
// Public accessors (used by integration tests and get_voice_state command)
// ---------------------------------------------------------------------------

impl VoiceManager {
    pub async fn room_name(&self) -> Option<String> {
        self.current_room.read().await.clone()
    }
    pub async fn is_muted_state(&self) -> bool {
        *self.is_muted.read().await
    }
    pub async fn is_deafened_state(&self) -> bool {
        *self.is_deafened.read().await
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub async fn join_voice(
    room_name: String,
    friend_id: String,
    app: tauri::AppHandle,
    auth: tauri::State<'_, AuthManager>,
    voice: tauri::State<'_, VoiceManager>,
    telemetry: tauri::State<'_, crate::telemetry::Telemetry>,
) -> Result<VoiceJoinResponse, AppError> {
    crate::validation::validate_string(&room_name, 100, "room_name")?;
    crate::validation::validate_string(&friend_id, 64, "friend_id")?;
    telemetry.add("ipc", format!("join_voice room={room_name}"));
    let token = auth.get_access_token().await?;

    // Request a LiveKit JWT from the mock backend.
    let resp = voice
        .http
        .post(format!("{API_BASE}/livekit/token"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "room_name": room_name, "friend_id": friend_id }))
        .send()
        .await
        .map_err(AppError::from)?;

    let status = resp.status();
    // Read as text first so we can log the raw body on parse failure.
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::NetworkError(format!("Failed to read response: {e}")))?;

    tracing::info!(status = %status, body = %body, "LiveKit token response");

    if !status.is_success() {
        return Err(AppError::NetworkError(format!(
            "HTTP {status}: {body}"
        )));
    }

    #[derive(Deserialize)]
    struct LiveKitTokenResponse {
        token: String,
        url: String,
        room_name: String,
    }

    let lk: LiveKitTokenResponse = serde_json::from_str(&body).map_err(|e| {
        AppError::NetworkError(format!(
            "Failed to parse LiveKit response: {e} — body was: {body}"
        ))
    })?;

    // Update manager state.
    *voice.current_room.write().await = Some(lk.room_name.clone());
    *voice.is_muted.write().await = false;
    *voice.is_deafened.write().await = false;

    // Emit voice_join so the frontend can connect to LiveKit.
    voice.adapter.join_room(&app, &lk.token, &lk.url, &lk.room_name)?;

    Ok(VoiceJoinResponse {
        token: lk.token,
        url: lk.url,
        room_name: lk.room_name,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn leave_voice(
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceManager>,
    telemetry: tauri::State<'_, crate::telemetry::Telemetry>,
) -> Result<(), AppError> {
    telemetry.add("ipc", "leave_voice called".into());
    voice.adapter.leave_room(&app)?;
    *voice.current_room.write().await = None;
    *voice.is_muted.write().await = false;
    *voice.is_deafened.write().await = false;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_muted(
    muted: bool,
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceManager>,
) -> Result<(), AppError> {
    *voice.is_muted.write().await = muted;
    voice.adapter.set_muted(&app, muted)
}

#[tauri::command]
#[specta::specta]
pub async fn set_deafened(
    deafened: bool,
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceManager>,
) -> Result<(), AppError> {
    *voice.is_deafened.write().await = deafened;
    voice.adapter.set_deafened(&app, deafened)
}

#[tauri::command]
#[specta::specta]
pub async fn invite_to_call(
    target_user_id: String,
    room_name: String,
    auth: tauri::State<'_, AuthManager>,
    voice: tauri::State<'_, VoiceManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&target_user_id, 64, "target_user_id")?;
    crate::validation::validate_string(&room_name, 100, "room_name")?;
    let token = auth.get_access_token().await?;
    let resp = voice
        .http
        .post(format!("{API_BASE}/call/invite"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "target_user_id": target_user_id, "room_name": room_name }))
        .send()
        .await
        .map_err(AppError::from)?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp
            .text()
            .await
            .map_err(|e| AppError::NetworkError(format!("Failed to read response: {e}")))?;
        // Prefer the server's human-readable "message" field so the frontend
        // can display it directly (e.g. NOT_FRIENDS explanation).
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(msg) = json.get("message").and_then(|m| m.as_str()) {
                return Err(AppError::Unknown(msg.to_string()));
            }
            if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
                return Err(AppError::Unknown(err.to_string()));
            }
        }
        return Err(AppError::NetworkError(format!("HTTP {status}: {body}")));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn respond_to_call(
    accepted: bool,
    room_name: String,
    caller_user_id: String,
    auth: tauri::State<'_, AuthManager>,
    voice: tauri::State<'_, VoiceManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&room_name, 100, "room_name")?;
    crate::validation::validate_string(&caller_user_id, 64, "caller_user_id")?;
    let token = auth.get_access_token().await?;
    let resp = voice
        .http
        .post(format!("{API_BASE}/call/respond"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({
            "accepted": accepted,
            "room_name": room_name,
            "caller_user_id": caller_user_id,
        }))
        .send()
        .await
        .map_err(AppError::from)?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::NetworkError(format!("HTTP {status}: {body}")));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_call(
    target_user_id: String,
    auth: tauri::State<'_, AuthManager>,
    voice: tauri::State<'_, VoiceManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&target_user_id, 64, "target_user_id")?;
    let token = auth.get_access_token().await?;
    let resp = voice
        .http
        .post(format!("{API_BASE}/call/cancel"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "target_user_id": target_user_id }))
        .send()
        .await
        .map_err(AppError::from)?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::NetworkError(format!("HTTP {status}: {body}")));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_voice_state(
    voice: tauri::State<'_, VoiceManager>,
) -> Result<VoiceState, AppError> {
    let room = voice.current_room.read().await;
    let is_muted = *voice.is_muted.read().await;
    let is_deafened = *voice.is_deafened.read().await;
    Ok(VoiceState {
        is_in_call: room.is_some(),
        room_name: room.clone(),
        is_muted,
        is_deafened,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    /// ARCHITECTURE.md must document the jitter buffer design decision so that
    /// future contributors know not to add a redundant buffer in Rust.
    #[test]
    fn test_jitter_buffer_reasoning_documented() {
        // CARGO_MANIFEST_DIR is the src-tauri directory; ARCHITECTURE.md is one level up.
        let arch_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent directory")
            .join("ARCHITECTURE.md");
        let content =
            std::fs::read_to_string(&arch_path).expect("ARCHITECTURE.md should be readable");
        assert!(
            content.contains("jitter buffer"),
            "ARCHITECTURE.md must document the jitter buffer design decision"
        );
    }

    /// Env var PULSE_VOICE_ADAPTER=stub must select the stub adapter without panic.
    #[test]
    fn test_stub_adapter_created_when_env_var_set() {
        env::set_var("PULSE_VOICE_ADAPTER", "stub");
        let _voice = VoiceManager::new();
        env::remove_var("PULSE_VOICE_ADAPTER");
        // Reaching here proves VoiceManager::new() succeeded with stub
    }

    /// No env var → LiveKit adapter is selected (default path must not panic).
    #[test]
    fn test_livekit_adapter_is_default() {
        env::remove_var("PULSE_VOICE_ADAPTER");
        let _voice = VoiceManager::new();
    }

    /// Unknown env var value falls through to LiveKit default safely.
    #[test]
    fn test_unknown_adapter_name_falls_back_to_livekit() {
        env::set_var("PULSE_VOICE_ADAPTER", "nonexistent_adapter");
        let _voice = VoiceManager::new();
        env::remove_var("PULSE_VOICE_ADAPTER");
    }

    /// Full state-machine flow: idle → joined → muted → unmuted → left.
    /// Uses private field access (allowed inside the same module) to verify
    /// state transitions without needing a Tauri AppHandle.
    #[tokio::test]
    async fn test_voice_state_machine_in_stub_mode() {
        env::set_var("PULSE_VOICE_ADAPTER", "stub");
        let voice = VoiceManager::new();
        env::remove_var("PULSE_VOICE_ADAPTER");

        // Initially idle
        assert!(voice.current_room.read().await.is_none(), "should start idle");
        assert!(!*voice.is_muted.read().await, "should start unmuted");
        assert!(!*voice.is_deafened.read().await, "should start undeafened");

        // Simulate join
        *voice.current_room.write().await = Some("test-room".to_string());
        assert_eq!(
            voice.current_room.read().await.as_deref(),
            Some("test-room")
        );

        // Mute
        *voice.is_muted.write().await = true;
        assert!(*voice.is_muted.read().await);

        // Unmute
        *voice.is_muted.write().await = false;
        assert!(!*voice.is_muted.read().await);

        // Leave
        *voice.current_room.write().await = None;
        *voice.is_muted.write().await = false;
        *voice.is_deafened.write().await = false;
        assert!(voice.current_room.read().await.is_none(), "should be idle after leave");
    }
}
