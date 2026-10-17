//! De paar PDFium-functies die de miniatuur nodig heeft, rechtstreeks uit
//! pdfium.dll (dezelfde DLL die de app en de pdfium-worker gebruiken).
//!
//! pdfium.dll wordt geladen vanaf de map van DEZE DLL, met een volledig pad en
//! zonder het zoekpad van het proces: de shell laadt ons in een surrogaat-
//! proces (dllhost.exe) waarvan de huidige map en PATH niet van ons zijn.

use std::ffi::{c_int, c_uchar, c_ulong, c_void};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub type FpdfDocument = *mut c_void;
pub type FpdfPage = *mut c_void;
pub type FpdfBitmap = *mut c_void;

/// `FPDF_FILEACCESS` uit fpdfview.h. `unsigned long` is op Windows 32 bits.
#[repr(C)]
pub struct FpdfFileAccess {
    pub m_file_len: c_ulong,
    pub m_get_block: Option<
        unsafe extern "C" fn(
            param: *mut c_void,
            position: c_ulong,
            buf: *mut c_uchar,
            size: c_ulong,
        ) -> c_int,
    >,
    pub m_param: *mut c_void,
}

/// `IFSDK_PAUSE` uit fpdf_progressive.h.
#[repr(C)]
pub struct IfsdkPause {
    pub version: c_int,
    pub need_to_pause_now: Option<unsafe extern "C" fn(this: *mut IfsdkPause) -> c_int>,
    pub user: *mut c_void,
}

pub const FPDF_ANNOT: c_int = 0x01;
pub const FPDFBITMAP_BGRA: c_int = 4;
pub const FPDF_RENDER_TOBECONTINUED: c_int = 1;
pub const FPDF_RENDER_DONE: c_int = 2;

pub struct Pdfium {
    // Houdt de DLL geladen zolang het proces leeft (de functiewijzers hieronder
    // wijzen erin). Wordt nooit vrijgegeven: zie DllCanUnloadNow.
    _bibliotheek: libloading::Library,
    pub load_custom_document: unsafe extern "C" fn(*mut FpdfFileAccess, *const i8) -> FpdfDocument,
    pub close_document: unsafe extern "C" fn(FpdfDocument),
    pub get_last_error: unsafe extern "C" fn() -> c_ulong,
    pub get_page_count: unsafe extern "C" fn(FpdfDocument) -> c_int,
    pub load_page: unsafe extern "C" fn(FpdfDocument, c_int) -> FpdfPage,
    pub close_page: unsafe extern "C" fn(FpdfPage),
    pub get_page_width_f: unsafe extern "C" fn(FpdfPage) -> f32,
    pub get_page_height_f: unsafe extern "C" fn(FpdfPage) -> f32,
    pub bitmap_create_ex:
        unsafe extern "C" fn(c_int, c_int, c_int, *mut c_void, c_int) -> FpdfBitmap,
    pub bitmap_fill_rect:
        unsafe extern "C" fn(FpdfBitmap, c_int, c_int, c_int, c_int, c_ulong) -> c_int,
    pub bitmap_destroy: unsafe extern "C" fn(FpdfBitmap),
    pub render_start: unsafe extern "C" fn(
        FpdfBitmap,
        FpdfPage,
        c_int,
        c_int,
        c_int,
        c_int,
        c_int,
        c_int,
        *mut IfsdkPause,
    ) -> c_int,
    pub render_continue: unsafe extern "C" fn(FpdfPage, *mut IfsdkPause) -> c_int,
    pub render_close: unsafe extern "C" fn(FpdfPage),
}

// De functiewijzers zijn gewone adressen in een DLL die nooit wordt
// vrijgegeven; gebruik gaat altijd onder het slot in render.rs.
unsafe impl Send for Pdfium {}
unsafe impl Sync for Pdfium {}

static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

/// PDFium, eenmalig geladen en geïnitialiseerd. Een mislukte poging blijft
/// mislukt (geen herhaalpogingen in een proces van de shell).
pub fn pdfium() -> Result<&'static Pdfium, String> {
    PDFIUM
        .get_or_init(|| {
            let map = eigen_map().ok_or_else(|| "eigen map onbekend".to_string())?;
            laad(&map.join("pdfium.dll"))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

fn laad(pad: &Path) -> Result<Pdfium, String> {
    use libloading::os::windows::{
        Library, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    // Alleen de map van pdfium.dll zelf en System32 voor zijn afhankelijkheden.
    let bibliotheek: libloading::Library = unsafe {
        Library::load_with_flags(
            pad,
            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
        )
    }
    .map_err(|e| format!("pdfium.dll niet geladen: {e}"))?
    .into();

    macro_rules! functie {
        ($naam:literal) => {
            *unsafe { bibliotheek.get(concat!($naam, "\0").as_bytes()) }
                .map_err(|e| format!("{} ontbreekt: {e}", $naam))?
        };
    }

    let init: unsafe extern "C" fn() = functie!("FPDF_InitLibrary");
    let pdfium = Pdfium {
        load_custom_document: functie!("FPDF_LoadCustomDocument"),
        close_document: functie!("FPDF_CloseDocument"),
        get_last_error: functie!("FPDF_GetLastError"),
        get_page_count: functie!("FPDF_GetPageCount"),
        load_page: functie!("FPDF_LoadPage"),
        close_page: functie!("FPDF_ClosePage"),
        get_page_width_f: functie!("FPDF_GetPageWidthF"),
        get_page_height_f: functie!("FPDF_GetPageHeightF"),
        bitmap_create_ex: functie!("FPDFBitmap_CreateEx"),
        bitmap_fill_rect: functie!("FPDFBitmap_FillRect"),
        bitmap_destroy: functie!("FPDFBitmap_Destroy"),
        render_start: functie!("FPDF_RenderPageBitmap_Start"),
        render_continue: functie!("FPDF_RenderPage_Continue"),
        render_close: functie!("FPDF_RenderPage_Close"),
        _bibliotheek: bibliotheek,
    };
    // Eén keer per proces; PDFium negeert een tweede aanroep zelf ook.
    unsafe { init() };
    Ok(pdfium)
}

/// De map waar deze DLL staat (niet die van het proces dat ons laadt).
pub fn eigen_map() -> Option<PathBuf> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::System::LibraryLoader::{
        GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
        GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    };
    static ANKER: u8 = 0;
    let mut module = HMODULE::default();
    unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(&ANKER as *const u8 as *const u16),
            &mut module,
        )
        .ok()?;
    }
    let mut buf = vec![0u16; 32_768];
    let lengte = unsafe { GetModuleFileNameW(Some(module), &mut buf) } as usize;
    if lengte == 0 || lengte >= buf.len() {
        return None;
    }
    let pad = PathBuf::from(String::from_utf16_lossy(&buf[..lengte]));
    pad.parent().map(Path::to_path_buf)
}
