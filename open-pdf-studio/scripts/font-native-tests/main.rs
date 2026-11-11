// Compile and run the production OS catalogue function without the GUI/OCR.
#[path = "../../src-tauri/src/installed_fonts.rs"]
mod installed_fonts;

fn main() {
    let families = installed_fonts::installed_font_families().expect("OS font enumeration");
    assert!(!families.is_empty(), "OS catalogue unexpectedly empty");
    for expected in std::env::args().skip(1) {
        assert!(families.contains(&expected), "missing {expected:?} in {families:?}");
    }
    println!("{}", serde_json::to_string(&families).unwrap());
}
