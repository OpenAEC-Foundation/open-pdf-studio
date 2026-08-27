//! Multi-window management — "detach a tab into its own window" (Chrome-style).
//!
//! Architecture: detaching launches a SECOND, INDEPENDENT app process with the
//! PDF path as a command-line argument and `OPDS_DETACHED=1` in its env. We
//! chose process-per-window over Tauri's in-process `WebviewWindowBuilder`
//! because:
//!   * `WebviewWindowBuilder::build()` called synchronously from a command
//!     handler deadlocks in dev mode (the call never returns, the window stays
//!     a blank grey shell — main.js never boots).
//!   * Each process is a real, fully-initialised app — no half-built webview,
//!     no shared-canvas/ghosting bugs, identical behaviour to a normal launch.
//!
//! Two coordination details make multi-process safe:
//!   * `OPDS_DETACHED=1` makes the new process SKIP the single-instance plugin
//!     (lib.rs) so it runs as its own window instead of forwarding its arg to
//!     the original instance and exiting.
//!   * The PDFium worker pool namespaces its SHM files by the owning process
//!     PID (worker_pool/spawn.rs + pdfium-worker), so the second process's
//!     workers don't collide with the first's on `pdfium-worker-*.shm`.

use tauri::{AppHandle, Emitter, Manager};

/// JS-side diagnostic sink: the WebView console is invisible in the dev
/// terminal, so the frontend calls this to surface boot/detach progress.
/// Writes to BOTH stderr (may be pipe-buffered) AND a temp file that can be
/// read directly without buffering. Temporary debugging aid.
#[tauri::command]
pub fn detach_diag(label: String, msg: String) {
    eprintln!("[detach-diag][{label}] {msg}");
    diag_file(&format!("[{label}] {msg}"));
}

/// Append a line to the temp diagnostic file (buffer-free, directly readable).
fn diag_file(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("opds-detach-diag.log"))
    {
        let _ = writeln!(f, "{msg}");
    }
}

/// Approximate tab-bar height in CSS (logical) pixels at the top of every
/// window. Used by `try_dock_pdf_at_screen` for re-dock hit-testing.
const TAB_BAR_HEIGHT_CSS_PX: f64 = 48.0;

/// Detach a tab into its own window by launching a NEW, independent app
/// process with the PDF path as an argument. Returns a short status string.
///
/// The new process:
///   1. skips single-instance (via `OPDS_DETACHED=1`), so it becomes its own
///      window rather than forwarding the arg to this instance;
///   2. reads the `.pdf` argv on boot and auto-opens it (the same path used
///      for file-association double-clicks);
///   3. spawns its own PID-namespaced PDFium worker pool.
#[tauri::command]
pub fn spawn_window_with_pdf(
    _app: AppHandle,
    pdf_path: String,
) -> Result<String, String> {
    if pdf_path.is_empty() {
        return Err("Cannot detach an unsaved document — save it first.".to_string());
    }

    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;

    // Build the command. We launch the child FULLY INDEPENDENT of this process
    // so that (a) closing the original window doesn't kill detached windows,
    // and (b) in dev the child survives even when the `tauri dev` job object
    // tears down. On Windows that means CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS.
    let build_cmd = || {
        let mut c = std::process::Command::new(&exe);
        c.arg(&pdf_path);
        c.env("OPDS_DETACHED", "1");
        c.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        c
    };

    #[cfg(target_os = "windows")]
    let spawn_result = {
        use std::os::windows::process::CommandExt;
        // 0x01000000 CREATE_BREAKAWAY_FROM_JOB, 0x00000008 DETACHED_PROCESS,
        // 0x00000200 CREATE_NEW_PROCESS_GROUP.
        const FLAGS: u32 = 0x0100_0000 | 0x0000_0008 | 0x0000_0200;
        let mut c = build_cmd();
        c.creation_flags(FLAGS);
        match c.spawn() {
            Ok(child) => Ok(child),
            // The parent's job may forbid breakaway — retry plainly so detach
            // still works (child just shares the job; fine in production).
            Err(_) => build_cmd().spawn(),
        }
    };
    #[cfg(not(target_os = "windows"))]
    let spawn_result = build_cmd().spawn();

    match spawn_result {
        Ok(child) => {
            diag_file(&format!(
                "[spawn] launched detached process pid={} exe={:?} pdf={}",
                child.id(), exe, pdf_path
            ));
            eprintln!("[spawn] launched detached process pid={} pdf={}", child.id(), pdf_path);
            Ok(format!("pid-{}", child.id()))
        }
        Err(e) => {
            diag_file(&format!("[spawn] FAILED to launch process: {e}"));
            eprintln!("[spawn] FAILED to launch detached process: {e}");
            Err(format!("Failed to launch detached window: {e}"))
        }
    }
}

#[derive(serde::Serialize, Clone)]
struct OpenPdfInWindowPayload {
    pdf_path: String,
}

/// Re-dock support (drag a detached window's tab back onto another window's
/// tab bar). Checks every window in THIS process whose tab bar is at the given
/// physical screen point and, if hit, emits `open-pdf-in-window` to it.
///
/// NOTE: with the process-per-window model this only matches windows in the
/// SAME process. Cross-process re-dock is handled separately (the detached
/// process detects the drop over another instance and forwards via the OS).
#[tauri::command]
pub fn try_dock_pdf_at_screen(
    app: AppHandle,
    from_label: String,
    screen_x: i32,
    screen_y: i32,
    pdf_path: String,
) -> Result<Option<String>, String> {
    for (label, win) in app.webview_windows() {
        if label == from_label {
            continue;
        }
        let Ok(pos) = win.outer_position() else { continue };
        let Ok(size) = win.outer_size() else { continue };
        let scale = win.scale_factor().unwrap_or(1.0);
        let tab_bar_px = (TAB_BAR_HEIGHT_CSS_PX * scale).round() as i32;

        let left = pos.x;
        let top = pos.y;
        let right = pos.x + size.width as i32;
        let bottom = pos.y + tab_bar_px;

        if screen_x >= left && screen_x < right && screen_y >= top && screen_y < bottom {
            let _ = win.emit("open-pdf-in-window", OpenPdfInWindowPayload { pdf_path: pdf_path.clone() });
            return Ok(Some(label));
        }
    }
    Ok(None)
}

/// Close a Tauri window by label (re-dock cleanup).
#[tauri::command]
pub fn close_window_by_label(app: AppHandle, label: String) -> Result<(), String> {
    let Some(win) = app.get_webview_window(&label) else {
        return Err(format!("Window '{label}' not found"));
    };
    win.destroy().map_err(|e| format!("Failed to close window: {e}"))
}

/// Return the label of the WebViewWindow that issued the call.
#[tauri::command]
pub fn current_window_label(window: tauri::WebviewWindow) -> String {
    window.label().to_string()
}

/// Is de primaire muisknop op DIT moment fysiek ingedrukt?
///
/// Cruciaal voor `tab_drag_preflight`: de OS-drag (`DoDragDrop` op Windows) neemt
/// aan dat de gebruiker de knop vasthoudt. Wordt hij zonder ingedrukte knop
/// gestart, dan krijgt de drag-bron-thread nooit de muisberichten die de
/// modale drag-lus nodig heeft om te eindigen — de lus loopt oneindig door en
/// BLOKKEERT de hele event-loop van de app (venster bevriest permanent, alleen
/// nog af te breken met "taak beëindigen", waarbij niet-opgeslagen werk
/// verloren gaat). Dat is precies het scenario dat gebruikers als "crash"
/// rapporteren bij het slepen van een tab tussen twee vensters.
///
/// Op niet-Windows-platforms bestaat die valkuil niet in deze vorm; daar geven
/// we `true` terug zodat het gedrag ongewijzigd blijft.
#[cfg(target_os = "windows")]
fn primary_pointer_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};
    // VK_LBUTTON = 0x01, VK_RBUTTON = 0x02. Met omgewisselde muisknoppen is de
    // rechterknop de primaire.
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let vk = if swapped { 0x02 } else { 0x01 };
    // Hoogste bit = knop is op dit moment ingedrukt.
    (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0
}

#[cfg(not(target_os = "windows"))]
fn primary_pointer_down() -> bool {
    true
}

/// Uitkomst van `tab_drag_preflight` — of een OS-drag nu veilig gestart kan
/// worden, en zo niet: waarom niet.
#[derive(serde::Serialize, Clone)]
pub struct TabDragPreflight {
    /// `true` → de frontend mag `startDrag` aanroepen.
    pub ok: bool,
    /// Machine-leesbare reden bij `ok == false`:
    /// `"no-path"` | `"missing-file"` | `"button-released"`.
    pub reason: Option<String>,
}

/// Laatste controle vlak vóór de frontend een native OS-filedrag start.
///
/// ACHTERGROND (issue #335). `tauri-plugin-drag` voert `DoDragDrop` uit in een
/// closure op de MAIN thread van de app. Die Win32-API gaat ervan uit dat de
/// gebruiker de muisknop vasthoudt: hij vertrouwt op de muis-capture van de
/// drag-bron om zijn modale lus te voeden. Start de drag zónder ingedrukte
/// knop, dan komen die berichten nooit binnen, eindigt de lus nooit, en staat
/// de complete Tauri-event-loop stil. Het venster tekent nog, maar geen enkel
/// `invoke` keert nog terug — de gebruiker kan alleen nog "taak beëindigen"
/// doen en raakt niet-opgeslagen werk kwijt. Dat is lokaal gereproduceerd.
///
/// Daarnaast paniekt de onderliggende drag-crate met `unwrap()` als het pad
/// niet naar een bestaand bestand wijst (`ILCreateFromPathW` geeft dan NULL en
/// de shell-item-array faalt). Zo'n paniek ontrolt door de vensterprocedure —
/// een `extern "system"`-grens — en Rust breekt het proces dan hard af
/// (`FAST_FAIL_FATAL_APP_EXIT`, uitzonderingscode `0xC0000409`). Vandaar dat we
/// het bestaan van het bestand hier óók afvangen.
///
/// Beide situaties worden hier gedetecteerd zodat de frontend kan terugvallen
/// op het losse-venster-pad in plaats van de app te verliezen.
#[tauri::command]
pub fn tab_drag_preflight(pdf_path: String) -> TabDragPreflight {
    if pdf_path.is_empty() {
        return TabDragPreflight { ok: false, reason: Some("no-path".to_string()) };
    }
    if !std::path::Path::new(&pdf_path).is_file() {
        return TabDragPreflight { ok: false, reason: Some("missing-file".to_string()) };
    }
    if !primary_pointer_down() {
        return TabDragPreflight { ok: false, reason: Some("button-released".to_string()) };
    }
    TabDragPreflight { ok: true, reason: None }
}

/// Materialise the drag-preview icon (a PDF-file glyph) to a temp file and
/// return its absolute path. The drag layer needs a real filesystem path for
/// the drag image; the icon is embedded at compile time so this works in dev
/// AND in the bundled app.
#[tauri::command]
pub fn drag_icon_path() -> Result<String, String> {
    let path = std::env::temp_dir().join("opds-drag-icon.png");
    if !path.exists() {
        let bytes = include_bytes!("../icons/file-icon-128.png");
        std::fs::write(&path, bytes).map_err(|e| format!("write drag icon: {e}"))?;
    }
    Ok(path.to_string_lossy().to_string())
}

/// Exit THIS process. Used when a detached single-window process has its only
/// document re-docked back into another instance — the now-empty detached
/// process should disappear.
#[tauri::command]
pub fn exit_detached_process(app: AppHandle) {
    app.exit(0);
}
