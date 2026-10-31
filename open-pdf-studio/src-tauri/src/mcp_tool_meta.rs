//! Per MCP-gereedschap: titel, of het alleen leest of iets wijzigt, en in welk
//! profiel het beschikbaar is. De extensiebibliotheek van Claude eist op elk
//! gereedschap een titel en een lees- of wijzighint; het publieke profiel laat
//! het ontwikkelgereedschap weg.
//!
//! Een nieuw gereedschap in `mcp_server.rs` hoort hier ook een regel te
//! krijgen — de test `elk_gereedschap_staat_in_de_metatabel_en_omgekeerd`
//! bewaakt dat.

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
    // Writes a file only when a path is given; never changes the document.
    voegt_toe("app_capture_region", "Capture page area as image"),
    lees("app_get_viewport_state", "Get view state"),
    lees("app_get_current_tool", "Get current tool"),
    lees("app_list_annotations", "List annotations"),
    lees("app_get_annotation", "Get annotation"),
    lees("app_list_tabs", "List document tabs"),
    lees("app_get_page_count", "Get page count"),
    lees("app_search_documents", "Search documents"),
    wijzigt("app_locations", "Manage spatial locations"),
    voegt_toe("app_hidden_information", "Inspect and export cleaned copy"),
    voegt_toe("app_print_preflight", "Inspect print readiness"),
    wijzigt("app_review_ocr", "Verify OCR text"),
    // Writes collection components chosen by the client to disk and reads
    // named local files into a copy.
    wijzigt("app_portfolio", "Manage PDF collections"),
    voegt_toe("app_recognize_form", "Recognize form fields"),
    voegt_toe("app_search_symbols", "Find repeated symbols"),
    wijzigt("app_workbook_bindings", "Refresh spreadsheet quantities"),
    // watch starts background automation on a folder; remove deletes saved workflows.
    wijzigt("app_document_workflows", "Run document workflows"),
    // import replaces the current set manifest, including its history.
    wijzigt("app_drawing_sets", "Drawing sets"),
    voegt_toe("app_sheet_links", "Cross-sheet links"),
    // receipt, cancel and supersede are irreversible audit events.
    wijzigt("app_approval_routing", "Approval routing"),
    lees("app_get_page_text", "Read existing page text"),
    lees("app_get_takeoff", "Get quantity take-off"),
    lees("app_list_commands", "List app commands"),
    // Leest de interface; wisselt geen linttabblad (#584).
    lees("app_read_ui", "Read interface state"),
    lees("app_assistant_history", "Get assistant conversation"),
    lees("app_list_printers", "List printers"),
    lees("app_list_layers", "List markup layers"),
    lees("app_list_system_types", "List system types"),
    // Opent alleen de editor: de gebruiker past toe of annuleert in de app.
    lees("app_open_system_type_editor", "Open system type editor"),
    lees("app_get_system_geometry", "Get system geometry"),
    lees("app_list_extensions", "List extensions"),
    // Voegt iets toe zonder bestaande gegevens te wijzigen.
    voegt_toe("app_new_blank_pdf", "New blank PDF"),
    voegt_toe("app_create_annotation", "Create annotation"),
    voegt_toe("app_create_layer", "Create markup layer"),
    voegt_toe("app_snippet_cut", "Cut vector snippet"),
    voegt_toe("app_snippet_paste", "Paste vector snippet"),
    voegt_toe("app_place_schedule", "Place quantity schedule"),
    voegt_toe("app_structural_layout", "Set out structural layout"),
    voegt_toe("app_merge_pdf", "Merge PDF files"),
    voegt_toe("app_insert_blank_pages", "Insert blank pages"),
    voegt_toe("app_import_cad", "Import CAD drawing"),
    voegt_toe("app_symbol_scale", "Symbol placement scale"),
    voegt_toe("app_assistant_ask", "Ask assistant"),
    voegt_toe("app_assistant_pending", "Take pending assistant question"),
    voegt_toe("app_assistant_answer", "Answer assistant question"),
    // Agenttaken (#556): verandert alleen de taakwachtrij; een resultaat is een
    // voorstel dat de extensie zelf toepast.
    voegt_toe("app_agent_task_pending", "Take pending agent task"),
    voegt_toe("app_agent_task_result", "Answer agent task"),
    voegt_toe("app_mouse_move", "Move pointer"),
    voegt_toe("app_scroll", "Scroll"),
    // Herladen verliest geen gegevens: dezelfde extensie draait daarna opnieuw.
    voegt_toe("app_reload_extension", "Reload extension"),
    // Wijzigt of verwijdert bestaande inhoud, of schrijft een bestand.
    wijzigt("app_update_annotation", "Update annotation"),
    wijzigt("app_set_layer", "Change markup layer"),
    wijzigt("app_update_system_type", "Update system type"),
    // Een extensieopdracht kan bestaande inhoud wijzigen (#575); de eigen
    // ext_-tools krijgen hun hints van de opdracht zelf (mcp_extensie_tools.rs).
    wijzigt("app_call_extension_command", "Run extension command"),
    // Registreren kan een bestaande, onbewerkte mcp:-definitie vervangen en
    // alle systemen met dat type hertekenen: dat wijzigt bestaande gegevens.
    wijzigt("app_register_system_type", "Register system type"),
    // Installeren kan een bestaande installatie vervangen (#550).
    wijzigt("app_install_extension", "Install extension"),
    wijzigt("app_delete_annotation", "Delete annotation"),
    wijzigt("app_undo", "Undo"),
    wijzigt("app_redo", "Redo"),
    wijzigt("app_close_tab", "Close document tab"),
    wijzigt("app_save_pdf", "Save PDF"),
    wijzigt("app_replace_text", "Replace existing page text"),
    wijzigt("app_translate_page", "Replace page text in bulk"),
    wijzigt("app_export_cad", "Export to CAD drawing"),
    wijzigt("app_export_ifcx", "Export to IFCX (beta)"),
    // Afdrukken laat het document ongemoeid, maar is geen leesactie: de ene
    // schrijft een bestand dat een bestaand bestand kan overschrijven, de
    // andere laat papier uit een printer komen. Allebei onomkeerbaar buiten de
    // app, dus wijzigt (destructiveHint) — Claude vraagt er altijd voor.
    wijzigt("app_print_to_pdf", "Print to PDF file"),
    wijzigt("app_print", "Print to printer"),
    // Paginabewerkingen: wijzigen of verwijderen bestaande pagina's; uitnemen
    // schrijft een bestand dat de client kiest.
    wijzigt("app_rotate_pages", "Rotate pages"),
    wijzigt("app_delete_pages", "Delete pages"),
    wijzigt("app_extract_pages", "Extract pages to a new file"),
    wijzigt("app_reorder_pages", "Reorder pages"),
    wijzigt("app_shift_pages", "Shift page content"),
    // delete en remove verwijderen bestaande bladwijzers en watermerken.
    wijzigt("app_bookmarks", "Manage bookmarks"),
    wijzigt("app_watermarks", "Manage watermarks and headers/footers"),
    wijzigt("app_set_measure_scale", "Set measurement scale"),
    wijzigt("app_snippet_flatten", "Flatten vector snippet"),
    wijzigt("app_titleblock", "Fill title block"),
    wijzigt("app_floorplan", "Draw floor plan"),
    wijzigt("app_facade_element", "Draw facade element"),
    wijzigt("app_run_command", "Run app command"),
    wijzigt("app_click_element", "Click interface element"),
    wijzigt("app_mouse_click", "Click"),
    wijzigt("app_mouse_drag", "Drag"),
    wijzigt("app_key", "Press key"),
    wijzigt("app_type", "Type text"),
    // Alleen in de ontwikkelroute: testgereedschap, en de interne koppeling met
    // het OpenAEC-account (app_accounts_fetch is een generieke API-aanroep met
    // een methode-parameter — hoort niet in een openbaar profiel).
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
/// Een naam die (nog) niet in de tabel staat, alleen in de ontwikkelroute.
pub fn beschikbaar(naam: &str, profiel: Profiel) -> bool {
    match (meta(naam), profiel) {
        (_, Profiel::Ontwikkeling) => true,
        (Some(m), Profiel::Publiek) => !m.alleen_ontwikkeling,
        (None, Profiel::Publiek) => false,
    }
}
