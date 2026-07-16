// The MCP `tools/list` descriptor table in mcp_server.rs is one large
// `serde_json::json!` literal; its recursive macro expansion exceeds the
// default limit of 128 once the tool count grew past ~30.
#![recursion_limit = "256"]

mod accounts;
mod email;
pub mod mcp_app_bridge;
pub mod mcp_server;
pub mod pdfium_renderer;
pub mod render_to_png;
pub mod window_mgmt;
pub mod worker_pool;

pub struct StartupOpts {
    pub mcp_server: bool,
    pub mcp_port: u16,
}

impl Default for StartupOpts {
    fn default() -> Self {
        Self { mcp_server: false, mcp_port: 9223 }
    }
}

use std::fs;
use std::fs::File;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

// Store the file paths passed via command line
struct OpenedFiles(Mutex<Vec<String>>);

// Store locked file handles to prevent other apps from writing
struct LockedFiles(Mutex<HashMap<String, File>>);

// Cache PDF file bytes to avoid re-reading from disk on every render call
struct PdfBytesCache(Mutex<HashMap<String, Vec<u8>>>);

// Cache parsed DocumentHandle objects so the font registry inside each
// handle survives across page renders. The handle holds a Mutex<FontRegistry>
// internally — extracting glyph outlines for a font (the dominant cost on
// text-heavy pages) only runs the first time that font is encountered in
// the document. Without this cache every Tauri command would create a
// fresh DocumentHandle and re-extract every glyph from scratch.
struct DocHandleCache(Mutex<HashMap<String, Arc<open_pdf_render::DocumentHandle>>>);

/// Gebouwde TileScenes voor het zware-blad-tegelpad (route A): één scene is
/// de complete display-list + chunk-index (~140-300 MB op extreme CAD-bladen)
/// en vervangt de ~1,1 GB PDFium-parse-state per worker. Cap 2: actief blad +
/// vergelijk-/vorig blad. Key: pad|mtime|len|pagina|rotatie.
struct TileSceneCache(Mutex<Vec<(String, Arc<open_pdf_render::tile_render::TileScene>)>>);
const TILE_SCENE_CACHE_CAP: usize = 2;

/// Cache for already-rendered thumbnails. Keyed by (path, page, max_width, rotation).
/// Hits return instantly without touching the renderer or JPEG encoder, which
/// makes scrolling back to previously-rendered pages essentially free.
struct ThumbnailCache(Mutex<HashMap<(String, u32, u32, i32), String>>);

/// Cache for `analyze_page_type` results. Keyed by (path, page_index). The
/// underlying lopdf classifier is cheap on most pages but for construction
/// PDFs with multi-megabyte content streams the size-shortcut in
/// `analyze_page_type` keeps it fast even cold; this cache makes warm hits
/// effectively free (HashMap lookup) so per-page navigation has zero analyze
/// cost after the first visit (or after `analyze_page_type_batch` warms it).
struct PageTypeCache(Mutex<HashMap<(String, u32), String>>);

#[tauri::command]
fn get_opened_file(state: tauri::State<OpenedFiles>) -> Vec<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn get_session_file_path() -> String {
    if let Some(data_dir) = dirs::data_local_dir() {
        let app_dir = data_dir.join("OpenPDFStudio");
        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }
        app_dir.join("session.json").to_string_lossy().to_string()
    } else {
        "session.json".to_string()
    }
}

#[tauri::command]
fn save_session(data: String) -> Result<bool, String> {
    let path = get_session_file_path();
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn load_session() -> Option<String> {
    let path = get_session_file_path();
    fs::read_to_string(&path).ok()
}

fn get_preferences_file_path() -> String {
    if let Some(data_dir) = dirs::data_local_dir() {
        let app_dir = data_dir.join("OpenPDFStudio");
        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }
        app_dir.join("preferences.json").to_string_lossy().to_string()
    } else {
        "preferences.json".to_string()
    }
}

#[tauri::command]
fn save_preferences(data: String) -> Result<bool, String> {
    let path = get_preferences_file_path();
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn load_preferences() -> Option<String> {
    let path = get_preferences_file_path();
    fs::read_to_string(&path).ok()
}

#[tauri::command]
fn get_username() -> String {
    whoami::username()
}

// Fallback commands for when plugins aren't available via global API

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, data: String) -> Result<bool, String> {
    let bytes = BASE64.decode(&data).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

/// Check if this app is the default handler for .pdf files on Windows.
/// Returns true if our exe is the registered handler, false otherwise.
/// Uses spawn_blocking so the subprocess calls never block the main thread.
#[tauri::command]
async fn is_default_pdf_app() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            // Get our own executable path
            let our_exe = match std::env::current_exe() {
                Ok(p) => p.to_string_lossy().to_lowercase(),
                Err(_) => return false,
            };

            // Query the UserChoice ProgId for .pdf
            let output = match no_window_command("reg")
                .args(&["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice", "/v", "ProgId"])
                .output()
            {
                Ok(o) => o,
                Err(_) => return false,
            };
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Extract ProgId value from reg query output
            let prog_id = stdout.lines()
                .find(|line| line.contains("ProgId"))
                .and_then(|line| line.split_whitespace().last())
                .unwrap_or("");

            if prog_id.is_empty() {
                return false;
            }

            // Check if the ProgId directly matches our app name
            if prog_id.to_lowercase().contains("openpdfstudio") {
                return true;
            }

            // Look up the shell\open\command for this ProgId in HKCR
            let key_path = format!(r"HKCR\{}\shell\open\command", prog_id);
            let output2 = match no_window_command("reg")
                .args(&["query", &key_path, "/ve"])
                .output()
            {
                Ok(o) => o,
                Err(_) => return false,
            };
            let stdout2 = String::from_utf8_lossy(&output2.stdout).to_lowercase();

            stdout2.contains("openpdfstudio") || stdout2.contains(&our_exe.replace('\\', "\\\\"))
        }

        #[cfg(target_os = "linux")]
        {
            // Use xdg-mime: works on any XDG-compliant desktop (GNOME, KDE,
            // Cinnamon, MATE, XFCE) across distros (Mint, Ubuntu, Fedora, Arch).
            let output = match std::process::Command::new("xdg-mime")
                .args(&["query", "default", "application/pdf"])
                .output()
            {
                Ok(o) => o,
                Err(_) => return false,
            };
            let default_desktop = String::from_utf8_lossy(&output.stdout).trim().to_string();
            default_desktop == "Open PDF Studio.desktop" || default_desktop == "open-pdf-studio.desktop"
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }).await.unwrap_or(false)
}

/// Make this app the default handler for .pdf files.
/// On Windows, opens the system default-apps settings page. On Linux, sets the
/// xdg-mime default directly (no system UI for this exists on most desktops).
#[tauri::command]
fn open_default_apps_settings() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // Open the "Choose default apps by file type" settings page
        no_window_command("cmd")
            .args(&["/c", "start", "ms-settings:defaultapps"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-mime is the desktop-environment agnostic way to set the default
        // handler. The .desktop filename must match what tauri-bundler wrote in
        // /usr/share/applications (the bundle uses the app's productName).
        let status = std::process::Command::new("xdg-mime")
            .args(&["default", "Open PDF Studio.desktop", "application/pdf"])
            .status()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "xdg-mime not found. Install xdg-utils (e.g. `sudo apt install xdg-utils`) and try again.".to_string()
                } else {
                    format!("Failed to run xdg-mime: {}", e)
                }
            })?;
        if !status.success() {
            return Err(format!(
                "xdg-mime exited with status {}. The .desktop file may not be registered — install Open PDF Studio via the bundled .deb/.AppImage so /usr/share/applications/Open PDF Studio.desktop exists.",
                status
            ));
        }
        Ok(true)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(false)
    }
}

/// Lock a file to prevent other applications from writing to it.
/// Opens the file with shared read access only (no write sharing on Windows).
#[tauri::command]
fn lock_file(path: String, state: tauri::State<LockedFiles>) -> Result<bool, String> {
    let mut locks = state.0.lock().map_err(|e| e.to_string())?;

    // Already locked by us
    if locks.contains_key(&path) {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ = 0x00000001 — allow others to read, but not write or delete
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(0) // no special flags
            .share_mode(0x00000001) // FILE_SHARE_READ only
            .open(&path)
            .map_err(|e| format!("Failed to lock file: {}", e))?;
        locks.insert(path, file);
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Unix, use advisory file locking (flock)
        let file = fs::OpenOptions::new()
            .read(true)
            .open(&path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        // Advisory lock — other well-behaved apps will respect this
        // Note: this is best-effort on non-Windows platforms
        locks.insert(path, file);
    }

    Ok(true)
}

/// Unlock a previously locked file, allowing other apps to write to it.
#[tauri::command]
fn unlock_file(path: String, state: tauri::State<LockedFiles>) -> Result<bool, String> {
    let mut locks = state.0.lock().map_err(|e| e.to_string())?;
    // Removing the entry drops the File handle, releasing the lock
    locks.remove(&path);
    Ok(true)
}

/// Build a process Command that never flashes a console window on Windows
/// (CREATE_NO_WINDOW). Use this for EVERY helper-process spawn (reg, cmd,
/// powershell, …) so the GUI app stays window-free — a bare Command::new
/// pops a black console box for a split second.
#[cfg(target_os = "windows")]
fn no_window_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut c = std::process::Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// Enumerate installed printers via PowerShell CIM.
/// Returns a JSON array of printer objects.
/// async: sync commands run on the main event-loop thread, and this one
/// blocks on a PowerShell subprocess for ~1s — long enough to freeze window
/// show and input processing at startup. Async moves it to the runtime pool.
#[tauri::command]
async fn get_printers() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = no_window_command("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                "Get-CimInstance -ClassName Win32_Printer | Select-Object Name, DriverName, Default, PrinterStatus | ConvertTo-Json -Compress"
            ])
            .output()
            .map_err(|e| format!("Failed to enumerate printers: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PowerShell error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        // PowerShell returns a single object (not array) when there's only one printer
        let trimmed = stdout.trim();
        if trimmed.starts_with('{') {
            Ok(format!("[{}]", trimmed))
        } else {
            Ok(trimmed.to_string())
        }
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // Use CUPS `lpstat -p` to list printers. Output format:
        //   printer NAME is idle. enabled since ...
        //   printer NAME disabled since ...
        let output = std::process::Command::new("lpstat")
            .args(&["-p"])
            .output()
            .map_err(|e| format!("Failed to run lpstat (is CUPS installed?): {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // No printers configured isn't strictly an error; return empty list.
            if stderr.trim().is_empty() {
                return Ok("[]".to_string());
            }
            return Err(format!("lpstat error: {}", stderr));
        }

        // Get the system default printer name (if any) via `lpstat -d`.
        let default_name = std::process::Command::new("lpstat")
            .args(&["-d"])
            .output()
            .ok()
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                // "system default destination: NAME" or "no system default destination"
                s.lines()
                    .find_map(|line| {
                        line.split_once(':').and_then(|(_, v)| {
                            let v = v.trim();
                            if v.is_empty() || v.starts_with("no ") { None } else { Some(v.to_string()) }
                        })
                    })
            })
            .unwrap_or_default();

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let mut entries: Vec<String> = Vec::new();
        for line in stdout.lines() {
            let line = line.trim();
            if !line.starts_with("printer ") { continue; }
            let rest = &line["printer ".len()..];
            let name = rest.split_whitespace().next().unwrap_or("").to_string();
            if name.is_empty() { continue; }
            let status_num: i32 = if rest.contains("disabled") { 0 } else { 3 }; // 3 = idle on Win32
            let is_default = name == default_name;
            // Match the Windows JSON shape: { Name, DriverName, Default, PrinterStatus }
            let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
            entries.push(format!(
                "{{\"Name\":\"{}\",\"DriverName\":\"CUPS\",\"Default\":{},\"PrinterStatus\":{}}}",
                escaped,
                if is_default { "true" } else { "false" },
                status_num
            ));
        }
        Ok(format!("[{}]", entries.join(",")))
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Ok("[]".to_string())
    }
}

/// Print a PDF file to a specific printer.
///
/// Implementation: rasterise each page via the in-proc PDFium renderer and
/// blit it onto the printer device context with GDI (StretchDIBits). This is
/// ASSOCIATION-INDEPENDENT — the previous ShellExecuteW("printto") approach
/// broke with SE_ERR_NOASSOC (code 31) whenever this app itself is the
/// default .pdf handler, because our ProgID registers no printto verb.
/// async for the same reason as get_printers: GDI spooling is slow blocking
/// work and must not run on the main event-loop thread.
#[tauri::command]
async fn print_pdf(path: String, printer: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Graphics::Gdi::{
            CreateDCW, DeleteDC, StretchDIBits, GetDeviceCaps, SetStretchBltMode,
            ResetDCW, DEVMODEW, BITMAPINFO, BITMAPINFOHEADER,
            BI_RGB, DIB_RGB_COLORS, SRCCOPY, HORZRES, VERTRES, LOGPIXELSX, HALFTONE,
            DM_ORIENTATION, DMORIENT_PORTRAIT, DMORIENT_LANDSCAPE,
        };
        // The StartDoc/EndDoc print-job family lives under Storage::Xps in
        // windows-sys (print spooler document API), not under Graphics::Gdi.
        use windows_sys::Win32::Storage::Xps::{
            StartDocW, EndDoc, AbortDoc, StartPage, EndPage, DOCINFOW,
        };
        use std::os::windows::ffi::OsStrExt;
        use std::ffi::OsStr;
        use std::sync::Arc;

        fn to_wide(s: &str) -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        }

        let p = std::path::Path::new(&path);
        if !p.is_file() {
            return Err("File does not exist".to_string());
        }

        // Load the document via PDFium (no doc-cache: print is a cold path
        // and the temp file is deleted shortly after).
        let bytes = std::fs::read(&path).map_err(|e| format!("Read PDF: {e}"))?;
        let handle = pdfium_renderer::PdfiumDocumentHandle::load_from_bytes(Arc::new(bytes))?;
        let page_count = handle.document().pages().len() as u32;
        if page_count == 0 {
            return Err("PDF has no pages".to_string());
        }

        unsafe {
            let printer_w = to_wide(&printer);
            let hdc = CreateDCW(std::ptr::null(), printer_w.as_ptr(), std::ptr::null(), std::ptr::null());
            if hdc.is_null() {
                return Err(format!("Cannot open printer '{printer}'"));
            }

            let dpi = GetDeviceCaps(hdc, LOGPIXELSX as i32).max(96);

            // Reusable DEVMODE used to flip the printer DC orientation per page,
            // so a landscape drawing prints on landscape paper instead of being
            // rotated 90° by the driver to fit the default (portrait) orientation.
            let mut devmode: DEVMODEW = std::mem::zeroed();
            devmode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            devmode.dmFields = DM_ORIENTATION;
            {
                let n = printer_w.len().min(31);
                devmode.dmDeviceName[..n].copy_from_slice(&printer_w[..n]);
            }

            let doc_name = to_wide(
                p.file_name().and_then(|n| n.to_str()).unwrap_or("Document"),
            );
            let di = DOCINFOW {
                cbSize: std::mem::size_of::<DOCINFOW>() as i32,
                lpszDocName: doc_name.as_ptr(),
                lpszOutput: std::ptr::null(),
                lpszDatatype: std::ptr::null(),
                fwType: 0,
            };
            if StartDocW(hdc, &di) <= 0 {
                DeleteDC(hdc);
                return Err("StartDoc failed (print job rejected)".to_string());
            }

            // Render at device DPI, capped at 300 to bound memory on plotters.
            let scale = (dpi.min(300) as f32) / 72.0;

            for i in 0..page_count {
                let (w, h, mut rgba) =
                    match pdfium_renderer::render_page_to_rgba(handle.document(), i, scale, 0) {
                        Ok(r) => r,
                        Err(e) => {
                            AbortDoc(hdc);
                            DeleteDC(hdc);
                            return Err(format!("Render page {} failed: {e}", i + 1));
                        }
                    };
                // RGBA → BGRA (GDI DIB byte order)
                for px in rgba.chunks_exact_mut(4) {
                    px.swap(0, 2);
                }

                // Match paper orientation to THIS page (done between pages,
                // before StartPage) so the driver prints it upright: a landscape
                // drawing goes on landscape paper, no 90° auto-rotation.
                // dmOrientation is i16; the DMORIENT_* consts are u32 in windows-sys.
                devmode.Anonymous1.Anonymous1.dmOrientation =
                    (if w > h { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT }) as i16;
                ResetDCW(hdc, &devmode);
                let dev_w = GetDeviceCaps(hdc, HORZRES as i32);
                let dev_h = GetDeviceCaps(hdc, VERTRES as i32);

                // Fit page into the printable area, preserve aspect, centre.
                let sx = dev_w as f64 / w as f64;
                let sy = dev_h as f64 / h as f64;
                let s = sx.min(sy);
                let dw = ((w as f64) * s).round() as i32;
                let dh = ((h as f64) * s).round() as i32;
                let dx = (dev_w - dw) / 2;
                let dy = (dev_h - dh) / 2;

                let mut bmi: BITMAPINFO = std::mem::zeroed();
                bmi.bmiHeader = BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w as i32,
                    biHeight: -(h as i32), // top-down DIB
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB as u32,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                };

                StartPage(hdc);
                SetStretchBltMode(hdc, HALFTONE as i32);
                StretchDIBits(
                    hdc,
                    dx, dy, dw, dh,
                    0, 0, w as i32, h as i32,
                    rgba.as_ptr() as *const std::ffi::c_void,
                    &bmi,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
                EndPage(hdc);
            }

            EndDoc(hdc);
            DeleteDC(hdc);
        }

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Printing is only supported on Windows".to_string())
    }
}

/// Open the document properties (printing preferences) dialog for a given printer name.
#[tauri::command]
fn open_printer_properties(window: tauri::WebviewWindow, printer: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Graphics::Printing::{
            OpenPrinterW, ClosePrinter, DocumentPropertiesW,
        };

        // Get the HWND from the Tauri window so the dialog is modal
        let hwnd = window.hwnd().map_err(|e| format!("Failed to get window handle: {}", e))?;
        let hwnd_raw = hwnd.0 as windows_sys::Win32::Foundation::HWND;

        // Convert printer name to wide string
        let wide_name: Vec<u16> = printer.encode_utf16().chain(std::iter::once(0)).collect();

        let mut h_printer: windows_sys::Win32::Foundation::HANDLE = std::ptr::null_mut();
        let opened = unsafe {
            OpenPrinterW(wide_name.as_ptr(), &mut h_printer, std::ptr::null_mut())
        };

        if opened == 0 || h_printer.is_null() {
            return Err(format!("Failed to open printer '{}'", printer));
        }

        // DocumentPropertiesW is blocking — run on a thread to avoid freezing the event loop.
        // DM_IN_PROMPT (0x4) tells it to show the dialog to the user.
        let hwnd_usize = hwnd_raw as usize;
        let printer_usize = h_printer as usize;
        let device_name = wide_name;

        std::thread::spawn(move || {
            unsafe {
                const DM_IN_PROMPT: u32 = 0x4;
                DocumentPropertiesW(
                    hwnd_usize as _,
                    printer_usize as _,
                    device_name.as_ptr() as _,
                    std::ptr::null_mut(),   // pDevModeOutput — not capturing changes
                    std::ptr::null_mut(),   // pDevModeInput
                    DM_IN_PROMPT,
                );
                ClosePrinter(printer_usize as _);
            }
        });

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("Printer properties dialog is only supported on Windows".to_string())
    }
}

/// Get the system temp directory path.
#[tauri::command]
fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Write binary data to a temp file and return the path.
/// This bypasses the FS plugin scope restrictions.
#[tauri::command]
fn write_temp_pdf(data: Vec<u8>) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = temp_dir.join(format!("openstudio_print_{}.pdf", timestamp));
    fs::write(&path, &data).map_err(|e| format!("Failed to write temp file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Delete a file at the given path.
#[tauri::command]
fn delete_file(path: String) -> Result<bool, String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(true)
}

/// Rename (move) a file from old_path to new_path.
#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<bool, String> {
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename file: {}", e))?;
    Ok(true)
}

/// Run a PowerShell script with UAC elevation by writing it to a temp .ps1
/// file, executing it as admin, and capturing errors via a log file.
#[cfg(target_os = "windows")]
fn run_elevated_ps_script(script: &str) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let script_path = temp_dir.join(format!("ops_printer_{}.ps1", timestamp));
    let log_path = temp_dir.join(format!("ops_printer_{}.log", timestamp));

    // Wrap the script: redirect all errors to a log file, write "OK" on success
    let wrapped = format!(
        r#"try {{
{}
'OK' | Out-File -FilePath '{}' -Encoding UTF8
}} catch {{
$_.Exception.Message | Out-File -FilePath '{}' -Encoding UTF8
exit 1
}}"#,
        script,
        log_path.to_string_lossy(),
        log_path.to_string_lossy()
    );

    fs::write(&script_path, &wrapped)
        .map_err(|e| format!("Failed to write temp script: {}", e))?;

    // Launch elevated: Start-Process -Verb RunAs -Wait on the .ps1 file
    // Build the -ArgumentList as a single quoted string with each param separated by commas.
    // The script path is passed as a properly escaped argument, not interpolated into a command string.
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let script_path_str = script_path.to_string_lossy().to_string();
    let arg_list = format!(
        "'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','{}'",
        script_path_str.replace('\'', "''")
    );
    let output = std::process::Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(format!(
            "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList {}",
            arg_list
        ))
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to launch elevated process: {}", e))?;

    // Read the log file written by the elevated process
    let log_content = fs::read_to_string(&log_path).unwrap_or_default();
    let log_trimmed = log_content.trim();

    // Cleanup temp files
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&log_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("UAC elevation failed: {}", stderr));
    }

    if log_trimmed.is_empty() {
        return Err("Elevated script produced no output — user may have cancelled UAC".to_string());
    }

    // Check BOM-prefixed "OK" (UTF-8 BOM from Out-File)
    if log_trimmed == "OK" || log_trimmed.ends_with("OK") {
        Ok(())
    } else {
        Err(format!("Elevated script error: {}", log_trimmed))
    }
}

/// Install a virtual printer named "Open PDF Printer" using the built-in
/// "Microsoft Print to PDF" driver. Sets the default paper size to A4.
/// Requires one-time UAC admin elevation.
///
/// `use_collection` (DEFAULT true — the "catch and merge" behaviour):
///   - `true` (default) → routes the output to a fixed file port pointing at
///     `%LOCALAPPDATA%\OpenPDFPrinter\spool\latest.pdf`. NO Windows Save As
///     dialog appears. Our app watches that folder, rotates the captured
///     file into a timestamped job, and pops the print-queue dialog so the
///     user can merge/reorder multiple print jobs from ANY program before
///     saving. (Single-port approach: concurrent print jobs lock on the
///     rotate step inside the app — Windows already serialises print jobs to
///     a given port so the race window is tiny.)
///   - `false` → PORTPROMPT: port (legacy): each print job pops the standard
///     Windows Save As dialog. Only used if explicitly requested.
///
/// Backward compatibility: removes the legacy printer name "Open PDF
/// Studio" if present, so an existing installation cleanly migrates to
/// the new name on next install.
#[tauri::command]
fn install_virtual_printer(use_collection: Option<bool>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // Default to the silent collection port — the user wants prints
        // CAUGHT for merging, never a Save As dialog.
        let use_collection = use_collection.unwrap_or(true);
        let (port_setup_block, port_arg) = if use_collection {
            // Pre-create the spool dir + port pointing at it. Windows
            // file-ports require the port NAME to be the file path itself.
            let local = std::env::var("LOCALAPPDATA")
                .map_err(|_| "LOCALAPPDATA not set".to_string())?;
            let spool_dir = std::path::Path::new(&local).join("OpenPDFPrinter").join("spool");
            let spool_file = spool_dir.join("latest.pdf");
            std::fs::create_dir_all(&spool_dir)
                .map_err(|e| format!("Failed to create spool dir: {}", e))?;
            let spool_file_str = spool_file.to_string_lossy().to_string();
            (
                format!(
                    r#"$portPath = '{}'
# Remove any existing port at this path before re-adding (Add-PrinterPort errors if it exists)
try {{ Remove-PrinterPort -Name $portPath -ErrorAction SilentlyContinue }} catch {{}}
Add-PrinterPort -Name $portPath
"#,
                    spool_file_str.replace('\'', "''")
                ),
                format!("'{}'", spool_file_str.replace('\'', "''")),
            )
        } else {
            (String::new(), "'PORTPROMPT:'".to_string())
        };

        let script = format!(r#"$ErrorActionPreference = 'Stop'
$printerName = 'Open PDF Printer'
$legacyName = 'Open PDF Studio'

# Remove the LEGACY-named printer if present (migration from older versions)
try {{ Remove-Printer -Name $legacyName -ErrorAction SilentlyContinue }} catch {{}}
try {{ Remove-Printer -Name $printerName -ErrorAction SilentlyContinue }} catch {{}}

{}
Add-Printer -Name $printerName -DriverName 'Microsoft Print to PDF' -PortName {}

# Default paper size = A4 (don't let driver/locale defaults pick C-size).
try {{ Set-PrintConfiguration -PrinterName $printerName -PaperSize A4 -ErrorAction Stop }} catch {{
    Write-Host "Note: could not set default paper size to A4 (install still succeeded). $($_.Exception.Message)"
}}"#, port_setup_block, port_arg);

        run_elevated_ps_script(&script)?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Virtual printer is only supported on Windows".to_string())
    }
}

/// Remove the "Open PDF Printer" virtual printer (and the legacy
/// "Open PDF Studio" name if it exists). Requires UAC admin elevation.
#[tauri::command]
fn remove_virtual_printer() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference = 'Stop'
$printerName = 'Open PDF Printer'
$legacyName = 'Open PDF Studio'

# Remove BOTH the current and legacy names so the UI status reflects
# "not installed" regardless of which one the user has.
try { Remove-Printer -Name $printerName -ErrorAction SilentlyContinue } catch {}
try { Remove-Printer -Name $legacyName -ErrorAction SilentlyContinue } catch {}

# Clean up any leftover local port from older installations
Get-PrinterPort | Where-Object { $_.Name -like '*OpenPDFStudio*print-capture*' -or $_.Name -like '*OpenPDFPrinter*print-capture*' } | Remove-PrinterPort"#;

        run_elevated_ps_script(script)?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Virtual printer is only supported on Windows".to_string())
    }
}

// ── Virtual-printer job queue ───────────────────────────────────────────
// With the collection port installed, every print to "Open PDF Printer"
// lands as spool/latest.pdf. The queue sweeps that into unique job files
// (so the next print can't overwrite it) and lists them for the in-app
// merge/reorder dialog.

fn vp_spool_dir() -> Result<std::path::PathBuf, String> {
    let base = dirs::data_local_dir().ok_or("local data dir unknown")?;
    Ok(base.join("OpenPDFPrinter").join("spool"))
}

/// Sweep the spool: rename a finished `latest.pdf` into `job_<epoch>.pdf`.
/// Returns true when a new job was collected. The driver may still be
/// writing — only collect once the file has been stable for a moment.
#[tauri::command]
fn virtual_printer_collect() -> Result<bool, String> {
    let dir = vp_spool_dir()?;
    let latest = dir.join("latest.pdf");
    if !latest.exists() {
        return Ok(false);
    }
    let meta = std::fs::metadata(&latest).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        return Ok(false);
    }
    if let Ok(modified) = meta.modified() {
        if let Ok(age) = modified.elapsed() {
            if age.as_millis() < 1500 {
                return Ok(false);
            }
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let job = dir.join(format!("job_{stamp}.pdf"));
    match std::fs::rename(&latest, &job) {
        Ok(()) => Ok(true),
        // Still locked by the spooler — pick it up on the next sweep.
        Err(_) => Ok(false),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VpJob {
    file: String,
    path: String,
    size: u64,
    modified_ms: u64,
    pages: u32,
}

/// List collected jobs (oldest first — print order).
#[tauri::command]
fn virtual_printer_jobs() -> Result<Vec<VpJob>, String> {
    let dir = vp_spool_dir()?;
    let mut jobs = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !(name.starts_with("job_") && name.ends_with(".pdf")) {
                continue;
            }
            let meta = match e.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let pages = lopdf::Document::load(e.path())
                .map(|d| d.get_pages().len() as u32)
                .unwrap_or(0);
            jobs.push(VpJob {
                file: name,
                path: e.path().to_string_lossy().to_string(),
                size: meta.len(),
                modified_ms,
                pages,
            });
        }
    }
    jobs.sort_by_key(|j| j.modified_ms);
    Ok(jobs)
}

/// Delete one collected job. Basename only — no path traversal.
#[tauri::command]
fn virtual_printer_delete_job(file: String) -> Result<(), String> {
    if file.contains('/') || file.contains('\\') || !file.starts_with("job_") || !file.ends_with(".pdf") {
        return Err("invalid job file".into());
    }
    let p = vp_spool_dir()?.join(file);
    std::fs::remove_file(&p).map_err(|e| e.to_string())
}

/// Whether "Open PDF Printer" is in SILENT CATCH mode — i.e. its port is the
/// spool file (no Save As dialog). Returns false when it's on PORTPROMPT (the
/// legacy save-dialog port) so the UI can offer to reconfigure it.
#[tauri::command]
fn virtual_printer_catch_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        let expected = match vp_spool_dir() {
            Ok(p) => p.join("latest.pdf").to_string_lossy().to_lowercase(),
            Err(_) => return false,
        };
        let out = no_window_command("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                "(Get-Printer -Name 'Open PDF Printer' -ErrorAction SilentlyContinue).PortName"
            ])
            .output();
        match out {
            Ok(o) => {
                let port = String::from_utf8_lossy(&o.stdout).trim().to_lowercase();
                !port.is_empty() && port == expected
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Switch the EXISTING "Open PDF Printer" to the silent collection file port
/// — turns OFF the Windows Save As dialog. Verified to work WITHOUT UAC:
/// changing a printer's port is permitted for the current user (unlike
/// ADDING a printer). This is the fix for a printer installed on PORTPROMPT.
#[tauri::command]
fn virtual_printer_enable_catch() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let spool = vp_spool_dir()?;
        std::fs::create_dir_all(&spool).map_err(|e| format!("spool dir: {e}"))?;
        let port = spool.join("latest.pdf").to_string_lossy().to_string();
        // Idempotent: only add the port if missing (Add-PrinterPort errors if
        // it exists), then point the printer at it.
        let script = format!(
            r#"$ErrorActionPreference='Stop'
$port = '{}'
if (-not (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue)) {{ Add-PrinterPort -Name $port }}
Set-Printer -Name 'Open PDF Printer' -PortName $port"#,
            port.replace('\'', "''")
        );
        let out = no_window_command("powershell")
            .args(&["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|e| format!("powershell: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("alleen op Windows".into())
    }
}

/// Check whether the "Open PDF Printer" virtual printer is installed.
/// Also returns `true` for the legacy "Open PDF Studio" name so users on
/// an older installation see "installed" until they reinstall.
#[tauri::command]
fn is_virtual_printer_installed() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                "(Get-Printer -Name 'Open PDF Printer' -ErrorAction SilentlyContinue) -or (Get-Printer -Name 'Open PDF Studio' -ErrorAction SilentlyContinue)"
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.trim().eq_ignore_ascii_case("True")
            }
            Err(_) => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Spool directory for the PDF Printer collection feature. Print jobs to
/// "Open PDF Printer" can be routed here (instead of the PORTPROMPT save
/// dialog) so our app captures the output and shows a multi-PDF collection
/// dialog instead. Lives under %LOCALAPPDATA% so it's per-user and
/// auto-cleaned on uninstall (Windows clears LocalAppData entries that
/// reference removed apps via the standard cleanup flow).
#[tauri::command]
fn get_printer_spool_dir() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA")
            .map_err(|_| "LOCALAPPDATA not set".to_string())?;
        let dir = std::path::Path::new(&local).join("OpenPDFPrinter").join("spool");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create spool dir: {}", e))?;
        Ok(dir.to_string_lossy().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("PDF Printer is Windows-only".to_string())
    }
}

/// List PDFs currently waiting in the printer spool directory. The collection
/// dialog calls this on open and after each `printer:job-arrived` event so
/// the user sees a live list of "PDFs the printer has captured but not yet
/// merged or saved". Returns absolute paths sorted by creation time.
#[tauri::command]
fn list_printer_spool() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let dir = get_printer_spool_dir()?;
        let dir_path = std::path::Path::new(&dir);
        let mut entries: Vec<(std::time::SystemTime, String)> = Vec::new();
        for e in std::fs::read_dir(dir_path)
            .map_err(|e| format!("Failed to read spool: {}", e))? {
            if let Ok(entry) = e {
                let path = entry.path();
                if path.extension().and_then(|x| x.to_str()) == Some("pdf") {
                    let created = entry.metadata().ok()
                        .and_then(|m| m.created().ok())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    entries.push((created, path.to_string_lossy().to_string()));
                }
            }
        }
        entries.sort_by_key(|(t, _)| *t);
        Ok(entries.into_iter().map(|(_, p)| p).collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

/// Remove a captured print-job PDF from the spool after the collection
/// dialog has merged it into the saved output (or after the user clicks
/// Discard). The collection dialog calls this for each spool entry it
/// consumed so the next print job starts fresh.
#[tauri::command]
fn discard_spool_pdf(path: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);
    // Safety: only allow deletion under the spool directory to prevent the
    // dialog from accidentally being tricked into rm-rf'ing arbitrary files.
    let spool = get_printer_spool_dir()?;
    if !p.starts_with(&spool) {
        return Err("Path is not in the printer spool directory".to_string());
    }
    std::fs::remove_file(p)
        .map_err(|e| format!("Failed to remove spool file: {}", e))?;
    Ok(true)
}

/// Open a file in the system's default PDF viewer. Used by the auto-open
/// hook after a successful Save As so the user immediately sees their
/// freshly-saved file in their preferred reader.
///
/// Windows: `cmd /C start "" "<path>"` — the empty title argument prevents
/// `start` from interpreting the path as a window title (a long-standing
/// quoting quirk). The shell `start` verb honours the user's default app
/// association for .pdf, so whichever reader the user prefers opens it.
///
/// macOS: `open "<path>"` honours `LSHandlerContentType` for .pdf.
/// Linux: `xdg-open "<path>"` honours the `application/pdf` MIME default.
#[tauri::command]
fn open_pdf_in_default_viewer(path: String) -> Result<bool, String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("File not found: {}", path));
    }
    // Niet-desktop-platforms (mobile): geen externe-viewer-concept — nette
    // fout i.p.v. een cfg-if zonder else (compileerfout E0317 op Android).
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = &path;
        return Err("Openen in externe viewer wordt op dit platform niet ondersteund".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        // `cmd /C start "" "<path>"` is the Windows idiom for "open this
        // file with whatever the user has set as the default handler".
        // The double-quoted empty title is required: without it, `start`
        // treats the quoted path as the window title and then has no file
        // argument to open.
        std::process::Command::new("cmd")
            .args(&["/C", "start", "", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to launch default PDF viewer: {}", e))?;
        Ok(true)
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to launch default PDF viewer: {}", e))?;
        Ok(true)
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to launch default PDF viewer: {}", e))?;
        Ok(true)
    }
}

/// Reveal a file in the OS file manager (Explorer / Finder / Linux file
/// manager), with the file selected where the platform supports it.
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<bool, String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("File not found: {}", path));
    }
    // Non-desktop platforms (mobile): no file-manager concept — return a
    // clean error instead of a cfg-if without else (compile error E0317).
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = &path;
        return Err("Tonen in bestandsbeheer wordt op dit platform niet ondersteund".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // `explorer /select,"<path>"` opens Explorer with the file selected.
        // The switch and the path must travel as ONE argument; raw_arg keeps
        // the quoting intact for paths with spaces (normal .arg() quoting
        // would wrap the whole `/select,...` blob and confuse explorer).
        no_window_command("explorer")
            .raw_arg(format!("/select,\"{}\"", path))
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
        Ok(true)
    }
    #[cfg(target_os = "macos")]
    {
        // `open -R` reveals (selects) the file in a Finder window.
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
        Ok(true)
    }
    #[cfg(target_os = "linux")]
    {
        // No universal "select file" verb across file managers; open the
        // containing directory via xdg-open (works on every desktop).
        let parent = std::path::Path::new(&path)
            .parent()
            .ok_or_else(|| "Bestand heeft geen bovenliggende map".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
        Ok(true)
    }
}

/// Download a PDF from a URL and save it to a temp file.
/// Returns the temp file path on success.
#[tauri::command]
async fn download_pdf_from_url(url: String) -> Result<String, String> {
    let response = reqwest::get(&url).await.map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Failed to read response: {}", e))?;

    if bytes.is_empty() {
        return Err("Downloaded file is empty".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // Try to extract filename from URL
    let filename = url.split('/').last()
        .and_then(|s| s.split('?').next())
        .filter(|s| s.to_lowercase().ends_with(".pdf"))
        .unwrap_or("download.pdf");

    let path = temp_dir.join(format!("openstudio_url_{}_{}", timestamp, filename));
    fs::write(&path, &bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// List PDF files in a directory.
/// Returns a list of full file paths for .pdf files found.
#[tauri::command]
fn list_pdf_files(dir: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut pdf_files: Vec<String> = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.to_string_lossy().to_lowercase() == "pdf" {
                        pdf_files.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    pdf_files.sort();
    Ok(pdf_files)
}

#[tauri::command]
fn play_alert_sound() {
    #[cfg(target_os = "windows")]
    {
        use std::os::raw::c_uint;
        #[link(name = "user32")]
        extern "system" {
            fn MessageBeep(uType: c_uint) -> i32;
        }
        unsafe { MessageBeep(0x00000030); } // MB_ICONEXCLAMATION
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("afplay")
            .arg("/System/Library/Sounds/Funk.aiff")
            .spawn()
            .ok();
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("paplay")
            .arg("/usr/share/sounds/freedesktop/stereo/dialog-warning.oga")
            .spawn()
            .ok();
    }
}

// --- Plugin Management ---

fn get_plugins_dir() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let plugins_dir = data_dir.join("OpenPDFStudio").join("plugins");
    if !plugins_dir.exists() {
        let _ = fs::create_dir_all(&plugins_dir);
    }
    plugins_dir
}

#[tauri::command]
fn list_plugins() -> Result<Vec<serde_json::Value>, String> {
    let plugins_dir = get_plugins_dir();
    let mut plugins = Vec::new();

    if let Ok(entries) = fs::read_dir(&plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("plugin.json");
                if manifest_path.exists() {
                    if let Ok(content) = fs::read_to_string(&manifest_path) {
                        if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                            plugins.push(manifest);
                        }
                    }
                }
            }
        }
    }

    Ok(plugins)
}

#[tauri::command]
fn install_plugin(path: String) -> Result<serde_json::Value, String> {
    let src_path = std::path::Path::new(&path);
    if !src_path.exists() {
        return Err("File not found".to_string());
    }

    let file = fs::File::open(&src_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid plugin archive: {}", e))?;

    // Read plugin.json from the archive to get the plugin id
    let manifest_content = {
        let mut manifest_file = archive.by_name("plugin.json")
            .map_err(|_| "Plugin archive must contain plugin.json".to_string())?;
        let mut content = String::new();
        std::io::Read::read_to_string(&mut manifest_file, &mut content)
            .map_err(|e| format!("Failed to read plugin.json: {}", e))?;
        content
    };

    let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Invalid plugin.json: {}", e))?;

    let plugin_id = manifest.get("id")
        .and_then(|v| v.as_str())
        .ok_or("plugin.json must have an 'id' field")?;

    // Validate plugin id (prevent path traversal)
    if plugin_id.contains("..") || plugin_id.contains('/') || plugin_id.contains('\\') {
        return Err("Invalid plugin id".to_string());
    }

    let plugins_dir = get_plugins_dir();
    let plugin_dir = plugins_dir.join(plugin_id);

    // Remove existing installation
    if plugin_dir.exists() {
        let _ = fs::remove_dir_all(&plugin_dir);
    }
    fs::create_dir_all(&plugin_dir).map_err(|e| format!("Failed to create plugin dir: {}", e))?;

    // Re-open archive (consumed by by_name above)
    let file2 = fs::File::open(&src_path).map_err(|e| format!("Failed to reopen file: {}", e))?;
    let mut archive2 = zip::ZipArchive::new(file2).map_err(|e| format!("Invalid archive: {}", e))?;

    // Extract all files
    for i in 0..archive2.len() {
        let mut file = archive2.by_index(i).map_err(|e| format!("Archive error: {}", e))?;
        let outpath = plugin_dir.join(file.mangled_name());

        // Prevent path traversal
        if !outpath.starts_with(&plugin_dir) {
            continue;
        }

        if file.is_dir() {
            let _ = fs::create_dir_all(&outpath);
        } else {
            if let Some(parent) = outpath.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    Ok(manifest)
}

#[tauri::command]
fn uninstall_plugin(id: String) -> Result<bool, String> {
    // Validate id
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid plugin id".to_string());
    }

    let plugins_dir = get_plugins_dir();
    let plugin_dir = plugins_dir.join(&id);

    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir).map_err(|e| format!("Failed to remove plugin: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
fn read_plugin_file(plugin_id: String, file_path: String) -> Result<String, String> {
    // Validate inputs
    if plugin_id.contains("..") || plugin_id.contains('/') || plugin_id.contains('\\') {
        return Err("Invalid plugin id".to_string());
    }
    if file_path.contains("..") {
        return Err("Invalid file path".to_string());
    }

    let plugins_dir = get_plugins_dir();
    let full_path = plugins_dir.join(&plugin_id).join(&file_path);

    // Ensure the resolved path is within the plugin directory
    if !full_path.starts_with(plugins_dir.join(&plugin_id)) {
        return Err("Path traversal detected".to_string());
    }

    fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))
}

// ─── Allow FS access to a path (for testing / programmatic file opens) ────
#[tauri::command]
fn allow_fs_scope(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    app.fs_scope().allow_file(&path)
        .map_err(|e| format!("{}", e))?;
    // Also allow the directory for related files
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = app.fs_scope().allow_directory(parent, false);
    }
    Ok(true)
}

// ─── PDF rendering via open-pdf-render (pure Rust) ────────────────────────
use open_pdf_render::{DocumentHandle, PdfRenderer};

/// Get a cached `Arc<DocumentHandle>` for the given file, or load + cache one.
///
/// First checks the DocHandleCache. On miss, falls back to the bytes cache
/// (or disk), parses the PDF once, and stores the resulting Arc in the
/// handle cache for all future commands. The handle owns its own internal
/// font registry so subsequent extract_draw_commands calls reuse all glyph
/// outlines from previous pages.
fn get_or_load_doc(
    path: &str,
    bytes_cache: &PdfBytesCache,
    handle_cache: &DocHandleCache,
) -> Result<Arc<DocumentHandle>, String> {
    // Fast path — handle already cached
    {
        let cache_map = handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?;
        if let Some(handle) = cache_map.get(path) {
            return Ok(handle.clone());
        }
    }

    // Slow path — fetch bytes (from cache or disk), parse, insert
    let bytes = {
        let mut bm = bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?;
        if let Some(cached) = bm.get(path) {
            cached.clone()
        } else {
            let read = fs::read(path).map_err(|e| format!("Read: {}", e))?;
            bm.insert(path.to_string(), read.clone());
            read
        }
    };

    let renderer = PdfRenderer::new();
    let handle = renderer.load_document(&bytes).map_err(|e| format!("{}", e))?;
    let arc = Arc::new(handle);

    {
        let mut hm = handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?;
        // Double-check in case another thread inserted while we were parsing.
        if let Some(existing) = hm.get(path) {
            return Ok(existing.clone());
        }
        hm.insert(path.to_string(), arc.clone());
    }
    Ok(arc)
}

/// DEBUG / BENCHMARK TOOL. Render a page using our own open-pdf-render Skia
/// kernel instead of PDFium. NOT wired into the live render path — production
/// rendering always goes through `render_pdf_page` (PDFium). Kept callable so
/// `mcp-server/skia-vs-pdfium-render.mjs` can re-run the head-to-head speed
/// comparison whenever open-pdf-render's accuracy improves.
///
/// Wire format matches `render_pdf_page` exactly: `[w:u32 LE][h:u32 LE]
/// [rgba…]`. Probes can swap one invoke for the other without unpacking
/// differently.
///
/// IMPORTANT: open-pdf-render is currently below the < 2 % pixel-diff goal
/// vs the PyMuPDF reference (per scripts/render-regression-test.py). Some
/// pages render incorrectly. Speed numbers from this command must always be
/// read with that disclaimer until the regression suite reports green.
#[tauri::command]
fn render_pdf_page_skia(
    path: String,
    page_index: u32,
    scale: f32,
    rotation: Option<i32>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<tauri::ipc::Response, String> {
    let extra_rot = rotation.unwrap_or(0);
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let rendered = doc.render_page(page_index as usize, scale, extra_rot)
        .map_err(|e| format!("{}", e))?;
    let mut out = Vec::with_capacity(8 + rendered.rgba.len());
    out.extend_from_slice(&rendered.width.to_le_bytes());
    out.extend_from_slice(&rendered.height.to_le_bytes());
    out.extend_from_slice(&rendered.rgba);
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
async fn render_pdf_page(
    path: String,
    page_index: u32,
    scale: f32,
    rotation: Option<i32>,
    bytes_cache: tauri::State<'_, PdfBytesCache>,
    pdfium_cache: tauri::State<'_, pdfium_renderer::PdfiumDocCache>,
    pixmap_cache: tauri::State<'_, pdfium_renderer::PixmapCacheState>,
    pool: tauri::State<'_, std::sync::Arc<tokio::sync::OnceCell<worker_pool::WorkerPool>>>,
) -> Result<tauri::ipc::Response, String> {
    let extra_rot = rotation.unwrap_or(0);
    let scale_q = (scale * 10_000.0).round() as u32;
    let cache_key = (path.clone(), page_index, scale_q, extra_rot);

    // Cache fast path (unchanged)
    pixmap_cache.ensure();
    if let Ok(guard) = pixmap_cache.0.lock() {
        if let Some(cache) = guard.as_ref() {
            if let Some(cached) = cache.get(&cache_key) {
                let mut data = Vec::with_capacity(8 + cached.rgba.len());
                data.extend_from_slice(&cached.width.to_le_bytes());
                data.extend_from_slice(&cached.height.to_le_bytes());
                data.extend_from_slice(&cached.rgba);
                return Ok(tauri::ipc::Response::new(data));
            }
        }
    }

    // Try the worker pool first
    if let Some(p) = pool.get() {
        match p.render(&path, page_index, scale, extra_rot).await {
            Ok((width, height, rgba)) => {
                let rgba_arc = std::sync::Arc::new(rgba);
                if let Ok(mut guard) = pixmap_cache.0.lock() {
                    if let Some(cache) = guard.as_mut() {
                        cache.insert(cache_key, std::sync::Arc::new(pdfium_renderer::CachedPixmap {
                            width, height, rgba: rgba_arc.clone(),
                        }));
                    }
                }
                let mut data = Vec::with_capacity(8 + rgba_arc.len());
                data.extend_from_slice(&width.to_le_bytes());
                data.extend_from_slice(&height.to_le_bytes());
                data.extend_from_slice(&rgba_arc);
                return Ok(tauri::ipc::Response::new(data));
            }
            Err(e) => {
                eprintln!("[render_pdf_page] pool render failed: {} — falling back to in-proc", e);
            }
        }
    }

    // Fallback: in-proc PDFium (existing path, unchanged)
    let bytes = {
        let mut bm = bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?;
        if let Some(cached) = bm.get(&path) {
            cached.clone()
        } else {
            let read = std::fs::read(&path).map_err(|e| format!("Read: {}", e))?;
            bm.insert(path.clone(), read.clone());
            read
        }
    };

    let handle = pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        &path,
        std::sync::Arc::new(bytes),
        &pdfium_cache,
    )?;

    let (width, height, rgba) = pdfium_renderer::render_page_to_rgba(
        handle.document(),
        page_index,
        scale,
        extra_rot,
    )?;

    let rgba_arc = std::sync::Arc::new(rgba);
    if let Ok(mut guard) = pixmap_cache.0.lock() {
        if let Some(cache) = guard.as_mut() {
            cache.insert(cache_key, std::sync::Arc::new(pdfium_renderer::CachedPixmap {
                width, height, rgba: rgba_arc.clone(),
            }));
        }
    }

    let mut data = Vec::with_capacity(8 + rgba_arc.len());
    data.extend_from_slice(&width.to_le_bytes());
    data.extend_from_slice(&height.to_le_bytes());
    data.extend_from_slice(&rgba_arc);
    Ok(tauri::ipc::Response::new(data))
}

#[tauri::command]
async fn render_pdf_page_region(
    path: String,
    page_index: u32,
    scale: f32,
    rotation: Option<i32>,
    region_x_pt: f32,
    region_y_pt: f32,
    region_w_pt: f32,
    region_h_pt: f32,
    spread: Option<bool>,
    bytes_cache: tauri::State<'_, PdfBytesCache>,
    pdfium_cache: tauri::State<'_, pdfium_renderer::PdfiumDocCache>,
    pool: tauri::State<'_, std::sync::Arc<tokio::sync::OnceCell<worker_pool::WorkerPool>>>,
) -> Result<tauri::ipc::Response, String> {
    let extra_rot = rotation.unwrap_or(0);

    // Try the worker pool first: region tiles are small (fit the 64 MB SHM), so
    // they render in a SEPARATE process — safe for parallel/pre-cache rendering
    // and off the main thread. Falls back to in-proc PDFium on any failure.
    if let Some(p) = pool.get() {
        match p
            .render_region(&path, page_index, scale, extra_rot, region_x_pt, region_y_pt, region_w_pt, region_h_pt, spread.unwrap_or(false))
            .await
        {
            Ok((width, height, rgba)) => {
                let mut data = Vec::with_capacity(8 + rgba.len());
                data.extend_from_slice(&width.to_le_bytes());
                data.extend_from_slice(&height.to_le_bytes());
                data.extend_from_slice(&rgba);
                return Ok(tauri::ipc::Response::new(data));
            }
            Err(e) => {
                eprintln!("[render_pdf_page_region] pool failed: {} — in-proc fallback", e);
            }
        }
    }

    // In-proc-fallback: gelijktijdige in-proc PDFium-renders crashen het proces
    // (double-free / heap-corruptie — de worker-pool bestaat juist daarom). Alle
    // in-proc PDFium-toegang (laden én renderen, alle drie de render-paden) wordt
    // nu centraal geserialiseerd via PDFIUM_INPROC_LOCK in pdfium_renderer, dus
    // dit pad heeft geen eigen lock meer nodig.
    let bytes = {
        let mut bm = bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?;
        if let Some(cached) = bm.get(&path) {
            cached.clone()
        } else {
            let read = std::fs::read(&path).map_err(|e| format!("Read: {}", e))?;
            bm.insert(path.clone(), read.clone());
            read
        }
    };

    let handle = pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        &path,
        std::sync::Arc::new(bytes),
        &pdfium_cache,
    )?;

    let (width, height, rgba) = pdfium_renderer::render_page_region_to_rgba(
        handle.document(),
        page_index,
        scale,
        extra_rot,
        region_x_pt,
        region_y_pt,
        region_w_pt,
        region_h_pt,
    )?;

    let mut data = Vec::with_capacity(8 + rgba.len());
    data.extend_from_slice(&width.to_le_bytes());
    data.extend_from_slice(&height.to_le_bytes());
    data.extend_from_slice(&rgba);
    Ok(tauri::ipc::Response::new(data))
}

/// Route A: render een tegel-regio via de eigen display-list-engine i.p.v. de
/// PDFium-workers. De eerste aanroep per (pad, pagina, rotatie) bouwt de scene
/// (extract + chunk-index — seconden op een 5M-ops blad, daarna gecachet);
/// elke volgende tegel is puur parallel rasterwerk. Wire-format identiek aan
/// render_pdf_page_region: [w u32 LE][h u32 LE][rgba]. Faalt expliciet (geen
/// stille degradatie) zodat de JS-kant per pagina kan terugvallen op PDFium.
#[tauri::command]
async fn render_tile_scene_region(
    path: String,
    page_index: u32,
    rotation: Option<i32>,
    scale: f32,
    region_x_pt: f32,
    region_y_pt: f32,
    region_w_pt: f32,
    region_h_pt: f32,
    bytes_cache: tauri::State<'_, PdfBytesCache>,
    handle_cache: tauri::State<'_, DocHandleCache>,
    scene_cache: tauri::State<'_, TileSceneCache>,
) -> Result<tauri::ipc::Response, String> {
    let extra_rot = rotation.unwrap_or(0);
    let meta = std::fs::metadata(&path).map_err(|e| format!("stat: {}", e))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let key = format!("{}|{}|{}|p{}|r{}", path, mtime, meta.len(), page_index, extra_rot);

    let lookup = |sc: &TileSceneCache| -> Result<Option<Arc<open_pdf_render::tile_render::TileScene>>, String> {
        let cache = sc.0.lock().map_err(|e| format!("scene-cache lock: {}", e))?;
        Ok(cache.iter().find(|(k, _)| *k == key).map(|(_, s)| s.clone()))
    };

    let scene = match lookup(&scene_cache)? {
        Some(s) => s,
        None => {
            // Build serialiseren: gelijktijdige tegel-requests voor een verse
            // pagina zouden anders elk de dure extract+index doen.
            static BUILD_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
            let _b = BUILD_LOCK.lock().await;
            if let Some(s) = lookup(&scene_cache)? {
                s
            } else {
                let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
                let built = tauri::async_runtime::spawn_blocking(move || -> Result<open_pdf_render::tile_render::TileScene, String> {
                    let buf = doc
                        .extract_draw_commands(page_index as usize, extra_rot)
                        .map_err(|e| format!("extract: {}", e))?;
                    let bytes = buf.into_bytes();
                    // Image-zware bladen horen op het PDFium-pad: een scene vol
                    // ge-embedde beelddata is traag én zwaar — expliciet weigeren.
                    if bytes.len() > 400 * 1024 * 1024 {
                        return Err(format!("scene te groot ({} MB)", bytes.len() / 1_048_576));
                    }
                    let buffer_mb = ((bytes.len() / 1_048_576) as u64).max(1);
                    let scene = open_pdf_render::tile_render::TileScene::build(bytes)
                        .map_err(|e| format!("scene-build: {}", e))?;
                    // Datagedreven engine-gate (corpus-benchmark 2026-07-05,
                    // 136 pagina's; herijkt 2026-07-06 na image- en clip-
                    // ondersteuning in de tegel-rasterizer): de scene is
                    // alleen sneller ÉN accuraat op lijnwerk-bladen.
                    //
                    // Image-drempel 1 MB -> 2 MB (overleg-notitie): de
                    // rasterizer tekent DrawImage-payloads nu daadwerkelijk
                    // (RGBA-raw + JPEG), en de inline-strip-emissie geeft het
                    // maatgevende strip-blad (MV-03: 4.925 strips, 1,44 MB
                    // payload, downsampled diff 7,3% -> 7,1%) net méér dan
                    // 1 MB aan correct renderende beelddata. In het corpus
                    // haalt verder geen enkel blad het JS-voorfilter
                    // (content >= 6 MB), dus deze verruiming raakt alleen de
                    // strip-klasse; de BARN-klasse (tientallen MB's JPEG,
                    // PDFium wint daar in tijd en beeld) blijft er ruim boven
                    // en wordt nog steeds geweigerd.
                    //
                    // Clip-dichtheid blijft 25/MB: clips worden nu wél
                    // gerepliceerd (tegel-maskers), maar boven deze dichtheid
                    // is het maskerpad nog niet op snelheid gemeten —
                    // versoepelen pas na een corpus-meting die dat draagt.
                    let mb = buffer_mb;
                    if scene.image_bytes > 2_000_000 {
                        return Err(format!("scene geweigerd: {} MB embedded images", scene.image_bytes / 1_048_576));
                    }
                    if scene.clip_ops / mb > 25 {
                        return Err(format!("scene geweigerd: {} clips/MB", scene.clip_ops / mb));
                    }
                    Ok(scene)
                })
                .await
                .map_err(|e| format!("join: {}", e))??;
                let arc = Arc::new(built);
                let mut cache = scene_cache.0.lock().map_err(|e| format!("scene-cache lock: {}", e))?;
                if cache.len() >= TILE_SCENE_CACHE_CAP {
                    cache.remove(0);
                }
                cache.push((key.clone(), arc.clone()));
                eprintln!("[tile-scene] gebouwd: {} chunks, cache {}/{}", arc.chunk_count(), cache.len(), TILE_SCENE_CACHE_CAP);
                arc
            }
        }
    };

    let (w, h, rgba) = tauri::async_runtime::spawn_blocking(move || {
        scene.render_region_rgba(scale, region_x_pt, region_y_pt, region_w_pt, region_h_pt)
    })
    .await
    .map_err(|e| format!("join: {}", e))?;

    let mut data = Vec::with_capacity(8 + rgba.len());
    data.extend_from_slice(&w.to_le_bytes());
    data.extend_from_slice(&h.to_le_bytes());
    data.extend_from_slice(&rgba);
    Ok(tauri::ipc::Response::new(data))
}

/// Goedkope zwaarte-probe: som van de GECOMPRIMEERDE content-stream-lengtes van
/// een pagina (raw stream-bytes, geen decompressie). Groot => zware vector-pagina.
/// Gebruikt door het progressieve render-pad om alleen echt-zware pagina's tegel-
/// voor-tegel te renderen.
#[tauri::command]
fn page_content_size(path: String, page_index: u32) -> Result<u64, String> {
    use lopdf::{Document, Object};
    let doc = Document::load(&path).map_err(|e| format!("load: {}", e))?;
    let pages = doc.get_pages(); // BTreeMap<u32, ObjectId>, gesorteerd op paginanummer
    let page_id = pages
        .values()
        .nth(page_index as usize)
        .copied()
        .ok_or_else(|| format!("page {} out of range", page_index))?;
    let page = doc
        .get_dictionary(page_id)
        .map_err(|e| format!("page dict: {}", e))?;
    let contents = match page.get(b"Contents") {
        Ok(c) => c,
        Err(_) => return Ok(0), // geen content-stream (bv. lege pagina) => niet zwaar
    };
    // Verzamel de stream-object-ids (Contents = Reference of Array van References).
    let mut ids: Vec<lopdf::ObjectId> = Vec::new();
    match contents {
        Object::Reference(id) => ids.push(*id),
        Object::Array(arr) => {
            for o in arr {
                if let Object::Reference(id) = o {
                    ids.push(*id);
                }
            }
        }
        _ => {}
    }
    let mut total: u64 = 0;
    for id in ids {
        if let Ok(Object::Stream(s)) = doc.get_object(id) {
            total += s.content.len() as u64;
        }
    }
    Ok(total)
}

#[tauri::command]
fn render_thumbnail(
    path: String,
    page_index: u32,
    max_width: u32,
    rotation: Option<i32>,
    skip_images: Option<bool>,
    bytes_cache: tauri::State<PdfBytesCache>,
    pdfium_cache: tauri::State<pdfium_renderer::PdfiumDocCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
) -> Result<String, String> {
    let extra_rot = rotation.unwrap_or(0);
    // skip_images: PDFium renders form-data on by default but doesn't
    // expose a "drop image XObjects" knob — accept the option for API
    // compat but ignore it. PDFium is fast enough that the thumbnail
    // doesn't need to drop images.
    let _ = skip_images;

    let cache_key = (path.clone(), page_index, max_width, extra_rot);
    if let Ok(tc) = thumb_cache.0.lock() {
        if let Some(cached) = tc.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let bytes = {
        let mut bm = bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?;
        if let Some(cached) = bm.get(&path) {
            cached.clone()
        } else {
            let read = std::fs::read(&path).map_err(|e| format!("Read: {}", e))?;
            bm.insert(path.clone(), read.clone());
            read
        }
    };

    let handle = pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        &path,
        std::sync::Arc::new(bytes),
        &pdfium_cache,
    )?;

    let data_url = pdfium_renderer::render_thumbnail_to_json(
        handle.document(),
        page_index,
        max_width,
        extra_rot,
    )?;

    if let Ok(mut tc) = thumb_cache.0.lock() {
        tc.insert(cache_key, data_url.clone());
    }
    Ok(data_url)
}

#[tauri::command]
fn analyze_page_type(
    path: String,
    page_index: u32,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    page_type_cache: tauri::State<PageTypeCache>,
) -> Result<String, String> {
    let key = (path.clone(), page_index);
    if let Ok(cache) = page_type_cache.0.lock() {
        if let Some(cached) = cache.get(&key) {
            return Ok(cached.clone());
        }
    }
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let result = match doc.analyze_page_type(page_index as usize).map_err(|e| format!("{}", e))? {
        open_pdf_render::PageType::Vector => "vector".to_string(),
        open_pdf_render::PageType::Tile => "tile".to_string(),
    };
    if let Ok(mut cache) = page_type_cache.0.lock() {
        cache.insert(key, result.clone());
    }
    Ok(result)
}

/// Batch-classify many pages in one Tauri invoke using rayon for parallelism.
/// Used immediately after cold-open to populate `PageTypeCache` for every
/// page in the document so subsequent per-page navigation hits the cache
/// instead of paying any lopdf analyze cost. Safe to call multiple times
/// — already-cached pages are skipped in the parallel loop and the result
/// returns the cached value.
#[tauri::command]
fn analyze_page_type_batch(
    path: String,
    page_indices: Vec<u32>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    page_type_cache: tauri::State<PageTypeCache>,
) -> Result<Vec<String>, String> {
    // Pre-fill: copy already-cached results out of the lock; remaining indices
    // get computed in parallel below. Avoids contending on the cache mutex
    // from inside the rayon workers.
    let mut results: Vec<Option<String>> = vec![None; page_indices.len()];
    let mut todo: Vec<(usize, u32)> = Vec::new();
    if let Ok(cache) = page_type_cache.0.lock() {
        for (i, &p) in page_indices.iter().enumerate() {
            if let Some(v) = cache.get(&(path.clone(), p)) {
                results[i] = Some(v.clone());
            } else {
                todo.push((i, p));
            }
        }
    }
    if todo.is_empty() {
        return Ok(results.into_iter().map(|o| o.unwrap_or_default()).collect());
    }

    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let pages: Vec<usize> = todo.iter().map(|&(_, p)| p as usize).collect();
    let batch_results = doc.analyze_page_types_batch(&pages);

    // Stitch new results back into `results` and into the persistent cache.
    if let Ok(mut cache) = page_type_cache.0.lock() {
        for ((i_in_input, p_idx), r) in todo.iter().zip(batch_results.iter()) {
            let s = match r {
                Ok(open_pdf_render::PageType::Vector) => "vector".to_string(),
                Ok(open_pdf_render::PageType::Tile) => "tile".to_string(),
                Err(_) => "vector".to_string(), // fall through to vector path on parse error
            };
            cache.insert((path.clone(), *p_idx), s.clone());
            results[*i_in_input] = Some(s);
        }
    }
    Ok(results.into_iter().map(|o| o.unwrap_or_default()).collect())
}

#[tauri::command]
fn extract_draw_commands(
    path: String,
    page_index: u32,
    rotation: Option<i32>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<u8>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let extra_rot = rotation.unwrap_or(0);
    let cmds = doc.extract_draw_commands(page_index as usize, extra_rot).map_err(|e| format!("{}", e))?;
    Ok(cmds.into_bytes())
}

#[tauri::command]
fn extract_page_text(
    path: String,
    page_index: u32,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<String, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    doc.extract_text_positions(page_index as usize).map_err(|e| format!("{}", e))
}

/// Batch extract draw commands for multiple pages in parallel using rayon.
/// Returns one Vec<u8> per requested page in the same order. Used for
/// adjacent-page prefetch (warm pages 2..N in the background after page 1
/// is on screen so wheel-scrolling forward feels instant).
///
/// `rotations` is a parallel array of extra rotation values (one per page).
/// Pass an empty array to use 0 for all pages.
#[tauri::command]
fn extract_draw_commands_batch(
    path: String,
    page_indices: Vec<u32>,
    rotations: Option<Vec<i32>>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<Vec<u8>>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let rots = rotations.unwrap_or_default();
    let pairs: Vec<(usize, i32)> = page_indices.iter().enumerate().map(|(i, &p)| {
        (p as usize, rots.get(i).copied().unwrap_or(0))
    }).collect();
    let results = doc.extract_draw_commands_batch(&pairs);
    let mut out = Vec::with_capacity(results.len());
    for r in results {
        out.push(r.map(|b| b.into_bytes()).map_err(|e| format!("{}", e))?);
    }
    Ok(out)
}

/// Invalidate the PDF bytes cache AND the parsed handle cache for a specific
/// file (call after save/modify so the next render sees the new content).
#[tauri::command]
fn invalidate_pdf_cache(
    path: String,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
    page_type_cache: tauri::State<PageTypeCache>,
) -> Result<bool, String> {
    bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?.remove(&path);
    handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?.remove(&path);
    if let Ok(mut tc) = thumb_cache.0.lock() {
        tc.retain(|(p, _, _, _), _| p != &path);
    }
    if let Ok(mut pc) = page_type_cache.0.lock() {
        pc.retain(|(p, _), _| p != &path);
    }
    Ok(true)
}

/// Clear the entire PDF bytes cache AND parsed handle cache (call on app
/// cleanup or memory pressure).
#[tauri::command]
fn clear_pdf_cache(
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
    page_type_cache: tauri::State<PageTypeCache>,
    pdfium_cache: tauri::State<pdfium_renderer::PdfiumDocCache>,
    pixmap_cache: tauri::State<pdfium_renderer::PixmapCacheState>,
) -> Result<bool, String> {
    bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?.clear();
    handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?.clear();
    if let Ok(mut tc) = thumb_cache.0.lock() { tc.clear(); }
    if let Ok(mut ptc) = page_type_cache.0.lock() { ptc.clear(); }
    if let Ok(mut pc) = pdfium_cache.0.lock() { pc.clear(); }
    if let Ok(mut guard) = pixmap_cache.0.lock() {
        if let Some(cache) = guard.as_mut() {
            cache.clear();
        }
    }
    Ok(true)
}

#[tauri::command]
fn get_page_dimensions(
    path: String,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<(f32, f32)>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    // Parallelized via rayon inside open-pdf-render — much faster than the
    // old sequential loop on multi-page documents.
    doc.page_dimensions_all()
        .into_iter()
        .map(|r| r.map_err(|e| format!("{}", e)))
        .collect()
}

// ─── Screenshot-annotate feature ────────────────────────────────────────────
// Read the current clipboard bitmap and return it as PNG bytes. Used by the
// "annotate clipboard screenshot" flow: Windows PrtScn (and the Snipping Tool)
// place the capture on the clipboard, and reading it in Rust via the
// clipboard-manager plugin is far more reliable than navigator.clipboard.read()
// inside WebView2. Returns an error when the clipboard holds no image.
#[tauri::command]
fn read_clipboard_image_png(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    use image::ImageEncoder;
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let img = app
        .clipboard()
        .read_image()
        .map_err(|e| format!("no image on clipboard: {e}"))?;
    let width = img.width();
    let height = img.height();
    let rgba = img.rgba();
    if width == 0 || height == 0 || rgba.is_empty() {
        return Err("clipboard image is empty".into());
    }

    let mut png: Vec<u8> = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("PNG encode failed: {e}"))?;
    Ok(tauri::ipc::Response::new(png))
}

// Register/unregister the PrtScn global hotkey based on the user preference.
// Called from the frontend when the "intercept PrtScn" preference changes and
// at startup. Idempotent. Desktop only — the global-shortcut plugin has no
// mobile backend, so on Android this is a no-op stub (see below).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_prtscn_hotkey(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

    let shortcut = Shortcut::new(None, Code::PrintScreen);
    let gs = app.global_shortcut();
    let is_registered = gs.is_registered(shortcut);
    if enabled && !is_registered {
        gs.register(shortcut).map_err(|e| e.to_string())?;
    } else if !enabled && is_registered {
        gs.unregister(shortcut).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn set_prtscn_hotkey(_app: tauri::AppHandle, _enabled: bool) -> Result<(), String> {
    Ok(())
}

/// Mobile entry point: tauri vereist een argumentloze functie; de desktop-
/// varianten geven StartupOpts (mcp-server/poort) door via main.rs.
#[cfg(mobile)]
#[tauri::mobile_entry_point]
fn run_mobile() {
    run(StartupOpts::default());
}

pub fn run(opts: StartupOpts) {
    eprintln!(
        "[startup] mcp_server={}, mcp_port={}",
        opts.mcp_server, opts.mcp_port
    );

    // Capture the MCP options for `setup()` — we now spawn the MCP server
    // *after* Tauri has produced an `AppHandle` so the new `app_*` tools
    // can emit events into the live WebView. Previously the server was
    // started here (before the builder ran) and never had a handle.
    let mcp_enabled = opts.mcp_server;
    let mcp_port = opts.mcp_port;

    let args: Vec<String> = std::env::args().collect();

    // Handle --version / --help before Tauri::Builder::default().run() so these
    // flags print and exit instead of hanging in the event loop. Running the
    // full builder also squats the single-instance DBus name, which blocks
    // subsequent normal launches until the name is released.
    for arg in args.iter().skip(1) {
        match arg.as_str() {
            "--version" | "-V" => {
                println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "--help" | "-h" => {
                println!("Usage: {} [OPTIONS] [FILE...]", env!("CARGO_PKG_NAME"));
                println!();
                println!("Options:");
                println!("  -h, --help       Print this help and exit");
                println!("  -V, --version    Print version and exit");
                println!();
                println!("Files:");
                println!("  One or more .pdf files to open.");
                std::process::exit(0);
            }
            _ => {}
        }
    }

    // Collect any PDF file paths passed on the command line (for file associations)
    let opened_files: Vec<String> = args.iter()
        .skip(1)
        .filter(|arg| arg.to_lowercase().ends_with(".pdf") && !arg.starts_with('-'))
        .cloned()
        .collect();

    // Spawn the PDFium worker pool. Failures here are non-fatal — the
    // existing in-proc PDFium path serves as fallback when the pool is
    // unavailable.
    let pool: Arc<tokio::sync::OnceCell<worker_pool::WorkerPool>> = Arc::new(tokio::sync::OnceCell::new());
    let pool_for_init = pool.clone();
    tauri::async_runtime::spawn(async move {
        // De pdfium-worker-sidecar staat na bundling naast de hoofdbinary. De
        // bestandsnaam is platform-afhankelijk (`pdfium-worker.exe` op Windows,
        // `pdfium-worker` zonder extensie op macOS/Linux); worker_exe_path()
        // levert het juiste pad zodat de pool ook op macOS/Linux gevonden wordt.
        let worker_exe = worker_pool::worker_exe_path();

        if !worker_exe.exists() {
            eprintln!("[pool] pdfium-worker sidecar not found at {:?} — pool disabled, using in-proc PDFium", worker_exe);
            return;
        }

        match worker_pool::spawn::spawn_pool(4, &worker_exe).await {
            Ok(workers) => {
                let pool = worker_pool::WorkerPool::new(workers);
                if pool.is_ready() {
                    eprintln!("[pool] initialised with {} workers", pool.workers.len());
                    let _ = pool_for_init.set(pool);
                    // Idle-trim: open pagina-handles in de workers kosten op
                    // zware CAD-pagina's ruim 1 GB per worker. Na 5 min zonder
                    // renders geven de workers die parse-state terug; de
                    // eerstvolgende render betaalt eenmalig de her-parse.
                    // 5 min (niet korter): tijdens actief werken moet de
                    // handle heet blijven, anders voelt elke zoom na een
                    // denkpauze weer traag. Eigen OS-thread (geen
                    // tokio::time-afhankelijkheid).
                    let pool_for_trim = pool_for_init.clone();
                    std::thread::spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(60));
                        if let Some(p) = pool_for_trim.get() {
                            tauri::async_runtime::block_on(p.trim_if_idle(300_000));
                        }
                    });
                } else {
                    eprintln!("[pool] no workers became ready — pool disabled");
                }
            }
            Err(e) => {
                eprintln!("[pool] spawn_pool failed: {} — pool disabled", e);
            }
        }
    });

    let mut builder = tauri::Builder::default()
        .manage(OpenedFiles(Mutex::new(opened_files)))
        .manage(LockedFiles(Mutex::new(HashMap::new())))
        .manage(PdfBytesCache(Mutex::new(HashMap::new())))
        .manage(DocHandleCache(Mutex::new(HashMap::new())))
        .manage(TileSceneCache(Mutex::new(Vec::new())))
        .manage(ThumbnailCache(Mutex::new(HashMap::new())))
        .manage(PageTypeCache(Mutex::new(HashMap::new())))
        .manage(pdfium_renderer::PdfiumDocCache::default())
        .manage(pdfium_renderer::PixmapCacheState::default())
        .manage(pool.clone())
        .manage(mcp_app_bridge::McpAppBridge::new())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build());
    // Drag-out window detach is desktop-only (no mobile backend in the crate).
    #[cfg(not(target_os = "android"))]
    {
        builder = builder.plugin(tauri_plugin_drag::init());
    }

    // Single-instance and updater plugins are desktop-only.
    //
    // A DETACHED document window is launched as its own app process with the
    // `OPDS_DETACHED=1` env var (see window_mgmt::spawn_window_with_pdf). Such
    // a process must NOT register single-instance — otherwise it would just
    // forward its PDF arg to the original instance and exit, instead of
    // becoming an independent window. So we skip the plugin when detached.
    #[cfg(not(target_os = "android"))]
    {
        let is_detached = std::env::var("OPDS_DETACHED").as_deref() == Ok("1");
        if !is_detached {
            builder = builder
                .plugin(tauri_plugin_single_instance::init(|app: &tauri::AppHandle, argv: Vec<String>, _cwd: String| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    let files: Vec<String> = argv.iter()
                        .filter(|arg: &&String| arg.to_lowercase().ends_with(".pdf") && !arg.starts_with('-'))
                        .cloned()
                        .collect();
                    for path in &files {
                        let _ = app.fs_scope().allow_file(path);
                    }
                    if !files.is_empty() {
                        let _ = app.emit("open-files", &files);
                    }
                }));
        }
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    // Global system hotkey (PrtScn) for the opt-in "screenshot annotate"
    // feature. The shortcut is NOT registered here — the plugin only installs
    // the dispatch handler. The frontend calls `set_prtscn_hotkey(true)` when
    // the user enables the preference, which actually registers PrtScn. On
    // press we bring the main window to the foreground and notify the WebView,
    // which reads the clipboard image onto a fresh annotate canvas. Desktop
    // only (the crate has no mobile backend).
    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_global_shortcut::ShortcutState;
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("prtscn-screenshot", ());
                    }
                })
                .build(),
        );
    }

    builder
        .setup(move |app| {
            // Grant FS plugin scope for command-line files (file association)
            for path in app.state::<OpenedFiles>().0.lock().unwrap().iter() {
                let _ = app.fs_scope().allow_file(path);
            }

            // Set the window icon (desktop only — not applicable on Android)
            #[cfg(not(target_os = "android"))]
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }

            // Spawn the in-process MCP server (deferred until here so the
            // `app_*` tools can dispatch events into the live WebView via
            // the AppHandle stored in the server's AppState). Refuses to
            // start in release builds unless OPS_ENABLE_MCP=1 (handled
            // inside `mcp_server::start`).
            if mcp_enabled {
                let app_handle = app.handle().clone();
                let test_pdfs_dir = mcp_server::resolve_test_pdfs_dir(
                    std::env::var_os("OPS_TEST_PDFS_DIR").map(std::path::PathBuf::from),
                );
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = mcp_server::start(mcp_port, test_pdfs_dir, Some(app_handle)).await {
                        eprintln!("[mcp] server failed: {e}");
                    }
                });
            }

            // PDFium initialisation — must run before any Tauri command.
            // resource_dir() returns the directory where Tauri's bundle.resources
            // land. In dev (cargo run) that's target/debug/; in release it's
            // the installer-payload root.
            let resource_dir = app
                .path()
                .resource_dir()
                .map_err(|e| format!("Cannot resolve resource_dir: {}", e))?;

            // Non-fatal: if PDFium can't load (e.g. libpdfium.so missing from a
            // Linux bundle), the app still starts and the UI loads — rendering
            // reports an error instead of aborting at startup.
            match pdfium_renderer::init_pdfium(&resource_dir) {
                Ok(()) => log::info!("PDFium initialised from {:?}", resource_dir),
                Err(e) => log::error!("PDFium initialisation failed (rendering disabled): {}", e),
            }

            // Windows-only: pre-warm shell32.dll + comdlg32.dll + the
            // IFileOpenDialog COM factory in a background thread so the
            // first time the user clicks Bestand → Open → Bladeren the
            // OS dialog pops in ~100–300ms instead of the cold 1–3 s it
            // takes to load shell32 + every shell extension (OneDrive,
            // cloud-sync providers, AV hooks) on demand.
            //
            // We spend ~50 ms on a background thread at app startup to
            // amortise this cost. The dialog plugin (rfd 0.16) calls
            // CoInitializeEx/CoUninitialize around every Show(), so we
            // can't keep the COM apartment alive across calls — but the
            // DLLs and the registered class factory stay loaded for the
            // life of the process, which is what costs the seconds.
            #[cfg(target_os = "windows")]
            {
                std::thread::spawn(|| {
                    use windows_sys::Win32::System::Com::{
                        CoCreateInstance, CoInitializeEx, CoUninitialize,
                        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
                        COINIT_DISABLE_OLE1DDE,
                    };
                    use windows_sys::Win32::UI::Shell::FileOpenDialog;
                    use windows_sys::core::GUID;
                    const FILE_OPEN_DIALOG_IID: GUID =
                        GUID::from_u128(0xd57c7288_d4ad_4768_be02_9d969532d960);

                    let t0 = std::time::Instant::now();
                    unsafe {
                        let res = CoInitializeEx(
                            std::ptr::null(),
                            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
                        );
                        if res < 0 {
                            eprintln!("[prewarm] CoInitializeEx failed: 0x{:x}", res);
                            return;
                        }
                        let mut iptr: *mut std::ffi::c_void = std::ptr::null_mut();
                        let hr = CoCreateInstance(
                            &FileOpenDialog,
                            std::ptr::null_mut(),
                            CLSCTX_INPROC_SERVER,
                            &FILE_OPEN_DIALOG_IID,
                            &mut iptr as *mut _ as *mut *mut std::ffi::c_void,
                        );
                        if hr >= 0 && !iptr.is_null() {
                            // Release: vtbl()[2] is Release.
                            #[repr(C)]
                            struct IUnknownV {
                                _qi: usize,
                                _add_ref: usize,
                                release: unsafe extern "system" fn(
                                    this: *mut std::ffi::c_void,
                                ) -> u32,
                            }
                            let vtbl = *(iptr as *mut *mut IUnknownV);
                            ((*vtbl).release)(iptr);
                        }
                        CoUninitialize();
                    }
                    log::info!(
                        "[prewarm] shell32 + IFileOpenDialog factory warmed in {} ms",
                        t0.elapsed().as_millis()
                    );
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_opened_file,
            save_session,
            load_session,
            get_username,
            read_file,
            write_file,
            file_exists,
            open_url,
            is_dev_mode,
            lock_file,
            unlock_file,
            is_default_pdf_app,
            open_default_apps_settings,
            get_printers,
            print_pdf,
            open_printer_properties,
            get_temp_dir,
            write_temp_pdf,
            delete_file,
            rename_file,
            install_virtual_printer,
            remove_virtual_printer,
            is_virtual_printer_installed,
            virtual_printer_collect,
            virtual_printer_jobs,
            virtual_printer_delete_job,
            virtual_printer_catch_enabled,
            virtual_printer_enable_catch,
            open_pdf_in_default_viewer,
            reveal_in_file_manager,
            get_printer_spool_dir,
            list_printer_spool,
            discard_spool_pdf,
            download_pdf_from_url,
            list_pdf_files,
            save_preferences,
            load_preferences,
            play_alert_sound,
            list_plugins,
            install_plugin,
            uninstall_plugin,
            read_plugin_file,
            render_pdf_page,
            render_pdf_page_region,
            render_tile_scene_region,
            page_content_size,
            get_page_dimensions,
            invalidate_pdf_cache,
            clear_pdf_cache,
            analyze_page_type,
            analyze_page_type_batch,
            render_pdf_page_skia,
            extract_draw_commands,
            extract_draw_commands_batch,
            extract_page_text,
            render_thumbnail,
            render_to_png::render_page_to_png,
            allow_fs_scope,
            mcp_app_bridge::app_response,
            mcp_app_bridge::mcp_bridge_ready,
            accounts::accounts_sign_in,
            accounts::accounts_get_user,
            accounts::accounts_sign_out,
            accounts::accounts_fetch,
            accounts::accounts_upload_file,
            accounts::accounts_download_file,
            accounts::accounts_brand_logo,
            email::email_pdf,
            window_mgmt::spawn_window_with_pdf,
            window_mgmt::try_dock_pdf_at_screen,
            window_mgmt::close_window_by_label,
            window_mgmt::current_window_label,
            window_mgmt::exit_detached_process,
            window_mgmt::drag_icon_path,
            window_mgmt::detach_diag,
            read_clipboard_image_png,
            set_prtscn_hotkey,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
