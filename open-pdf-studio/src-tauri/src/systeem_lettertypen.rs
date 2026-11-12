// Installed font files for embedding in text boxes and callouts (#1020).
//
// The app shows an installed font by name; to embed it on save the saver
// needs the font file itself. This module finds that file for a family name
// and style (bold, italic) by reading the 'name', 'OS/2' and 'head' tables of
// the fonts in the system and user font folders, and says whether the font
// may be embedded (OS/2 fsType) and can be (TrueType or CFF outlines, not a
// font collection). The scan runs once per session; the result is cached.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug)]
struct Gezicht {
    pad: PathBuf,
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
    pub insluitbaar: bool,
    /// Why the font cannot be embedded: "not-found", "licence", "bitmap-only",
    /// "collection" or "no-outlines".
    pub reden: Option<String>,
}

static INDEX: Mutex<Option<Vec<Gezicht>>> = Mutex::new(None);

fn be16(b: &[u8], o: usize) -> Option<u16> {
    b.get(o..o + 2).map(|s| u16::from_be_bytes([s[0], s[1]]))
}
fn be32(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

fn tabel<'a>(b: &'a [u8], tag: &[u8; 4]) -> Option<&'a [u8]> {
    let n = be16(b, 4)? as usize;
    for i in 0..n {
        let r = 12 + i * 16;
        if b.get(r..r + 4)? == tag {
            let off = be32(b, r + 8)? as usize;
            let len = be32(b, r + 12)? as usize;
            return b.get(off..off.checked_add(len)?);
        }
    }
    None
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

fn lees_gezicht(pad: &Path, b: &[u8]) -> Option<Gezicht> {
    let tag = b.get(0..4)?;
    if tag != [0, 1, 0, 0] && tag != b"OTTO" && tag != b"true" { return None; }
    let n = tabel(b, b"name")?;
    let familie = naam(n, 16).or_else(|| naam(n, 1))?;
    let sub = naam(n, 17).or_else(|| naam(n, 2)).unwrap_or_default().to_lowercase();
    let os2 = tabel(b, b"OS/2");
    let fs_type = os2.and_then(|t| be16(t, 8)).unwrap_or(0);
    let gewicht = os2.and_then(|t| be16(t, 4)).unwrap_or(400);
    let selectie = os2.and_then(|t| be16(t, 62)).unwrap_or(0);
    let mac_stijl = tabel(b, b"head").and_then(|t| be16(t, 44)).unwrap_or(0);
    let vet = selectie & 0x20 != 0 || mac_stijl & 1 != 0 || sub.contains("bold");
    let cursief = selectie & 0x01 != 0 || mac_stijl & 2 != 0 || sub.contains("italic") || sub.contains("oblique");
    let contouren = tabel(b, b"glyf").is_some() || tabel(b, b"CFF ").is_some();
    Some(Gezicht { pad: pad.to_path_buf(), familie, vet, cursief, gewicht, fs_type, contouren })
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

fn verzamel(map: &Path, diepte: u32, uit: &mut Vec<Gezicht>, collecties: &mut Vec<(PathBuf, String)>) {
    let Ok(lijst) = std::fs::read_dir(map) else { return };
    for e in lijst.flatten() {
        let p = e.path();
        if p.is_dir() {
            if diepte < 4 { verzamel(&p, diepte + 1, uit, collecties); }
            continue;
        }
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") { continue; }
        // Only the table directory and the small tables are needed, but
        // fonts are small enough to read whole; the scan runs once.
        let Ok(b) = std::fs::read(&p) else { continue };
        if b.get(0..4) == Some(b"ttcf") {
            // A collection: note its families so the reason can be given.
            if let Some(n) = be32(&b, 8).map(|o| o as usize) {
                if let Some(g) = b.get(n..).and_then(|_| lees_collectie_gezicht(&b, n)) {
                    collecties.push((p.clone(), g));
                }
            }
            continue;
        }
        if let Some(g) = lees_gezicht(&p, &b) { uit.push(g); }
    }
}

fn lees_collectie_gezicht(b: &[u8], off: usize) -> Option<String> {
    let sub = b.get(off..)?;
    // Table offsets in a collection are from the start of the file.
    let n = be16(sub, 4)? as usize;
    for i in 0..n {
        let r = 12 + i * 16;
        if sub.get(r..r + 4)? == b"name" {
            let t_off = be32(sub, r + 8)? as usize;
            let len = be32(sub, r + 12)? as usize;
            let t = b.get(t_off..t_off + len)?;
            return naam(t, 16).or_else(|| naam(t, 1));
        }
    }
    None
}

static COLLECTIES: Mutex<Vec<(PathBuf, String)>> = Mutex::new(Vec::new());

fn index() -> Vec<Gezicht> {
    let mut slot = INDEX.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(i) = slot.as_ref() { return i.clone(); }
    let mut uit = Vec::new();
    let mut collecties = Vec::new();
    for m in lettertype_mappen() { verzamel(&m, 0, &mut uit, &mut collecties); }
    *COLLECTIES.lock().unwrap_or_else(|e| e.into_inner()) = collecties;
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
                insluitbaar: reden.is_none(),
                reden: reden.map(String::from),
            }
        }
        None => {
            let doel = schoon(familie);
            let collectie = COLLECTIES.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|(_, f)| schoon(f) == doel);
            LettertypeBestand {
                pad: None, exact: false, insluitbaar: false,
                reden: Some(if collectie { "collection" } else { "not-found" }.into()),
            }
        }
    }
}

/// The font file for a family and style, and whether it can be embedded.
#[tauri::command]
pub async fn systeem_lettertype_zoeken(familie: String, vet: bool, cursief: bool) -> Result<LettertypeBestand, String> {
    tauri::async_runtime::spawn_blocking(move || zoek(&familie, vet, cursief))
        .await
        .map_err(|e| e.to_string())
}

/// The bytes of a font file found by systeem_lettertype_zoeken. Only files
/// from the scanned font folders are read.
#[tauri::command]
pub async fn systeem_lettertype_lezen(pad: String) -> Result<tauri::ipc::Response, String> {
    let bekend = index().iter().any(|g| g.pad.to_string_lossy() == pad);
    if !bekend { return Err("not an installed font file".into()); }
    let bytes = std::fs::read(&pad).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(f: &str, vet: bool, cursief: bool, gewicht: u16, fs: u16) -> Gezicht {
        Gezicht { pad: PathBuf::from(format!("{f}-{vet}-{cursief}.ttf")), familie: f.into(), vet, cursief, gewicht, fs_type: fs, contouren: true }
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
                if let Some(gz) = lees_gezicht(&p, &b) { assert!(!gz.familie.is_empty()); return; }
            }
        }
    }
}
