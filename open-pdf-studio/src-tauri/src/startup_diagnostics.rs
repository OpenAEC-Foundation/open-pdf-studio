use serde_json::json;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const MAX_LOG_BYTES: u64 = 512 * 1024;
const ALLOWED_PHASES: &[&str] = &[
    "native-created",
    "frontend-boot-start",
    "frontend-rendered",
    "frontend-ready",
    "frontend-error",
    "frontend-rejection",
];

pub fn sanitize_phase(phase: &str) -> &str {
    ALLOWED_PHASES
        .iter()
        .copied()
        .find(|allowed| *allowed == phase)
        .unwrap_or("unknown")
}

pub fn redact_detail(detail: &str) -> String {
    detail
        .split_whitespace()
        .take(40)
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            if lower.contains("http://") || lower.contains("https://") {
                "[url]"
            } else if part.contains(":\\")
                || part.contains(":/")
                || part.starts_with("/Users/")
                || part.starts_with("/home/")
            {
                "[path]"
            } else if lower.contains(".pdf") {
                "[document]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub struct StartupDiagnostics {
    path: PathBuf,
    session: String,
}

impl StartupDiagnostics {
    pub fn new(path: PathBuf) -> Self {
        if fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) > MAX_LOG_BYTES {
            let previous = path.with_extension("previous.jsonl");
            let _ = fs::remove_file(&previous);
            let _ = fs::rename(&path, previous);
        }
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Self {
            path,
            session: format!("{}-{started}", std::process::id()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn record(&self, phase: &str, detail: Option<&str>) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let phase = sanitize_phase(phase);
        let detail = match phase {
            "frontend-error" | "frontend-rejection" => detail.map(redact_detail),
            _ => None,
        };
        let entry = json!({
            "timestampMs": timestamp_ms,
            "session": self.session,
            "phase": phase,
            "detail": detail,
        });
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            let _ = writeln!(file, "{entry}");
        }
    }
}

#[tauri::command]
pub fn startup_diagnostic(
    diagnostics: State<'_, StartupDiagnostics>,
    phase: String,
    detail: Option<String>,
) {
    diagnostics.record(&phase, detail.as_deref());
}

#[tauri::command]
pub fn startup_diagnostics_path(diagnostics: State<'_, StartupDiagnostics>) -> String {
    diagnostics.path().to_string_lossy().into_owned()
}
