// Compile the production transport without linking Tauri, OCR or the PDF engine.
#[path = "../../../src-tauri/src/central_review_transport.rs"]
pub mod transport;

// The production file access of the folder review (#1115), so its tests run
// natively on every platform, and the document lock for the Windows sharing
// measurements in sharing.rs.
#[allow(dead_code)]
#[path = "../../../src-tauri/src/atomic_file.rs"]
mod atomic_file;
#[cfg(windows)]
#[allow(dead_code)]
#[path = "../../../src-tauri/src/bestand_openen.rs"]
mod bestand_openen;

#[cfg(all(test, windows))]
mod sharing;
