//! In-process MCP server. Started by `--mcp-server` CLI flag and used by the
//! render-regression-test harness to drive the renderer over JSON-RPC. Refuses
//! to start in release builds unless the `OPS_ENABLE_MCP=1` environment
//! variable is set, so production users can never accidentally expose the
//! server.
//!
//! ## Why hand-rolled instead of `rmcp`?
//!
//! The plan originally targeted `rmcp = "0.7"` with a `transport-streamable-
//! http-server` feature. The published `rmcp` crate has shifted to a
//! macro-driven `tool_router` / `tool_handler` design (1.x) that requires
//! `schemars` and a particular ToolRouter wiring pattern, and the public
//! types/feature-flags have moved between minor versions. Since this scaffold
//! only needs three JSON-RPC methods (`initialize`, `tools/list`,
//! `tools/call`), we use plain `axum` + `serde_json` and dispatch on the
//! method string. Tool-handler logic added in tasks 6-9 plugs into the
//! existing `tools/call` match arm.
//!
//! ## Wire protocol
//!
//! POST `/mcp` with a JSON-RPC 2.0 request body. Responses are JSON-RPC 2.0
//! response objects (no SSE streaming — clients that need streaming should
//! poll, but the harness uses request/response only).
//!
//! ## Test corpus directory
//!
//! `test_pdfs_dir` is captured at server-start time and stashed in the
//! `AppState` so future tool handlers (Task 6: `list_test_pdfs`) can resolve
//! relative paths without touching the process CWD again.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::mcp_app_bridge::{self, McpAppBridge};
use crate::mcp_tool_meta::{beschikbaar, meta, Profiel};

/// Per-server state. Cloned (cheaply, via Arc) into every request handler.
///
/// `app_handle` is `Some` whenever the MCP server is launched from inside
/// `tauri::Builder::setup()` (the normal `--mcp-server` path). It is `None`
/// for unit tests that drive the handlers directly without a running Tauri
/// instance — in that case the `app_*` tools return an "app not available"
/// error instead of panicking.
#[derive(Clone)]
pub struct AppState {
    pub test_pdfs_dir: Arc<PathBuf>,
    pub app_handle: Option<AppHandle>,
    /// Welke gereedschappen deze server aanbiedt — zie mcp_tool_meta.rs.
    pub profiel: Profiel,
    /// De poort waarop we luisteren; de Host-kop moet daarbij passen.
    pub poort: u16,
}

impl AppState {
    pub fn nieuw(profiel: Profiel, poort: u16, app_handle: Option<AppHandle>) -> Self {
        AppState {
            test_pdfs_dir: Arc::new(resolve_test_pdfs_dir(
                std::env::var_os("OPS_TEST_PDFS_DIR").map(PathBuf::from),
            )),
            app_handle,
            profiel,
            poort,
        }
    }
}

/// Resolve the corpus independently of the process working directory.
/// CI can point at a small committed fixture set; local runs default to the
/// repository corpus next to the workspace root.
pub fn resolve_test_pdfs_dir(override_dir: Option<PathBuf>) -> PathBuf {
    override_dir.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("test pdf-bestanden")
            .join("Originele bestanden")
    })
}

/// Standard JSON-RPC error codes used by this server. Codes not yet
/// dispatched in handler bodies are kept available for tool handlers added
/// in tasks 7-9.
#[allow(dead_code)]
mod jsonrpc_error {
    pub const PARSE_ERROR: i32 = -32700;
    pub const INVALID_REQUEST: i32 = -32600;
    pub const METHOD_NOT_FOUND: i32 = -32601;
    pub const INVALID_PARAMS: i32 = -32602;
    pub const INTERNAL_ERROR: i32 = -32603;
}

/// Build a JSON-RPC 2.0 success response.
fn rpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

/// Build a JSON-RPC 2.0 error response.
fn rpc_error(id: Value, code: i32, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into(),
        },
    })
}

/// Handle the MCP `initialize` method. Identifies the server and advertises
/// the `tools` capability (the actual list will populate as tasks 6-9 land).
fn handle_initialize() -> Value {
    json!({
        "protocolVersion": "2025-03-26",
        "serverInfo": {
            "name": "open-pdf-studio",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": {
            "tools": {
                "listChanged": false
            }
        },
    })
}

/// Beschrijving van `app_import_cad` (#400). Een eigen functie: binnen de grote
/// lijst zou dit ene gereedschap de uitvouwdiepte van `json!` overschrijden.
fn import_cad_tool() -> Value {
    json!(
        {
            "name": "app_import_cad",
            "description": "Import a DWG or DXF drawing as a vector PDF page, without opening the import dialog. Choose the space (model space or a layout), the scale, the paper size, the layers and what happens with the result: a new document, a new page after the current one, or an underlay on the current page. Settings that are left out take the value the import dialog remembered, otherwise its default. Returns the pages that were made, warnings about anything that could not be converted and the names of external files. Fails while the import dialog is open.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path":               { "type": "string", "description": "Absolute path of the .dwg or .dxf file." },
                    "space":              { "type": "string", "description": "\"model\" or the name of a layout (default: what the file suggests)." },
                    "target":             { "type": "string", "enum": ["new", "append", "underlay"], "description": "new = a new document (default), append = a new page after the current page, underlay = on the current page. append without an open document becomes new." },
                    "opacity":            { "type": "number", "description": "Opacity of an underlay, 0.05 to 1 (default 0.5). Only with target underlay." },
                    "scale":              { "type": "number", "description": "Denominator N of 1:N. 0 fits the drawing on the paper." },
                    "area":               { "type": "string", "enum": ["extents", "limits"], "description": "What part of the model space is converted." },
                    "window":             { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4, "description": "Convert only this window: [x0, y0, x1, y1] in drawing units. Excludes area." },
                    "paper":              { "type": "string", "enum": ["auto", "A4", "A3", "A3L", "A2", "A2L", "A1", "A1L", "A0", "Letter", "Tabloid", "custom"], "description": "Paper size. A layout keeps its own paper unless this is given." },
                    "paperWidthMm":       { "type": "number", "description": "Width in mm for paper custom." },
                    "paperHeightMm":      { "type": "number", "description": "Height in mm for paper custom." },
                    "orientation":        { "type": "string", "enum": ["auto", "portrait", "landscape"] },
                    "marginMm":           { "type": "number", "description": "Margin around the drawing in mm, 0 to 200." },
                    "placement":          { "type": "string", "enum": ["center", "lower_left", "origin"] },
                    "rotation":           { "type": "number", "description": "Rotate the drawing before placing it, in degrees." },
                    "units":              { "type": "string", "enum": ["file", "mm", "cm", "m", "in", "ft"], "description": "Drawing unit; file = the unit in the file." },
                    "layersOff":          { "type": "array", "items": { "type": "string" }, "description": "Layer names to leave out, on top of the layers the file switches off." },
                    "layersOn":           { "type": "array", "items": { "type": "string" }, "description": "Layer names to include although the file switches them off." },
                    "layersAsOcg":        { "type": "boolean", "description": "Keep the layers as PDF layers." },
                    "includeOffLayers":   { "type": "boolean", "description": "Include switched-off layers as hidden PDF layers instead of leaving them out." },
                    "colors":             { "type": "string", "enum": ["file", "black", "gray", "mono", "single"], "description": "Colour mode." },
                    "monoThreshold":      { "type": "number", "description": "Brightness threshold in percent for colors mono, 0 to 100." },
                    "singleColor":        { "type": "string", "description": "Colour #RRGGBB for colors single." },
                    "lineweight":         { "type": "string", "enum": ["file", "fixed", "pens"], "description": "Line weights from the file, one fixed weight, or the colour table in pens." },
                    "lineweightMm":       { "type": "number", "description": "Line weight in mm for lineweight fixed." },
                    "pens":               { "type": "array", "items": { "type": "object" }, "description": "Colour table for lineweight pens: [{ \"color\": \"#RRGGBB\", \"lineweightMm\": 0.35 }]." },
                    "fonts":              { "type": "array", "items": { "type": "object" }, "description": "Font replacements: [{ \"from\": \"name in the drawing\", \"family\": \"sans\" or \"mono\", \"bold\": false, \"italic\": false }]." },
                    "hatch":              { "type": "string", "enum": ["all", "solid_only", "outline", "none"] },
                    "text":               { "type": "boolean", "description": "Convert text." },
                    "xrefs":              { "type": "boolean", "description": "Load external references." },
                    "images":             { "type": "boolean", "description": "Embed images." },
                    "reuseBlocks":        { "type": "boolean", "description": "Store repeated blocks once in the PDF." },
                    "maxImageMegapixels": { "type": "number", "description": "Largest image that is embedded, in megapixels, 1 to 200." },
                    "searchPaths":        { "type": "array", "items": { "type": "string" }, "description": "Extra folders to look in for external references and images." }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        }
    )
}

/// Beschrijving van `app_export_cad` (#400): de tegenhanger van
/// `app_import_cad`, langs dezelfde weg als het exportvenster.
fn export_cad_tool() -> Value {
    json!(
        {
            "name": "app_export_cad",
            "description": "Export pages of the current document to DXF or DWG, without opening the export dialog. Reads the file on disk (save first); one page writes to `path`, several pages get `_p<page>` behind the name. Settings that are left out take the value the export dialog remembered, otherwise its default. Returns the files that were written with their object counts, warnings and, on a failure, a code (tooLarge, noModelSpace, modelSpaceAmbiguous, modelUnitsUnknown, failed). Fails while the export dialog is open.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path":        { "type": "string", "description": "Absolute path of the target file (.dxf or .dwg). Gives the format when format is left out." },
                    "pages":       { "type": "string", "description": "\"current\" (default), \"all\" or a range like \"1-3,5\"." },
                    "format":      { "type": "string", "enum": ["dxf", "dxf_binary", "dwg"], "description": "Output format; sets the extension of path." },
                    "origin":      { "type": "string", "enum": ["page", "area", "model"], "description": "Where (0,0) of the drawing is: the lower left of the page (default), of the area, or the original model coordinates of an imported page." },
                    "area":        { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4, "description": "Export only this window: [x0, y0, x1, y1] in page points with the origin at the top left, as annotations are positioned." },
                    "annotations": { "type": "boolean", "description": "Include the annotations on layers OPS_<type>." },
                    "scaleMode":   { "type": "string", "enum": ["paper", "measure", "custom"], "description": "paper = paper size, measure = the measure scale of the app at the area or page (default), custom = 1:scale." },
                    "scale":       { "type": "number", "description": "Denominator N of 1:N for scaleMode custom (implies it)." },
                    "layers":      { "type": "string", "enum": ["ocg_then_style", "style", "single"], "description": "PDF layers then line style, line style only, or one layer." },
                    "units":       { "type": "string", "enum": ["mm", "cm", "m", "in"], "description": "Drawing unit of the output." },
                    "layersOff":   { "type": "array", "items": { "type": "string" }, "description": "Layer names (as the export makes them) to leave out." },
                    "allowLarge":  { "type": "boolean", "description": "Export a page with more objects than the limit anyway (default false: such a page fails with code tooLarge)." }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        }
    )
}

/// De papierformaten die de printgereedschappen kennen; dezelfde lijst en
/// dezelfde schrijfwijze als de Pagina-instelling (js/pdf/print-pagina-
/// instelling.js, PAPIERFORMATEN) en als js/pdf/print-opdracht.js.
const PRINT_PAPIERFORMATEN: &[&str] = &[
    "A0", "A1", "A2", "A3", "A4", "A5", "A0L", "A1L", "A2L", "A3L", "Letter", "Legal", "Tabloid",
];

/// De papierkeuzes van een printgereedschap: de formaten plus één keuze die
/// alleen daar past ("page" zonder printer, "printer" met printer).
fn print_papier_keuzes(eigen: &str) -> Value {
    let mut keuzes = vec![Value::from(eigen)];
    keuzes.extend(PRINT_PAPIERFORMATEN.iter().map(|s| Value::from(*s)));
    Value::Array(keuzes)
}

/// De argumenten die `app_print_to_pdf` en `app_print` gemeen hebben: de
/// pagina's, het vel, de schaal en wat er wordt afgedrukt. Eén functie, zodat
/// beide gereedschappen dezelfde keuzes en dezelfde teksten houden.
fn print_gedeelde_eigenschappen(papier: &str) -> serde_json::Map<String, Value> {
    let papier_tekst = if papier == "page" {
        "Sheet size. \"page\" = every page on a sheet of its own size. Left out: the paper the Page Setup of this document asks for, otherwise \"page\"."
    } else {
        "Sheet size. \"printer\" = the paper that is in the printer. Left out: the paper the Page Setup of this document asks for, otherwise \"printer\"."
    };
    let mut props = serde_json::Map::new();
    props.insert("pages".into(), json!({ "type": "string", "description": "\"all\" (default), \"current\" or a range like \"1-3,5\"." }));
    props.insert("paper".into(), json!({
        "type": "string",
        "enum": print_papier_keuzes(papier),
        "description": papier_tekst
    }));
    props.insert("orientation".into(), json!({ "type": "string", "enum": ["auto", "portrait", "landscape"], "description": "Orientation of the sheet; \"auto\" follows the page, as Auto-rotate in the dialog does. Left out: what the next print would already get." }));
    props.insert("autoRotate".into(), json!({ "type": "boolean", "description": "true means orientation \"auto\"; false takes the orientation from Page Setup, otherwise portrait. May not contradict orientation." }));
    props.insert("scaling".into(), json!({ "type": "string", "enum": ["fit", "shrink", "actual", "custom-scale"], "description": "fit = fit on the sheet, shrink = only shrink when the page does not fit, actual = real size, custom-scale = the percentage in zoom." }));
    props.insert("zoom".into(), json!({ "type": "number", "description": "Page zoom in percent, 10 to 400. Implies scaling \"custom-scale\"." }));
    props.insert("center".into(), json!({ "type": "boolean", "description": "Centre the page on the sheet." }));
    props.insert("content".into(), json!({ "type": "string", "enum": ["document", "document-and-markups"], "description": "\"document\" leaves the annotation layer out; watermarks and text edits stay, they are document content." }));
    props
}

/// Beschrijving van `app_print_to_pdf`: de afdruk als PDF wegschrijven, langs
/// het doel "Opslaan als PDF" van het printvenster.
fn print_to_pdf_tool() -> Value {
    let mut props = print_gedeelde_eigenschappen("page");
    props.insert("path".into(), json!({ "type": "string", "description": "Absolute path of the PDF file to write (.pdf). A file that is open in the app is refused." }));
    json!({
        "name": "app_print_to_pdf",
        "description": "Print the current document to a PDF file, without opening the print dialog. Takes the route of the \"Save as PDF\" target in that dialog: no printer and no driver, the app writes the print PDF itself, so text stays text and the sheet lies in the file exactly as chosen. Settings that are left out take the value the print dialog remembered, otherwise its default; `pages` always starts at all pages. Returns the sheet size and orientation per page, the scale that was used and warnings about pages that do not fit. Fails while the print dialog is open.",
        "inputSchema": {
            "type": "object",
            "properties": props,
            "required": ["path"],
            "additionalProperties": false
        }
    })
}

/// Beschrijving van `app_print`: dezelfde afdruk, maar naar een printer.
fn print_tool() -> Value {
    let mut props = print_gedeelde_eigenschappen("printer");
    props.insert("printer".into(), json!({ "type": "string", "description": "Name of the print queue, exactly as app_list_printers reports it." }));
    props.insert("copies".into(), json!({ "type": "number", "description": "Number of copies, 1 to 999 (default: what the print dialog remembered)." }));
    json!({
        "name": "app_print",
        "description": "Print the current document to a printer, without opening the print dialog. Same page selection, paper, scale, position and content as that dialog, and the same background job. Settings that are left out take the value the print dialog remembered, otherwise its default; `pages` always starts at all pages. Returns the printer, the sheet with its orientation, the scale that was used, the number of copies and warnings about pages that do not fit. Paper really comes out of the printer, so ask the user before calling this. Fails on an unknown printer and while the print dialog is open.",
        "inputSchema": {
            "type": "object",
            "properties": props,
            "required": ["printer"],
            "additionalProperties": false
        }
    })
}

/// Beschrijving van `app_floorplan`: de drie relaties van een bouwkundige
/// plattegrond — een sparing hoort bij een wand, een ruimte bij de wanden
/// eromheen, een maat bij wat hij meet.
fn floorplan_tool() -> Value {
    json!({
        "name": "app_floorplan",
        "description": "Draw a building floor plan with the parts related to each other, instead of loose shapes stacked on top of one another. Four actions. \"wall\" draws ONE wall run with its openings: the wall is split at every door and window, so the opening really interrupts the wall (the hatch stops at the reveal) and the frame symbol sits in the gap at the wall's own thickness and angle; it returns the wall segment ids in order. \"rooms\" derives the enclosed rooms from the walls on a page - net area (inside the wall faces), perimeter and a label point that always falls inside the room - and reports wall ends that leave the contour open instead of silently filling half an area; a door opening does not break the enclosure. With place:true it puts each room on the sheet as a measured area plus a name, remembering the seed point; with refresh:true it re-derives them from the walls as they are now, so a room that grew because a wall moved updates itself. \"dimensions\" places a dimension chain along a wall run whose end points are ANCHORED to the wall segments (pier, opening, pier, ...) plus an overall dimension; with refresh:true every anchored dimension on the page is recomputed, and a dimension whose wall disappeared is reported as detached rather than broken. \"inspect\" reads back what is on the page: walls with their length and thickness, openings with width, sill and height, the rooms it finds, open contour ends and how many anchored dimensions there are. Coordinates are page points at 100% zoom; sizes are real millimetres, so the page needs a measurement scale (app_set_measure_scale) first. Everything one call creates or changes goes into a single undo step.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action":       { "type": "string", "enum": ["inspect", "wall", "rooms", "dimensions"], "description": "What to do." },
                "page":         { "type": "number", "description": "1-based page (default: the current page)." },
                "start":        { "type": "object", "description": "wall: start of the run as {x, y} in page points (the wall centre line).", "additionalProperties": true },
                "end":          { "type": "object", "description": "wall: end of the run as {x, y} in page points.", "additionalProperties": true },
                "thicknessMm":  { "type": "number", "description": "wall: real wall thickness in mm (default 100)." },
                "material":     { "type": "string", "description": "wall: hatch material id, e.g. nen47-metselwerk-baksteen, nen47-metselwerk-kunststeen, nen47-beton-gewapend, isolatie, none." },
                "insulation":   { "type": "string", "description": "wall: insulation sub-material when material is isolatie (steenwol, glaswol, pir, eps, kooltherm, pur)." },
                "openings":     { "type": "array", "description": "wall: the doors and windows in this run. Each: kind (door|window), widthMm (clear opening), alongMm (centre, measured from start along the wall), sillMm, heightMm, swing (left|right hinge), openSide (left|right of the wall direction) or openTo ({x, y}: a point in the room the door opens into), windowType (fixed|pivot|tilt)." },
                "minPierMm":    { "type": "number", "description": "wall: smallest piece of wall that must remain beside an opening (default 0)." },
                "joinStart":    { "type": "boolean", "description": "wall: false = the start of the run never joins another wall: no mitre, no trim to a corner, a plain butt end (default true). Walls that touch are otherwise joined automatically: coincident end points are mitred, and ends that just pass or fall short of a wall of the same material are trimmed to a closed corner. Use false where a wall or layer must stop square against another one (butt joint). Later: app_update_annotation props noJoinStart / noJoinEnd." },
                "joinEnd":      { "type": "boolean", "description": "wall: false = the end of the run never joins another wall (see joinStart; default true)." },
                "wallId":       { "type": "string", "description": "dimensions: a single wall annotation to dimension." },
                "wallIds":      { "type": "array", "description": "dimensions: the wall segments of one run, in order along the run (as returned by action \"wall\")." },
                "offsetMm":     { "type": "number", "description": "dimensions: distance from the wall to the chain, in mm (default 500)." },
                "totalOffsetMm": { "type": "number", "description": "dimensions: distance for the overall dimension (default offsetMm + 350)." },
                "side":         { "type": "string", "enum": ["left", "right"], "description": "dimensions: which side of the run the chain goes, seen along its direction (default left)." },
                "place":        { "type": "boolean", "description": "rooms: also put the rooms on the sheet instead of only reporting them." },
                "refresh":      { "type": "boolean", "description": "rooms/dimensions: recompute what is already on the sheet from the walls as they are now." },
                "seeds":        { "type": "array", "description": "rooms: points inside the rooms you want, each {x, y, name}. Without seeds every room found is reported." },
                "maxOpeningMm": { "type": "number", "description": "rooms/inspect: widest gap between two aligned wall ends that still counts as an opening rather than a hole in the contour (default 3000)." }
            },
            "required": ["action"],
            "additionalProperties": false
        }
    })
}

/// Beschrijving van `app_facade_element`: het gevelelement (#475) — een
/// vliesgevel of kozijn als één object met stijlen op de veldgrenzen en een
/// paneel per veld.
fn facade_element_tool() -> Value {
    json!({
        "name": "app_facade_element",
        "description": "Draw and edit a facade element in a floor plan: a curtain wall or a window frame, as ONE object along a line with an outer frame, mullions on the field boundaries and a panel in every field. Everything is at real size (mm) from the measurement scale, so set one first with app_set_measure_scale. Actions: \"create\" places a new element, either loose along start/end (page points), or IN an existing wall (wallId plus fromMm or alongMm and lengthMm): the wall is then cut over the length of the element, like a door or window opening, and the element sits in the gap; offsetMm moves it across the wall build-up (+ = right of the wall direction). The division is fields (number of equal fields, centre-to-centre) or fieldWidthsMm (centre-to-centre widths that add up to the length); without either it divides itself into fields of about 1200 mm (curtain wall) or 900 mm (window frame). \"get\" returns one element (id) with its mullions and fields, or without id a summary of every element on the page. Edits (all need id): \"addMullion\" splits a field at atMm (from the start) or in the middle of field; \"removeMullion\" merges the two fields beside mullion (index) or the mullion nearest atMm; \"moveMullion\" moves it to toMm or by byMm; \"setMullionType\" swaps the type of mullion (index 0 and the last index are the outer frame; without mullion or atMm all intermediate mullions); \"setPanel\" swaps the panel of field, fieldIndexes or the field at atMm; \"divide\" divides again into fields or fieldWidthsMm. Mullions are numbered from 0 (frame at the start) to n (frame at the end); field i lies between mullion i and i+1. Fields never become narrower than 100 mm clear and the overall length stays the same, except for divide with fieldWidthsMm. Mullion types: curtain wall alu-50x150 (default), alu-50x200, alu-65x250; window frame hout-67x114 (default), hout-67x139, hout-90x114 (width x depth in mm). Panels: curtain wall glass, solid, door, open; window frame glass, turnSash, door, solid. A panel is a name or {type, hinge: start|end, swing: inside|outside} for a door or turn sash. Every call is a single undo step and returns the element as it is now.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action":        { "type": "string", "enum": ["create", "get", "addMullion", "removeMullion", "moveMullion", "setMullionType", "setPanel", "divide"], "description": "What to do." },
                "page":          { "type": "number", "description": "1-based page (default: the current page)." },
                "id":            { "type": "string", "description": "The facade element to read or edit (as returned by create or get)." },
                "preset":        { "type": "string", "enum": ["curtainWall", "windowFrame"], "description": "create: which kind of element (default curtainWall)." },
                "start":         { "type": "object", "description": "create (loose): start of the element as {x, y} in page points.", "additionalProperties": true },
                "end":           { "type": "object", "description": "create (loose): end of the element as {x, y} in page points.", "additionalProperties": true },
                "wallId":        { "type": "string", "description": "create: put the element in this wall annotation; the wall is cut over the element's length." },
                "fromMm":        { "type": "number", "description": "create in a wall: distance from the wall start to the START of the element, in mm." },
                "alongMm":       { "type": "number", "description": "create in a wall: distance from the wall start to the MIDDLE of the element, in mm (alternative to fromMm; without both the element is centred)." },
                "lengthMm":      { "type": "number", "description": "create in a wall: length of the element = width of the gap, in mm (or give fieldWidthsMm)." },
                "offsetMm":      { "type": "number", "description": "create in a wall: position across the wall build-up, mm from the wall centre line, + = right of the wall direction (default 0)." },
                "fields":        { "type": "number", "description": "create/divide: number of equal fields." },
                "fieldWidthsMm": { "type": "array", "description": "create/divide: centre-to-centre field widths in mm, from the start.", "items": { "type": "number" } },
                "mullionType":   { "type": "string", "description": "create/addMullion/setMullionType: mullion type id, e.g. alu-50x150 or hout-67x114." },
                "frameType":     { "type": "string", "description": "create: type of the outer frame (both ends)." },
                "panels":        { "type": "array", "description": "create: the panel of each field, from the start (a name or {type, hinge, swing})." },
                "panel":         { "type": ["string", "object"], "description": "create: panel for every field not given in panels; setPanel: the new panel. A name (glass, solid, door, open, turnSash) or {type, hinge: start|end, swing: inside|outside}; an object without type only changes hinge/swing." },
                "insideSide":    { "type": "string", "enum": ["right", "left"], "description": "create: which side of the drawing direction is inside (doors swing inside by default; default right)." },
                "mullion":       { "type": "number", "description": "removeMullion/moveMullion/setMullionType: mullion index (0 = frame at the start)." },
                "atMm":          { "type": "number", "description": "Position along the element from its start, in mm: where addMullion splits, which mullion (nearest) or field setPanel/removeMullion/moveMullion/setMullionType means." },
                "toMm":          { "type": "number", "description": "moveMullion: new position from the start, in mm." },
                "byMm":          { "type": "number", "description": "moveMullion: shift in mm (+ = towards the end)." },
                "field":         { "type": "number", "description": "addMullion: split this field in the middle; setPanel: the field index (0 = at the start)." },
                "fieldIndexes":  { "type": "array", "description": "setPanel: several field indexes at once.", "items": { "type": "number" } }
            },
            "required": ["action"],
            "additionalProperties": false
        }
    })
}

/// Handle `tools/list`. Tasks 7-9 will append their tool descriptors to
/// this array.
fn handle_tools_list() -> Value {
    json!({
        "tools": [
            {
                "name": "list_test_pdfs",
                "description": "List all PDFs in the test corpus directory.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "screenshot_page",
                "description": "Render a single PDF page to PNG (returned as base64).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":       { "type": "string" },
                        "page_index": { "type": "integer", "minimum": 0 },
                        "width":      { "type": "integer", "minimum": 1, "default": 2000 }
                    },
                    "required": ["path", "page_index"],
                    "additionalProperties": false
                }
            },
            {
                "name": "get_pdf_metadata",
                "description": "Read PDF version, producer, and per-page metadata.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "path": { "type": "string" } },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "screenshot_all",
                "description": "Render all pages of a PDF as base64 PNGs. For batch rendering; clients with size constraints should call screenshot_page per page instead.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":  { "type": "string" },
                        "width": { "type": "integer", "minimum": 1, "default": 2000 }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_open_pdf",
                "description": "Open a PDF file in a new tab of the running app. Returns once the document is loaded and the tab is active. A DWG or DXF opens the CAD import dialog instead (result `dialog: \"cad-import\"`).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_zoom",
                "description": "Set the page-view zoom in the LIVE app. scale=1.0 means 100%, 2.0 means 200%, etc.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scale": { "type": "number", "minimum": 0.05, "maximum": 32.0 }
                    },
                    "required": ["scale"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_zoom_in",
                "description": "Trigger one zoom-in step in the LIVE app (same as the toolbar +).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_zoom_out",
                "description": "Trigger one zoom-out step in the LIVE app (same as the toolbar -).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_screenshot_view",
                "description": "Capture the LIVE app's current page view as a base64 PNG. Composites the PDF canvas with the annotation/highlight overlays (NOT the surrounding chrome — for that use OS-level screenshotting).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "width": { "type": "integer", "minimum": 1, "default": 2000 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_mouse_move",
                "description": "Dispatch a synthetic mousemove at viewport CSS coordinates (x, y) inside the LIVE WebView. Returns the element under the cursor.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "integer" },
                        "y": { "type": "integer" }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_mouse_click",
                "description": "Dispatch a synthetic mouse click at (x, y). Sequence: mousemove -> mousedown -> mouseup -> click (or contextmenu for right). button: 'left' (default) | 'middle' | 'right'.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x":      { "type": "integer" },
                        "y":      { "type": "integer" },
                        "button": { "type": "string", "enum": ["left", "middle", "right"], "default": "left" }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_mouse_drag",
                "description": "Dispatch a synthetic drag from (x1,y1) to (x2,y2) using `steps` interpolated mousemove events. Sequence: mousedown(x1,y1) -> N x mousemove -> mouseup(x2,y2). button: 'left' (default) | 'middle' | 'right'.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x1":     { "type": "integer" },
                        "y1":     { "type": "integer" },
                        "x2":     { "type": "integer" },
                        "y2":     { "type": "integer" },
                        "button": { "type": "string", "enum": ["left", "middle", "right"], "default": "left" },
                        "steps":  { "type": "integer", "minimum": 1, "maximum": 200, "default": 10 }
                    },
                    "required": ["x1", "y1", "x2", "y2"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_scroll",
                "description": "Dispatch a synthetic wheel event at (x, y) with delta (dx, dy) in CSS pixels. Set ctrlKey=true to test ctrl+wheel zoom-to-cursor.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x":       { "type": "integer" },
                        "y":       { "type": "integer" },
                        "dx":      { "type": "integer", "default": 0 },
                        "dy":      { "type": "integer", "default": 0 },
                        "ctrlKey": { "type": "boolean", "default": false },
                        "shiftKey":{ "type": "boolean", "default": false },
                        "altKey":  { "type": "boolean", "default": false },
                        "metaKey": { "type": "boolean", "default": false }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_key",
                "description": "Press a single key (with optional modifiers) on the focused element. Dispatches keydown then keyup. e.g. {key:'Escape'} or {key:'z', ctrl:true} for undo.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "key":   { "type": "string" },
                        "ctrl":  { "type": "boolean", "default": false },
                        "shift": { "type": "boolean", "default": false },
                        "alt":   { "type": "boolean", "default": false },
                        "meta":  { "type": "boolean", "default": false }
                    },
                    "required": ["key"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_type",
                "description": "Type a string into the focused element. For each character: keydown -> beforeinput -> (value splice) -> input -> keyup. Editable inputs receive value updates; non-editable elements receive only the key events.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string" }
                    },
                    "required": ["text"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_viewport_state",
                "description": "Probe the LIVE viewport state: render engine + timing chip, active document scale/page/viewMode, pdf-viewport singleton transform, pdf-canvas backing-store + CSS rect, high-zoom tile-overlay state (visible/hidden + position+size), pdf-container CSS rect + scroll offsets, and devicePixelRatio. Use this for any case where screen↔world coordinate mapping or zoom-state needs to be validated externally — e.g. after dispatching a zoom or scroll via `app_scroll`/`app_set_zoom`, call this to see where things landed.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_recent_console",
                "description": "Return the most recent matching console messages captured by the in-app observability buffer (mcp-bridge.js). Captures lines matching: [render], [tile], [wheel-zoom], [PERF], [pre-render], STALE, JANK. Buffer holds up to 500 entries; oldest auto-evicted. Filter with `since` (epoch-ms cutoff) or `tail` (last N entries) to limit output volume. Use after dispatching a zoom/scroll action to see exactly which render path fired, in what order, and whether any stale-render bailouts triggered.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "since": { "type": "number", "description": "Only return entries with timestamp >= this epoch-ms. Omit or 0 for all entries." },
                        "tail":  { "type": "integer", "minimum": 1, "description": "Return only the last N matching entries. Omit for all." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_wheel_zoom",
                "description": "Dispatch a synthetic ctrl+WheelEvent at (x, y) in the LIVE WebView — exercises the exact same wheel listener the OS hits, so this is a faithful proxy for a user spinning the wheel. `deltaY` < 0 = zoom in, > 0 = zoom out. Use this from an AI-driven debugging loop to reproduce the user's reported zoom problems WITHOUT a human at the mouse.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "number", "description": "Cursor clientX in CSS pixels (viewport-relative)." },
                        "y": { "type": "number", "description": "Cursor clientY in CSS pixels (viewport-relative)." },
                        "deltaY": { "type": "number", "description": "WheelEvent.deltaY. Default -120 (one notch zoom-in)." },
                        "ctrlKey": { "type": "boolean", "description": "Whether ctrlKey is set (default true → zoom). Set false to test plain wheel pan/scroll." }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_zoom_anchor_test",
                "description": "Full cursor-anchor accuracy probe: snapshot pre-zoom canvas+container+tile state at (x, y), dispatch a synthetic ctrl+wheel event, WAIT for renderPage to fully settle (window.__pdfRenderInFlight === 0 + 2 RAFs + 1 setTimeout to drain post-paint tile overlay), then snapshot post-zoom state and compute `anchorErrorPx` — the displacement (in CSS pixels) between where the cursor's world-point WAS before the zoom and where it ENDED UP after. < 3 px = pass (imperceptible), < 8 = acceptable, > 8 = visible spring/drift. This is the AI's primary metric for verifying zoom-anchor fixes.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "number", "description": "Cursor clientX in CSS pixels." },
                        "y": { "type": "number", "description": "Cursor clientY in CSS pixels." },
                        "direction": { "type": "string", "enum": ["in", "out"], "description": "Zoom direction. Default `in`." }
                    },
                    "required": ["x", "y"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_clear_caches",
                "description": "Force-clear all PDF-related caches: Rust pdfium doc cache, Rust pixmap cache, JS-side ImageBitmap cache. Use to rule out cache-staleness as a cause of any reported zoom/render anomaly. Safe to call any time; the next renderPage will rebuild whatever it needs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_go_to_page",
                "description": "Navigate the active document to a 1-based page number, exactly as if the user picked the page in the page box or clicked its thumbnail.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "page": { "type": "integer", "minimum": 1, "description": "1-based target page number." }
                    },
                    "required": ["page"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_tool",
                "description": "Switch the LIVE app's active tool, exactly like clicking the ribbon button. Accepts any registered tool name, e.g. select, hand, line, arrow, draw, box, circle, polyline, spline, arc, filledArea, textbox, callout, comment, stamp, highlight, editText, measureDistance, measureArea, measurePerimeter, measureAngle, scaleRegion, trim, extend. Returns the tool that is actually active afterwards (PDF/A read-only mode can refuse the switch).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool": { "type": "string", "description": "Registered tool name." }
                    },
                    "required": ["tool"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_click_element",
                "description": "Click an arbitrary DOM element in the LIVE app by CSS selector (usually '#button-id'). If the element lives on an inactive ribbon tab, the matching tab is activated first (the ribbon only renders the active tab's content). Returns { ok, found, disabled, clicked, activatedTab }. Disabled elements are reported but NOT clicked. Set searchTabs=false to probe only the current DOM (e.g. for dialogs) without touching the ribbon tabs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "selector":   { "type": "string", "description": "CSS selector of the element to click, e.g. '#dr-line'." },
                        "searchTabs": { "type": "boolean", "default": true, "description": "Walk the ribbon tabs when the selector is not in the current DOM." }
                    },
                    "required": ["selector"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_ui_state",
                "description": "Probe the UI state of a DOM element by CSS selector: { found, visible, disabled, active ('active' class or aria-pressed), text, tag, activatedTab }. Uses the same ribbon-tab search as app_click_element; set searchTabs=false to probe only the current DOM (e.g. '.modal-dialog' while a dialog is open).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "selector":   { "type": "string", "description": "CSS selector of the element to inspect." },
                        "searchTabs": { "type": "boolean", "default": true, "description": "Walk the ribbon tabs when the selector is not in the current DOM." }
                    },
                    "required": ["selector"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_window_size",
                "description": "Resize the LIVE app window to a logical width x height. Protocol runs call this up-front so fit-scale, white-margin and ribbon-overflow behaviour are deterministic regardless of the size the window opened with.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "width":  { "type": "number", "minimum": 200, "description": "Logical window width in px." },
                        "height": { "type": "number", "minimum": 200, "description": "Logical window height in px." }
                    },
                    "required": ["width", "height"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_current_tool",
                "description": "Return the LIVE app's currently active tool name (state.currentTool).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_merge_pdf",
                "description": "Merge one or more PDF files into the active document at the given position. The user's original file is not modified; the merged result opens as a working copy until saved. Returns { ok, position, mergedFiles, pagesInserted, pagesBefore, pagesAfter, filePath }; mergedFiles counts the files that really went in. A file that stays out makes ok false: a preview PDF of the CAD import is refused (reason preview-pdf), a file without pages is refused (no-pages), an unreadable file fails. Then error names the files, refused [{ file, reason }] and failed [{ file, error }] list them, and mergedFiles and pagesAfter show what did go in.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filePaths": { "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "Absolute paths of PDF files to merge into the current document." },
                        "position": { "type": "string", "enum": ["end", "start", "after"], "description": "Where to insert the merged pages: 'end' (default), 'start', or 'after' the current page." }
                    },
                    "required": ["filePaths"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_ai_complete",
                "description": "Ask the LIVE app's OpenAEC AI assistant a question (POST /me/ai/complete via the signed-in OpenAEC account). Returns { ok, signedInAs, text, credits }. Tests the assistant end-to-end without driving the chat UI; requires the app to be signed in to OpenAEC.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "prompt": { "type": "string", "description": "The question/prompt for the assistant." },
                        "system": { "type": "string", "description": "Optional system prompt." }
                    },
                    "required": ["prompt"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_accounts_status",
                "description": "Report the LIVE app's OpenAEC sign-in state: { ok, signedIn, user:{sub,name,email}|null, brand|null }. Use to verify login from outside the WebView.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
            {
                "name": "app_accounts_fetch",
                "description": "Make an authenticated OpenAEC Accounts API call from the LIVE signed-in app (GET/POST/DELETE to /me/* paths, e.g. /me/apps, /me/files, /me/brand, /me/storage, /me/credits). Returns { ok, response }. Requires sign-in. Makes the whole Accounts API drivable/testable via MCP.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":   { "type": "string", "description": "API path, e.g. /me/apps" },
                        "method": { "type": "string", "enum": ["GET", "POST", "DELETE"], "description": "HTTP method (default GET)" },
                        "body":   { "type": "object", "description": "Optional JSON body for POST." }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_assistant_ask",
                "description": "Submit a message into the app's assistant window as if the user typed it (opens the panel). Returns { ok }. The answer comes from whichever provider is available: OpenAEC AI, a personal Claude key, or the MCP relay (app_assistant_pending + app_assistant_answer).",
                "inputSchema": {
                    "type": "object",
                    "properties": { "text": { "type": "string", "description": "The user message to submit." } },
                    "required": ["text"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_assistant_pending",
                "description": "Take the oldest assistant question waiting for an MCP client to answer (the relay provider). Returns { ok, question:{ id, prompt, system, docName }|null }. When non-null, compute an answer and deliver it with app_assistant_answer — this is how an external Claude becomes the assistant's AI brain.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
            {
                "name": "app_assistant_answer",
                "description": "Answer a pending assistant question (id from app_assistant_pending). The text appears in the assistant window as the assistant's reply. Returns { ok, id }.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id":   { "type": "string", "description": "Question id from app_assistant_pending." },
                        "text": { "type": "string", "description": "Answer text to show in the assistant window." }
                    },
                    "required": ["id", "text"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_assistant_history",
                "description": "Return the LIVE assistant conversation: { ok, messages:[{ role, content }] }. Use to verify a delivered answer landed in the window.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
            {
                "name": "app_create_annotation",
                "description": "Create an annotation on the LIVE app's active document WITHOUT synthetic mouse input. Builds the same object the interactive tool would, pushes it onto the document, records an undo step and redraws. Geometry goes in `props` (page coordinates at 100% zoom): line/arrow/measureDistance need startX/startY/endX/endY; box/circle/highlight/cloud/polygon/textbox/callout/scaleRegion need x/y/width/height; polyline/filledArea/measureArea/measurePerimeter need points:[{x,y},...]; spline needs controlPoints; draw needs path; comment needs x/y. Optional style props (color, strokeColor, fillColor, lineWidth, opacity, text, fontSize, scaleString, units, leaderStartX/Y, leaderEndX/Y, ...) override the tool defaults. measure* annotations get measureText computed from the document scale automatically. Returns the new annotation id.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["line", "arrow", "wall", "box", "mask", "redaction", "viewport", "circle", "highlight", "cloud", "polygon", "polyline", "cloudPolyline", "spline", "draw", "filledArea", "textbox", "callout", "comment", "stamp", "signature", "image", "parametricSymbol", "measureDistance", "measureArea", "measurePerimeter", "scaleRegion", "count"]
                        },
                        "page":  { "type": "integer", "minimum": 1, "description": "1-based target page. Defaults to the current page." },
                        "props": { "type": "object", "description": "Geometry + style properties for the annotation." },
                        "layer": { "type": "string", "description": "Markup layer to draw on, by id or name (see app_list_layers). Left out: the current layer, as with the interactive tool. An unknown layer is an error; create it first with app_create_layer." }
                    },
                    "required": ["type", "props"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_list_annotations",
                "description": "List the active document's annotations as compact JSON (id, type, page, core geometry, colors, text/measureText, and the markup layer when it is not the default layer). Optionally filter to one page or one layer.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "page": { "type": "integer", "minimum": 1, "description": "Only annotations on this 1-based page." },
                        "layer": { "type": "string", "description": "Only annotations on this markup layer, by id or name." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_annotation",
                "description": "Return the full JSON-safe property set of one annotation by id (functions/DOM refs stripped).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_update_annotation",
                "description": "Merge `props` onto an existing annotation (geometry, color, lineWidth, text, ...). Records a modify-undo step, recomputes measureText when measurement geometry changed, and redraws. `id` and `type` are immutable. `layer` moves the annotation to another markup layer; `props` may then be empty.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id":    { "type": "string" },
                        "props": { "type": "object", "description": "Property patch to merge onto the annotation." },
                        "layer": { "type": "string", "description": "Move the annotation to this markup layer, by id or name (see app_list_layers)." }
                    },
                    "required": ["id", "props"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_delete_annotation",
                "description": "Delete an annotation by id (records a delete-undo step and redraws).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_select_annotation",
                "description": "Select one annotation by id so the properties panel and selection handles show it, exactly like clicking it with the select tool.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_clear_selection",
                "description": "Clear the annotation selection and hide the properties panel.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_undo",
                "description": "Undo the last annotation/page edit on the active document (same as Ctrl+Z).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_redo",
                "description": "Redo the last undone edit on the active document (same as Ctrl+Y).",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_list_tabs",
                "description": "List all open document tabs: index, fileName, filePath, modified flag, active flag, pageCount, isUntitled, currentPage, annotationCount.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_switch_tab",
                "description": "Activate the document tab at `index` (0-based, see app_list_tabs).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer", "minimum": 0 }
                    },
                    "required": ["index"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_close_tab",
                "description": "Close the document tab at `index` (0-based). If the document has unsaved changes the call fails unless force=true (discard) or save=true (save-and-close) — it never opens a save dialog, so the bridge stays headless-safe. When save=true and the document carried digital signatures that no longer hold for the saved file, the result also contains `signaturesInvalidated: true`.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer", "minimum": 0 },
                        "force": { "type": "boolean", "default": false, "description": "Discard unsaved changes." },
                        "save":  { "type": "boolean", "default": false, "description": "Save unsaved changes, then close (same path as the UI dialog's Save choice)." }
                    },
                    "required": ["index"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_new_blank_pdf",
                "description": "Create a new blank PDF document in a new tab (page size in PDF points; A4 portrait = 595 x 842).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "widthPt":  { "type": "number", "exclusiveMinimum": 0 },
                        "heightPt": { "type": "number", "exclusiveMinimum": 0 },
                        "pages":    { "type": "integer", "minimum": 1, "default": 1 }
                    },
                    "required": ["widthPt", "heightPt"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_save_pdf",
                "description": "Save the active document with all annotations baked in. With `path`, saves to that file. Without `path`, saves in place — fails (instead of opening a file picker) when the document is untitled or has no real path. When the document carried digital signatures that no longer hold for the saved file, the result also contains `signaturesInvalidated: true`.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute target path. Omit to save in place." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_view_mode",
                "description": "Switch the active document view: 'single' page, 'continuous' vertical scroll, or 'book' (two-page spread, page 1 on the right). 'book' is a continuous variant.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "mode": { "type": "string", "enum": ["single", "continuous", "book"] }
                    },
                    "required": ["mode"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_fit_page",
                "description": "Zoom the active document so the whole page fits the viewport (same as the Fit Page button). Returns the resulting zoom.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_fit_width",
                "description": "Zoom the active document so the page width fills the viewport (same as the Fit Width button). Returns the resulting zoom.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_page_count",
                "description": "Return the active document's page count and current page.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_measure_scale",
                "description": "Set the active document's measurement scale calibration (pixels per unit + unit, e.g. ~2.835 px/mm for 1:1 at 72 dpi) and recalculate every measurement annotation.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "pixelsPerUnit": { "type": "number", "exclusiveMinimum": 0 },
                        "unit":          { "type": "string", "description": "Unit name, e.g. mm, cm, m, in, ft." }
                    },
                    "required": ["pixelsPerUnit", "unit"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_get_takeoff",
                "description": "Return take-off totals for the user's named schedules (Staten): per schedule the element count, the numeric column grand totals (e.g. area m2, length m, count), and per-group subtotals. Optionally target one schedule by id or name; otherwise all schedules are returned. Image/thumbnail columns are reported as counts, never as data-URLs.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scheduleId": { "type": "string", "description": "Target one schedule by its id." },
                        "name":       { "type": "string", "description": "Target one schedule by its display name." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_place_schedule",
                "description": "Build a quantities schedule (Staat) from the annotations in the open document and place it on the page as a table annotation. Without scheduleId a new schedule is created from a template (default 'area'); `config` then overrides its categories/fields/sort. The table contents are computed by the app from the live annotations - the caller supplies no cell values.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scheduleId": { "type": "string", "description": "Reuse an existing schedule instead of creating one." },
                        "templateId": { "type": "string", "description": "Template for a new schedule: area, length, count, symbol, text, image or full. Default: area." },
                        "name":       { "type": "string", "description": "Display name for the schedule." },
                        "config":     { "type": "object", "description": "Schedule config: categories, fields, filters, sort, itemize, format. Overrides the template.", "additionalProperties": true },
                        "page":       { "type": "number", "description": "Page to place the table on (default: current page)." },
                        "x":          { "type": "number", "description": "Left edge in page points (default 40)." },
                        "y":          { "type": "number", "description": "Top edge in page points (default 40)." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_structural_layout",
                "description": "Set out a structural floor plan in one undoable step: the grid (lettered and numbered grid lines with bubbles), columns on the grid intersections, beams along the grid lines, a span-direction arrow per floor bay carrying the real span, spot elevations, position tags (position number / section / level) and - unless switched off - a quantity schedule grouped by IFC category. Bay sizes are REAL millimetres; the app converts them to page points at `scale` and also calibrates the measuring scale so later measurements agree. Profiles: \"HE200B\", \"HEA 200\", \"IPE 300\", \"UNP 200\", \"Koker 100x100x5\", \"L 100x100x10\" (steel) or \"300x500\" (concrete b x h in mm). Use dryRun to see what would be placed without touching the drawing.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "page":   { "type": "number", "description": "Page to draw on (default: current page)." },
                        "origin": {
                            "type": "object",
                            "description": "First grid intersection, in page points (top-left origin, 100% zoom).",
                            "properties": { "x": { "type": "number" }, "y": { "type": "number" } },
                            "required": ["x", "y"],
                            "additionalProperties": false
                        },
                        "scale":  { "type": "string", "description": "Drawing scale, e.g. '1:100' (default) or '1:50'." },
                        "baysX":  { "description": "Bay sizes left to right in mm: [5400,5400], '2x5400' or '5400 6000'." },
                        "baysY":  { "description": "Bay sizes top to bottom in mm, same notations as baysX." },
                        "labelStyleX": { "type": "string", "enum": ["letters", "numbers"], "description": "Label style for the vertical grid lines (default letters)." },
                        "labelStyleY": { "type": "string", "enum": ["letters", "numbers"], "description": "Label style for the horizontal grid lines (default numbers)." },
                        "labelsYFromBottom": { "type": "boolean", "description": "Number the horizontal grid lines from the bottom up, as on a drawing (default true)." },
                        "gridExtensionMm":   { "type": "number", "description": "How far a grid line runs past the outer bay, in mm (default 1500)." },
                        "textHeightMm":      { "type": "number", "description": "Tag text height in PAPER mm (default 2.5)." },
                        "gridBubbleMm":      { "type": "number", "description": "Grid bubble radius in PAPER mm (default 4)." },
                        "columns": { "description": "false to omit, or { profile, prefix, levelMm, skip: [grid labels] }." },
                        "beams":   { "description": "false to omit, or { profile, direction: x|y|both, prefix, levelMm, edgeOnly }." },
                        "floors":  { "description": "false to omit, or { direction: x|y|shortest, thicknessMm, levelMm, prefix, text }." },
                        "levelMarkers": { "type": "boolean", "description": "Place a spot elevation per floor bay when a level is given (default true)." },
                        "tags":         { "type": "boolean", "description": "Tag each element with position number, section and level (default true)." },
                        "schedule":     { "description": "false to omit, or { name, x, y, itemize } for the quantity schedule." },
                        "setMeasureScale": { "type": "boolean", "description": "Also calibrate the document's measuring scale to this drawing scale (default true)." },
                        "dryRun":       { "type": "boolean", "description": "Only compute and report; draw nothing." }
                    },
                    "required": ["origin", "baysX", "baysY"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_list_commands",
                "description": "List EVERY function the app exposes: each ribbon button on every tab (label, tab, disabled/active state) plus every drawing tool. Use this to discover how a feature is called before running it with app_run_command. Command ids: 'ribbon:#<id>' (stable), 'ribbon:<tab>:<n>' (button without an id, only stable within one version), 'tool:<name>'. Optional `filter` narrows by text (matches id, label, title or tab).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "filter": { "type": "string", "description": "Case-insensitive text filter, e.g. 'scale', 'snippet', 'export'." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_run_command",
                "description": "Run any command returned by app_list_commands: clicks the ribbon button (switching to its tab first) or activates the tool. Disabled buttons are refused.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Command id from app_list_commands, e.g. 'ribbon:#btn-vector-snippet' or 'tool:measureArea'." }
                    },
                    "required": ["command"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_snippet_cut",
                "description": "Cut a rectangular area from a page of the active document as a VECTOR snippet (not a raster screenshot) and put it on the app's snippet clipboard. Coordinates are app points (top-left origin, 100% zoom). Paste it into any open document with app_snippet_paste.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x":      { "type": "number", "description": "Left edge in app points." },
                        "y":      { "type": "number", "description": "Top edge in app points." },
                        "width":  { "type": "number", "description": "Width in app points." },
                        "height": { "type": "number", "description": "Height in app points." },
                        "page":   { "type": "number", "description": "Page to cut from (default: current page)." }
                    },
                    "required": ["x", "y", "width", "height"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_snippet_paste",
                "description": "Paste the vector snippet from the snippet clipboard into the active document at real size, as a movable annotation. It stays vector in the saved PDF.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "x":    { "type": "number", "description": "Left edge in app points (default 40)." },
                        "y":    { "type": "number", "description": "Top edge in app points (default 40)." },
                        "page": { "type": "number", "description": "Target page (default: current page)." }
                    },
                    "additionalProperties": false
                }
            },
            import_cad_tool(),
            export_cad_tool(),
            print_to_pdf_tool(),
            print_tool(),
            {
                "name": "app_list_printers",
                "description": "List the printers the app knows, with the system default printer and, per printer, the driver, the port and whether it writes to a file instead of to paper. Reads only: it never starts a job and changes nothing. The \"Save as PDF\" target of the print dialog is not a printer — use app_print_to_pdf for that.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_list_layers",
                "description": "List the markup layers of the active document in panel order: id, name, colour, visible, printable, locked, the number of markups on it, whether it is the current layer (where new markups land) and whether it is the default layer. Markups without a layer of their own are on the default layer. Reads only.",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            },
            {
                "name": "app_create_layer",
                "description": "Create a markup layer in the active document, at the end of the layer list. Names are unique (case-insensitive). Returns the new layer. The layers are saved with the document as optional content groups, so other PDF readers can switch them too.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name":      { "type": "string", "description": "Name of the new layer." },
                        "color":     { "type": "string", "description": "Layer colour as #rrggbb." },
                        "visible":   { "type": "boolean", "description": "Shown on screen (default true). A hidden layer is also not printed, not exported and not selectable." },
                        "printable": { "type": "boolean", "description": "Printed and exported (default true)." },
                        "locked":    { "type": "boolean", "description": "Visible, but its markups cannot be selected or moved (default false)." },
                        "current":   { "type": "boolean", "description": "Make it the current layer, so new markups land on it." }
                    },
                    "required": ["name"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_set_layer",
                "description": "Change a markup layer of the active document: switch it on or off, make it printable or not, lock or unlock it, rename it, set its colour, or make it the current layer. A layer that is switched off is not drawn, not selectable, not printed and not exported; its markups come back unchanged when it is switched on. Returns the layer and what changed.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "layer":     { "type": "string", "description": "The layer, by id or name (see app_list_layers)." },
                        "visible":   { "type": "boolean", "description": "Switch the layer on (true) or off (false)." },
                        "printable": { "type": "boolean", "description": "Print and export the layer." },
                        "locked":    { "type": "boolean", "description": "Lock the layer: visible, but not selectable or movable." },
                        "name":      { "type": "string", "description": "New name. The default layer cannot be renamed." },
                        "color":     { "type": "string", "description": "Layer colour as #rrggbb." },
                        "current":   { "type": "boolean", "description": "true makes it the current layer." }
                    },
                    "required": ["layer"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_snippet_flatten",
                "description": "Mark a pasted vector snippet as flattened: it stays visible but is no longer selectable, and on the next save it is drawn into the page content instead of being stored as an annotation.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id":        { "type": "string", "description": "Annotation id of the vectorSnippet." },
                        "flattened": { "type": "boolean", "description": "false un-flattens it again (default true)." }
                    },
                    "required": ["id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "app_symbol_scale",
                "description": "Get or set the placement scale for symbols from the symbol palette (1 = real size, 2 = twice as large). Applies to symbols placed from now on; symbols already on the drawing are unchanged. Range 0.1 to 10. Without `scale` it returns the current value.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "scale": { "type": "number", "description": "New placement scale." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "app_titleblock",
                "description": "Read or fill the title block fields by NAME (projectnaam, adres, opdrachtgever, status, projectnr, fase, auteur, schaal, datum_eerste, wijziging, documenttype, kenmerk — whatever the title block defines). Without `fields` it lists the fields and their current values; with `fields` it fills them, e.g. {\"projectnaam\": \"Woonhuis\", \"schaal\": \"1:50\"}. Unknown names are reported, not silently ignored.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "fields": { "type": "object", "description": "Field name to new value.", "additionalProperties": true },
                        "page":   { "type": "number", "description": "Limit to one page (default: all pages)." }
                    },
                    "additionalProperties": false
                }
            },
            floorplan_tool(),
            facade_element_tool()
        ]
    })
}

/// De `tools/list` voor een profiel: gefilterd, en elk gereedschap met de
/// annotaties die Claude gebruikt voor toestemming (lezen gaat zonder vragen,
/// wijzigen vraagt altijd). Zie mcp_tool_meta.rs.
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

/// Dispatch a `tools/call` request to the matching tool handler. Returns
/// the tool's MCP-shaped result (`content[]` + `isError`) on success, or a
/// `(code, message)` pair that the caller wraps in a JSON-RPC error
/// response. Tasks 7-9 add new arms to the inner `match`.
async fn handle_tools_call(state: &AppState, params: &Value) -> Result<Value, (i32, String)> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("<missing>");
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    match name {
        "list_test_pdfs" => tool_list_test_pdfs(state).await,
        "screenshot_page" => tool_screenshot_page(state, &arguments).await,
        "get_pdf_metadata" => tool_get_pdf_metadata(state, &arguments).await,
        "screenshot_all" => tool_screenshot_all(state, &arguments).await,
        "app_open_pdf" => tool_app_request(state, "mcp:open-pdf", &arguments, Duration::from_secs(60)).await,
        "app_set_zoom" => tool_app_request(state, "mcp:set-zoom", &arguments, Duration::from_secs(15)).await,
        "app_zoom_in" => tool_app_request(state, "mcp:zoom-in", &arguments, Duration::from_secs(15)).await,
        "app_zoom_out" => tool_app_request(state, "mcp:zoom-out", &arguments, Duration::from_secs(15)).await,
        "app_screenshot_view" => tool_app_request(state, "mcp:screenshot-view", &arguments, Duration::from_secs(30)).await,
        "app_mouse_move"  => tool_app_request(state, "mcp:mouse-move",  &arguments, Duration::from_secs(10)).await,
        "app_mouse_click" => tool_app_request(state, "mcp:mouse-click", &arguments, Duration::from_secs(10)).await,
        "app_mouse_drag"  => tool_app_request(state, "mcp:mouse-drag",  &arguments, Duration::from_secs(30)).await,
        "app_scroll"      => tool_app_request(state, "mcp:scroll",      &arguments, Duration::from_secs(10)).await,
        "app_key"         => tool_app_request(state, "mcp:key",         &arguments, Duration::from_secs(10)).await,
        "app_type"        => tool_app_request(state, "mcp:type",        &arguments, Duration::from_secs(30)).await,
        "app_get_viewport_state" => tool_app_request(state, "mcp:get-viewport-state", &arguments, Duration::from_secs(5)).await,
        "app_get_recent_console" => tool_app_request(state, "mcp:get-recent-console", &arguments, Duration::from_secs(5)).await,
        "app_wheel_zoom"         => tool_app_request(state, "mcp:wheel-zoom",         &arguments, Duration::from_secs(15)).await,
        "app_zoom_anchor_test"   => tool_app_request(state, "mcp:zoom-anchor-test",   &arguments, Duration::from_secs(30)).await,
        "app_clear_caches"       => tool_app_request(state, "mcp:clear-caches",       &arguments, Duration::from_secs(10)).await,
        "app_go_to_page"         => tool_app_request(state, "mcp:go-to-page",         &arguments, Duration::from_secs(15)).await,
        "app_set_tool"           => tool_app_request(state, "mcp:set-tool",           &arguments, Duration::from_secs(10)).await,
        "app_click_element"      => tool_app_request(state, "mcp:click-element",      &arguments, Duration::from_secs(15)).await,
        "app_ui_state"           => tool_app_request(state, "mcp:ui-state",           &arguments, Duration::from_secs(15)).await,
        "app_set_window_size"    => tool_set_window_size(state, &arguments).await,
        "app_get_current_tool"   => tool_app_request(state, "mcp:get-current-tool",   &arguments, Duration::from_secs(5)).await,
        "app_merge_pdf"          => tool_app_request(state, "mcp:merge-pdf",           &arguments, Duration::from_secs(60)).await,
        "app_ai_complete"        => tool_app_request(state, "mcp:ai-complete",         &arguments, Duration::from_secs(60)).await,
        "app_accounts_status"    => tool_app_request(state, "mcp:accounts-status",     &arguments, Duration::from_secs(5)).await,
        "app_accounts_fetch"     => tool_app_request(state, "mcp:accounts-fetch",      &arguments, Duration::from_secs(30)).await,
        "app_assistant_ask"      => tool_app_request(state, "mcp:assistant-ask",       &arguments, Duration::from_secs(10)).await,
        "app_assistant_pending"  => tool_app_request(state, "mcp:assistant-pending",   &arguments, Duration::from_secs(10)).await,
        "app_assistant_answer"   => tool_app_request(state, "mcp:assistant-answer",    &arguments, Duration::from_secs(10)).await,
        "app_assistant_history"  => tool_app_request(state, "mcp:assistant-history",   &arguments, Duration::from_secs(10)).await,
        "app_create_annotation"  => tool_app_request(state, "mcp:create-annotation",  &arguments, Duration::from_secs(15)).await,
        "app_list_annotations"   => tool_app_request(state, "mcp:list-annotations",   &arguments, Duration::from_secs(10)).await,
        "app_get_annotation"     => tool_app_request(state, "mcp:get-annotation",     &arguments, Duration::from_secs(10)).await,
        "app_update_annotation"  => tool_app_request(state, "mcp:update-annotation",  &arguments, Duration::from_secs(15)).await,
        "app_delete_annotation"  => tool_app_request(state, "mcp:delete-annotation",  &arguments, Duration::from_secs(15)).await,
        "app_select_annotation"  => tool_app_request(state, "mcp:select-annotation",  &arguments, Duration::from_secs(10)).await,
        "app_clear_selection"    => tool_app_request(state, "mcp:clear-selection",    &arguments, Duration::from_secs(10)).await,
        "app_undo"               => tool_app_request(state, "mcp:undo",               &arguments, Duration::from_secs(15)).await,
        "app_redo"               => tool_app_request(state, "mcp:redo",               &arguments, Duration::from_secs(15)).await,
        "app_list_tabs"          => tool_app_request(state, "mcp:list-tabs",          &arguments, Duration::from_secs(5)).await,
        "app_switch_tab"         => tool_app_request(state, "mcp:switch-tab",         &arguments, Duration::from_secs(15)).await,
        "app_close_tab"          => tool_app_request(state, "mcp:close-tab",          &arguments, Duration::from_secs(15)).await,
        "app_new_blank_pdf"      => tool_app_request(state, "mcp:new-blank-pdf",      &arguments, Duration::from_secs(60)).await,
        "app_save_pdf"           => tool_app_request(state, "mcp:save-pdf",           &arguments, Duration::from_secs(120)).await,
        "app_set_view_mode"      => tool_app_request(state, "mcp:set-view-mode",      &arguments, Duration::from_secs(30)).await,
        "app_fit_page"           => tool_app_request(state, "mcp:fit-page",           &arguments, Duration::from_secs(15)).await,
        "app_fit_width"          => tool_app_request(state, "mcp:fit-width",          &arguments, Duration::from_secs(15)).await,
        "app_get_page_count"     => tool_app_request(state, "mcp:get-page-count",     &arguments, Duration::from_secs(5)).await,
        "app_set_measure_scale"  => tool_app_request(state, "mcp:set-measure-scale",  &arguments, Duration::from_secs(15)).await,
        "app_get_takeoff"        => tool_app_request(state, "mcp:get-takeoff",        &arguments, Duration::from_secs(10)).await,
        "app_place_schedule"     => tool_app_request(state, "mcp:place-schedule",     &arguments, Duration::from_secs(15)).await,
        "app_structural_layout"  => tool_app_request(state, "mcp:structural-layout",  &arguments, Duration::from_secs(60)).await,
        "app_list_commands"      => tool_app_request(state, "mcp:list-commands",      &arguments, Duration::from_secs(30)).await,
        "app_run_command"        => tool_app_request(state, "mcp:run-command",        &arguments, Duration::from_secs(20)).await,
        "app_snippet_cut"        => tool_app_request(state, "mcp:snippet-cut",        &arguments, Duration::from_secs(60)).await,
        "app_snippet_paste"      => tool_app_request(state, "mcp:snippet-paste",      &arguments, Duration::from_secs(15)).await,
        "app_snippet_flatten"    => tool_app_request(state, "mcp:snippet-flatten",    &arguments, Duration::from_secs(10)).await,
        "app_symbol_scale"       => tool_app_request(state, "mcp:symbol-scale",       &arguments, Duration::from_secs(10)).await,
        "app_titleblock"         => tool_app_request(state, "mcp:titleblock",         &arguments, Duration::from_secs(15)).await,
        "app_floorplan"          => tool_app_request(state, "mcp:floorplan",          &arguments, Duration::from_secs(60)).await,
        "app_facade_element"     => tool_app_request(state, "mcp:facade-element",     &arguments, Duration::from_secs(30)).await,
        "app_import_cad"         => tool_app_request(state, "mcp:import-cad",         &arguments, Duration::from_secs(300)).await,
        "app_export_cad"         => tool_app_request(state, "mcp:export-cad",         &arguments, Duration::from_secs(300)).await,
        // Afdrukken: een A0 op 300 dpi renderen duurt minuten, dus dezelfde
        // ruime grens als de CAD-omzetting. De JS-kant breekt net eerder af
        // (print-opdracht.js TIJDGRENS_MS), zodat er na "timed out" geen
        // bestand meer verschijnt en er niets meer naar de printer gaat.
        "app_print_to_pdf"       => tool_app_request(state, "mcp:print-to-pdf",       &arguments, Duration::from_secs(300)).await,
        "app_print"              => tool_app_request(state, "mcp:print",              &arguments, Duration::from_secs(300)).await,
        "app_list_printers"      => tool_app_request(state, "mcp:list-printers",      &arguments, Duration::from_secs(30)).await,
        // Annotatielagen (#468): alleen het model, dus korte grenzen.
        "app_list_layers"        => tool_app_request(state, "mcp:list-layers",        &arguments, Duration::from_secs(10)).await,
        "app_create_layer"       => tool_app_request(state, "mcp:create-layer",       &arguments, Duration::from_secs(10)).await,
        "app_set_layer"          => tool_app_request(state, "mcp:set-layer",          &arguments, Duration::from_secs(10)).await,
        other => Err((
            jsonrpc_error::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        )),
    }
}

/// `app_set_window_size` — resize the main window from the Rust side.
/// Runs outside the WebView so no capability/ACL entry is needed; protocol
/// runs call this up-front to make fit-scale and margin-geometry
/// deterministic regardless of the size the window opened with.
async fn tool_set_window_size(state: &AppState, arguments: &Value) -> Result<Value, (i32, String)> {
    let width = arguments.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let height = arguments.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
    if width < 200.0 || height < 200.0 {
        return Err((
            jsonrpc_error::INVALID_PARAMS,
            "width/height must be numbers >= 200".to_string(),
        ));
    }
    let app = state.app_handle.as_ref().ok_or_else(|| (
        jsonrpc_error::INTERNAL_ERROR,
        "AppHandle unavailable — MCP server not started from inside Tauri::setup()".to_string(),
    ))?;
    let window = app.get_webview_window("main").ok_or_else(|| (
        jsonrpc_error::INTERNAL_ERROR,
        "main window not found".to_string(),
    ))?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("set_size failed: {e}")))?;
    // Give the resize + reflow a beat before reporting success.
    tokio::time::sleep(Duration::from_millis(300)).await;
    Ok(json!({
        "content": [{
            "type": "text",
            "text": json!({ "ok": true, "requested": { "width": width, "height": height } }).to_string(),
        }],
        "isError": false,
    }))
}

/// Generic dispatch for the `app_*` tools that drive the LIVE WebView via
/// the [`mcp_app_bridge`]. Emits `event_name` with `arguments` as the
/// payload's `params`, awaits the WebView's response, and wraps it in the
/// MCP-shaped result envelope. The JS side responds with arbitrary JSON
/// (typically `{ "ok": true, ... }` or `{ "error": "..." }`); we forward
/// whatever it sends so per-tool conventions stay flexible.
async fn tool_app_request(
    state: &AppState,
    event_name: &str,
    arguments: &Value,
    timeout: Duration,
) -> Result<Value, (i32, String)> {
    let app = state
        .app_handle
        .as_ref()
        .ok_or_else(|| (
            jsonrpc_error::INTERNAL_ERROR,
            "AppHandle unavailable — MCP server not started from inside Tauri::setup()".to_string(),
        ))?;
    let bridge = app.state::<McpAppBridge>();
    let response = mcp_app_bridge::request(app, &bridge, event_name, arguments.clone(), timeout)
        .await
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

    Ok(json!({
        "content": [{
            "type": "text",
            "text": response.to_string(),
        }],
        "isError": false,
    }))
}

/// `list_test_pdfs` tool — enumerates every `*.pdf` under
/// `state.test_pdfs_dir` and returns its absolute path, file size, and
/// page count. Page count is read with `lopdf::Document::load_mem` inside
/// `spawn_blocking` because lopdf does synchronous I/O.
///
/// The result is shaped per the MCP convention: a single text content
/// block whose `text` field is a JSON-encoded payload. The harness in
/// Task 13 decodes this string to recover the structured `pdfs` array.
async fn tool_list_test_pdfs(state: &AppState) -> Result<Value, (i32, String)> {
    let dir: &PathBuf = &state.test_pdfs_dir;
    let mut entries = match tokio::fs::read_dir(dir.as_path()).await {
        Ok(e) => e,
        Err(e) => {
            return Err((
                jsonrpc_error::INTERNAL_ERROR,
                format!("could not read test corpus dir {:?}: {e}", dir),
            ));
        }
    };

    let mut pdfs: Vec<Value> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("pdf") {
            continue;
        }
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        // page count: lopdf reads from disk synchronously, so do it on a
        // blocking thread to keep the runtime responsive.
        let path_for_count = path.clone();
        let page_count = tokio::task::spawn_blocking(move || {
            std::fs::read(&path_for_count)
                .ok()
                .and_then(|b| lopdf::Document::load_mem(&b).ok())
                .map(|doc| doc.get_pages().len())
                .unwrap_or(0)
        })
        .await
        .unwrap_or(0);
        pdfs.push(json!({
            "path":       path.to_string_lossy(),
            "page_count": page_count,
            "file_size":  metadata.len(),
        }));
    }
    pdfs.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));

    Ok(json!({
        "content": [{
            "type": "text",
            "text": json!({ "pdfs": pdfs }).to_string(),
        }],
        "isError": false,
    }))
}

/// `screenshot_page` tool — renders a single PDF page via PDFium at a target
/// output width (in pixels) and returns the PNG bytes encoded as base64. The
/// MCP harness uses this to compare current renders against committed reference
/// PNGs.
///
/// Scaling: `scale = width / page_w_pt` — `width` is the literal output
/// pixel width, matching the PyMuPDF reference renderer the regression
/// harness uses (`zoom = width / page.rect.width`). For a portrait A4 page
/// at width=2000 this produces a 2000×2828 image, not 1415×2000 as a
/// `max(w,h)`-based scale would. Aligning the convention is required so
/// app-vs-reference diffs aren't dominated by an asymmetric resolution
/// scale (portrait pages would otherwise render at ~71 % of the reference
/// resolution and lose anti-aliased text sharpness in the side-by-side
/// comparison).
async fn tool_screenshot_page(
    _state: &AppState,
    arguments: &Value,
) -> Result<Value, (i32, String)> {
    let path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing 'path'".to_string()))?
        .to_string();
    let page_index = arguments
        .get("page_index")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing or invalid 'page_index'".to_string()))?
        as usize;
    let width = arguments
        .get("width")
        .and_then(|v| v.as_u64())
        .unwrap_or(2000) as u32;
    if width == 0 {
        return Err((jsonrpc_error::INVALID_PARAMS, "'width' must be > 0".to_string()));
    }

    let pdf_bytes = tokio::fs::read(&path).await.map_err(|e| {
        (
            jsonrpc_error::INTERNAL_ERROR,
            format!("read {}: {e}", path),
        )
    })?;

    let (render_width, render_height, render_rgba) = tokio::task::spawn_blocking(move || -> Result<(u32, u32, Vec<u8>), String> {
        let arc_bytes = std::sync::Arc::new(pdf_bytes.to_vec());
        let cache = crate::pdfium_renderer::PdfiumDocCache::default();
        let cache_key = format!("mcp:{:p}", arc_bytes.as_ptr());
        let handle = crate::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
            &cache_key, arc_bytes, &cache,
        )?;
        let doc = handle.document();
        let scale = {
            let pages = doc.pages();
            let page = pages
                .get(page_index as i32)
                .map_err(|e| format!("page_dimensions: {e}"))?;
            // Literal-width convention to match PyMuPDF reference renderer.
            width as f32 / page.width().value
        };
        crate::pdfium_renderer::render_page_to_rgba(doc, page_index as u32, scale, 0)
    })
    .await
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("render task panic: {e}")))?
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

    let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(
        render_width,
        render_height,
        &render_rgba,
    )
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("encode png: {e}")))?;

    let payload = json!({
        "png_base64": png_b64,
        "width":  render_width,
        "height": render_height,
    });

    Ok(json!({
        "content": [{
            "type": "text",
            "text": payload.to_string(),
        }],
        "isError": false,
    }))
}

/// `get_pdf_metadata` tool — reads the PDF version, producer/creator metadata,
/// and per-page MediaBox + rotation directly from the PDF structure via
/// `lopdf`. Used by the regression harness to confirm the rendered output
/// matches the source document's declared geometry.
///
/// In lopdf 0.34 `Document.version` is a plain `String` (e.g. `"1.4"`), so it
/// is returned verbatim as `pdf_version`. Producer/Creator are read from
/// `/Info`, which may be either a direct dict or an indirect reference; both
/// shapes are handled. MediaBox values may be PDF Integer or Real, and both
/// are coerced to `f32`.
async fn tool_get_pdf_metadata(
    _state: &AppState,
    arguments: &Value,
) -> Result<Value, (i32, String)> {
    let path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing 'path'".to_string()))?
        .to_string();

    // lopdf is sync; offload to spawn_blocking so we don't stall the runtime.
    let payload = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path))?;
        let doc = lopdf::Document::load_mem(&bytes).map_err(|e| format!("parse: {e}"))?;

        // lopdf 0.34: `Document.version` is `pub version: String` (e.g. "1.4").
        let pdf_version = doc.version.clone();

        // Producer / Creator from /Info
        let mut producer = String::new();
        let mut creator = String::new();
        if let Ok(info_ref) = doc.trailer.get(b"Info") {
            // /Info can be a direct dict OR an indirect reference. Resolve both.
            let info_dict_opt = if let Ok(reference) = info_ref.as_reference() {
                doc.get_object(reference).ok().and_then(|o| o.as_dict().ok())
            } else {
                info_ref.as_dict().ok()
            };
            if let Some(info) = info_dict_opt {
                let read_str = |key: &[u8]| -> String {
                    info.get(key)
                        .ok()
                        .and_then(|o| match o {
                            lopdf::Object::String(s, _) => {
                                Some(String::from_utf8_lossy(s).into_owned())
                            }
                            _ => None,
                        })
                        .unwrap_or_default()
                };
                producer = read_str(b"Producer");
                creator = read_str(b"Creator");
            }
        }

        // Per-page: index, mediabox, rotation
        let pages_map = doc.get_pages(); // BTreeMap<u32 page_num, ObjectId>
        let mut pages_json = Vec::with_capacity(pages_map.len());
        for (idx, (_page_num, page_id)) in pages_map.iter().enumerate() {
            let mut mediabox: Vec<f32> = Vec::new();
            let mut rotation: i64 = 0;
            if let Ok(p_dict) = doc.get_object(*page_id).and_then(|o| o.as_dict()) {
                if let Ok(arr) = p_dict.get(b"MediaBox").and_then(|o| o.as_array()) {
                    mediabox = arr
                        .iter()
                        .filter_map(|o| match o {
                            lopdf::Object::Integer(i) => Some(*i as f32),
                            lopdf::Object::Real(r) => Some(*r),
                            _ => None,
                        })
                        .collect();
                }
                rotation = p_dict
                    .get(b"Rotate")
                    .ok()
                    .and_then(|o| o.as_i64().ok())
                    .unwrap_or(0);
            }
            pages_json.push(json!({
                "index":    idx,
                "mediabox": mediabox,
                "rotation": rotation
            }));
        }

        Ok(json!({
            "pdf_version": pdf_version,
            "page_count":  pages_map.len(),
            "producer":    producer,
            "creator":     creator,
            "pages":       pages_json
        }))
    })
    .await
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("metadata task panic: {e}")))?
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

    Ok(json!({
        "content": [{ "type": "text", "text": payload.to_string() }],
        "isError": false
    }))
}

/// `screenshot_all` tool — renders every page of a PDF via PDFium and returns
/// each as a base64 PNG in a `pages` array. Pages are rendered serially to
/// keep memory bounded for large multi-page PDFs.
///
/// Page count is read once via `lopdf` so we know how many render passes to
/// schedule, then PDFium produces the raster for each page using the same
/// scaling convention as `screenshot_page`:
/// `scale = width / page_w_pt` (literal output width).
async fn tool_screenshot_all(
    _state: &AppState,
    arguments: &Value,
) -> Result<Value, (i32, String)> {
    let path = arguments
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (jsonrpc_error::INVALID_PARAMS, "missing 'path'".to_string()))?
        .to_string();
    let width = arguments
        .get("width")
        .and_then(|v| v.as_u64())
        .unwrap_or(2000) as u32;
    if width == 0 {
        return Err((jsonrpc_error::INVALID_PARAMS, "'width' must be > 0".to_string()));
    }

    // First, count pages via lopdf so we know how many render passes to do.
    let bytes = tokio::fs::read(&path).await.map_err(|e| {
        (jsonrpc_error::INTERNAL_ERROR, format!("read {}: {e}", path))
    })?;

    let total: usize = {
        let bytes_clone = bytes.clone();
        tokio::task::spawn_blocking(move || -> Result<usize, String> {
            let doc = lopdf::Document::load_mem(&bytes_clone)
                .map_err(|e| format!("parse: {e}"))?;
            Ok(doc.get_pages().len())
        })
        .await
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("count task panic: {e}")))?
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?
    };

    // Render every page sequentially. Parallelizing would help wall-clock time
    // but sticking to serial keeps memory bounded for big multi-page PDFs.
    let bytes_arc = std::sync::Arc::new(bytes);
    let mut pages_json: Vec<Value> = Vec::with_capacity(total);

    for idx in 0..total {
        let bytes_clone = bytes_arc.clone();
        let (rw, rh, rgba) = tokio::task::spawn_blocking(move || -> Result<(u32, u32, Vec<u8>), String> {
            let arc_bytes = bytes_clone;
            let cache = crate::pdfium_renderer::PdfiumDocCache::default();
            let cache_key = format!("mcp:{:p}", arc_bytes.as_ptr());
            let handle = crate::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
                &cache_key, arc_bytes, &cache,
            )?;
            let doc = handle.document();
            let scale = {
                let pages = doc.pages();
                let page = pages
                    .get(idx as i32)
                    .map_err(|e| format!("page_dimensions[{idx}]: {e}"))?;
                // Literal-width convention to match PyMuPDF reference renderer.
                width as f32 / page.width().value
            };
            crate::pdfium_renderer::render_page_to_rgba(doc, idx as u32, scale, 0)
        })
        .await
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("render task panic on page {idx}: {e}")))?
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, e))?;

        let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(
            rw,
            rh,
            &rgba,
        )
        .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("encode png[{idx}]: {e}")))?;

        pages_json.push(json!({
            "index":      idx,
            "png_base64": png_b64,
            "width":      rw,
            "height":     rh
        }));
    }

    Ok(json!({
        "content": [{
            "type": "text",
            "text": json!({ "pages": pages_json }).to_string()
        }],
        "isError": false
    }))
}

/// Alleen lokale clients: de Host moet 127.0.0.1/localhost op onze poort zijn
/// (tegen DNS-rebinding), en een eventuele Origin moet lokaal zijn (tegen een
/// website die via de browser de app probeert te besturen). De stdio-brug
/// stuurt geen Origin mee.
pub fn verzoek_toegestaan(headers: &axum::http::HeaderMap, poort: u16) -> bool {
    let lokaal = |host: &str| {
        let host = host.trim().to_ascii_lowercase();
        host == format!("127.0.0.1:{poort}") || host == format!("localhost:{poort}")
    };
    if let Some(h) = headers.get("host").and_then(|v| v.to_str().ok()) {
        if !lokaal(h) {
            return false;
        }
    }
    if let Some(o) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let o = o.trim().to_ascii_lowercase();
        let zonder_schema = o.split("://").nth(1).unwrap_or("");
        let host = zonder_schema.split(['/', ':']).next().unwrap_or("");
        if host != "127.0.0.1" && host != "localhost" {
            return false;
        }
    }
    true
}

/// Axum POST handler for `/mcp`. Parses the JSON-RPC envelope and dispatches
/// on the `method` field.
async fn mcp_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    // Pull out the request id; default to null so error responses are still
    // well-formed if the client omitted it.
    let id = body.get("id").cloned().unwrap_or(Value::Null);

    if !verzoek_toegestaan(&headers, state.poort) {
        return (
            StatusCode::FORBIDDEN,
            Json(rpc_error(
                id,
                jsonrpc_error::INVALID_REQUEST,
                "only local clients may use this server",
            )),
        );
    }

    let method = match body.get("method").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => {
            return (
                StatusCode::OK,
                Json(rpc_error(
                    id,
                    jsonrpc_error::INVALID_REQUEST,
                    "missing 'method' field",
                )),
            );
        }
    };

    let response = match method {
        "initialize" => rpc_result(id, handle_initialize()),
        "tools/list" => rpc_result(id, tools_list_voor(state.profiel)),
        "tools/call" => {
            let empty = Value::Null;
            let params = body.get("params").unwrap_or(&empty);
            let naam = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if !beschikbaar(naam, state.profiel) {
                rpc_error(
                    id,
                    jsonrpc_error::INVALID_PARAMS,
                    format!("tool '{naam}' is not available in this Open PDF Studio configuration"),
                )
            } else {
                match handle_tools_call(&state, params).await {
                    Ok(value) => rpc_result(id, value),
                    Err((code, msg)) => rpc_error(id, code, msg),
                }
            }
        }
        // `notifications/initialized` and other notification methods carry no
        // id and expect no response. We still send back an empty result for
        // robustness; the harness ignores unknown ids.
        "notifications/initialized" | "initialized" => rpc_result(id, json!({})),
        other => rpc_error(
            id,
            jsonrpc_error::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        ),
    };

    (StatusCode::OK, Json(response))
}

/// Start the MCP server. This is an async function that runs forever (until
/// the binding errors or the process exits). Callers should `tauri::async_
/// runtime::spawn` it from `lib::run` so the Tauri event loop continues.
///
/// In release builds, the server refuses to start unless `OPS_ENABLE_MCP=1`
/// is set in the environment.
pub async fn start(
    port: u16,
    test_pdfs_dir: PathBuf,
    app_handle: Option<AppHandle>,
) -> Result<(), String> {
    if !cfg!(debug_assertions) && std::env::var("OPS_ENABLE_MCP").as_deref() != Ok("1") {
        return Err(
            "MCP server refused to start: release build without OPS_ENABLE_MCP=1".into(),
        );
    }

    let state = AppState {
        test_pdfs_dir: Arc::new(test_pdfs_dir),
        app_handle,
        profiel: Profiel::Ontwikkeling,
        poort: port,
    };

    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("bad addr: {e}"))?;

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;

    eprintln!("MCP server listening on http://127.0.0.1:{port}/mcp");
    crate::mcp_koppeling::markeer_startvlag(port);

    serveer(listener, state, None).await
}

/// Serveert `/mcp` op een al gebonden listener. Met `stop` stopt de server
/// netjes zodra dat signaal komt (de instelling in de app gaat uit).
pub async fn serveer(
    listener: tokio::net::TcpListener,
    state: AppState,
    stop: Option<tokio::sync::oneshot::Receiver<()>>,
) -> Result<(), String> {
    let app = Router::new()
        .route("/mcp", post(mcp_handler))
        .with_state(state);
    let serve = axum::serve(listener, app);
    match stop {
        Some(rx) => serve.with_graceful_shutdown(async { let _ = rx.await; }).await,
        None => serve.await,
    }
    .map_err(|e| format!("MCP server error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alleen_lokale_verzoeken_worden_toegelaten() {
        use axum::http::{HeaderMap, HeaderValue};
        let kop = |paren: &[(&'static str, &'static str)]| {
            let mut h = HeaderMap::new();
            for (k, v) in paren {
                h.insert(*k, HeaderValue::from_static(v));
            }
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
        assert_eq!(arr.len(), 59);
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
        assert_eq!(
            alles["tools"].as_array().unwrap().len(),
            handle_tools_list()["tools"].as_array().unwrap().len()
        );
    }

    #[test]
    fn tools_json_van_de_brug_is_actueel() {
        use crate::mcp_tool_meta::Profiel;
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..").join("..").join("mcp-stdio").join("tools.json");
        let verwacht = tools_list_voor(Profiel::Publiek)["tools"].clone();
        if std::env::var("OPDS_MCPB_TOOLS_SCHRIJVEN").as_deref() == Ok("1") {
            std::fs::write(&pad, serde_json::to_string_pretty(&verwacht).unwrap() + "\n").unwrap();
        }
        let op_schijf: Value = serde_json::from_str(
            &std::fs::read_to_string(&pad)
                .expect("mcp-stdio/tools.json ontbreekt - draai met OPDS_MCPB_TOOLS_SCHRIJVEN=1"),
        )
        .unwrap();
        assert_eq!(op_schijf, verwacht, "mcp-stdio/tools.json loopt achter - draai met OPDS_MCPB_TOOLS_SCHRIJVEN=1");
    }

    #[test]
    fn annotatielagen_zijn_te_bedienen_via_mcp() {
        let v = handle_tools_list();
        let zoek = |naam: &str| {
            v["tools"].as_array().unwrap().iter()
                .find(|t| t["name"] == naam)
                .unwrap_or_else(|| panic!("{naam} staat in de lijst"))
                .clone()
        };
        assert_eq!(zoek("app_create_layer")["inputSchema"]["required"], json!(["name"]));
        assert_eq!(zoek("app_set_layer")["inputSchema"]["required"], json!(["layer"]));
        for naam in ["app_create_annotation", "app_update_annotation", "app_list_annotations"] {
            assert_eq!(zoek(naam)["inputSchema"]["properties"]["layer"]["type"], "string", "{naam} heeft een laag-argument");
        }
        use crate::mcp_tool_meta::meta;
        assert!(meta("app_list_layers").unwrap().alleen_lezen);
        let maak = meta("app_create_layer").unwrap();
        assert!(!maak.alleen_lezen && !maak.wijzigt);
        assert!(meta("app_set_layer").unwrap().wijzigt);
    }

    #[test]
    fn app_import_cad_beschrijft_de_import_zonder_venster() {
        let v = handle_tools_list();
        let tool = v["tools"].as_array().unwrap().iter()
            .find(|t| t["name"] == "app_import_cad")
            .expect("app_import_cad staat in de lijst");
        let schema = &tool["inputSchema"];
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"], json!(["path"]));
        let props = schema["properties"].as_object().unwrap();
        for naam in [
            "path", "space", "scale", "paper", "orientation", "marginMm", "placement", "rotation", "units",
            "layersOff", "layersOn", "target", "opacity", "colors", "hatch", "text", "xrefs", "images", "searchPaths",
        ] {
            assert!(props.contains_key(naam), "{naam} ontbreekt in het schema");
        }
        // De opdracht maakt altijd de echte PDF en kiest zelf waar die komt.
        for naam in ["preview", "outputPath"] {
            assert!(!props.contains_key(naam), "{naam} hoort niet in het schema");
        }
        assert_eq!(props["target"]["enum"], json!(["new", "append", "underlay"]));
        for (naam, p) in props {
            assert!(p["type"].is_string(), "{naam} zonder type");
        }
        // Voegt iets toe, wijzigt niets bestaands; ook in het publieke profiel.
        let m = crate::mcp_tool_meta::meta("app_import_cad").unwrap();
        assert!(!m.alleen_lezen && !m.wijzigt);
        let publiek = tools_list_voor(crate::mcp_tool_meta::Profiel::Publiek);
        assert!(publiek["tools"].as_array().unwrap().iter().any(|t| t["name"] == "app_import_cad"));
    }

    #[test]
    fn app_export_cad_beschrijft_de_export_zonder_venster() {
        let v = handle_tools_list();
        let tool = v["tools"].as_array().unwrap().iter()
            .find(|t| t["name"] == "app_export_cad")
            .expect("app_export_cad staat in de lijst");
        let schema = &tool["inputSchema"];
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"], json!(["path"]));
        let props = schema["properties"].as_object().unwrap();
        for naam in ["path", "pages", "format", "origin", "area", "annotations", "scaleMode", "scale", "layers", "units", "layersOff", "allowLarge"] {
            assert!(props.contains_key(naam), "{naam} ontbreekt in het schema");
        }
        assert_eq!(props["origin"]["enum"], json!(["page", "area", "model"]));
        assert_eq!(props["format"]["enum"], json!(["dxf", "dxf_binary", "dwg"]));
        for (naam, p) in props {
            assert!(p["type"].is_string(), "{naam} zonder type");
        }
        // Schrijft een bestand: wijzigt, en staat in het publieke profiel.
        let m = crate::mcp_tool_meta::meta("app_export_cad").unwrap();
        assert!(!m.alleen_lezen && m.wijzigt);
        let publiek = tools_list_voor(crate::mcp_tool_meta::Profiel::Publiek);
        assert!(publiek["tools"].as_array().unwrap().iter().any(|t| t["name"] == "app_export_cad"));
    }

    #[test]
    fn printgereedschappen_beschrijven_het_afdrukken_zonder_venster() {
        let v = handle_tools_list();
        let zoek = |naam: &str| {
            v["tools"].as_array().unwrap().iter()
                .find(|t| t["name"] == naam)
                .unwrap_or_else(|| panic!("{naam} staat in de lijst"))
                .clone()
        };

        let bestand = zoek("app_print_to_pdf");
        assert_eq!(bestand["inputSchema"]["required"], json!(["path"]));
        let printer = zoek("app_print");
        assert_eq!(printer["inputSchema"]["required"], json!(["printer"]));
        for tool in [&bestand, &printer] {
            let schema = &tool["inputSchema"];
            assert_eq!(schema["type"], "object");
            assert_eq!(schema["additionalProperties"], false);
            let props = schema["properties"].as_object().unwrap();
            for naam in ["pages", "paper", "orientation", "autoRotate", "scaling", "zoom", "center", "content"] {
                assert!(props.contains_key(naam), "{naam} ontbreekt in {}", tool["name"]);
            }
            for (naam, p) in props {
                assert!(p["type"].is_string(), "{naam} zonder type");
            }
            assert_eq!(props["scaling"]["enum"], json!(["fit", "shrink", "actual", "custom-scale"]));
            assert_eq!(props["content"]["enum"], json!(["document", "document-and-markups"]));
            assert_eq!(props["orientation"]["enum"], json!(["auto", "portrait", "landscape"]));
        }
        // Het aantal exemplaren hoort bij een printer, het doelbestand niet.
        let naar_bestand = bestand["inputSchema"]["properties"].as_object().unwrap();
        let naar_printer = printer["inputSchema"]["properties"].as_object().unwrap();
        assert!(!naar_bestand.contains_key("copies") && !naar_bestand.contains_key("printer"));
        assert!(naar_printer.contains_key("copies") && !naar_printer.contains_key("path"));
        // Elk gereedschap kent één eigen velkeuze; de formaten zijn dezelfde.
        assert_eq!(naar_bestand["paper"]["enum"][0], "page");
        assert_eq!(naar_printer["paper"]["enum"][0], "printer");
        let bestand_formaten = &naar_bestand["paper"]["enum"].as_array().unwrap()[1..];
        let printer_formaten = &naar_printer["paper"]["enum"].as_array().unwrap()[1..];
        assert_eq!(bestand_formaten, printer_formaten);
        assert_eq!(bestand_formaten.len(), PRINT_PAPIERFORMATEN.len());

        // Alleen lezen, en geen argumenten.
        let lijst = zoek("app_list_printers");
        assert_eq!(lijst["inputSchema"]["additionalProperties"], false);
        assert!(lijst["inputSchema"]["properties"].as_object().unwrap().is_empty());
        assert!(crate::mcp_tool_meta::meta("app_list_printers").unwrap().alleen_lezen);
        // Afdrukken raakt het document niet, maar schrijft een bestand of laat
        // papier uit een printer komen: wijzigt, dus Claude vraagt erom.
        for naam in ["app_print_to_pdf", "app_print"] {
            let m = crate::mcp_tool_meta::meta(naam).unwrap();
            assert!(!m.alleen_lezen && m.wijzigt, "{naam} moet als wijzigend gelden");
        }
        // Alle drie horen in het publieke profiel.
        let publiek = tools_list_voor(crate::mcp_tool_meta::Profiel::Publiek);
        for naam in ["app_print_to_pdf", "app_print", "app_list_printers"] {
            assert!(publiek["tools"].as_array().unwrap().iter().any(|t| t["name"] == naam), "{naam}");
        }
    }

    #[test]
    fn initialize_response_shape() {
        let v = handle_initialize();
        assert_eq!(v["serverInfo"]["name"], "open-pdf-studio");
        assert_eq!(v["serverInfo"]["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(v["capabilities"]["tools"]["listChanged"], false);
        assert_eq!(v["protocolVersion"], "2025-03-26");
    }

    #[test]
    fn tools_list_advertises_list_test_pdfs() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools must be an array");
        assert!(
            arr.iter().any(|t| t["name"] == "list_test_pdfs"),
            "tools list must advertise list_test_pdfs, got: {arr:?}"
        );
        let tool = arr
            .iter()
            .find(|t| t["name"] == "list_test_pdfs")
            .expect("descriptor present");
        assert_eq!(tool["inputSchema"]["type"], "object");
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    }

    #[test]
    fn resolve_test_pdfs_dir_prefers_explicit_override() {
        let fixture = PathBuf::from("render-fixtures");
        assert_eq!(resolve_test_pdfs_dir(Some(fixture.clone())), fixture);
    }

    #[test]
    fn resolve_test_pdfs_dir_defaults_to_repository_corpus() {
        let expected = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("test pdf-bestanden")
            .join("Originele bestanden");

        assert_eq!(resolve_test_pdfs_dir(None), expected);
    }

    /// Exercises the real `tool_list_test_pdfs` over a fixture directory.
    /// We point `AppState.test_pdfs_dir` at the repo's actual test corpus
    /// (`../../test pdf-bestanden/Originele bestanden`) so this also serves
    /// as a smoke test when the GUI binary cannot be launched.
    #[test]
    fn tool_list_test_pdfs_returns_corpus_entries() {
        // Resolve corpus relative to this crate's manifest dir so the test is
        // CWD-independent.
        let corpus = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.is_dir() {
            // Skip gracefully if the corpus isn't checked in on this clone.
            eprintln!("skipping: corpus dir not found at {:?}", corpus);
            return;
        }

        let state = AppState {
            test_pdfs_dir: Arc::new(corpus),
            app_handle: None,
            profiel: Profiel::Ontwikkeling,
            poort: 9223,
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        let value = rt
            .block_on(tool_list_test_pdfs(&state))
            .expect("tool_list_test_pdfs ok");

        assert_eq!(value["isError"], false);
        let text = value["content"][0]["text"]
            .as_str()
            .expect("text content present");
        let payload: Value =
            serde_json::from_str(text).expect("text payload is valid JSON");
        let pdfs = payload["pdfs"].as_array().expect("pdfs is an array");
        assert!(
            !pdfs.is_empty(),
            "expected at least one PDF in the corpus, got payload {payload}"
        );
        for entry in pdfs {
            assert!(entry["path"].is_string(), "path is string");
            assert!(entry["file_size"].is_u64(), "file_size is unsigned int");
            assert!(
                entry["page_count"].as_u64().unwrap_or(0) > 0,
                "page_count > 0 for {}",
                entry["path"]
            );
        }
    }

    #[test]
    fn tools_list_advertises_screenshot_page() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools must be an array");
        let tool = arr
            .iter()
            .find(|t| t["name"] == "screenshot_page")
            .expect("screenshot_page descriptor present");
        assert_eq!(tool["inputSchema"]["type"], "object");
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
        let required = tool["inputSchema"]["required"]
            .as_array()
            .expect("required is array");
        let names: Vec<&str> = required.iter().filter_map(|v| v.as_str()).collect();
        assert!(names.contains(&"path"));
        assert!(names.contains(&"page_index"));
    }

    #[tokio::test]
    async fn tool_screenshot_page_returns_png_base64() {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // CARGO_MANIFEST_DIR is `<repo>/open-pdf-studio/src-tauri`. The corpus
        // sits at `<repo>/test pdf-bestanden/Originele bestanden/`.
        let corpus = manifest_dir
            .ancestors()
            .nth(2)
            .unwrap()
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.exists() {
            eprintln!("[skip] corpus dir missing at {:?}", corpus);
            return;
        }
        // Pick the smallest PDF deterministically.
        let mut pdfs: Vec<_> = std::fs::read_dir(&corpus).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("pdf"))
            .collect();
        pdfs.sort_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(u64::MAX));
        let smallest = pdfs.first().expect("no pdfs in corpus").clone();

        let state = AppState { test_pdfs_dir: std::sync::Arc::new(corpus), app_handle: None, profiel: Profiel::Ontwikkeling, poort: 9223 };
        let args = serde_json::json!({
            "path": smallest.to_string_lossy(),
            "page_index": 0,
            "width": 200
        });
        let result = tool_screenshot_page(&state, &args).await.expect("render ok");
        assert_eq!(result["isError"], serde_json::Value::Bool(false));
        let text = result["content"][0]["text"].as_str().unwrap();
        let body: serde_json::Value = serde_json::from_str(text).unwrap();
        let b64 = body["png_base64"].as_str().unwrap();
        assert!(b64.starts_with("iVBORw0KGgo"), "expected png magic; got {}", &b64[..20]);
        assert!(body["width"].as_u64().unwrap() > 0);
    }

    #[test]
    fn tools_list_advertises_get_pdf_metadata() {
        let v = handle_tools_list();
        let names: Vec<&str> = v["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"get_pdf_metadata"));
    }

    #[tokio::test]
    async fn tool_get_pdf_metadata_returns_version_and_pages() {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let corpus = manifest_dir
            .ancestors()
            .nth(2)
            .unwrap()
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.exists() {
            eprintln!("[skip] corpus dir missing at {:?}", corpus);
            return;
        }
        // Pick "Technische tekening.pdf" — a known /Rotate=90 file with multi-page content.
        let pdf = corpus.join("Technische tekening.pdf");
        if !pdf.exists() {
            eprintln!("[skip] expected test pdf missing: {:?}", pdf);
            return;
        }

        let state = AppState {
            test_pdfs_dir: std::sync::Arc::new(corpus),
            app_handle: None,
            profiel: Profiel::Ontwikkeling,
            poort: 9223,
        };
        let args = serde_json::json!({ "path": pdf.to_string_lossy() });
        let result = tool_get_pdf_metadata(&state, &args).await.expect("metadata ok");
        assert_eq!(result["isError"], serde_json::Value::Bool(false));

        let text = result["content"][0]["text"].as_str().unwrap();
        let body: serde_json::Value = serde_json::from_str(text).unwrap();
        assert!(body["pdf_version"].as_str().unwrap().starts_with("1."));
        let page_count = body["page_count"].as_u64().unwrap();
        assert!(page_count >= 1, "expected at least 1 page");
        let pages = body["pages"].as_array().unwrap();
        assert_eq!(pages.len() as u64, page_count);
        // Page 0 of Technische tekening.pdf has /Rotate 90 in the source PDF.
        let rot0 = pages[0]["rotation"].as_i64().unwrap();
        assert_eq!(rot0, 90, "Technische tekening.pdf page 0 should have /Rotate 90");
        let mediabox = pages[0]["mediabox"].as_array().unwrap();
        assert_eq!(mediabox.len(), 4, "MediaBox should be 4 numbers");
    }

    #[test]
    fn tools_list_advertises_screenshot_all() {
        let v = handle_tools_list();
        let names: Vec<&str> = v["tools"].as_array().unwrap().iter()
            .map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"screenshot_all"));
    }

    #[tokio::test]
    async fn tool_screenshot_all_renders_every_page() {
        use std::path::PathBuf;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let corpus = manifest_dir
            .ancestors()
            .nth(2)
            .unwrap()
            .join("test pdf-bestanden")
            .join("Originele bestanden");
        if !corpus.exists() {
            eprintln!("[skip] corpus dir missing");
            return;
        }
        // Pick the smallest multi-page-or-one PDF so the test runs fast.
        let pdfs: Vec<_> = std::fs::read_dir(&corpus).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("pdf"))
            .collect();
        let smallest = pdfs.iter()
            .min_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(u64::MAX))
            .expect("no pdfs in corpus")
            .clone();

        let state = AppState { test_pdfs_dir: std::sync::Arc::new(corpus), app_handle: None, profiel: Profiel::Ontwikkeling, poort: 9223 };
        let args = serde_json::json!({
            "path": smallest.to_string_lossy(),
            "width": 200
        });
        let result = tool_screenshot_all(&state, &args).await.expect("render ok");
        assert_eq!(result["isError"], serde_json::Value::Bool(false));
        let text = result["content"][0]["text"].as_str().unwrap();
        let body: serde_json::Value = serde_json::from_str(text).unwrap();
        let pages = body["pages"].as_array().unwrap();
        assert!(!pages.is_empty(), "should have at least one page");
        for (i, p) in pages.iter().enumerate() {
            assert_eq!(p["index"].as_u64().unwrap(), i as u64);
            let b64 = p["png_base64"].as_str().unwrap();
            assert!(b64.starts_with("iVBORw0KGgo"), "page {i} not a valid png");
            assert!(p["width"].as_u64().unwrap() > 0);
            assert!(p["height"].as_u64().unwrap() > 0);
        }
    }

    /// Confirms every new mouse + keyboard tool is registered with a
    /// well-formed input schema. Catches drift between the descriptor
    /// list and the dispatch arms.
    #[test]
    fn tools_list_advertises_input_tools() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools is an array");
        let names: Vec<&str> = arr.iter().map(|t| t["name"].as_str().unwrap()).collect();
        for tool in [
            "app_mouse_move",
            "app_mouse_click",
            "app_mouse_drag",
            "app_scroll",
            "app_key",
            "app_type",
        ] {
            assert!(names.contains(&tool), "missing tool: {tool} (got {names:?})");
            let descr = arr.iter().find(|t| t["name"] == tool).unwrap();
            assert_eq!(
                descr["inputSchema"]["type"], "object",
                "{tool} schema must be an object"
            );
            assert_eq!(
                descr["inputSchema"]["additionalProperties"], false,
                "{tool} should reject unknown fields"
            );
        }
    }

    /// Confirms every app-control tool (tools/annotations/tabs/view/scale)
    /// is registered with a well-formed input schema. Catches drift between
    /// the descriptor list and the dispatch arms.
    #[test]
    fn tools_list_advertises_app_control_tools() {
        let v = handle_tools_list();
        let arr = v["tools"].as_array().expect("tools is an array");
        let names: Vec<&str> = arr.iter().map(|t| t["name"].as_str().unwrap()).collect();
        for tool in [
            "app_set_tool",
            "app_get_current_tool",
            "app_click_element",
            "app_ui_state",
            "app_set_window_size",
            "app_assistant_ask",
            "app_assistant_pending",
            "app_assistant_answer",
            "app_assistant_history",
            "app_create_annotation",
            "app_list_annotations",
            "app_get_annotation",
            "app_update_annotation",
            "app_delete_annotation",
            "app_select_annotation",
            "app_clear_selection",
            "app_undo",
            "app_redo",
            "app_list_tabs",
            "app_switch_tab",
            "app_close_tab",
            "app_new_blank_pdf",
            "app_save_pdf",
            "app_set_view_mode",
            "app_fit_page",
            "app_fit_width",
            "app_get_page_count",
            "app_set_measure_scale",
            "app_get_takeoff",
            "app_place_schedule",
            "app_structural_layout",
            "app_list_commands",
            "app_run_command",
            "app_snippet_cut",
            "app_snippet_paste",
            "app_snippet_flatten",
            "app_symbol_scale",
            "app_titleblock",
            "app_floorplan",
            "app_facade_element",
            "app_import_cad",
            "app_export_cad",
            "app_print_to_pdf",
            "app_print",
            "app_list_printers",
            "app_list_layers",
            "app_create_layer",
            "app_set_layer",
        ] {
            assert!(names.contains(&tool), "missing tool: {tool} (got {names:?})");
            let descr = arr.iter().find(|t| t["name"] == tool).unwrap();
            assert_eq!(
                descr["inputSchema"]["type"], "object",
                "{tool} schema must be an object"
            );
            assert_eq!(
                descr["inputSchema"]["additionalProperties"], false,
                "{tool} should reject unknown fields"
            );
        }
    }

    /// Sanity-check that calling an `app_*` tool without an AppHandle
    /// returns an error rather than panicking. Same harness pattern as
    /// the original 5 app_* tools.
    #[tokio::test]
    async fn input_tools_without_app_handle_return_error() {
        let state = AppState {
            test_pdfs_dir: std::sync::Arc::new(std::path::PathBuf::from(".")),
            app_handle: None,
            profiel: Profiel::Ontwikkeling,
            poort: 9223,
        };
        for (name, args) in [
            ("app_mouse_move",  serde_json::json!({"x": 100, "y": 100})),
            ("app_mouse_click", serde_json::json!({"x": 100, "y": 100})),
            ("app_mouse_drag",  serde_json::json!({"x1": 0, "y1": 0, "x2": 1, "y2": 1})),
            ("app_scroll",      serde_json::json!({"x": 100, "y": 100, "dy": -1})),
            ("app_key",         serde_json::json!({"key": "Escape"})),
            ("app_type",        serde_json::json!({"text": "x"})),
        ] {
            let params = serde_json::json!({"name": name, "arguments": args});
            let result = handle_tools_call(&state, &params).await;
            assert!(result.is_err(), "{name} must return Err without an AppHandle");
            let (_code, msg) = result.unwrap_err();
            assert!(
                msg.contains("AppHandle unavailable"),
                "{name} message should explain missing AppHandle, got: {msg}"
            );
        }
    }
}
