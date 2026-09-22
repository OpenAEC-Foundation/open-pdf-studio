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

struct Walk<'a, 'c> {
    api: &'a PdfiumApi,
    sink: &'a mut dyn FnMut(RawItem),
    control: &'a mut ExtractControl<'c>,
    stats: ExtractStats,
    texts: HashMap<usize, String>,
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

    /// Eén doorgang over alle tekens van de pagina: teken → tekstobject. Dat is
    /// O(n); per tekstobject de tekst opvragen zou O(n²) zijn.
    fn collect_texts(&self, text_page: FpdfTextPage) -> HashMap<usize, String> {
        let api = &self.api;
        let mut texts: HashMap<usize, String> = HashMap::new();
        if text_page.is_null() {
            return texts;
        }
        let count = unsafe { (api.FPDFText_CountChars)(text_page) };
        for i in 0..count {
            if unsafe { (api.FPDFText_IsGenerated)(text_page, i) } == 1 {
                continue;
            }
            let object = unsafe { (api.FPDFText_GetTextObject)(text_page, i) };
            if object.is_null() {
                continue;
            }
            let code = unsafe { (api.FPDFText_GetUnicode)(text_page, i) };
            if let Some(ch) = char::from_u32(code) {
                if !ch.is_control() {
                    texts.entry(object as usize).or_default().push(ch);
                }
            }
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
                if let Some(text) = self.read_text(object, &total, layer) {
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

    fn read_text(&mut self, object: FpdfPageObject, total: &Matrix, layer: Option<LayerHint>) -> Option<RawText> {
        let api = self.api;
        let text = self.texts.remove(&(object as usize))?;
        if text.trim().is_empty() {
            return None;
        }
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
        Some(RawText {
            text,
            matrix: *total,
            font_size: font_size as f64,
            font_name,
            color,
            render_mode,
            layer,
        })
    }
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
