//! Application-wide error type (`AppError`) returned by Tauri commands across
//! all domains; serializes to a tagged `{code, message}` shape for the frontend.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", content = "message", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppError {
    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("Token refresh failed")]
    RefreshFailed,

    #[error("Not authenticated")]
    NotAuthenticated,

    #[error("Keychain error: {0}")]
    KeychainError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Unknown error: {0}")]
    Unknown(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::NetworkError(e.to_string())
    }
}
