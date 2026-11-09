#[cfg(any(target_os = "linux", test))]
use std::env;
#[cfg(any(target_os = "linux", test))]
use std::ffi::OsStr;
#[cfg(any(target_os = "linux", test))]
use std::path::{Path, PathBuf};

#[cfg(any(target_os = "linux", test))]
fn packaged_gio_module_dir(
    appimage: Option<&OsStr>,
    app_dir: Option<&OsStr>,
    configured_module_dir: Option<&OsStr>,
    extra_module_dirs: Option<&OsStr>,
    current_exe: Option<&Path>,
) -> Option<PathBuf> {
    if configured_module_dir.is_some() {
        return None;
    }

    let app_dir = Path::new(app_dir?);
    // A mounted AppImage sets APPIMAGE. An extracted one (`--appimage-extract`
    // and then `squashfs-root/AppRun`, as in containers without FUSE, #863)
    // only has APPDIR; then the running binary must live inside it.
    if appimage.is_none() && !current_exe.is_some_and(|exe| exe.starts_with(app_dir)) {
        return None;
    }
    env::split_paths(extra_module_dirs?).find(|candidate| candidate.starts_with(app_dir))
}

pub fn configure_appimage_gio_modules() {
    #[cfg(target_os = "linux")]
    if let Some(module_dir) = packaged_gio_module_dir(
        env::var_os("APPIMAGE").as_deref(),
        env::var_os("APPDIR").as_deref(),
        env::var_os("GIO_MODULE_DIR").as_deref(),
        env::var_os("GIO_EXTRA_MODULES").as_deref(),
        env::current_exe().ok().as_deref(),
    ) {
        // The AppImage bundles GIO from the build host. Point its default module
        // lookup at the matching packaged directory so it cannot load a newer
        // host GVFS module against that older library.
        env::set_var("GIO_MODULE_DIR", module_dir);
    }
}

// Flatpak puts /.flatpak-info in every sandbox (the documented way to detect
// it). In there the CUPS client tools and xdg-utils are missing: printing
// goes over the CUPS socket or the print portal, and the default PDF app is
// chosen in the desktop's own settings. Updates then come from the Flatpak
// remote (Flathub), not from the built-in updater: Flathub does not allow
// apps to update themselves.
#[cfg(any(target_os = "linux", test))]
fn is_flatpak_sandbox(flatpak_info: &Path) -> bool {
    flatpak_info.is_file()
}

pub fn running_in_flatpak() -> bool {
    #[cfg(target_os = "linux")]
    {
        is_flatpak_sandbox(Path::new("/.flatpak-info"))
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// A strictly confined Snap: snapd sets SNAP and SNAP_NAME for every app it
/// starts. Like a Flatpak it cannot rely on host tools or write the desktop's
/// mime associations.
#[cfg(any(target_os = "linux", test))]
fn is_snap_omgeving(snap: Option<&OsStr>, snap_name: Option<&OsStr>) -> bool {
    snap.is_some_and(|s| !s.is_empty()) && snap_name.is_some_and(|s| !s.is_empty())
}

pub fn running_in_snap() -> bool {
    #[cfg(target_os = "linux")]
    {
        is_snap_omgeving(env::var_os("SNAP").as_deref(), env::var_os("SNAP_NAME").as_deref())
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Realtime scheduling for WebKit's IPC threads (#924). WebKitGTK promotes its
/// `ReceiveQueue` threads to SCHED_RR when RLIMIT_RTPRIO allows it, and sets
/// RLIMIT_RTTIME to 200 ms. A thread that then spends more than 200 ms of CPU
/// without blocking (page-faulting in a large IPC payload while zooming) gets
/// the whole app SIGKILLed by the kernel, without a message. Many audio-tuned
/// distributions give the `audio` group `rtprio 99`, so this hits ordinary
/// desktops. Lowering RLIMIT_RTPRIO to 0 at startup, before GTK and WebKit
/// create threads, keeps every thread on normal scheduling (the same as
/// `prlimit --rtprio=0`); the web process inherits the limit.
/// `OPDS_ALLOW_REALTIME=1` keeps the limit as the session set it.
#[cfg(any(target_os = "linux", test))]
fn realtime_toegestaan(waarde: Option<&OsStr>) -> bool {
    omgevingsvlag_aan(waarde)
}

/// "1", "true", "yes" of "on" (hoofdletters en spaties maken niet uit).
#[cfg(any(target_os = "linux", test))]
fn omgevingsvlag_aan(waarde: Option<&OsStr>) -> bool {
    let Some(waarde) = waarde.and_then(OsStr::to_str) else {
        return false;
    };
    matches!(waarde.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
}

pub fn disable_realtime_threads() {
    #[cfg(target_os = "linux")]
    {
        if realtime_toegestaan(env::var_os("OPDS_ALLOW_REALTIME").as_deref()) {
            return;
        }
        let limiet = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        // SAFETY: setrlimit reads one valid rlimit struct and only lowers this
        // process's own limit.
        if unsafe { libc::setrlimit(libc::RLIMIT_RTPRIO, &limiet) } != 0 {
            eprintln!(
                "[startup] could not lower RLIMIT_RTPRIO: {}",
                std::io::Error::last_os_error()
            );
        }
    }
}

/// GPU-versnelling van het 2D-canvas (#924, crash B). Met versnelling tekent
/// WebKitGTK (2.46+, Skia) `ctx.fill()` via Skia's GPU-pad op de Mesa van de
/// host, terwijl de AppImage een WebKit van de bouwmachine meebrengt. Bij
/// zoomen kwam de cache van GPU-resources daar in een ongeldige toestand en
/// viel het webproces uit met SIGILL (leeg venster). Zonder versnelling tekent
/// het canvas op de CPU; de rest van de compositie blijft op de GPU, anders dan
/// bij `WEBKIT_DISABLE_DMABUF_RENDERER=1`. `OPDS_CANVAS_GPU=1` houdt de
/// versnelling aan.
#[cfg(any(target_os = "linux", test))]
const CANVAS_VERSNELLING: &str = "enable-2d-canvas-acceleration";

#[cfg(any(target_os = "linux", test))]
fn canvas_gpu_toegestaan(waarde: Option<&OsStr>) -> bool {
    omgevingsvlag_aan(waarde)
}

/// Zet de 2D-canvasversnelling uit in de WebKitSettings van deze WebView. De
/// eigenschap bestaat pas sinds WebKitGTK 2.46 en de webkit2gtk-crate heeft er
/// geen setter voor; daarom op naam, en alleen als ze bestaat, schrijfbaar is
/// en een boolean is (`set_property` breekt anders af). Oudere WebKitGTK tekent
/// het canvas met Cairo en heeft dit pad niet.
#[cfg(target_os = "linux")]
pub fn zet_canvas_versnelling_uit<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    if canvas_gpu_toegestaan(env::var_os("OPDS_CANVAS_GPU").as_deref()) {
        return;
    }
    let label = webview.label().to_string();
    let resultaat = webview.with_webview(move |platform| {
        use webkit2gtk::glib::prelude::{ObjectExt, StaticType};
        use webkit2gtk::glib::ParamFlags;
        use webkit2gtk::WebViewExt;

        let Some(instellingen) = platform.inner().settings() else {
            return;
        };
        let Some(spec) = instellingen.find_property(CANVAS_VERSNELLING) else {
            return;
        };
        if spec.value_type() != bool::static_type() || !spec.flags().contains(ParamFlags::WRITABLE) {
            return;
        }
        instellingen.set_property(CANVAS_VERSNELLING, false);
        eprintln!("[startup] 2D canvas acceleration off for webview '{label}' (#924)");
    });
    if let Err(e) = resultaat {
        eprintln!("[startup] could not reach the webview settings: {e}");
    }
}

/// Vloeiend scrollen (#1007). WebKitGTK zet `enable-smooth-scrolling`
/// standaard aan: een wielklik, een pijl- of PageDown-toets en een klik in de
/// schuifbalk worden dan geanimeerd en de pagina glijdt na het wielen nog even
/// door. De app volgt de voorkeur "Vloeiend scrollen" (standaard uit): bij het
/// aanmaken van elke WebView uit het voorkeurenbestand, en daarna live via de
/// opdracht `zet_vloeiend_scrollen` zodra de voorkeur verandert. Aan
/// touchpadscrollen voegt de app zelf geen traagheid toe; doorglijden na het
/// loslaten komt van GTK en de desktop.
#[cfg(any(target_os = "linux", test))]
const VLOEIEND_SCROLLEN: &str = "enable-smooth-scrolling";

/// Staat vloeiend scrollen aan in de opgeslagen voorkeuren (`smoothScrolling`)?
/// Standaard uit, ook als het bestand ontbreekt, onleesbaar is of de sleutel
/// geen boolean is.
#[cfg(any(target_os = "linux", test))]
fn vloeiend_scrollen_in_voorkeuren(json: Option<&str>) -> bool {
    json.and_then(|tekst| serde_json::from_str::<serde_json::Value>(tekst).ok())
        .and_then(|voorkeuren| voorkeuren.get("smoothScrolling").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

/// De opgeslagen voorkeur, gelezen bij het aanmaken van een WebView (de
/// JS-kant draait dan nog niet).
#[cfg(target_os = "linux")]
fn vloeiend_scrollen_bij_start() -> bool {
    let tekst = std::fs::read_to_string(crate::get_preferences_file_path()).ok();
    vloeiend_scrollen_in_voorkeuren(tekst.as_deref())
}

/// Zet vloeiend scrollen aan of uit in de WebKitSettings van deze WebView. Op
/// naam en alleen als de eigenschap bestaat, schrijfbaar is en een boolean is,
/// net als bij de canvasversnelling hierboven (`set_property` breekt anders
/// af). WebKitGTK past een gewijzigde instelling meteen toe; mocht een versie
/// dat niet doen, dan geldt de voorkeur na een herstart van de app.
#[cfg(target_os = "linux")]
pub fn zet_vloeiend_scrollen<R: tauri::Runtime>(webview: &tauri::Webview<R>, aan: bool) {
    let label = webview.label().to_string();
    let resultaat = webview.with_webview(move |platform| {
        use webkit2gtk::glib::prelude::{ObjectExt, StaticType};
        use webkit2gtk::glib::ParamFlags;
        use webkit2gtk::WebViewExt;

        let Some(instellingen) = platform.inner().settings() else {
            return;
        };
        let Some(spec) = instellingen.find_property(VLOEIEND_SCROLLEN) else {
            return;
        };
        if spec.value_type() != bool::static_type() || !spec.flags().contains(ParamFlags::WRITABLE) {
            return;
        }
        instellingen.set_property(VLOEIEND_SCROLLEN, aan);
        eprintln!("[startup] smooth scrolling {} for webview '{label}' (#1007)", if aan { "on" } else { "off" });
    });
    if let Err(e) = resultaat {
        eprintln!("[startup] could not reach the webview settings: {e}");
    }
}

/// Plugin die elke WebView van de app (hoofdvenster, printwachtrij en elk
/// ander venster) bij het aanmaken langs `zet_canvas_versnelling_uit` en
/// `zet_vloeiend_scrollen` stuurt. Een losgetrokken tabblad is een eigen
/// app-proces en krijgt deze plugin ook.
#[cfg(target_os = "linux")]
pub fn webview_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("opds-linux-webview")
        .on_webview_ready(|webview| {
            zet_canvas_versnelling_uit(&webview);
            zet_vloeiend_scrollen(&webview, vloeiend_scrollen_bij_start());
        })
        .build()
}

/// "flatpak", "snap" or None: the package sandbox this process runs in.
pub fn sandbox() -> Option<&'static str> {
    if running_in_flatpak() {
        Some("flatpak")
    } else if running_in_snap() {
        Some("snap")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{
        canvas_gpu_toegestaan, is_flatpak_sandbox, is_snap_omgeving, packaged_gio_module_dir,
        realtime_toegestaan, vloeiend_scrollen_in_voorkeuren, CANVAS_VERSNELLING, VLOEIEND_SCROLLEN,
    };
    use std::env;
    use std::ffi::OsStr;
    use std::path::PathBuf;

    #[test]
    fn selects_a_packaged_gio_module_directory() {
        let app_dir = PathBuf::from("app-image-root");
        let host_modules = PathBuf::from("host-gio-modules");
        let packaged_modules = app_dir.join("usr/lib/gio/modules");
        let extra_modules = env::join_paths([&host_modules, &packaged_modules]).unwrap();

        assert_eq!(
            packaged_gio_module_dir(
                Some(OsStr::new("Open.PDF.Studio.AppImage")),
                Some(app_dir.as_os_str()),
                None,
                Some(extra_modules.as_os_str()),
                None,
            ),
            Some(packaged_modules),
        );
    }

    #[test]
    fn selects_the_packaged_directory_for_an_extracted_appimage() {
        let app_dir = PathBuf::from("squashfs-root");
        let packaged_modules = app_dir.join("usr/lib/x86_64-linux-gnu/gio/modules");
        let exe = app_dir.join("usr/bin/open-pdf-studio");

        assert_eq!(
            packaged_gio_module_dir(
                None,
                Some(app_dir.as_os_str()),
                None,
                Some(packaged_modules.as_os_str()),
                Some(&exe),
            ),
            Some(packaged_modules.clone()),
        );
        // APPDIR inherited by a program that is not inside it: leave GIO alone.
        assert_eq!(
            packaged_gio_module_dir(
                None,
                Some(app_dir.as_os_str()),
                None,
                Some(packaged_modules.as_os_str()),
                Some(&PathBuf::from("elsewhere/bin/other")),
            ),
            None,
        );
    }

    #[test]
    fn respects_an_explicit_gio_module_directory() {
        let app_dir = PathBuf::from("app-image-root");
        let packaged_modules = app_dir.join("usr/lib/gio/modules");

        assert_eq!(
            packaged_gio_module_dir(
                Some(OsStr::new("Open.PDF.Studio.AppImage")),
                Some(app_dir.as_os_str()),
                Some(OsStr::new("custom-gio-modules")),
                Some(packaged_modules.as_os_str()),
                None,
            ),
            None,
        );
    }

    #[test]
    fn ignores_non_appimage_processes_and_host_module_directories() {
        assert_eq!(
            packaged_gio_module_dir(
                None,
                Some(OsStr::new("app-image-root")),
                None,
                Some(OsStr::new("host-gio-modules")),
                None,
            ),
            None,
        );
        assert_eq!(
            packaged_gio_module_dir(
                Some(OsStr::new("Open.PDF.Studio.AppImage")),
                Some(OsStr::new("app-image-root")),
                None,
                Some(OsStr::new("host-gio-modules")),
                None,
            ),
            None,
        );
    }

    #[test]
    fn detects_the_flatpak_sandbox_by_its_info_file() {
        let dir = env::temp_dir().join(format!("opds-flatpak-info-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let info = dir.join(".flatpak-info");
        assert!(!is_flatpak_sandbox(&info));
        std::fs::write(&info, "[Application]\nname=org.openaec.OpenPdfStudio\n").unwrap();
        assert!(is_flatpak_sandbox(&info));
        assert!(!is_flatpak_sandbox(&dir), "a directory is not the info file");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_a_snap_by_its_environment() {
        let snap = OsStr::new("/snap/open-pdf-studio/12");
        let naam = OsStr::new("open-pdf-studio");
        assert!(is_snap_omgeving(Some(snap), Some(naam)));
        assert!(!is_snap_omgeving(Some(snap), None));
        assert!(!is_snap_omgeving(None, Some(naam)));
        assert!(!is_snap_omgeving(Some(OsStr::new("")), Some(naam)));
    }

    #[test]
    fn realtime_threads_stay_off_unless_explicitly_allowed() {
        assert!(!realtime_toegestaan(None));
        assert!(!realtime_toegestaan(Some(OsStr::new(""))));
        assert!(!realtime_toegestaan(Some(OsStr::new("0"))));
        assert!(!realtime_toegestaan(Some(OsStr::new("false"))));
        for aan in ["1", "true", "YES", " on "] {
            assert!(realtime_toegestaan(Some(OsStr::new(aan))), "{aan}");
        }
    }

    #[test]
    fn canvas_acceleration_stays_off_unless_explicitly_allowed() {
        assert_eq!(CANVAS_VERSNELLING, "enable-2d-canvas-acceleration");
        assert!(!canvas_gpu_toegestaan(None));
        assert!(!canvas_gpu_toegestaan(Some(OsStr::new("0"))));
        assert!(!canvas_gpu_toegestaan(Some(OsStr::new("off"))));
        for aan in ["1", "true", "Yes", " ON "] {
            assert!(canvas_gpu_toegestaan(Some(OsStr::new(aan))), "{aan}");
        }
    }

    #[test]
    fn smooth_scrolling_follows_the_saved_preference_and_defaults_to_off() {
        assert_eq!(VLOEIEND_SCROLLEN, "enable-smooth-scrolling");
        assert!(!vloeiend_scrollen_in_voorkeuren(None));
        assert!(!vloeiend_scrollen_in_voorkeuren(Some("")));
        assert!(!vloeiend_scrollen_in_voorkeuren(Some("not json")));
        assert!(!vloeiend_scrollen_in_voorkeuren(Some(r#"{"theme":"light"}"#)));
        assert!(!vloeiend_scrollen_in_voorkeuren(Some(r#"{"smoothScrolling":false}"#)));
        assert!(!vloeiend_scrollen_in_voorkeuren(Some(r#"{"smoothScrolling":"true"}"#)));
        assert!(vloeiend_scrollen_in_voorkeuren(Some(r#"{"theme":"light","smoothScrolling":true}"#)));
    }
}
