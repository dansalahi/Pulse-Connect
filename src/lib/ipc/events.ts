import { emit, listen } from "@tauri-apps/api/event";
import type { Event, UnlistenFn } from "@tauri-apps/api/event";
import type { Friend } from "../../features/friends/types/friends";

// ---------------------------------------------------------------------------
// Typed catalog of every Tauri event used with listen()/emit() across the
// frontend — main window call signaling, overlay button actions, global
// hotkeys, friend presence, and the overlay window's live state feed.
// ---------------------------------------------------------------------------

export interface CallInvitePayload {
  from_user_id: string;
  from_display_name: string;
  room_name: string;
}

export interface CallAcceptedPayload {
  room_name: string;
  from_user_id: string;
}

export interface CallDeclinedPayload {
  from_user_id: string;
}

export interface CallCancelledPayload {
  from_user_id: string;
}

export interface OverlayParticipantPayload {
  identity: string;
  display_name: string;
  is_muted: boolean;
  is_speaking: boolean;
}

export interface OverlayUpdatePayload {
  participants: OverlayParticipantPayload[];
  room_name: string;
  is_muted: boolean;
}

export interface EventPayloadMap {
  // ── Call signaling (emitted by the Rust backend) ──────────────────────────
  call_invite: CallInvitePayload;
  call_accepted: CallAcceptedPayload;
  call_declined: CallDeclinedPayload;
  call_cancelled: CallCancelledPayload;
  // ── Overlay action events (emitted by the overlay window's buttons) ───────
  overlay_mute_toggle: void;
  overlay_leave_call: void;
  overlay_close: void;
  // ── Global hotkey events (emitted by Rust when a shortcut fires) ──────────
  hotkey_mute: void;
  hotkey_deafen: void;
  hotkey_leave: void;
  hotkey_ptt_press: void;
  hotkey_ptt_release: void;
  // ── Friends presence / websocket lifecycle ─────────────────────────────────
  presence_update: Friend;
  ws_disconnected: null;
  ws_connected: null;
  // ── Overlay window live state feed (emitted by the main window) ───────────
  overlay_update: OverlayUpdatePayload;
}

export type AppEventName = keyof EventPayloadMap;

/**
 * Typed listen()/emit() wrappers over the Tauri event bus. Payload shapes
 * come from EventPayloadMap above, keeping event names and their data in
 * one place instead of re-declaring the payload type at every call site.
 */
export const events = {
  listen<K extends AppEventName>(
    name: K,
    handler: (payload: EventPayloadMap[K], event: Event<EventPayloadMap[K]>) => void,
  ): Promise<UnlistenFn> {
    return listen<EventPayloadMap[K]>(name, (event) => handler(event.payload, event));
  },

  emit<K extends AppEventName>(name: K, payload: EventPayloadMap[K]): Promise<void> {
    return emit(name, payload);
  },
};
