import { ipc } from "./ipc/commands";
import { events } from "./ipc/events";
import { useVoiceStore } from "../features/voice/store/voiceStore";

// ---------------------------------------------------------------------------
// Global Tauri event listeners for the app's lifetime: call signaling,
// overlay button actions, and global hotkeys. Originally inlined in
// App.tsx's `useEffect(() => { ... }, [])` — moved here so App.tsx stays
// boot/routing only.
//
// These listeners are registered once and never unlistened — they must
// survive across call lifecycle events and React StrictMode's mount →
// cleanup → mount cycle for the app's entire session. mountEventBridge()
// itself is idempotent (guarded by `mounted` below) so that cycle can't
// register the same listener twice.
// ---------------------------------------------------------------------------

let mounted = false;

export function mountEventBridge(): void {
  if (mounted) return;
  mounted = true;

  void events.listen("call_invite", (payload) => {
    console.log("[App] call_invite received:", payload);
    const { from_user_id, from_display_name, room_name } = payload;
    useVoiceStore.getState().handleIncomingCall(from_user_id, from_display_name, room_name);
  });

  void events.listen("call_accepted", (payload) => {
    console.log("[App] call_accepted received:", payload);
    useVoiceStore.getState().handleCallAccepted(payload.from_user_id, payload.room_name);
  });

  void events.listen("call_declined", () => {
    console.log("[App] call_declined received");
    useVoiceStore.getState().handleCallDeclined();
  });

  void events.listen("call_cancelled", () => {
    console.log("[App] call_cancelled received");
    useVoiceStore.getState().handleCallCancelled();
  });

  // ── Overlay action events (emitted by OverlayApp.tsx buttons) ────────────
  void events.listen("overlay_mute_toggle", () => {
    console.log("[App] overlay_mute_toggle received ← THIS MUST APPEAR");
    void useVoiceStore.getState().toggleMute();
  });

  void events.listen("overlay_leave_call", () => {
    console.log("[App] overlay_leave_call received");
    void useVoiceStore.getState().leaveVoice();
  });

  void events.listen("overlay_close", () => {
    console.log("[App] overlay_close received");
    // Directly hide and clear state — avoids toggle ambiguity
    void ipc.overlay.hideOverlay();
    useVoiceStore.setState({ isOverlayVisible: false });
  });

  // ── Global hotkey events (emitted by Rust when a registered shortcut fires) ──
  // Guards: only act when in an active call — prevents toast spam when idle.
  void events.listen("hotkey_mute", () => {
    const state = useVoiceStore.getState();
    if (state.callState !== "connected") return;
    void state.toggleMute();
  });
  void events.listen("hotkey_deafen", () => {
    const state = useVoiceStore.getState();
    if (state.callState !== "connected") return;
    void state.toggleDeafen();
  });
  void events.listen("hotkey_leave", () => {
    const state = useVoiceStore.getState();
    if (state.callState !== "connected") return;
    void state.leaveVoice();
  });
  void events.listen("hotkey_ptt_press", () => {
    const store = useVoiceStore.getState();
    if (store.callState !== "connected") return;
    void store.setMuted(false);
  });
  void events.listen("hotkey_ptt_release", () => {
    const store = useVoiceStore.getState();
    if (store.callState !== "connected") return;
    void store.setMuted(true);
  });
}
