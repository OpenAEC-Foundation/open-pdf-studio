//! De AI-koppeling (MCP-server) aan- en uitzetten vanuit de instelling in de
//! app. Via de instelling draait de server in het publieke profiel. Draait hij
//! al via de startvlag (de ontwikkelroute), dan blijft die staan en meldt de
//! status dat.

use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::mcp_server::{self, AppState};
use crate::mcp_tool_meta::Profiel;

struct Lopend {
    poort: u16,
    bron: &'static str,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

static LOPEND: Mutex<Option<Lopend>> = Mutex::new(None);
static LAATSTE_FOUT: Mutex<Option<String>> = Mutex::new(None);

/// De ontwikkelroute is gestart (startvlag + OPS_ENABLE_MCP=1 of debug-build).
pub fn markeer_startvlag(poort: u16) {
    *LOPEND.lock().unwrap() = Some(Lopend { poort, bron: "startvlag", stop: None });
}

fn status() -> Value {
    let lopend = LOPEND.lock().unwrap();
    let fout = LAATSTE_FOUT.lock().unwrap().clone();
    match &*lopend {
        Some(l) => json!({ "actief": true, "poort": l.poort, "bron": l.bron, "fout": null }),
        None => json!({ "actief": false, "poort": null, "bron": null, "fout": fout }),
    }
}

fn stop_instelling() {
    let mut lopend = LOPEND.lock().unwrap();
    if lopend.as_ref().map_or(false, |l| l.bron == "instelling") {
        if let Some(tx) = lopend.take().and_then(|l| l.stop) {
            let _ = tx.send(());
        }
    }
}

/// `{ actief, poort, bron: "instelling" | "startvlag" | null, fout }`
#[tauri::command]
pub fn mcp_status() -> Value {
    status()
}

/// Zet de server aan of uit volgens de instelling. Een bezette poort komt als
/// `fout` in de status terug in plaats van als uitzondering, zodat het
/// voorkeurenvenster hem kan tonen.
#[tauri::command]
pub async fn mcp_instellen(app: AppHandle, aan: bool, poort: u16) -> Result<Value, String> {
    if LOPEND.lock().unwrap().as_ref().map_or(false, |l| l.bron == "startvlag") {
        return Ok(status());
    }
    let zelfde_poort = LOPEND.lock().unwrap().as_ref().map_or(false, |l| l.poort == poort);
    if aan && zelfde_poort {
        return Ok(status());
    }
    stop_instelling();
    *LAATSTE_FOUT.lock().unwrap() = None;
    if !aan {
        return Ok(status());
    }

    let adres = format!("127.0.0.1:{poort}");
    let listener = match tokio::net::TcpListener::bind(&adres).await {
        Ok(l) => l,
        Err(e) => {
            *LAATSTE_FOUT.lock().unwrap() = Some(format!("{adres}: {e}"));
            return Ok(status());
        }
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    *LOPEND.lock().unwrap() = Some(Lopend { poort, bron: "instelling", stop: Some(tx) });
    let state = AppState::nieuw(Profiel::Publiek, poort, Some(app));
    tauri::async_runtime::spawn(async move {
        if let Err(e) = mcp_server::serveer(listener, state, Some(rx)).await {
            eprintln!("[mcp] {e}");
        }
    });
    eprintln!("MCP server (instelling) listening on http://{adres}/mcp");
    Ok(status())
}
