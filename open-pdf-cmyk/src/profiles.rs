//! CMYK-drukprofielen vinden en controleren.
//!
//! Een bestand telt alleen als drukprofiel als het ICC-kopblok klopt:
//! signatuur `acsp` op byte 36, gegevenskleurruimte `CMYK` op byte 16 en
//! apparaatklasse `prtr` (uitvoerapparaat) op byte 12. De naam komt uit de
//! `desc`-tag: `textDescriptionType` (ICC v2) of `multiLocalizedUnicodeType`
//! (ICC v4); zonder bruikbare tag valt hij terug op de bestandsnaam.

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Een gevonden, geldig CMYK-drukprofiel.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    /// Volledig pad, zoals de app het terug moet geven bij het omzetten.
    pub path: String,
    /// Naam uit de `desc`-tag, anders de bestandsnaam zonder extensie.
    pub name: String,
}

/// Waarom een bestand geen bruikbaar CMYK-drukprofiel is. De code is wat de
/// interface vertaalt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileError {
    /// Niet te lezen (bestaat niet, geen rechten).
    Unreadable,
    /// Geen ICC-profiel: te kort of zonder `acsp`.
    NotIcc,
    /// Wel ICC, maar de kleurruimte is geen CMYK.
    NotCmyk,
    /// Wel CMYK, maar geen uitvoerprofiel (klasse is niet `prtr`).
    NotPrinter,
}

impl ProfileError {
    /// Code voor de interface.
    pub fn code(self) -> &'static str {
        match self {
            ProfileError::Unreadable => "unreadable",
            ProfileError::NotIcc => "notIcc",
            ProfileError::NotCmyk => "notCmyk",
            ProfileError::NotPrinter => "notPrinter",
        }
    }
}

impl std::fmt::Display for ProfileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for ProfileError {}

/// Controleert de bytes van een profiel en geeft de naam uit de `desc`-tag
/// (of `None` als die ontbreekt of onleesbaar is).
pub fn inspect_bytes(bytes: &[u8]) -> Result<Option<String>, ProfileError> {
    check_header(bytes)?;
    Ok(desc_name(bytes))
}

/// Alleen het kopblok: `acsp`, dan kleurruimte, dan klasse.
fn check_header(bytes: &[u8]) -> Result<(), ProfileError> {
    if bytes.len() < 128 || &bytes[36..40] != b"acsp" {
        return Err(ProfileError::NotIcc);
    }
    if &bytes[16..20] != b"CMYK" {
        return Err(ProfileError::NotCmyk);
    }
    if &bytes[12..16] != b"prtr" {
        return Err(ProfileError::NotPrinter);
    }
    Ok(())
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    bytes.get(at..at.checked_add(4)?).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// De naam uit de `desc`-tag, of `None`. Elke offset wordt tegen de lengte
/// gecontroleerd: een kapot profiel mag hier nooit laten vallen.
fn desc_name(bytes: &[u8]) -> Option<String> {
    let count = be_u32(bytes, 128)? as usize;
    for i in 0..count.min(1024) {
        let entry = 132 + i * 12;
        if bytes.get(entry..entry + 4)? != b"desc" {
            continue;
        }
        let offset = be_u32(bytes, entry + 4)? as usize;
        let size = be_u32(bytes, entry + 8)? as usize;
        let tag = bytes.get(offset..offset.checked_add(size)?)?;
        let name = match tag.get(0..4)? {
            b"desc" => desc_v2_text(tag),
            b"mluc" => mluc_text(tag),
            _ => None,
        }?;
        let name = name.trim().to_string();
        return (!name.is_empty()).then_some(name);
    }
    None
}

/// `textDescriptionType`: lengte (met afsluitende nul) op byte 8, ASCII vanaf 12.
fn desc_v2_text(tag: &[u8]) -> Option<String> {
    let len = be_u32(tag, 8)? as usize;
    let text = tag.get(12..12usize.checked_add(len)?)?;
    let end = text.iter().position(|&b| b == 0).unwrap_or(text.len());
    Some(String::from_utf8_lossy(&text[..end]).into_owned())
}

/// `multiLocalizedUnicodeType`: records van 12 bytes (taal, land, lengte,
/// offset vanaf het begin van de tag) met UTF-16BE-tekst. Engels gaat voor,
/// anders het eerste record.
fn mluc_text(tag: &[u8]) -> Option<String> {
    let count = be_u32(tag, 8)? as usize;
    let record_size = be_u32(tag, 12)? as usize;
    if record_size < 12 {
        return None;
    }
    let mut chosen: Option<(usize, usize)> = None;
    for i in 0..count.min(256) {
        let r = 16usize.checked_add(i.checked_mul(record_size)?)?;
        let lang = tag.get(r..r + 2)?;
        let len = be_u32(tag, r + 4)? as usize;
        let off = be_u32(tag, r + 8)? as usize;
        if chosen.is_none() || lang == b"en" {
            chosen = Some((off, len));
            if lang == b"en" {
                break;
            }
        }
    }
    let (off, len) = chosen?;
    let raw = tag.get(off..off.checked_add(len)?)?;
    let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
    let text = String::from_utf16_lossy(&units);
    Some(text.trim_end_matches('\0').to_string())
}

/// Controleert één bestand. Leest eerst alleen het kopblok; pas als dat een
/// CMYK-drukprofiel belooft, het hele bestand voor de naam.
pub fn inspect_file(path: &Path) -> Result<ProfileInfo, ProfileError> {
    let mut file = fs::File::open(path).map_err(|_| ProfileError::Unreadable)?;
    let mut bytes = Vec::with_capacity(128);
    (&mut file).take(128).read_to_end(&mut bytes).map_err(|_| ProfileError::Unreadable)?;
    check_header(&bytes)?;
    file.read_to_end(&mut bytes).map_err(|_| ProfileError::Unreadable)?;
    let name = desc_name(&bytes)
        .unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
    Ok(ProfileInfo { path: path.to_string_lossy().into_owned(), name })
}

/// Hoe diep `find_profiles` afdaalt; systeemmappen zijn ondiep, dit vangt
/// alleen vreemde mappenstructuren af.
const MAX_DEPTH: usize = 8;

/// Alle CMYK-drukprofielen (.icc/.icm, recursief) in de gegeven mappen,
/// gesorteerd op naam. Onleesbare mappen en ongeldige bestanden tellen niet mee.
pub fn find_profiles(dirs: &[PathBuf]) -> Vec<ProfileInfo> {
    let mut files = Vec::new();
    for dir in dirs {
        collect_candidates(dir, 0, &mut files);
    }
    // Hetzelfde bestand via overlappende mappen maar één keer.
    let mut seen = std::collections::HashSet::new();
    let mut found: Vec<ProfileInfo> = files
        .into_iter()
        .filter(|f| seen.insert(fs::canonicalize(f).unwrap_or_else(|_| f.clone())))
        .filter_map(|f| inspect_file(&f).ok())
        .collect();
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.path.cmp(&b.path)));
    found
}

fn collect_candidates(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        // file_type volgt geen symbolische koppelingen: een gekoppelde map
        // wordt niet doorzocht (geen lussen), een gekoppeld bestand wel.
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if depth < MAX_DEPTH {
                collect_candidates(&path, depth + 1, out);
            }
        } else if has_profile_extension(&path) {
            out.push(path);
        }
    }
}

fn has_profile_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("icc") || e.eq_ignore_ascii_case("icm"))
        .unwrap_or(false)
}

/// De systeemmappen voor kleurprofielen op dit besturingssysteem.
pub fn system_profile_dirs() -> Vec<PathBuf> {
    if cfg!(windows) {
        let windir = std::env::var_os("WINDIR")
            .or_else(|| std::env::var_os("SystemRoot"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        return vec![windir.join("System32").join("spool").join("drivers").join("color")];
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        let mut dirs = vec![PathBuf::from("/Library/ColorSync/Profiles")];
        if let Some(home) = &home {
            dirs.push(home.join("Library/ColorSync/Profiles"));
        }
        dirs.push(PathBuf::from("/System/Library/ColorSync/Profiles"));
        dirs
    } else {
        let mut dirs = vec![PathBuf::from("/usr/share/color/icc")];
        if let Some(home) = &home {
            dirs.push(home.join(".local/share/icc"));
            dirs.push(home.join(".color/icc"));
        }
        dirs
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Bouwt een klein ICC-profiel: kopblok plus één `desc`-tag.
    pub(crate) fn icc(class: &[u8; 4], space: &[u8; 4], desc: Option<&[u8]>) -> Vec<u8> {
        let mut b = vec![0u8; 128];
        b[12..16].copy_from_slice(class);
        b[16..20].copy_from_slice(space);
        b[20..24].copy_from_slice(b"Lab ");
        b[36..40].copy_from_slice(b"acsp");
        match desc {
            None => b.extend_from_slice(&0u32.to_be_bytes()),
            Some(tag) => {
                b.extend_from_slice(&1u32.to_be_bytes());
                b.extend_from_slice(b"desc");
                b.extend_from_slice(&(144u32).to_be_bytes());
                b.extend_from_slice(&(tag.len() as u32).to_be_bytes());
                b.extend_from_slice(tag);
            }
        }
        let len = b.len() as u32;
        b[0..4].copy_from_slice(&len.to_be_bytes());
        b
    }

    /// `textDescriptionType` (ICC v2).
    pub(crate) fn desc_v2(text: &str) -> Vec<u8> {
        let mut t = b"desc\0\0\0\0".to_vec();
        t.extend_from_slice(&((text.len() + 1) as u32).to_be_bytes());
        t.extend_from_slice(text.as_bytes());
        t.push(0);
        t.extend_from_slice(&[0u8; 12]);
        t
    }

    /// `multiLocalizedUnicodeType` (ICC v4) met één of meer records.
    fn desc_v4(records: &[(&str, &str)]) -> Vec<u8> {
        let mut t = b"mluc\0\0\0\0".to_vec();
        t.extend_from_slice(&(records.len() as u32).to_be_bytes());
        t.extend_from_slice(&12u32.to_be_bytes());
        let mut strings = Vec::new();
        let base = 16 + 12 * records.len();
        for (lang, text) in records {
            let utf16: Vec<u8> = text.encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
            t.extend_from_slice(lang.as_bytes());
            t.extend_from_slice(&(utf16.len() as u32).to_be_bytes());
            t.extend_from_slice(&((base + strings.len()) as u32).to_be_bytes());
            strings.extend_from_slice(&utf16);
        }
        t.extend_from_slice(&strings);
        t
    }

    #[test]
    fn cmyk_printer_profile_is_accepted_with_its_v2_name() {
        let bytes = icc(b"prtr", b"CMYK", Some(&desc_v2("Coated test press")));
        assert_eq!(inspect_bytes(&bytes), Ok(Some("Coated test press".into())));
    }

    #[test]
    fn v4_name_prefers_english() {
        let tag = desc_v4(&[("nlNL", "Gestreken proef"), ("enUS", "Coated proof")]);
        let bytes = icc(b"prtr", b"CMYK", Some(&tag));
        assert_eq!(inspect_bytes(&bytes), Ok(Some("Coated proof".into())));
    }

    #[test]
    fn missing_desc_gives_no_name() {
        let bytes = icc(b"prtr", b"CMYK", None);
        assert_eq!(inspect_bytes(&bytes), Ok(None));
    }

    #[test]
    fn rgb_display_profile_is_refused() {
        assert_eq!(inspect_bytes(&icc(b"mntr", b"RGB ", None)), Err(ProfileError::NotCmyk));
    }

    #[test]
    fn cmyk_profile_that_is_not_an_output_profile_is_refused() {
        // Een CMYK-invoer- of koppelprofiel is geen drukprofiel.
        assert_eq!(inspect_bytes(&icc(b"link", b"CMYK", None)), Err(ProfileError::NotPrinter));
    }

    #[test]
    fn file_without_acsp_is_not_icc() {
        let mut bytes = icc(b"prtr", b"CMYK", None);
        bytes[36..40].copy_from_slice(b"xxxx");
        assert_eq!(inspect_bytes(&bytes), Err(ProfileError::NotIcc));
        assert_eq!(inspect_bytes(b"too short"), Err(ProfileError::NotIcc));
    }

    #[test]
    fn broken_desc_offset_does_not_panic() {
        let mut bytes = icc(b"prtr", b"CMYK", Some(&desc_v2("x")));
        // Offset van de tag ver buiten het bestand.
        bytes[136..140].copy_from_slice(&0xFFFF_FF00u32.to_be_bytes());
        assert_eq!(inspect_bytes(&bytes), Ok(None));
    }

    #[test]
    fn error_codes_are_stable() {
        assert_eq!(ProfileError::Unreadable.code(), "unreadable");
        assert_eq!(ProfileError::NotIcc.code(), "notIcc");
        assert_eq!(ProfileError::NotCmyk.code(), "notCmyk");
        assert_eq!(ProfileError::NotPrinter.code(), "notPrinter");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("open-pdf-cmyk-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn inspect_file_falls_back_to_the_file_name() {
        let dir = temp_dir("naam");
        let path = dir.join("Krant 2026.icc");
        fs::write(&path, icc(b"prtr", b"CMYK", None)).unwrap();
        let info = inspect_file(&path).unwrap();
        assert_eq!(info.name, "Krant 2026");
        assert_eq!(info.path, path.to_string_lossy());
        assert_eq!(inspect_file(&dir.join("bestaat-niet.icc")), Err(ProfileError::Unreadable));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_profiles_searches_recursively_and_keeps_only_cmyk_printer_profiles() {
        let dir = temp_dir("zoek");
        fs::create_dir_all(dir.join("sub/diep")).unwrap();
        fs::write(dir.join("b.icc"), icc(b"prtr", b"CMYK", Some(&desc_v2("Bravo")))).unwrap();
        fs::write(dir.join("sub/diep/a.ICM"), icc(b"prtr", b"CMYK", Some(&desc_v2("Alfa")))).unwrap();
        fs::write(dir.join("sub/scherm.icc"), icc(b"mntr", b"RGB ", None)).unwrap();
        fs::write(dir.join("sub/tekst.txt"), icc(b"prtr", b"CMYK", None)).unwrap();
        fs::write(dir.join("kapot.icm"), b"geen profiel").unwrap();
        let found = find_profiles(&[dir.clone(), dir.join("bestaat-niet")]);
        let names: Vec<&str> = found.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Alfa", "Bravo"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_profiles_lists_a_file_once_when_folders_overlap() {
        let dir = temp_dir("dubbel");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/x.icc"), icc(b"prtr", b"CMYK", Some(&desc_v2("X")))).unwrap();
        let found = find_profiles(&[dir.clone(), dir.join("sub")]);
        assert_eq!(found.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn system_dirs_match_the_platform_conventions() {
        let dirs: Vec<String> = system_profile_dirs()
            .iter()
            .map(|d| d.to_string_lossy().replace('\\', "/").to_lowercase())
            .collect();
        if cfg!(windows) {
            assert!(dirs.iter().any(|d| d.ends_with("system32/spool/drivers/color")), "{dirs:?}");
        } else if cfg!(target_os = "macos") {
            assert!(dirs.contains(&"/library/colorsync/profiles".to_string()), "{dirs:?}");
            assert!(dirs.contains(&"/system/library/colorsync/profiles".to_string()), "{dirs:?}");
        } else {
            assert!(dirs.contains(&"/usr/share/color/icc".to_string()), "{dirs:?}");
        }
    }
}
