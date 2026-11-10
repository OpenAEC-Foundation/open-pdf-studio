//! Glyphs van een pagina uit PDFium, in de volgorde van de inhoud.
//!
//! PDFium leest de tekst (fonts, ToUnicode, coderingen) al voor het tekenen;
//! hier komt per glyph de Unicode-waarde, de oorsprong, de matrix, de
//! lettergrootte en de voortgang uit de tekstpagina (`FPDFText_*`), en de
//! volgorde, de XObject-grenzen en de gemarkeerde inhoud (BDC/EMC) uit de
//! objectboom van de pagina.
//!
//! Waar de tekstpagina van PDFium anders werkt dan pdf.js:
//! - wat PDFium zelf toevoegt (afgeleide spaties en regeleinden,
//!   `FPDFText_IsGenerated`) valt weg: de spatieregels van pdf.js doen dat
//!   werk (pdfjs.rs);
//! - een afbreekstreepje aan het regeleinde geeft PDFium als U+0002: weer '-';
//! - een tekstobject zonder oppervlak (alleen spaties) en een kopie van een
//!   vorig tekstobject (vette tekst door twee keer tekenen) laat PDFium weg;
//!   pdf.js niet. Die komen hier terug (zie `lees_open`);
//! - de voortgang van een glyph komt uit de fontbreedte, niet uit de losse
//!   tekenbox (die neemt uitstekende inkt mee en draait mee);
//! - PDFium zet rechts-naar-links-tekst per regel in logische volgorde; de
//!   glyphs van één tekstobject gaan terug in tekenvolgorde (langs de
//!   basislijn). Zulke pagina's laat de app toch aan pdf.js, omdat PDFium
//!   daar ook presentatievormen ontleedt en haakjes spiegelt (`rtl`);
//! - tekst die PDFium niet leest (verticaal schrift, een glyph zonder
//!   Unicode-vertaling), en Type3-tekst op lettergrootte 1 of kleiner (pdf.js
//!   schaalt de hoogte dan met FontBBox × FontMatrix) markeert de pagina
//!   (`ongelezen`): de app leest die pagina met pdf.js.

use super::pdfjs::{Gebeurtenis, Glyph};
use anyhow::{anyhow, Result};
use pdfium_render::prelude::*;
use std::collections::HashMap;

const MAX_DIEPTE: u32 = 32;

pub struct RuwePagina {
    /// CropBox ∩ MediaBox: [x0, y0, x1, y1] (page.view van pdf.js).
    pub view: [f64; 4],
    pub fonts: Vec<String>,
    pub gebeurtenissen: Vec<Gebeurtenis>,
    /// Een tekstobject loopt dwars op zijn basislijn (verticaal schrift).
    pub verticaal: bool,
    /// Tekst in een schrift van rechts naar links (Hebreeuws, Arabisch).
    pub rtl: bool,
    /// Tekst die PDFium niet (goed) leest: een tekstobject met glyphs waar de
    /// tekstpagina geen enkel teken voor geeft (gezien bij verticaal schrift,
    /// Identity-V), of een glyph zonder Unicode-vertaling.
    pub ongelezen: bool,
}

/// Schrift van rechts naar links volgens de indeling van de bidi-stap van
/// pdf.js, plus de Hebreeuwse presentatievormen. PDFium ontleedt daar
/// presentatievormen naar basisletters en spiegelt haakjes; pdf.js niet.
pub fn rtl_teken(u: u32) -> bool {
    matches!(u, 0x0590..=0x08ff | 0xfb1d..=0xfdff | 0xfe70..=0xfeff)
}

struct RuwTeken {
    u: u32,
    x: f64,
    y: f64,
    m: [f64; 4],
    fs: f64,
    vak: [f32; 4],
}

/// Fontbreedtes per (font, Unicode), in tekstruimte per punt lettergrootte.
pub(super) struct Breedtes {
    kaart: HashMap<(usize, u32), f64>,
}

impl Breedtes {
    pub(super) fn nieuw() -> Self {
        Self { kaart: HashMap::new() }
    }

    unsafe fn van(&mut self, b: &dyn PdfiumLibraryBindings, font: FPDF_FONT, u: u32, fs: f64) -> f64 {
        if font.is_null() || u == 0 {
            return 0.0;
        }
        let per_punt = *self.kaart.entry((font as usize, u)).or_insert_with(|| {
            let mut w = 0f32;
            if b.FPDFFont_GetGlyphWidth(font, u, 1000.0, &mut w) != 0 && w.is_finite() && w > 0.0 {
                f64::from(w) / 1000.0
            } else {
                0.0
            }
        });
        per_punt * fs
    }
}

struct Fonts {
    index: HashMap<usize, u32>,
    namen: Vec<String>,
    per_naam: HashMap<String, u32>,
}

impl Fonts {
    /// Fontindex per naam: pdf.js wisselt pas van item bij een andere
    /// fontnaam, niet bij een tweede fontwoordenboek met dezelfde naam.
    unsafe fn van(&mut self, b: &dyn PdfiumLibraryBindings, font: FPDF_FONT) -> u32 {
        if let Some(&i) = self.index.get(&(font as usize)) {
            return i;
        }
        let naam = if font.is_null() { String::new() } else { basisnaam(b, font) };
        let volgend = self.namen.len() as u32;
        let i = *self.per_naam.entry(naam.clone()).or_insert_with(|| {
            self.namen.push(naam);
            volgend
        });
        self.index.insert(font as usize, i);
        i
    }
}

unsafe fn basisnaam(b: &dyn PdfiumLibraryBindings, font: FPDF_FONT) -> String {
    let n = b.FPDFFont_GetBaseFontName(font, std::ptr::null_mut(), 0);
    if n == 0 {
        return String::new();
    }
    let mut buf = vec![0u8; n];
    b.FPDFFont_GetBaseFontName(font, buf.as_mut_ptr() as *mut _, n);
    while buf.last() == Some(&0) {
        buf.pop();
    }
    String::from_utf8_lossy(&buf).into_owned()
}

/// Herkenning van de gemarkeerde inhoud (BDC/BMC … EMC) rond een object:
/// diepte en het binnenste markeringsitem. PDFium maakt per BDC een eigen
/// item, dat alle objecten binnen die reeks delen.
type Markering = (i32, usize);

unsafe fn markering(b: &dyn PdfiumLibraryBindings, obj: FPDF_PAGEOBJECT) -> Markering {
    let n = b.FPDFPageObj_CountMarks(obj).max(0);
    if n == 0 {
        return (0, 0);
    }
    (n, b.FPDFPageObj_GetMark(obj, (n - 1) as _) as usize)
}

/// Loop één niveau (de pagina of een formulier) af. pdf.js sluit het lopende
/// item bij elke BDC/BMC/EMC: wisselt de markering tussen twee objecten, dan
/// een `Spoel`.
unsafe fn bezoek_niveau(
    b: &dyn PdfiumLibraryBindings,
    objecten: &mut dyn Iterator<Item = FPDF_PAGEOBJECT>,
    diepte: u32,
    ev: &mut Vec<Gebeurtenis>,
    kaart: &mut HashMap<usize, (usize, FPDF_FONT)>,
    fonts: &mut Fonts,
) {
    let mut vorige: Option<Markering> = None;
    for obj in objecten {
        if obj.is_null() {
            continue;
        }
        let m = markering(b, obj);
        if vorige.is_some_and(|v| v != m) {
            ev.push(Gebeurtenis::Spoel);
        }
        vorige = Some(m);
        match b.FPDFPageObj_GetType(obj) as u32 {
            FPDF_PAGEOBJ_TEXT => {
                let font = b.FPDFTextObj_GetFont(obj);
                let f = fonts.van(b, font);
                kaart.insert(obj as usize, (ev.len(), font));
                ev.push(Gebeurtenis::Tekst { font: f, glyphs: Vec::new() });
            }
            FPDF_PAGEOBJ_FORM => {
                ev.push(Gebeurtenis::FormulierIn);
                if diepte < MAX_DIEPTE {
                    let n = b.FPDFFormObj_CountObjects(obj).max(0);
                    let mut kinderen = (0..n).map(|i| b.FPDFFormObj_GetObject(obj, i as _));
                    bezoek_niveau(b, &mut kinderen, diepte + 1, ev, kaart, fonts);
                }
                ev.push(Gebeurtenis::FormulierUit);
            }
            FPDF_PAGEOBJ_IMAGE => ev.push(Gebeurtenis::Spoel),
            _ => {}
        }
    }
}

fn utf16(u: u32, uit: &mut Vec<u16>) {
    if u == 0 {
        return;
    }
    // PDFium geeft een afbreekstreepje aan het regeleinde terug als U+0002.
    if u == 2 {
        uit.push(0x2d);
        return;
    }
    match char::from_u32(u) {
        Some(c) => {
            let mut buf = [0u16; 2];
            uit.extend_from_slice(c.encode_utf16(&mut buf));
        }
        // Losse surrogaathelft (wchar_t van 16 bit): zoals hij komt.
        None if u <= 0xffff => uit.push(u as u16),
        None => {}
    }
}

/// De glyphs van één tekstobject: tekens met dezelfde oorsprong en hetzelfde
/// vak zijn één glyph (PDFium splitst een glyph met meer Unicode-tekens, zoals
/// een ligatuur "fi", in losse tekens).
unsafe fn glyphs_van(b: &dyn PdfiumLibraryBindings, font: FPDF_FONT, tekens: &[RuwTeken], breedtes: &mut Breedtes) -> (Vec<Glyph>, bool) {
    let mut glyphs: Vec<Glyph> = Vec::with_capacity(tekens.len());
    let mut vakken: Vec<[f32; 4]> = Vec::with_capacity(tekens.len());
    let mut bron: Vec<(u32, usize)> = Vec::with_capacity(tekens.len());
    for t in tekens {
        if let (Some(g), Some(v), Some(br)) = (glyphs.last_mut(), vakken.last(), bron.last_mut()) {
            if g.x == t.x && g.y == t.y && *v == t.vak && g.m == t.m {
                utf16(t.u, &mut g.unicode);
                br.1 += 1;
                continue;
            }
        }
        let mut unicode = Vec::with_capacity(1);
        utf16(t.u, &mut unicode);
        glyphs.push(Glyph { unicode, x: t.x, y: t.y, m: t.m, fs: t.fs, w: 0.0 });
        vakken.push(t.vak);
        bron.push((t.u, 1));
    }
    // Voortgang: de breedte waarmee PDFium de glyph plaatst (/Widths, /W of
    // de standaardmetriek), via het font. De losse tekenbox is daar niet goed
    // voor: hij neemt ook uitstekende inkt mee ('f', 'r') en is bij gedraaide
    // tekst de omhullende van het gedraaide vak. Een glyph met meer tekens
    // (ligatuur) heeft geen eenduidige Unicode-naar-code-vertaling: die krijgt
    // hieronder de afstand tot de volgende glyph.
    for (g, &(u, n)) in glyphs.iter_mut().zip(&bron) {
        if n == 1 {
            g.w = breedtes.van(b, font, if u == 2 { 0x2d } else { u }, g.fs);
        }
    }
    // Terug in tekenvolgorde langs de basislijn (PDFium keert RTL-regels om).
    let mut verticaal = false;
    if glyphs.len() > 1 {
        let g0 = &glyphs[0];
        let lengte = g0.m[0].hypot(g0.m[1]).max(1e-12);
        let (dx, dy) = (g0.m[0] / lengte, g0.m[1] / lengte);
        let (x0, y0) = (g0.x, g0.y);
        let langs = |g: &Glyph| (g.x - x0) * dx + (g.y - y0) * dy;
        let dwars = |g: &Glyph| -(g.x - x0) * dy + (g.y - y0) * dx;
        let laatste = glyphs.last().expect("meer dan één");
        if dwars(laatste).abs() > 0.5 * g0.fs.max(1.0) && dwars(laatste).abs() > 4.0 * langs(laatste).abs() {
            verticaal = true;
        }
        let gesorteerd = glyphs.windows(2).all(|p| langs(&p[0]) <= langs(&p[1]));
        if !gesorteerd && !verticaal {
            let mut met_sleutel: Vec<(f64, Glyph, [f32; 4])> = glyphs.into_iter().zip(vakken).map(|(g, v)| (langs(&g), g, v)).collect();
            met_sleutel.sort_by(|p, q| p.0.partial_cmp(&q.0).unwrap_or(std::cmp::Ordering::Equal));
            (glyphs, vakken) = met_sleutel.into_iter().map(|(_, g, v)| (g, v)).unzip();
        }
    }
    // Zonder fontbreedte (een glyph met meer tekens, zoals een ligatuur via
    // /ToUnicode): tot de oorsprong van de volgende glyph, of voor de laatste
    // de losse tekenbox.
    for i in 0..glyphs.len() {
        if glyphs[i].w == 0.0 && !glyphs[i].unicode.is_empty() {
            let g = &glyphs[i];
            let lengte = g.m[0].hypot(g.m[1]).max(1e-12);
            let w = if i + 1 < glyphs.len() {
                let h = &glyphs[i + 1];
                ((h.x - g.x) * g.m[0] + (h.y - g.y) * g.m[1]) / lengte / lengte
            } else if g.m[1] == 0.0 && g.m[2] == 0.0 && g.m[0].abs() > 1e-6 {
                f64::from(vakken[i][2] - vakken[i][0]).abs() / g.m[0].abs()
            } else {
                0.0
            };
            glyphs[i].w = w.max(0.0);
        }
    }
    (glyphs, verticaal)
}

/// Lees pagina `index` van een document dat met de ruwe PDFium-API geopend is.
///
/// Safety: `doc` is een geldige documenthandle van dezelfde PDFium-binding.
pub unsafe fn lees(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT, index: i32) -> Result<RuwePagina> {
    let page = b.FPDF_LoadPage(doc, index);
    if page.is_null() {
        return Err(anyhow!("PDFium: page {} not loadable", index));
    }
    let uitkomst = lees_open(b, page);
    b.FPDF_ClosePage(page);
    uitkomst
}

unsafe fn lees_open(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> Result<RuwePagina> {
    let mut rect = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
    let view = if b.FPDF_GetPageBoundingBox(page, &mut rect) != 0 {
        let (x0, x1) = (rect.left.min(rect.right), rect.left.max(rect.right));
        let (y0, y1) = (rect.bottom.min(rect.top), rect.bottom.max(rect.top));
        [f64::from(x0), f64::from(y0), f64::from(x1), f64::from(y1)]
    } else {
        [0.0, 0.0, f64::from(b.FPDF_GetPageWidthF(page)), f64::from(b.FPDF_GetPageHeightF(page))]
    };

    let mut ev = Vec::new();
    let mut kaart: HashMap<usize, (usize, FPDF_FONT)> = HashMap::new();
    let mut fonts = Fonts { index: HashMap::new(), namen: Vec::new(), per_naam: HashMap::new() };
    let n = b.FPDFPage_CountObjects(page).max(0);
    let mut objecten = (0..n).map(|i| b.FPDFPage_GetObject(page, i));
    bezoek_niveau(b, &mut objecten, 0, &mut ev, &mut kaart, &mut fonts);

    let mut per_object: Vec<Vec<RuwTeken>> = (0..ev.len()).map(|_| Vec::new()).collect();
    let mut kaartfout = false;
    let tp = b.FPDFText_LoadPage(page);
    if !tp.is_null() {
        let aantal = b.FPDFText_CountChars(tp).max(0);
        // Matrix en lettergrootte zijn per tekstobject gelijk: één keer per
        // object opvragen. Het vak alleen als twee tekens dezelfde oorsprong
        // hebben (om een gesplitste glyph van twee glyphs op één plek te
        // onderscheiden).
        let mut vorig_obj: FPDF_PAGEOBJECT = std::ptr::null_mut();
        let mut vorige_index = -1;
        let (mut m4, mut fs) = ([1.0, 0.0, 0.0, 1.0], 0.0);
        let losse_vak = |i: i32| {
            let mut v = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
            b.FPDFText_GetLooseCharBox(tp, i, &mut v);
            [v.left, v.bottom, v.right, v.top]
        };
        for i in 0..aantal {
            if b.FPDFText_IsGenerated(tp, i) == 1 {
                continue;
            }
            let obj = b.FPDFText_GetTextObject(tp, i);
            // Een teken uit een object dat de objectboom niet gaf (dieper
            // genest dan MAX_DIEPTE): de pagina aan pdf.js.
            let Some(&(e, _)) = kaart.get(&(obj as usize)) else {
                kaartfout = true;
                continue;
            };
            // Een glyph zonder Unicode-vertaling: pdf.js vindt er vaak nog een
            // via de glyphnaam (© in een TeX-font), PDFium niet.
            if b.FPDFText_HasUnicodeMapError(tp, i) == 1 {
                kaartfout = true;
            }
            if obj != vorig_obj {
                let mut m = FS_MATRIX { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };
                b.FPDFText_GetMatrix(tp, i, &mut m);
                m4 = [f64::from(m.a), f64::from(m.b), f64::from(m.c), f64::from(m.d)];
                fs = b.FPDFText_GetFontSize(tp, i);
            }
            let (mut x, mut y) = (0f64, 0f64);
            b.FPDFText_GetCharOrigin(tp, i, &mut x, &mut y);
            let lijst = &mut per_object[e];
            let mut vak = [0f32; 4];
            if obj == vorig_obj {
                if let Some(vorige) = lijst.last_mut() {
                    if vorige.x == x && vorige.y == y {
                        if vorige.vak == [0f32; 4] {
                            vorige.vak = losse_vak(vorige_index);
                        }
                        vak = losse_vak(i);
                    }
                }
            }
            lijst.push(RuwTeken { u: b.FPDFText_GetUnicode(tp, i), x, y, m: m4, fs, vak });
            vorig_obj = obj;
            vorige_index = i;
        }
        b.FPDFText_ClosePage(tp);
    }

    let mut verticaal = false;
    let rtl = per_object.iter().flatten().any(|t| rtl_teken(t.u));
    let mut breedtes = Breedtes::nieuw();
    let mut obj_van: Vec<(usize, FPDF_PAGEOBJECT, FPDF_FONT)> = kaart.iter().map(|(&o, &(e, f))| (e, o as FPDF_PAGEOBJECT, f)).collect();
    obj_van.sort_by_key(|k| k.0);
    let mut leeg: Vec<(usize, FPDF_PAGEOBJECT)> = Vec::new();
    let mut type3_klein = false;
    for &(e, obj, font) in &obj_van {
        let tekens = std::mem::take(&mut per_object[e]);
        if tekens.is_empty() {
            leeg.push((e, obj));
            continue;
        }
        let (gl, vert) = glyphs_van(b, font, &tekens, &mut breedtes);
        verticaal |= vert;
        // Een Type3-font (geen BaseFont) op lettergrootte 1 of kleiner: pdf.js
        // schaalt dan de letterhoogte met FontBBox × FontMatrix, die PDFium
        // niet naar buiten geeft. Zo'n pagina leest pdf.js.
        if let Gebeurtenis::Tekst { font: f, .. } = ev[e] {
            if fonts.namen.get(f as usize).is_some_and(String::is_empty) && gl.iter().any(|g| g.fs <= 1.0) {
                type3_klein = true;
            }
        }
        if let Gebeurtenis::Tekst { glyphs, .. } = &mut ev[e] {
            *glyphs = gl;
        }
    }

    // Tekstobjecten zonder tekens in de tekstpagina:
    // - zonder oppervlak (alleen spaties, of leeg) slaat PDFium ze over; pdf.js
    //   ziet daar spaties: één spatieglyph in het font van het object;
    // - een kopie van een van de vorige tekstobjecten (zelfde font en grootte,
    //   overlappend vak; zo maken tekenprogramma's vette tekst) laat PDFium ook
    //   weg; pdf.js neemt hem gewoon mee: de glyphs van het origineel, verschoven
    //   over het verschil in positie;
    // - anders (gezien bij verticaal schrift) laat de pagina zich aan pdf.js.
    let mut ongelezen = kaartfout || type3_klein;
    let vak = |obj: FPDF_PAGEOBJECT| -> Option<[f32; 4]> {
        let (mut l, mut o, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
        (b.FPDFPageObj_GetBounds(obj, &mut l, &mut o, &mut r, &mut t) != 0).then_some([l, o, r, t])
    };
    let positie = |obj: FPDF_PAGEOBJECT| -> (f64, f64) {
        let mut m = FS_MATRIX { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };
        b.FPDFPageObj_GetMatrix(obj, &mut m);
        (f64::from(m.e), f64::from(m.f))
    };
    let objecten: HashMap<usize, FPDF_PAGEOBJECT> = obj_van.iter().map(|&(e, o, _)| (e, o)).collect();
    for (e, obj) in leeg {
        let mut fs = 0f32;
        b.FPDFTextObj_GetFontSize(obj, &mut fs);
        let fs = f64::from(fs);
        let v = vak(obj).unwrap_or([0.0; 4]);
        let (w, h) = (f64::from(v[2] - v[0]), f64::from(v[3] - v[1]));
        if w < 0.01 || h < 0.01 {
            // Zonder oppervlak: spaties langs de basislijn. Een object dat
            // alleen dwars op zijn basislijn loopt is verticaal schrift.
            let mut m = FS_MATRIX { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };
            b.FPDFPageObj_GetMatrix(obj, &mut m);
            let lengte = f64::from(m.a).hypot(f64::from(m.b)).max(1e-12);
            let (dx, dy) = (f64::from(m.a) / lengte, f64::from(m.b) / lengte);
            let langs = (w * dx).abs() + (h * dy).abs();
            let dwars = (w * dy).abs() + (h * dx).abs();
            if langs < 0.01 && dwars >= 0.01 {
                ongelezen = true;
            } else if let Gebeurtenis::Tekst { glyphs, .. } = &mut ev[e] {
                glyphs.push(Glyph { unicode: vec![0x20], x: 0.0, y: 0.0, m: [1.0, 0.0, 0.0, 1.0], fs, w: 0.0 });
            }
            continue;
        }
        let Gebeurtenis::Tekst { font, .. } = ev[e] else { continue };
        let mut kopie: Option<Vec<Glyph>> = None;
        let mut bekeken = 0;
        for k in (0..e).rev() {
            let Gebeurtenis::Tekst { font: f2, glyphs: g2 } = &ev[k] else { continue };
            if g2.is_empty() || g2[0].unicode == [0x20] && g2[0].w == 0.0 {
                continue;
            }
            bekeken += 1;
            if bekeken > 8 {
                break;
            }
            let Some(&o2) = objecten.get(&k) else { continue };
            let Some(w2) = vak(o2) else { continue };
            let overlap = v[2].min(w2[2]) - v[0].max(w2[0]);
            let hoog = v[3].min(w2[3]) - v[1].max(w2[1]);
            if *f2 == font && (g2[0].fs - fs).abs() < 1e-6 && overlap > (v[2] - v[0]) / 2.0 && hoog > 0.0 {
                let (p1, p2) = (positie(o2), positie(obj));
                let (dx, dy) = (p2.0 - p1.0, p2.1 - p1.1);
                kopie = Some(g2.iter().map(|g| Glyph { x: g.x + dx, y: g.y + dy, ..g.clone() }).collect());
                break;
            }
        }
        match kopie {
            Some(gl) => {
                if let Gebeurtenis::Tekst { glyphs, .. } = &mut ev[e] {
                    *glyphs = gl;
                }
            }
            None => ongelezen = true,
        }
    }
    Ok(RuwePagina { view, fonts: fonts.namen, gebeurtenissen: ev, verticaal, rtl, ongelezen })
}
