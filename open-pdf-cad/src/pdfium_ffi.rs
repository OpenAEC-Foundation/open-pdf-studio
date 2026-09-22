//! Minimale FFI-laag naar de PDFium-bibliotheek die de app al meelevert.
//!
//! Waarom niet de hoog-niveau-API van `pdfium-render`? Versie 0.9.1 biedt wel
//! paden, tekst, matrices en formulier-XObjects, maar **geen** toegang tot de
//! inhoudsmarkeringen (`FPDFPageObj_GetMark` …) van een pagina-object, en de
//! object-handles en de bindings-instantie zijn `pub(crate)`. Zonder die
//! markeringen is de OCG-laag van een object niet te achterhalen. PDFium zelf
//! levert de laagnaam wél: bij `/OC /MCn BDC` lost het de eigenschappenlijst op
//! en geeft `FPDFPageObjMark_GetParamStringValue(mark, "Name")` de OCG-naam.
//!
//! Deze laag bindt daarom rechtstreeks de ~40 C-functies die de export nodig
//! heeft. Het laden van hetzelfde bibliotheekbestand dat de app al geladen
//! heeft levert dezelfde module-instantie op (het besturingssysteem telt
//! referenties), dus de bibliotheektoestand wordt gedeeld. `FPDF_InitLibrary`
//! is idempotent; `FPDF_DestroyLibrary` roepen we bewust nooit aan.
//!
//! PDFium is niet thread-safe: de aanroeper zorgt dat er tijdens een extractie
//! geen andere PDFium-aanroep in hetzelfde proces loopt.

use libloading::Library;
use std::ffi::{c_char, c_float, c_int, c_uint, c_ulong, c_ushort, c_void};
use std::path::Path;

pub type FpdfDocument = *mut c_void;
pub type FpdfPage = *mut c_void;
pub type FpdfPageObject = *mut c_void;
pub type FpdfPathSegment = *mut c_void;
pub type FpdfTextPage = *mut c_void;
pub type FpdfMark = *mut c_void;
pub type FpdfFont = *mut c_void;
pub type FpdfClipPath = *mut c_void;
pub type FpdfAnnotation = *mut c_void;
pub type FpdfBool = c_int;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct FsMatrix {
    pub a: c_float,
    pub b: c_float,
    pub c: c_float,
    pub d: c_float,
    pub e: c_float,
    pub f: c_float,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct FsRectF {
    pub left: c_float,
    pub top: c_float,
    pub right: c_float,
    pub bottom: c_float,
}

pub const PAGEOBJ_TEXT: c_int = 1;
pub const PAGEOBJ_PATH: c_int = 2;
pub const PAGEOBJ_IMAGE: c_int = 3;
pub const PAGEOBJ_SHADING: c_int = 4;
pub const PAGEOBJ_FORM: c_int = 5;

pub const SEGMENT_LINETO: c_int = 0;
pub const SEGMENT_BEZIERTO: c_int = 1;
pub const SEGMENT_MOVETO: c_int = 2;

pub const FILLMODE_NONE: c_int = 0;
pub const FILLMODE_ALTERNATE: c_int = 1;
pub const FILLMODE_WINDING: c_int = 2;

pub const OBJECT_STRING: c_int = 3;

/// `FPDFPage_Flatten`: platslaan zoals op het scherm (niet zoals bij afdrukken).
pub const FLAT_NORMALDISPLAY: c_int = 0;
pub const FLATTEN_SUCCESS: c_int = 1;

pub const ANNOT_FLAG_INVISIBLE: c_int = 1;
pub const ANNOT_FLAG_HIDDEN: c_int = 2;
pub const ANNOT_SUBTYPE_POPUP: c_int = 16;

macro_rules! pdfium_api {
    ($( fn $name:ident ( $($arg:ident : $ty:ty),* $(,)? ) $(-> $ret:ty)? ; )*) => {
        /// Functiewijzers naar de geladen bibliotheek.
        #[allow(non_snake_case)]
        pub struct PdfiumApi {
            _library: Library,
            $( pub $name: unsafe extern "C" fn($($arg: $ty),*) $(-> $ret)?, )*
        }

        impl PdfiumApi {
            fn bind(library: Library) -> Result<Self, String> {
                unsafe {
                    $(
                        #[allow(non_snake_case)]
                        let $name = *library
                            .get::<unsafe extern "C" fn($($arg: $ty),*) $(-> $ret)?>(
                                concat!(stringify!($name), "\0").as_bytes(),
                            )
                            .map_err(|e| format!("PDFium mist functie {}: {e}", stringify!($name)))?;
                    )*
                    Ok(PdfiumApi { _library: library, $($name,)* })
                }
            }
        }
    };
}

pdfium_api! {
    fn FPDF_InitLibrary();
    fn FPDF_GetLastError() -> c_ulong;
    fn FPDF_LoadMemDocument64(data: *const c_void, size: usize, password: *const c_char) -> FpdfDocument;
    fn FPDF_CloseDocument(document: FpdfDocument);
    fn FPDF_GetPageCount(document: FpdfDocument) -> c_int;
    fn FPDF_LoadPage(document: FpdfDocument, index: c_int) -> FpdfPage;
    fn FPDF_ClosePage(page: FpdfPage);
    fn FPDFPage_GetRotation(page: FpdfPage) -> c_int;
    fn FPDFPage_GetMediaBox(page: FpdfPage, left: *mut c_float, bottom: *mut c_float, right: *mut c_float, top: *mut c_float) -> FpdfBool;
    fn FPDFPage_GetCropBox(page: FpdfPage, left: *mut c_float, bottom: *mut c_float, right: *mut c_float, top: *mut c_float) -> FpdfBool;
    fn FPDF_GetPageWidthF(page: FpdfPage) -> c_float;
    fn FPDF_GetPageHeightF(page: FpdfPage) -> c_float;

    fn FPDFPage_CountObjects(page: FpdfPage) -> c_int;
    fn FPDFPage_GetObject(page: FpdfPage, index: c_int) -> FpdfPageObject;
    fn FPDFFormObj_CountObjects(form: FpdfPageObject) -> c_int;
    fn FPDFFormObj_GetObject(form: FpdfPageObject, index: c_ulong) -> FpdfPageObject;

    fn FPDFPageObj_GetType(object: FpdfPageObject) -> c_int;
    fn FPDFPageObj_GetMatrix(object: FpdfPageObject, matrix: *mut FsMatrix) -> FpdfBool;
    fn FPDFPageObj_GetBounds(object: FpdfPageObject, left: *mut c_float, bottom: *mut c_float, right: *mut c_float, top: *mut c_float) -> FpdfBool;
    fn FPDFPageObj_GetStrokeColor(object: FpdfPageObject, r: *mut c_uint, g: *mut c_uint, b: *mut c_uint, a: *mut c_uint) -> FpdfBool;
    fn FPDFPageObj_GetFillColor(object: FpdfPageObject, r: *mut c_uint, g: *mut c_uint, b: *mut c_uint, a: *mut c_uint) -> FpdfBool;
    fn FPDFPageObj_GetStrokeWidth(object: FpdfPageObject, width: *mut c_float) -> FpdfBool;
    fn FPDFPageObj_GetDashCount(object: FpdfPageObject) -> c_int;
    fn FPDFPageObj_GetDashArray(object: FpdfPageObject, dash_array: *mut c_float, dash_count: usize) -> FpdfBool;
    fn FPDFPageObj_GetDashPhase(object: FpdfPageObject, phase: *mut c_float) -> FpdfBool;

    fn FPDFPageObj_CountMarks(object: FpdfPageObject) -> c_int;
    fn FPDFPageObj_GetMark(object: FpdfPageObject, index: c_ulong) -> FpdfMark;
    fn FPDFPageObjMark_GetName(mark: FpdfMark, buffer: *mut c_ushort, buflen: c_ulong, out_buflen: *mut c_ulong) -> FpdfBool;
    fn FPDFPageObjMark_GetParamValueType(mark: FpdfMark, key: *const c_char) -> c_int;
    fn FPDFPageObjMark_GetParamStringValue(mark: FpdfMark, key: *const c_char, buffer: *mut c_ushort, buflen: c_ulong, out_buflen: *mut c_ulong) -> FpdfBool;

    fn FPDFPath_CountSegments(path: FpdfPageObject) -> c_int;
    fn FPDFPath_GetPathSegment(path: FpdfPageObject, index: c_int) -> FpdfPathSegment;
    fn FPDFPathSegment_GetPoint(segment: FpdfPathSegment, x: *mut c_float, y: *mut c_float) -> FpdfBool;
    fn FPDFPathSegment_GetType(segment: FpdfPathSegment) -> c_int;
    fn FPDFPathSegment_GetClose(segment: FpdfPathSegment) -> FpdfBool;
    fn FPDFPath_GetDrawMode(path: FpdfPageObject, fillmode: *mut c_int, stroke: *mut FpdfBool) -> FpdfBool;

    fn FPDFText_LoadPage(page: FpdfPage) -> FpdfTextPage;
    fn FPDFText_ClosePage(text_page: FpdfTextPage);
    fn FPDFText_CountChars(text_page: FpdfTextPage) -> c_int;
    fn FPDFText_GetUnicode(text_page: FpdfTextPage, index: c_int) -> c_uint;
    fn FPDFText_IsGenerated(text_page: FpdfTextPage, index: c_int) -> c_int;
    fn FPDFText_GetTextObject(text_page: FpdfTextPage, index: c_int) -> FpdfPageObject;
    fn FPDFTextObj_GetFontSize(text_object: FpdfPageObject, size: *mut c_float) -> FpdfBool;
    fn FPDFTextObj_GetTextRenderMode(text_object: FpdfPageObject) -> c_int;
    fn FPDFTextObj_GetFont(text_object: FpdfPageObject) -> FpdfFont;
    fn FPDFFont_GetBaseFontName(font: FpdfFont, buffer: *mut c_char, length: usize) -> usize;

    fn FPDFImageObj_GetImagePixelSize(image_object: FpdfPageObject, width: *mut c_uint, height: *mut c_uint) -> FpdfBool;

    fn FPDFPage_Flatten(page: FpdfPage, flag: c_int) -> c_int;
    fn FPDFPage_GetAnnotCount(page: FpdfPage) -> c_int;
    fn FPDFPage_GetAnnot(page: FpdfPage, index: c_int) -> FpdfAnnotation;
    fn FPDFPage_CloseAnnot(annot: FpdfAnnotation);
    fn FPDFAnnot_GetSubtype(annot: FpdfAnnotation) -> c_int;
    fn FPDFAnnot_GetFlags(annot: FpdfAnnotation) -> c_int;
    fn FPDFAnnot_GetRect(annot: FpdfAnnotation, rect: *mut FsRectF) -> FpdfBool;
    fn FPDFAnnot_GetStringValue(annot: FpdfAnnotation, key: *const c_char, buffer: *mut c_ushort, buflen: c_ulong) -> c_ulong;

    fn FPDFPageObj_GetClipPath(object: FpdfPageObject) -> FpdfClipPath;
    fn FPDFClipPath_CountPaths(clip_path: FpdfClipPath) -> c_int;
    fn FPDFClipPath_CountPathSegments(clip_path: FpdfClipPath, path_index: c_int) -> c_int;
    fn FPDFClipPath_GetPathSegment(clip_path: FpdfClipPath, path_index: c_int, segment_index: c_int) -> FpdfPathSegment;
}

impl PdfiumApi {
    /// Laadt de PDFium-bibliotheek op `library_path` en initialiseert haar
    /// (idempotent: in de app heeft de renderer dat al gedaan).
    pub fn load(library_path: &Path) -> Result<Self, String> {
        let library = unsafe { Library::new(library_path) }
            .map_err(|e| format!("PDFium-bibliotheek laden uit {library_path:?} mislukt: {e}"))?;
        let api = Self::bind(library)?;
        unsafe { (api.FPDF_InitLibrary)() };
        Ok(api)
    }

    /// Leest een UTF-16LE-uitvoer van PDFium waarvan de lengte in bytes wordt
    /// teruggegeven, inclusief de afsluitende nul.
    pub(crate) fn utf16_from(buffer: &[u16], byte_len: usize) -> String {
        let units = (byte_len / 2).min(buffer.len());
        let slice = &buffer[..units];
        let end = slice.iter().position(|&u| u == 0).unwrap_or(slice.len());
        String::from_utf16_lossy(&slice[..end])
    }

    /// Als [`Self::utf16_from`], maar alleen als de tekst helemaal in de buffer
    /// paste. Is de buffer te klein, dan schrijft PDFium niets en geeft ze
    /// alleen de benodigde lengte terug; wat er dan in de buffer staat, is de
    /// vorige tekst.
    pub(crate) fn utf16_if_complete(buffer: &[u16], byte_len: usize) -> Option<String> {
        (byte_len <= buffer.len() * 2).then(|| Self::utf16_from(buffer, byte_len))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_that_did_not_fit_the_buffer_is_not_the_previous_text() {
        // De buffer draagt nog "textbox" van de vorige lezing.
        let mut buffer = [0u16; 8];
        for (slot, byte) in buffer.iter_mut().zip(b"textbox") {
            *slot = u16::from(*byte);
        }
        assert_eq!(PdfiumApi::utf16_from(&buffer, 16), "textbox");
        assert_eq!(PdfiumApi::utf16_if_complete(&buffer, 16).as_deref(), Some("textbox"));
        // Een tekst van 130 tekens past niet in acht: niets, geen "textbox".
        assert_eq!(PdfiumApi::utf16_if_complete(&buffer, 262), None);
        assert_eq!(PdfiumApi::utf16_if_complete(&buffer, 17), None);
    }
}
