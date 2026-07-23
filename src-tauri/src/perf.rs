use std::collections::VecDeque;
use std::sync::Mutex;

use sysinfo::{Pid, System};

use crate::error::AppError;

// ---------------------------------------------------------------------------
// Stats payload
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
pub struct PerfStats {
    pub memory_mb: f64,
    pub memory_peak_mb: f64,
    pub cpu_percent: f32,
    pub uptime_seconds: u64,
    pub cold_start_ms: u64,
}

// ---------------------------------------------------------------------------
// Tracker state (managed by Tauri)
// ---------------------------------------------------------------------------

pub struct PerfTracker {
    system: Mutex<System>,
    peak_memory_mb: Mutex<f64>,
    cpu_history: Mutex<VecDeque<f32>>,
}

impl PerfTracker {
    pub fn new() -> Self {
        // Pre-populate process list so the first get_perf_stats call has data.
        let mut sys = System::new_all();
        sys.refresh_all();
        Self {
            system: Mutex::new(sys),
            peak_memory_mb: Mutex::new(0.0),
            cpu_history: Mutex::new(VecDeque::with_capacity(10)),
        }
    }
}

impl Default for PerfTracker {
    fn default() -> Self { Self::new() }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_perf_stats(tracker: tauri::State<'_, PerfTracker>) -> Result<PerfStats, AppError> {
    let mut sys = tracker
        .system
        .lock()
        .map_err(|e| AppError::Internal(format!("perf lock poisoned: {e}")))?;

    // Refresh this process's data; a second refresh gives accurate CPU delta.
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_process(pid);

    let process = sys
        .process(pid)
        .ok_or_else(|| AppError::Internal("current process not found in sysinfo".into()))?;

    let memory_mb = process.memory() as f64 / 1_048_576.0;
    let instant_cpu = process.cpu_usage();
    let uptime_seconds = process.run_time();

    drop(sys); // release sys lock before acquiring the other locks

    // Rolling 10-sample average (≈10 s at 1 poll/s) — smooths out spikes and
    // matches the "idle CPU" spec intent better than an instantaneous reading.
    let cpu_percent = {
        let mut hist = tracker
            .cpu_history
            .lock()
            .map_err(|e| AppError::Internal(format!("cpu_history lock poisoned: {e}")))?;
        if hist.len() == 10 {
            hist.pop_front();
        }
        hist.push_back(instant_cpu);
        hist.iter().sum::<f32>() / hist.len() as f32
    };

    let mut peak = tracker
        .peak_memory_mb
        .lock()
        .map_err(|e| AppError::Internal(format!("peak lock poisoned: {e}")))?;
    if memory_mb > *peak {
        *peak = memory_mb;
    }
    let memory_peak_mb = *peak;

    let cold_start_ms = crate::COLD_START_MS.get().copied().unwrap_or(0);

    Ok(PerfStats {
        memory_mb,
        memory_peak_mb,
        cpu_percent,
        uptime_seconds,
        cold_start_ms,
    })
}
