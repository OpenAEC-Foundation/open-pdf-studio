//! De COM-kant: IInitializeWithStream + IThumbnailProvider, de class factory
//! en de DLL-exports die de shell aanroept.
//!
//! Elke ingang vangt een paniek op en geeft dan een fout-HRESULT: een paniek
//! die de COM-grens over gaat, beëindigt het proces van de shell. De shell
//! laadt de handler standaard in een apart surrogaatproces (dllhost.exe),
//! niet in Verkenner zelf; DisableProcessIsolation zetten we bewust niet.

use std::cell::RefCell;
use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Instant;

use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_POINTER, S_FALSE,
};
use windows::Win32::Graphics::Gdi::{
    CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Com::{
    IClassFactory, IClassFactory_Impl, IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_END,
    STREAM_SEEK_SET,
};
use windows::Win32::UI::Shell::PropertiesSystem::{
    IInitializeWithStream, IInitializeWithStream_Impl,
};
use windows::Win32::UI::Shell::{
    IThumbnailProvider, IThumbnailProvider_Impl, WTSAT_ARGB, WTS_ALPHATYPE,
};
use windows_core::{implement, IUnknown, Interface, Ref, BOOL, GUID, HRESULT};

use crate::fout::{self, Fout};
use crate::registratie::CLSID_WAARDE;
use crate::render::{teken_eerste_pagina, Beeld, Bron, TIJDSLIMIET};

pub fn clsid() -> GUID {
    GUID::from_u128(CLSID_WAARDE)
}

fn hr(code: i32) -> windows_core::Error {
    windows_core::Error::from_hresult(HRESULT(code))
}

/// Voert `f` uit; een paniek wordt E_UNEXPECTED in plaats van een gecrasht proces.
fn bewaakt<T>(f: impl FnOnce() -> windows_core::Result<T>) -> windows_core::Result<T> {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| Err(hr(Fout::Paniek.hresult())))
}

// ---------------------------------------------------------------------------
// De miniatuur
// ---------------------------------------------------------------------------

#[implement(IInitializeWithStream, IThumbnailProvider)]
struct Miniatuur {
    stroom: RefCell<Option<IStream>>,
}

impl IInitializeWithStream_Impl for Miniatuur_Impl {
    fn Initialize(&self, pstream: Ref<'_, IStream>, _grfmode: u32) -> windows_core::Result<()> {
        bewaakt(|| {
            let stroom = pstream.ok()?.clone();
            let mut plek = self.stroom.borrow_mut();
            if plek.is_some() {
                return Err(hr(fout::E_ALREADY_INITIALIZED));
            }
            *plek = Some(stroom);
            Ok(())
        })
    }
}

impl IThumbnailProvider_Impl for Miniatuur_Impl {
    fn GetThumbnail(
        &self,
        cx: u32,
        phbmp: *mut HBITMAP,
        pdwalpha: *mut WTS_ALPHATYPE,
    ) -> windows_core::Result<()> {
        bewaakt(|| {
            if phbmp.is_null() || pdwalpha.is_null() {
                return Err(E_POINTER.into());
            }
            unsafe {
                *phbmp = HBITMAP::default();
            }
            if cx == 0 {
                return Err(hr(fout::E_INVALIDARG));
            }
            let stroom = self
                .stroom
                .borrow()
                .clone()
                .ok_or_else(|| hr(fout::E_NOT_READY))?;
            let deadline = Instant::now() + TIJDSLIMIET;
            let bron = StroomBron { stroom };
            let lengte = bron
                .lengte()
                .ok_or_else(|| hr(Fout::OngeldigeLengte.hresult()))?;
            let beeld =
                teken_eerste_pagina(&bron, lengte, cx, deadline).map_err(|f| hr(f.hresult()))?;
            let bitmap = maak_hbitmap(&beeld)?;
            unsafe {
                *phbmp = bitmap;
                *pdwalpha = WTSAT_ARGB;
            }
            Ok(())
        })
    }
}

/// De IStream van de shell als `Bron`. Alleen lezen; de positie van de stroom
/// zetten we telkens zelf.
struct StroomBron {
    stroom: IStream,
}

impl StroomBron {
    fn lengte(&self) -> Option<u64> {
        let mut stat = STATSTG::default();
        if unsafe { self.stroom.Stat(&mut stat, STATFLAG_NONAME) }.is_ok() && stat.cbSize > 0 {
            return Some(stat.cbSize);
        }
        let mut eind = 0u64;
        unsafe { self.stroom.Seek(0, STREAM_SEEK_END, Some(&mut eind)) }.ok()?;
        Some(eind)
    }
}

impl Bron for StroomBron {
    fn lees(&self, positie: u64, buf: &mut [u8]) -> bool {
        let Ok(positie) = i64::try_from(positie) else {
            return false;
        };
        if unsafe { self.stroom.Seek(positie, STREAM_SEEK_SET, None) }.is_err() {
            return false;
        }
        let mut gelezen_totaal = 0usize;
        while gelezen_totaal < buf.len() {
            let rest = &mut buf[gelezen_totaal..];
            let stuk = rest.len().min(u32::MAX as usize) as u32;
            let mut gelezen = 0u32;
            let r = unsafe {
                self.stroom
                    .Read(rest.as_mut_ptr().cast(), stuk, Some(&mut gelezen))
            };
            if r.is_err() || gelezen == 0 {
                return false;
            }
            gelezen_totaal += gelezen as usize;
        }
        true
    }
}

/// Een 32-bits top-down DIB-sectie met de pixels (BGRA, zoals PDFium ze geeft).
fn maak_hbitmap(beeld: &Beeld) -> windows_core::Result<HBITMAP> {
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: beeld.breedte as i32,
            // Negatief: de eerste rij is de bovenste.
            biHeight: -(beeld.hoogte as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let bitmap = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0) }?;
    if bits.is_null() {
        unsafe {
            let _ = DeleteObject(bitmap.into());
        }
        return Err(hr(fout::E_OUTOFMEMORY));
    }
    unsafe {
        std::ptr::copy_nonoverlapping(beeld.pixels.as_ptr(), bits as *mut u8, beeld.pixels.len());
    }
    Ok(bitmap)
}

// ---------------------------------------------------------------------------
// Class factory en exports
// ---------------------------------------------------------------------------

#[implement(IClassFactory)]
struct Fabriek;

impl IClassFactory_Impl for Fabriek_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<'_, IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> windows_core::Result<()> {
        bewaakt(|| {
            if ppvobject.is_null() || riid.is_null() {
                return Err(E_POINTER.into());
            }
            unsafe { *ppvobject = std::ptr::null_mut() };
            if punkouter.is_some() {
                return Err(CLASS_E_NOAGGREGATION.into());
            }
            let object: IUnknown = Miniatuur {
                stroom: RefCell::new(None),
            }
            .into();
            unsafe { object.query(riid, ppvobject) }.ok()
        })
    }

    fn LockServer(&self, _flock: BOOL) -> windows_core::Result<()> {
        Ok(())
    }
}

/// # Safety
/// Aangeroepen door COM met geldige wijzers.
#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    let r = catch_unwind(AssertUnwindSafe(|| {
        if rclsid.is_null() || riid.is_null() || ppv.is_null() {
            return E_POINTER;
        }
        unsafe { *ppv = std::ptr::null_mut() };
        if unsafe { *rclsid } != clsid() {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let fabriek: IClassFactory = Fabriek.into();
        unsafe { fabriek.query(riid, ppv) }
    }));
    r.unwrap_or(HRESULT(fout::E_UNEXPECTED))
}

/// Nooit ontladen: pdfium.dll blijft geladen en geïnitialiseerd zolang het
/// (surrogaat)proces leeft; ontladen en opnieuw laden zou PDFium half
/// opgeruimd achterlaten. De shell sluit het surrogaat zelf na een tijdje.
#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}
