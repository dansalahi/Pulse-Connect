use tauri::AppHandle;

use crate::shared::error::AppError;
use crate::shared::validation::validate_string;

use super::manager::{HotkeyAction, HotkeyBinding, HotkeyManager};

#[tauri::command]
pub fn get_hotkey_bindings(manager: tauri::State<HotkeyManager>) -> Vec<HotkeyBinding> {
    manager.get_bindings()
}

#[tauri::command]
pub fn set_hotkey_binding(
    app: AppHandle,
    manager: tauri::State<HotkeyManager>,
    action: HotkeyAction,
    accelerator: String,
) -> Result<(), AppError> {
    validate_string(&accelerator, 64, "accelerator")?;
    manager.set_binding(&app, action, accelerator)
}

#[tauri::command]
pub fn reset_hotkeys(app: AppHandle, manager: tauri::State<HotkeyManager>) {
    manager.reset(&app);
}

/// Called by the frontend when a voice call becomes active.
/// Registers the PTT shortcut so it is only active during calls.
#[tauri::command]
pub fn enable_ptt_hotkey(app: AppHandle, manager: tauri::State<HotkeyManager>) -> Result<(), AppError> {
    manager.enable_ptt(&app)
}

/// Called by the frontend when a voice call ends.
/// Unregisters the PTT shortcut so bare keys like Space work normally.
#[tauri::command]
pub fn disable_ptt_hotkey(app: AppHandle, manager: tauri::State<HotkeyManager>) {
    manager.disable_ptt(&app);
}
