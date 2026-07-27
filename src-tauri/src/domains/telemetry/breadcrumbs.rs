use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};

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

