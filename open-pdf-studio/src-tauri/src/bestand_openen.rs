//! Een PDF openen vanaf een gesynchroniseerde SharePoint-/OneDrive-map of een
//! netwerkpad (#1005).
//!
//! Daar gaat het openen op plekken mis die op een gewone schijf nooit
//! opvallen:
//! - De vergrendeling (anderen mogen alleen lezen) lukt niet, omdat de
//!   synchronisatie-app of een andere app het bestand open heeft om te
//!   schrijven. Dan opent het document alleen-lezen in plaats van niet.
//! - Het bestand staat alleen online (bestanden op aanvraag). Lezen haalt het
//!   op; staat de synchronisatie-app uit of is ze niet aangemeld, dan weigert
//!   Windows met "toegang geweigerd". Daarom eerst lezen (dat haalt het
//!   bestand op) en pas daarna vergrendelen: een vergrendeling die anderen het
//!   schrijven verbiedt, mag het ophalen niet in de weg zitten.
//! - De fs-scope van Tauri moet het pad kunnen canonicaliseren; op een
//!   WebDAV-pad (`\\tenant.sharepoint.com@SSL\DavWWWRoot\...`) lukt dat niet
//!   altijd, en dan weigert de fs-plugin elk lezen ("forbidden path"). Het
//!   document zelf leest de app daarom met een eigen commando, met delen voor
//!   lezen, schrijven en verwijderen.
//!
//! Elke fout zegt bij welke stap (scope, vergrendelen, lezen, alleen online)
//! en welk pad, zodat de melding meer zegt dan "toegang geweigerd".

use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};

// ── Padsoorten ──────────────────────────────────────────────────────────────

/// Waar een pad naartoe wijst.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PadSoort {
    /// Een stationsletter (ook een gesynchroniseerde map).
    Lokaal,
    /// Een netwerkpad `\\server\share\...`.
    Unc,
    /// Een WebDAV-netwerkpad, zoals SharePoint dat via de verkenner geeft.
    Webdav,
}

/// Een map van een synchronisatie-app (bestanden op aanvraag).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncMap {
    Onedrive,
    Sharepoint,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PadInfo {
    pub soort: PadSoort,
    /// Het pad had al het voorvoegsel `\\?\`.
    pub verbatim: bool,
    /// Langer dan MAX_PATH (259 tekens zonder afsluitende nul).
    pub lang: bool,
    pub sync: Option<SyncMap>,
}

/// Hoogste aantal tekens (UTF-16) dat een pad zonder `\\?\` mag hebben.
pub const MAX_PAD_ZONDER_VOORVOEGSEL: usize = 259;

fn begint_met_ci<'a>(tekst: &'a str, voorvoegsel: &str) -> Option<&'a str> {
    let n = voorvoegsel.len();
    if tekst.len() >= n && tekst.is_char_boundary(n) && tekst[..n].eq_ignore_ascii_case(voorvoegsel) {
        Some(&tekst[n..])
    } else {
        None
    }
}

/// Het pad zonder `\\?\`/`\\?\UNC\`, met backslashes. Geeft ook of het
/// voorvoegsel er stond.
pub fn zonder_verbatim(pad: &str) -> (String, bool) {
    let p = pad.replace('/', "\\");
    if let Some(rest) = begint_met_ci(&p, r"\\?\UNC\") {
        return (format!(r"\\{rest}"), true);
    }
    if let Some(rest) = p.strip_prefix(r"\\?\") {
        return (rest.to_string(), true);
    }
    (p, false)
}

/// Mappen in een gebruikersprofiel die nooit een SharePoint-bibliotheek zijn.
const PROFIELMAPPEN: &[&str] = &[
    "appdata", "desktop", "documents", "downloads", "pictures", "music", "videos",
    "favorites", "links", "saved games", "searches", "contacts", "3d objects", "source",
    "onedrive",
];

fn is_onedrive_map(segment: &str) -> bool {
    let s = segment.to_lowercase();
    s == "onedrive" || s.starts_with("onedrive - ")
}

/// Welke soort pad dit is. `sync_wortels` zijn de mappen die de
/// synchronisatie-app opgeeft (de omgevingsvariabelen OneDrive,
/// OneDriveCommercial, OneDriveConsumer); leeg mag.
pub fn classificeer_pad(pad: &str, sync_wortels: &[String]) -> PadInfo {
    let (gewoon, verbatim) = zonder_verbatim(pad);
    let lang = gewoon.encode_utf16().count() > MAX_PAD_ZONDER_VOORVOEGSEL;

    let soort = match gewoon.strip_prefix(r"\\") {
        Some(rest) if !rest.starts_with('.') && !rest.starts_with('?') => {
            let mut delen = rest.split('\\');
            let host = delen.next().unwrap_or("").to_ascii_lowercase();
            let share = delen.next().unwrap_or("").to_ascii_lowercase();
            if host.contains('@') || share == "davwwwroot" || host.ends_with(".sharepoint.com") {
                PadSoort::Webdav
            } else {
                PadSoort::Unc
            }
        }
        Some(_) => PadSoort::Unc,
        None => PadSoort::Lokaal,
    };

    let laag = gewoon.to_lowercase();
    let mut sync = None;
    for wortel in sync_wortels {
        let w = wortel.replace('/', "\\").trim_end_matches('\\').to_lowercase();
        if w.is_empty() {
            continue;
        }
        if laag == w || laag.starts_with(&format!("{w}\\")) {
            sync = Some(SyncMap::Onedrive);
            break;
        }
    }
    if sync.is_none() && soort == PadSoort::Lokaal {
        let segmenten: Vec<&str> = gewoon.split('\\').filter(|s| !s.is_empty()).collect();
        // C:\Users\<naam>\... — de gebruikelijke plek van de synchronisatiemappen.
        if segmenten.len() >= 5 && segmenten[1].eq_ignore_ascii_case("users") {
            let eerste = segmenten[3];
            let tweede = segmenten[4];
            if is_onedrive_map(eerste) {
                sync = Some(SyncMap::Onedrive);
            } else if segmenten.len() >= 6
                && tweede.contains(" - ")
                && !eerste.starts_with('.')
                && !PROFIELMAPPEN.contains(&eerste.to_lowercase().as_str())
            {
                // <organisatie>\<site> - <bibliotheek>\<bestand>
                sync = Some(SyncMap::Sharepoint);
            }
        }
    }

    PadInfo { soort, verbatim, lang, sync }
}

/// Het pad met `\\?\` (of `\\?\UNC\`), zodat ook een pad langer dan MAX_PATH
/// overal werkt. `None` als het niet kan: een relatief pad, een apparaatpad of
/// een pad met `.`/`..` (met het voorvoegsel normaliseert Windows niets meer).
pub fn verbatim_vorm(pad: &str) -> Option<String> {
    let (gewoon, verbatim) = zonder_verbatim(pad);
    if verbatim {
        return Some(pad.replace('/', "\\"));
    }
    if gewoon.split('\\').any(|s| s == "." || s == "..") {
        return None;
    }
    if let Some(rest) = gewoon.strip_prefix(r"\\") {
        if rest.is_empty() || rest.starts_with('.') || rest.starts_with('?') {
            return None;
        }
        return Some(format!(r"\\?\UNC\{rest}"));
    }
    let b = gewoon.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\' {
        return Some(format!(r"\\?\{gewoon}"));
    }
    None
}

/// Alle schrijfwijzen van een pad die in de fs-scope horen: zoals gegeven,
/// zonder en met `\\?\`. De scope vergelijkt tekst; zonder deze varianten valt
/// een lang pad (dat Windows met `\\?\` teruggeeft) of een netwerkpad buiten.
pub fn scope_varianten(pad: &str) -> Vec<String> {
    let mut uit: Vec<String> = vec![pad.to_string()];
    let (gewoon, _) = zonder_verbatim(pad);
    for v in [Some(gewoon), verbatim_vorm(pad)].into_iter().flatten() {
        if !uit.contains(&v) {
            uit.push(v);
        }
    }
    uit
}

// ── Bestandskenmerken ───────────────────────────────────────────────────────

pub const FILE_ATTRIBUTE_READONLY: u32 = 0x1;
pub const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
pub const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x4_0000;
pub const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;

/// Een plaatshouder van een bestand dat alleen online staat: lezen moet het
/// eerst ophalen.
pub fn is_plaatshouder(kenmerken: u32) -> bool {
    kenmerken & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0
}

/// De bestandskenmerken (Windows), of `None` als ze niet te lezen zijn.
/// `fs::metadata` opent het bestand zonder data-toegang, dus haalt een
/// plaatshouder niet op.
pub fn kenmerken(pad: &str) -> Option<u32> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        fs::metadata(pad).ok().map(|m| m.file_attributes())
    }
    // Elders geen kenmerken: een bestand zonder schrijfrechten is daar via
    // het vervangen (atomic_file) gewoon op te slaan, zoals altijd.
    #[cfg(not(windows))]
    {
        fs::metadata(pad).ok().map(|_| 0)
    }
}

// ── Foutsoorten ─────────────────────────────────────────────────────────────

/// Waar het openen misging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OpenStap {
    Scope,
    Vergrendelen,
    Lezen,
}

/// Wat er misging, los van de stap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FoutSoort {
    NietGevonden,
    Geweigerd,
    InGebruik,
    /// Alleen online en niet op te halen (synchronisatie-app uit, niet
    /// aangemeld, geen netwerk, of ophalen geblokkeerd).
    AlleenOnline,
    Netwerk,
    PadTeLang,
    Anders,
}

/// Windows-foutcodes van de cloudbestanden-API (bestanden op aanvraag).
pub fn is_cloudfout(code: i32) -> bool {
    matches!(code, 358 | 362..=366 | 374..=375 | 377..=383 | 386..=398 | 404 | 426 | 475)
}

/// Soort van een OS-fout. `plaatshouder`: het bestand stond alleen online;
/// dan betekent "toegang geweigerd" vrijwel altijd dat het niet op te halen
/// was.
pub fn soort_van_fout(code: Option<i32>, kind: io::ErrorKind, plaatshouder: bool) -> FoutSoort {
    match code {
        Some(2) | Some(3) => FoutSoort::NietGevonden,
        Some(206) => FoutSoort::PadTeLang,
        Some(5) => if plaatshouder { FoutSoort::AlleenOnline } else { FoutSoort::Geweigerd },
        Some(32) | Some(33) => FoutSoort::InGebruik,
        Some(c) if is_cloudfout(c) => FoutSoort::AlleenOnline,
        Some(51 | 53 | 59 | 64 | 67 | 121 | 1203 | 1222 | 1231 | 1232 | 2250) => FoutSoort::Netwerk,
        _ => match kind {
            io::ErrorKind::NotFound => FoutSoort::NietGevonden,
            io::ErrorKind::PermissionDenied => {
                if plaatshouder { FoutSoort::AlleenOnline } else { FoutSoort::Geweigerd }
            }
            _ => FoutSoort::Anders,
        },
    }
}

/// De fout die JS krijgt (invoke wijst af met dit object).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFout {
    pub stap: OpenStap,
    pub soort: FoutSoort,
    pub pad: String,
    pub code: Option<i32>,
    /// De tekst van het besturingssysteem.
    pub melding: String,
    pub plaatshouder: bool,
    pub pad_info: PadInfo,
}

impl OpenFout {
    pub fn van_io(stap: OpenStap, pad: &str, e: &io::Error, plaatshouder: bool, pad_info: PadInfo) -> Self {
        OpenFout {
            stap,
            soort: soort_van_fout(e.raw_os_error(), e.kind(), plaatshouder),
            pad: pad.to_string(),
            code: e.raw_os_error(),
            melding: e.to_string(),
            plaatshouder,
            pad_info,
        }
    }
}

// ── Openmodus ───────────────────────────────────────────────────────────────

/// Hoe het vergrendelen afliep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vergrendeling {
    Gelukt,
    NietGeprobeerd,
    Mislukt(FoutSoort),
}

/// Waarom een document alleen-lezen opent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AlleenLezenReden {
    /// Het bestand heeft het kenmerk alleen-lezen (ook: alleen leesrechten op
    /// een SharePoint-bibliotheek).
    Kenmerk,
    /// Een andere app (of de synchronisatie-app) heeft het open om te schrijven.
    InGebruik,
    /// Vergrendelen werd geweigerd.
    Geweigerd,
    /// Vergrendelen mislukte om een andere reden.
    Mislukt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenModus {
    pub alleen_lezen: bool,
    pub reden: Option<AlleenLezenReden>,
}

/// Het besluit: bewerkbaar en vergrendeld, of alleen-lezen. Een bestand dat
/// niet te vergrendelen is, kan de app ook niet veilig terugschrijven; het
/// opent dan alleen-lezen (Opslaan als blijft mogelijk) in plaats van niet.
pub fn beslis_openmodus(alleen_lezen_kenmerk: bool, vergrendeling: Vergrendeling) -> OpenModus {
    let alleen = |reden| OpenModus { alleen_lezen: true, reden: Some(reden) };
    if alleen_lezen_kenmerk {
        return alleen(AlleenLezenReden::Kenmerk);
    }
    match vergrendeling {
        Vergrendeling::Gelukt | Vergrendeling::NietGeprobeerd => OpenModus { alleen_lezen: false, reden: None },
        // Weg tussen lezen en vergrendelen: het lezen meldde het al.
        Vergrendeling::Mislukt(FoutSoort::NietGevonden) => OpenModus { alleen_lezen: false, reden: None },
        Vergrendeling::Mislukt(FoutSoort::InGebruik) => alleen(AlleenLezenReden::InGebruik),
        Vergrendeling::Mislukt(FoutSoort::Geweigerd) => alleen(AlleenLezenReden::Geweigerd),
        Vergrendeling::Mislukt(_) => alleen(AlleenLezenReden::Mislukt),
    }
}

// ── Bestandstoegang ─────────────────────────────────────────────────────────

const FILE_SHARE_READ: u32 = 0x1;
const FILE_SHARE_WRITE: u32 = 0x2;
const FILE_SHARE_DELETE: u32 = 0x4;

/// Open om te lezen terwijl iedereen mag blijven lezen, schrijven en
/// verwijderen: de synchronisatie-app of een andere app die het bestand open
/// heeft, staat het lezen niet in de weg.
pub fn open_om_te_lezen(pad: &str) -> io::Result<File> {
    let mut o = OpenOptions::new();
    o.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        o.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
    }
    #[cfg(not(windows))]
    let _ = (FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_SHARE_DELETE);
    o.open(pad)
}

/// Lees een document helemaal. Leest een plaatshouder (dat haalt hem op).
pub fn lees_document(pad: &str, sync_wortels: &[String]) -> Result<Vec<u8>, OpenFout> {
    let plaatshouder = kenmerken(pad).map(is_plaatshouder).unwrap_or(false);
    let fout = |e: &io::Error| OpenFout::van_io(OpenStap::Lezen, pad, e, plaatshouder, classificeer_pad(pad, sync_wortels));
    let mut bestand = open_om_te_lezen(pad).map_err(|e| fout(&e))?;
    let mut data = Vec::new();
    bestand.read_to_end(&mut data).map_err(|e| fout(&e))?;
    Ok(data)
}

/// Vergrendel: open om te lezen, anderen mogen alleen lezen (niet schrijven
/// of verwijderen) zolang de handle bestaat.
pub fn vergrendel(pad: &str) -> io::Result<File> {
    let mut o = OpenOptions::new();
    o.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        o.share_mode(FILE_SHARE_READ);
    }
    o.open(pad)
}

/// De mappen van de synchronisatie-app uit de omgeving.
pub fn sync_wortels_uit_omgeving() -> Vec<String> {
    ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"]
        .iter()
        .filter_map(|n| std::env::var(n).ok())
        .filter(|v| !v.trim().is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geen() -> Vec<String> { Vec::new() }

    #[test]
    fn lokaal_pad_is_lokaal_en_kort() {
        let i = classificeer_pad(r"C:\Data\tekening.pdf", &geen());
        assert_eq!(i.soort, PadSoort::Lokaal);
        assert!(!i.verbatim && !i.lang);
        assert_eq!(i.sync, None);
    }

    #[test]
    fn unc_pad_en_verbatim_unc() {
        assert_eq!(classificeer_pad(r"\\nas\projecten\a.pdf", &geen()).soort, PadSoort::Unc);
        let v = classificeer_pad(r"\\?\UNC\nas\projecten\a.pdf", &geen());
        assert_eq!(v.soort, PadSoort::Unc);
        assert!(v.verbatim);
        assert_eq!(classificeer_pad("//nas/projecten/a.pdf", &geen()).soort, PadSoort::Unc);
    }

    #[test]
    fn webdav_paden_van_sharepoint() {
        for p in [
            r"\\contoso.sharepoint.com@SSL\DavWWWRoot\sites\Bouw\Gedeelde documenten\a.pdf",
            r"\\contoso.sharepoint.com@SSL@443\DavWWWRoot\sites\Bouw\a.pdf",
            r"\\server@8080\DavWWWRoot\a.pdf",
            r"\\server\DavWWWRoot\a.pdf",
            r"\\?\UNC\contoso.sharepoint.com@SSL\DavWWWRoot\a.pdf",
            r"\\contoso.sharepoint.com\sites\a.pdf",
        ] {
            assert_eq!(classificeer_pad(p, &geen()).soort, PadSoort::Webdav, "{p}");
        }
    }

    #[test]
    fn lang_pad_telt_tekens_zonder_voorvoegsel() {
        let kort = format!(r"C:\{}", "a".repeat(MAX_PAD_ZONDER_VOORVOEGSEL - 3));
        assert_eq!(kort.len(), MAX_PAD_ZONDER_VOORVOEGSEL);
        assert!(!classificeer_pad(&kort, &geen()).lang);
        let lang = format!("{kort}b");
        assert!(classificeer_pad(&lang, &geen()).lang);
        // Het voorvoegsel zelf telt niet mee.
        assert!(!classificeer_pad(&format!(r"\\?\{kort}"), &geen()).lang);
        // UTF-16-eenheden, geen bytes: é is één teken.
        let met_accent = format!(r"C:\{}", "é".repeat(MAX_PAD_ZONDER_VOORVOEGSEL - 3));
        assert!(!classificeer_pad(&met_accent, &geen()).lang);
    }

    #[test]
    fn onedrive_en_sharepoint_synchronisatiemappen() {
        let od = classificeer_pad(r"C:\Users\piet\OneDrive - Bouwbedrijf\Projecten\a.pdf", &geen());
        assert_eq!(od.sync, Some(SyncMap::Onedrive));
        assert_eq!(classificeer_pad(r"C:\Users\piet\OneDrive\a\a.pdf", &geen()).sync, Some(SyncMap::Onedrive));
        let sp = classificeer_pad(r"C:\Users\piet\Bouwbedrijf\Project X - Documenten\Tekeningen\a.pdf", &geen());
        assert_eq!(sp.sync, Some(SyncMap::Sharepoint));
        assert_eq!(sp.soort, PadSoort::Lokaal);
        // Een gewone profielmap met een streepje is geen bibliotheek.
        assert_eq!(classificeer_pad(r"C:\Users\piet\Documents\Offerte - 2026\a.pdf", &geen()).sync, None);
        assert_eq!(classificeer_pad(r"C:\Users\piet\Downloads\a.pdf", &geen()).sync, None);
        assert_eq!(classificeer_pad(r"D:\Werk\Klant - A\a.pdf", &geen()).sync, None);
    }

    #[test]
    fn opgegeven_sync_wortel_wint() {
        let wortels = vec![r"E:\Sync\OD".to_string()];
        assert_eq!(classificeer_pad(r"e:\sync\od\map\a.pdf", &wortels).sync, Some(SyncMap::Onedrive));
        assert_eq!(classificeer_pad(r"E:\Sync\ODX\a.pdf", &wortels).sync, None);
    }

    #[test]
    fn verbatim_vorm_en_scope_varianten() {
        assert_eq!(verbatim_vorm(r"C:\a\b.pdf").as_deref(), Some(r"\\?\C:\a\b.pdf"));
        assert_eq!(verbatim_vorm(r"\\nas\s\b.pdf").as_deref(), Some(r"\\?\UNC\nas\s\b.pdf"));
        assert_eq!(verbatim_vorm(r"\\?\C:\a.pdf").as_deref(), Some(r"\\?\C:\a.pdf"));
        assert_eq!(verbatim_vorm(r"C:\a\..\b.pdf"), None);
        assert_eq!(verbatim_vorm(r"a\b.pdf"), None);
        assert_eq!(verbatim_vorm(r"\\.\COM1"), None);

        let v = scope_varianten(r"\\?\UNC\nas\s\b.pdf");
        assert!(v.contains(&r"\\nas\s\b.pdf".to_string()));
        assert!(v.contains(&r"\\?\UNC\nas\s\b.pdf".to_string()));
        let v = scope_varianten(r"C:\a.pdf");
        assert_eq!(v, vec![r"C:\a.pdf".to_string(), r"\\?\C:\a.pdf".to_string()]);
    }

    #[test]
    fn plaatshouder_kenmerken() {
        assert!(is_plaatshouder(FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | 0x20));
        assert!(is_plaatshouder(FILE_ATTRIBUTE_OFFLINE));
        assert!(is_plaatshouder(FILE_ATTRIBUTE_RECALL_ON_OPEN));
        assert!(!is_plaatshouder(FILE_ATTRIBUTE_READONLY | 0x20 | 0x8_0000));
    }

    #[test]
    fn foutsoorten() {
        use io::ErrorKind as K;
        assert_eq!(soort_van_fout(Some(5), K::PermissionDenied, false), FoutSoort::Geweigerd);
        assert_eq!(soort_van_fout(Some(5), K::PermissionDenied, true), FoutSoort::AlleenOnline);
        assert_eq!(soort_van_fout(Some(32), K::Other, false), FoutSoort::InGebruik);
        assert_eq!(soort_van_fout(Some(33), K::Other, false), FoutSoort::InGebruik);
        assert_eq!(soort_van_fout(Some(362), K::Other, false), FoutSoort::AlleenOnline);
        assert_eq!(soort_van_fout(Some(395), K::Other, false), FoutSoort::AlleenOnline);
        assert_eq!(soort_van_fout(Some(376), K::Other, false), FoutSoort::Anders);
        assert_eq!(soort_van_fout(Some(2), K::NotFound, false), FoutSoort::NietGevonden);
        assert_eq!(soort_van_fout(Some(206), K::Other, false), FoutSoort::PadTeLang);
        assert_eq!(soort_van_fout(Some(53), K::Other, false), FoutSoort::Netwerk);
        assert_eq!(soort_van_fout(None, K::NotFound, false), FoutSoort::NietGevonden);
        assert_eq!(soort_van_fout(None, K::PermissionDenied, true), FoutSoort::AlleenOnline);
        assert_eq!(soort_van_fout(None, K::Other, false), FoutSoort::Anders);
    }

    #[test]
    fn openmodus_bij_vergrendelen() {
        let bewerkbaar = OpenModus { alleen_lezen: false, reden: None };
        assert_eq!(beslis_openmodus(false, Vergrendeling::Gelukt), bewerkbaar);
        assert_eq!(beslis_openmodus(false, Vergrendeling::NietGeprobeerd), bewerkbaar);
        assert_eq!(beslis_openmodus(false, Vergrendeling::Mislukt(FoutSoort::NietGevonden)), bewerkbaar);
        assert_eq!(
            beslis_openmodus(false, Vergrendeling::Mislukt(FoutSoort::InGebruik)),
            OpenModus { alleen_lezen: true, reden: Some(AlleenLezenReden::InGebruik) }
        );
        assert_eq!(
            beslis_openmodus(false, Vergrendeling::Mislukt(FoutSoort::Geweigerd)),
            OpenModus { alleen_lezen: true, reden: Some(AlleenLezenReden::Geweigerd) }
        );
        assert_eq!(
            beslis_openmodus(false, Vergrendeling::Mislukt(FoutSoort::AlleenOnline)),
            OpenModus { alleen_lezen: true, reden: Some(AlleenLezenReden::Mislukt) }
        );
        // Het kenmerk alleen-lezen gaat voor alles.
        assert_eq!(
            beslis_openmodus(true, Vergrendeling::Gelukt),
            OpenModus { alleen_lezen: true, reden: Some(AlleenLezenReden::Kenmerk) }
        );
    }

    #[test]
    fn openfout_serialiseert_met_stap_en_pad() {
        let e = io::Error::from_raw_os_error(5);
        let f = OpenFout::van_io(OpenStap::Lezen, r"C:\a.pdf", &e, true, classificeer_pad(r"C:\a.pdf", &[]));
        let json = serde_json::to_value(&f).unwrap();
        assert_eq!(json["stap"], "lezen");
        assert_eq!(json["soort"], "alleen-online");
        assert_eq!(json["pad"], r"C:\a.pdf");
        assert_eq!(json["padInfo"]["soort"], "lokaal");
        assert_eq!(json["plaatshouder"], true);
    }

    #[test]
    fn lezen_terwijl_een_ander_schrijft_en_vergrendelen_dan_niet() {
        let map = std::env::temp_dir().join(format!("opds-bestand-openen-{}", std::process::id()));
        fs::create_dir_all(&map).unwrap();
        let pad = map.join("a.pdf");
        fs::write(&pad, b"%PDF-1.7").unwrap();
        let pad_s = pad.to_string_lossy().to_string();
        {
            // Een andere app heeft het open om te schrijven (en deelt lezen
            // en schrijven, zoals de meeste apps).
            let _schrijver = OpenOptions::new().read(true).write(true).open(&pad).unwrap();
            assert_eq!(lees_document(&pad_s, &[]).unwrap(), b"%PDF-1.7");
            #[cfg(windows)]
            {
                let e = vergrendel(&pad_s).unwrap_err();
                assert_eq!(soort_van_fout(e.raw_os_error(), e.kind(), false), FoutSoort::InGebruik);
            }
        }
        // Vergrendeld door de app: lezen blijft lukken.
        let slot = vergrendel(&pad_s).unwrap();
        assert_eq!(lees_document(&pad_s, &[]).unwrap(), b"%PDF-1.7");
        drop(slot);
        let weg = lees_document(&map.join("bestaat-niet.pdf").to_string_lossy(), &[]).unwrap_err();
        assert_eq!(weg.soort, FoutSoort::NietGevonden);
        assert_eq!(weg.stap, OpenStap::Lezen);
        let _ = fs::remove_dir_all(&map);
    }

    #[test]
    fn lang_pad_is_te_lezen_en_te_vergrendelen() {
        // SharePoint-bibliotheken geven al snel paden boven de 260 tekens.
        let basis = std::env::temp_dir().join(format!("opds-lang-pad-{}", std::process::id()));
        let mut map = basis.clone();
        while map.to_string_lossy().len() < 300 {
            map = map.join("Projectmap met een lange naam - Gedeelde documenten");
        }
        fs::create_dir_all(&map).unwrap();
        let pad = map.join("tekening.pdf");
        fs::write(&pad, b"%PDF-1.7").unwrap();
        let pad_s = pad.to_string_lossy().to_string();
        assert!(classificeer_pad(&pad_s, &[]).lang);
        assert_eq!(lees_document(&pad_s, &[]).unwrap(), b"%PDF-1.7");
        let met_voorvoegsel = verbatim_vorm(&pad_s).unwrap();
        assert_eq!(lees_document(&met_voorvoegsel, &[]).unwrap(), b"%PDF-1.7");
        drop(vergrendel(&pad_s).unwrap());
        let _ = fs::remove_dir_all(&basis);
    }
}
