import { invoke } from "@tauri-apps/api/core";
import type { AuthUser } from "../../features/auth/types/auth";
import type { BlockedUser, Friend, MyStatus } from "../../features/friends/types/friends";
import type { HotkeyAction, HotkeyBinding } from "../../features/settings/types/hotkeys";
import type { VoiceJoinResponse, VoiceState } from "../../features/voice/types/voice";

// ---------------------------------------------------------------------------
// Typed wrappers around every Tauri command invoked from the frontend,
// grouped by backend domain (see src-tauri/src/{auth,friends,voice,overlay,
// hotkeys,telemetry}.rs). Every command below rejects with the AppError
// shape from src/types/auth.ts (`{ code, message }`), so callers can treat
// a caught rejection as `AppError` the same way src/store/authStore.ts does.
// ---------------------------------------------------------------------------

export const ipc = {
  auth: {
    /** @throws {AppError} */
    login: (email: string, password: string) =>
      invoke<AuthUser>("login", { email, password }),
    /** @throws {AppError} */
    logout: () => invoke<void>("logout"),
    /** @throws {AppError} */
    getSession: () => invoke<AuthUser | null>("get_session"),
  },

  friends: {
    /** @throws {AppError} */
    getWsConnected: () => invoke<boolean>("get_ws_connected"),
    /** @throws {AppError} */
    getFriends: () => invoke<Friend[]>("get_friends"),
    /** @throws {AppError} */
    addFriend: (userId: string) => invoke<void>("add_friend", { userId }),
    /** @throws {AppError} */
    acceptFriend: (requestId: string) => invoke<void>("accept_friend", { requestId }),
    /** @throws {AppError} */
    rejectFriend: (requestId: string) => invoke<void>("reject_friend", { requestId }),
    /** @throws {AppError} */
    removeFriend: (friendId: string) => invoke<void>("remove_friend", { friendId }),
    /** @throws {AppError} */
    blockUser: (userId: string) => invoke<void>("block_user", { userId }),
    /** @throws {AppError} */
    unblockUser: (userId: string) => invoke<void>("unblock_user", { userId }),
    /** @throws {AppError} */
    getBlockedUsers: () => invoke<BlockedUser[]>("get_blocked_users"),
    /** @throws {AppError} */
    setMyStatus: (status: MyStatus, game: string | null) =>
      invoke<void>("set_my_status", { status, game }),
  },

  voice: {
    /** @throws {AppError} */
    joinVoice: (roomName: string, friendId: string) =>
      invoke<VoiceJoinResponse>("join_voice", { roomName, friendId }),
    /** @throws {AppError} */
    leaveVoice: () => invoke<void>("leave_voice"),
    /** @throws {AppError} */
    setMuted: (muted: boolean) => invoke<void>("set_muted", { muted }),
    /** @throws {AppError} */
    setDeafened: (deafened: boolean) => invoke<void>("set_deafened", { deafened }),
    /** @throws {AppError} */
    getVoiceState: () => invoke<VoiceState>("get_voice_state"),
    /** @throws {AppError} */
    inviteToCall: (targetUserId: string, roomName: string) =>
      invoke<void>("invite_to_call", { targetUserId, roomName }),
    /** @throws {AppError} */
    respondToCall: (accepted: boolean, roomName: string, callerUserId: string) =>
      invoke<void>("respond_to_call", { accepted, roomName, callerUserId }),
    /** @throws {AppError} */
    cancelCall: (targetUserId: string) => invoke<void>("cancel_call", { targetUserId }),
  },

  overlay: {
    /** @throws {AppError} */
    showOverlay: () => invoke<void>("show_overlay"),
    /** @throws {AppError} */
    hideOverlay: () => invoke<void>("hide_overlay"),
    /** @throws {AppError} */
    overlayToggleMute: () => invoke<void>("overlay_toggle_mute"),
    /** @throws {AppError} */
    overlayLeaveCall: () => invoke<void>("overlay_leave_call"),
    /** @throws {AppError} */
    overlayClose: () => invoke<void>("overlay_close"),
  },

  hotkeys: {
    /** @throws {AppError} */
    getHotkeyBindings: () => invoke<HotkeyBinding[]>("get_hotkey_bindings"),
    /** @throws {AppError} */
    setHotkeyBinding: (action: HotkeyAction, accelerator: string) =>
      invoke<void>("set_hotkey_binding", { action, accelerator }),
    /** @throws {AppError} */
    resetHotkeys: () => invoke<void>("reset_hotkeys"),
    /** @throws {AppError} */
    enablePttHotkey: () => invoke<void>("enable_ptt_hotkey"),
    /** @throws {AppError} */
    disablePttHotkey: () => invoke<void>("disable_ptt_hotkey"),
  },

  telemetry: {
    /** @throws {AppError} */
    addBreadcrumb: (category: string, message: string) =>
      invoke<void>("add_breadcrumb", { category, message }),
    /** @throws {AppError} */
    sendDiagnostics: () => invoke<string>("send_diagnostics"),
  },
};
