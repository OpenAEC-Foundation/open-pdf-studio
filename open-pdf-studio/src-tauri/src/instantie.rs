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
//! Met daarnaast `OPDS_HEADLESS=1` start een testinstantie headless: venster
//! buiten beeld, geen taakbalkknop, nooit focus, geen native dialogen (zie
//! headless.rs). Een tweede instantie erft die omgeving en dus ook headless.
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

/// Pure regel: wachten tot de hoofdinstantie bestanden kan ontvangen.
///
/// De single-instance-plugin maakt in de hoofdinstantie eerst een mutex en
/// daarna een verborgen venster dat de bestanden van een volgende start
/// ontvangt. Een start die de mutex al ziet maar het venster nog niet vindt,
/// gaat als eigen app verder. Dat gebeurt als de Verkenner meerdere bestanden
/// tegelijk opent: de processen starten even snel op en controleren op
/// hetzelfde moment. Wacht daarom zolang de mutex er is tot het venster er
/// ook is, met een grens. Geeft `true` als er een venster is om naar door te
/// sturen; `false` als er geen hoofdinstantie is of het venster uitbleef.
pub fn wacht_op_ontvanger(
    mut mutex_bestaat: impl FnMut() -> bool,
    mut venster_gevonden: impl FnMut() -> bool,
    mut wacht: impl FnMut(),
    pogingen: u32,
) -> bool {
    if !mutex_bestaat() {
        return false;
    }
    for _ in 0..pogingen {
        if venster_gevonden() {
            return true;
        }
        wacht();
    }
    venster_gevonden()
}

/// Windows: wacht vóór het opbouwen van de app tot een draaiende hoofdinstantie
/// haar ontvangstvenster heeft (zie `wacht_op_ontvanger`). De namen volgen de
/// plugin (tauri-plugin-single-instance, zonder de semver-optie):
/// `<identifier>-sim` (mutex), `-sic` (vensterklasse) en `-siw` (venstertitel).
#[cfg(target_os = "windows")]
pub fn wacht_op_hoofdinstantie(identifier: &str) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::OpenMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;
    // SYNCHRONIZE: genoeg om te zien of de mutex bestaat.
    const SYNCHRONIZE: u32 = 0x0010_0000;
    let breed = |s: String| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let mutex = breed(format!("{identifier}-sim"));
    let klasse = breed(format!("{identifier}-sic"));
    let titel = breed(format!("{identifier}-siw"));
    let begin = std::time::Instant::now();
    let gevonden = wacht_op_ontvanger(
        || unsafe {
            let h = OpenMutexW(SYNCHRONIZE, 0, mutex.as_ptr());
            if h.is_null() {
                false
            } else {
                CloseHandle(h);
                true
            }
        },
        || unsafe { !FindWindowW(klasse.as_ptr(), titel.as_ptr()).is_null() },
        || std::thread::sleep(std::time::Duration::from_millis(50)),
        // 10 s: een hoofdinstantie die zelf nog opstart, heeft haar venster
        // binnen een fractie daarvan.
        200,
    );
    let ms = begin.elapsed().as_millis();
    if gevonden && ms >= 50 {
        eprintln!("[startup] waited {ms} ms for the running instance to accept files");
    }
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
    pub pid: u32,
}

/// Rol van deze instantie, voor de frontend.
#[tauri::command]
pub fn instance_role() -> InstanceRole {
    let args: Vec<String> = std::env::args().collect();
    InstanceRole { secondary: is_nieuwe_instantie(&args), pid: std::process::id() }
}

#[derive(serde::Serialize, Default)]
pub struct TabDropTarget {
    pub pid: u32,
    pub x: i32,
    pub y: i32,
}

/// Resolve the actual drop point instead of sampling the cursor after release.
/// The returned position is in physical pixels relative to the receiving client.
#[tauri::command]
pub fn tab_drop_target(window: tauri::WebviewWindow, x: f64, y: f64) -> Result<Option<TabDropTarget>, String> {
    #[cfg(target_os = "windows")]
    {
        let origin = window.inner_position().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let pt = windows_sys::Win32::Foundation::POINT {
            x: (f64::from(origin.x) + x * scale).round() as i32,
            y: (f64::from(origin.y) + y * scale).round() as i32,
        };
        Ok(drop_target_at(pt))
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = (window, x, y); Ok(None) }
}

#[cfg(target_os = "windows")]
fn drop_target_at(mut pt: windows_sys::Win32::Foundation::POINT) -> Option<TabDropTarget> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT,
    };

    let eigen_pid = std::process::id();
    let eigen_exe = std::env::current_exe().ok()?;
    let eigen_exe = eigen_exe.to_string_lossy();
    let hwnd = unsafe { WindowFromPoint(pt) };
    if hwnd.is_null() {
        return None;
    }
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let root = if root.is_null() { hwnd } else { root };
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(root, &mut pid) };
    if pid == 0 || pid == eigen_pid {
        return None;
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
    if classificeer_drop(eigen_pid, &eigen_exe, Some(pid), exe.as_deref()) != DropDoel::Instantie
        || unsafe { ScreenToClient(root, &mut pt) } == 0
    {
        return None;
    }
    Some(TabDropTarget { pid, x: pt.x, y: pt.y })
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
    fn wacht_alleen_als_de_hoofdinstantie_nog_geen_ontvanger_heeft() {
        // Geen hoofdinstantie: meteen verder, niet wachten.
        let mut gewacht = 0;
        assert!(!wacht_op_ontvanger(|| false, || false, || gewacht += 1, 10));
        assert_eq!(gewacht, 0);
        // Ontvanger er al: meteen doorsturen.
        let mut gewacht = 0;
        assert!(wacht_op_ontvanger(|| true, || true, || gewacht += 1, 10));
        assert_eq!(gewacht, 0);
        // Ontvanger verschijnt na drie keer wachten.
        let mut keer = 0;
        let mut gewacht = 0;
        assert!(wacht_op_ontvanger(|| true, || { keer += 1; keer > 3 }, || gewacht += 1, 10));
        assert_eq!(gewacht, 3);
        // Ontvanger blijft uit: na de grens verder als eigen app.
        let mut gewacht = 0;
        assert!(!wacht_op_ontvanger(|| true, || false, || gewacht += 1, 10));
        assert_eq!(gewacht, 10);
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
