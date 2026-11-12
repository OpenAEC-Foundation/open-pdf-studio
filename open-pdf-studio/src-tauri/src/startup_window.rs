//! Delay interactive desktop visibility until the shell is initialized (#1034).
//! A native watchdog preserves startup visibility if frontend initialization fails.
#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
pub fn prepare<R: tauri::Runtime>(context: &mut tauri::Context<R>) {
    for window in &mut context.config_mut().app.windows {
        if crate::startup_visibility::gated(&window.label, crate::headless::actief()) {
            window.visible = false;
        }
    }
}

#[cfg(desktop)]
fn reveal(window: &tauri::WebviewWindow, fallback: bool) -> Result<(), String> {
    if !crate::startup_visibility::gated(window.label(), crate::headless::actief()) {
        return Ok(());
    }
    let shown = window
        .state::<crate::startup_visibility::RevealOnce>()
        .reveal(|| window.show())
        .map_err(|e| e.to_string())?;
    if shown {
        let phase = if fallback {
            "native-window-fallback"
        } else {
            "native-window-ready"
        };
        window
            .state::<crate::startup_diagnostics::StartupDiagnostics>()
            .record(phase, None);
        if fallback {
            log::warn!("[startup] revealing window after shell readiness timeout");
        }
    }
    Ok(())
}

#[cfg(desktop)]
pub fn start_watchdog(app: &tauri::AppHandle) {
    app.manage(crate::startup_visibility::RevealOnce::default());
    if crate::headless::actief() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        // Independent of JS timers/rAF, which hidden webviews may throttle.
        std::thread::sleep(std::time::Duration::from_secs(15));
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = reveal(&window, true) {
                log::warn!("[startup] fallback reveal failed: {error}");
            }
        }
    });
}

#[tauri::command]
pub fn startup_window_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(desktop)]
    return reveal(&window, false);
    #[cfg(mobile)]
    {
        let _ = window;
        Ok(())
    }
}
