//! Hoofdinstantie en tweede instanties.
//!
//! Een tabblad dat uit de tabbalk gesleept wordt, opent in een TWEEDE
//! app-instantie: een eigen proces met een eigen venster. Dat proces wordt
//! gestart met de expliciete vlag `--new-instance` (zie
//! `window_mgmt::spawn_window_with_pdf`):
//!
//! * de single-instance-plugin wordt dan NIET geregistreerd, anders stuurt het
//!   nieuwe proces zijn PDF-argument terug naar de hoofdinstantie en stopt het;
//! * de frontend vraagt via `instance_role` of hij tweede instantie is en slaat
//!   dan over wat alleen de hoofdinstantie hoort te doen (sessie bewaren en
//!   herstellen, AI-koppeling, printwachtrij, PrtScn-sneltoets).
//!
//! De omgevingsvariabele `OPDS_DETACHED=1` blijft de single-instance-plugin
//! ook uitschakelen (testinstanties naast de geïnstalleerde app), maar maakt
//! van een proces GEEN tweede instantie: alleen de vlag doet dat.
//!
//! WebView2: beide processen gebruiken dezelfde gebruikersdatamap. WebView2
//! ondersteunt dat zolang de omgevingsopties gelijk zijn; ze delen dan één
//! browserproces. Het nieuwe proces erft daarom de omgeving van de ouder
//! ongewijzigd — een afwijkende browseroptie op dezelfde datamap laat het
//! aanmaken van de WebView mislukken.

/// Vlag waarmee een tweede instantie gestart wordt.
pub const NIEUWE_INSTANTIE_VLAG: &str = "--new-instance";

/// Is dit proces met de vlag voor een tweede instantie gestart?
pub fn is_nieuwe_instantie(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == NIEUWE_INSTANTIE_VLAG)
}

/// Moet de single-instance-plugin overgeslagen worden? Ja voor een tweede
/// instantie (vlag) en voor testinstanties (`OPDS_DETACHED=1`).
pub fn slaat_single_instance_over(args: &[String], opds_detached: Option<&str>) -> bool {
    is_nieuwe_instantie(args) || opds_detached == Some("1")
}

/// De argumenten voor een tweede instantie die `pdf` opent.
pub fn nieuwe_instantie_args(pdf: &str) -> Vec<String> {
    vec![NIEUWE_INSTANTIE_VLAG.to_string(), pdf.to_string()]
}

/// Wat er onder de cursor ligt bij het loslaten van een tabblad.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DropDoel {
    /// Een venster van dit proces.
    Zelf,
    /// Een venster van een andere instantie van DEZELFDE app (zelfde exe).
    Instantie,
    /// Iets anders: bureaublad, een ander programma, niets.
    Geen,
}

impl DropDoel {
    /// De naam die de frontend gebruikt.
    pub fn naam(self) -> &'static str {
        match self {
            DropDoel::Zelf => "zelf",
            DropDoel::Instantie => "instantie",
            DropDoel::Geen => "geen",
        }
    }
}

/// Zelfde programmabestand? Op Windows hoofdletterongevoelig en met beide
/// scheidingstekens.
pub fn zelfde_exe(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        let p = p.trim().replace('/', "\\");
        let p = p.strip_prefix(r"\\?\").unwrap_or(&p).to_string();
        if cfg!(windows) { p.to_lowercase() } else { p }
    }
    !a.trim().is_empty() && norm(a) == norm(b)
}

/// Pure indeling van het venster onder de cursor.
pub fn classificeer_drop(
    eigen_pid: u32,
    eigen_exe: &str,
    doel_pid: Option<u32>,
    doel_exe: Option<&str>,
) -> DropDoel {
    match doel_pid {
        None | Some(0) => DropDoel::Geen,
        Some(pid) if pid == eigen_pid => DropDoel::Zelf,
        Some(_) => match doel_exe {
            Some(exe) if zelfde_exe(exe, eigen_exe) => DropDoel::Instantie,
            _ => DropDoel::Geen,
        },
    }
}

#[derive(serde::Serialize, Clone)]
pub struct InstanceRole {
    /// `true` → dit proces is een tweede instantie (losgemaakt tabblad).
    pub secondary: bool,
}

/// Rol van deze instantie, voor de frontend.
#[tauri::command]
pub fn instance_role() -> InstanceRole {
    let args: Vec<String> = std::env::args().collect();
    InstanceRole { secondary: is_nieuwe_instantie(&args) }
}

#[derive(serde::Serialize, Clone)]
pub struct TabDropTarget {
    /// `"zelf"` | `"instantie"` | `"geen"`
    pub kind: &'static str,
}

/// Wat ligt er NU onder de muiscursor? Gebruikt tijdens en na het slepen van
/// een tabblad om te kiezen tussen terugzetten in een andere instantie en
/// losmaken naar een nieuwe instantie.
#[tauri::command]
pub fn tab_drop_target() -> TabDropTarget {
    TabDropTarget { kind: drop_doel_onder_cursor().naam() }
}

#[cfg(target_os = "windows")]
fn drop_doel_onder_cursor() -> DropDoel {
    use windows_sys::Win32::Foundation::{CloseHandle, POINT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetCursorPos, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT,
    };

    let eigen_pid = std::process::id();
    let eigen_exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut pt = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return DropDoel::Geen;
    }
    let hwnd = unsafe { WindowFromPoint(pt) };
    if hwnd.is_null() {
        return DropDoel::Geen;
    }
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let root = if root.is_null() { hwnd } else { root };
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(root, &mut pid) };
    if pid == 0 || pid == eigen_pid {
        return classificeer_drop(eigen_pid, &eigen_exe, Some(pid), None);
    }

    let exe = unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            None
        } else {
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0;
            CloseHandle(h);
            if ok {
                Some(String::from_utf16_lossy(&buf[..len as usize]))
            } else {
                None
            }
        }
    };
    classificeer_drop(eigen_pid, &eigen_exe, Some(pid), exe.as_deref())
}

#[cfg(not(target_os = "windows"))]
fn drop_doel_onder_cursor() -> DropDoel {
    // Geen betrouwbare manier om het venster onder de cursor bij een ander
    // proces op te vragen: altijd losmaken naar een nieuwe instantie.
    DropDoel::Geen
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn vlag_maakt_tweede_instantie() {
        assert!(is_nieuwe_instantie(&args(&["app.exe", "--new-instance", "C:\\a.pdf"])));
        assert!(!is_nieuwe_instantie(&args(&["app.exe", "C:\\a.pdf"])));
        // Het programmapad zelf telt niet mee.
        assert!(!is_nieuwe_instantie(&args(&["--new-instance"])));
    }

    #[test]
    fn single_instance_overslaan_bij_vlag_of_testomgeving() {
        assert!(slaat_single_instance_over(&args(&["app.exe", "--new-instance", "a.pdf"]), None));
        assert!(slaat_single_instance_over(&args(&["app.exe"]), Some("1")));
        assert!(!slaat_single_instance_over(&args(&["app.exe", "a.pdf"]), None));
        assert!(!slaat_single_instance_over(&args(&["app.exe"]), Some("0")));
    }

    #[test]
    fn argumenten_voor_nieuwe_instantie() {
        assert_eq!(
            nieuwe_instantie_args("C:\\map met spatie\\a.pdf"),
            vec!["--new-instance".to_string(), "C:\\map met spatie\\a.pdf".to_string()]
        );
        // De nieuwe instantie herkent zichzelf aan deze argumenten.
        let mut volledig = vec!["app.exe".to_string()];
        volledig.extend(nieuwe_instantie_args("a.pdf"));
        assert!(is_nieuwe_instantie(&volledig));
    }

    #[test]
    fn drop_doel_indeling() {
        let exe = r"C:\Program Files\Open PDF Studio\open-pdf-studio.exe";
        assert_eq!(classificeer_drop(10, exe, Some(10), None), DropDoel::Zelf);
        assert_eq!(
            classificeer_drop(10, exe, Some(20), Some(r"c:/program files/open pdf studio/OPEN-PDF-STUDIO.exe")),
            if cfg!(windows) { DropDoel::Instantie } else { DropDoel::Geen }
        );
        assert_eq!(classificeer_drop(10, exe, Some(20), Some(exe)), DropDoel::Instantie);
        assert_eq!(classificeer_drop(10, exe, Some(20), Some(r"C:\Windows\explorer.exe")), DropDoel::Geen);
        assert_eq!(classificeer_drop(10, exe, Some(20), None), DropDoel::Geen);
        assert_eq!(classificeer_drop(10, exe, None, None), DropDoel::Geen);
        assert_eq!(classificeer_drop(10, exe, Some(0), Some(exe)), DropDoel::Geen);
    }

    #[test]
    fn exe_vergelijking_negeert_lang_pad_voorvoegsel() {
        assert!(zelfde_exe(r"\\?\C:\a\app.exe", r"C:\a\app.exe"));
        assert!(!zelfde_exe("", ""));
    }
}
