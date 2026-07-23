use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Notify, RwLock};

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::{auth::AuthManager, error::AppError};

const API_BASE: &str = "http://localhost:3000";
const WS_URL: &str = "ws://localhost:3001";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub enum FriendStatus {
    Online,
    InGame,
    DND,
    Offline,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct FriendRequest {
    pub id: String,
    pub from_user_id: String,
    pub from_display_name: String,
    pub from_avatar_url: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct Friend {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    pub status: FriendStatus,
    #[serde(default)]
    pub game: Option<String>,
    #[serde(default)]
    pub is_friend: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct BlockedUser {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

fn validate_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > 64 {
        return Err(AppError::Unknown("ID must be 1–64 characters".to_string()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

fn backoff_base_ms(attempt: u32) -> u64 {
    (1_000u64 << attempt.min(5)).min(30_000)
}

fn backoff_duration(attempt: u32) -> Duration {
    let base = backoff_base_ms(attempt);
    let jitter = rand::thread_rng().gen_range(0u64..=1_000);
    Duration::from_millis(base + jitter)
}

// ---------------------------------------------------------------------------
// FriendsManager
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct FriendsManager {
    http: Client,
    friends: Arc<RwLock<Vec<Friend>>>,
    ws_connected: Arc<AtomicBool>,
    shutdown: Arc<Notify>,
}

impl FriendsManager {
    pub fn new() -> Self {
        Self {
            http: Client::new(),
            friends: Arc::new(RwLock::new(Vec::new())),
            ws_connected: Arc::new(AtomicBool::new(false)),
            shutdown: Arc::new(Notify::new()),
        }
    }

    /// Called when the main window is closing — signals the WS loop to send a
    /// clean close frame so the backend marks this user Offline immediately.
    pub fn signal_shutdown(&self) {
        self.shutdown.notify_one();
    }

    pub fn is_ws_connected(&self) -> bool {
        self.ws_connected.load(Ordering::Relaxed)
    }

    #[tracing::instrument(skip(self, app_handle))]
    pub fn start(&self, app_handle: tauri::AppHandle) {
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            manager.ws_loop(app_handle).await;
        });
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn get_friends(&self, token: &str) -> Result<Vec<Friend>, AppError> {
        let resp = self
            .http
            .get(format!("{API_BASE}/friends"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(AppError::from)?;

        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }

        let list: Vec<Friend> = resp.json().await.map_err(AppError::from)?;
        *self.friends.write().await = list.clone();
        Ok(list)
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn add_friend(&self, token: &str, user_id: String) -> Result<(), AppError> {
        validate_id(&user_id)?;
        let resp = self
            .http
            .post(format!("{API_BASE}/friends/add"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "user_id": user_id }))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn accept_friend(&self, token: &str, request_id: String) -> Result<(), AppError> {
        validate_id(&request_id)?;
        let resp = self
            .http
            .post(format!("{API_BASE}/friends/accept"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "request_id": request_id }))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn reject_friend(&self, token: &str, request_id: String) -> Result<(), AppError> {
        validate_id(&request_id)?;
        let resp = self
            .http
            .post(format!("{API_BASE}/friends/reject"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "request_id": request_id }))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn remove_friend(&self, token: &str, friend_id: String) -> Result<(), AppError> {
        validate_id(&friend_id)?;
        let resp = self
            .http
            .delete(format!("{API_BASE}/friends/{friend_id}"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn block_user(&self, token: &str, user_id: String) -> Result<(), AppError> {
        validate_id(&user_id)?;
        let resp = self
            .http
            .post(format!("{API_BASE}/friends/block"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "user_id": user_id }))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn unblock_user(&self, token: &str, user_id: String) -> Result<(), AppError> {
        validate_id(&user_id)?;
        let resp = self
            .http
            .post(format!("{API_BASE}/friends/unblock"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "user_id": user_id }))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn get_blocked_users(&self, token: &str) -> Result<Vec<BlockedUser>, AppError> {
        let resp = self
            .http
            .get(format!("{API_BASE}/friends/blocked"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        resp.json().await.map_err(AppError::from)
    }

    #[tracing::instrument(skip(self, token))]
    pub async fn set_my_status(
        &self,
        token: &str,
        status: String,
        game: Option<String>,
    ) -> Result<(), AppError> {
        let valid = ["Online", "InGame", "DND"];
        if !valid.contains(&status.as_str()) {
            return Err(AppError::Unknown(format!("Invalid status: {status}")));
        }
        let resp = self
            .http
            .put(format!("{API_BASE}/user/status"))
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "status": status, "game": game }))
            .send()
            .await
            .map_err(AppError::from)?;
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // WebSocket internals
    // -----------------------------------------------------------------------

    async fn ws_loop(&self, app: tauri::AppHandle) {
        let mut attempt = 0u32;
        loop {
            tracing::info!(attempt, "Connecting to WebSocket");
            match connect_async(WS_URL).await {
                Ok((ws_stream, _)) => {
                    tracing::info!("WebSocket connected");
                    self.ws_connected.store(true, Ordering::Relaxed);
                    let _ = app.emit("ws_connected", ());
                    attempt = 0;

                    // Get access token for WS auth handshake.
                    let token = match app.state::<AuthManager>().get_access_token().await {
                        Ok(t) => t,
                        Err(_) => {
                            tracing::warn!("No access token available for WS auth");
                            String::new()
                        }
                    };

                    let (mut write, mut read) = ws_stream.split();

                    // Send auth immediately after connect.
                    let auth_msg = serde_json::json!({ "type": "auth", "token": token });
                    if let Err(e) = write.send(Message::Text(auth_msg.to_string().into())).await {
                        tracing::warn!(error = %e, "Failed to send WS auth message");
                    }

                    // Pin the shutdown future once per connection so select! can reuse it.
                    let shutdown_notified = self.shutdown.notified();
                    tokio::pin!(shutdown_notified);

                    'inner: loop {
                        tokio::select! {
                            biased; // check shutdown first

                            _ = &mut shutdown_notified => {
                                tracing::info!("Shutdown signal: sending WS close frame");
                                let _ = write.send(Message::Close(None)).await;
                                self.ws_connected.store(false, Ordering::Relaxed);
                                let _ = app.emit("ws_disconnected", ());
                                return; // exit ws_loop entirely — no more reconnects
                            }

                            maybe = read.next() => {
                                match maybe {
                                    Some(Ok(Message::Text(text))) => {
                                        // Reply to server ping immediately.
                                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                            if v.get("type").and_then(|t| t.as_str()) == Some("ping") {
                                                let _ = write
                                                    .send(Message::Text(
                                                        serde_json::json!({ "type": "pong" })
                                                            .to_string()
                                                            .into(),
                                                    ))
                                                    .await;
                                                continue 'inner;
                                            }
                                        }
                                        tracing::debug!(msg = %text, "WS message received");
                                        self.handle_ws_message(&text, &app).await;
                                    }
                                    Some(Ok(Message::Close(_))) => {
                                        tracing::info!("WS close frame received");
                                        break 'inner;
                                    }
                                    Some(Ok(_)) => {}
                                    Some(Err(e)) => {
                                        tracing::warn!(error = %e, "WS stream error");
                                        break 'inner;
                                    }
                                    None => break 'inner,
                                }
                            }
                        }
                    }

                    self.ws_connected.store(false, Ordering::Relaxed);
                    tracing::warn!("WebSocket disconnected, will reconnect");
                    let _ = app.emit("ws_disconnected", ());
                }
                Err(e) => {
                    self.ws_connected.store(false, Ordering::Relaxed);
                    tracing::warn!(error = %e, "WebSocket connection failed");
                    let _ = app.emit("ws_disconnected", ());
                }
            }

            let delay = backoff_duration(attempt);
            tracing::info!(delay_ms = delay.as_millis(), "Waiting before reconnect");
            tokio::time::sleep(delay).await;
            attempt = attempt.saturating_add(1);
        }
    }

    async fn handle_ws_message(&self, text: &str, app: &tauri::AppHandle) {
        #[derive(Deserialize)]
        struct Envelope {
            #[serde(rename = "type")]
            kind: String,
            #[serde(default)]
            data: serde_json::Value,
        }

        let envelope = match serde_json::from_str::<Envelope>(text) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(error = %e, "Failed to parse WS message");
                return;
            }
        };

        match envelope.kind.as_str() {
            "presence_update" => self.apply_presence_update(envelope.data, app).await,
            "auth_ok" => tracing::info!("WS auth acknowledged by server"),
            "pong" => tracing::debug!("WS pong received"),
            "call_invite" | "call_accepted" | "call_declined" | "call_cancelled" => {
                tracing::info!(
                    kind = %envelope.kind,
                    data = %envelope.data,
                    "Emitting call_invite event to frontend"
                );
                if let Err(e) = app.emit(&envelope.kind, &envelope.data) {
                    tracing::warn!(error = %e, kind = %envelope.kind, "Failed to emit call event");
                } else {
                    tracing::info!(kind = %envelope.kind, "Call event emitted successfully");
                }
            }
            other => tracing::debug!(kind = other, "Unknown WS event type"),
        }
    }

    async fn apply_presence_update(&self, data: serde_json::Value, app: &tauri::AppHandle) {
        #[derive(Deserialize)]
        struct Payload {
            id: String,
            status: FriendStatus,
            #[serde(default)]
            game: Option<String>,
            #[serde(default)]
            display_name: Option<String>,
        }

        let payload = match serde_json::from_value::<Payload>(data) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(error = %e, "Invalid presence_update payload");
                return;
            }
        };

        let mut friends = self.friends.write().await;
        let Some(friend) = friends.iter_mut().find(|f| f.user_id == payload.id) else {
            tracing::debug!(user_id = %payload.id, "Presence update for unknown user, ignoring");
            return;
        };
        friend.status = payload.status;
        friend.game = payload.game;
        if let Some(name) = payload.display_name {
            friend.display_name = name;
        }
        let updated = friend.clone();
        drop(friends);

        tracing::debug!(
            user_id = %updated.user_id,
            display_name = %updated.display_name,
            status = ?updated.status,
            "Presence updated"
        );
        let _ = app.emit("presence_update", &updated);
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub fn get_ws_connected(manager: tauri::State<'_, FriendsManager>) -> bool {
    manager.is_ws_connected()
}

#[tauri::command]
#[specta::specta]
pub async fn get_friends(
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<Vec<Friend>, AppError> {
    let token = auth.get_access_token().await?;
    manager.get_friends(&token).await
}

#[tauri::command]
#[specta::specta]
pub async fn add_friend(
    user_id: String,
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&user_id, 64, "user_id")?;
    let token = auth.get_access_token().await?;
    manager.add_friend(&token, user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn accept_friend(
    request_id: String,
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&request_id, 64, "request_id")?;
    let token = auth.get_access_token().await?;
    manager.accept_friend(&token, request_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn reject_friend(
    request_id: String,
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&request_id, 64, "request_id")?;
    let token = auth.get_access_token().await?;
    manager.reject_friend(&token, request_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_friend(
    friend_id: String,
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&friend_id, 64, "friend_id")?;
    let token = auth.get_access_token().await?;
    manager.remove_friend(&token, friend_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn block_user(
    user_id: String,
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&user_id, 64, "user_id")?;
    let token = auth.get_access_token().await?;
    manager.block_user(&token, user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn unblock_user(
    user_id: String,
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&user_id, 64, "user_id")?;
    let token = auth.get_access_token().await?;
    manager.unblock_user(&token, user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_blocked_users(
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<Vec<BlockedUser>, AppError> {
    let token = auth.get_access_token().await?;
    manager.get_blocked_users(&token).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_my_status(
    status: String,
    game: Option<String>,
    auth: tauri::State<'_, AuthManager>,
    manager: tauri::State<'_, FriendsManager>,
) -> Result<(), AppError> {
    match status.as_str() {
        "Online" | "InGame" | "DND" => {}
        _ => return Err(AppError::Validation(format!("invalid status: {status}"))),
    }
    if let Some(ref g) = game {
        crate::validation::validate_string(g, 100, "game")?;
    }
    let token = auth.get_access_token().await?;
    manager.set_my_status(&token, status, game).await
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_friend(user_id: &str, status: FriendStatus) -> Friend {
        Friend {
            id: format!("f_{user_id}"),
            user_id: user_id.to_string(),
            display_name: user_id.to_string(),
            avatar_url: None,
            status,
            game: None,
            is_friend: true,
        }
    }

    /// Pure presence reducer: mirrors the logic in `apply_presence_update`.
    /// Extracted here for unit testing without a Tauri runtime.
    fn reduce_presence(
        friends: &mut Vec<Friend>,
        user_id: &str,
        status: FriendStatus,
        game: Option<String>,
        display_name: Option<String>,
    ) -> bool {
        if let Some(f) = friends.iter_mut().find(|f| f.user_id == user_id) {
            f.status = status;
            f.game = game;
            if let Some(name) = display_name {
                f.display_name = name;
            }
            true
        } else {
            false
        }
    }

    #[test]
    fn test_presence_reducer_updates_status() {
        let mut friends = vec![
            make_friend("alice", FriendStatus::Online),
            make_friend("bob", FriendStatus::Offline),
        ];

        let found = reduce_presence(
            &mut friends,
            "alice",
            FriendStatus::InGame,
            Some("Rust".into()),
            None,
        );

        assert!(found, "alice should be found");
        assert_eq!(friends[0].status, FriendStatus::InGame);
        assert_eq!(friends[0].game, Some("Rust".to_string()));
        assert_eq!(friends[1].status, FriendStatus::Offline, "bob should be unchanged");
    }

    #[test]
    fn test_presence_reducer_ignores_unknown_user() {
        let mut friends = vec![make_friend("alice", FriendStatus::Online)];

        let found = reduce_presence(
            &mut friends,
            "unknown-xyz",
            FriendStatus::Offline,
            None,
            None,
        );

        assert!(!found, "unknown user should not be found");
        assert_eq!(friends[0].status, FriendStatus::Online, "alice should be unchanged");
        assert_eq!(friends.len(), 1, "friend list length should not change");
    }

    #[test]
    fn test_presence_reducer_handles_offline_transition() {
        let mut friends = vec![make_friend("carol", FriendStatus::InGame)];
        friends[0].game = Some("Valorant".to_string());

        let found = reduce_presence(
            &mut friends,
            "carol",
            FriendStatus::Offline,
            None,  // game cleared to None
            None,
        );

        assert!(found);
        assert_eq!(friends[0].status, FriendStatus::Offline);
        assert_eq!(friends[0].game, None, "game should be cleared when going offline");
    }

    #[test]
    fn test_presence_reducer() {
        let mut friends = vec![
            make_friend("u1", FriendStatus::Online),
            make_friend("u2", FriendStatus::Offline),
        ];
        let original_status = friends[0].status.clone();

        if let Some(f) = friends.iter_mut().find(|f| f.user_id == "u1") {
            f.status = FriendStatus::InGame;
        }

        assert_eq!(friends[0].status, FriendStatus::InGame);
        assert_eq!(friends[1].status, FriendStatus::Offline);
        assert_ne!(friends[0].status, original_status);
    }

    #[test]
    fn test_backoff_sequence() {
        assert_eq!(backoff_base_ms(0), 1_000);
        assert_eq!(backoff_base_ms(1), 2_000);
        assert_eq!(backoff_base_ms(2), 4_000);
        assert_eq!(backoff_base_ms(3), 8_000);
        assert_eq!(backoff_base_ms(4), 16_000);
        assert_eq!(backoff_base_ms(5), 30_000);
        assert_eq!(backoff_base_ms(10), 30_000);
    }

    #[test]
    fn test_input_validation() {
        assert!(validate_id("").is_err());
        assert!(validate_id(&"a".repeat(64)).is_ok());
        assert!(validate_id(&"a".repeat(65)).is_err());
        assert!(validate_id("usr_001").is_ok());
    }
}
