use crate::domains::auth::AuthManager;
use crate::shared::error::AppError;
use crate::shared::validation::validate_string;

use super::manager::{BlockedUser, Friend, FriendsManager};

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
    validate_string(&user_id, 64, "user_id")?;
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
    validate_string(&request_id, 64, "request_id")?;
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
    validate_string(&request_id, 64, "request_id")?;
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
    validate_string(&friend_id, 64, "friend_id")?;
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
    validate_string(&user_id, 64, "user_id")?;
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
    validate_string(&user_id, 64, "user_id")?;
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
        validate_string(g, 100, "game")?;
    }
    let token = auth.get_access_token().await?;
    manager.set_my_status(&token, status, game).await
}
