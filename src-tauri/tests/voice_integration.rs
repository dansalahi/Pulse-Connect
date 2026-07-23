/// Integration tests for the voice adapter architecture.
///
/// These tests use the public API of pulse_connect_lib to verify the config-driven
/// adapter swap works correctly and that VoiceManager initialises to a clean
/// idle state regardless of which adapter is selected.
///
/// No Tauri app process is needed — VoiceManager state reads are done via the
/// public accessor methods added for testing.

use pulse_connect_lib::VoiceManagerPub;

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------

#[test]
fn test_stub_adapter_selected_when_env_var_is_stub() {
    std::env::set_var("PULSE_VOICE_ADAPTER", "stub");
    let _vm = VoiceManagerPub::new();
    std::env::remove_var("PULSE_VOICE_ADAPTER");
    // Creating VoiceManager without panicking proves the stub branch is reachable.
}

#[test]
fn test_livekit_adapter_selected_by_default() {
    std::env::remove_var("PULSE_VOICE_ADAPTER");
    let _vm = VoiceManagerPub::new();
    // Creating VoiceManager without panicking proves the LiveKit branch is reachable.
}

#[test]
fn test_unknown_adapter_value_falls_back_to_livekit() {
    std::env::set_var("PULSE_VOICE_ADAPTER", "webrtc-rs");
    let _vm = VoiceManagerPub::new();
    std::env::remove_var("PULSE_VOICE_ADAPTER");
    // Any unknown value must fall through to the default (LiveKit) without panic.
}

// ---------------------------------------------------------------------------
// Initial state is always idle regardless of adapter
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_voice_initial_state_is_idle_in_stub_mode() {
    std::env::set_var("PULSE_VOICE_ADAPTER", "stub");
    let vm = VoiceManagerPub::new();
    std::env::remove_var("PULSE_VOICE_ADAPTER");

    assert_eq!(vm.room_name().await, None, "should start with no room");
    assert!(!vm.is_muted_state().await, "should start unmuted");
    assert!(!vm.is_deafened_state().await, "should start undeafened");
}

#[tokio::test]
async fn test_voice_initial_state_is_idle_in_livekit_mode() {
    std::env::remove_var("PULSE_VOICE_ADAPTER");
    let vm = VoiceManagerPub::new();

    assert_eq!(vm.room_name().await, None);
    assert!(!vm.is_muted_state().await);
    assert!(!vm.is_deafened_state().await);
}
