//! Tauri-commando's voor de CMYK-omzetting bij de PDF/X-export (#422).
//!
//! Dunne schil om de crate `open-pdf-cmyk`; alle logica zit daar en is zonder
//! de app te testen. Hier alleen wat de app zelf weet: werk van de IPC-draad
//! af houden, voortgang als event naar de webview sturen, en de bytes rauw
//! over de grens (geen JSON-array van getallen, zie #463).
//!
//! - `pdfx_list_cmyk_profiles`: CMYK-drukprofielen in de systeemmappen.
//! - `pdfx_inspect_profile`: één gekozen bestand controleren.
//! - `pdfx_convert_to_cmyk`: rauwe PDF-bytes als body, het profielpad
//!   (percent-gecodeerd) in de kop `x-profile-path`, de intent in
//!   `x-rendering-intent`. Antwoord: zie `open_pdf_cmyk::pack_response`.

use open_pdf_cmyk::profiles::{find_profiles, inspect_file, system_profile_dirs};
use open_pdf_cmyk::{convert_with_profile, pack_response, path_from_header, ProfileInfo, RenderingIntent};
use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::Emitter;

#[derive(Clone, Serialize)]
struct ProgressEvent {
    done: usize,
    total: usize,
}

/// De CMYK-drukprofielen in de systeemmappen, gesorteerd op naam.
#[tauri::command]
pub async fn pdfx_list_cmyk_profiles() -> Result<Vec<ProfileInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| find_profiles(&system_profile_dirs()))
        .await
        .map_err(|e| format!("profile scan failed: {e}"))
}

/// Controleert een zelf gekozen bestand. Fout: `notIcc`, `notCmyk`,
/// `notPrinter` of `unreadable`.
#[tauri::command]
pub async fn pdfx_inspect_profile(path: String) -> Result<ProfileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_file(Path::new(&path)).map_err(|e| e.code().to_string()))
        .await
        .map_err(|e| format!("profile check failed: {e}"))?
}

/// Zet de PDF in de body om naar CMYK. Voortgang gaat als event
/// `pdfx-cmyk-progress` ({done, total} in pagina's), hooguit vijf keer per
/// seconde plus de laatste. Fout: de code uit `open_pdf_cmyk::Error::code`.
#[tauri::command]
pub async fn pdfx_convert_to_cmyk(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(pdf) = request.body() else {
        return Err("expected the PDF as a raw body".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let path = header("x-profile-path")
        .as_deref()
        .and_then(path_from_header)
        .ok_or_else(|| "profile:unreadable".to_string())?;
    let intent = RenderingIntent::from_code(header("x-rendering-intent").as_deref().unwrap_or(""));
    let pdf = pdf.clone();
    let packed = tauri::async_runtime::spawn_blocking(move || {
        let mut last = Instant::now() - Duration::from_secs(1);
        let mut progress = |done: usize, total: usize| {
            if done == total || last.elapsed() >= Duration::from_millis(200) {
                last = Instant::now();
                let _ = app.emit("pdfx-cmyk-progress", ProgressEvent { done, total });
            }
        };
        convert_with_profile(&pdf, &path, intent, &mut progress)
            .map(|c| pack_response(&c))
            .map_err(|e| {
                log::warn!("PDF/X CMYK conversion failed: {e}");
                e.code()
            })
    })
    .await
    .map_err(|e| format!("CMYK conversion task panicked: {e}"))??;
    Ok(tauri::ipc::Response::new(packed))
}
