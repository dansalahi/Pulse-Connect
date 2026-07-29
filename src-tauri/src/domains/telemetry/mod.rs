//! Telemetry domain entry point — re-exports breadcrumb tracking, diagnostics
//! commands, and performance stats as the domain's public surface.

mod breadcrumbs;
mod commands;
mod perf;

pub use breadcrumbs::*;
pub use commands::*;
pub use perf::*;
