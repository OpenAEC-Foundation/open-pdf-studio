//! Scanner input (#382): the Tauri commands. Windows uses WIA through a fixed
//! PowerShell script (scanner_cmd::WIA_SCRIPT, parameters only), Linux SANE's
//! `scanimage`. macOS (ImageCaptureCore) is not available yet: the commands
//! answer `SCANNER_UNSUPPORTED` there and the dialog says so.
//!
//! An acquisition writes `page-NNNN.png` files into its own private folder in
//! the app cache (`scans/scan-…`). The JS side reads them with
//! `scanner_read_page`, builds the PDF and throws the folder away with
//! `scanner_discard`. Both only accept paths inside that cache folder.

use crate::scanner_cmd::{self, ScanOptions, ScannerInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Running acquisitions by job id, to cancel them.
#[derive(Default, Clone)]
pub struct ScanJobs(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerDevice {
    pub id: String,
    pub name: String,
}

impl From<ScannerInfo> for ScannerDevice {
    fn from(info: ScannerInfo) -> Self {
        Self { id: info.id, name: info.name }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanAcquired {
    pub dir: String,
    pub pages: Vec<String>,
    /// The feeder ran empty (after the pages listed, if any).
    pub feeder_empty: bool,
}

/// "wia", "sane" or "none": which route this build uses.
pub fn backend() -> &'static str {
    if cfg!(target_os = "windows") {
        "wia"
    } else if cfg!(all(unix, not(target_os = "macos"), not(target_os = "android"), not(target_os = "ios"))) {
        "sane"
    } else {
        "none"
    }
}

#[tauri::command]
pub fn scanner_backend() -> &'static str {
    backend()
}

fn scans_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let cache = app.path().app_cache_dir().map_err(|e| format!("SCAN_IO:{e}"))?;
    Ok(cache.join("scans"))
}

fn make_private_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(dir)
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn new_scan_dir(root: &Path) -> Result<PathBuf, String> {
    make_private_dir(root).map_err(|e| format!("SCAN_IO:{e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = root.join(format!("scan-{stamp}-{}-{n}", std::process::id()));
    make_private_dir(&dir).map_err(|e| format!("SCAN_IO:{e}"))?;
    Ok(dir)
}

/// `path` lies inside `root` (both resolved), so a page or folder from the JS
/// side can only ever be one of ours.
fn inside(root: &Path, path: &Path) -> bool {
    match (std::fs::canonicalize(root), std::fs::canonicalize(path)) {
        (Ok(r), Ok(p)) => p != r && p.starts_with(&r),
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn helper_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut c = std::process::Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

#[cfg(not(target_os = "windows"))]
fn helper_command(program: &str) -> std::process::Command {
    std::process::Command::new(program)
}

struct Finished {
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Run a helper until it exits, `cancel` is set or `timeout` passes. Output
/// is read on separate threads, so a chatty program never blocks on a full
/// pipe.
fn run(mut cmd: std::process::Command, cancel: &AtomicBool, timeout: Option<Duration>) -> Result<Finished, String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "SCANNER_TOOL_MISSING".to_string()
            } else {
                format!("SCAN_FAILED:{e}")
            }
        })?;
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    // Lossy: a device name in an unexpected code page must not lose the
    // whole output.
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(o) = out.as_mut() {
            let _ = o.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(e) = err.as_mut() {
            let _ = e.read_to_end(&mut buf);
        }
        String::from_utf8_lossy(&buf).into_owned()
    });
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("SCAN_FAILED:{e}"))? {
            break status;
        }
        let late = timeout.is_some_and(|t| started.elapsed() > t);
        if cancel.load(Ordering::SeqCst) || late {
            let _ = child.kill();
            let _ = child.wait();
            let _ = out_thread.join();
            let _ = err_thread.join();
            return Err(if late { "SCAN_TIMEOUT".to_string() } else { "SCAN_CANCELLED".to_string() });
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    Ok(Finished {
        status: status.code(),
        stdout: out_thread.join().unwrap_or_default(),
        stderr: err_thread.join().unwrap_or_default(),
    })
}

/// Last non-empty line of a helper's error output, for the message.
fn last_line(text: &str) -> String {
    text.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(300).collect()
}

/// The WIA script in the scans folder (written fresh each time, with a BOM:
/// Windows PowerShell reads a .ps1 without one as ANSI).
#[cfg(target_os = "windows")]
fn wia_script(root: &Path) -> Result<PathBuf, String> {
    make_private_dir(root).map_err(|e| format!("SCAN_IO:{e}"))?;
    let path = root.join("opds-wia.ps1");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(scanner_cmd::WIA_SCRIPT.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| format!("SCAN_IO:{e}"))?;
    Ok(path)
}

fn list_blocking(root: &Path) -> Result<Vec<ScannerInfo>, String> {
    let never = AtomicBool::new(false);
    match backend() {
        "sane" => {
            let _ = root;
            let mut cmd = helper_command("scanimage");
            cmd.arg("-L");
            let done = run(cmd, &never, Some(Duration::from_secs(60)))?;
            if done.status != Some(0) && done.stdout.trim().is_empty() {
                return Err(format!("SCAN_FAILED:{}", last_line(&done.stderr)));
            }
            Ok(scanner_cmd::parse_scanimage_list(&done.stdout))
        }
        #[cfg(target_os = "windows")]
        "wia" => {
            let script = wia_script(root)?;
            let mut cmd = helper_command("powershell");
            cmd.args(scanner_cmd::wia_list_args(&script));
            let done = run(cmd, &never, Some(Duration::from_secs(60)))?;
            let parsed = scanner_cmd::parse_wia_output(&done.stdout);
            if let Some(error) = parsed.error {
                return Err(format!("SCAN_FAILED:{error}"));
            }
            Ok(parsed.devices)
        }
        _ => Err("SCANNER_UNSUPPORTED".to_string()),
    }
}

/// The scanners this computer can reach.
#[tauri::command]
pub async fn scanner_list(app: tauri::AppHandle) -> Result<Vec<ScannerDevice>, String> {
    if backend() == "none" {
        return Err("SCANNER_UNSUPPORTED".to_string());
    }
    let root = scans_root(&app)?;
    let list = tauri::async_runtime::spawn_blocking(move || list_blocking(&root))
        .await
        .map_err(|e| format!("Scanner list task panicked: {e}"))??;
    Ok(list.into_iter().map(ScannerDevice::from).collect())
}

fn acquire_blocking(root: &Path, device: &str, opts: &ScanOptions, cancel: &AtomicBool) -> Result<ScanAcquired, String> {
    let dir = new_scan_dir(root)?;
    let result = (|| -> Result<ScanAcquired, String> {
        let feeder_empty = match backend() {
            "sane" => {
                let mut cmd = helper_command("scanimage");
                cmd.args(scanner_cmd::scanimage_acquire_args(device, opts, &dir)?);
                let done = run(cmd, cancel, None)?;
                let empty = scanner_cmd::sane_feeder_empty(done.status, &done.stderr);
                if done.status != Some(0) && !empty && scanner_cmd::collect_pages(&dir).is_empty() {
                    return Err(format!("SCAN_FAILED:{}", last_line(&done.stderr)));
                }
                empty
            }
            #[cfg(target_os = "windows")]
            "wia" => {
                let script = wia_script(root)?;
                let mut cmd = helper_command("powershell");
                cmd.args(scanner_cmd::wia_acquire_args(&script, device, opts, &dir)?);
                let done = run(cmd, cancel, None)?;
                let parsed = scanner_cmd::parse_wia_output(&done.stdout);
                if let Some(error) = parsed.error {
                    if scanner_cmd::collect_pages(&dir).is_empty() {
                        return Err(format!("SCAN_FAILED:{error}"));
                    }
                }
                parsed.feeder_empty
            }
            _ => return Err("SCANNER_UNSUPPORTED".to_string()),
        };
        let pages: Vec<String> = scanner_cmd::collect_pages(&dir)
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if pages.is_empty() && feeder_empty {
            return Err("SCAN_FEEDER_EMPTY".to_string());
        }
        if pages.is_empty() {
            return Err("SCAN_NO_PAGES".to_string());
        }
        Ok(ScanAcquired { dir: dir.to_string_lossy().into_owned(), pages, feeder_empty })
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}

/// Acquire pages: one from the flatbed, or up to `max_pages` (0 = all) from
/// the feeder. Cancel with `scanner_cancel(job_id)`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn scanner_acquire(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, ScanJobs>,
    job_id: String,
    device_id: String,
    dpi: u32,
    mode: String,
    source: String,
    max_pages: u32,
) -> Result<ScanAcquired, String> {
    if backend() == "none" {
        return Err("SCANNER_UNSUPPORTED".to_string());
    }
    scanner_cmd::validate_device_id(&device_id)?;
    let opts = ScanOptions::parse(dpi, &mode, &source, max_pages)?;
    let root = scans_root(&app)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let jobs = jobs.inner().clone();
    jobs.0.lock().map_err(|e| format!("Scan jobs lock: {e}"))?.insert(job_id.clone(), cancel.clone());
    let outcome = tauri::async_runtime::spawn_blocking(move || acquire_blocking(&root, &device_id, &opts, &cancel))
        .await
        .map_err(|e| format!("Scan task panicked: {e}"));
    if let Ok(mut map) = jobs.0.lock() {
        map.remove(&job_id);
    }
    outcome?
}

#[tauri::command]
pub fn scanner_cancel(jobs: tauri::State<'_, ScanJobs>, job_id: String) -> bool {
    let Ok(map) = jobs.0.lock() else { return false };
    match map.get(&job_id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// The bytes of one acquired page (PNG).
#[tauri::command]
pub async fn scanner_read_page(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let root = scans_root(&app)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        if !inside(&root, p) || !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
            return Err("SCAN_BAD_PATH".to_string());
        }
        std::fs::read(p).map_err(|e| format!("SCAN_IO:{e}"))
    })
    .await
    .map_err(|e| format!("Scan read task panicked: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Remove an acquisition folder (after the PDF is built, or when discarded).
#[tauri::command]
pub async fn scanner_discard(app: tauri::AppHandle, dir: String) -> Result<bool, String> {
    let root = scans_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let d = Path::new(&dir);
        if !inside(&root, d) || !d.is_dir() {
            return Ok(false);
        }
        std::fs::remove_dir_all(d).map(|_| true).map_err(|e| format!("SCAN_IO:{e}"))
    })
    .await
    .map_err(|e| format!("Scan discard task panicked: {e}"))?
}
