//! Signaal voor de statusbalk: de MCP-server meldt elke binnenkomende
//! tool-aanroep (en elke `initialize`, het moment waarop een client zich
//! aanmeldt) als een licht Tauri-event `mcp-activity`. Het event draagt alleen
//! de soort, de naam van het gereedschap, de poort en een tijdstempel: nooit
//! argumenten of documentinhoud.
//!
//! De transportlaag is gewoon HTTP-verzoek/antwoord zonder blijvende
//! verbinding; een "verbreken" bestaat daar niet en wordt dus ook niet gemeld.
//! De statusbalk leidt "verbonden" af uit recente activiteit.
//!
//! Een client die in een korte tijd veel aanroepen doet, krijgt niet één
//! event per aanroep: binnen `MIN_TUSSENPOOS` gaat er hooguit één weg, en de
//! laatste aanroep uit zo'n reeks volgt direct na afloop (zodat de getoonde
//! "laatste tool" klopt).
//!
//! Daarnaast meldt `mcp-status` dat de server aan of uit ging (zie
//! mcp_koppeling.rs), zodat de statusbalk niet hoeft te pollen.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Naam van het activiteitsevent.
pub const EVENT_ACTIVITEIT: &str = "mcp-activity";
/// Naam van het statusevent (server aan/uit).
pub const EVENT_STATUS: &str = "mcp-status";
/// Hooguit één activiteitsevent per tussenpoos.
pub const MIN_TUSSENPOOS: Duration = Duration::from_millis(250);
/// Een toolnaam is kort en bestaat uit veilige tekens; alles anders wordt
/// niet doorgegeven.
const MAX_NAAMLENGTE: usize = 96;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Activiteit {
    /// `"call"` (tool-aanroep) of `"connect"` (`initialize`).
    pub kind: &'static str,
    /// Naam van het gereedschap; `None` bij `connect` of een ongeldige naam.
    pub tool: Option<String>,
    pub port: u16,
    /// Milliseconden sinds 1970 (UTC).
    pub at: u64,
}

/// Alleen een nette toolnaam doorgeven: letters, cijfers, `_`, `-`, `.`.
/// Een client kan elke tekst als naam sturen; die hoort niet in de UI.
pub fn veilige_toolnaam(naam: &str) -> Option<String> {
    let naam = naam.trim();
    if naam.is_empty() || naam.len() > MAX_NAAMLENGTE {
        return None;
    }
    if naam.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) {
        Some(naam.to_string())
    } else {
        None
    }
}

/// Wanneer mag het volgende event weg? `None` = nu; anders na de wachttijd.
pub fn wachttijd(vorige: Option<Instant>, nu: Instant, min: Duration) -> Option<Duration> {
    match vorige {
        None => None,
        Some(v) => {
            let verstreken = nu.saturating_duration_since(v);
            if verstreken >= min { None } else { Some(min - verstreken) }
        }
    }
}

struct Smoorklep {
    laatste: Option<Instant>,
    wachtend: Option<Activiteit>,
    gepland: bool,
}

static KLEP: Mutex<Smoorklep> = Mutex::new(Smoorklep { laatste: None, wachtend: None, gepland: false });

fn nu_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn zend(app: &AppHandle, a: &Activiteit) {
    let _ = app.emit(EVENT_ACTIVITEIT, a);
}

/// Meld activiteit. Zonder AppHandle (unit-tests) gebeurt er niets.
pub fn meld(app: Option<&AppHandle>, kind: &'static str, tool: Option<&str>, port: u16) {
    let Some(app) = app else { return };
    let activiteit = Activiteit {
        kind,
        tool: tool.and_then(veilige_toolnaam),
        port,
        at: nu_ms(),
    };
    let nu = Instant::now();
    let mut klep = match KLEP.lock() {
        Ok(k) => k,
        Err(p) => p.into_inner(),
    };
    match wachttijd(klep.laatste, nu, MIN_TUSSENPOOS) {
        None if !klep.gepland => {
            klep.laatste = Some(nu);
            drop(klep);
            zend(app, &activiteit);
        }
        wacht => {
            // Er loopt al een uitgestelde verzending, of de vorige was te
            // kort geleden: alleen de nieuwste bewaren.
            klep.wachtend = Some(activiteit);
            if !klep.gepland {
                klep.gepland = true;
                let wacht = wacht.unwrap_or(MIN_TUSSENPOOS);
                let app = app.clone();
                drop(klep);
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(wacht).await;
                    let a = {
                        let mut klep = match KLEP.lock() {
                            Ok(k) => k,
                            Err(p) => p.into_inner(),
                        };
                        klep.gepland = false;
                        klep.laatste = Some(Instant::now());
                        klep.wachtend.take()
                    };
                    if let Some(a) = a {
                        zend(&app, &a);
                    }
                });
            }
        }
    }
}

/// Meld de serverstatus (`mcp_koppeling::mcp_status`-vorm) aan de frontend.
pub fn meld_status(app: &AppHandle, status: &serde_json::Value) {
    let _ = app.emit(EVENT_STATUS, status);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toolnamen_worden_gefilterd() {
        assert_eq!(veilige_toolnaam("app_open_pdf").as_deref(), Some("app_open_pdf"));
        assert_eq!(veilige_toolnaam("ext_demo__run-1.2").as_deref(), Some("ext_demo__run-1.2"));
        assert_eq!(veilige_toolnaam(""), None);
        assert_eq!(veilige_toolnaam("app open"), None);
        assert_eq!(veilige_toolnaam("<script>"), None);
        assert_eq!(veilige_toolnaam(&"a".repeat(97)), None);
    }

    #[test]
    fn smoorklep_laat_het_eerste_event_direct_door() {
        let nu = Instant::now();
        assert_eq!(wachttijd(None, nu, MIN_TUSSENPOOS), None);
        assert_eq!(wachttijd(Some(nu - Duration::from_millis(300)), nu, MIN_TUSSENPOOS), None);
        assert_eq!(
            wachttijd(Some(nu - Duration::from_millis(100)), nu, MIN_TUSSENPOOS),
            Some(Duration::from_millis(150))
        );
    }

    #[test]
    fn event_bevat_geen_argumenten() {
        let a = Activiteit { kind: "call", tool: Some("app_get_page_text".into()), port: 9223, at: 1 };
        let v = serde_json::to_value(&a).unwrap();
        let mut sleutels: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        sleutels.sort();
        assert_eq!(sleutels, vec!["at", "kind", "port", "tool"]);
    }
}
