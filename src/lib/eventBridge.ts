import { ipc } from "./ipc/commands";
import { events } from "./ipc/events";
import { useSignalingStore } from "../features/voice/store/signalingStore";
import { useSessionStore } from "../features/voice/store/sessionStore";

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
    useSignalingStore.getState().handleIncomingCall(from_user_id, from_display_name, room_name);
  });

  void events.listen("call_accepted", (payload) => {
    console.log("[App] call_accepted received:", payload);
    useSignalingStore.getState().handleCallAccepted(payload.from_user_id, payload.room_name);
  });

  void events.listen("call_declined", () => {
    console.log("[App] call_declined received");
    useSignalingStore.getState().handleCallDeclined();
  });

  void events.listen("call_cancelled", () => {
    console.log("[App] call_cancelled received");
    useSignalingStore.getState().handleCallCancelled();
  });

  // ── Overlay action events (emitted by OverlayApp.tsx buttons) ────────────
  void events.listen("overlay_mute_toggle", () => {
    console.log("[App] overlay_mute_toggle received ← THIS MUST APPEAR");
    void useSessionStore.getState().toggleMute();
  });

  void events.listen("overlay_leave_call", () => {
    console.log("[App] overlay_leave_call received");
    void useSessionStore.getState().leaveVoice();
  });

  void events.listen("overlay_close", () => {
    console.log("[App] overlay_close received");
    // Directly hide and clear state — avoids toggle ambiguity
    void ipc.overlay.hideOverlay();
    useSessionStore.setState({ isOverlayVisible: false });
  });

  // ── Global hotkey events (emitted by Rust when a registered shortcut fires) ──
  // Guards: only act when in an active call — prevents toast spam when idle.
  void events.listen("hotkey_mute", () => {
    if (useSignalingStore.getState().callState !== "connected") return;
    void useSessionStore.getState().toggleMute();
  });
  void events.listen("hotkey_deafen", () => {
    if (useSignalingStore.getState().callState !== "connected") return;
    void useSessionStore.getState().toggleDeafen();
  });
  void events.listen("hotkey_leave", () => {
    if (useSignalingStore.getState().callState !== "connected") return;
    void useSessionStore.getState().leaveVoice();
  });
  void events.listen("hotkey_ptt_press", () => {
    if (useSignalingStore.getState().callState !== "connected") return;
    void useSessionStore.getState().setMuted(false);
  });
  void events.listen("hotkey_ptt_release", () => {
    if (useSignalingStore.getState().callState !== "connected") return;
    void useSessionStore.getState().setMuted(true);
  });
}
