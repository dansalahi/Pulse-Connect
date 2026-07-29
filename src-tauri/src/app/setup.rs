//! Tauri `setup()` hook, run once at startup: initializes logging and the
//! crash panic hook, hides the overlay window, registers global hotkeys,
//! kicks off auth bootstrap and the gateway connection, and (with `--debug`)
//! opens the debug tools window.

use tauri::Manager;

use crate::app::state::{APP_START, COLD_START_MS};
use crate::domains::auth::AuthManager;
use crate::domains::friends::FriendsManager;
use crate::domains::hotkeys::HotkeyManager;
use crate::domains::telemetry;
use crate::gateway::Gateway;

pub fn run(
    app: &mut tauri::App,
    hotkey_manager: HotkeyManager,
) -> Result<(), Box<dyn std::error::Error>> {
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
    let gateway = app.state::<Gateway>().inner().clone();
    friends.register_routes(&gateway);

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        auth.bootstrap(&app_handle).await;
        gateway.start(app_handle);
    });

    if let Some(window) = app.get_webview_window("main") {
        let gateway_for_close = app.state::<Gateway>().inner().clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Destroyed = event {
                gateway_for_close.signal_shutdown();
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
}
