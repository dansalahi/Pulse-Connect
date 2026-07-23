import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LoadingScreen } from "./components/LoadingScreen";
import { MainLayout } from "./pages/MainLayout";
import { LoginPage } from "./pages/LoginPage";
import { useAuthStore } from "./store/authStore";
import { useVoiceStore } from "./store/voiceStore";

export default function App() {
  const { isAuthenticated, isLoading, bootstrap } = useAuthStore();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // ── Call signaling — direct Tauri event listeners ──────────────────────────
  // Registered once with [], never cleaned up, persistent for the app session.
  // Using direct listen() here (not delegated to the store) ensures these
  // listeners survive across call lifecycle events and React StrictMode cycles.
  useEffect(() => {
    void listen<{ from_user_id: string; from_display_name: string; room_name: string }>(
      "call_invite",
      (event) => {
        console.log("[App] call_invite received:", event.payload);
        const { from_user_id, from_display_name, room_name } = event.payload;
        useVoiceStore.getState().handleIncomingCall(from_user_id, from_display_name, room_name);
      },
    );

    void listen<{ room_name: string; from_user_id: string }>(
      "call_accepted",
      (event) => {
        console.log("[App] call_accepted received:", event.payload);
        useVoiceStore.getState().handleCallAccepted(event.payload.from_user_id, event.payload.room_name);
      },
    );

    void listen<{ from_user_id: string }>(
      "call_declined",
      (_event) => {
        console.log("[App] call_declined received");
        useVoiceStore.getState().handleCallDeclined();
      },
    );

    void listen<{ from_user_id: string }>(
      "call_cancelled",
      (_event) => {
        console.log("[App] call_cancelled received");
        useVoiceStore.getState().handleCallCancelled();
      },
    );

    // ── Overlay action events (emitted by OverlayApp.tsx buttons) ────────────
    void listen("overlay_mute_toggle", () => {
      console.log("[App] overlay_mute_toggle received ← THIS MUST APPEAR");
      void useVoiceStore.getState().toggleMute();
    });

    void listen("overlay_leave_call", () => {
      console.log("[App] overlay_leave_call received");
      void useVoiceStore.getState().leaveVoice();
    });

    void listen("overlay_close", () => {
      console.log("[App] overlay_close received");
      // Directly hide and clear state — avoids toggle ambiguity
      void invoke<void>("hide_overlay");
      useVoiceStore.setState({ isOverlayVisible: false });
    });

    // ── Global hotkey events (emitted by Rust when a registered shortcut fires) ──
    // Guards: only act when in an active call — prevents toast spam when idle.
    void listen("hotkey_mute", () => {
      const state = useVoiceStore.getState();
      if (state.callState !== "connected") return;
      void state.toggleMute();
    });
    void listen("hotkey_deafen", () => {
      const state = useVoiceStore.getState();
      if (state.callState !== "connected") return;
      void state.toggleDeafen();
    });
    void listen("hotkey_leave", () => {
      const state = useVoiceStore.getState();
      if (state.callState !== "connected") return;
      void state.leaveVoice();
    });
    void listen("hotkey_ptt_press", () => {
      const store = useVoiceStore.getState();
      if (store.callState !== "connected") return;
      void store.setMuted(false);
    });
    void listen("hotkey_ptt_release", () => {
      const store = useVoiceStore.getState();
      if (store.callState !== "connected") return;
      void store.setMuted(true);
    });
  }, []);

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <LoginPage />;
  return <MainLayout />;
}
