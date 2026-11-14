// Compile production embedding code independently of Tauri/OCR.
#[path = "../../src-tauri/src/systeem_lettertypen_core.rs"]
mod core;
fn main() {
    let mut args = std::env::args().skip(1);
    let family = args.next().expect("family");
    let output = args.next().expect("output font path");
    let font = core::zoek(&family, false, false);
    assert!(font.insluitbaar, "not embeddable: {font:?}");
    let bytes = core::lees(font.pad.as_ref().unwrap(), font.gezicht).unwrap();
    std::fs::write(output, bytes).unwrap();
    println!("{}", serde_json::to_string(&font).unwrap());
}
