//! Vectorinhoud van één pagina uit PDFium halen.
//!
//! De pagina-objecten worden in tekenvolgorde doorlopen; formulier-XObjects
//! recursief. Elk object gaat direct naar de `sink` — er wordt geen tweede
//! kopie van de pagina opgebouwd, want PDFium houdt de geparste pagina zelf al
//! in het geheugen (honderden MB's op zware CAD-bladen).

use crate::error::ExportError;
use crate::geom::{Matrix, Point};
use crate::page_space::{PageFrame, PdfRect};
use crate::pdfium_ffi::*;
use crate::raw::*;
use std::collections::HashMap;
use std::ffi::{c_int, c_uint, c_ulong, CString};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// PDFium is niet thread-safe. Dit slot serialiseert alle PDFium-aanroepen van
/// deze crate binnen het proces, zodat twee exports tegelijk elkaar niet
/// raken. Het dekt NIET de aanroepen die de app zelf via haar renderer doet;
/// daarvoor houdt de aanroeper het slot van de renderer vast.
static PDFIUM_CALLS: Mutex<()> = Mutex::new(());

fn pdfium_guard() -> MutexGuard<'static, ()> {
    PDFIUM_CALLS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Formulier-XObjects dieper dan dit worden niet verder afgewikkeld
/// (bescherming tegen kringverwijzingen die PDFium zelf niet afving).
const MAX_FORM_DEPTH: u32 = 32;

/// Voortgang en afbreken van een extractie.
pub struct ExtractControl<'a> {
    /// Wordt tussen objecten gelezen; `true` breekt af met
    /// [`ExportError::Cancelled`].
    pub cancel: Option<&'a AtomicBool>,
    /// Krijgt (verwerkte topniveau-objecten, totaal topniveau-objecten).
    pub progress: Option<&'a mut dyn FnMut(u64, u64)>,
    /// Objecten die volledig buiten hun knippad vallen overslaan.
    pub drop_fully_clipped: bool,
    /// Geen tekstpagina opbouwen (scheelt tijd en geheugen als tekst toch niet
    /// wordt geëxporteerd); tekstobjecten worden dan overgeslagen.
    pub skip_text: bool,
}

impl Default for ExtractControl<'_> {
    fn default() -> Self {
        ExtractControl { cancel: None, progress: None, drop_fully_clipped: true, skip_text: false }
    }
}

/// Geladen PDFium-bibliotheek.
pub struct PdfiumLibrary {
    api: PdfiumApi,
}

/// Een annotatie die PDFium bij het platslaan meeneemt, met de paginarechthoek
/// om haar weergave in de platgeslagen inhoud terug te vinden.
#[derive(Clone, Debug)]
struct AnnotCandidate {
    name: Arc<str>,
    rect: PdfRect,
}

impl AnnotCandidate {
    /// True als het midden van `bounds` binnen de (ruim genomen) rechthoek van
    /// de annotatie ligt. De weergave wordt bij het platslaan op de rechthoek
    /// afgebeeld, dus dat is de betrouwbaarste koppeling.
    fn holds(&self, bounds: &PdfRect) -> bool {
        let margin_x = (self.rect.width() * 0.1).max(2.0);
        let margin_y = (self.rect.height() * 0.1).max(2.0);
        let cx = (bounds.left + bounds.right) * 0.5;
        let cy = (bounds.bottom + bounds.top) * 0.5;
        cx >= self.rect.left - margin_x
            && cx <= self.rect.right + margin_x
            && cy >= self.rect.bottom - margin_y
            && cy <= self.rect.top + margin_y
    }
}

/// Naam van een annotatiesoort zoals PDF die schrijft (`/Subtype`).
fn annotation_subtype_name(subtype: c_int) -> &'static str {
    match subtype {
        1 => "Text",
        2 => "Link",
        3 => "FreeText",
        4 => "Line",
        5 => "Square",
        6 => "Circle",
        7 => "Polygon",
        8 => "PolyLine",
        9 => "Highlight",
        10 => "Underline",
        11 => "Squiggly",
        12 => "StrikeOut",
        13 => "Stamp",
        14 => "Caret",
        15 => "Ink",
        16 => "Popup",
        17 => "FileAttachment",
        18 => "Sound",
        19 => "Movie",
        20 => "Widget",
        21 => "Screen",
        22 => "PrinterMark",
        23 => "TrapNet",
        24 => "Watermark",
        25 => "3D",
        26 => "RichMedia",
        27 => "XFAWidget",
        28 => "Redact",
        _ => "Annotation",
    }
}

/// Een geopende pagina. De velden staan in afbreekvolgorde: eerst de pagina,
/// dan het document, als laatste de bestandsafbeelding waar PDFium lui uit
/// leest.
pub struct PageSession<'a> {
    library: &'a PdfiumLibrary,
    frame: PageFrame,
    top_total: u64,
    load_page_ms: u64,
    /// Index van het eerste topniveau-object dat uit het platslaan van de
    /// annotaties komt; `None` als annotaties niet zijn meegenomen.
    annotation_start: Option<u64>,
    annotations: Vec<AnnotCandidate>,
    page: PageGuard<'a>,
    _doc: DocGuard<'a>,
    _map: memmap2::Mmap,
    /// Als laatste vrijgegeven: pas na het sluiten van pagina en document.
    _guard: MutexGuard<'static, ()>,
}

impl PageSession<'_> {
    /// Zichtbare paginabox en rotatie.
    pub fn frame(&self) -> PageFrame {
        self.frame
    }

    /// Doorloopt alle objecten en geeft ze in tekenvolgorde aan `sink`, in
    /// gebruikersruimte van de pagina.
    pub fn extract(
        &self,
        sink: &mut dyn FnMut(RawItem),
        control: &mut ExtractControl<'_>,
    ) -> Result<ExtractStats, ExportError> {
        let api = &self.library.api;
        let started = std::time::Instant::now();
        let texts = if control.skip_text {
            HashMap::new()
        } else {
            let text_page = TextPageGuard(api, unsafe { (api.FPDFText_LoadPage)(self.page.1) });
            self.library.collect_texts(text_page.1)
        };
        let text_page_ms = started.elapsed().as_millis() as u64;

        let mut walk = Walk {
            api,
            sink,
            control,
            stats: ExtractStats { load_page_ms: self.load_page_ms, text_page_ms, ..ExtractStats::default() },
            texts,
            ocg_names: HashMap::new(),
            top_total: self.top_total,
        };
        for i in 0..self.top_total {
            if i % 512 == 0 {
                walk.checkpoint(i)?;
            }
            let object = unsafe { (api.FPDFPage_GetObject)(self.page.1, i as c_int) };
            if self.annotation_start.is_some_and(|start| i >= start) {
                walk.flattened_annotations(object, &self.annotations)?;
            } else {
                walk.object(object, &Matrix::IDENTITY, None, 0)?;
            }
        }
        walk.checkpoint(self.top_total)?;
        Ok(walk.stats)
    }
}

struct DocGuard<'a>(&'a PdfiumApi, FpdfDocument);
impl Drop for DocGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.0.FPDF_CloseDocument)(self.1) }
    }
}
struct PageGuard<'a>(&'a PdfiumApi, FpdfPage);
impl Drop for PageGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.0.FPDF_ClosePage)(self.1) }
    }
}
struct TextPageGuard<'a>(&'a PdfiumApi, FpdfTextPage);
impl Drop for TextPageGuard<'_> {
    fn drop(&mut self) {
        if !self.1.is_null() {
            unsafe { (self.0.FPDFText_ClosePage)(self.1) }
        }
    }
}

/// Eén teken met de oorsprong van zijn basislijn, in gebruikersruimte.
struct CharPos {
    ch: char,
    origin: Point,
}

/// Een sprong langs de regel groter dan dit aantal lettergroottes begint een
/// nieuw tekststuk. De afstand wordt van oorsprong tot oorsprong gemeten, dus
/// de breedte van het vorige teken (voor cijfers ruim een halve lettergrootte)
/// zit er nog bij in: het echte gat mag zo ongeveer anderhalve lettergrootte
/// zijn — meer dan een paar spaties, minder dan de sprong tussen twee
/// maatgetallen.
const RUN_GAP_EM: f64 = 2.0;

/// Zo ver mag een teken van de regel af staan voordat het een nieuw stuk
/// begint (een regelovergang of een tweede regel binnen hetzelfde object).
const RUN_OFFSET_EM: f64 = 0.5;

struct Walk<'a, 'c> {
    api: &'a PdfiumApi,
    sink: &'a mut dyn FnMut(RawItem),
    control: &'a mut ExtractControl<'c>,
    stats: ExtractStats,
    texts: HashMap<usize, Vec<CharPos>>,
    ocg_names: HashMap<String, Arc<str>>,
    top_total: u64,
}

impl PdfiumLibrary {
    /// Bindt de PDFium-bibliotheek op het gegeven pad (in de app: hetzelfde
    /// bestand dat de renderer al laadde).
    pub fn load(library_path: &Path) -> Result<Self, ExportError> {
        // Ook het initialiseren van de bibliotheek mag niet gelijktijdig lopen.
        let _guard = pdfium_guard();
        PdfiumApi::load(library_path)
            .map(|api| PdfiumLibrary { api })
            .map_err(ExportError::Pdfium)
    }

    /// Aantal pagina's van een PDF.
    pub fn page_count(&self, pdf_path: &Path) -> Result<u32, ExportError> {
        let _guard = pdfium_guard();
        let map = map_file(pdf_path)?;
        let doc = self.open(&map)?;
        Ok(unsafe { (self.api.FPDF_GetPageCount)(doc.1) }.max(0) as u32)
    }

    fn open<'a>(&'a self, bytes: &[u8]) -> Result<DocGuard<'a>, ExportError> {
        let handle = unsafe {
            (self.api.FPDF_LoadMemDocument64)(bytes.as_ptr().cast(), bytes.len(), std::ptr::null())
        };
        if handle.is_null() {
            let code = unsafe { (self.api.FPDF_GetLastError)() };
            let reason = match code {
                2 => "bestand niet gevonden of niet te openen",
                3 => "geen geldig PDF-bestand",
                4 => "wachtwoord vereist",
                5 => "niet-ondersteunde beveiliging",
                _ => "onbekende fout",
            };
            return Err(ExportError::Pdfium(format!("PDF openen mislukt: {reason} (code {code})")));
        }
        Ok(DocGuard(&self.api, handle))
    }

    /// Opent pagina `page_index` (0-gebaseerd). PDFium parset de inhoud hier
    /// volledig; op zware CAD-bladen kost dat seconden en honderden MB's.
    ///
    /// Met `with_annotations` worden de annotaties van de pagina in het
    /// geheugen platgeslagen (`FPDFPage_Flatten`): hun weergave komt dan als
    /// gewone inhoud achter de pagina-inhoud, inclusief de tekst. Het bestand
    /// zelf wordt nooit gewijzigd.
    pub fn open_page(&self, pdf_path: &Path, page_index: u32, with_annotations: bool) -> Result<PageSession<'_>, ExportError> {
        let api = &self.api;
        let guard = pdfium_guard();
        let map = map_file(pdf_path)?;
        let doc = self.open(&map)?;
        let page_count = unsafe { (api.FPDF_GetPageCount)(doc.1) }.max(0) as u32;
        if page_index >= page_count {
            return Err(ExportError::PageOutOfRange { page_index, page_count });
        }
        let started = std::time::Instant::now();
        let page_handle = unsafe { (api.FPDF_LoadPage)(doc.1, page_index as c_int) };
        if page_handle.is_null() {
            return Err(ExportError::Pdfium(format!("pagina {} laden mislukt", page_index + 1)));
        }
        let mut page = PageGuard(api, page_handle);
        let frame = self.page_frame(page.1);
        // Het parsen van de inhoud gebeurt lui bij de eerste objectvraag.
        let mut top_total = unsafe { (api.FPDFPage_CountObjects)(page.1) }.max(0) as u64;
        let mut annotation_start = None;
        let mut annotations = Vec::new();
        if with_annotations {
            annotations = self.annotation_candidates(page.1);
            if !annotations.is_empty()
                && unsafe { (api.FPDFPage_Flatten)(page.1, FLAT_NORMALDISPLAY) } == FLATTEN_SUCCESS
            {
                // Het platslaan wijzigt het paginawoordenboek; pas een opnieuw
                // geladen pagina bevat de nieuwe inhoud.
                drop(page);
                let reloaded = unsafe { (api.FPDF_LoadPage)(doc.1, page_index as c_int) };
                if reloaded.is_null() {
                    return Err(ExportError::Pdfium(format!("pagina {} opnieuw laden mislukt", page_index + 1)));
                }
                page = PageGuard(api, reloaded);
                let after = unsafe { (api.FPDFPage_CountObjects)(page.1) }.max(0) as u64;
                if after > top_total {
                    annotation_start = Some(top_total);
                }
                top_total = after;
            }
        }
        let load_page_ms = started.elapsed().as_millis() as u64;
        Ok(PageSession {
            library: self,
            frame,
            top_total,
            load_page_ms,
            annotation_start,
            annotations,
            page,
            _doc: doc,
            _map: map,
            _guard: guard,
        })
    }

    /// De annotaties die `FPDFPage_Flatten` meeneemt, in dezelfde volgorde en
    /// met dezelfde uitsluitingen (pop-ups, verborgen en onzichtbare).
    fn annotation_candidates(&self, page: FpdfPage) -> Vec<AnnotCandidate> {
        let api = &self.api;
        let count = unsafe { (api.FPDFPage_GetAnnotCount)(page) }.max(0);
        let key = CString::new("OPS_Subtype").expect("sleutel zonder nul-teken");
        let mut buffer = [0u16; 128];
        let mut out = Vec::new();
        for i in 0..count {
            let annot = unsafe { (api.FPDFPage_GetAnnot)(page, i) };
            if annot.is_null() {
                continue;
            }
            let subtype = unsafe { (api.FPDFAnnot_GetSubtype)(annot) };
            let flags = unsafe { (api.FPDFAnnot_GetFlags)(annot) };
            let mut rect = FsRectF::default();
            let has_rect = unsafe { (api.FPDFAnnot_GetRect)(annot, &mut rect) } != 0;
            let len = unsafe {
                (api.FPDFAnnot_GetStringValue)(annot, key.as_ptr(), buffer.as_mut_ptr(), (buffer.len() * 2) as c_ulong)
            };
            // Een eigen soort die niet in de buffer past, telt niet; dan geldt
            // de PDF-soort.
            let own_type = PdfiumApi::utf16_if_complete(&buffer, len as usize).unwrap_or_default();
            unsafe { (api.FPDFPage_CloseAnnot)(annot) };
            if subtype == ANNOT_SUBTYPE_POPUP || flags & (ANNOT_FLAG_HIDDEN | ANNOT_FLAG_INVISIBLE) != 0 || !has_rect {
                continue;
            }
            let name = if own_type.trim().is_empty() {
                annotation_subtype_name(subtype).to_string()
            } else {
                own_type.trim().to_string()
            };
            out.push(AnnotCandidate {
                name: Arc::from(name.as_str()),
                rect: PdfRect::new(rect.left as f64, rect.bottom as f64, rect.right as f64, rect.top as f64),
            });
        }
        out
    }

    fn page_frame(&self, page: FpdfPage) -> PageFrame {
        let api = &self.api;
        let read_box = |getter: unsafe extern "C" fn(FpdfPage, *mut f32, *mut f32, *mut f32, *mut f32) -> FpdfBool| {
            let (mut l, mut b, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
            let ok = unsafe { getter(page, &mut l, &mut b, &mut r, &mut t) } != 0;
            ok.then(|| PdfRect::new(l as f64, b as f64, r as f64, t as f64))
        };
        let crop = read_box(api.FPDFPage_GetCropBox);
        let media = read_box(api.FPDFPage_GetMediaBox).or(crop).unwrap_or_else(|| {
            // Geen van beide boxen: val terug op de paginamaat vanaf de oorsprong.
            let (w, h) = unsafe { ((api.FPDF_GetPageWidthF)(page), (api.FPDF_GetPageHeightF)(page)) };
            PdfRect::new(0.0, 0.0, w as f64, h as f64)
        });
        let rotate = unsafe { (api.FPDFPage_GetRotation)(page) } * 90;
        // /UserUnit is via de publieke PDFium-API niet uit te lezen; de
        // aanroeper kan het via `PageFrame::user_unit` overschrijven.
        PageFrame::new(media, crop, rotate, 1.0)
    }

    /// Eén doorgang over alle tekens van de pagina: teken → tekstobject, met de
    /// oorsprong van elk teken. Dat is O(n); per tekstobject de tekst opvragen
    /// zou O(n²) zijn.
    ///
    /// De oorsprongen zijn nodig omdat één tekstobject (één `TJ`-rij) stukken
    /// op heel verschillende plekken kan zetten: een maatketen zet zo alle
    /// maatgetallen van een rij in één object. Spaties die PDFium zelf aanvult
    /// blijven staan; ze scheiden woorden die in de PDF los geplaatst zijn.
    fn collect_texts(&self, text_page: FpdfTextPage) -> HashMap<usize, Vec<CharPos>> {
        let api = &self.api;
        let mut texts: HashMap<usize, Vec<CharPos>> = HashMap::new();
        if text_page.is_null() {
            return texts;
        }
        let count = unsafe { (api.FPDFText_CountChars)(text_page) };
        for i in 0..count {
            let object = unsafe { (api.FPDFText_GetTextObject)(text_page, i) };
            if object.is_null() {
                continue;
            }
            let code = unsafe { (api.FPDFText_GetUnicode)(text_page, i) };
            let Some(ch) = char::from_u32(code) else { continue };
            let (mut x, mut y) = (0f64, 0f64);
            if unsafe { (api.FPDFText_GetCharOrigin)(text_page, i, &mut x, &mut y) } == 0 {
                continue;
            }
            texts.entry(object as usize).or_default().push(CharPos { ch, origin: Point::new(x, y) });
        }
        texts
    }
}

impl Walk<'_, '_> {
    fn checkpoint(&mut self, done: u64) -> Result<(), ExportError> {
        if let Some(flag) = self.control.cancel {
            if flag.load(Ordering::Relaxed) {
                return Err(ExportError::Cancelled);
            }
        }
        if let Some(progress) = self.control.progress.as_mut() {
            progress(done, self.top_total);
        }
        Ok(())
    }

    /// Het formulierobject dat `FPDFPage_Flatten` achter de pagina-inhoud zette:
    /// één kind per annotatie, in de volgorde van de kandidaten. Elk kind krijgt
    /// de laag van de annotatie waarvan het de weergave is.
    fn flattened_annotations(&mut self, form: FpdfPageObject, candidates: &[AnnotCandidate]) -> Result<(), ExportError> {
        let api = self.api;
        if form.is_null() {
            return Ok(());
        }
        if unsafe { (api.FPDFPageObj_GetType)(form) } != PAGEOBJ_FORM {
            return self.object(form, &Matrix::IDENTITY, Some(&LayerHint::Annotation(Arc::from("Annotation"))), 0);
        }
        let matrix = self.matrix_of(form);
        let count = unsafe { (api.FPDFFormObj_CountObjects)(form) }.max(0) as u64;
        let mut cursor = 0usize;
        for j in 0..count {
            let child = unsafe { (api.FPDFFormObj_GetObject)(form, j as c_ulong) };
            if child.is_null() {
                continue;
            }
            let (mut l, mut b, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
            let has_bounds = unsafe { (api.FPDFPageObj_GetBounds)(child, &mut l, &mut b, &mut r, &mut t) } != 0;
            let bounds = has_bounds.then(|| {
                let p0 = matrix.apply(Point::new(l as f64, b as f64));
                let p1 = matrix.apply(Point::new(r as f64, t as f64));
                PdfRect::new(p0.x, p0.y, p1.x, p1.y)
            });
            let found = match bounds {
                Some(bounds) => (cursor..candidates.len()).find(|&k| candidates[k].holds(&bounds)),
                None => (cursor < candidates.len()).then_some(cursor),
            };
            let name = match found {
                Some(k) => {
                    cursor = k + 1;
                    candidates[k].name.clone()
                }
                None => Arc::from("Annotation"),
            };
            self.stats.annotations += 1;
            self.object(child, &matrix, Some(&LayerHint::Annotation(name)), 1)?;
        }
        Ok(())
    }

    fn object(
        &mut self,
        object: FpdfPageObject,
        parent: &Matrix,
        inherited: Option<&LayerHint>,
        depth: u32,
    ) -> Result<(), ExportError> {
        if object.is_null() {
            return Ok(());
        }
        let api = self.api;
        let kind = unsafe { (api.FPDFPageObj_GetType)(object) };
        let own = self.matrix_of(object);
        let total = own.then(parent);
        // Een annotatie houdt haar eigen laag, ook als haar weergave een
        // /OC-markering bevat.
        let layer = match inherited {
            Some(LayerHint::Annotation(_)) => inherited.cloned(),
            _ => self.ocg_of(object).map(LayerHint::Ocg).or_else(|| inherited.cloned()),
        };
        if matches!(layer, Some(LayerHint::Ocg(_))) && kind != PAGEOBJ_FORM {
            self.stats.objects_with_ocg += 1;
        }

        match kind {
            PAGEOBJ_FORM => {
                self.stats.form_objects += 1;
                self.stats.max_form_depth = self.stats.max_form_depth.max(depth + 1);
                if depth + 1 >= MAX_FORM_DEPTH {
                    return Ok(());
                }
                let count = unsafe { (api.FPDFFormObj_CountObjects)(object) }.max(0) as u64;
                for i in 0..count {
                    if i % 2048 == 2047 {
                        if let Some(flag) = self.control.cancel {
                            if flag.load(Ordering::Relaxed) {
                                return Err(ExportError::Cancelled);
                            }
                        }
                    }
                    let child = unsafe { (api.FPDFFormObj_GetObject)(object, i as c_ulong) };
                    self.object(child, &total, layer.as_ref(), depth + 1)?;
                }
            }
            PAGEOBJ_PATH => {
                self.stats.path_objects += 1;
                if self.is_clipped_away(object, parent) {
                    return Ok(());
                }
                if let Some(path) = self.read_path(object, &total, layer) {
                    (self.sink)(RawItem::Path(path));
                }
            }
            PAGEOBJ_TEXT => {
                self.stats.text_objects += 1;
                if self.is_clipped_away(object, parent) {
                    return Ok(());
                }
                for text in self.read_text(object, &total, layer) {
                    (self.sink)(RawItem::Text(text));
                }
            }
            PAGEOBJ_IMAGE => {
                self.stats.image_objects += 1;
                let (mut w, mut h): (c_uint, c_uint) = (0, 0);
                unsafe { (api.FPDFImageObj_GetImagePixelSize)(object, &mut w, &mut h) };
                (self.sink)(RawItem::Image(RawImage { matrix: total, pixel_width: w, pixel_height: h, layer }));
            }
            PAGEOBJ_SHADING => self.stats.shading_objects += 1,
            _ => {}
        }
        Ok(())
    }

    fn matrix_of(&self, object: FpdfPageObject) -> Matrix {
        let mut m = FsMatrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };
        if unsafe { (self.api.FPDFPageObj_GetMatrix)(object, &mut m) } == 0 {
            return Matrix::IDENTITY;
        }
        Matrix::new(m.a as f64, m.b as f64, m.c as f64, m.d as f64, m.e as f64, m.f as f64)
    }

    /// OCG-naam uit een `/OC`-inhoudsmarkering. PDFium lost de verwijzing naar
    /// de eigenschappenlijst in `/Properties` zelf op, zodat de parameter
    /// `Name` van de markering de laagnaam is.
    fn ocg_of(&mut self, object: FpdfPageObject) -> Option<Arc<str>> {
        let api = self.api;
        let marks = unsafe { (api.FPDFPageObj_CountMarks)(object) };
        if marks <= 0 {
            return None;
        }
        let key = CString::new("Name").ok()?;
        let mut buffer = [0u16; 256];
        // De binnenste (laatste) markering wint bij geneste lagen.
        for i in (0..marks).rev() {
            let mark = unsafe { (api.FPDFPageObj_GetMark)(object, i as c_ulong) };
            if mark.is_null() {
                continue;
            }
            let mut len: c_ulong = 0;
            let ok = unsafe {
                (api.FPDFPageObjMark_GetName)(mark, buffer.as_mut_ptr(), (buffer.len() * 2) as c_ulong, &mut len)
            };
            if ok == 0 || PdfiumApi::utf16_if_complete(&buffer, len as usize).as_deref() != Some("OC") {
                continue;
            }
            if unsafe { (api.FPDFPageObjMark_GetParamValueType)(mark, key.as_ptr()) } != OBJECT_STRING {
                continue;
            }
            let mut len: c_ulong = 0;
            let ok = unsafe {
                (api.FPDFPageObjMark_GetParamStringValue)(
                    mark,
                    key.as_ptr(),
                    buffer.as_mut_ptr(),
                    (buffer.len() * 2) as c_ulong,
                    &mut len,
                )
            };
            if ok == 0 {
                continue;
            }
            // Een laagnaam die niet in de buffer past, is niet de naam van de
            // vorige laag.
            let Some(name) = PdfiumApi::utf16_if_complete(&buffer, len as usize).filter(|n| !n.is_empty()) else { continue };
            let interned = self
                .ocg_names
                .entry(name)
                .or_insert_with_key(|k| Arc::from(k.as_str()))
                .clone();
            return Some(interned);
        }
        None
    }

    /// True als het object volledig buiten de omhullende van zijn knippad valt.
    /// Telt daarnaast objecten die er gedeeltelijk buiten vallen. Objectgrenzen
    /// en knippad staan beide in de ruimte van de ouder, dus `parent` is hier
    /// niet nodig voor de vergelijking zelf.
    fn is_clipped_away(&mut self, object: FpdfPageObject, _parent: &Matrix) -> bool {
        let api = self.api;
        let clip = unsafe { (api.FPDFPageObj_GetClipPath)(object) };
        if clip.is_null() {
            return false;
        }
        let paths = unsafe { (api.FPDFClipPath_CountPaths)(clip) };
        if paths <= 0 {
            return false;
        }
        // Doorsnede van de omhullenden van alle knippaden.
        let mut clip_box: Option<PdfRect> = None;
        for p in 0..paths {
            let segments = unsafe { (api.FPDFClipPath_CountPathSegments)(clip, p) };
            if segments <= 0 {
                continue;
            }
            let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
            for s in 0..segments {
                let segment = unsafe { (api.FPDFClipPath_GetPathSegment)(clip, p, s) };
                let (mut x, mut y) = (0f32, 0f32);
                if segment.is_null() || unsafe { (api.FPDFPathSegment_GetPoint)(segment, &mut x, &mut y) } == 0 {
                    continue;
                }
                x0 = x0.min(x as f64);
                y0 = y0.min(y as f64);
                x1 = x1.max(x as f64);
                y1 = y1.max(y as f64);
            }
            if x0 > x1 {
                continue;
            }
            let this = PdfRect::new(x0, y0, x1, y1);
            clip_box = Some(match clip_box {
                None => this,
                Some(prev) => match intersect_loose(&prev, &this) {
                    Some(r) => r,
                    None => {
                        self.stats.objects_clipped += 1;
                        return self.control.drop_fully_clipped;
                    }
                },
            });
        }
        let Some(clip_box) = clip_box else { return false };
        let (mut l, mut b, mut r, mut t) = (0f32, 0f32, 0f32, 0f32);
        if unsafe { (api.FPDFPageObj_GetBounds)(object, &mut l, &mut b, &mut r, &mut t) } == 0 {
            return false;
        }
        let bounds = PdfRect::new(l as f64, b as f64, r as f64, t as f64);
        const EPS: f64 = 0.01;
        let inside = bounds.left >= clip_box.left - EPS
            && bounds.right <= clip_box.right + EPS
            && bounds.bottom >= clip_box.bottom - EPS
            && bounds.top <= clip_box.top + EPS;
        if inside {
            return false;
        }
        self.stats.objects_clipped += 1;
        let outside = bounds.right < clip_box.left - EPS
            || bounds.left > clip_box.right + EPS
            || bounds.top < clip_box.bottom - EPS
            || bounds.bottom > clip_box.top + EPS;
        outside && self.control.drop_fully_clipped
    }

    fn read_path(&mut self, object: FpdfPageObject, total: &Matrix, layer: Option<LayerHint>) -> Option<RawPath> {
        let api = self.api;
        let (mut fill_mode, mut stroked): (c_int, FpdfBool) = (FILLMODE_NONE, 0);
        if unsafe { (api.FPDFPath_GetDrawMode)(object, &mut fill_mode, &mut stroked) } == 0 {
            return None;
        }

        let stroke = (stroked != 0).then(|| self.stroke_style(object, total)).flatten();
        let fill = match fill_mode {
            FILLMODE_ALTERNATE => self.fill_color(object).map(|color| FillStyle { color, rule: FillRule::EvenOdd }),
            FILLMODE_WINDING => self.fill_color(object).map(|color| FillStyle { color, rule: FillRule::NonZero }),
            _ => None,
        };
        if stroke.is_none() && fill.is_none() {
            return None;
        }

        let count = unsafe { (api.FPDFPath_CountSegments)(object) };
        let mut subpaths: Vec<SubPath> = Vec::new();
        let mut pending: Vec<Point> = Vec::with_capacity(2);
        for i in 0..count {
            let segment = unsafe { (api.FPDFPath_GetPathSegment)(object, i) };
            if segment.is_null() {
                continue;
            }
            let (mut x, mut y) = (0f32, 0f32);
            if unsafe { (api.FPDFPathSegment_GetPoint)(segment, &mut x, &mut y) } == 0 {
                continue;
            }
            let point = total.apply(Point::new(x as f64, y as f64));
            let kind = unsafe { (api.FPDFPathSegment_GetType)(segment) };
            let close = unsafe { (api.FPDFPathSegment_GetClose)(segment) } != 0;
            self.stats.path_segments += 1;
            match kind {
                SEGMENT_MOVETO => {
                    pending.clear();
                    subpaths.push(SubPath { start: point, segments: Vec::new(), closed: false });
                }
                SEGMENT_LINETO => {
                    pending.clear();
                    if let Some(sub) = subpaths.last_mut() {
                        sub.segments.push(Segment::Line(point));
                    }
                }
                SEGMENT_BEZIERTO => {
                    pending.push(point);
                    if pending.len() == 3 {
                        self.stats.bezier_segments += 1;
                        if let Some(sub) = subpaths.last_mut() {
                            sub.segments.push(Segment::Cubic(pending[0], pending[1], pending[2]));
                        }
                        pending.clear();
                    }
                }
                _ => {}
            }
            if close {
                if let Some(sub) = subpaths.last_mut() {
                    sub.closed = true;
                }
            }
        }
        subpaths.retain(|s| !s.segments.is_empty());
        if subpaths.is_empty() {
            return None;
        }
        Some(RawPath { subpaths, stroke, fill, layer })
    }

    fn stroke_style(&self, object: FpdfPageObject, total: &Matrix) -> Option<StrokeStyle> {
        let api = self.api;
        let (mut r, mut g, mut b, mut a): (c_uint, c_uint, c_uint, c_uint) = (0, 0, 0, 255);
        if unsafe { (api.FPDFPageObj_GetStrokeColor)(object, &mut r, &mut g, &mut b, &mut a) } == 0 {
            (r, g, b, a) = (0, 0, 0, 255);
        }
        if a == 0 {
            return None;
        }
        let scale = total.mean_scale();
        let mut width = 0f32;
        unsafe { (api.FPDFPageObj_GetStrokeWidth)(object, &mut width) };

        let dash_count = unsafe { (api.FPDFPageObj_GetDashCount)(object) }.max(0) as usize;
        let mut dash: Vec<f64> = Vec::new();
        let mut dash_phase = 0f32;
        if dash_count > 0 {
            let mut values = vec![0f32; dash_count];
            if unsafe { (api.FPDFPageObj_GetDashArray)(object, values.as_mut_ptr(), dash_count) } != 0 {
                dash = values.iter().map(|&v| v as f64 * scale).collect();
            }
            unsafe { (api.FPDFPageObj_GetDashPhase)(object, &mut dash_phase) };
            // Een patroon van alleen nullen of met negatieve waarden is ongeldig → doorgetrokken.
            if dash.iter().all(|&v| v <= 0.0) || dash.iter().any(|&v| v < 0.0) {
                dash.clear();
            }
        }
        Some(StrokeStyle {
            color: Rgba { r: r as u8, g: g as u8, b: b as u8, a: a as u8 },
            width: width as f64 * scale,
            dash,
            dash_phase: dash_phase as f64 * scale,
        })
    }

    fn fill_color(&self, object: FpdfPageObject) -> Option<Rgba> {
        let (mut r, mut g, mut b, mut a): (c_uint, c_uint, c_uint, c_uint) = (0, 0, 0, 255);
        if unsafe { (self.api.FPDFPageObj_GetFillColor)(object, &mut r, &mut g, &mut b, &mut a) } == 0 {
            (r, g, b, a) = (0, 0, 0, 255);
        }
        (a != 0).then_some(Rgba { r: r as u8, g: g as u8, b: b as u8, a: a as u8 })
    }

    /// Eén tekstobject wordt één tekst per aaneengesloten stuk: een `TJ`-rij
    /// met grote sprongen (een maatketen) levert een tekst per maatgetal, elk
    /// op zijn eigen plek en met de hoek en de schaal van het object.
    fn read_text(&mut self, object: FpdfPageObject, total: &Matrix, layer: Option<LayerHint>) -> Vec<RawText> {
        let api = self.api;
        let Some(chars) = self.texts.remove(&(object as usize)) else { return Vec::new() };
        let mut font_size = 0f32;
        unsafe { (api.FPDFTextObj_GetFontSize)(object, &mut font_size) };
        let render_mode = unsafe { (api.FPDFTextObj_GetTextRenderMode)(object) };
        let font = unsafe { (api.FPDFTextObj_GetFont)(object) };
        let mut font_name = String::new();
        if !font.is_null() {
            let mut buffer = [0u8; 256];
            let len = unsafe { (api.FPDFFont_GetBaseFontName)(font, buffer.as_mut_ptr().cast(), buffer.len()) };
            let len = len.min(buffer.len());
            let end = buffer[..len].iter().position(|&c| c == 0).unwrap_or(len);
            font_name = String::from_utf8_lossy(&buffer[..end]).into_owned();
        }
        let color = self.fill_color(object).unwrap_or(Rgba::BLACK);
        // De lettergrootte in gebruikersruimte bepaalt wanneer een sprong te
        // groot is om nog dezelfde regel te zijn.
        let em = font_size as f64 * total.mean_scale();
        split_runs(&chars, em, (total.a, total.b))
            .into_iter()
            .map(|(text, origin)| RawText {
                text,
                // Zelfde draaiing en schaal als het object, eigen invoegpunt.
                matrix: Matrix::new(total.a, total.b, total.c, total.d, origin.x, origin.y),
                font_size: font_size as f64,
                font_name: font_name.clone(),
                color,
                render_mode,
                layer: layer.clone(),
            })
            .collect()
    }
}

/// Splitst de tekens van één tekstobject in stukken die bij elkaar horen.
/// Gemeten langs de regel (`direction` is de x-as van de tekstmatrix): een
/// sprong vooruit van meer dan [`RUN_GAP_EM`] lettergroottes, een sprong terug
/// of een stap opzij van meer dan [`RUN_OFFSET_EM`] begint een nieuw stuk. Elk
/// stuk krijgt de oorsprong van zijn eerste teken; spaties aan het begin en het
/// eind vervallen.
fn split_runs(chars: &[CharPos], em: f64, direction: (f64, f64)) -> Vec<(String, Point)> {
    let length = (direction.0 * direction.0 + direction.1 * direction.1).sqrt();
    // Zonder bruikbare lettergrootte of richting (een ontaarde matrix) blijft
    // alles één stuk: liever samen dan op een verzonnen grens uit elkaar.
    let split = em.is_finite() && em > 0.0 && length > 1e-12;
    let (ux, uy) = if split { (direction.0 / length, direction.1 / length) } else { (1.0, 0.0) };
    let (gap, offset) = (em * RUN_GAP_EM, em * RUN_OFFSET_EM);

    let mut runs: Vec<(String, Point)> = Vec::new();
    let mut previous: Option<Point> = None;
    let mut start_new = true;
    for CharPos { ch, origin } in chars {
        if let (Some(p), true) = (previous, split) {
            let (dx, dy) = (origin.x - p.x, origin.y - p.y);
            let along = dx * ux + dy * uy;
            let across = -dx * uy + dy * ux;
            if along > gap || along < -offset || across.abs() > offset {
                start_new = true;
            }
        }
        previous = Some(*origin);
        if ch.is_control() {
            // Een regelovergang die PDFium aanvult hoort niet in de tekst.
            start_new = true;
            continue;
        }
        if ch.is_whitespace() && start_new {
            continue;
        }
        if start_new {
            runs.push((String::new(), *origin));
            start_new = false;
        }
        runs.last_mut().expect("er is net een stuk begonnen").0.push(*ch);
    }
    for run in &mut runs {
        run.0.truncate(run.0.trim_end().len());
    }
    runs.retain(|(text, _)| !text.is_empty());
    runs
}

fn intersect_loose(a: &PdfRect, b: &PdfRect) -> Option<PdfRect> {
    let r = PdfRect {
        left: a.left.max(b.left),
        bottom: a.bottom.max(b.bottom),
        right: a.right.min(b.right),
        top: a.top.min(b.top),
    };
    (r.right >= r.left && r.top >= r.bottom).then_some(r)
}

fn map_file(path: &Path) -> Result<memmap2::Mmap, ExportError> {
    let file = std::fs::File::open(path).map_err(|e| ExportError::Io(format!("{}: {e}", path.display())))?;
    // Veilig zolang niemand het bestand onder ons inkort; de export leest alleen.
    unsafe { memmap2::Mmap::map(&file) }.map_err(|e| ExportError::Io(format!("{}: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tekens op een rij, elk `advance` verder, met een extra sprong vóór een
    /// teken waarvan de index in `jumps` staat.
    fn line(text: &str, advance: f64, jumps: &[(usize, f64)]) -> Vec<CharPos> {
        let mut x = 0.0;
        text.chars()
            .enumerate()
            .map(|(i, ch)| {
                if i > 0 {
                    x += advance + jumps.iter().find(|(at, _)| *at == i).map_or(0.0, |(_, extra)| *extra);
                }
                CharPos { ch, origin: Point::new(x, 0.0) }
            })
            .collect()
    }

    fn texts(runs: &[(String, Point)]) -> Vec<&str> {
        runs.iter().map(|(t, _)| t.as_str()).collect()
    }

    #[test]
    fn a_big_jump_starts_a_new_piece_and_a_normal_space_does_not() {
        // Lettergrootte 10, tekenbreedte 5,6 (cijfers): een sprong van 40 is
        // ruim boven de grens, een spatie van 2,8 ruim eronder.
        let chars = line("3960403960", 5.6, &[(4, 40.0), (6, 40.0)]);
        let runs = split_runs(&chars, 10.0, (1.0, 0.0));
        assert_eq!(texts(&runs), ["3960", "40", "3960"]);
        assert!((runs[1].1.x - (4.0 * 5.6 + 40.0)).abs() < 1e-9, "{:?}", runs[1].1);

        let zin = line("Hart op hart", 5.6, &[]);
        assert_eq!(texts(&split_runs(&zin, 10.0, (1.0, 0.0))), ["Hart op hart"]);
    }

    #[test]
    fn a_jump_just_under_the_limit_keeps_one_piece() {
        // Tot twee lettergroottes van oorsprong tot oorsprong blijft het één
        // regel; daarboven niet.
        let onder = line("1234", 5.6, &[(2, 10.0)]);
        assert_eq!(texts(&split_runs(&onder, 10.0, (1.0, 0.0))), ["1234"]);
        let boven = line("1234", 5.6, &[(2, 15.0)]);
        assert_eq!(texts(&split_runs(&boven, 10.0, (1.0, 0.0))), ["12", "34"]);
    }

    #[test]
    fn the_jump_is_measured_along_the_line_so_rotated_text_splits_the_same_way() {
        // Staande tekst: dezelfde tekens, gedraaid over 90°.
        let mut chars = line("2700900", 5.6, &[(4, 40.0)]);
        for c in &mut chars {
            c.origin = Point::new(-c.origin.y, c.origin.x);
        }
        assert_eq!(texts(&split_runs(&chars, 10.0, (0.0, 1.0))), ["2700", "900"]);
        // Met de richting van liggende tekst is dezelfde sprong een stap
        // opzij: ook dan een nieuw stuk, want de tekst staat niet op één regel.
        assert_eq!(split_runs(&chars, 10.0, (1.0, 0.0)).len(), 7);
    }

    #[test]
    fn a_step_back_or_aside_starts_a_new_piece_and_a_line_break_too() {
        let mut chars = line("AB", 5.6, &[]);
        chars.push(CharPos { ch: 'C', origin: Point::new(0.0, 0.0) });
        assert_eq!(texts(&split_runs(&chars, 10.0, (1.0, 0.0))), ["AB", "C"]);

        let mut chars = line("AB", 5.6, &[]);
        chars.push(CharPos { ch: 'C', origin: Point::new(16.8, 12.0) });
        assert_eq!(texts(&split_runs(&chars, 10.0, (1.0, 0.0))), ["AB", "C"]);

        let mut chars = line("AB", 5.6, &[]);
        chars.push(CharPos { ch: '\n', origin: Point::new(16.8, 0.0) });
        chars.push(CharPos { ch: 'C', origin: Point::new(22.4, 0.0) });
        assert_eq!(texts(&split_runs(&chars, 10.0, (1.0, 0.0))), ["AB", "C"]);
    }

    #[test]
    fn spaces_at_the_start_and_the_end_fall_away_and_an_empty_piece_is_dropped() {
        let chars = line("  A B  ", 5.6, &[]);
        let runs = split_runs(&chars, 10.0, (1.0, 0.0));
        assert_eq!(texts(&runs), ["A B"]);
        // Het invoegpunt is dat van de eerste letter, niet van de spatie ervoor.
        assert!((runs[0].1.x - 2.0 * 5.6).abs() < 1e-9, "{:?}", runs[0].1);
        assert!(split_runs(&line("   ", 5.6, &[]), 10.0, (1.0, 0.0)).is_empty());
    }

    #[test]
    fn without_a_usable_font_size_or_direction_everything_stays_one_piece() {
        let chars = line("3960403960", 5.6, &[(4, 40.0), (6, 40.0)]);
        assert_eq!(texts(&split_runs(&chars, 0.0, (1.0, 0.0))), ["3960403960"]);
        assert_eq!(texts(&split_runs(&chars, 10.0, (0.0, 0.0))), ["3960403960"]);
    }
}
