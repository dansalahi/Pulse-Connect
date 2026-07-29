/**
 * Hotkey action/binding types shared between SettingsPage's rebinding UI,
 * VoicePage's shortcut legend, and the Rust global-hotkey manager over IPC.
 */
export type HotkeyAction = "Mute" | "Deafen" | "Ptt" | "Leave"

export interface HotkeyBinding {
  action: HotkeyAction
  accelerator: string
}
