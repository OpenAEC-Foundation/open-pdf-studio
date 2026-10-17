//! Pagina 1 tekenen met PDFium, binnen een tijdslimiet.
//!
//! PDFium leest het bestand zelf in blokken via de `Bron` (de IStream van de
//! shell), dus ook een tekening van honderden MB wordt niet in zijn geheel
//! ingelezen. Het tekenen gaat progressief: PDFium vraagt regelmatig of hij
//! moet pauzeren, en na de tijdslimiet breken we af. Na de limiet faalt ook
//! het lezen van blokken, zodat ontleden niet eindeloos doorgaat.

use std::ffi::{c_int, c_uchar, c_ulong, c_void};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::fout::{fout_bij_openen, stroomlengte, Fout};
use crate::maat::doelmaat;
use crate::pdfium::{
    pdfium, FpdfFileAccess, IfsdkPause, FPDFBITMAP_BGRA, FPDF_ANNOT, FPDF_RENDER_DONE,
    FPDF_RENDER_TOBECONTINUED,
};

/// Hoe lang één miniatuur mag duren, inclusief wachten op een andere.
pub const TIJDSLIMIET: Duration = Duration::from_secs(15);

/// PDFium is niet thread-safe; de shell kan meerdere miniaturen tegelijk
/// vragen vanuit verschillende STA-threads.
static SLOT: Mutex<()> = Mutex::new(());

/// Leest bytes van het bestand. Wordt alleen op de aanroepende thread
/// gebruikt (de IStream hoort bij het apartment van de shell).
pub trait Bron {
    /// Leest precies `buf.len()` bytes vanaf `positie`; `false` bij een fout.
    fn lees(&self, positie: u64, buf: &mut [u8]) -> bool;
}

pub struct Beeld {
    pub breedte: u32,
    pub hoogte: u32,
    /// BGRA, rij voor rij van boven naar onder, `breedte * 4` bytes per rij.
    pub pixels: Vec<u8>,
}

struct Lezer<'a> {
    bron: &'a dyn Bron,
    deadline: Instant,
}

unsafe extern "C" fn lees_blok(
    param: *mut c_void,
    positie: c_ulong,
    buf: *mut c_uchar,
    grootte: c_ulong,
) -> c_int {
    let gelukt = catch_unwind(AssertUnwindSafe(|| {
        if param.is_null() || buf.is_null() {
            return false;
        }
        let lezer = unsafe { &*(param as *const Lezer) };
        if Instant::now() >= lezer.deadline {
            return false;
        }
        let doel = unsafe { std::slice::from_raw_parts_mut(buf, grootte as usize) };
        lezer.bron.lees(positie as u64, doel)
    }));
    matches!(gelukt, Ok(true)) as c_int
}

unsafe extern "C" fn moet_pauzeren(this: *mut IfsdkPause) -> c_int {
    let te_laat = catch_unwind(AssertUnwindSafe(|| {
        if this.is_null() {
            return true;
        }
        let deadline = unsafe { &*((*this).user as *const Instant) };
        Instant::now() >= *deadline
    }));
    te_laat.unwrap_or(true) as c_int
}

/// Ruimt een PDFium-handvat op bij het verlaten van de functie, ook bij een fout.
struct Opruimen<F: FnMut()>(F);
impl<F: FnMut()> Drop for Opruimen<F> {
    fn drop(&mut self) {
        (self.0)()
    }
}

fn neem_slot(deadline: Instant) -> Result<std::sync::MutexGuard<'static, ()>, Fout> {
    loop {
        match SLOT.try_lock() {
            Ok(g) => return Ok(g),
            // Een eerdere paniek (opgevangen) liet het slot vergiftigd achter;
            // het bewaakt geen gegevens, dus gewoon doorgaan.
            Err(std::sync::TryLockError::Poisoned(p)) => return Ok(p.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err(Fout::Tijd);
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
}

/// Tekent pagina 1 van een PDF van `lengte` bytes met `cx` pixels voor de
/// langste zijde, ondoorzichtig op wit.
pub fn teken_eerste_pagina(
    bron: &dyn Bron,
    lengte: u64,
    cx: u32,
    deadline: Instant,
) -> Result<Beeld, Fout> {
    let lengte = stroomlengte(lengte)?;
    if cx == 0 {
        return Err(Fout::Paginamaat);
    }
    let pd = pdfium().map_err(Fout::GeenPdfium)?;
    let _slot = neem_slot(deadline)?;

    let lezer = Lezer { bron, deadline };
    let mut toegang = FpdfFileAccess {
        m_file_len: lengte as c_ulong,
        m_get_block: Some(lees_blok),
        m_param: &lezer as *const Lezer as *mut c_void,
    };

    // Geen wachtwoord: een PDF die er een vraagt om te openen krijgt geen
    // miniatuur (alleen een eigenaarswachtwoord opent gewoon, zoals in elke viewer).
    let doc = unsafe { (pd.load_custom_document)(&mut toegang, std::ptr::null()) };
    if doc.is_null() {
        let code = unsafe { (pd.get_last_error)() } as u32;
        return Err(fout_bij_openen(code, Instant::now() >= deadline));
    }
    let _doc = Opruimen(|| unsafe { (pd.close_document)(doc) });

    if unsafe { (pd.get_page_count)(doc) } < 1 {
        return Err(Fout::GeenPaginas);
    }
    let pagina = unsafe { (pd.load_page)(doc, 0) };
    if pagina.is_null() {
        let code = unsafe { (pd.get_last_error)() } as u32;
        return Err(fout_bij_openen(code, Instant::now() >= deadline));
    }
    let _pagina = Opruimen(|| unsafe { (pd.close_page)(pagina) });

    // De getoonde maat: PDFium ruilt breedte en hoogte zelf bij /Rotate 90/270,
    // en tekent met rotatie 0 de pagina zoals hij bedoeld is.
    let (b_pt, h_pt) = unsafe {
        (
            (pd.get_page_width_f)(pagina),
            (pd.get_page_height_f)(pagina),
        )
    };
    let (b, h) = doelmaat(b_pt, h_pt, cx).ok_or(Fout::Paginamaat)?;

    let rij = b as usize * 4;
    let mut pixels: Vec<u8> = Vec::new();
    pixels
        .try_reserve_exact(rij * h as usize)
        .map_err(|_| Fout::Geheugen)?;
    pixels.resize(rij * h as usize, 0);

    let bitmap = unsafe {
        (pd.bitmap_create_ex)(
            b as c_int,
            h as c_int,
            FPDFBITMAP_BGRA,
            pixels.as_mut_ptr().cast(),
            rij as c_int,
        )
    };
    if bitmap.is_null() {
        return Err(Fout::Geheugen);
    }
    let _bitmap = Opruimen(|| unsafe { (pd.bitmap_destroy)(bitmap) });
    unsafe { (pd.bitmap_fill_rect)(bitmap, 0, 0, b as c_int, h as c_int, 0xFFFF_FFFF) };

    let mut deadline_kopie = deadline;
    let mut pauze = IfsdkPause {
        version: 1,
        need_to_pause_now: Some(moet_pauzeren),
        user: &mut deadline_kopie as *mut Instant as *mut c_void,
    };
    let mut status = unsafe {
        (pd.render_start)(
            bitmap, pagina, 0, 0, b as c_int, h as c_int, 0, FPDF_ANNOT, &mut pauze,
        )
    };
    while status == FPDF_RENDER_TOBECONTINUED {
        if Instant::now() >= deadline {
            unsafe { (pd.render_close)(pagina) };
            return Err(Fout::Tijd);
        }
        status = unsafe { (pd.render_continue)(pagina, &mut pauze) };
    }
    unsafe { (pd.render_close)(pagina) };
    if status != FPDF_RENDER_DONE {
        return Err(Fout::Tekenen);
    }

    // Papier is ondoorzichtig: alfa overal 255, wat PDFium er ook van maakte.
    for px in pixels.chunks_exact_mut(4) {
        px[3] = 255;
    }
    Ok(Beeld {
        breedte: b,
        hoogte: h,
        pixels,
    })
}
