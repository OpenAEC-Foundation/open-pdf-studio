//! Beheerde modus: de app draait in een centraal beheerde omgeving (zoals de
//! OpenAEC-werkplek, een container per gebruiker) en stelt bij het opstarten
//! geen eenmalige vragen. Aan met de omgevingsvariabele `OPENAEC_BEHEERD=1`.
//!
//! Rust leest de variabele één keer en geeft hem aan de frontend via het
//! commando `managed_mode`; js/core/beheerd.js beslist daarmee per melding.
//! Zonder de variabele verandert er niets.

use std::sync::OnceLock;

/// Naam van de omgevingsvariabele.
pub const OMGEVINGSVARIABELE: &str = "OPENAEC_BEHEERD";

/// Is deze waarde "aan"? `1`, `true`, `yes`, `on`, `ja` (hoofdletterongevoelig,
/// spaties eromheen tellen niet). Alles anders, ook leeg, is uit.
pub fn waarde_is_aan(waarde: Option<&str>) -> bool {
    match waarde {
        None => false,
        Some(w) => matches!(
            w.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on" | "ja"
        ),
    }
}

/// Staat de beheerde modus aan? Eén keer gelezen, daarna uit het geheugen.
pub fn is_beheerd() -> bool {
    static AAN: OnceLock<bool> = OnceLock::new();
    *AAN.get_or_init(|| waarde_is_aan(std::env::var(OMGEVINGSVARIABELE).ok().as_deref()))
}

/// Voor de frontend: staat de beheerde modus aan?
#[tauri::command]
pub fn managed_mode() -> bool {
    is_beheerd()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alleen_een_ware_waarde_zet_de_modus_aan() {
        for aan in ["1", "true", "TRUE", " yes ", "on", "Ja"] {
            assert!(waarde_is_aan(Some(aan)), "{aan:?} moet aan zijn");
        }
        for uit in ["", "0", "false", "no", "off", "nee", "2", "beheerd"] {
            assert!(!waarde_is_aan(Some(uit)), "{uit:?} moet uit zijn");
        }
        assert!(!waarde_is_aan(None));
    }
}
