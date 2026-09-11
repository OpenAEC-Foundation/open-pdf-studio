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
