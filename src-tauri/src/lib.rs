mod auth;
mod error;
mod friends;
mod hotkeys;
mod overlay;
mod perf;
mod telemetry;
pub mod validation;
mod voice;

use auth::AuthManager;
use friends::FriendsManager;
use hotkeys::HotkeyManager;
use tauri::Manager;
use telemetry::Telemetry;
use voice::VoiceManager;

// Re-export for integration tests in tests/
pub use voice::VoiceManager as VoiceManagerPub;

/// App start instant — set once at the very beginning of setup().
pub static APP_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Cold-start duration — set once at the END of setup() when the app is fully
/// initialised. Stays constant for the lifetime of the process (unlike uptime).
pub static COLD_START_MS: std::sync::OnceLock<u64> = std::sync::OnceLock::new();

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
        .manage(perf::PerfTracker::new())
        .setup(move |app| {
            // Record start time as early as possible for cold-start measurement.
            APP_START.set(std::time::Instant::now()).ok();

            // ── Logging + crash hook setup ────────────────────────────────────
            let app_data_dir = app.path().app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir());

            // Rotating daily log files: <app-data>/logs/pulse-connect.YYYY-MM-DD.log
            let log_dir = app_data_dir.join("logs");
            std::fs::create_dir_all(&log_dir).ok();
            let file_appender = tracing_appender::rolling::daily(&log_dir, "pulse-connect.log");
            let (non_blocking, log_guard) = tracing_appender::non_blocking(file_appender);
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::from_default_env()
                        .add_directive("pulse_connect_lib=info".parse().expect("valid directive")),
                )
                .with_writer(non_blocking)
                .with_ansi(false)
                .try_init()
                .ok();
            // Keep the guard alive for the entire app lifetime — dropping it
            // would flush and close the log file prematurely.
            app.manage(telemetry::LogGuard(log_guard));

            // Panic hook: writes a scrubbed entry to crash.log before the process dies.
            let crash_log_path = app_data_dir.join("crash.log");
            std::panic::set_hook(Box::new(move |info| {
                let payload = info
                    .payload()
                    .downcast_ref::<&str>()
                    .map(|s| s.to_string())
                    .or_else(|| info.payload().downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "unknown panic".to_string());
                let location = info
                    .location()
                    .map(|l| format!("{}:{}", l.file(), l.line()))
                    .unwrap_or_else(|| "unknown".to_string());
                let entry = format!(
                    "[{}] PANIC at {}: {}\n",
                    chrono::Utc::now().to_rfc3339(),
                    location,
                    telemetry::scrub_pii(&payload),
                );
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&crash_log_path)
                {
                    let _ = std::io::Write::write_all(&mut f, entry.as_bytes());
                }
                eprintln!("{entry}");
            }));

            // ── Window setup ──────────────────────────────────────────────────
            // tauri-plugin-window-state can restore a previously-visible overlay.
            // Always force it hidden on startup regardless of saved state.
            // Also clear the native background so WKWebView renders transparent when shown.
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.set_background_color(None);
                let _ = overlay.hide();
            }

            // Register global hotkeys (loads saved bindings or defaults).
            hotkey_manager.start(app.handle());

            let auth = app.state::<AuthManager>().inner().clone();
            let friends = app.state::<FriendsManager>().inner().clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                auth.bootstrap(&app_handle).await;
                friends.start(app_handle);
            });

            if let Some(window) = app.get_webview_window("main") {
                let friends_for_close = app.state::<FriendsManager>().inner().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        friends_for_close.signal_shutdown();
                    }
                });
            }

            // ── Debug window (--debug flag) ───────────────────────────────────
            // Not shown by default; opened only when the binary is launched with
            // the --debug argument.  Read-only, no auth or store access.
            if std::env::args().any(|a| a == "--debug") {
                tracing::info!("--debug flag detected, opening debug tools window");
                tauri::WebviewWindowBuilder::new(
                    app,
                    "debug",
                    tauri::WebviewUrl::App("src/debug.html".into()),
                )
                .title("Pulse Connect Debug Tools")
                .inner_size(500.0, 620.0)
                .resizable(true)
                .always_on_top(false)
                .build()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            }

            // Capture cold-start time now that all initialisation is complete.
            if let Some(start) = APP_START.get() {
                COLD_START_MS.set(start.elapsed().as_millis() as u64).ok();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::login,
            auth::logout,
            auth::get_session,
            friends::get_ws_connected,
            friends::get_friends,
            friends::add_friend,
            friends::accept_friend,
            friends::reject_friend,
            friends::remove_friend,
            friends::block_user,
            friends::unblock_user,
            friends::get_blocked_users,
            friends::set_my_status,
            voice::join_voice,
            voice::leave_voice,
            voice::set_muted,
            voice::set_deafened,
            voice::get_voice_state,
            voice::invite_to_call,
            voice::respond_to_call,
            voice::cancel_call,
            overlay::show_overlay,
            overlay::hide_overlay,
            overlay::overlay_toggle_mute,
            overlay::overlay_leave_call,
            overlay::overlay_close,
            hotkeys::get_hotkey_bindings,
            hotkeys::set_hotkey_binding,
            hotkeys::reset_hotkeys,
            hotkeys::enable_ptt_hotkey,
            hotkeys::disable_ptt_hotkey,
            telemetry::add_breadcrumb,
            telemetry::send_diagnostics,
            perf::get_perf_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
