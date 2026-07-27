use tauri::{Emitter, Manager};

use crate::shared::error::AppError;

/// Bridge command: overlay frontend invokes this, Rust broadcasts the event
/// to ALL windows so the main window frontend receives it via listen().
#[tauri::command]
pub fn overlay_toggle_mute(app: tauri::AppHandle) -> Result<(), AppError> {
    app.emit("overlay_mute_toggle", ())
        .map_err(|e| AppError::Unknown(e.to_string()))
}

#[tauri::command]
pub fn overlay_leave_call(app: tauri::AppHandle) -> Result<(), AppError> {
    app.emit("overlay_leave_call", ())
        .map_err(|e| AppError::Unknown(e.to_string()))
}

#[tauri::command]
pub fn overlay_close(app: tauri::AppHandle) -> Result<(), AppError> {
    app.emit("overlay_close", ())
        .map_err(|e| AppError::Unknown(e.to_string()))
}

#[tauri::command]
pub fn show_overlay(app: tauri::AppHandle) -> Result<(), AppError> {
    match app.get_webview_window("overlay") {
        Some(win) => {
            tracing::info!("Showing overlay window");
            // Clear the native window background so WKWebView renders transparent.
            // Must happen before show() to prevent a white flash on first reveal.
            win.set_background_color(None)
                .map_err(|e| AppError::Unknown(e.to_string()))?;
            win.show().map_err(|e| AppError::Unknown(e.to_string()))?;
            // Elevate window level AFTER show() — ns_window() returns null before
            // the window is made visible, which causes a panic in any AppKit call.
            #[cfg(target_os = "macos")]
            if let Ok(ptr) = win.ns_window() {
                if !ptr.is_null() {
                    use objc2::runtime::AnyObject;
                    let ns_window = ptr as *mut AnyObject;
                    unsafe {
                        // NSPopUpMenuWindowLevel = 101 — above the status bar level (25)
                        // and above other apps' fullscreen content.
                        // Known limitation: windows at this level still cannot appear over
                        // fullscreen spaces that create their own Mission Control Space
                        // (e.g. apps using NSApplicationPresentationFullScreen) without
                        // an NSPanel/NonactivatingPanelMask, which is a macOS security boundary.
                        let _: () = objc2::msg_send![ns_window, setLevel: 101_isize];
                        // CanJoinAllSpaces (1 << 0 = 1)   — appear in every MC space
                        // Transient      (1 << 3 = 8)   — don't hold a space open
                        // IgnoresCycle   (1 << 6 = 64)  — skip Cmd+Tab cycling
                        // FullScreenAuxiliary (1 << 8 = 256) — float over fullscreen content
                        let _: () = objc2::msg_send![ns_window, setCollectionBehavior: 329_usize];
                    }
                }
            }
            Ok(())
        }
        None => {
            tracing::warn!("Overlay window not found");
            Ok(())
        }
    }
}

#[tauri::command]
pub fn hide_overlay(app: tauri::AppHandle) -> Result<(), AppError> {
    match app.get_webview_window("overlay") {
        Some(win) => {
            tracing::info!("Hiding overlay window");
            win.hide().map_err(|e| AppError::Unknown(e.to_string()))
        }
        None => {
            tracing::warn!("Overlay window not found");
            Ok(())
        }
    }
}
