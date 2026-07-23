use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

const MAX_BREADCRUMBS: usize = 20;

// Compiled once at first use — avoids re-compiling on every scrub_pii call.
static EMAIL_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"[\w.+-]+@[\w.-]+\.\w+").expect("valid email regex")
});
static BEARER_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)bearer\s+\S+").expect("valid bearer regex")
});
static TOKEN_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"[A-Za-z0-9+/=_-]{40,}").expect("valid token regex")
});

/// Replace emails, bearer tokens, and long base64-ish strings with placeholders.
/// Applied before any string reaches the breadcrumb buffer or the log zip.
pub fn scrub_pii(s: &str) -> String {
    let s = BEARER_RE.replace_all(s, "<bearer-token>");
    let s = EMAIL_RE.replace_all(&s, "<email>");
    TOKEN_RE.replace_all(&s, "<token>").into_owned()
}

// ---------------------------------------------------------------------------
// Breadcrumb ring buffer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Breadcrumb {
    pub timestamp: String,
    pub category: String,
    pub message: String,
}

pub struct Telemetry {
    breadcrumbs: Mutex<VecDeque<Breadcrumb>>,
}

impl Telemetry {
    pub fn new() -> Self {
        Self { breadcrumbs: Mutex::new(VecDeque::with_capacity(MAX_BREADCRUMBS)) }
    }

    pub fn add(&self, category: &str, message: String) {
        let scrubbed = scrub_pii(&message);
        let crumb = Breadcrumb {
            timestamp: Utc::now().to_rfc3339(),
            category: category.to_string(),
            message: scrubbed,
        };
        let mut buf = self.breadcrumbs.lock().unwrap_or_else(|p| p.into_inner());
        if buf.len() >= MAX_BREADCRUMBS {
            buf.pop_front();
        }
        buf.push_back(crumb);
    }

    pub fn snapshot(&self) -> Vec<Breadcrumb> {
        self.breadcrumbs
            .lock()
            .map(|b| b.iter().cloned().collect())
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Log guard — keeps the non-blocking tracing writer alive for the app lifetime
// ---------------------------------------------------------------------------

// Field is intentionally never read — holding the guard alive keeps the
// background log-writer thread running for the entire app lifetime.
#[allow(dead_code)]
pub struct LogGuard(pub tracing_appender::non_blocking::WorkerGuard);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn add_breadcrumb(
    category: String,
    message: String,
    telemetry: tauri::State<'_, Telemetry>,
) -> Result<(), AppError> {
    crate::validation::validate_string(&category, 32, "category")?;
    crate::validation::validate_string(&message, 200, "message")?;
    tracing::info!(category = %category, message = %message, "breadcrumb added");
    telemetry.add(&category, message);
    Ok(())
}

#[tauri::command]
pub async fn send_diagnostics(
    app: tauri::AppHandle,
    telemetry: tauri::State<'_, Telemetry>,
) -> Result<String, AppError> {
    use std::io::Write;
    use tauri::Manager;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
    let zip_path = downloads_dir.join(format!("pulse-connect-diagnostics-{timestamp}.zip"));

    let file = std::fs::File::create(&zip_path)
        .map_err(|e| AppError::Internal(format!("create zip: {e}")))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // breadcrumbs.json
    zip.start_file("breadcrumbs.json", opts)
        .map_err(|e| AppError::Internal(format!("zip start breadcrumbs: {e}")))?;
    let crumbs = serde_json::to_string_pretty(&telemetry.snapshot())
        .map_err(|e| AppError::Internal(format!("serialize breadcrumbs: {e}")))?;
    zip.write_all(crumbs.as_bytes())
        .map_err(|e| AppError::Internal(format!("write breadcrumbs: {e}")))?;

    // system-info.txt
    zip.start_file("system-info.txt", opts)
        .map_err(|e| AppError::Internal(format!("zip start sysinfo: {e}")))?;
    let sys_info = format!(
        "OS: {}\nArch: {}\nApp version: {}\nTimestamp: {}\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        env!("CARGO_PKG_VERSION"),
        Utc::now().to_rfc3339(),
    );
    zip.write_all(sys_info.as_bytes())
        .map_err(|e| AppError::Internal(format!("write sysinfo: {e}")))?;

    // logs/ — scrubbed before zipping
    let log_dir = app_data_dir.join("logs");
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                let scrubbed = scrub_pii(&content);
                let filename = format!("logs/{}", entry.file_name().to_string_lossy());
                zip.start_file(&filename, opts)
                    .map_err(|e| AppError::Internal(format!("zip start log: {e}")))?;
                zip.write_all(scrubbed.as_bytes())
                    .map_err(|e| AppError::Internal(format!("write log: {e}")))?;
            }
        }
    }

    // crash.log — already scrubbed at write time (panic hook), include as-is
    let crash_log = app_data_dir.join("crash.log");
    if let Ok(content) = std::fs::read_to_string(&crash_log) {
        zip.start_file("crash.log", opts)
            .map_err(|e| AppError::Internal(format!("zip start crash.log: {e}")))?;
        zip.write_all(content.as_bytes())
            .map_err(|e| AppError::Internal(format!("write crash.log: {e}")))?;
    }

    zip.finish().map_err(|e| AppError::Internal(format!("zip finish: {e}")))?;

    // Open the containing folder so the user can find the file
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg("-R").arg(&zip_path).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg("/select,").arg(&zip_path).spawn();
    #[cfg(target_os = "linux")]
    {
        let parent = zip_path.parent().unwrap_or(downloads_dir.as_path());
        let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
    }

    Ok(zip_path.to_string_lossy().into_owned())
}
