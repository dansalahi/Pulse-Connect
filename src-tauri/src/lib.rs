mod app;
mod domains;
mod shared;

use domains::auth::AuthManager;
use domains::friends::FriendsManager;
use domains::hotkeys::HotkeyManager;
use domains::telemetry::{self, Telemetry};
use domains::voice::VoiceManager;

// Re-export for integration tests in tests/
pub use domains::voice::VoiceManager as VoiceManagerPub;

pub use app::state::{APP_START, COLD_START_MS};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let auth_manager = AuthManager::new().expect("Failed to create AuthManager");
    let friends_manager = FriendsManager::new();
    let voice_manager = VoiceManager::new();
    let hotkey_manager = HotkeyManager::new();
    let telemetry_state = Telemetry::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        // single-instance disabled for multi-window testing
        // .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        //     if let Some(window) = app.get_webview_window("main") {
        //         let _ = window.set_focus();
        //     }
        // }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(auth_manager.clone())
        .manage(friends_manager.clone())
        .manage(voice_manager)
        .manage(hotkey_manager.clone())
        .manage(telemetry_state)
        .manage(telemetry::PerfTracker::new())
        .setup(move |app| app::setup::run(app, hotkey_manager))
        .invoke_handler(tauri::generate_handler![
            domains::auth::login,
            domains::auth::logout,
            domains::auth::get_session,
            domains::friends::get_ws_connected,
            domains::friends::get_friends,
            domains::friends::add_friend,
            domains::friends::accept_friend,
            domains::friends::reject_friend,
            domains::friends::remove_friend,
            domains::friends::block_user,
            domains::friends::unblock_user,
            domains::friends::get_blocked_users,
            domains::friends::set_my_status,
            domains::voice::join_voice,
            domains::voice::leave_voice,
            domains::voice::set_muted,
            domains::voice::set_deafened,
            domains::voice::get_voice_state,
            domains::voice::invite_to_call,
            domains::voice::respond_to_call,
            domains::voice::cancel_call,
            domains::overlay::show_overlay,
            domains::overlay::hide_overlay,
            domains::overlay::overlay_toggle_mute,
            domains::overlay::overlay_leave_call,
            domains::overlay::overlay_close,
            domains::hotkeys::get_hotkey_bindings,
            domains::hotkeys::set_hotkey_binding,
            domains::hotkeys::reset_hotkeys,
            domains::hotkeys::enable_ptt_hotkey,
            domains::hotkeys::disable_ptt_hotkey,
            domains::telemetry::add_breadcrumb,
            domains::telemetry::send_diagnostics,
            domains::telemetry::get_perf_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
