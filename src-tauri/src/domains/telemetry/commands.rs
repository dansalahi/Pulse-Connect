use chrono::Utc;

use crate::shared::error::AppError;
use crate::shared::validation::validate_string;

use super::breadcrumbs::{scrub_pii, Telemetry};

#[tauri::command]
pub fn add_breadcrumb(
    category: String,
    message: String,
    telemetry: tauri::State<'_, Telemetry>,
) -> Result<(), AppError> {
    validate_string(&category, 32, "category")?;
    validate_string(&message, 200, "message")?;
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
