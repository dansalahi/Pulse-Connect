//! Tauri command wrappers for the auth domain: validate IPC input, record
//! telemetry, and delegate to `AuthManager` for login/logout/session lookup.

use crate::domains::telemetry::Telemetry;
use crate::shared::error::AppError;
use crate::shared::validation::validate_string;

use super::manager::{AuthManager, AuthUser};

#[tauri::command]
#[specta::specta]
pub async fn login(
    email: String,
    password: String,
    app: tauri::AppHandle,
    manager: tauri::State<'_, AuthManager>,
    telemetry: tauri::State<'_, Telemetry>,
) -> Result<AuthUser, AppError> {
    validate_string(&email, 254, "email")?;
    validate_string(&password, 128, "password")?;
    telemetry.add("ipc", "login called".into());
    manager.login(&email, &password, &app).await
}

#[tauri::command]
#[specta::specta]
pub async fn logout(
    app: tauri::AppHandle,
    manager: tauri::State<'_, AuthManager>,
    telemetry: tauri::State<'_, Telemetry>,
) -> Result<(), AppError> {
    telemetry.add("ipc", "logout called".into());
    manager.logout(&app).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_session(
    manager: tauri::State<'_, AuthManager>,
) -> Result<Option<AuthUser>, AppError> {
    Ok(manager.get_user().await)
}
