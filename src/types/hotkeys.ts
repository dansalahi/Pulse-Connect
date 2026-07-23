export type HotkeyAction = "Mute" | "Deafen" | "Ptt" | "Leave"

export interface HotkeyBinding {
  action: HotkeyAction
  accelerator: string
}
