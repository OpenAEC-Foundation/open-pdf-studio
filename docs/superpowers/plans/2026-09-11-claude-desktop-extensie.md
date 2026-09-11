# Claude Desktop-extensie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open PDF Studio installeerbaar maken als Claude Desktop-extensie (`.mcpb`) die voldoet aan de eisen van de extensiebibliotheek (#253).

**Architecture:** De app krijgt een instelling die de bestaande MCP-server tijdens het draaien aan/uit zet in een *publiek* profiel (zonder ontwikkelgereedschap, met annotaties op elk gereedschap, Origin/Host-controle). De bestaande stdio-brug krijgt een terugval zodat Claude Desktop ook zonder draaiende app gereedschap ziet. `mcpb/` pakt brug, gereedschapslijst, manifest, icoon en README in tot een `.mcpb` die de release-workflow aan elke release hangt.

**Tech Stack:** Rust (axum 0.8, tokio, tauri 2), SolidJS, Node ≥ 18 (`node --test`), `@anthropic-ai/mcpb` CLI.

Spec: `docs/superpowers/specs/2026-09-11-claude-desktop-extensie-design.md`.

## Global Constraints

- MCP-server bindt alleen op `127.0.0.1`.
- Instelling `preferences.mcpEnabled` standaard `false`; `preferences.mcpPort` standaard `9223`.
- Ontwikkelroute (startvlag + `OPS_ENABLE_MCP=1` of debug-build) houdt alle 62 gereedschappen; publiek profiel = 49.
- Elk gereedschap in `tools/list` draagt `annotations.title`, `readOnlyHint`, `destructiveHint`, `openWorldHint: false`.
- Manifest: `manifest_version: "0.3"`, versie = app-versie, `privacy_policies` met HTTPS-URL.
- Nieuwe vertaalsleutels in alle 39 talen.
- Geen namen van concurrerende commerciële software in repo-inhoud; commentaar in het Nederlands zoals de omliggende code.
- Na JS-wijzigingen: `npx vite build` als syntaxcontrole (niet alleen `node --check`).

## File Structure

| Bestand | Verantwoordelijkheid |
|---|---|
| `open-pdf-studio/src-tauri/src/mcp_tool_meta.rs` (nieuw) | Tabel per gereedschap: titel, lees/wijzig, profiel |
| `open-pdf-studio/src-tauri/src/mcp_server.rs` | `tools_list_voor(profiel)`, profielcontrole bij `tools/call`, Origin/Host-controle, starten met stopsignaal |
| `open-pdf-studio/src-tauri/src/mcp_koppeling.rs` (nieuw) | Tauri-commando's `mcp_instellen`, `mcp_status`; bijhouden wat draait |
| `open-pdf-studio/src-tauri/src/lib.rs` | modules + commando's registreren; startvlag-route markeren |
| `open-pdf-studio/js/core/mcp-koppeling.js` (nieuw) | instelling toepassen / status opvragen |
| `open-pdf-studio/js/core/constants.ts` | standaardwaarden `mcpEnabled`, `mcpPort` |
| `open-pdf-studio/js/solid/components/preferences/GeneralTab.jsx` | groep AI-koppeling |
| `open-pdf-studio/js/solid/components/preferences/PreferencesDialog.jsx` | na Opslaan toepassen |
| `open-pdf-studio/js/main.js` | bij opstarten toepassen |
| `open-pdf-studio/js/i18n/locales/*/preferences.json` | 8 sleutels × 39 talen |
| `mcp-stdio/brug.mjs` (nieuw) | brug-logica, testbaar |
| `mcp-stdio/server.mjs` | dunne stdio-schil rond `brug.mjs` |
| `mcp-stdio/tools.json` (nieuw, gegenereerd) | publieke `tools/list` voor de terugval |
| `mcp-stdio/brug.test.mjs` (nieuw) | tests brug |
| `mcpb/manifest.json`, `mcpb/README.md`, `mcpb/icon.png`, `mcpb/INDIENEN.md` (nieuw) | de bundel en het indiendossier |
| `mcpb/scripts/pack.mjs`, `mcpb/manifest.test.mjs` (nieuw) | inpakken en bewaken |
| `scripts/bump-version.js` | ook `mcpb/manifest.json` |
| `.github/workflows/release.yml` | job `mcpb` |

---

### Task 1: Annotaties en profielen per gereedschap

**Files:**
- Create: `open-pdf-studio/src-tauri/src/mcp_tool_meta.rs`
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs` (nieuwe `tools_list_voor`, tests)
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (`pub mod mcp_tool_meta;`)
- Create (gegenereerd door test): `mcp-stdio/tools.json`

**Interfaces:**
- Produces: `mcp_tool_meta::{Profiel, ToolMeta, TOOLS, meta(naam) -> Option<&'static ToolMeta>, beschikbaar(naam, Profiel) -> bool}`; `mcp_server::tools_list_voor(Profiel) -> Value`.

- [ ] **Step 1: Tabel schrijven** — `mcp_tool_meta.rs`:

```rust
//! Per MCP-gereedschap: titel, of het alleen leest of iets wijzigt, en in welk
//! profiel het beschikbaar is. De extensiebibliotheek van Claude eist op elk
//! gereedschap een titel en een lees- of wijzighint; het publieke profiel laat
//! ontwikkelgereedschap weg.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profiel {
    /// Aangezet via de instelling in de app — voor gewone gebruikers.
    Publiek,
    /// Startvlag + OPS_ENABLE_MCP=1 of een debug-build — alles, voor de testrig.
    Ontwikkeling,
}

pub struct ToolMeta {
    pub naam: &'static str,
    pub titel: &'static str,
    pub alleen_lezen: bool,
    pub wijzigt: bool,
    pub alleen_ontwikkeling: bool,
}

const fn lees(naam: &'static str, titel: &'static str) -> ToolMeta {
    ToolMeta { naam, titel, alleen_lezen: true, wijzigt: false, alleen_ontwikkeling: false }
}
const fn voegt_toe(naam: &'static str, titel: &'static str) -> ToolMeta {
    ToolMeta { naam, titel, alleen_lezen: false, wijzigt: false, alleen_ontwikkeling: false }
}
const fn wijzigt(naam: &'static str, titel: &'static str) -> ToolMeta {
    ToolMeta { naam, titel, alleen_lezen: false, wijzigt: true, alleen_ontwikkeling: false }
}
const fn ontwikkel(naam: &'static str, titel: &'static str, alleen_lezen: bool) -> ToolMeta {
    ToolMeta { naam, titel, alleen_lezen, wijzigt: !alleen_lezen, alleen_ontwikkeling: true }
}

pub const TOOLS: &[ToolMeta] = &[
    // Openen, weergave en navigatie — wijzigen geen gegevens.
    lees("app_open_pdf", "Open PDF"),
    lees("app_set_zoom", "Set zoom"),
    lees("app_zoom_in", "Zoom in"),
    lees("app_zoom_out", "Zoom out"),
    lees("app_go_to_page", "Go to page"),
    lees("app_set_view_mode", "Set view mode"),
    lees("app_fit_page", "Fit page"),
    lees("app_fit_width", "Fit width"),
    lees("app_switch_tab", "Switch document tab"),
    lees("app_set_tool", "Select tool"),
    lees("app_select_annotation", "Select annotation"),
    lees("app_clear_selection", "Clear selection"),
    // Opvragen.
    lees("app_screenshot_view", "Capture page view"),
    lees("app_get_viewport_state", "Get view state"),
    lees("app_get_current_tool", "Get current tool"),
    lees("app_list_annotations", "List annotations"),
    lees("app_get_annotation", "Get annotation"),
    lees("app_list_tabs", "List document tabs"),
    lees("app_get_page_count", "Get page count"),
    lees("app_get_takeoff", "Get quantity take-off"),
    lees("app_list_commands", "List app commands"),
    lees("app_assistant_history", "Get assistant conversation"),
    // Voegt iets toe zonder bestaande gegevens te wijzigen.
    voegt_toe("app_new_blank_pdf", "New blank PDF"),
    voegt_toe("app_create_annotation", "Create annotation"),
    voegt_toe("app_snippet_cut", "Cut vector snippet"),
    voegt_toe("app_snippet_paste", "Paste vector snippet"),
    voegt_toe("app_place_schedule", "Place quantity schedule"),
    voegt_toe("app_merge_pdf", "Merge PDF files"),
    voegt_toe("app_symbol_scale", "Symbol placement scale"),
    voegt_toe("app_assistant_ask", "Ask assistant"),
    voegt_toe("app_assistant_pending", "Take pending assistant question"),
    voegt_toe("app_assistant_answer", "Answer assistant question"),
    voegt_toe("app_mouse_move", "Move pointer"),
    voegt_toe("app_scroll", "Scroll"),
    // Wijzigt of verwijdert bestaande inhoud, of schrijft een bestand.
    wijzigt("app_update_annotation", "Update annotation"),
    wijzigt("app_delete_annotation", "Delete annotation"),
    wijzigt("app_undo", "Undo"),
    wijzigt("app_redo", "Redo"),
    wijzigt("app_close_tab", "Close document tab"),
    wijzigt("app_save_pdf", "Save PDF"),
    wijzigt("app_set_measure_scale", "Set measurement scale"),
    wijzigt("app_snippet_flatten", "Flatten vector snippet"),
    wijzigt("app_titleblock", "Fill title block"),
    wijzigt("app_run_command", "Run app command"),
    wijzigt("app_click_element", "Click interface element"),
    wijzigt("app_mouse_click", "Click"),
    wijzigt("app_mouse_drag", "Drag"),
    wijzigt("app_key", "Press key"),
    wijzigt("app_type", "Type text"),
    // Alleen in de ontwikkelroute.
    ontwikkel("app_get_recent_console", "Read app console", true),
    ontwikkel("app_zoom_anchor_test", "Zoom anchor test", true),
    ontwikkel("app_clear_caches", "Clear render caches", false),
    ontwikkel("app_wheel_zoom", "Wheel zoom", false),
    ontwikkel("app_ui_state", "Inspect interface element", true),
    ontwikkel("app_set_window_size", "Set window size", false),
    ontwikkel("list_test_pdfs", "List test PDFs", true),
    ontwikkel("screenshot_page", "Render test page", true),
    ontwikkel("screenshot_all", "Render all test pages", true),
    ontwikkel("get_pdf_metadata", "Read test PDF metadata", true),
    ontwikkel("app_ai_complete", "Ask OpenAEC AI", false),
    ontwikkel("app_accounts_status", "OpenAEC sign-in state", true),
    ontwikkel("app_accounts_fetch", "OpenAEC account API call", false),
];

pub fn meta(naam: &str) -> Option<&'static ToolMeta> {
    TOOLS.iter().find(|t| t.naam == naam)
}

/// Mag dit gereedschap in dit profiel worden aangeboden en aangeroepen?
/// Onbekende namen alleen in de ontwikkelroute (daar zijn ze nieuw en nog niet
/// ingedeeld — de test hieronder vangt dat).
pub fn beschikbaar(naam: &str, profiel: Profiel) -> bool {
    match (meta(naam), profiel) {
        (_, Profiel::Ontwikkeling) => true,
        (Some(m), Profiel::Publiek) => !m.alleen_ontwikkeling,
        (None, Profiel::Publiek) => false,
    }
}
```

- [ ] **Step 2: Falende tests schrijven** in `mcp_server.rs` `mod tests`:

```rust
    #[test]
    fn elk_gereedschap_staat_in_de_metatabel_en_omgekeerd() {
        let v = handle_tools_list();
        let namen: Vec<String> = v["tools"].as_array().unwrap().iter()
            .map(|t| t["name"].as_str().unwrap().to_string()).collect();
        for n in &namen {
            assert!(crate::mcp_tool_meta::meta(n).is_some(), "{n} ontbreekt in mcp_tool_meta.rs");
        }
        for m in crate::mcp_tool_meta::TOOLS {
            assert!(namen.iter().any(|n| n == m.naam), "{} staat in de tabel maar bestaat niet", m.naam);
        }
    }

    #[test]
    fn publiek_profiel_laat_ontwikkelgereedschap_weg_en_annoteert_alles() {
        use crate::mcp_tool_meta::Profiel;
        let publiek = tools_list_voor(Profiel::Publiek);
        let arr = publiek["tools"].as_array().unwrap();
        assert_eq!(arr.len(), 49);
        for t in arr {
            let a = &t["annotations"];
            assert!(a["title"].as_str().map_or(false, |s| !s.is_empty()), "{} zonder titel", t["name"]);
            assert!(a["readOnlyHint"].is_boolean() && a["destructiveHint"].is_boolean(), "{} zonder hints", t["name"]);
            assert_eq!(a["openWorldHint"], false);
        }
        for dev in ["app_get_recent_console", "list_test_pdfs", "app_accounts_fetch"] {
            assert!(!arr.iter().any(|t| t["name"] == dev), "{dev} hoort niet in het publieke profiel");
        }
        let alles = tools_list_voor(Profiel::Ontwikkeling);
        assert_eq!(alles["tools"].as_array().unwrap().len(), handle_tools_list()["tools"].as_array().unwrap().len());
    }

    #[test]
    fn tools_json_van_de_brug_is_actueel() {
        use crate::mcp_tool_meta::Profiel;
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("mcp-stdio").join("tools.json");
        let verwacht = tools_list_voor(Profiel::Publiek)["tools"].clone();
        if std::env::var("OPDS_MCPB_TOOLS_SCHRIJVEN").as_deref() == Ok("1") {
            std::fs::write(&pad, serde_json::to_string_pretty(&verwacht).unwrap() + "\n").unwrap();
        }
        let op_schijf: Value = serde_json::from_str(&std::fs::read_to_string(&pad)
            .expect("mcp-stdio/tools.json ontbreekt — draai met OPDS_MCPB_TOOLS_SCHRIJVEN=1")).unwrap();
        assert_eq!(op_schijf, verwacht, "mcp-stdio/tools.json loopt achter — draai met OPDS_MCPB_TOOLS_SCHRIJVEN=1");
    }
```

- [ ] **Step 3:** `cd open-pdf-studio/src-tauri && cargo test --lib mcp_server::tests` → FAIL (`tools_list_voor` bestaat niet).

- [ ] **Step 4: Implementeren** in `mcp_server.rs` (na `handle_tools_list`):

```rust
/// De `tools/list` voor een profiel: gefilterd en met annotaties.
pub fn tools_list_voor(profiel: Profiel) -> Value {
    let mut v = handle_tools_list();
    if let Some(tools) = v["tools"].as_array_mut() {
        tools.retain(|t| t["name"].as_str().map_or(false, |n| beschikbaar(n, profiel)));
        for t in tools.iter_mut() {
            if let Some(m) = t["name"].as_str().and_then(meta) {
                t["annotations"] = json!({
                    "title": m.titel,
                    "readOnlyHint": m.alleen_lezen,
                    "destructiveHint": m.wijzigt,
                    "openWorldHint": false,
                });
            }
        }
    }
    v
}
```

met `use crate::mcp_tool_meta::{beschikbaar, meta, Profiel};` bovenaan, en `pub mod mcp_tool_meta;` in `lib.rs`.

- [ ] **Step 5:** `OPDS_MCPB_TOOLS_SCHRIJVEN=1 cargo test --lib mcp_server::tests` → PASS; daarna zonder env → PASS. `mcp-stdio/tools.json` bevat 49 gereedschappen.

- [ ] **Step 6: Commit** — `feat(mcp): annotaties en een publiek profiel voor elk gereedschap`.

### Task 2: Aan/uit tijdens het draaien, profiel en Origin/Host-controle

**Files:**
- Create: `open-pdf-studio/src-tauri/src/mcp_koppeling.rs`
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs` (`AppState`, `mcp_handler`, `start`, nieuwe `start_met`)
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (module, commando's, startvlag-route)

**Interfaces:**
- Consumes: `tools_list_voor`, `beschikbaar`, `Profiel` (Task 1).
- Produces: Tauri-commando's `mcp_instellen(aan: bool, poort: u16) -> Result<Value, String>` en `mcp_status() -> Value`, beide met `{ actief: bool, poort: u16|null, bron: "instelling"|"startvlag"|null, fout: string|null }`.

- [ ] **Step 1: Falende test** voor de verzoekcontrole in `mcp_server.rs`:

```rust
    #[test]
    fn alleen_lokale_verzoeken_worden_toegelaten() {
        use axum::http::{HeaderMap, HeaderValue};
        let kop = |paren: &[(&'static str, &'static str)]| {
            let mut h = HeaderMap::new();
            for (k, v) in paren { h.insert(*k, HeaderValue::from_static(v)); }
            h
        };
        assert!(verzoek_toegestaan(&kop(&[("host", "127.0.0.1:9223")]), 9223));
        assert!(verzoek_toegestaan(&kop(&[("host", "localhost:9223")]), 9223));
        assert!(verzoek_toegestaan(&kop(&[]), 9223));
        assert!(verzoek_toegestaan(&kop(&[("host", "127.0.0.1:9223"), ("origin", "http://localhost:6274")]), 9223));
        assert!(!verzoek_toegestaan(&kop(&[("host", "evil.example:9223")]), 9223), "DNS-rebinding");
        assert!(!verzoek_toegestaan(&kop(&[("host", "127.0.0.1:9223"), ("origin", "https://evil.example")]), 9223), "website");
        assert!(!verzoek_toegestaan(&kop(&[("host", "127.0.0.1:9999")]), 9223));
    }
```

- [ ] **Step 2:** `cargo test --lib alleen_lokale` → FAIL.

- [ ] **Step 3: Implementeren** in `mcp_server.rs`:

```rust
/// Alleen lokale clients: de Host moet 127.0.0.1/localhost op onze poort zijn
/// (tegen DNS-rebinding), en een eventuele Origin moet lokaal zijn (tegen een
/// website die via de browser de app probeert te besturen).
pub fn verzoek_toegestaan(headers: &axum::http::HeaderMap, poort: u16) -> bool {
    let lokaal = |host: &str| {
        let host = host.trim().to_ascii_lowercase();
        host == format!("127.0.0.1:{poort}") || host == format!("localhost:{poort}")
    };
    if let Some(h) = headers.get("host").and_then(|v| v.to_str().ok()) {
        if !lokaal(h) { return false; }
    }
    if let Some(o) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let o = o.trim().to_ascii_lowercase();
        let zonder_schema = o.split("://").nth(1).unwrap_or("");
        let host = zonder_schema.split(['/', ':']).next().unwrap_or("");
        if host != "127.0.0.1" && host != "localhost" { return false; }
    }
    true
}
```

`AppState` krijgt `pub profiel: Profiel, pub poort: u16`. `mcp_handler` krijgt `headers: axum::http::HeaderMap` (tussen `State` en `Json`), weigert met `StatusCode::FORBIDDEN` + `rpc_error(id, INVALID_REQUEST, "only local clients may use this server")` als `!verzoek_toegestaan`, gebruikt `tools_list_voor(state.profiel)`, en controleert bij `tools/call`:

```rust
        "tools/call" => {
            let empty = Value::Null;
            let params = body.get("params").unwrap_or(&empty);
            let naam = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if !beschikbaar(naam, state.profiel) {
                rpc_error(id, jsonrpc_error::INVALID_PARAMS,
                    format!("tool '{naam}' is not available in this Open PDF Studio configuration"))
            } else {
                match handle_tools_call(&state, params).await {
                    Ok(value) => rpc_result(id, value),
                    Err((code, msg)) => rpc_error(id, code, msg),
                }
            }
        }
```

`start` splitst: de bestaande `start(port, test_pdfs_dir, app_handle)` houdt de `OPS_ENABLE_MCP`-controle, bindt, meldt `mcp_koppeling::markeer_startvlag(port)` en roept `serveer(listener, state(Profiel::Ontwikkeling), None)`. Nieuw:

```rust
pub async fn serveer(
    listener: tokio::net::TcpListener,
    state: AppState,
    stop: Option<tokio::sync::oneshot::Receiver<()>>,
) -> Result<(), String> {
    let app = Router::new().route("/mcp", post(mcp_handler)).with_state(state);
    let serve = axum::serve(listener, app);
    match stop {
        Some(rx) => serve.with_graceful_shutdown(async { let _ = rx.await; }).await,
        None => serve.await,
    }
    .map_err(|e| format!("MCP server error: {e}"))
}
```

`mcp_koppeling.rs`:

```rust
//! De AI-koppeling (MCP-server) aan- en uitzetten vanuit de instelling in de
//! app. Draait de server al via de startvlag (ontwikkelroute), dan blijft die
//! staan en meldt de status dat.

use std::sync::Mutex;
use serde_json::{json, Value};
use tauri::AppHandle;
use crate::mcp_server::{self, AppState};
use crate::mcp_tool_meta::Profiel;

struct Lopend { poort: u16, bron: &'static str, stop: Option<tokio::sync::oneshot::Sender<()>> }

static LOPEND: Mutex<Option<Lopend>> = Mutex::new(None);
static LAATSTE_FOUT: Mutex<Option<String>> = Mutex::new(None);

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
        if let Some(tx) = lopend.take().and_then(|l| l.stop) { let _ = tx.send(()); }
    }
}

#[tauri::command]
pub fn mcp_status() -> Value { status() }

#[tauri::command]
pub async fn mcp_instellen(app: AppHandle, aan: bool, poort: u16) -> Result<Value, String> {
    if LOPEND.lock().unwrap().as_ref().map_or(false, |l| l.bron == "startvlag") {
        return Ok(status());
    }
    let zelfde = LOPEND.lock().unwrap().as_ref().map_or(false, |l| l.poort == poort);
    if aan && zelfde { return Ok(status()); }
    stop_instelling();
    *LAATSTE_FOUT.lock().unwrap() = None;
    if !aan { return Ok(status()); }

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
```

`AppState::nieuw(profiel, poort, app_handle)` vult `test_pdfs_dir` met `resolve_test_pdfs_dir(env OPS_TEST_PDFS_DIR)`. `lib.rs`: `pub mod mcp_koppeling;`, en `mcp_koppeling::mcp_instellen, mcp_koppeling::mcp_status` in `generate_handler!`.

- [ ] **Step 4:** `cargo test --lib` → alle MCP-tests PASS (bestaande tests roepen `handle_tools_list()` nog aan; die blijft ongewijzigd).

- [ ] **Step 5: Commit** — `feat(mcp): AI-koppeling aan en uit te zetten vanuit de app, alleen lokale clients`.

### Task 3: De instelling in de app

**Files:**
- Create: `open-pdf-studio/js/core/mcp-koppeling.js`
- Modify: `open-pdf-studio/js/core/constants.ts`, `js/solid/components/preferences/GeneralTab.jsx`, `PreferencesDialog.jsx`, `js/main.js`, 39 × `js/i18n/locales/<taal>/preferences.json`

**Interfaces:**
- Consumes: Tauri-commando's uit Task 2.
- Produces: `pasMcpInstellingToe(): Promise<Status|null>`, `mcpStatus(): Promise<Status|null>`; voorkeuren `mcpEnabled: boolean`, `mcpPort: number`; i18n-sleutels `general.aiLink`, `general.aiLinkAllow`, `general.aiLinkPort`, `general.aiLinkHint`, `general.aiLinkActive` (`{{adres}}`), `general.aiLinkViaFlag` (`{{adres}}`), `general.aiLinkOff`, `general.aiLinkError` (`{{fout}}`).

- [ ] **Step 1:** `mcp-koppeling.js`:

```js
// De AI-koppeling (MCP-server) volgens de instelling aan- of uitzetten.
import { state } from './state.js';
import { isTauri, invoke } from './platform.js';

export async function pasMcpInstellingToe() {
  if (!isTauri()) return null;
  try {
    return await invoke('mcp_instellen', {
      aan: !!state.preferences.mcpEnabled,
      poort: Number(state.preferences.mcpPort) || 9223,
    });
  } catch (e) {
    return { actief: false, poort: null, bron: null, fout: String(e?.message || e) };
  }
}

export async function mcpStatus() {
  if (!isTauri()) return null;
  try { return await invoke('mcp_status'); } catch { return null; }
}
```

- [ ] **Step 2:** `DEFAULT_PREFERENCES` + type: `mcpEnabled: false`, `mcpPort: 9223`.
- [ ] **Step 3:** GeneralTab: nieuwe `<fieldset>` met selectievakje (`p.mcpEnabled`), poortveld (`type="number" min="1024" max="65535"`, `p.mcpPort`), statusregel via `createSignal` gevuld door `mcpStatus()` bij openen, en `general.aiLinkHint` als uitleg. Statusregel: actief + bron `startvlag` → `aiLinkViaFlag`; actief → `aiLinkActive`; fout → `aiLinkError`; anders `aiLinkOff`.
- [ ] **Step 4:** PreferencesDialog `handleSave`: na `savePreferences()` → `import('../../../core/mcp-koppeling.js').then(m => m.pasMcpInstellingToe())`. `main.js` na `await loadPreferences();` (regel ~222): `import('./core/mcp-koppeling.js').then(m => m.pasMcpInstellingToe());`.
- [ ] **Step 5:** Vertalingen: 8 sleutels in `general` van elke `preferences.json` (39 talen) via een script met één tabel.
- [ ] **Step 6:** `npm run test:unit` en `npx vite build` → groen.
- [ ] **Step 7: Commit** — `feat(voorkeuren): AI-koppeling aanzetten in Instellingen`.

### Task 4: Terugval in de stdio-brug

**Files:**
- Create: `mcp-stdio/brug.mjs`, `mcp-stdio/brug.test.mjs`
- Modify: `mcp-stdio/server.mjs`, `open-pdf-studio/package.json` (`test:unit` + `../mcp-stdio/brug.test.mjs`)

**Interfaces:**
- Consumes: `mcp-stdio/tools.json` (Task 1).
- Produces: `maakBrug({ endpoint, tools, versie, fetchFn }) -> (regel: string) => Promise<string|null>`; `NIET_BEREIKBAAR` (tekst).

- [ ] **Step 1: Falende tests** (`brug.test.mjs`):

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { maakBrug, NIET_BEREIKBAAR } from './brug.mjs';

const TOOLS = [{ name: 'app_list_tabs', description: 'x', inputSchema: { type: 'object' } }];
const plat = async () => { throw new Error('ECONNREFUSED'); };
const app = (antwoord) => async (_url, init) => ({ text: async () => antwoord(JSON.parse(init.body)) });
const vraag = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

test('draait de app, dan gaat alles door', async () => {
  const verwerk = maakBrug({ endpoint: 'http://127.0.0.1:9223/mcp', tools: TOOLS, versie: '1.0.0',
    fetchFn: app((m) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: ['live'] } })) });
  assert.deepEqual(JSON.parse(await verwerk(vraag(1, 'tools/list'))).result.tools, ['live']);
});

test('zonder app: initialize wordt lokaal beantwoord', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1.99.0', fetchFn: plat });
  const r = JSON.parse(await verwerk(vraag(1, 'initialize', { protocolVersion: '2025-06-18' })));
  assert.equal(r.result.serverInfo.name, 'open-pdf-studio');
  assert.equal(r.result.serverInfo.version, '1.99.0');
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.ok(r.result.capabilities.tools);
});

test('zonder app: tools/list komt uit de meegeleverde lijst', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  assert.deepEqual(JSON.parse(await verwerk(vraag(2, 'tools/list'))).result.tools, TOOLS);
});

test('zonder app: een aanroep zegt wat de gebruiker moet doen', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  const r = JSON.parse(await verwerk(vraag(3, 'tools/call', { name: 'app_list_tabs', arguments: {} })));
  assert.equal(r.result.isError, true);
  assert.equal(r.result.content[0].text, NIET_BEREIKBAAR);
});

test('notificaties krijgen geen antwoord, ping wel', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  assert.equal(await verwerk(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null);
  assert.deepEqual(JSON.parse(await verwerk(vraag(4, 'ping'))).result, {});
});

test('ongeldige invoer wordt genegeerd', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  assert.equal(await verwerk('geen json'), null);
  assert.equal(await verwerk('   '), null);
});
```

- [ ] **Step 2:** `node --test mcp-stdio/brug.test.mjs` → FAIL (module ontbreekt).
- [ ] **Step 3: `brug.mjs`:**

```js
// Logica van de stdio-brug, los van stdin/stdout zodat hij te testen is.
// Draait de app niet, dan antwoordt de brug zelf: initialize en tools/list
// uit de meegeleverde lijst, en een aanroep met een duidelijke instructie.

export const NIET_BEREIKBAAR =
  'Open PDF Studio is not reachable. Start Open PDF Studio and turn on ' +
  'Settings > General > AI link (MCP). The port there must match the port ' +
  'in this extension\'s settings (default 9223).';

const isNotificatie = (m) => m && typeof m === 'object' && !Array.isArray(m) && !('id' in m);
const antwoord = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result });
const fout = (id, code, message) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

export function maakBrug({ endpoint, tools, versie, fetchFn = fetch }) {
  async function stuurDoor(body) {
    const res = await fetchFn(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    return res.text();
  }

  function terugval(msg) {
    const id = msg.id ?? null;
    switch (msg.method) {
      case 'initialize':
        return antwoord(id, {
          protocolVersion: msg.params?.protocolVersion || '2025-03-26',
          serverInfo: { name: 'open-pdf-studio', version: versie },
          capabilities: { tools: { listChanged: false } },
        });
      case 'tools/list':
        return antwoord(id, { tools });
      case 'tools/call':
        return antwoord(id, { content: [{ type: 'text', text: NIET_BEREIKBAAR }], isError: true });
      default:
        return fout(id, -32001, NIET_BEREIKBAAR);
    }
  }

  return async function verwerk(regel) {
    const tekst = String(regel ?? '').trim();
    if (!tekst) return null;
    let msg;
    try { msg = JSON.parse(tekst); } catch { return null; }

    if (!Array.isArray(msg) && msg.method === 'ping' && 'id' in msg) return antwoord(msg.id, {});

    let uit;
    try {
      uit = await stuurDoor(tekst);
    } catch {
      if (isNotificatie(msg)) return null;
      return Array.isArray(msg) ? fout(null, -32001, NIET_BEREIKBAAR) : terugval(msg);
    }
    if (isNotificatie(msg)) return null;
    const schoon = (uit || '').trim();
    if (schoon) return schoon;
    return fout(Array.isArray(msg) ? null : (msg.id ?? null), -32002, `Empty response from ${endpoint}`);
  };
}
```

- [ ] **Step 4:** `server.mjs` herschrijven tot schil: leest `tools.json` (naast zichzelf, `new URL('./tools.json', import.meta.url)`; ontbreekt hij → `[]`), versie uit env `OPS_MCP_VERSION` of `package.json` naast zichzelf, `maakBrug(...)`, `readline` → `verwerk` → `process.stdout.write(uit + "\n")`. `--probe` blijft.
- [ ] **Step 5:** tests PASS; `test:unit` uitgebreid met `../mcp-stdio/brug.test.mjs`; `npm run test:unit` groen.
- [ ] **Step 6: Commit** — `feat(mcp-stdio): brug antwoordt zelf als de app niet draait`.

### Task 5: De bundel `mcpb/`

**Files:**
- Create: `mcpb/manifest.json`, `mcpb/README.md`, `mcpb/icon.png`, `mcpb/scripts/pack.mjs`, `mcpb/manifest.test.mjs`, `mcpb/.gitignore`
- Modify: `scripts/bump-version.js`, `open-pdf-studio/package.json` (`test:unit` + `../mcpb/manifest.test.mjs`)

**Interfaces:**
- Consumes: `mcp-stdio/server.mjs`, `brug.mjs`, `tools.json`.
- Produces: `node mcpb/scripts/pack.mjs` → `mcpb/dist/open-pdf-studio.mcpb`; `node mcpb/scripts/pack.mjs --manifest` werkt alleen `mcpb/manifest.json` bij.

- [ ] **Step 1: Falende test** (`manifest.test.mjs`): manifest heeft `manifest_version "0.3"`, versie = `open-pdf-studio/package.json`, `tools` = namen+beschrijvingen uit `mcp-stdio/tools.json`, `privacy_policies` niet leeg en HTTPS, `server.entry_point` = `server/index.mjs`, `user_config.port.default` = 9223.
- [ ] **Step 2:** `manifest.json` (tools-lijst gevuld door `pack.mjs --manifest`), `README.md` (installatie, instelling, drie voorbeelden, Privacy Policy), `icon.png` (256×256 uit `src-tauri/icons/128x128@2x.png`).
- [ ] **Step 3:** `pack.mjs`: `build/` leegmaken → manifest (met actuele versie/tools), `icon.png`, `README.md`, `server/index.mjs` (= `mcp-stdio/server.mjs`), `server/brug.mjs`, `server/tools.json`, `server/package.json` (`{"type":"module","version":…}`) → `npx -y @anthropic-ai/mcpb validate build/manifest.json` → `npx -y @anthropic-ai/mcpb pack build dist/open-pdf-studio.mcpb`.
- [ ] **Step 4:** `bump-version.js` werkt ook `mcpb/manifest.json` bij.
- [ ] **Step 5:** tests groen, `node mcpb/scripts/pack.mjs` levert een `.mcpb`.
- [ ] **Step 6: Commit** — `feat(mcpb): Claude Desktop-extensie als MCP-bundel`.

### Task 6: Uitlevering en indiendossier

**Files:**
- Modify: `.github/workflows/release.yml` (job `mcpb`)
- Create: `mcpb/INDIENEN.md`

- [ ] **Step 1:** Job `mcpb` (needs `create-release`, ubuntu, node 22): `node mcpb/scripts/pack.mjs` → `gh release upload "$VERSION" mcpb/dist/open-pdf-studio.mcpb --clobber`.
- [ ] **Step 2:** `INDIENEN.md`: alle antwoorden voor het indienformulier (naam, tagline ≤ 55 tekens, beschrijving, categorieën, use cases, testinstructies, privacy- en documentatie-URL, contact).
- [ ] **Step 3:** Bericht aan de website-sessie: privacybeleid- en documentatiepagina met de teksten uit README/INDIENEN.
- [ ] **Step 4: Commit** — `ci(release): Claude Desktop-extensie aan elke release hangen`.

### Task 7: Live verificatie

- [ ] Release-build met `CARGO_TARGET_DIR=C:/opds-cargo-target npm run tauri:build`.
- [ ] Rig zonder startvlag starten; via CDP/JS `invoke('mcp_instellen', {aan:true, poort:9225})` → `tools/list` op 9225 geeft 49 tools met annotaties; `list_test_pdfs` aanroepen → fout; verzoek met `Origin: https://evil.example` → 403; uitzetten → poort dicht; poort bezet → fout in status.
- [ ] Brug tegen de rig: `node mcp-stdio/server.mjs` met `OPS_MCP_PORT=9225`, `tools/list` en een `tools/call`; zonder app: terugval.
- [ ] `node mcpb/scripts/pack.mjs` → validate + pack slagen.
- [ ] Voorkeuren van de gebruiker vergelijken met de back-up (de rig deelt `preferences.json`).
