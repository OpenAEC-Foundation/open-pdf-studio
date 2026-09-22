//! Tauri-commando's voor de export van een PDF-pagina naar DXF of DWG (#400).
//!
//! Dunne schil om de crate `open-pdf-cad`: alle logica — ook het lezen van de
//! argumenten — zit daar en is zonder de app te bouwen en te testen. Hier
//! gebeurt alleen wat de app zelf weet:
//! waar de PDFium-bibliotheek staat, welk slot de renderer gebruikt, en hoe
//! voortgang en afbreken naar de webview gaan.
//!
//! Verloop van één export:
//! 1. `export_page_to_cad` registreert een afbreekvlag onder `jobId` en zet het
//!    werk op een blokkerende werkdraad; de IPC-draad blijft vrij.
//! 2. Uitlezen gebeurt achter het in-proc-slot van de renderer, want PDFium is
//!    niet thread-safe. Het slot gaat los zodra de pagina is uitgelezen;
//!    opbouwen en schrijven van het CAD-bestand houden de renderer niet op.
//! 3. Voortgang gaat als event `cad-export-progress` naar de webview, hooguit
//!    tien keer per seconde plus bij elke fasewissel.
//! 4. `cancel_cad_export` zet de vlag; de export stopt tussen twee objecten,
//!    ook tijdens het opbouwen en schrijven van het CAD-bestand, en laat geen
//!    half bestand achter: het deelbestand komt pas op de plek van het doel als
//!    de vlag vlak vóór het hernoemen nog niet gezet is. Komt de export met een
//!    verslag terug, dan stáát het bestand er, ook als de vlag daarna nog gezet
//!    wordt.
//!
//! `scan_page_for_cad` telt vooraf per laag wat de export zou maken (voor de
//! lagenlijst en de omvanggrens in het exportvenster); ook die is af te breken.

use open_pdf_cad::{ExportArgs, ExportPhase, ExportProgress, ExportReport, PageScan, PdfiumLibrary};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// Lopende exports: afbreekvlag per `jobId`.
#[derive(Default)]
pub struct CadExportJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

/// Eén keer gebonden; het is hetzelfde bibliotheekbestand dat de renderer laadt.
static LIBRARY: OnceLock<PdfiumLibrary> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    job_id: &'a str,
    phase: ExportPhase,
    done: u64,
    total: u64,
}

fn library(app: &tauri::AppHandle) -> Result<&'static PdfiumLibrary, String> {
    if let Some(library) = LIBRARY.get() {
        return Ok(library);
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource_dir: {e}"))?;
    let loaded = PdfiumLibrary::load(&open_pdf_cad::pdfium_library_in(&resource_dir)).map_err(|e| e.to_string())?;
    Ok(LIBRARY.get_or_init(|| loaded))
}

/// Exporteert één pagina naar DXF of DWG en geeft het exportverslag terug.
/// De argumenten (camelCase) staan beschreven bij `open_pdf_cad::ExportArgs`.
#[tauri::command]
pub async fn export_page_to_cad(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, CadExportJobs>,
    job_id: String,
    args: ExportArgs,
) -> Result<ExportReport, String> {
    let mut request = args
        .request()
        .ok_or_else(|| "Uitvoerbestand moet op .dxf of .dwg eindigen".to_string())?;

    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|e| format!("CAD export jobs lock: {e}"))?
        .insert(job_id.clone(), Arc::clone(&cancel));

    let task = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let job_id = job_id.clone();
        let cancel = Arc::clone(&cancel);
        move || -> Result<ExportReport, String> {
            // De terugweg naar CAD staat op de pagina zelf; de crate leest
            // niets van schijf zonder dat de schil het vraagt. Geeft
            // `NO_MODEL_SPACE` of `MODEL_SPACE_AMBIGUOUS:<n>` als de oorsprong
            // van het model gevraagd is en de pagina hem niet (eenduidig) draagt.
            open_pdf_cad::resolve_model_space(&request.pdf_path, request.page_index, &mut request.options, Some(&cancel))
                .map_err(|e| e.to_string())?;
            let library = library(&app)?;
            let mut last_emit = Instant::now() - Duration::from_secs(1);
            let mut last_phase: Option<ExportPhase> = None;
            let mut on_progress = |p: ExportProgress| {
                let phase_changed = last_phase != Some(p.phase);
                if phase_changed || last_emit.elapsed() >= Duration::from_millis(100) {
                    last_phase = Some(p.phase);
                    last_emit = Instant::now();
                    let _ = app.emit(
                        "cad-export-progress",
                        ProgressEvent { job_id: &job_id, phase: p.phase, done: p.done, total: p.total },
                    );
                }
            };

            let page = {
                // Alleen het uitlezen gebruikt PDFium: daarna is het slot weer vrij.
                let _pdfium = crate::pdfium_renderer::inproc_guard();
                open_pdf_cad::extract_page(
                    library,
                    &request.pdf_path,
                    request.page_index,
                    &request.options,
                    Some(&cancel),
                    Some(&mut on_progress),
                )
                .map_err(|e| e.to_string())?
            };
            open_pdf_cad::check_size(&page, request.max_entities).map_err(|e| e.to_string())?;
            open_pdf_cad::write_page(
                page,
                &request.output_path,
                request.format,
                request.version,
                Some(&cancel),
                Some(&mut on_progress),
            )
            .map_err(|e| e.to_string())
        }
    });

    let result = task.await.map_err(|e| format!("CAD export task panicked: {e}"));
    if let Ok(mut running) = jobs.0.lock() {
        running.remove(&job_id);
    }
    result?
}

/// Telt per laag wat de export van een pagina zou maken. Alleen `pdfPath`,
/// `pageIndex` en de opties die de laagindeling bepalen doen ertoe; het
/// uitvoerpad wordt genegeerd.
#[tauri::command]
pub async fn scan_page_for_cad(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, CadExportJobs>,
    job_id: String,
    args: ExportArgs,
) -> Result<PageScan, String> {
    let options = args.options();
    let pdf_path = std::path::PathBuf::from(&args.pdf_path);
    let page_index = args.page_index;
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|e| format!("CAD export jobs lock: {e}"))?
        .insert(job_id.clone(), Arc::clone(&cancel));
    let task = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let cancel = Arc::clone(&cancel);
        move || -> Result<PageScan, String> {
            let library = library(&app)?;
            let _pdfium = crate::pdfium_renderer::inproc_guard();
            open_pdf_cad::scan_page(library, &pdf_path, page_index, &options, Some(&cancel)).map_err(|e| e.to_string())
        }
    });
    let result = task.await.map_err(|e| format!("CAD scan task panicked: {e}"));
    if let Ok(mut running) = jobs.0.lock() {
        running.remove(&job_id);
    }
    result?
}

/// Vraagt een lopende export, telronde of import om te stoppen. Geeft `false`
/// als er niets met dit `jobId` (meer) loopt.
#[tauri::command]
pub fn cancel_cad_export(jobs: tauri::State<'_, CadExportJobs>, job_id: String) -> bool {
    match jobs.0.lock() {
        Ok(running) => match running.get(&job_id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        },
        Err(_) => false,
    }
}
