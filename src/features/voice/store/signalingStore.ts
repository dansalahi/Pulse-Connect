import { create } from "zustand";
import { ipc } from "../../../lib/ipc/commands";
import { toast } from "../../../ui/Toast";
import { audioService } from "../../../lib/audio/audioService";
import { useSessionStore } from "./sessionStore";
import type { CallingTarget, IncomingCall } from "../types/voice";

// ---------------------------------------------------------------------------
// Call state machine
// ---------------------------------------------------------------------------

export type CallState = "idle" | "calling" | "incoming" | "connected";

// ---------------------------------------------------------------------------
// Store interfaces
// ---------------------------------------------------------------------------

interface SignalingState {
  callState: CallState;
  callingTarget: CallingTarget | null;
  incomingCall: IncomingCall | null;
  error: string | null;
}

interface SignalingActions {
  joinVoice: (friendId: string, displayName: string, roomName: string) => Promise<void>;
  cancelCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  clearVoiceError: () => void;
  // Signal handlers — called directly from the event bridge's Tauri event listeners
  handleIncomingCall: (fromUserId: string, fromDisplayName: string, roomName: string) => void;
  handleCallAccepted: (fromUserId: string, roomName: string) => void;
  handleCallDeclined: () => void;
  handleCallCancelled: () => void;
  // Called by sessionStore.leaveVoice() when a connected call ends
  resetToIdle: () => void;
}

type SignalingStore = SignalingState & SignalingActions;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  try { return JSON.stringify(error); } catch { return String(error); }
}

// Module-level timeout — survives store re-renders
let inviteTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
function clearInviteTimeout() {
  if (inviteTimeoutHandle !== null) {
    clearTimeout(inviteTimeoutHandle);
    inviteTimeoutHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSignalingStore = create<SignalingStore>((set, get) => ({
  // ── state defaults ─────────────────────────────────────────────────────
  callState: "idle",
  callingTarget: null,
  incomingCall: null,
  error: null,

  clearVoiceError: () => set({ error: null }),

  resetToIdle: () => set({ callState: "idle" }),

  // ── Caller flow ────────────────────────────────────────────────────────
  joinVoice: async (friendId, displayName, roomName) => {
    console.log("[voice] inviting:", displayName, "room:", roomName);
    set({ error: null, callState: "calling", callingTarget: { userId: friendId, displayName, roomName } });
    audioService.playDialTone();

    try {
      await ipc.voice.inviteToCall(friendId, roomName);
    } catch (error: unknown) {
      audioService.stopAll();
      const msg = readError(error);
      toast(msg, "error");
      set({ callState: "idle", callingTarget: null });
      return;
    }

    // 30s timeout — auto-cancel if no response
    inviteTimeoutHandle = setTimeout(async () => {
      inviteTimeoutHandle = null;
      const { callState: cs, callingTarget: ct } = get();
      if (cs !== "calling" || !ct) return;
      try { await ipc.voice.cancelCall(ct.userId); } catch { /* best-effort */ }
      audioService.stopAll();
      set({ callState: "idle", callingTarget: null });
      toast("No answer", "info");
    }, 30_000);
  },

  cancelCall: async () => {
    clearInviteTimeout();
    const { callingTarget } = get();
    audioService.stopAll();
    set({ callState: "idle", callingTarget: null });
    if (!callingTarget) return;
    try { await ipc.voice.cancelCall(callingTarget.userId); } catch { /* best-effort */ }
  },

  // ── Callee flow ────────────────────────────────────────────────────────
  acceptCall: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;
    audioService.stopAll();
    set({ callState: "connected", incomingCall: null });
    try {
      await ipc.voice.respondToCall(true, incomingCall.roomName, incomingCall.fromUserId);
      await useSessionStore.getState().connectToRoom(incomingCall.fromUserId, incomingCall.roomName);
    } catch (error: unknown) {
      audioService.stopAll();
      set({ callState: "idle", error: readError(error) });
    }
  },

  declineCall: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;
    audioService.stopAll();
    set({ callState: "idle", incomingCall: null });
    try {
      await ipc.voice.respondToCall(false, incomingCall.roomName, incomingCall.fromUserId);
    } catch { /* best-effort */ }
  },

  // ── Call signal handlers (called from the event bridge's Tauri listeners) ──
  handleIncomingCall: (fromUserId, fromDisplayName, roomName) => {
    console.log("[voice] incoming call from", fromDisplayName, "room:", roomName);
    audioService.playRingtone();
    set({
      callState: "incoming",
      incomingCall: { fromUserId, fromDisplayName, roomName },
    });
  },

  handleCallAccepted: (fromUserId, roomName) => {
    console.log("[voice] call accepted — connecting to room:", roomName);
    const { callState: cs, callingTarget } = get();
    if (cs !== "calling" || !callingTarget) return;
    clearInviteTimeout();
    audioService.stopAll();
    set({ callState: "connected", callingTarget: null });
    void useSessionStore.getState().connectToRoom(fromUserId, roomName);
  },

  handleCallDeclined: () => {
    console.log("[voice] call declined");
    clearInviteTimeout();
    audioService.stopAll();
    set({ callState: "idle", callingTarget: null });
    toast("Call declined", "info");
  },

  handleCallCancelled: () => {
    console.log("[voice] call cancelled by caller");
    audioService.stopAll();
    set({ callState: "idle", incomingCall: null });
    toast("Call cancelled", "info");
  },
}));

// ---------------------------------------------------------------------------
// Breadcrumb: emit a telemetry event whenever the call state machine transitions.
// ---------------------------------------------------------------------------

useSignalingStore.subscribe((state, prev) => {
  if (state.callState !== prev.callState) {
    void ipc.telemetry
      .addBreadcrumb("call_state", `${prev.callState} -> ${state.callState}`)
      .catch((e: unknown) => {
        console.warn("[telemetry] add_breadcrumb failed:", e);
      });
  }
});
