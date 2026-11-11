//! Exercise the production DEVMODE code without linking every app unit test.
//! The full lib-test binary also retains OCR test code, whose bundled native
//! libraries currently fail to link with the Windows static CRT. The normal
//! application build remains a separate required CI step.
#![cfg(windows)]
#![allow(dead_code)]

#[path = "../src/print_duplex.rs"]
mod print_duplex;
#[path = "../src/print_formulieren.rs"]
mod print_formulieren;
#[path = "../src/print_plaatsing.rs"]
mod print_plaatsing;
#[path = "../src/print_instelling.rs"]
mod print_instelling;
#[path = "../src/print_plan.rs"]
mod print_plan;
#[path = "../src/print_devmode.rs"]
mod print_devmode;
