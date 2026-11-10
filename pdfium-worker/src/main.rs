// Release builds: hide the console window so each spawned worker process
// doesn't pop a black terminal next to the Tauri main window. Debug builds
// keep the console so logs are visible during development. Mirrors the
// pattern in open-pdf-studio/src-tauri/src/main.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod compare;
mod mesh_bbox;
mod protocol;
mod render;
mod shm;
mod snap_geometry;
mod thin_lines;

use anyhow::{Context, Result};
use protocol::{Request, Response};
use render::Renderer;
use shm::Shm;
use std::io::{BufRead, Write};

fn main() -> Result<()> {
    // Slot is passed as argv[1] (set by the spawner). Default to 0 for
    // standalone testing. Namespace (owning app PID) is argv[2] so multiple
    // app instances don't collide on the same SHM file; default "0".
    let slot: u32 = std::env::args().nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let ns: String = std::env::args().nth(2).unwrap_or_else(|| "0".to_string());

    let mut renderer = Renderer::new().context("init Renderer")?;
    let mut compare_cache = compare::CompareCache::default();
    let mut shm_region = Shm::create(&ns, slot).context("init SHM")?;

    // Emit ready message — main process waits for this before
    // sending render requests.
    let ready = Response::Ready {
        op: "ready".to_string(),
        shm_name: format!("pdfium-worker-{}-{}.shm", ns, slot),
        shm_size: shm::SHM_SIZE as u64,
        caps: vec!["compare".to_string(), "snap_geometry".to_string()],
    };
    writeln!(std::io::stdout(), "{}", serde_json::to_string(&ready)?)?;
    std::io::stdout().flush()?;

    // Laatste snap-resultaat, tot de app het laatste stuk heeft opgehaald.
    let mut snap_bewaard: Option<(SnapKey, Vec<u8>)> = None;

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[worker {}] stdin read error: {}", slot, e);
                break;
            }
        };
        if line.trim().is_empty() { continue; }

        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[worker {}] bad request: {}", slot, e);
                continue;
            }
        };

        match req {
            Request::Render { id, path, page_index, scale, rotation, thin_lines } => {
                let resp = match renderer.render(&path, page_index, scale, rotation, thin_lines) {
                    Ok(result) => {
                        match shm_region.write_bitmap(result.width, result.height, &result.rgba) {
                            Ok(bytes) => Response::RenderOk {
                                id, ok: true,
                                w: result.width, h: result.height,
                                shm_bytes: bytes,
                            },
                            Err(e) => Response::RenderErr {
                                id, ok: false,
                                error: format!("SHM write: {}", e),
                            },
                        }
                    }
                    Err(e) => Response::RenderErr {
                        id, ok: false,
                        error: format!("{}", e),
                    },
                };
                writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                stdout.flush()?;
            }
            Request::RenderRegion {
                id, path, page_index, scale, rotation,
                region_x_pt, region_y_pt, region_w_pt, region_h_pt, thin_lines,
            } => {
                let resp = match renderer.render_region(
                    &path, page_index, scale, rotation,
                    region_x_pt, region_y_pt, region_w_pt, region_h_pt, thin_lines,
                ) {
                    Ok(result) => {
                        match shm_region.write_bitmap(result.width, result.height, &result.rgba) {
                            Ok(bytes) => Response::RenderOk {
                                id, ok: true,
                                w: result.width, h: result.height,
                                shm_bytes: bytes,
                            },
                            Err(e) => Response::RenderErr {
                                id, ok: false,
                                error: format!("SHM write: {}", e),
                            },
                        }
                    }
                    Err(e) => Response::RenderErr {
                        id, ok: false,
                        error: format!("{}", e),
                    },
                };
                writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                stdout.flush()?;
            }
            Request::Compare(req) => {
                let line = compare_response(&mut renderer, &mut compare_cache, &mut shm_region, &req);
                writeln!(stdout, "{}", line)?;
                stdout.flush()?;
            }
            Request::SnapGeometry { id, path, page_index, viewport, offset } => {
                let resp = snap_chunk(&mut renderer, &mut shm_region, &mut snap_bewaard, id, path, page_index, viewport, offset);
                writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                stdout.flush()?;
            }
            Request::Trim => {
                renderer.trim();
                compare_cache.clear();
            }
            Request::Shutdown => {
                eprintln!("[worker {}] shutting down", slot);
                break;
            }
        }
    }

    Ok(())
}

/// Antwoordregel op een vergelijkingsaanvraag. De clusters gaan binair via
/// SHM (zie compare::clusters_to_bytes); de regel zelf blijft klein.
fn compare_response(
    renderer: &mut Renderer,
    cache: &mut compare::CompareCache,
    shm_region: &mut Shm,
    req: &compare::CompareRequest,
) -> String {
    let id = req.id;
    let fail = |e: String| serde_json::json!({ "id": id, "ok": false, "op": "compare", "error": e }).to_string();
    let out = match compare::compare_pair(renderer, cache, req) {
        Ok(out) => out,
        Err(e) => return fail(format!("{:#}", e)),
    };
    let (n, shm_bytes, truncated, runs, components) = match &out.detection {
        Some(d) => {
            let bytes = compare::clusters_to_bytes(d);
            match shm_region.write_bitmap(d.clusters.len() as u32, compare::CLUSTER_FIELDS as u32, &bytes) {
                Ok(written) => (d.clusters.len(), written, d.truncated, d.runs, d.components),
                Err(e) => return fail(format!("SHM write: {}", e)),
            }
        }
        None => (0, 0, false, 0, 0),
    };
    serde_json::json!({
        "id": id,
        "ok": true,
        "op": "compare",
        "clusters": n,
        "shm_bytes": shm_bytes,
        "detected": out.detection.is_some(),
        "truncated": truncated,
        "runs": runs,
        "components": components,
        "alignment": out.alignment,
        "align_info": out.align_info,
        "old_px": out.old_px,
        "stats": out.stats,
    })
    .to_string()
}

type SnapKey = (String, u32, [u64; 6]);

/// Eén stuk snap-geometrie in de SHM-regio. Stuk 0 (of een onbekend
/// resultaat) extraheert opnieuw; volgende stukken komen uit het bewaarde
/// resultaat, dat na het laatste stuk vrijkomt.
#[allow(clippy::too_many_arguments)]
fn snap_chunk(
    renderer: &mut Renderer,
    shm_region: &mut Shm,
    bewaard: &mut Option<(SnapKey, Vec<u8>)>,
    id: u64,
    path: String,
    page_index: u32,
    viewport: [f64; 6],
    offset: u64,
) -> Response {
    let key: SnapKey = (path, page_index, viewport.map(f64::to_bits));
    let mut ms = 0.0;
    if offset == 0 || bewaard.as_ref().map(|(k, _)| k != &key).unwrap_or(true) {
        *bewaard = None;
        let t0 = std::time::Instant::now();
        match renderer.snap_geometry(&key.0, page_index, viewport) {
            Ok(bytes) => *bewaard = Some((key, bytes)),
            Err(e) => return Response::RenderErr { id, ok: false, error: format!("{}", e) },
        }
        ms = t0.elapsed().as_secs_f64() * 1000.0;
    }
    let (_, bytes) = bewaard.as_ref().expect("zojuist gezet");
    let total = bytes.len();
    let start = (offset as usize).min(total);
    let end = total.min(start + shm::PAYLOAD_CAP);
    let resp = match shm_region.write_payload(&bytes[start..end]) {
        Ok(n) => Response::SnapOk { id, ok: true, total_bytes: total as u64, offset: start as u64, shm_bytes: n, ms },
        Err(e) => Response::RenderErr { id, ok: false, error: format!("SHM write: {}", e) },
    };
    if end >= total {
        *bewaard = None;
    }
    resp
}
