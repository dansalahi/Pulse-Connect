import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---------------------------------------------------------------------------
// Mock the Tauri surface the same way the existing tests do (see
// src/tests/setup.ts, src/tests/overlay.test.ts) — invoke/listen/emit are
// replaced with spies so mountEventBridge() never touches a real backend.
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// The voice stores pull in livekit-client and browser media APIs that don't
// exist in jsdom, so they're mocked to plain objects of spies. eventBridge
// only ever reaches them through getState()/setState().
vi.mock("../features/voice/store/signalingStore", () => {
  const state = {
    callState: "idle",
    handleIncomingCall: vi.fn(),
    handleCallAccepted: vi.fn(),
    handleCallDeclined: vi.fn(),
    handleCallCancelled: vi.fn(),
  };
  return {
    useSignalingStore: {
      getState: () => state,
      setState: vi.fn((patch: Record<string, unknown>) => Object.assign(state, patch)),
    },
  };
});

vi.mock("../features/voice/store/sessionStore", () => {
  const state = {
    isOverlayVisible: false,
    toggleMute: vi.fn(),
    leaveVoice: vi.fn(),
    toggleDeafen: vi.fn(),
    setMuted: vi.fn(),
  };
  return {
    useSessionStore: {
      getState: () => state,
      setState: vi.fn((patch: Record<string, unknown>) => Object.assign(state, patch)),
    },
  };
});

// Imported after the mocks above so both pick up the mocked modules.
import { mountEventBridge } from "../lib/eventBridge";
import { useSignalingStore } from "../features/voice/store/signalingStore";
import { useSessionStore } from "../features/voice/store/sessionStore";
import type { CallState } from "../features/voice/store/signalingStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EventHandler = (event: { payload: unknown }) => void;

// Captured once, right after mountEventBridge() registers every listener —
// independent of listen()'s call history so beforeEach can freely clear
// mock call counts without losing the ability to look handlers up.
const registeredHandlers = new Map<string, EventHandler>();

function handlerFor(eventName: string): EventHandler {
  const handler = registeredHandlers.get(eventName);
  if (!handler) throw new Error(`no listener registered for "${eventName}"`);
  return handler;
}

function setCallState(callState: CallState) {
  useSignalingStore.getState().callState = callState;
}

// mountEventBridge() is idempotent and registers every listener exactly
// once, so it only needs to run a single time for the whole file.
beforeAll(() => {
  mountEventBridge();
  for (const [name, handler] of vi.mocked(listen).mock.calls) {
    registeredHandlers.set(name, handler as EventHandler);
  }
});

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  vi.mocked(useSignalingStore.setState).mockClear();
  vi.mocked(useSessionStore.setState).mockClear();
  const signalingState = useSignalingStore.getState();
  const sessionState = useSessionStore.getState();
  for (const value of [...Object.values(signalingState), ...Object.values(sessionState)]) {
    if (typeof value === "function" && "mockClear" in value) {
      (value as ReturnType<typeof vi.fn>).mockClear();
    }
  }
  signalingState.callState = "idle";
  sessionState.isOverlayVisible = false;
});

// ---------------------------------------------------------------------------
// Call signaling
// ---------------------------------------------------------------------------

describe("eventBridge — call signaling", () => {
  it("dispatches call_invite to signalingStore.handleIncomingCall", () => {
    handlerFor("call_invite")({
      payload: { from_user_id: "u1", from_display_name: "Alice", room_name: "room-1" },
    });
    expect(useSignalingStore.getState().handleIncomingCall).toHaveBeenCalledWith(
      "u1",
      "Alice",
      "room-1",
    );
  });

  it("dispatches call_accepted to signalingStore.handleCallAccepted", () => {
    handlerFor("call_accepted")({
      payload: { room_name: "room-2", from_user_id: "u2" },
    });
    expect(useSignalingStore.getState().handleCallAccepted).toHaveBeenCalledWith("u2", "room-2");
  });

  it("dispatches call_declined to signalingStore.handleCallDeclined", () => {
    handlerFor("call_declined")({ payload: { from_user_id: "u3" } });
    expect(useSignalingStore.getState().handleCallDeclined).toHaveBeenCalledTimes(1);
  });

  it("dispatches call_cancelled to signalingStore.handleCallCancelled", () => {
    handlerFor("call_cancelled")({ payload: { from_user_id: "u4" } });
    expect(useSignalingStore.getState().handleCallCancelled).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Overlay actions
// ---------------------------------------------------------------------------

describe("eventBridge — overlay actions", () => {
  it("dispatches overlay_mute_toggle to sessionStore.toggleMute", () => {
    handlerFor("overlay_mute_toggle")({ payload: undefined });
    expect(useSessionStore.getState().toggleMute).toHaveBeenCalledTimes(1);
  });

  it("dispatches overlay_leave_call to sessionStore.leaveVoice", () => {
    handlerFor("overlay_leave_call")({ payload: undefined });
    expect(useSessionStore.getState().leaveVoice).toHaveBeenCalledTimes(1);
  });

  it("overlay_close hides the overlay and clears isOverlayVisible", () => {
    useSessionStore.getState().isOverlayVisible = true;

    handlerFor("overlay_close")({ payload: undefined });

    expect(invoke).toHaveBeenCalledWith("hide_overlay");
    expect(useSessionStore.setState).toHaveBeenCalledWith({ isOverlayVisible: false });
    expect(useSessionStore.getState().isOverlayVisible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Global hotkeys — guarded to only act while a call is connected
// ---------------------------------------------------------------------------

describe("eventBridge — global hotkeys", () => {
  it("hotkey_mute is a no-op when not in a connected call", () => {
    setCallState("idle");
    handlerFor("hotkey_mute")({ payload: undefined });
    expect(useSessionStore.getState().toggleMute).not.toHaveBeenCalled();
  });

  it("hotkey_mute toggles mute while connected", () => {
    setCallState("connected");
    handlerFor("hotkey_mute")({ payload: undefined });
    expect(useSessionStore.getState().toggleMute).toHaveBeenCalledTimes(1);
  });

  it("hotkey_deafen is a no-op when not in a connected call", () => {
    setCallState("calling");
    handlerFor("hotkey_deafen")({ payload: undefined });
    expect(useSessionStore.getState().toggleDeafen).not.toHaveBeenCalled();
  });

  it("hotkey_deafen toggles deafen while connected", () => {
    setCallState("connected");
    handlerFor("hotkey_deafen")({ payload: undefined });
    expect(useSessionStore.getState().toggleDeafen).toHaveBeenCalledTimes(1);
  });

  it("hotkey_leave is a no-op when not in a connected call", () => {
    setCallState("incoming");
    handlerFor("hotkey_leave")({ payload: undefined });
    expect(useSessionStore.getState().leaveVoice).not.toHaveBeenCalled();
  });

  it("hotkey_leave leaves the call while connected", () => {
    setCallState("connected");
    handlerFor("hotkey_leave")({ payload: undefined });
    expect(useSessionStore.getState().leaveVoice).toHaveBeenCalledTimes(1);
  });

  it("hotkey_ptt_press mutes while connected, no-ops otherwise", () => {
    setCallState("idle");
    handlerFor("hotkey_ptt_press")({ payload: undefined });
    expect(useSessionStore.getState().setMuted).not.toHaveBeenCalled();

    setCallState("connected");
    handlerFor("hotkey_ptt_press")({ payload: undefined });
    expect(useSessionStore.getState().setMuted).toHaveBeenCalledWith(false);
  });

  it("hotkey_ptt_release unmutes while connected, no-ops otherwise", () => {
    setCallState("idle");
    handlerFor("hotkey_ptt_release")({ payload: undefined });
    expect(useSessionStore.getState().setMuted).not.toHaveBeenCalledWith(true);

    setCallState("connected");
    handlerFor("hotkey_ptt_release")({ payload: undefined });
    expect(useSessionStore.getState().setMuted).toHaveBeenCalledWith(true);
  });
});
