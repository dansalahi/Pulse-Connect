mod router;

pub use router::Router;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::Deserialize;
use tauri::{Emitter, Manager};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::domains::auth::AuthManager;

const WS_URL: &str = "ws://localhost:3001";

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
// Gateway
// ---------------------------------------------------------------------------

/// Owns the presence WebSocket connection lifecycle — connect, authenticate,
/// reconnect with backoff, and liveness (ping/pong) — independent of any
/// domain. Inbound application messages are handed off to the `Router` for
/// dispatch to whichever domain registered a handler for that message type.
#[derive(Clone)]
pub struct Gateway {
    connected: Arc<AtomicBool>,
    shutdown: Arc<Notify>,
    router: Router,
}

impl Gateway {
    pub fn new() -> Self {
        Self {
            connected: Arc::new(AtomicBool::new(false)),
            shutdown: Arc::new(Notify::new()),
            router: Router::new(),
        }
    }

    /// The registry domains use to register handlers for inbound message
    /// type tags. Register handlers before calling `start`.
    pub fn router(&self) -> &Router {
        &self.router
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    /// Called when the main window is closing — signals the WS loop to send
    /// a clean close frame so the backend marks this user Offline immediately.
    pub fn signal_shutdown(&self) {
        self.shutdown.notify_one();
    }

    #[tracing::instrument(skip(self, app_handle))]
    pub fn start(&self, app_handle: tauri::AppHandle) {
        let gateway = self.clone();
        tauri::async_runtime::spawn(async move {
            gateway.ws_loop(app_handle).await;
        });
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
                    self.connected.store(true, Ordering::Relaxed);
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
                                self.connected.store(false, Ordering::Relaxed);
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
                                        self.handle_message(&text, &app).await;
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

                    self.connected.store(false, Ordering::Relaxed);
                    tracing::warn!("WebSocket disconnected, will reconnect");
                    let _ = app.emit("ws_disconnected", ());
                }
                Err(e) => {
                    self.connected.store(false, Ordering::Relaxed);
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

    async fn handle_message(&self, text: &str, app: &tauri::AppHandle) {
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
            "auth_ok" => tracing::info!("WS auth acknowledged by server"),
            "pong" => tracing::debug!("WS pong received"),
            kind => {
                if !self.router.dispatch(kind, envelope.data, app.clone()).await {
                    tracing::debug!(kind, "Unknown WS event type");
                }
            }
        }
    }
}

impl Default for Gateway {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
    fn new_gateway_starts_disconnected() {
        let gateway = Gateway::new();
        assert!(!gateway.is_connected());
    }
}
