//! Tauri commands for the voice domain: requesting LiveKit tokens and driving
//! join/leave/mute/deafen through `VoiceManager`, plus call invite/respond/cancel
//! signaling against the mock backend's HTTP API.

use serde::{Deserialize, Serialize};

use crate::domains::auth::AuthManager;
use crate::domains::telemetry::Telemetry;
use crate::shared::error::AppError;
use crate::shared::validation::validate_string;

use super::manager::VoiceManager;

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
    telemetry: tauri::State<'_, Telemetry>,
) -> Result<VoiceJoinResponse, AppError> {
    validate_string(&room_name, 100, "room_name")?;
    validate_string(&friend_id, 64, "friend_id")?;
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
    telemetry: tauri::State<'_, Telemetry>,
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
    validate_string(&target_user_id, 64, "target_user_id")?;
    validate_string(&room_name, 100, "room_name")?;
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
    validate_string(&room_name, 100, "room_name")?;
    validate_string(&caller_user_id, 64, "caller_user_id")?;
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
    validate_string(&target_user_id, 64, "target_user_id")?;
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
