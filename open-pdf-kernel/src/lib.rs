//! Rust kernel for Open PDF Studio.
//!
//! Phase 1 of the Rust migration (see `docs/rust-migratie-plan.md`): the
//! annotation model, a display list shared by screen and PDF output, and a
//! rasterizer. The crate has no Tauri dependency; the app talks to it through
//! thin commands.
pub mod dl;
pub mod model;
pub mod pdfrender;
pub mod raster;
