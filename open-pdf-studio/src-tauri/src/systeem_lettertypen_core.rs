// Installed font files for embedding in text boxes and callouts (#1020).
//
// The app shows an installed font by name; to embed it on save the saver
// needs the font file itself. This module finds that file for a family name
// and style (bold, italic) by reading the 'name', 'OS/2' and 'head' tables of
// the fonts in the system and user font folders, and says whether the font
// may be embedded (OS/2 fsType) and can be (TrueType or CFF outlines, including a
// collection face). The scan runs once per session; the result is cached.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug)]
struct Gezicht {
    pad: PathBuf,
    gezicht: u32,
    familie: String,
    vet: bool,
    cursief: bool,
    gewicht: u16,
    fs_type: u16,
    contouren: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LettertypeBestand {
    /// The font file (TrueType or OpenType), or None when not embeddable.
    pub pad: Option<String>,
    /// The file is the requested style (false: the regular face stands in).
    pub exact: bool,
    /// Face index in a collection (zero for a standalone font).
    pub gezicht: u32,
    /// OS/2 fsType permits subsetting.
    pub subset: bool,
    pub insluitbaar: bool,
    /// Why the font cannot be embedded: "not-found", "licence", "bitmap-only",
    /// or "no-outlines".
    pub reden: Option<String>,
}

static INDEX: Mutex<Option<Vec<Gezicht>>> = Mutex::new(None);

fn be16(b: &[u8], o: usize) -> Option<u16> {
    b.get(o..o + 2).map(|s| u16::from_be_bytes([s[0], s[1]]))
}
fn be32(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

fn tabel<'a>(b: &'a [u8], off: usize, tag: &[u8; 4]) -> Option<&'a [u8]> {
    let n = be16(b, off.checked_add(4)?)? as usize;
    for i in 0..n {
        let r = off.checked_add(12 + i * 16)?;
        if b.get(r..r + 4)? == tag {
            let off = be32(b, r + 8)? as usize;
            let len = be32(b, r + 12)? as usize;
            return b.get(off..off.checked_add(len)?);
        }
    }
    None
}

// TTC table offsets are absolute; only the face directory has its own offset.
fn gezicht_offset(b: &[u8], gezicht: u32) -> Option<usize> {
    if b.get(0..4)? != b"ttcf" { return (gezicht == 0).then_some(0); }
    let n = be32(b, 8)?;
    if gezicht >= n || n as usize > b.len().saturating_sub(12) / 4 { return None; }
    be32(b, 12 + gezicht as usize * 4).map(|v| v as usize)
}

fn som(b: &[u8]) -> u32 {
    b.chunks(4).fold(0u32, |s, c| {
        let mut woord = [0; 4];
        woord[..c.len()].copy_from_slice(c);
        s.wrapping_add(u32::from_be_bytes(woord))
    })
}

/// Copy one collection face to a standalone sfnt. Shared tables are copied,
/// their offsets rebased and head.checkSumAdjustment recalculated. No glyph
/// outlines, names or embedding rights are changed.
fn los_gezicht(b: &[u8], gezicht: u32) -> Option<Vec<u8>> {
    let off = gezicht_offset(b, gezicht)?;
    if b.get(0..4)? != b"ttcf" { return Some(b.to_vec()); }
    let n = be16(b, off.checked_add(4)?)? as usize;
    if n == 0 { return None; }
    let dir_len = 12 + n * 16;
    let mut uit = b.get(off..off.checked_add(dir_len)?)?.to_vec();
    let mut head = None;
    for i in 0..n {
        let r = 12 + i * 16;
        let bron = be32(&uit, r + 8)? as usize;
        let len = be32(&uit, r + 12)? as usize;
        let data = b.get(bron..bron.checked_add(len)?)?;
        let doel = uit.len();
        let offset = u32::try_from(doel).ok()?;
        uit.extend_from_slice(data);
        uit.resize(uit.len().checked_add(3)? & !3, 0);
        uit[r + 8..r + 12].copy_from_slice(&offset.to_be_bytes());
        if &uit[r..r + 4] == b"head" {
            if len < 12 { return None; }
            uit[doel + 8..doel + 12].fill(0);
            head = Some(doel);
        }
        let checksum = som(&uit[doel..doel + len]);
        uit[r + 4..r + 8].copy_from_slice(&checksum.to_be_bytes());
    }
    let head = head?;
    let aanpassing = 0xB1B0AFBAu32.wrapping_sub(som(&uit));
    uit[head + 8..head + 12].copy_from_slice(&aanpassing.to_be_bytes());
    Some(uit)
}

/// Read only an indexed face, then check its current embedding rights again.
/// The IPC caller cannot use an arbitrary path or a restricted neighbouring face.
pub fn lees(pad: &str, gezicht: u32) -> Result<Vec<u8>, String> {
    if !index().iter().any(|g| g.pad.to_string_lossy() == pad && g.gezicht == gezicht) {
        return Err("not an installed font face".into());
    }
    let bytes = std::fs::read(pad).map_err(|e| e.to_string())?;
    lees_insluitbaar(Path::new(pad), &bytes, gezicht)
}

fn lees_insluitbaar(pad: &Path, bytes: &[u8], gezicht: u32) -> Result<Vec<u8>, String> {
    let g = lees_gezicht(pad, bytes, gezicht).ok_or("invalid font face")?;
    if let Some(reden) = reden_voor(&g) { return Err(reden.into()); }
    los_gezicht(bytes, gezicht).ok_or_else(|| "invalid font tables".into())
}

/// A name from the 'name' table: Windows Unicode first, then Mac Roman.
fn naam(t: &[u8], id: u16) -> Option<String> {
    let aantal = be16(t, 2)? as usize;
    let opslag = be16(t, 4)? as usize;
    let mut mac = None;
    for i in 0..aantal {
        let r = 6 + i * 12;
        let platform = be16(t, r)?;
        let codering = be16(t, r + 2)?;
        let taal = be16(t, r + 4)?;
        let nid = be16(t, r + 6)?;
        if nid != id { continue; }
        let len = be16(t, r + 8)? as usize;
        let off = opslag + be16(t, r + 10)? as usize;
        let ruw = t.get(off..off + len)?;
        if platform == 3 && (codering == 1 || codering == 0) {
            let eenheden: Vec<u16> = ruw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
            let s = String::from_utf16_lossy(&eenheden);
            // English (US) wins; any Windows name will do otherwise.
            if taal == 0x0409 { return Some(s); }
            mac.get_or_insert(s);
        } else if platform == 1 && codering == 0 && mac.is_none() {
            mac = Some(ruw.iter().map(|&c| c as char).collect());
        }
    }
    mac
}

fn lees_gezicht(pad: &Path, b: &[u8], gezicht: u32) -> Option<Gezicht> {
    let off = gezicht_offset(b, gezicht)?;
    let tag = b.get(off..off.checked_add(4)?)?;
    if tag != [0, 1, 0, 0] && tag != b"OTTO" && tag != b"true" { return None; }
    let n = tabel(b, off, b"name")?;
    let familie = naam(n, 16).or_else(|| naam(n, 1))?;
    let sub = naam(n, 17).or_else(|| naam(n, 2)).unwrap_or_default().to_lowercase();
    let os2 = tabel(b, off, b"OS/2");
    let fs_type = os2.and_then(|t| be16(t, 8)).unwrap_or(0);
    let gewicht = os2.and_then(|t| be16(t, 4)).unwrap_or(400);
    let selectie = os2.and_then(|t| be16(t, 62)).unwrap_or(0);
    let mac_stijl = tabel(b, off, b"head").and_then(|t| be16(t, 44)).unwrap_or(0);
    let vet = selectie & 0x20 != 0 || mac_stijl & 1 != 0 || sub.contains("bold");
    let cursief = selectie & 0x01 != 0 || mac_stijl & 2 != 0 || sub.contains("italic") || sub.contains("oblique");
    let contouren = tabel(b, off, b"glyf").is_some() || tabel(b, off, b"CFF ").is_some();
    Some(Gezicht { pad: pad.to_path_buf(), gezicht, familie, vet, cursief, gewicht, fs_type, contouren })
}

fn lettertype_mappen() -> Vec<PathBuf> {
    let mut mappen = Vec::new();
    #[cfg(windows)]
    {
        let win = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        mappen.push(win.join("Fonts"));
        if let Some(lokaal) = std::env::var_os("LOCALAPPDATA") {
            mappen.push(PathBuf::from(lokaal).join(r"Microsoft\Windows\Fonts"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        mappen.push(PathBuf::from("/Library/Fonts"));
        mappen.push(PathBuf::from("/System/Library/Fonts"));
        if let Some(h) = std::env::var_os("HOME") { mappen.push(PathBuf::from(h).join("Library/Fonts")); }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        mappen.push(PathBuf::from("/usr/share/fonts"));
        mappen.push(PathBuf::from("/usr/local/share/fonts"));
        if let Some(h) = std::env::var_os("HOME") {
            mappen.push(PathBuf::from(&h).join(".local/share/fonts"));
            mappen.push(PathBuf::from(&h).join(".fonts"));
        }
    }
    mappen
}

fn verzamel(map: &Path, diepte: u32, uit: &mut Vec<Gezicht>) {
    let Ok(lijst) = std::fs::read_dir(map) else { return };
    for e in lijst.flatten() {
        let p = e.path();
        if p.is_dir() {
            if diepte < 4 { verzamel(&p, diepte + 1, uit); }
            continue;
        }
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") { continue; }
        // Only the table directory and the small tables are needed, but
        // fonts are small enough to read whole; the scan runs once.
        let Ok(b) = std::fs::read(&p) else { continue };
        let aantal = if b.get(0..4) == Some(b"ttcf") {
            be32(&b, 8).filter(|&n| n as usize <= b.len().saturating_sub(12) / 4).unwrap_or(0)
        } else { 1 };
        for gezicht in 0..aantal {
            if let Some(g) = lees_gezicht(&p, &b, gezicht) { uit.push(g); }
        }
    }
}

fn index() -> Vec<Gezicht> {
    let mut slot = INDEX.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(i) = slot.as_ref() { return i.clone(); }
    let mut uit = Vec::new();
    for m in lettertype_mappen() { verzamel(&m, 0, &mut uit); }
    *slot = Some(uit.clone());
    uit
}

fn schoon(f: &str) -> String {
    f.trim().trim_matches(|c| c == '"' || c == '\'').trim().to_lowercase()
}

/// Pick the face for family + style from a list of faces.
fn kies(gezichten: &[Gezicht], familie: &str, vet: bool, cursief: bool) -> Option<(Gezicht, bool)> {
    let doel = schoon(familie);
    let mut kandidaten: Vec<&Gezicht> = gezichten.iter().filter(|g| schoon(&g.familie) == doel).collect();
    if kandidaten.is_empty() { return None; }
    // Exact style first; among those the weight nearest 400 (regular) or 700 (bold).
    let doelgewicht: i32 = if vet { 700 } else { 400 };
    kandidaten.sort_by_key(|g| {
        let stijl = (g.vet != vet) as i32 * 2 + (g.cursief != cursief) as i32;
        (stijl, (g.gewicht as i32 - doelgewicht).abs())
    });
    let g = kandidaten[0].clone();
    let exact = g.vet == vet && g.cursief == cursief;
    // Not the style asked for: the regular face stands in, not a random one.
    if !exact {
        if let Some(r) = gezichten.iter().filter(|g| schoon(&g.familie) == doel && !g.vet && !g.cursief).min_by_key(|g| (g.gewicht as i32 - 400).abs()) {
            return Some((r.clone(), false));
        }
    }
    Some((g, exact))
}

/// Embedding rights from OS/2 fsType: 0x0002 restricted licence, 0x0200
/// bitmap embedding only.
fn reden_voor(g: &Gezicht) -> Option<&'static str> {
    if g.fs_type & 0x0002 != 0 && g.fs_type & 0x000C == 0 { return Some("licence"); }
    if g.fs_type & 0x0200 != 0 { return Some("bitmap-only"); }
    if !g.contouren { return Some("no-outlines"); }
    None
}

pub fn zoek(familie: &str, vet: bool, cursief: bool) -> LettertypeBestand {
    let gezichten = index();
    match kies(&gezichten, familie, vet, cursief) {
        Some((g, exact)) => {
            let reden = reden_voor(&g);
            LettertypeBestand {
                pad: if reden.is_none() { Some(g.pad.to_string_lossy().into_owned()) } else { None },
                exact,
                gezicht: g.gezicht,
                subset: g.fs_type & 0x0100 == 0,
                insluitbaar: reden.is_none(),
                reden: reden.map(String::from),
            }
        }
        None => {
            LettertypeBestand {
                pad: None, exact: false, gezicht: 0, subset: false, insluitbaar: false,
                reden: Some("not-found".into()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TTC: &[u8] = include_bytes!("../../scripts/font-native-tests/fixtures/collection.ttc");
    const TTF: &[u8] = include_bytes!("../../scripts/font-native-tests/fixtures/installed.ttf");

    #[test]
    fn alle_collectie_gezichten_worden_gevonden() {
        let pad = Path::new("fixture.ttc");
        let a = lees_gezicht(pad, TTC, 0).unwrap();
        let b = lees_gezicht(pad, TTC, 1).unwrap();
        assert_eq!(a.familie, "OPDS Collection One");
        assert_eq!(b.familie, "OPDS Collection 日本語");
        assert_eq!(b.gezicht, 1);
        assert!(lees_gezicht(pad, TTC, 2).is_none());
        let (g, exact) = kies(&[a, b], "OPDS Collection 日本語", false, false).unwrap();
        assert_eq!(g.gezicht, 1);
        assert!(exact);
    }

    #[test]
    fn collectie_wordt_los_font_met_dezelfde_tabellen() {
        for i in 0..2 {
            let off = gezicht_offset(TTC, i).unwrap();
            let bytes = lees_insluitbaar(Path::new("fixture.ttc"), TTC, i).unwrap();
            assert_eq!(&bytes[..4], &[0, 1, 0, 0]);
            assert_eq!(som(&bytes), 0xB1B0AFBA, "whole-font checksum");
            for tag in [b"name", b"glyf", b"cmap", b"OS/2", b"hmtx"] {
                assert_eq!(tabel(TTC, off, tag), tabel(&bytes, 0, tag));
            }
            assert_eq!(lees_gezicht(Path::new("face.ttf"), &bytes, 0).unwrap().familie,
                       lees_gezicht(Path::new("fixture.ttc"), TTC, i).unwrap().familie);
        }
    }

    #[test]
    fn gewone_fontbytes_blijven_ongewijzigd() {
        assert_eq!(lees_insluitbaar(Path::new("fixture.ttf"), TTF, 0).unwrap(), TTF);
        assert!(lees_insluitbaar(Path::new("fixture.ttf"), TTF, 1).is_err());
    }

    #[test]
    fn ongeldige_collecties_worden_afgewezen() {
        for len in [0, 4, 12, 16, 30] { assert!(los_gezicht(&TTC[..len], 1).is_none()); }
        let mut b = TTC.to_vec();
        b[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(los_gezicht(&b, 1).is_none());
        assert!(los_gezicht(TTC, u32::MAX).is_none());
    }

    #[test]
    fn collectierechten_worden_per_gezicht_getoetst() {
        let off = gezicht_offset(TTC, 1).unwrap();
        let table = tabel(TTC, off, b"OS/2").unwrap();
        let os2 = table.as_ptr() as usize - TTC.as_ptr() as usize;
        for (fs_type, reden) in [(0x0002u16, "licence"), (0x0200, "bitmap-only")] {
            let mut b = TTC.to_vec();
            b[os2 + 8..os2 + 10].copy_from_slice(&fs_type.to_be_bytes());
            assert_eq!(lees_insluitbaar(Path::new("fixture.ttc"), &b, 1).unwrap_err(), reden);
        }
    }

    #[test]
    fn scanner_neemt_beide_gezichten_op() {
        let dir = std::env::temp_dir().join(format!("opds-collection-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("collection.ttc"), TTC).unwrap();
        std::fs::write(dir.join("installed.ttf"), TTF).unwrap();
        let mut gezichten = vec![];
        verzamel(&dir, 0, &mut gezichten);
        assert!(kies(&gezichten, "OPDS Collection One", false, false).is_some());
        assert!(kies(&gezichten, "OPDS Collection 日本語", false, false).is_some());
        assert!(kies(&gezichten, "OPDS Installed Fixture", false, false).is_some());
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(lees("/not-an-indexed-font.ttf", 0).is_err());
    }

    fn g(f: &str, vet: bool, cursief: bool, gewicht: u16, fs: u16) -> Gezicht {
        Gezicht { pad: PathBuf::from(format!("{f}-{vet}-{cursief}.ttf")), gezicht: 0, familie: f.into(), vet, cursief, gewicht, fs_type: fs, contouren: true }
    }

    #[test]
    fn kiest_de_gevraagde_stijl_of_de_gewone() {
        let lijst = vec![g("Cascadia Mono", false, false, 400, 0), g("Cascadia Mono", true, false, 700, 0), g("Other", false, false, 400, 0)];
        let (v, exact) = kies(&lijst, "cascadia mono", true, false).unwrap();
        assert!(v.vet && exact);
        let (c, exact) = kies(&lijst, "'Cascadia Mono'", false, true).unwrap();
        assert!(!c.vet && !c.cursief && !exact);
        assert!(kies(&lijst, "Nope", false, false).is_none());
    }

    #[test]
    fn licentie_en_bitmap_blokkeren() {
        assert_eq!(reden_voor(&g("A", false, false, 400, 0x0002)), Some("licence"));
        assert_eq!(reden_voor(&g("A", false, false, 400, 0x0004)), None);
        assert_eq!(reden_voor(&g("A", false, false, 400, 0x0008)), None);
        assert_eq!(reden_voor(&g("A", false, false, 400, 0x0200)), Some("bitmap-only"));
    }

    #[test]
    fn leest_een_echt_lettertype() {
        // Any font on the build machine; skipped when there is none.
        for m in lettertype_mappen() {
            let Ok(lijst) = std::fs::read_dir(&m) else { continue };
            for e in lijst.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("ttf")) != Some(true) { continue; }
                let b = std::fs::read(&p).unwrap();
                if let Some(gz) = lees_gezicht(&p, &b, 0) { assert!(!gz.familie.is_empty()); return; }
            }
        }
    }
}
