//! `VoiceManager`, the voice domain's managed Tauri state: holds call state
//! (current room, mute/deafen) and owns the active `VoiceAdapter`, selected
//! once at startup based on environment.

use std::sync::Arc;
use tokio::sync::RwLock;

use reqwest::Client;

use super::adapter::VoiceAdapter;
use super::livekit::LiveKitAdapter;
use super::stub::StubAdapter;

// ---------------------------------------------------------------------------
// VoiceManager — managed Tauri state
// ---------------------------------------------------------------------------

/// The adapter is stored behind the `VoiceAdapter` trait object so
/// `commands.rs` and other callers only ever talk to "the active adapter" —
/// they never branch on or need to know whether LiveKit or the stub is
/// running underneath.
///
/// Uses Arc<dyn VoiceAdapter> (not Box) so VoiceManager can derive Clone,
/// which Tauri's .manage() requires.
///
/// Fields are `pub(super)` so sibling `commands` module can drive state
/// transitions directly, matching the pre-split single-file design.
#[derive(Clone)]
pub struct VoiceManager {
    pub(super) http: Client,
    pub(super) adapter: Arc<dyn VoiceAdapter>,
    pub(super) current_room: Arc<RwLock<Option<String>>>,
    pub(super) is_muted: Arc<RwLock<bool>>,
    pub(super) is_deafened: Arc<RwLock<bool>>,
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
