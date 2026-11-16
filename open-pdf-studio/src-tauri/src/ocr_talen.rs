//! OCR-talen (#1083): welke Tesseract-talen er zijn, waar ze staan en hoe er
//! een bij komt.
//!
//! Tesseract leest alle talen van één herkenning (`nld+eng`) uit één map. De
//! app gebruikt daarom één map van de gebruiker,
//! `<lokale datamap>/OpenPDFStudio/tessdata`, en kopieert de meegeleverde
//! `.traineddata`-bestanden (eng, chi_tra) daarheen zodra ze er nog niet
//! staan. Talen die de gebruiker downloadt of zelf neerzet komen in dezelfde
//! map. Lukt het aanmaken of schrijven van die map niet, dan blijft de
//! meegeleverde map in gebruik, zoals voorheen.
//!
//! Een nieuwere app-versie met een nieuwer meegeleverd bestand: het manifest
//! `.bundled` onthoudt per bestand de grootte van de gekopieerde versie. Staat
//! die kopie er nog onveranderd en heeft de meegeleverde versie een andere
//! grootte, dan wordt hij vervangen. Een bestand dat de gebruiker zelf
//! verving (andere grootte dan in het manifest) blijft staan.
//!
//! Alleen de standaardbibliotheek: CI test dit bestand los met
//! `rustc --edition 2021 --test src-tauri/src/ocr_talen.rs`.

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Naam van de map (onder `OpenPDFStudio`) en van de meegeleverde resource.
pub const MAP_NAAM: &str = "tessdata";
/// Submap van de lokale datamap waarin de app haar bestanden bewaart.
pub const APP_MAP: &str = "OpenPDFStudio";
/// Extensie van een Tesseract-taalbestand.
pub const EXTENSIE: &str = "traineddata";
/// Het model voor oriëntatie- en schriftdetectie: geen herkenningstaal.
pub const OSD: &str = "osd";
/// Bovengrens voor een download (de grootste tessdata_fast-bestanden zijn
/// enkele MB's; tessdata_best tot een paar tientallen).
pub const MAX_GROOTTE: u64 = 64 * 1024 * 1024;
/// Ondergrens: kleiner is geen taalmodel (een foutpagina of een leeg bestand).
pub const MIN_GROOTTE: u64 = 16 * 1024;
/// Bron van downloads: de snelle modellen van het Tesseract-project.
pub const DOWNLOAD_BASIS: &str = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/";
/// Manifest van de gekopieerde meegeleverde bestanden.
const MANIFEST: &str = ".bundled";
/// Hoeveel talen één herkenning mag combineren.
const MAX_DELEN: usize = 8;

/// De talen die de app mag downloaden: de herkenningstalen van
/// tessdata_fast (zonder `osd`). Alleen hieruit wordt een download-URL
/// gebouwd.
pub const DOWNLOADBARE_TALEN: &[&str] = &[
    "afr", "amh", "ara", "asm", "aze", "aze_cyrl", "bel", "ben", "bod", "bos", "bre", "bul",
    "cat", "ceb", "ces", "chi_sim", "chi_sim_vert", "chi_tra", "chi_tra_vert", "chr", "cos",
    "cym", "dan", "deu", "div", "dzo", "ell", "eng", "enm", "epo", "equ", "est", "eus", "fao",
    "fas", "fil", "fin", "fra", "frk", "frm", "fry", "gla", "gle", "glg", "grc", "guj", "hat",
    "heb", "hin", "hrv", "hun", "hye", "iku", "ind", "isl", "ita", "ita_old", "jav", "jpn",
    "jpn_vert", "kan", "kat", "kat_old", "kaz", "khm", "kir", "kmr", "kor", "kor_vert", "lao",
    "lat", "lav", "lit", "ltz", "mal", "mar", "mkd", "mlt", "mon", "mri", "msa", "mya", "nep",
    "nld", "nor", "oci", "ori", "pan", "pol", "por", "pus", "que", "ron", "rus", "san", "sin",
    "slk", "slv", "snd", "spa", "spa_old", "sqi", "srp", "srp_latn", "sun", "swa", "swe", "syr",
    "tam", "tat", "tel", "tgk", "tha", "tir", "ton", "tur", "uig", "ukr", "urd", "uzb",
    "uzb_cyrl", "vie", "yid", "yor",
];

/// Een Tesseract-taalcode: drie kleine letters, eventueel gevolgd door één of
/// twee achtervoegsels van kleine letters (`nld`, `chi_sim`, `srp_latn`,
/// `chi_tra_vert`). Nooit een pad, punt of hoofdletter.
pub fn is_geldige_code(code: &str) -> bool {
    if code.len() > 24 {
        return false;
    }
    let mut delen = code.split('_');
    let Some(basis) = delen.next() else { return false };
    if basis.len() != 3 || !basis.bytes().all(|b| b.is_ascii_lowercase()) {
        return false;
    }
    let mut aantal = 0;
    for deel in delen {
        aantal += 1;
        if aantal > 2 || deel.is_empty() || !deel.bytes().all(|b| b.is_ascii_lowercase()) {
            return false;
        }
    }
    true
}

/// Mag de app deze taal downloaden?
pub fn is_downloadbaar(code: &str) -> bool {
    DOWNLOADBARE_TALEN.contains(&code)
}

/// De download-URL van een taal uit de lijst; anders een fout.
pub fn download_url(code: &str) -> Result<String, String> {
    if !is_downloadbaar(code) {
        return Err(format!("OCR_LANGUAGE_UNKNOWN:{code}"));
    }
    Ok(format!("{DOWNLOAD_BASIS}{code}.{EXTENSIE}"))
}

/// Een taalopgave voor Tesseract: `auto` of geldige codes met `+` ertussen
/// (`nld+eng`), hoogstens acht.
pub fn is_geldige_taalspec(spec: &str) -> bool {
    if spec == "auto" {
        return true;
    }
    let delen: Vec<&str> = spec.split('+').collect();
    !delen.is_empty() && delen.len() <= MAX_DELEN && delen.iter().all(|d| is_geldige_code(d) && *d != OSD)
}

/// De taalmap van de gebruiker onder de lokale datamap.
pub fn gebruikersmap(lokale_datamap: &Path) -> PathBuf {
    lokale_datamap.join(APP_MAP).join(MAP_NAAM)
}

/// De code van een taalbestand (`nld.traineddata` → `nld`), als het er een is.
fn code_van(pad: &Path) -> Option<String> {
    if pad.extension()?.to_str()? != EXTENSIE {
        return None;
    }
    let stam = pad.file_stem()?.to_str()?;
    (is_geldige_code(stam) && stam != OSD).then(|| stam.to_string())
}

/// De talen in `map`, gesorteerd: de codes van de `*.traineddata`-bestanden
/// (geen `osd`, geen submappen, geen bestanden met een ongeldige naam).
pub fn lijst_talen(map: &Path) -> Vec<String> {
    let Ok(lijst) = fs::read_dir(map) else { return Vec::new() };
    let mut talen: Vec<String> = lijst
        .flatten()
        .filter(|e| e.file_type().map_or(false, |t| t.is_file()))
        .filter_map(|e| code_van(&e.path()))
        .collect();
    talen.sort();
    talen.dedup();
    talen
}

static VOLGNUMMER: AtomicUsize = AtomicUsize::new(0);

/// Een tijdelijke naam naast `doel` (zelfde map, dus hernoemen is atomair).
pub fn tijdelijk_pad(doel: &Path) -> PathBuf {
    let n = VOLGNUMMER.fetch_add(1, Ordering::Relaxed);
    let naam = doel.file_name().and_then(|n| n.to_str()).unwrap_or("download");
    doel.with_file_name(format!("{naam}.part-{}-{n}", std::process::id()))
}

/// Kopieer `bron` naar `doel` via een tijdelijk bestand.
fn kopieer_atomair(bron: &Path, doel: &Path) -> io::Result<()> {
    let tijdelijk = tijdelijk_pad(doel);
    let uitkomst = fs::copy(bron, &tijdelijk).and_then(|_| fs::rename(&tijdelijk, doel));
    if uitkomst.is_err() {
        let _ = fs::remove_file(&tijdelijk);
    }
    uitkomst
}

fn lees_manifest(map: &Path) -> BTreeMap<String, u64> {
    let Ok(tekst) = fs::read_to_string(map.join(MANIFEST)) else { return BTreeMap::new() };
    tekst
        .lines()
        .filter_map(|r| {
            let (naam, grootte) = r.split_once('\t')?;
            Some((naam.to_string(), grootte.trim().parse().ok()?))
        })
        .collect()
}

fn schrijf_manifest(map: &Path, manifest: &BTreeMap<String, u64>) -> io::Result<()> {
    let tekst: String = manifest.iter().map(|(n, g)| format!("{n}\t{g}\n")).collect();
    let doel = map.join(MANIFEST);
    let tijdelijk = tijdelijk_pad(&doel);
    fs::write(&tijdelijk, tekst).and_then(|_| fs::rename(&tijdelijk, &doel)).map_err(|e| {
        let _ = fs::remove_file(&tijdelijk);
        e
    })
}

/// Kopieer de meegeleverde taalbestanden naar de gebruikersmap: als ze daar
/// ontbreken, of als de app een andere versie meebrengt van een kopie die de
/// gebruiker niet heeft vervangen. Een ontbrekende meegeleverde map is geen
/// fout (er is dan niets te kopiëren).
pub fn kopieer_meegeleverde(bundel: &Path, gebruiker: &Path) -> io::Result<()> {
    let lijst = match fs::read_dir(bundel) {
        Ok(l) => l,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let mut manifest = lees_manifest(gebruiker);
    let mut gewijzigd = false;
    for e in lijst.flatten() {
        let bron = e.path();
        let is_taalbestand = bron.extension().and_then(|x| x.to_str()) == Some(EXTENSIE);
        let meta = match e.metadata() {
            Ok(m) if m.is_file() && is_taalbestand => m,
            _ => continue,
        };
        let naam = e.file_name().to_string_lossy().to_string();
        let doel = gebruiker.join(&naam);
        let kopieer = match fs::metadata(&doel) {
            Err(f) if f.kind() == io::ErrorKind::NotFound => true,
            Err(f) => return Err(f),
            // Een eerdere kopie van ons, onveranderd, en de app brengt een andere versie mee.
            Ok(d) => manifest.get(&naam) == Some(&d.len()) && d.len() != meta.len(),
        };
        if kopieer {
            kopieer_atomair(&bron, &doel)?;
            manifest.insert(naam, meta.len());
            gewijzigd = true;
        }
    }
    if gewijzigd {
        schrijf_manifest(gebruiker, &manifest)?;
    }
    Ok(())
}

/// De map die Tesseract krijgt: de gebruikersmap (aangemaakt en aangevuld met
/// de meegeleverde talen), of de meegeleverde map als dat niet lukt of er
/// geen gebruikersmap is.
pub fn effectieve_map(bundel: &Path, gebruiker: Option<&Path>) -> PathBuf {
    let Some(gebruiker) = gebruiker else { return bundel.to_path_buf() };
    if fs::create_dir_all(gebruiker).is_err() || kopieer_meegeleverde(bundel, gebruiker).is_err() {
        return bundel.to_path_buf();
    }
    // Elke meegeleverde taal moet er nu staan; anders liever de oude map.
    let compleet = lijst_talen(bundel).iter().all(|c| gebruiker.join(format!("{c}.{EXTENSIE}")).is_file());
    if compleet {
        gebruiker.to_path_buf()
    } else {
        bundel.to_path_buf()
    }
}

/// Is dit een Tesseract-taalbestand? `kop` zijn de eerste bytes, `grootte`
/// de totale grootte. Een `.traineddata` begint met het aantal onderdelen als
/// 32-bits geheel getal (Tesseract zelf accepteert 1..=1000, in beide
/// bytevolgordes); een HTML-foutpagina of leeg bestand valt daarbuiten.
pub fn controleer_traineddata(kop: &[u8], grootte: u64) -> Result<(), String> {
    if grootte < MIN_GROOTTE {
        return Err("OCR_LANGUAGE_INVALID:the download is too small to be a language file".into());
    }
    if grootte > MAX_GROOTTE {
        return Err("OCR_LANGUAGE_INVALID:the download is too large".into());
    }
    let begin: Vec<u8> = kop.iter().copied().skip_while(|b| b.is_ascii_whitespace()).take(1).collect();
    if begin.first() == Some(&b'<') {
        return Err("OCR_LANGUAGE_INVALID:the download is a web page, not a language file".into());
    }
    if kop.len() < 4 {
        return Err("OCR_LANGUAGE_INVALID:the download is too small to be a language file".into());
    }
    let bytes = [kop[0], kop[1], kop[2], kop[3]];
    let past = |n: i32| (1..=1000).contains(&n);
    if past(i32::from_le_bytes(bytes)) || past(i32::from_be_bytes(bytes)) {
        Ok(())
    } else {
        Err("OCR_LANGUAGE_INVALID:the download is not a Tesseract language file".into())
    }
}

/// Rond een download af: controleer het tijdelijke bestand en hernoem het
/// naar `<map>/<code>.traineddata`. Bij een fout gaat het tijdelijke bestand
/// weg en blijft een eventueel bestaand taalbestand onaangeroerd.
pub fn rond_download_af(tijdelijk: &Path, map: &Path, code: &str) -> Result<PathBuf, String> {
    let uitkomst = (|| {
        if !is_geldige_code(code) {
            return Err(format!("OCR_LANGUAGE_UNKNOWN:{code}"));
        }
        let grootte = fs::metadata(tijdelijk).map_err(|e| format!("OCR_LANGUAGE_WRITE:{e}"))?.len();
        let mut kop = [0u8; 64];
        let mut f = fs::File::open(tijdelijk).map_err(|e| format!("OCR_LANGUAGE_WRITE:{e}"))?;
        let n = f.read(&mut kop).map_err(|e| format!("OCR_LANGUAGE_WRITE:{e}"))?;
        drop(f);
        controleer_traineddata(&kop[..n], grootte)?;
        let doel = map.join(format!("{code}.{EXTENSIE}"));
        fs::rename(tijdelijk, &doel).map_err(|e| format!("OCR_LANGUAGE_WRITE:{e}"))?;
        Ok(doel)
    })();
    if uitkomst.is_err() {
        let _ = fs::remove_file(tijdelijk);
    }
    uitkomst
}

/// Het pad dat "Map openen" in de bestandsbeheerder toont: een taalbestand in
/// de map (zodat de map zelf opengaat), anders de map.
pub fn toon_pad(map: &Path) -> PathBuf {
    lijst_talen(map)
        .first()
        .map(|c| map.join(format!("{c}.{EXTENSIE}")))
        .unwrap_or_else(|| map.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tijdelijke_map(naam: &str) -> PathBuf {
        let n = VOLGNUMMER.fetch_add(1, Ordering::Relaxed);
        let map = std::env::temp_dir().join(format!("opds-ocr-talen-{naam}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&map);
        fs::create_dir_all(&map).unwrap();
        map
    }

    /// Een nep-taalbestand van `grootte` bytes met een geldige kop.
    fn taalbestand(grootte: usize, vul: u8) -> Vec<u8> {
        let mut data = vec![vul; grootte.max(4)];
        data[..4].copy_from_slice(&24i32.to_le_bytes());
        data
    }

    #[test]
    fn geldige_codes() {
        for c in ["nld", "eng", "deu", "chi_sim", "chi_tra", "srp_latn", "chi_tra_vert", "aze_cyrl"] {
            assert!(is_geldige_code(c), "{c}");
        }
    }

    #[test]
    fn ongeldige_codes() {
        for c in [
            "", "nl", "nlds", "NLD", "Nld", "nld_", "_nld", "nld__x", "a_b_c_d", "nld_a_b_c",
            "../eng", "eng.traineddata", "eng/x", "eng\\x", "e n", "nld+eng", "ñld", "123",
            "chi_TRA", "abc_def_ghi_jkl",
        ] {
            assert!(!is_geldige_code(c), "{c:?}");
        }
        assert!(!is_geldige_code(&"a".repeat(30)));
    }

    #[test]
    fn de_lijst_bevat_alleen_geldige_unieke_codes_zonder_osd() {
        let mut gezien = std::collections::HashSet::new();
        for c in DOWNLOADBARE_TALEN {
            assert!(is_geldige_code(c), "{c}");
            assert!(gezien.insert(*c), "dubbel: {c}");
            assert_ne!(*c, OSD);
        }
        for c in ["nld", "deu", "fra", "spa", "eng", "chi_tra", "chi_sim", "jpn", "srp_latn"] {
            assert!(is_downloadbaar(c), "{c}");
        }
        assert!(DOWNLOADBARE_TALEN.len() > 100);
    }

    #[test]
    fn download_url_alleen_voor_de_lijst() {
        assert_eq!(
            download_url("nld").unwrap(),
            "https://github.com/tesseract-ocr/tessdata_fast/raw/main/nld.traineddata"
        );
        for c in ["osd", "xyz", "../eng", "nld?x=1", "eng/../../x", "NLD", ""] {
            assert!(download_url(c).is_err(), "{c}");
        }
    }

    #[test]
    fn taalspecs() {
        for s in ["auto", "eng", "nld+eng", "chi_tra+eng", "deu+fra+eng"] {
            assert!(is_geldige_taalspec(s), "{s}");
        }
        for s in ["", "+", "nld+", "+eng", "nld++eng", "osd", "eng+osd", "../x", "Auto", "nld eng"] {
            assert!(!is_geldige_taalspec(s), "{s:?}");
        }
        let negen = vec!["eng"; 9].join("+");
        assert!(!is_geldige_taalspec(&negen));
        assert!(is_geldige_taalspec(&vec!["eng"; 8].join("+")));
    }

    #[test]
    fn gebruikersmap_onder_de_datamap() {
        let basis = PathBuf::from("data");
        assert_eq!(gebruikersmap(&basis), basis.join("OpenPDFStudio").join("tessdata"));
    }

    #[test]
    fn talen_opsommen() {
        let map = tijdelijke_map("lijst");
        for naam in ["nld.traineddata", "eng.traineddata", "osd.traineddata", "Latin.traineddata", "x.txt", "deu.traineddata.part-1-2"] {
            fs::write(map.join(naam), b"x").unwrap();
        }
        fs::create_dir_all(map.join("script").join("fra.traineddata")).unwrap();
        fs::create_dir_all(map.join("chi_sim.traineddata")).unwrap();
        assert_eq!(lijst_talen(&map), vec!["eng".to_string(), "nld".to_string()]);
        assert!(lijst_talen(&map.join("bestaat-niet")).is_empty());
        fs::remove_dir_all(&map).unwrap();
    }

    #[test]
    fn eerste_keer_kopieren_en_daarna_niets_meer() {
        let basis = tijdelijke_map("kopie");
        let bundel = basis.join("bundel");
        let gebruiker = basis.join("data").join("OpenPDFStudio").join("tessdata");
        fs::create_dir_all(&bundel).unwrap();
        fs::write(bundel.join("eng.traineddata"), taalbestand(100, 1)).unwrap();
        fs::write(bundel.join("chi_tra.traineddata"), taalbestand(200, 2)).unwrap();
        fs::write(bundel.join("LEESMIJ.txt"), b"geen taal").unwrap();

        let map = effectieve_map(&bundel, Some(&gebruiker));
        assert_eq!(map, gebruiker);
        assert_eq!(lijst_talen(&gebruiker), vec!["chi_tra".to_string(), "eng".to_string()]);
        assert_eq!(fs::read(gebruiker.join("eng.traineddata")).unwrap(), taalbestand(100, 1));
        assert!(!gebruiker.join("LEESMIJ.txt").exists());

        // Een zelf neergezette taal blijft en telt mee.
        fs::write(gebruiker.join("nld.traineddata"), taalbestand(50, 3)).unwrap();
        assert_eq!(effectieve_map(&bundel, Some(&gebruiker)), gebruiker);
        assert_eq!(lijst_talen(&gebruiker), vec!["chi_tra".to_string(), "eng".to_string(), "nld".to_string()]);
        // Geen tijdelijke bestanden achtergelaten.
        let rest: Vec<_> = fs::read_dir(&gebruiker).unwrap().flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".part-"))
            .collect();
        assert!(rest.is_empty(), "{rest:?}");
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn nieuwere_meegeleverde_versie_vervangt_alleen_onze_eigen_kopie() {
        let basis = tijdelijke_map("versie");
        let bundel = basis.join("bundel");
        let gebruiker = basis.join("gebruiker");
        fs::create_dir_all(&bundel).unwrap();
        fs::write(bundel.join("eng.traineddata"), taalbestand(100, 1)).unwrap();
        fs::write(bundel.join("chi_tra.traineddata"), taalbestand(200, 2)).unwrap();
        effectieve_map(&bundel, Some(&gebruiker));

        // De gebruiker vervangt chi_tra door een eigen (best-)model.
        fs::write(gebruiker.join("chi_tra.traineddata"), taalbestand(300, 9)).unwrap();
        // Nieuwe app-versie met andere bestanden.
        fs::write(bundel.join("eng.traineddata"), taalbestand(120, 4)).unwrap();
        fs::write(bundel.join("chi_tra.traineddata"), taalbestand(220, 5)).unwrap();
        assert_eq!(effectieve_map(&bundel, Some(&gebruiker)), gebruiker);

        assert_eq!(fs::read(gebruiker.join("eng.traineddata")).unwrap(), taalbestand(120, 4));
        assert_eq!(fs::read(gebruiker.join("chi_tra.traineddata")).unwrap(), taalbestand(300, 9));
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn verwijderde_kopie_komt_terug() {
        let basis = tijdelijke_map("terug");
        let bundel = basis.join("bundel");
        let gebruiker = basis.join("gebruiker");
        fs::create_dir_all(&bundel).unwrap();
        fs::write(bundel.join("eng.traineddata"), taalbestand(100, 1)).unwrap();
        effectieve_map(&bundel, Some(&gebruiker));
        fs::remove_file(gebruiker.join("eng.traineddata")).unwrap();
        assert_eq!(effectieve_map(&bundel, Some(&gebruiker)), gebruiker);
        assert!(gebruiker.join("eng.traineddata").is_file());
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn terugval_op_de_meegeleverde_map() {
        let basis = tijdelijke_map("terugval");
        let bundel = basis.join("bundel");
        fs::create_dir_all(&bundel).unwrap();
        fs::write(bundel.join("eng.traineddata"), taalbestand(100, 1)).unwrap();
        // Geen gebruikersmap bekend.
        assert_eq!(effectieve_map(&bundel, None), bundel);
        // De gebruikersmap kan niet worden aangemaakt: er staat een bestand.
        let blokkade = basis.join("bestand");
        fs::write(&blokkade, b"x").unwrap();
        assert_eq!(effectieve_map(&bundel, Some(&blokkade.join("tessdata"))), bundel);
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn zonder_meegeleverde_map_blijft_de_gebruikersmap_bruikbaar() {
        let basis = tijdelijke_map("geenbundel");
        let gebruiker = basis.join("gebruiker");
        assert_eq!(effectieve_map(&basis.join("bestaat-niet"), Some(&gebruiker)), gebruiker);
        assert!(gebruiker.is_dir());
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn taalbestand_controle() {
        let goed = taalbestand(64, 0);
        assert!(controleer_traineddata(&goed, 2 * MIN_GROOTTE).is_ok());
        // Grote-endian kop accepteert Tesseract ook.
        assert!(controleer_traineddata(&24i32.to_be_bytes(), MIN_GROOTTE).is_ok());
        assert!(controleer_traineddata(&goed, 0).is_err());
        assert!(controleer_traineddata(&goed, MIN_GROOTTE - 1).is_err());
        assert!(controleer_traineddata(&goed, MAX_GROOTTE + 1).is_err());
        assert!(controleer_traineddata(b"<!DOCTYPE html><html>", MIN_GROOTTE).is_err());
        assert!(controleer_traineddata(b"\r\n  <html>", MIN_GROOTTE).is_err());
        assert!(controleer_traineddata(b"Not Found", MIN_GROOTTE).is_err());
        assert!(controleer_traineddata(&0i32.to_le_bytes(), MIN_GROOTTE).is_err());
        assert!(controleer_traineddata(&[1, 0], MIN_GROOTTE).is_err());
        assert!(controleer_traineddata(&[], MIN_GROOTTE).is_err());
    }

    #[test]
    fn download_afronden() {
        let map = tijdelijke_map("afronden");
        // Goed bestand: hernoemd, tijdelijk weg.
        let t = tijdelijk_pad(&map.join("nld.traineddata"));
        fs::write(&t, taalbestand(MIN_GROOTTE as usize, 7)).unwrap();
        let doel = rond_download_af(&t, &map, "nld").unwrap();
        assert_eq!(doel, map.join("nld.traineddata"));
        assert!(!t.exists());
        assert_eq!(lijst_talen(&map), vec!["nld".to_string()]);

        // Foutpagina: weg, en het bestaande bestand blijft.
        let t = tijdelijk_pad(&map.join("nld.traineddata"));
        let mut html = b"<!DOCTYPE html>".to_vec();
        html.resize(MIN_GROOTTE as usize, b' ');
        fs::write(&t, html).unwrap();
        assert!(rond_download_af(&t, &map, "nld").is_err());
        assert!(!t.exists());
        assert_eq!(fs::read(map.join("nld.traineddata")).unwrap(), taalbestand(MIN_GROOTTE as usize, 7));

        // Leeg bestand.
        let t = tijdelijk_pad(&map.join("deu.traineddata"));
        fs::write(&t, b"").unwrap();
        assert!(rond_download_af(&t, &map, "deu").is_err());
        assert!(!t.exists());
        assert!(!map.join("deu.traineddata").exists());

        // Ongeldige code.
        let t = tijdelijk_pad(&map.join("x"));
        fs::write(&t, taalbestand(MIN_GROOTTE as usize, 7)).unwrap();
        assert!(rond_download_af(&t, &map, "../x").is_err());
        assert!(!t.exists());
        fs::remove_dir_all(&map).unwrap();
    }

    #[test]
    fn tijdelijke_namen_zijn_uniek_en_naast_het_doel() {
        let doel = PathBuf::from("map").join("nld.traineddata");
        let a = tijdelijk_pad(&doel);
        let b = tijdelijk_pad(&doel);
        assert_ne!(a, b);
        assert_eq!(a.parent(), doel.parent());
        assert!(code_van(&a).is_none());
    }

    #[test]
    fn toon_pad_wijst_een_taalbestand_aan() {
        let map = tijdelijke_map("toon");
        assert_eq!(toon_pad(&map), map);
        fs::write(map.join("eng.traineddata"), b"x").unwrap();
        assert_eq!(toon_pad(&map), map.join("eng.traineddata"));
        fs::remove_dir_all(&map).unwrap();
    }
}
