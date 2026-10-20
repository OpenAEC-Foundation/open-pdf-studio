// Release builds: hide the console window so each spawned worker process
// doesn't pop a black terminal next to the Tauri main window. Debug builds
// keep the console so logs are visible during development. Mirrors the
// pattern in open-pdf-studio/src-tauri/src/main.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hayro_render;
mod protocol;
mod render;
mod shm;
mod thin_lines;

use anyhow::{Context, Result};
use hayro_render::HayroRenderer;
use protocol::{Engine, Request, Response};
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
    let mut hayro = HayroRenderer::new();
    let mut shm_region = Shm::create(&ns, slot).context("init SHM")?;

    // Emit ready message — main process waits for this before
    // sending render requests.
    let ready = Response::Ready {
        op: "ready".to_string(),
        shm_name: format!("pdfium-worker-{}-{}.shm", ns, slot),
        shm_size: shm::SHM_SIZE as u64,
    };
    writeln!(std::io::stdout(), "{}", serde_json::to_string(&ready)?)?;
    std::io::stdout().flush()?;

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
            Request::Render { id, path, page_index, scale, rotation, thin_lines, engine } => {
                let result = match engine {
                    Engine::Pdfium => renderer.render(&path, page_index, scale, rotation, thin_lines),
                    Engine::Hayro => guarded(|| hayro.render(&path, page_index, scale, rotation)),
                };
                let resp = match result {
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
                region_x_pt, region_y_pt, region_w_pt, region_h_pt, thin_lines, engine,
            } => {
                let result = match engine {
                    Engine::Pdfium => renderer.render_region(
                        &path, page_index, scale, rotation,
                        region_x_pt, region_y_pt, region_w_pt, region_h_pt, thin_lines,
                    ),
                    Engine::Hayro => guarded(|| hayro.render_region(
                        &path, page_index, scale, rotation,
                        region_x_pt, region_y_pt, region_w_pt, region_h_pt,
                    )),
                };
                let resp = match result {
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
            Request::Trim => {
                renderer.trim();
            }
            Request::Shutdown => {
                eprintln!("[worker {}] shutting down", slot);
                break;
            }
        }
    }

    Ok(())
}

/// Run a Hayro render and turn a panic into an error response, so one
/// unsupported page cannot take the worker down.
fn guarded<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
        .unwrap_or_else(|_| Err(anyhow::anyhow!("Hayro panicked while rendering")))
}
