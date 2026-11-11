//! Test the actual production print modules without building the app cdylib.
//! The normal platform application build remains a separate CI requirement.
#![allow(dead_code)]

#[path = "../../../src-tauri/src/print_duplex.rs"]
mod print_duplex;
#[path = "../../../src-tauri/src/print_formulieren.rs"]
mod print_formulieren;
#[path = "../../../src-tauri/src/print_plaatsing.rs"]
mod print_plaatsing;
#[path = "../../../src-tauri/src/print_instelling.rs"]
mod print_instelling;
#[path = "../../../src-tauri/src/print_plan.rs"]
mod print_plan;
#[cfg(windows)]
#[path = "../../../src-tauri/src/print_devmode.rs"]
mod print_devmode;
