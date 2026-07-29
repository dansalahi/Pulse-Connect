//! Friends domain business logic: HTTP calls for friend/block management and
//! presence status, plus gateway route registration that relays inbound
//! presence updates and call-signaling messages to the frontend as events.

use std::sync::Arc;
use tokio::sync::RwLock;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::gateway::Gateway;
use crate::shared::error::AppError;

const API_BASE: &str = "http://localhost:3000";

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
// FriendsManager
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct FriendsManager {
    http: Client,
    friends: Arc<RwLock<Vec<Friend>>>,
}

impl FriendsManager {
    pub fn new() -> Self {
        Self {
            http: Client::new(),
            friends: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Registers this domain's handlers on the gateway's router — presence
    /// updates and call signaling routing — so the gateway can dispatch
    /// inbound messages here without owning any friends-domain logic.
    pub fn register_routes(&self, gateway: &Gateway) {
        let manager = self.clone();
        gateway.router().register("presence_update", move |data, app| {
            let manager = manager.clone();
            async move { manager.apply_presence_update(data, &app).await }
        });

        for kind in ["call_invite", "call_accepted", "call_declined", "call_cancelled"] {
            gateway.router().register(kind, move |data, app| async move {
                tracing::info!(kind = %kind, data = %data, "Emitting call_invite event to frontend");
                if let Err(e) = app.emit(kind, &data) {
                    tracing::warn!(error = %e, kind = %kind, "Failed to emit call event");
                } else {
                    tracing::info!(kind = %kind, "Call event emitted successfully");
                }
            });
        }
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
    // Gateway route handlers
    // -----------------------------------------------------------------------

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
    fn test_input_validation() {
        assert!(validate_id("").is_err());
        assert!(validate_id(&"a".repeat(64)).is_ok());
        assert!(validate_id(&"a".repeat(65)).is_err());
        assert!(validate_id("usr_001").is_ok());
    }
}
