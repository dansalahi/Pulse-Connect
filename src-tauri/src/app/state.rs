//! Process-lifetime globals for startup performance telemetry: set once
//! during `setup()` and read elsewhere (e.g. by `domains::telemetry`).

use std::sync::OnceLock;
use std::time::Instant;

/// App start instant — set once at the very beginning of setup().
pub static APP_START: OnceLock<Instant> = OnceLock::new();

/// Cold-start duration — set once at the END of setup() when the app is fully
/// initialised. Stays constant for the lifetime of the process (unlike uptime).
pub static COLD_START_MS: OnceLock<u64> = OnceLock::new();
