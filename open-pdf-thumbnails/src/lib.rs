//! Miniaturen van PDF-bestanden in Windows Verkenner (#605).
//!
//! Een shell-miniatuurhandler: een in-process COM-server die de shell laadt
//! (in zijn surrogaatproces) met een IStream van het bestand, en die pagina 1
//! met PDFium tekent op de gevraagde maat. Registratie gebeurt per gebruiker
//! door de app (Voorkeuren), zie `registratie`.
//!
//! De pure delen (maat, fouten, registerplan) bouwen en testen op elk
//! platform; de COM-server zelf alleen op Windows.

pub mod fout;
pub mod maat;
pub mod registratie;

#[cfg(windows)]
mod com;
#[cfg(windows)]
mod pdfium;
#[cfg(windows)]
mod render;
