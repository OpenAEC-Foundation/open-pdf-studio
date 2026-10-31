//! Documentbeveiliging (#378): wachtwoorden en rechten instellen, de
//! beveiliging van een geopend bestand behouden bij opslaan, en verwijderen.
//! Het rekenwerk (AES-256, V 5 / R 6) staat in de crate `open-pdf-security`;
//! hier alleen de Tauri-commando's en de sessies.
//!
//! Een sessie is een beveiliging die de app kan schrijven: de bestandssleutel
//! plus het /Encrypt-woordenboek. De JS krijgt alleen een willekeurige naam
//! (`handle`) en een beschrijving; de sleutel en de wachtwoorden blijven hier.
//! - Geopend met een wachtwoord (of een bestand dat zonder wachtwoord opent
//!   maar wel rechten heeft): de sessie neemt de beveiliging van het bestand
//!   over, zodat opslaan beide wachtwoorden en de rechten houdt
//!   ([`sessie_voor_bestand`], vanuit `beveiligde_pdf::open_protected_pdf`).
//! - Nieuwe wachtwoorden of rechten in de dialoog: [`pdf_security_new`],
//!   [`pdf_security_permissions`].
//! - Opslaan: de saver geeft de ontsleutelde bytes en de naam van de sessie
//!   aan [`write_protected_pdf_atomic`], dat versleutelt en schrijft.
//!
//! Fouten gaan als vaste code naar de interface; nooit met een wachtwoord erin.

use std::collections::HashMap;
use std::sync::Mutex;

use rand::RngCore;
use zeroize::{Zeroize, Zeroizing};

pub use open_pdf_security::{wachtwoord_vormen, versleutel, Beveiliging, OpenFout, Rechten, FOUT_SCHRIJVEN};

/// Foutcode: de sessie bestaat niet (meer).
pub const FOUT_GEEN_SESSIE: &str = "NO_SECURITY_SESSION";
/// Foutcode: wijzigen vraagt het rechtenwachtwoord.
pub const FOUT_NIET_TOEGESTAAN: &str = "OWNER_PASSWORD_REQUIRED";

/// De beveiligingen die deze instantie kan schrijven, op naam.
#[derive(Default)]
pub struct BeveiligingsSessies(pub Mutex<HashMap<String, Beveiliging>>);

/// Wat de interface over een beveiliging weet.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessieInfo {
    /// Naam van de sessie; `None` als de app deze beveiliging niet kan
    /// terugschrijven (een oudere methode dan AES-256).
    pub handle: Option<String>,
    pub methode: String,
    pub revisie: i64,
    pub p: i32,
    pub rechten: Rechten,
    /// Ontgrendeld met het rechtenwachtwoord (of zelf ingesteld).
    pub eigenaar_toegang: bool,
    /// Opent het bestand alleen met een wachtwoord?
    pub open_wachtwoord: bool,
    /// Mag de beveiliging gewijzigd of verwijderd worden zonder eerst het
    /// rechtenwachtwoord te geven?
    pub mag_wijzigen: bool,
}

fn nieuwe_naam() -> String {
    let mut b = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn info_van(b: &Beveiliging, handle: Option<String>) -> SessieInfo {
    SessieInfo {
        handle,
        methode: b.info().methode,
        revisie: b.revisie(),
        p: b.p(),
        rechten: b.rechten(),
        eigenaar_toegang: b.eigenaar_toegang(),
        open_wachtwoord: b.open_wachtwoord(),
        mag_wijzigen: b.mag_wijzigen(),
    }
}

fn registreer(sessies: &BeveiligingsSessies, b: Beveiliging) -> Result<SessieInfo, String> {
    let naam = nieuwe_naam();
    let info = info_van(&b, Some(naam.clone()));
    sessies.0.lock().map_err(|e| e.to_string())?.insert(naam, b);
    Ok(info)
}

/// De beveiliging van een versleuteld bestand dat met `wachtwoord` geopend is.
/// AES-256 wordt een sessie; een oudere methode alleen een beschrijving
/// (`handle` leeg). `pdfium_eigenaar`: PDFium gaf volledige rechten (het
/// rechtenwachtwoord), voor de oudere methoden. `None` als het bestand niet
/// versleuteld of niet te lezen is.
pub fn sessie_voor_bestand(
    sessies: &BeveiligingsSessies,
    bytes: &[u8],
    wachtwoord: &str,
    pdfium_eigenaar: bool,
) -> Option<SessieInfo> {
    match Beveiliging::uit_bestand(bytes, wachtwoord) {
        Ok(b) => registreer(sessies, b).ok(),
        Err(OpenFout::NietOndersteund(info)) => Some(SessieInfo {
            handle: None,
            methode: info.methode,
            revisie: info.r,
            p: info.p,
            rechten: info.rechten,
            eigenaar_toegang: pdfium_eigenaar,
            open_wachtwoord: !wachtwoord.is_empty(),
            mag_wijzigen: pdfium_eigenaar || info.rechten.alles_toegestaan(),
        }),
        Err(e) => {
            log::warn!("[beveiliging] bestaande beveiliging niet overgenomen: {}", e.code());
            None
        }
    }
}

/// Nieuwe wachtwoorden en rechten voor het geopende document; ze gelden bij
/// het volgende opslaan.
#[tauri::command]
pub async fn pdf_security_new(
    sessies: tauri::State<'_, BeveiligingsSessies>,
    gebruikerswachtwoord: String,
    eigenaarwachtwoord: String,
    rechten: Rechten,
) -> Result<SessieInfo, String> {
    let gebruiker = Zeroizing::new(gebruikerswachtwoord);
    let eigenaar = Zeroizing::new(eigenaarwachtwoord);
    let b = tokio::task::spawn_blocking(move || Beveiliging::nieuw(&gebruiker, &eigenaar, &rechten))
        .await
        .map_err(|e| format!("{FOUT_SCHRIJVEN}: {e}"))?
        .map_err(|f| f.code())?;
    registreer(&sessies, b)
}

/// Dezelfde wachtwoorden met andere rechten. Vraagt eigenaarstoegang (of een
/// bestand zonder beperkingen); geeft een nieuwe sessie, de oude blijft.
#[tauri::command]
pub fn pdf_security_permissions(
    sessies: tauri::State<'_, BeveiligingsSessies>,
    handle: String,
    rechten: Rechten,
) -> Result<SessieInfo, String> {
    let nieuw = {
        let lijst = sessies.0.lock().map_err(|e| e.to_string())?;
        let b = lijst.get(&handle).ok_or(FOUT_GEEN_SESSIE)?;
        if !b.mag_wijzigen() {
            return Err(FOUT_NIET_TOEGESTAAN.into());
        }
        b.met_rechten(&rechten)
    };
    registreer(&sessies, nieuw)
}

/// Geeft de sessie eigenaarstoegang als `wachtwoord` het rechtenwachtwoord is.
#[tauri::command]
pub async fn pdf_security_unlock_owner(
    sessies: tauri::State<'_, BeveiligingsSessies>,
    handle: String,
    wachtwoord: String,
) -> Result<SessieInfo, String> {
    let wachtwoord = Zeroizing::new(wachtwoord);
    // Eerst een kopie: de hash kost tijd, de vergrendeling blijft niet staan.
    let mut b = {
        let lijst = sessies.0.lock().map_err(|e| e.to_string())?;
        lijst.get(&handle).ok_or(FOUT_GEEN_SESSIE)?.clone()
    };
    let b = tokio::task::spawn_blocking(move || b.ontgrendel_eigenaar(&wachtwoord).then_some(b))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| open_pdf_security::FOUT_VERKEERD_WACHTWOORD.to_string())?;
    let info = info_van(&b, Some(handle.clone()));
    sessies.0.lock().map_err(|e| e.to_string())?.insert(handle, b);
    Ok(info)
}

/// Vergeet sessies (bij het sluiten van een tabblad).
#[tauri::command]
pub fn pdf_security_release(sessies: tauri::State<'_, BeveiligingsSessies>, handles: Vec<String>) {
    if let Ok(mut lijst) = sessies.0.lock() {
        for h in handles {
            lijst.remove(&h);
        }
    }
}

/// Versleutelt de (ontsleutelde) PDF in de body met sessie `x-opds-security`
/// en schrijft het resultaat atomair naar `x-opds-path`.
#[tauri::command]
pub async fn write_protected_pdf_atomic(
    request: tauri::ipc::Request<'_>,
    sessies: tauri::State<'_, BeveiligingsSessies>,
) -> Result<(), String> {
    let kop = |naam: &str| -> Result<String, String> {
        let w = request.headers().get(naam).ok_or_else(|| format!("Missing {naam}"))?
            .to_str().map_err(|e| e.to_string())?;
        Ok(urlencoding::decode(w).map_err(|e| e.to_string())?.into_owned())
    };
    let pad = kop("x-opds-path")?;
    let handle = kop("x-opds-security")?;
    let mut bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        // Android kent geen ruwe IPC-body.
        tauri::ipc::InvokeBody::Json(value) => {
            serde_json::from_value::<Vec<u8>>(value.get("data").cloned().ok_or("Missing file data")?)
                .map_err(|e| e.to_string())?
        }
    };
    // Een eigen kopie van de sessie: de vergrendeling blijft niet staan
    // tijdens het versleutelen.
    let beveiliging = {
        let lijst = sessies.0.lock().map_err(|e| e.to_string())?;
        lijst.get(&handle).ok_or(FOUT_GEEN_SESSIE)?.clone()
    };
    tokio::task::spawn_blocking(move || {
        let resultaat = versleutel(&bytes, &beveiliging).map_err(|f| f.code());
        // De ontsleutelde inhoud niet langer in het geheugen dan nodig.
        bytes.zeroize();
        let uit = resultaat?;
        crate::atomic_file::write(std::path::Path::new(&pad), &uit)
            .map_err(|e| format!("{FOUT_SCHRIJVEN}: {e}"))
    })
    .await
    .map_err(|e| format!("{FOUT_SCHRIJVEN}: {e}"))?
}
