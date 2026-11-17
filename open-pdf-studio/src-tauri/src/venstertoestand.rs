//! Vensterstand onthouden tussen sessies (#1025, #1126): maat, plek en
//! gemaximaliseerd.
//!
//! Het herstellen en het bestand zelf zijn van tauri-plugin-window-state
//! (`herstel_plugin`). Die plugin leest de gemaximaliseerde stand alleen bij
//! een sluitverzoek van het venster en schrijft alleen bij het afsluiten van
//! de event loop. Dat past niet bij deze app:
//!
//! * de sluitknop in de titelbalk en Bestand > Afsluiten sluiten het venster
//!   met `destroy()`. Dan komt er geen sluitverzoek, en bij het afsluiten
//!   bestaat het venster niet meer: "gemaximaliseerd" kwam zo nooit in het
//!   bestand, terwijl de plek al wel die van het gemaximaliseerde venster
//!   was. De volgende start gaf een gewoon venster in de hoek van het scherm;
//! * de bijwerker beëindigt het proces zonder de event loop af te sluiten,
//!   net als een installatie die de draaiende app sluit of een crash.
//!
//! Daarom bewaart `bewaak_plugin` de stand zodra die verandert: direct bij
//! maximaliseren of herstellen, en na verplaatsen of van maat veranderen
//! zodra het venster even stil staat. Het bestand is daarmee bij elke manier
//! van afsluiten actueel.
//!
//! Verder:
//!
//! * met `OPDS_DATA_DIR` (testinstantie, draagbare modus) staat het bestand
//!   in die map, bij de andere app-data. De plugin kent alleen de configmap
//!   van de gebruiker; in de draagbare modus hing die bovendien van het pad
//!   van de map af, zodat de stand verloren ging als dat pad veranderde;
//! * een venster dat na het herstellen niet meer te pakken is (monitor
//!   losgekoppeld, andere resolutie) schuift terug in beeld.
//!
//! Alleen de eerste, zichtbare instantie registreert deze plugins (lib.rs):
//! een losgemaakt tabblad is een tweede instantie met een eigen "main", en
//! een headless testinstantie houdt haar venster buiten beeld en mag die
//! plek bewaren noch herstellen.

mod regels;

use regels::{terug_in_beeld, Rechthoek, BESTANDSNAAM, BEWAAR_WACHTTIJD_MS};

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Wat bewaard en hersteld wordt. Zichtbaarheid en vensterrand blijven van de
/// app zelf.
fn vlaggen() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

/// Het bestand met de stand als `OPDS_DATA_DIR` gezet is; `None` laat de
/// plugin haar gewone plek gebruiken (de configmap van de gebruiker).
pub fn standbestand(identifier: &str) -> Option<PathBuf> {
    let basis = crate::datamap::override_map()?;
    // Een relatieve map telt vanaf de werkmap, net als elders; de plugin
    // heeft een absoluut pad nodig (zie herstel_plugin).
    let basis = match std::env::current_dir() {
        Ok(werkmap) => werkmap.join(&basis),
        Err(_) => basis,
    };
    if !basis.is_absolute() {
        return None;
    }
    Some(
        crate::datamap::tauri_map_onder(&basis, identifier, crate::datamap::TauriMap::Data)
            .join(BESTANDSNAAM),
    )
}

/// De plugin die de stand herstelt bij het aanmaken van een venster.
/// `identifier` is die voor gegevenspaden (draagbaar::basis_identifier).
pub fn herstel_plugin<R: Runtime>(identifier: &str) -> TauriPlugin<R> {
    let mut bouwer = tauri_plugin_window_state::Builder::default().with_state_flags(vlaggen());
    if let Some(pad) = standbestand(identifier) {
        if let Some(map) = pad.parent() {
            if let Err(e) = std::fs::create_dir_all(map) {
                eprintln!("[window-state] cannot create {}: {e}", map.display());
            }
        }
        // De plugin plakt de naam achter de configmap; een absoluut pad
        // vervangt die map (`Path::join`).
        bouwer = bouwer.with_filename(pad.to_string_lossy().into_owned());
    }
    bouwer.build()
}

/// Seintjes naar de draad die de stand na een rustpauze bewaart.
struct Bewaarder(Mutex<mpsc::Sender<()>>);

impl Bewaarder {
    fn zender(&self) -> mpsc::Sender<()> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// Heeft dit venster nu een stand om te onthouden? Niet als het
/// geminimaliseerd is (het meldt zich dan als niet-gemaximaliseerd) en niet op
/// volledig scherm (dan heeft het de maat van de monitor).
fn heeft_stand<R: Runtime>(venster: &Window<R>) -> bool {
    !venster.is_minimized().unwrap_or(false) && !venster.is_fullscreen().unwrap_or(false)
}

/// Schrijf de stand van alle vensters naar schijf; overgeslagen zolang een
/// venster geen stand heeft (`heeft_stand`), want de plugin leest ze allemaal
/// uit. Alleen op de hoofddraad: de plugin vraagt de stand op met haar cache
/// op slot, en die cache wordt ook door de venstergebeurtenissen op de
/// hoofddraad bijgewerkt.
fn bewaar<R: Runtime>(app: &AppHandle<R>) {
    if !app.webview_windows().values().all(|v| heeft_stand(&v.as_ref().window())) {
        return;
    }
    if let Err(e) = app.save_window_state(vlaggen()) {
        log::warn!("[window-state] saving failed: {e}");
    }
}

/// Start de draad die na elk seintje wacht tot het venster even stil staat
/// en de stand dan bewaart.
fn start_bewaarder<R: Runtime>(app: AppHandle<R>) -> mpsc::Sender<()> {
    let (zender, ontvanger) = mpsc::channel::<()>();
    std::thread::spawn(move || {
        while ontvanger.recv().is_ok() {
            loop {
                match ontvanger.recv_timeout(Duration::from_millis(BEWAAR_WACHTTIJD_MS)) {
                    Ok(()) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let voor_hoofddraad = app.clone();
            // Mislukt alleen als de event loop al gestopt is; dan heeft de
            // plugin de stand bij het afsluiten zelf geschreven.
            let _ = app.run_on_main_thread(move || bewaar(&voor_hoofddraad));
        }
    });
    zender
}

/// Werkgebieden van alle monitoren, in fysieke pixels.
fn werkgebieden<R: Runtime>(venster: &Window<R>) -> tauri::Result<Vec<Rechthoek>> {
    Ok(venster
        .available_monitors()?
        .iter()
        .map(|m| {
            let w = m.work_area();
            Rechthoek::new(w.position.x, w.position.y, w.size.width as i32, w.size.height as i32)
        })
        .collect())
}

/// Schuif een venster dat na het herstellen niet meer te pakken is terug in
/// beeld. Een gemaximaliseerd venster staat altijd op een monitor.
fn zet_terug_in_beeld<R: Runtime>(venster: &Window<R>) -> tauri::Result<()> {
    if venster.is_maximized()? {
        return Ok(());
    }
    let plek = venster.outer_position()?;
    let buiten = venster.outer_size()?;
    let nu = Rechthoek::new(plek.x, plek.y, buiten.width as i32, buiten.height as i32);
    let Some(doel) = terug_in_beeld(&nu, &werkgebieden(venster)?) else {
        return Ok(());
    };
    if doel.breedte != nu.breedte || doel.hoogte != nu.hoogte {
        // `set_size` zet de binnenmaat; de rand eraf.
        let binnen = venster.inner_size()?;
        let rand_b = buiten.width.saturating_sub(binnen.width) as i32;
        let rand_h = buiten.height.saturating_sub(binnen.height) as i32;
        venster.set_size(PhysicalSize::new(
            (doel.breedte - rand_b).max(1) as u32,
            (doel.hoogte - rand_h).max(1) as u32,
        ))?;
    }
    venster.set_position(PhysicalPosition::new(doel.x, doel.y))?;
    log::info!(
        "[window-state] window '{}' was out of reach at {},{}; moved to {},{}",
        venster.label(),
        nu.x,
        nu.y,
        doel.x,
        doel.y
    );
    Ok(())
}

/// De plugin die de stand bewaart zodra die verandert en een onbereikbaar
/// venster terugzet. Registreren NA `herstel_plugin`: de venster-haak hieronder
/// moet na het herstellen lopen.
pub fn bewaak_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("opds-venstertoestand")
        .setup(|app, _api| {
            app.manage(Bewaarder(Mutex::new(start_bewaarder(app.clone()))));
            Ok(())
        })
        .on_window_ready(|venster| {
            if let Err(e) = zet_terug_in_beeld(&venster) {
                // Niet elk platform geeft de plek van een venster prijs.
                log::debug!("[window-state] on-screen check for '{}' failed: {e}", venster.label());
            }
            let Some(bewaarder) = venster.try_state::<Bewaarder>() else {
                return;
            };
            let zender = bewaarder.zender();
            let gemaximaliseerd = AtomicBool::new(venster.is_maximized().unwrap_or(false));
            let dit_venster = venster.clone();
            venster.on_window_event(move |gebeurtenis| {
                if !matches!(gebeurtenis, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
                    return;
                }
                if !heeft_stand(&dit_venster) {
                    return;
                }
                let nu = dit_venster.is_maximized().unwrap_or(false);
                if gemaximaliseerd.swap(nu, Ordering::Relaxed) != nu {
                    // Gemaximaliseerd of hersteld: direct, zodat ook
                    // "maximaliseren en meteen sluiten" bewaard is.
                    bewaar(dit_venster.app_handle());
                } else {
                    let _ = zender.send(());
                }
            });
        })
        .build()
}
