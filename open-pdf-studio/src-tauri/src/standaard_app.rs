//! Of Open PDF Studio de standaard-app voor .pdf is, uit het register (alleen
//! lezen). Dit gebeurde met `reg.exe query`; een extra systeemproces kort na
//! de start laat beveiligingssoftware de app afsluiten (#524).

/// De beslisregel: de ProgId noemt de app, of de open-opdracht van die ProgId
/// noemt de app of het eigen programmapad. Vergelijken zonder hoofdletters.
pub fn is_onze_pdf_app(prog_id: &str, open_opdracht: Option<&str>, eigen_exe: &str) -> bool {
    let prog = prog_id.trim().to_lowercase();
    if prog.is_empty() {
        return false;
    }
    if prog.contains("openpdfstudio") {
        return true;
    }
    let Some(opdracht) = open_opdracht else { return false };
    let opdracht = opdracht.to_lowercase();
    let exe = eigen_exe.trim().to_lowercase();
    opdracht.contains("openpdfstudio") || (!exe.is_empty() && opdracht.contains(&exe))
}

/// Leest een tekstwaarde (REG_SZ of REG_EXPAND_SZ, niet uitgevouwen, zoals
/// `reg query` hem toont). `waarde` None = de standaardwaarde van de sleutel.
#[cfg(target_os = "windows")]
pub fn lees_tekst(
    hoofd: windows_sys::Win32::System::Registry::HKEY,
    sleutel: &str,
    waarde: Option<&str>,
) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
    };

    let breed = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let sleutel_w = breed(sleutel);
    let waarde_w = waarde.map(breed);
    let waarde_ptr = waarde_w.as_ref().map_or(std::ptr::null(), |w| w.as_ptr());
    let vlaggen = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;

    // Eerst de grootte in bytes, dan de waarde zelf.
    let mut bytes: u32 = 0;
    let r = unsafe {
        RegGetValueW(hoofd, sleutel_w.as_ptr(), waarde_ptr, vlaggen,
            std::ptr::null_mut(), std::ptr::null_mut(), &mut bytes)
    };
    if r != ERROR_SUCCESS || bytes < 2 {
        return None;
    }
    let mut buf: Vec<u16> = vec![0; (bytes as usize).div_ceil(2) + 1];
    let mut bytes = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(hoofd, sleutel_w.as_ptr(), waarde_ptr, vlaggen,
            std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut bytes)
    };
    if r != ERROR_SUCCESS {
        return None;
    }
    let lengte = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..lengte]))
}

#[cfg(test)]
mod tests {
    use super::is_onze_pdf_app;

    const EXE: &str = r"C:\Program Files\Open PDF Studio\open-pdf-studio.exe";

    #[test]
    fn progid_van_de_app() {
        assert!(is_onze_pdf_app("OpenPDFStudio.pdf", None, EXE));
    }

    #[test]
    fn open_opdracht_met_het_eigen_pad() {
        let opdracht = r#""C:\Program Files\Open PDF Studio\open-pdf-studio.exe" "%1""#;
        assert!(is_onze_pdf_app("Applications\\open-pdf-studio.exe", Some(opdracht), EXE));
    }

    #[test]
    fn een_andere_app() {
        let opdracht = r#""C:\Program Files\Andere Lezer\lezer.exe" "%1""#;
        assert!(!is_onze_pdf_app("AndereLezer.Document", Some(opdracht), EXE));
        assert!(!is_onze_pdf_app("AndereLezer.Document", None, EXE));
        assert!(!is_onze_pdf_app("", Some(r#"open-pdf-studio.exe"#), EXE));
    }
}
