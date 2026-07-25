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

// The voice store pulls in livekit-client and browser media APIs that don't
// exist in jsdom, so it's mocked to a plain object of spies. eventBridge only
// ever reaches it through useVoiceStore.getState()/setState().
vi.mock("../features/voice/store/voiceStore", () => {
  const state = {
    callState: "idle",
    isOverlayVisible: false,
    handleIncomingCall: vi.fn(),
    handleCallAccepted: vi.fn(),
    handleCallDeclined: vi.fn(),
    handleCallCancelled: vi.fn(),
    toggleMute: vi.fn(),
    leaveVoice: vi.fn(),
    toggleDeafen: vi.fn(),
    setMuted: vi.fn(),
  };
  return {
    useVoiceStore: {
      getState: () => state,
      setState: vi.fn((patch: Record<string, unknown>) => Object.assign(state, patch)),
    },
  };
});

// Imported after the mocks above so both pick up the mocked modules.
import { mountEventBridge } from "../lib/eventBridge";
import { useVoiceStore } from "../features/voice/store/voiceStore";
import type { CallState } from "../features/voice/store/voiceStore";

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
  useVoiceStore.getState().callState = callState;
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
  vi.mocked(useVoiceStore.setState).mockClear();
  const state = useVoiceStore.getState();
  for (const value of Object.values(state)) {
    if (typeof value === "function" && "mockClear" in value) {
      (value as ReturnType<typeof vi.fn>).mockClear();
    }
  }
  state.callState = "idle";
  state.isOverlayVisible = false;
});

// ---------------------------------------------------------------------------
// Call signaling
// ---------------------------------------------------------------------------

describe("eventBridge — call signaling", () => {
  it("dispatches call_invite to voiceStore.handleIncomingCall", () => {
    handlerFor("call_invite")({
      payload: { from_user_id: "u1", from_display_name: "Alice", room_name: "room-1" },
    });
    expect(useVoiceStore.getState().handleIncomingCall).toHaveBeenCalledWith(
      "u1",
      "Alice",
      "room-1",
    );
  });

  it("dispatches call_accepted to voiceStore.handleCallAccepted", () => {
    handlerFor("call_accepted")({
      payload: { room_name: "room-2", from_user_id: "u2" },
    });
    expect(useVoiceStore.getState().handleCallAccepted).toHaveBeenCalledWith("u2", "room-2");
  });

  it("dispatches call_declined to voiceStore.handleCallDeclined", () => {
    handlerFor("call_declined")({ payload: { from_user_id: "u3" } });
    expect(useVoiceStore.getState().handleCallDeclined).toHaveBeenCalledTimes(1);
  });

  it("dispatches call_cancelled to voiceStore.handleCallCancelled", () => {
    handlerFor("call_cancelled")({ payload: { from_user_id: "u4" } });
    expect(useVoiceStore.getState().handleCallCancelled).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Overlay actions
// ---------------------------------------------------------------------------

describe("eventBridge — overlay actions", () => {
  it("dispatches overlay_mute_toggle to voiceStore.toggleMute", () => {
    handlerFor("overlay_mute_toggle")({ payload: undefined });
    expect(useVoiceStore.getState().toggleMute).toHaveBeenCalledTimes(1);
  });

  it("dispatches overlay_leave_call to voiceStore.leaveVoice", () => {
    handlerFor("overlay_leave_call")({ payload: undefined });
    expect(useVoiceStore.getState().leaveVoice).toHaveBeenCalledTimes(1);
  });

  it("overlay_close hides the overlay and clears isOverlayVisible", () => {
    useVoiceStore.getState().isOverlayVisible = true;

    handlerFor("overlay_close")({ payload: undefined });

    expect(invoke).toHaveBeenCalledWith("hide_overlay");
    expect(useVoiceStore.setState).toHaveBeenCalledWith({ isOverlayVisible: false });
    expect(useVoiceStore.getState().isOverlayVisible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Global hotkeys — guarded to only act while a call is connected
// ---------------------------------------------------------------------------

describe("eventBridge — global hotkeys", () => {
  it("hotkey_mute is a no-op when not in a connected call", () => {
    setCallState("idle");
    handlerFor("hotkey_mute")({ payload: undefined });
    expect(useVoiceStore.getState().toggleMute).not.toHaveBeenCalled();
  });

  it("hotkey_mute toggles mute while connected", () => {
    setCallState("connected");
    handlerFor("hotkey_mute")({ payload: undefined });
    expect(useVoiceStore.getState().toggleMute).toHaveBeenCalledTimes(1);
  });

  it("hotkey_deafen is a no-op when not in a connected call", () => {
    setCallState("calling");
    handlerFor("hotkey_deafen")({ payload: undefined });
    expect(useVoiceStore.getState().toggleDeafen).not.toHaveBeenCalled();
  });

  it("hotkey_deafen toggles deafen while connected", () => {
    setCallState("connected");
    handlerFor("hotkey_deafen")({ payload: undefined });
    expect(useVoiceStore.getState().toggleDeafen).toHaveBeenCalledTimes(1);
  });

  it("hotkey_leave is a no-op when not in a connected call", () => {
    setCallState("incoming");
    handlerFor("hotkey_leave")({ payload: undefined });
    expect(useVoiceStore.getState().leaveVoice).not.toHaveBeenCalled();
  });

  it("hotkey_leave leaves the call while connected", () => {
    setCallState("connected");
    handlerFor("hotkey_leave")({ payload: undefined });
    expect(useVoiceStore.getState().leaveVoice).toHaveBeenCalledTimes(1);
  });

  it("hotkey_ptt_press mutes while connected, no-ops otherwise", () => {
    setCallState("idle");
    handlerFor("hotkey_ptt_press")({ payload: undefined });
    expect(useVoiceStore.getState().setMuted).not.toHaveBeenCalled();

    setCallState("connected");
    handlerFor("hotkey_ptt_press")({ payload: undefined });
    expect(useVoiceStore.getState().setMuted).toHaveBeenCalledWith(false);
  });

  it("hotkey_ptt_release unmutes while connected, no-ops otherwise", () => {
    setCallState("idle");
    handlerFor("hotkey_ptt_release")({ payload: undefined });
    expect(useVoiceStore.getState().setMuted).not.toHaveBeenCalledWith(true);

    setCallState("connected");
    handlerFor("hotkey_ptt_release")({ payload: undefined });
    expect(useVoiceStore.getState().setMuted).toHaveBeenCalledWith(true);
  });
});
