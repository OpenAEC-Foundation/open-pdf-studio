//! Rechtermuisknop-acties in Verkenner (#945): "Combineren tot één PDF",
//! "Omzetten naar PDF" en "Omzetten en combineren".
//!
//! De installer (nsis/hooks.nsh) zet klassieke shell-verbs onder
//! `Software\Classes\SystemFileAssociations\<ext>\shell\OpenPDFStudio.*` met
//! als opdracht `open-pdf-studio.exe --combine|--convert-combine|--convert-to-pdf "%1"`.
//!
//! Verkenner start de app EEN keer per geselecteerd bestand. De eerste start
//! houdt zijn eigen actie; de latere starts bereiken de draaiende app via de
//! single-instance-plugin (lib.rs). Elke actie gaat hier in een WACHTRIJ en de
//! frontend krijgt alleen een seintje (`shell-action`); hij haalt de rij op
//! met `get_shell_action` zodra hij klaar is. Een actie die binnenkomt terwijl
//! het venster nog opstart gaat zo niet verloren. De frontend
//! (js/core/shell-acties.js) verzamelt de bestanden van één selectie een
//! ogenblik en handelt ze dan samen af.

use std::path::Path;
use std::sync::Mutex;

/// Vlaggen voor "combineren" ("Omzetten en combineren" is dezelfde actie: de
/// afbeeldingen in de selectie worden eerst omgezet).
pub const COMBINEER_VLAGGEN: [&str; 2] = ["--combine", "--convert-combine"];
/// Vlaggen voor "omzetten naar PDF" (een PDF naast elke afbeelding).
pub const OMZET_VLAGGEN: [&str; 2] = ["--convert-to-pdf", "--convert"];

/// Opties met een waarde erachter: die waarde is geen bestand.
const OPTIES_MET_WAARDE: [&str; 1] = ["--mcp-port"];

/// Eén rechtermuisknop-actie: `mode` is `"combine"` of `"convert"`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ShellActie {
    pub mode: String,
    pub files: Vec<String>,
}

/// Wachtrij van acties die de frontend nog niet heeft opgehaald.
#[derive(Default)]
pub struct ShellActieWachtrij(pub Mutex<Vec<ShellActie>>);

impl ShellActieWachtrij {
    pub fn met(start: Option<ShellActie>) -> Self {
        Self(Mutex::new(start.into_iter().collect()))
    }

    pub fn voeg_toe(&self, actie: ShellActie) {
        self.0.lock().unwrap().push(actie);
    }

    /// Alles wat er staat, en de rij is daarna leeg.
    pub fn neem_alles(&self) -> Vec<ShellActie> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }

    /// Alle paden in de rij (voor de fs-scope bij het opstarten).
    pub fn paden(&self) -> Vec<String> {
        self.0.lock().unwrap().iter().flat_map(|a| a.files.iter().cloned()).collect()
    }
}

/// De acties die sinds de vorige keer binnenkwamen (eenmalig opgehaald).
#[tauri::command]
pub fn get_shell_action(state: tauri::State<ShellActieWachtrij>) -> Vec<ShellActie> {
    state.neem_alles()
}

/// Een bestandsargument als pad: een `file://`-URI wordt een pad, een andere
/// URL (deep link) telt niet.
fn bestand_uit_argument(arg: &str) -> Option<String> {
    if arg.len() > 7 && arg.get(..7).is_some_and(|p| p.eq_ignore_ascii_case("file://")) {
        return url::Url::parse(arg)
            .ok()
            .and_then(|u| u.to_file_path().ok())
            .map(|p| p.to_string_lossy().to_string());
    }
    if arg.contains("://") || arg.trim().is_empty() {
        return None;
    }
    Some(arg.to_string())
}

/// Leest een rechtermuisknop-actie uit de opdrachtregel (`args[0]` is het
/// programma). `None` zonder actievlag of zonder bestanden. Relatieve paden
/// worden absoluut tegen `basis` (de map van waaruit gestart is), als die er is.
pub fn actie_uit_args(args: &[String], basis: Option<&Path>) -> Option<ShellActie> {
    let rest = args.get(1..).unwrap_or(&[]);
    let heeft = |vlaggen: &[&str]| rest.iter().any(|a| vlaggen.contains(&a.as_str()));
    let mode = if heeft(&COMBINEER_VLAGGEN) {
        "combine"
    } else if heeft(&OMZET_VLAGGEN) {
        "convert"
    } else {
        return None;
    };
    let mut files: Vec<String> = Vec::new();
    let mut sla_over = false;
    for arg in rest {
        if sla_over {
            sla_over = false;
            continue;
        }
        if arg.starts_with('-') {
            sla_over = OPTIES_MET_WAARDE.contains(&arg.as_str());
            continue;
        }
        let Some(pad) = bestand_uit_argument(arg) else { continue };
        let pad = match basis {
            Some(b) if Path::new(&pad).is_relative() => b.join(&pad).to_string_lossy().to_string(),
            _ => pad,
        };
        if !files.contains(&pad) {
            files.push(pad);
        }
    }
    if files.is_empty() {
        return None;
    }
    Some(ShellActie { mode: mode.to_string(), files })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn zonder_vlag_geen_actie() {
        assert_eq!(actie_uit_args(&args(&["app.exe", "C:\\a.pdf"]), None), None);
        assert_eq!(actie_uit_args(&args(&["app.exe"]), None), None);
        assert_eq!(actie_uit_args(&[], None), None);
    }

    #[test]
    fn combineren_en_omzetten() {
        let a = actie_uit_args(&args(&["app.exe", "--combine", "C:\\S1.10.pdf", "C:\\S1.2.pdf"]), None).unwrap();
        assert_eq!(a.mode, "combine");
        assert_eq!(a.files, vec!["C:\\S1.10.pdf", "C:\\S1.2.pdf"]);
        let b = actie_uit_args(&args(&["app.exe", "--convert-combine", "C:\\foto.jpg"]), None).unwrap();
        assert_eq!(b.mode, "combine");
        let c = actie_uit_args(&args(&["app.exe", "--convert-to-pdf", "C:\\foto.png"]), None).unwrap();
        assert_eq!(c.mode, "convert");
        let d = actie_uit_args(&args(&["app.exe", "C:\\foto.png", "--convert"]), None).unwrap();
        assert_eq!(d.mode, "convert");
        assert_eq!(d.files, vec!["C:\\foto.png"]);
    }

    #[test]
    fn vlag_zonder_bestand_is_geen_actie() {
        assert_eq!(actie_uit_args(&args(&["app.exe", "--combine"]), None), None);
    }

    #[test]
    fn opties_urls_en_dubbelen_vallen_weg() {
        let a = actie_uit_args(
            &args(&["app.exe", "--mcp-port", "9223", "--combine", "openpdfstudio://x", "C:\\a.pdf", "C:\\a.pdf"]),
            None,
        )
        .unwrap();
        assert_eq!(a.files, vec!["C:\\a.pdf"]);
    }

    #[test]
    fn relatief_pad_wordt_absoluut() {
        let basis = std::env::temp_dir();
        let a = actie_uit_args(&args(&["app", "--combine", "a.pdf"]), Some(&basis)).unwrap();
        assert_eq!(a.files, vec![basis.join("a.pdf").to_string_lossy().to_string()]);
    }

    #[test]
    fn wachtrij_geeft_alles_eenmaal() {
        let rij = ShellActieWachtrij::met(Some(ShellActie { mode: "combine".into(), files: vec!["a.pdf".into()] }));
        rij.voeg_toe(ShellActie { mode: "convert".into(), files: vec!["b.png".into()] });
        assert_eq!(rij.paden(), vec!["a.pdf", "b.png"]);
        assert_eq!(rij.neem_alles().len(), 2);
        assert!(rij.neem_alles().is_empty());
    }
}
