//! Ontsleutelen van een PDF met een openingswachtwoord (src/beveiligde_pdf.rs)
//! tegen de echte PDFium-bibliotheek.
//!
//! Fixture: tests/fixtures/beveiligd/wachtwoord-geheim.pdf, AES-256,
//! gebruikerswachtwoord `geheim`, eigenaarswachtwoord `eigenaar`.
//!
//! De bibliotheek komt uit OPEN_PDF_STUDIO_TEST_DLL_DIR of anders uit
//! binaries/<platform> van deze crate. Ontbreekt hij, dan slaat de test over
//! (zoals pdfium_smoke.rs).

use std::path::PathBuf;
use std::sync::Arc;

use app_lib::beveiligde_pdf::{ontsleutel, schrijf_werkkopie, OntsleutelFout};
use app_lib::pdfium_renderer::{init_pdfium, bibliotheek_pad, PdfiumDocumentHandle};

fn fixture() -> Vec<u8> {
    let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/beveiligd/wachtwoord-geheim.pdf");
    std::fs::read(pad).expect("fixture")
}

fn bibliotheekmap() -> Option<PathBuf> {
    if let Ok(map) = std::env::var("OPEN_PDF_STUDIO_TEST_DLL_DIR") {
        return Some(PathBuf::from(map));
    }
    let basis = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let map = if cfg!(all(windows, target_arch = "x86_64")) {
        basis.join("win-x64")
    } else if cfg!(all(windows, target_arch = "aarch64")) {
        basis.join("win-arm64")
    } else if cfg!(target_os = "linux") {
        basis.join("linux-x64")
    } else {
        basis.join("macos-universal")
    };
    map.exists().then_some(map)
}

#[test]
fn ontsleutelt_met_het_juiste_wachtwoord_en_weigert_een_verkeerd() {
    let Some(map) = bibliotheekmap() else {
        eprintln!("Skipping: no PDFium library (set OPEN_PDF_STUDIO_TEST_DLL_DIR)");
        return;
    };
    init_pdfium(&map).expect("init_pdfium");
    let bibliotheek = bibliotheek_pad().expect("library path after init");
    let versleuteld = fixture();

    // Zonder of met een verkeerd wachtwoord: de eigen foutcode.
    assert_eq!(ontsleutel(&bibliotheek, &versleuteld, ""), Err(OntsleutelFout::VerkeerdWachtwoord));
    assert_eq!(ontsleutel(&bibliotheek, &versleuteld, "fout"), Err(OntsleutelFout::VerkeerdWachtwoord));
    assert_eq!(
        ontsleutel(&bibliotheek, &versleuteld, "geheim\0x"),
        Err(OntsleutelFout::VerkeerdWachtwoord),
    );

    // Het versleutelde origineel laat zich zonder wachtwoord niet openen ...
    assert!(PdfiumDocumentHandle::load_from_bytes(Arc::new(versleuteld.clone())).is_err());

    // ... de kopie wel, en ze heeft dezelfde pagina en tekst.
    let geopend = ontsleutel(&bibliotheek, &versleuteld, "geheim").expect("decrypt");
    // Met het gebruikerswachtwoord: geen eigenaarsrechten.
    assert!(!geopend.eigenaar);
    let schoon = geopend.bytes;
    assert!(schoon.starts_with(b"%PDF"));
    let handle = PdfiumDocumentHandle::load_from_bytes(Arc::new(schoon.clone())).expect("unprotected copy opens");
    let doc = handle.document();
    assert_eq!(doc.pages().len(), 1);
    let tekst = doc.pages().get(0).unwrap().text().unwrap().all();
    assert!(tekst.contains("Protected test document"), "text: {tekst}");

    // Ook het eigenaarswachtwoord opent het document.
    assert!(ontsleutel(&bibliotheek, &versleuteld, "eigenaar").expect("owner password").eigenaar);

    // De werkkopie komt op schijf in de opgegeven map.
    let werkmap = std::env::temp_dir().join(format!("opds-beveiligd-itest-{}", std::process::id()));
    let kopie = schrijf_werkkopie(&werkmap, &schoon).expect("write copy");
    assert_eq!(std::fs::read(&kopie).unwrap(), schoon);
    let _ = std::fs::remove_dir_all(&werkmap);
}
