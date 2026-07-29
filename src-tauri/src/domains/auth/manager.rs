//! Auth domain business logic: HTTP login/refresh against the backend and
//! in-memory session state. Refresh-token persistence is split across two
//! stores — see `store_refresh_token`/`load_refresh_token` — and the access
//! token is never written to disk, only held as a `SecretString` in memory.

use std::sync::Arc;
use tokio::sync::RwLock;

use reqwest::Client;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri_plugin_store::StoreExt;

use crate::shared::error::AppError;

const API_BASE: &str = "http://localhost:3000";
// Plugin-store file holds only the non-sensitive user email so bootstrap
// knows which keychain entry to look up.
const STORE_FILE: &str = "pulse-connect-auth.bin";
const STORE_KEY_EMAIL: &str = "user_email";
const KEYCHAIN_SERVICE: &str = "pulse-connect";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthResponse {
    user: AuthUser,
    access_token: String,
    refresh_token: String,
    #[allow(dead_code)]
    expires_in: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RefreshRequest<'a> {
    refresh_token: &'a str,
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AuthManager
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AuthManager {
    http: Client,
    user: Arc<RwLock<Option<AuthUser>>>,
    access_token: Arc<RwLock<Option<SecretString>>>,
}

impl AuthManager {
    pub fn new() -> Result<Self, AppError> {
        let http = Client::builder()
            .build()
            .map_err(|e| AppError::NetworkError(e.to_string()))?;
        Ok(Self {
            http,
            user: Arc::new(RwLock::new(None)),
            access_token: Arc::new(RwLock::new(None)),
        })
    }

    pub async fn login(
        &self,
        email: &str,
        password: &str,
        app: &tauri::AppHandle,
    ) -> Result<AuthUser, AppError> {
        validate_email(email)?;
        validate_password(password)?;

        let resp = self
            .http
            .post(format!("{API_BASE}/auth/login"))
            .json(&LoginRequest { email, password })
            .send()
            .await
            .map_err(AppError::from)?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::InvalidCredentials);
        }
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }

        let auth: AuthResponse = resp.json().await.map_err(AppError::from)?;

        self.store_refresh_token(&auth.refresh_token, &auth.user.email, app)?;
        self.set_session(auth.user.clone(), auth.access_token).await;

        Ok(auth.user)
    }

    pub async fn refresh(
        &self,
        refresh_token: &str,
        app: &tauri::AppHandle,
    ) -> Result<AuthUser, AppError> {
        let resp = self
            .http
            .post(format!("{API_BASE}/auth/refresh"))
            .json(&RefreshRequest { refresh_token })
            .send()
            .await
            .map_err(AppError::from)?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::RefreshFailed);
        }
        if !resp.status().is_success() {
            return Err(AppError::NetworkError(format!("HTTP {}", resp.status())));
        }

        let auth: AuthResponse = resp.json().await.map_err(AppError::from)?;

        self.store_refresh_token(&auth.refresh_token, &auth.user.email, app)?;
        self.set_session(auth.user.clone(), auth.access_token).await;

        Ok(auth.user)
    }

    pub async fn logout(&self, app: &tauri::AppHandle) {
        // Read email before clearing the user so the keychain entry can be found.
        let email = self.user.read().await.as_ref().map(|u| u.email.clone());
        *self.user.write().await = None;
        *self.access_token.write().await = None;
        self.delete_refresh_token(email.as_deref(), app);
    }

    pub async fn bootstrap(&self, app: &tauri::AppHandle) -> Option<AuthUser> {
        let token = self.load_refresh_token(app).ok()??;
        match self.refresh(&token, app).await {
            Ok(user) => Some(user),
            Err(_) => {
                self.logout(app).await;
                None
            }
        }
    }

    pub async fn get_user(&self) -> Option<AuthUser> {
        self.user.read().await.clone()
    }

    pub async fn get_access_token(&self) -> Result<String, AppError> {
        self.access_token
            .read()
            .await
            .as_ref()
            .map(|s| s.expose_secret().to_owned())
            .ok_or(AppError::NotAuthenticated)
    }

    async fn set_session(&self, user: AuthUser, token: String) {
        *self.user.write().await = Some(user);
        *self.access_token.write().await = Some(SecretString::from(token));
    }

    // Refresh-token persistence is split across two stores: the email marker
    // lives in the (unencrypted) plugin-store file below, while the secret
    // token itself goes to the OS keychain. The access token is never
    // persisted at all — it only ever lives in `self.access_token`.
    fn store_refresh_token(
        &self,
        token: &str,
        email: &str,
        app: &tauri::AppHandle,
    ) -> Result<(), AppError> {
        // Persist the email (non-sensitive) so bootstrap can find the keychain entry.
        let store = app
            .store(STORE_FILE)
            .map_err(|e| AppError::KeychainError(e.to_string()))?;
        store.set(STORE_KEY_EMAIL, json!(email));
        store
            .save()
            .map_err(|e| AppError::KeychainError(e.to_string()))?;

        // Store the token itself in the OS keychain.
        keyring::Entry::new(KEYCHAIN_SERVICE, email)
            .map_err(|e| AppError::KeychainError(e.to_string()))?
            .set_password(token)
            .map_err(|e| AppError::KeychainError(e.to_string()))
    }

    fn load_refresh_token(&self, app: &tauri::AppHandle) -> Result<Option<String>, AppError> {
        // Read the stored email so we can look up the correct keychain entry.
        let store = app
            .store(STORE_FILE)
            .map_err(|e| AppError::KeychainError(e.to_string()))?;
        let Some(email) = store
            .get(STORE_KEY_EMAIL)
            .and_then(|v| v.as_str().map(str::to_owned))
        else {
            return Ok(None);
        };

        match keyring::Entry::new(KEYCHAIN_SERVICE, &email)
            .map_err(|e| AppError::KeychainError(e.to_string()))?
            .get_password()
        {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(keyring::Error::NoStorageAccess(_)) => Ok(None),
            Err(e) => Err(AppError::KeychainError(e.to_string())),
        }
    }

    fn delete_refresh_token(&self, email: Option<&str>, app: &tauri::AppHandle) {
        if let Some(email) = email {
            if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, email) {
                let _ = entry.delete_password();
            }
        }
        if let Ok(store) = app.store(STORE_FILE) {
            store.delete(STORE_KEY_EMAIL);
            let _ = store.save();
        }
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn validate_email(email: &str) -> Result<(), AppError> {
    let trimmed = email.trim();
    if trimmed.is_empty() || trimmed.len() > 254 || email.contains('\0') {
        return Err(AppError::InvalidCredentials);
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.is_empty() || password.len() > 128 || password.contains('\0') {
        return Err(AppError::InvalidCredentials);
    }
    Ok(())
}

