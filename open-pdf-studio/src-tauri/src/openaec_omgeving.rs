//! OpenAEC Linux (#863): de gestreamde SuperCloud-omgeving en andere Linux-
//! machines zonder GPU, FUSE, systeemvak, notificatiedienst of keyring.
//!
//! De SuperCloud start de uitgepakte AppImage (`squashfs-root/AppRun <pad>`) in
//! een container met een kleine Wayland-compositor (labwc) en Mesa llvmpipe.
//! Deze module stelt vast waar de app draait en neemt de beslissingen die
//! daaruit volgen. Alles wat beslist, is een pure functie over een
//! [`Waarneming`] (variabelen plus wat het bestandssysteem zegt), zodat de
//! tests geen echte omgeving nodig hebben.
//!
//! Omgevingsvariabelen (het contract staat in docs/openaec-linux.md):
//!
//! | variabele                     | betekenis |
//! |-------------------------------|-----------|
//! | `OPENAEC_BEHEERD=1`           | beheerde modus: geen updater, geen updatemelding, geen automatische release-notes |
//! | `OPENAEC_MAP=/openaec`        | werkmap: open- en opslagdialogen starten daar |
//! | `OPENAEC_MCP_POORT`, `OPENAEC_MCP_GEHEIM` | MCP-server op die poort, alleen met dat geheim |
//! | `OPENAEC_MCP_ADRES`           | bindadres van die server (standaard `0.0.0.0`) |
//! | `OPENAEC_SOFTWARE_RENDERING`  | `1` forceert, `0` verbiedt de software-rendering-instellingen |
//! | `OPDS_GDK_BACKEND`            | GDK-backend die de AppImage-hook niet overschrijft |
//!
//! Beslissingen bij de start (`bereid_proces_voor`, vanuit main.rs vóór GTK):
//!
//! * **Geen GPU** (geen `/dev/dri/renderD*`): `WEBKIT_DISABLE_DMABUF_RENDERER`,
//!   `WEBKIT_DISABLE_COMPOSITING_MODE` en `LIBGL_ALWAYS_SOFTWARE` op 1, elk
//!   alleen als de gebruiker hem niet zelf zette. Met een GPU verandert er niets.
//! * **Wayland**: de GTK-hook van de AppImage zet `GDK_BACKEND=x11`. Is er een
//!   Wayland-display en geen X-display, of draait de app beheerd, dan wordt
//!   dat `wayland,x11`; op een gewoon bureaublad met X blijft het x11.
//! * **Startbestand**: AppRun zet de werkmap op `$APPDIR/usr`. Een relatief pad
//!   uit `AppRun <pad>` wordt daarom opgelost tegen de oorspronkelijke map
//!   (`OWD` van de AppImage-runtime, anders `PWD` van de shell, anders
//!   `OPENAEC_MAP`).
//! * **Geen sessiebus**: single-instance blijft uit als het busadres een
//!   transport noemt dat zbus niet kent (de plugin zou daarop in paniek raken);
//!   een ontbrekende bus is voor de plugin zelf al niet fataal.
//! * **Geen beeldscherm** (`WAYLAND_DISPLAY` noch `DISPLAY`): een duidelijke
//!   melding en exitcode 2 in plaats van een paniek in GTK.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const VAR_BEHEERD: &str = "OPENAEC_BEHEERD";
pub const VAR_MAP: &str = "OPENAEC_MAP";
pub const VAR_MCP_POORT: &str = "OPENAEC_MCP_POORT";
pub const VAR_MCP_GEHEIM: &str = "OPENAEC_MCP_GEHEIM";
pub const VAR_MCP_ADRES: &str = "OPENAEC_MCP_ADRES";
pub const VAR_SOFTWARE: &str = "OPENAEC_SOFTWARE_RENDERING";
pub const VAR_GDK: &str = "OPDS_GDK_BACKEND";

/// Kortste geheim dat de beheerde MCP-server accepteert.
pub const MIN_GEHEIM: usize = 16;
/// Standaard bindadres van de beheerde MCP-server: het interne netwerk van de
/// container. Het geheim en de Origin-weigering beschermen de poort.
pub const STANDAARD_MCP_ADRES: &str = "0.0.0.0";

/// De WebKitGTK-/Mesa-instellingen voor software-rendering.
pub const SOFTWARE_VARS: [&str; 3] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "LIBGL_ALWAYS_SOFTWARE",
];

/// Momentopname van de omgeving: de variabelen plus de paar feiten uit het
/// bestandssysteem die de beslissingen nodig hebben.
#[derive(Clone, Debug, Default)]
pub struct Waarneming {
    pub vars: HashMap<String, String>,
    /// Er is een DRM-render-node (`/dev/dri/renderD*`): een GPU is bruikbaar.
    pub render_node: bool,
    /// `/.dockerenv` of `/run/.containerenv` bestaat.
    pub container_bestand: bool,
    /// `OPENAEC_MAP` wijst naar een bestaande map.
    pub werkmap_bestaat: bool,
    /// De huidige werkmap van het proces.
    pub cwd: Option<PathBuf>,
}

impl Waarneming {
    pub fn van_systeem() -> Self {
        let vars: HashMap<String, String> = std::env::vars_os()
            .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
            .collect();
        let werkmap_bestaat = vars
            .get(VAR_MAP)
            .map(|m| Path::new(m.trim()).is_dir())
            .unwrap_or(false);
        Waarneming {
            vars,
            // Alleen Linux kent render-nodes; elders beslist het platform zelf.
            render_node: !cfg!(target_os = "linux") || heeft_render_node(Path::new("/dev/dri")),
            container_bestand: Path::new("/.dockerenv").exists()
                || Path::new("/run/.containerenv").exists(),
            werkmap_bestaat,
            cwd: std::env::current_dir().ok(),
        }
    }

    /// Waarde van een variabele; leeg telt als niet gezet.
    pub fn var(&self, naam: &str) -> Option<&str> {
        self.vars.get(naam).map(|v| v.trim()).filter(|v| !v.is_empty())
    }

    /// Staat de variabele er, ook leeg? (Een bewust lege waarde van de
    /// gebruiker overschrijven we niet.)
    pub fn gezet(&self, naam: &str) -> bool {
        self.vars.contains_key(naam)
    }
}

/// Is er een `renderD*`-node in deze map?
pub fn heeft_render_node(dri: &Path) -> bool {
    std::fs::read_dir(dri)
        .map(|it| {
            it.filter_map(Result::ok)
                .any(|e| e.file_name().to_string_lossy().starts_with("renderD"))
        })
        .unwrap_or(false)
}

/// De instelling van de beheerde MCP-server.
#[derive(Clone, PartialEq, Eq)]
pub struct McpInstelling {
    pub adres: SocketAddr,
    pub geheim: String,
}

impl std::fmt::Debug for McpInstelling {
    // Het geheim komt nooit in een log.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpInstelling").field("adres", &self.adres).field("geheim", &"***").finish()
    }
}

/// Wat de app over haar omgeving weet.
#[derive(Clone, Debug, PartialEq)]
pub struct Omgeving {
    /// `OPENAEC_BEHEERD=1`: de SuperCloud beheert versie en updates.
    pub beheerd: bool,
    /// Bestaande, absolute map uit `OPENAEC_MAP`.
    pub werkmap: Option<PathBuf>,
    /// In een container (Docker/Podman/OCI, of beheerd).
    pub container: bool,
    /// Geen bruikbare GPU: WebKitGTK rendert in software.
    pub software_rendering: bool,
    pub wayland: bool,
    pub x11: bool,
    /// De AppDir van een (uitgepakte) AppImage.
    pub appdir: Option<PathBuf>,
    pub mcp: Option<McpInstelling>,
    /// Waarom de MCP-variabelen niet bruikbaar waren.
    pub mcp_fout: Option<String>,
}

fn is_aan(waarde: Option<&str>) -> bool {
    matches!(waarde.map(|v| v.to_ascii_lowercase()).as_deref(), Some("1" | "true" | "yes" | "ja" | "on"))
}

fn is_uit(waarde: Option<&str>) -> bool {
    matches!(waarde.map(|v| v.to_ascii_lowercase()).as_deref(), Some("0" | "false" | "no" | "nee" | "off"))
}

impl Omgeving {
    pub fn bepaal(w: &Waarneming) -> Self {
        let beheerd = is_aan(w.var(VAR_BEHEERD));
        let werkmap = w
            .var(VAR_MAP)
            .map(PathBuf::from)
            .filter(|p| p.is_absolute() && w.werkmap_bestaat);
        let container = beheerd || w.container_bestand || w.var("container").is_some();
        let software_rendering = if is_aan(w.var(VAR_SOFTWARE)) {
            true
        } else if is_uit(w.var(VAR_SOFTWARE)) {
            false
        } else {
            w.var("LIBGL_ALWAYS_SOFTWARE") == Some("1") || !w.render_node
        };
        let (mcp, mcp_fout) = match mcp_uit(w) {
            Ok(m) => (m, None),
            Err(e) => (None, Some(e)),
        };
        Omgeving {
            beheerd,
            werkmap,
            container,
            software_rendering,
            wayland: w.var("WAYLAND_DISPLAY").is_some(),
            x11: w.var("DISPLAY").is_some(),
            appdir: w.var("APPDIR").map(PathBuf::from),
            mcp,
            mcp_fout,
        }
    }

    /// De updater-plugin, de updatecontrole en de downloadknop: niet als de
    /// SuperCloud de versie beheert.
    pub fn updater_toegestaan(&self) -> bool {
        !self.beheerd
    }

    /// Het object dat de frontend als `window.__OPENAEC__` krijgt.
    pub fn voor_frontend(&self) -> serde_json::Value {
        serde_json::json!({
            "beheerd": self.beheerd,
            "werkmap": self.werkmap.as_ref().map(|p| p.to_string_lossy().to_string()),
            "container": self.container,
            "softwareRendering": self.software_rendering,
        })
    }
}

/// `OPENAEC_MCP_POORT` + `OPENAEC_MCP_GEHEIM` (+ `OPENAEC_MCP_ADRES`). Geen van
/// beide gezet: geen server. Eén van beide, of een onbruikbare waarde: fout.
pub fn mcp_uit(w: &Waarneming) -> Result<Option<McpInstelling>, String> {
    let poort = w.var(VAR_MCP_POORT);
    let geheim = w.var(VAR_MCP_GEHEIM);
    match (poort, geheim) {
        (None, None) => Ok(None),
        (Some(_), None) => Err(format!("{VAR_MCP_POORT} is set without {VAR_MCP_GEHEIM}; MCP server not started")),
        (None, Some(_)) => Err(format!("{VAR_MCP_GEHEIM} is set without {VAR_MCP_POORT}; MCP server not started")),
        (Some(p), Some(g)) => {
            let poort: u16 = p
                .parse()
                .ok()
                .filter(|p| *p > 0)
                .ok_or_else(|| format!("{VAR_MCP_POORT}={p} is not a port number (1-65535)"))?;
            if g.chars().count() < MIN_GEHEIM {
                return Err(format!("{VAR_MCP_GEHEIM} is shorter than {MIN_GEHEIM} characters; MCP server not started"));
            }
            let host = w.var(VAR_MCP_ADRES).unwrap_or(STANDAARD_MCP_ADRES);
            let ip: std::net::IpAddr = host
                .parse()
                .map_err(|_| format!("{VAR_MCP_ADRES}={host} is not an IP address"))?;
            Ok(Some(McpInstelling { adres: SocketAddr::new(ip, poort), geheim: g.to_string() }))
        }
    }
}

/// Welke variabelen de app vóór GTK zet. Alleen wat nodig is, en nooit over
/// een waarde heen die de gebruiker zelf zette.
pub fn omgevingswijzigingen(o: &Omgeving, w: &Waarneming) -> Vec<(&'static str, String)> {
    let mut wijzigingen = Vec::new();
    if o.software_rendering {
        for naam in SOFTWARE_VARS {
            if !w.gezet(naam) {
                wijzigingen.push((naam, "1".to_string()));
            }
        }
    }
    if let Some(backend) = gdk_backend(o, w) {
        wijzigingen.push(("GDK_BACKEND", backend));
    }
    wijzigingen
}

/// De GDK-backend, als die anders moet dan wat er nu staat.
///
/// De GTK-hook van de AppImage zet altijd `GDK_BACKEND=x11` (tegen een oude
/// crash met meegeleverde Wayland-bibliotheken; die zitten sinds #362 niet meer
/// in de AppImage). Zonder X-server, of in OpenAEC Linux waar labwc de
/// compositor is, start GTK dan niet. Op een bureaublad met X blijft x11 staan.
pub fn gdk_backend(o: &Omgeving, w: &Waarneming) -> Option<String> {
    if let Some(eigen) = w.var(VAR_GDK) {
        return (w.var("GDK_BACKEND") != Some(eigen)).then(|| eigen.to_string());
    }
    let door_hook = o.appdir.is_some() && w.var("GDK_BACKEND") == Some("x11");
    if door_hook && o.wayland && (o.beheerd || !o.x11) {
        return Some("wayland,x11".to_string());
    }
    None
}

/// Kan GTK een beeldscherm openen? Zonder Wayland- of X-display (en zonder
/// broadway) stopt de app met een duidelijke melding.
pub fn beeldscherm_beschikbaar(w: &Waarneming) -> bool {
    w.var("WAYLAND_DISPLAY").is_some()
        || w.var("DISPLAY").is_some()
        || w.var("GDK_BACKEND").is_some_and(|b| b.contains("broadway"))
}

/// Tegen welke map moet een relatief startargument opgelost worden?
///
/// AppRun (de AppImage-starter) zet de werkmap op `$APPDIR/usr` voordat de app
/// start; een relatief pad uit `AppRun <pad>` wijst dan in de AppImage. De
/// oorspronkelijke map staat in `OWD` (AppImage-runtime) of `PWD` (de shell
/// werkt die niet bij voor een `chdir` in AppRun). Buiten een AppImage:
/// `None`, dan lost het besturingssysteem het pad gewoon op.
pub fn startmap_voor_argumenten(o: &Omgeving, w: &Waarneming) -> Option<PathBuf> {
    let appdir = o.appdir.as_ref()?;
    let cwd = w.cwd.as_ref()?;
    if cwd != &appdir.join("usr") {
        return None;
    }
    let absoluut = |naam: &str| w.var(naam).map(PathBuf::from).filter(|p| p.is_absolute() && p != cwd);
    absoluut("OWD").or_else(|| absoluut("PWD")).or_else(|| o.werkmap.clone())
}

/// Maak een startargument absoluut tegen `basis` (als die er is).
pub fn absoluut_argument(arg: &str, basis: Option<&Path>) -> String {
    match basis {
        Some(b) if Path::new(arg).is_relative() => b.join(arg).to_string_lossy().to_string(),
        _ => arg.to_string(),
    }
}

/// Mag de single-instance-plugin (zbus) starten? zbus raakt in paniek op een
/// busadres met een onbekend transport; een ontbrekende of onbereikbare bus is
/// voor de plugin wel veilig (dan draait elke start los).
pub fn sessiebus_bruikbaar(adres: Option<&str>) -> bool {
    let Some(adres) = adres.map(str::trim).filter(|a| !a.is_empty()) else { return true };
    adres.split(';').filter(|d| !d.is_empty()).all(|deel| {
        ["unix:", "tcp:", "nonce-tcp:", "unixexec:", "vsock:"].iter().any(|t| deel.starts_with(t))
    })
}

static OMGEVING: OnceLock<Omgeving> = OnceLock::new();

/// De omgeving van dit proces (bij de eerste vraag vastgesteld).
pub fn huidige() -> &'static Omgeving {
    OMGEVING.get_or_init(|| Omgeving::bepaal(&Waarneming::van_systeem()))
}

/// Uit main.rs, als eerste (vóór GTK en vóór er draden zijn): de omgeving
/// vaststellen, de variabelen zetten en de beslissingen loggen.
pub fn bereid_proces_voor() {
    #[cfg(target_os = "linux")]
    {
        let w = Waarneming::van_systeem();
        let o = Omgeving::bepaal(&w);
        for (naam, waarde) in omgevingswijzigingen(&o, &w) {
            std::env::set_var(naam, &waarde);
            eprintln!("[openaec] {naam}={waarde}");
        }
        eprintln!(
            "[openaec] managed={} container={} software_rendering={} wayland={} x11={} workdir={}",
            o.beheerd,
            o.container,
            o.software_rendering,
            o.wayland,
            o.x11,
            o.werkmap.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "-".into()),
        );
        if let Some(fout) = &o.mcp_fout {
            eprintln!("[openaec] {fout}");
        }
        let _ = OMGEVING.set(o);
    }
}

/// Zonder beeldscherm stoppen met een leesbare melding (exitcode 2) in plaats
/// van een paniek in GTK. `--help` en `--version` werken altijd.
pub fn stop_zonder_beeldscherm(args: &[String]) {
    #[cfg(target_os = "linux")]
    {
        if args.iter().skip(1).any(|a| matches!(a.as_str(), "--help" | "-h" | "--version" | "-V")) {
            return;
        }
        if !beeldscherm_beschikbaar(&Waarneming::van_systeem()) {
            eprintln!(
                "open-pdf-studio: no display. Set WAYLAND_DISPLAY (for example under labwc) or DISPLAY, \
                 or run under a headless compositor such as `WLR_BACKENDS=headless labwc`."
            );
            std::process::exit(2);
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = args;
}

/// Init-script voor de WebView: `window.__OPENAEC__` (alleen-lezen).
pub fn init_script(o: &Omgeving) -> String {
    format!(
        "(function(){{if(window.__OPENAEC__)return;Object.defineProperty(window,'__OPENAEC__',{{value:Object.freeze({})}});}})();",
        o.voor_frontend()
    )
}

/// Plugin die `window.__OPENAEC__` in elk venster zet.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("openaec-omgeving")
        .js_init_script(init_script(huidige()))
        .build()
}

/// Zo lang wacht de app na `SIGTERM` op de herstelbestanden van de frontend.
pub const SIGTERM_WACHTTIJD: std::time::Duration = std::time::Duration::from_secs(5);

/// Op `SIGTERM` (de SuperCloud ruimt op bij uitloggen; `docker stop`):
/// niet-opgeslagen werk als herstelbestand wegschrijven (dezelfde
/// noodmomentopname als bij een paniek, herstel.rs) en dan netjes stoppen. De
/// markering "draait" blijft staan, zodat de volgende start het herstel
/// aanbiedt.
#[cfg(target_os = "linux")]
pub fn installeer_sigterm(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[openaec] SIGTERM handler not installed: {e}");
                return;
            }
        };
        if term.recv().await.is_none() {
            return;
        }
        eprintln!("[openaec] SIGTERM: writing recovery files for unsaved work, then exiting");
        let uitkomst = tauri::async_runtime::spawn_blocking(|| {
            crate::crashlog::vraag_noodmomentopname("sigterm", SIGTERM_WACHTTIJD)
        })
        .await;
        match uitkomst {
            Ok(u) => eprintln!("[openaec] SIGTERM recovery snapshot: {u:?}"),
            Err(e) => eprintln!("[openaec] SIGTERM recovery snapshot failed: {e}"),
        }
        app.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(vars: &[(&str, &str)]) -> Waarneming {
        Waarneming {
            vars: vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            render_node: true,
            container_bestand: false,
            werkmap_bestaat: true,
            cwd: Some(PathBuf::from("/home/u")),
        }
    }

    fn zonder_gpu(mut w: Waarneming) -> Waarneming {
        w.render_node = false;
        w
    }

    /// Wat de SuperCloud meegeeft: beheerd, werkmap, labwc, geen GPU, en de
    /// variabelen die de AppImage-hook zelf zet.
    fn openaec_linux() -> Waarneming {
        let mut w = zonder_gpu(w(&[
            ("OPENAEC_BEHEERD", "1"),
            ("OPENAEC_MAP", "/openaec"),
            ("WAYLAND_DISPLAY", "wayland-0"),
            ("APPDIR", "/opt/ops/squashfs-root"),
            ("GDK_BACKEND", "x11"),
            ("PWD", "/openaec"),
        ]));
        w.cwd = Some(PathBuf::from("/opt/ops/squashfs-root/usr"));
        w
    }

    #[test]
    fn gewoon_bureaublad_verandert_niets() {
        let w = w(&[("DISPLAY", ":0"), ("WAYLAND_DISPLAY", "wayland-0")]);
        let o = Omgeving::bepaal(&w);
        assert!(!o.beheerd && !o.container && !o.software_rendering);
        assert!(o.updater_toegestaan());
        assert_eq!(o.werkmap, None);
        assert!(omgevingswijzigingen(&o, &w).is_empty());
    }

    #[test]
    fn openaec_linux_wordt_herkend() {
        let w = openaec_linux();
        let o = Omgeving::bepaal(&w);
        assert!(o.beheerd && o.container && o.software_rendering && o.wayland && !o.x11);
        assert!(!o.updater_toegestaan());
        assert_eq!(o.werkmap, Some(PathBuf::from("/openaec")));
        assert_eq!(o.appdir, Some(PathBuf::from("/opt/ops/squashfs-root")));
        let wijz = omgevingswijzigingen(&o, &w);
        for naam in SOFTWARE_VARS {
            assert!(wijz.contains(&(naam, "1".to_string())), "{naam}");
        }
        assert!(wijz.contains(&("GDK_BACKEND", "wayland,x11".to_string())));
    }

    #[test]
    fn beheerd_alleen_met_een_ware_waarde() {
        for aan in ["1", "true", "TRUE", "yes", "ja"] {
            assert!(Omgeving::bepaal(&w(&[("OPENAEC_BEHEERD", aan)])).beheerd, "{aan}");
        }
        for uit in ["0", "", "false", "nee", "2"] {
            assert!(!Omgeving::bepaal(&w(&[("OPENAEC_BEHEERD", uit)])).beheerd, "{uit}");
        }
    }

    #[test]
    fn werkmap_moet_absoluut_zijn_en_bestaan() {
        assert_eq!(Omgeving::bepaal(&w(&[("OPENAEC_MAP", "relatief")])).werkmap, None);
        let mut ontbreekt = w(&[("OPENAEC_MAP", "/bestaat-niet")]);
        ontbreekt.werkmap_bestaat = false;
        assert_eq!(Omgeving::bepaal(&ontbreekt).werkmap, None);
        assert_eq!(Omgeving::bepaal(&w(&[("OPENAEC_MAP", "  ")])).werkmap, None);
    }

    #[test]
    fn container_uit_bestand_variabele_of_beheerd() {
        let mut docker = w(&[]);
        docker.container_bestand = true;
        assert!(Omgeving::bepaal(&docker).container);
        assert!(Omgeving::bepaal(&w(&[("container", "podman")])).container);
        assert!(Omgeving::bepaal(&w(&[("OPENAEC_BEHEERD", "1")])).container);
        assert!(!Omgeving::bepaal(&w(&[])).container);
    }

    #[test]
    fn software_rendering_zonder_render_node_of_op_verzoek() {
        assert!(Omgeving::bepaal(&zonder_gpu(w(&[]))).software_rendering);
        assert!(!Omgeving::bepaal(&w(&[])).software_rendering);
        assert!(Omgeving::bepaal(&w(&[("LIBGL_ALWAYS_SOFTWARE", "1")])).software_rendering);
        assert!(Omgeving::bepaal(&w(&[("OPENAEC_SOFTWARE_RENDERING", "1")])).software_rendering);
        assert!(!Omgeving::bepaal(&zonder_gpu(w(&[("OPENAEC_SOFTWARE_RENDERING", "0")]))).software_rendering);
    }

    #[test]
    fn met_gpu_geen_webkit_variabelen() {
        let w = w(&[("OPENAEC_BEHEERD", "1"), ("WAYLAND_DISPLAY", "wayland-0")]);
        let o = Omgeving::bepaal(&w);
        assert!(omgevingswijzigingen(&o, &w).iter().all(|(n, _)| !SOFTWARE_VARS.contains(n)));
    }

    #[test]
    fn eigen_waarden_van_de_gebruiker_blijven_staan() {
        let w = zonder_gpu(w(&[("WEBKIT_DISABLE_COMPOSITING_MODE", "0"), ("LIBGL_ALWAYS_SOFTWARE", "")]));
        let o = Omgeving::bepaal(&w);
        let namen: Vec<_> = omgevingswijzigingen(&o, &w).into_iter().map(|(n, _)| n).collect();
        assert_eq!(namen, ["WEBKIT_DISABLE_DMABUF_RENDERER"]);
    }

    #[test]
    fn gdk_backend_alleen_waar_x11_niet_kan_of_beheerd() {
        let hook = |extra: &[(&'static str, &'static str)]| {
            let mut v = vec![("APPDIR", "/a"), ("GDK_BACKEND", "x11"), ("WAYLAND_DISPLAY", "wayland-0")];
            v.extend_from_slice(extra);
            w(&v)
        };
        // Bureaublad met XWayland: x11 blijft (geen regressie).
        let bureaublad = hook(&[("DISPLAY", ":0")]);
        assert_eq!(gdk_backend(&Omgeving::bepaal(&bureaublad), &bureaublad), None);
        // Puur Wayland: zonder deze stap start GTK niet.
        let wayland = hook(&[]);
        assert_eq!(gdk_backend(&Omgeving::bepaal(&wayland), &wayland).as_deref(), Some("wayland,x11"));
        // Beheerd: Wayland eerst, ook met XWayland.
        let beheerd = hook(&[("DISPLAY", ":0"), ("OPENAEC_BEHEERD", "1")]);
        assert_eq!(gdk_backend(&Omgeving::bepaal(&beheerd), &beheerd).as_deref(), Some("wayland,x11"));
        // Buiten een AppImage koos de gebruiker zelf.
        let deb = w(&[("GDK_BACKEND", "x11"), ("WAYLAND_DISPLAY", "wayland-0")]);
        assert_eq!(gdk_backend(&Omgeving::bepaal(&deb), &deb), None);
        // OPDS_GDK_BACKEND wint altijd.
        let eigen = hook(&[("OPDS_GDK_BACKEND", "x11"), ("OPENAEC_BEHEERD", "1")]);
        assert_eq!(gdk_backend(&Omgeving::bepaal(&eigen), &eigen), None, "x11 staat er al");
        let eigen = hook(&[("OPDS_GDK_BACKEND", "wayland")]);
        assert_eq!(gdk_backend(&Omgeving::bepaal(&eigen), &eigen).as_deref(), Some("wayland"));
    }

    #[test]
    fn zonder_beeldscherm_geen_start() {
        assert!(!beeldscherm_beschikbaar(&w(&[])));
        assert!(!beeldscherm_beschikbaar(&w(&[("DISPLAY", "")])));
        assert!(beeldscherm_beschikbaar(&w(&[("WAYLAND_DISPLAY", "wayland-0")])));
        assert!(beeldscherm_beschikbaar(&w(&[("DISPLAY", ":99")])));
        assert!(beeldscherm_beschikbaar(&w(&[("GDK_BACKEND", "broadway")])));
    }

    #[test]
    fn relatief_startbestand_volgt_de_oorspronkelijke_map() {
        let w0 = openaec_linux();
        let o = Omgeving::bepaal(&w0);
        assert_eq!(startmap_voor_argumenten(&o, &w0), Some(PathBuf::from("/openaec")));

        let mut owd = w0.clone();
        owd.vars.insert("OWD".into(), "/home/u/plannen".into());
        assert_eq!(startmap_voor_argumenten(&o, &owd), Some(PathBuf::from("/home/u/plannen")));

        // Geen OWD en PWD = de AppRun-map: terugvallen op OPENAEC_MAP.
        let mut geen = w0.clone();
        geen.vars.insert("PWD".into(), "/opt/ops/squashfs-root/usr".into());
        assert_eq!(startmap_voor_argumenten(&o, &geen), Some(PathBuf::from("/openaec")));

        // Buiten de AppRun-map (gewone start): niets oplossen.
        let mut elders = w0.clone();
        elders.cwd = Some(PathBuf::from("/home/u"));
        assert_eq!(startmap_voor_argumenten(&o, &elders), None);
        let deb = w(&[("PWD", "/tmp")]);
        assert_eq!(startmap_voor_argumenten(&Omgeving::bepaal(&deb), &deb), None);
    }

    #[test]
    fn absoluut_argument_laat_absolute_paden_staan() {
        let basis = Path::new("/openaec");
        assert_eq!(absoluut_argument("plan.pdf", Some(basis)), "/openaec/plan.pdf");
        assert_eq!(absoluut_argument("sub/plan.pdf", Some(basis)), "/openaec/sub/plan.pdf");
        assert_eq!(absoluut_argument("/data/plan.pdf", Some(basis)), "/data/plan.pdf");
        assert_eq!(absoluut_argument("plan.pdf", None), "plan.pdf");
    }

    #[test]
    fn mcp_uit_de_omgeving() {
        assert_eq!(mcp_uit(&w(&[])), Ok(None));
        let geheim = "0123456789abcdef";
        let m = mcp_uit(&w(&[("OPENAEC_MCP_POORT", "9300"), ("OPENAEC_MCP_GEHEIM", geheim)]))
            .unwrap()
            .unwrap();
        assert_eq!(m.adres, "0.0.0.0:9300".parse().unwrap());
        assert_eq!(m.geheim, geheim);
        let lokaal = mcp_uit(&w(&[
            ("OPENAEC_MCP_POORT", "9300"),
            ("OPENAEC_MCP_GEHEIM", geheim),
            ("OPENAEC_MCP_ADRES", "127.0.0.1"),
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(lokaal.adres, "127.0.0.1:9300".parse().unwrap());
        assert!(!format!("{m:?}").contains(geheim), "geheim niet in Debug");

        assert!(mcp_uit(&w(&[("OPENAEC_MCP_POORT", "9300")])).is_err());
        assert!(mcp_uit(&w(&[("OPENAEC_MCP_GEHEIM", geheim)])).is_err());
        assert!(mcp_uit(&w(&[("OPENAEC_MCP_POORT", "0"), ("OPENAEC_MCP_GEHEIM", geheim)])).is_err());
        assert!(mcp_uit(&w(&[("OPENAEC_MCP_POORT", "70000"), ("OPENAEC_MCP_GEHEIM", geheim)])).is_err());
        assert!(mcp_uit(&w(&[("OPENAEC_MCP_POORT", "9300"), ("OPENAEC_MCP_GEHEIM", "kort")])).is_err());
        assert!(mcp_uit(&w(&[
            ("OPENAEC_MCP_POORT", "9300"),
            ("OPENAEC_MCP_GEHEIM", geheim),
            ("OPENAEC_MCP_ADRES", "intern"),
        ]))
        .is_err());
        let o = Omgeving::bepaal(&w(&[("OPENAEC_MCP_POORT", "9300")]));
        assert!(o.mcp.is_none() && o.mcp_fout.is_some());
    }

    #[test]
    fn sessiebus_alleen_met_een_bekend_transport() {
        assert!(sessiebus_bruikbaar(None));
        assert!(sessiebus_bruikbaar(Some("")));
        assert!(sessiebus_bruikbaar(Some("unix:path=/run/user/1000/bus")));
        assert!(sessiebus_bruikbaar(Some("unix:abstract=/tmp/dbus-x,guid=1;tcp:host=localhost,port=1")));
        assert!(!sessiebus_bruikbaar(Some("autolaunch:")));
        assert!(!sessiebus_bruikbaar(Some("disabled:")));
    }

    #[test]
    fn frontend_krijgt_alleen_wat_hij_nodig_heeft() {
        let o = Omgeving::bepaal(&w(&[
            ("OPENAEC_BEHEERD", "1"),
            ("OPENAEC_MAP", "/openaec"),
            ("OPENAEC_MCP_POORT", "9300"),
            ("OPENAEC_MCP_GEHEIM", "0123456789abcdef"),
        ]));
        let script = init_script(&o);
        assert!(script.contains("\"beheerd\":true"), "{script}");
        assert!(script.contains("\"werkmap\":\"/openaec\""), "{script}");
        assert!(!script.contains("0123456789abcdef"), "geen geheim in de WebView");
        let leeg = init_script(&Omgeving::bepaal(&w(&[])));
        assert!(leeg.contains("\"werkmap\":null") && leeg.contains("\"beheerd\":false"), "{leeg}");
    }

    #[test]
    fn render_node_in_een_map() {
        let map = std::env::temp_dir().join(format!("opds-dri-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&map);
        std::fs::create_dir_all(&map).unwrap();
        assert!(!heeft_render_node(&map));
        std::fs::write(map.join("card0"), b"").unwrap();
        assert!(!heeft_render_node(&map));
        std::fs::write(map.join("renderD128"), b"").unwrap();
        assert!(heeft_render_node(&map));
        let _ = std::fs::remove_dir_all(&map);
        assert!(!heeft_render_node(&map));
    }
}
