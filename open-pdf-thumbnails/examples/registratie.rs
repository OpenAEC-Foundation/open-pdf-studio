//! Ontwikkelhulp: de Verkenner-miniaturen voor de huidige gebruiker aan- of
//! uitzetten met precies de code die de app gebruikt, zonder de app te starten.
//!
//! ```text
//! cargo run -p open-pdf-thumbnails --example registratie -- status
//! cargo run -p open-pdf-thumbnails --example registratie -- aan <pad\naar\open-pdf-thumbnails.dll> [--vervang]
//! cargo run -p open-pdf-thumbnails --example registratie -- uit
//! ```
//!
//! Schrijft alleen onder HKCU\Software\Classes (zie src/registratie.rs).

#[cfg(windows)]
fn main() {
    use open_pdf_thumbnails::registratie::{self, win32};

    let args: Vec<String> = std::env::args().skip(1).collect();
    let bestaat = |p: &str| std::path::Path::new(p).is_file();
    let mut reg = win32::Win32Register::echt();
    let uitkomst = match args.first().map(String::as_str) {
        Some("status") => Ok(()),
        Some("aan") => match args.get(1) {
            Some(dll) => {
                let r = registratie::zet_aan(
                    &mut reg,
                    dll,
                    args.iter().any(|a| a == "--vervang"),
                    &bestaat,
                );
                win32::meld_shell();
                r
            }
            None => {
                eprintln!("aan: pad naar de DLL ontbreekt");
                std::process::exit(2);
            }
        },
        Some("uit") => {
            let r = registratie::zet_uit(&mut reg);
            win32::meld_shell();
            r
        }
        _ => {
            eprintln!("gebruik: registratie status | aan <dll> [--vervang] | uit");
            std::process::exit(2);
        }
    };
    if let Err(e) = &uitkomst {
        eprintln!("fout: {e}");
    }
    let progid = win32::standaard_progid();
    println!("standaard-app (UserChoice): {:?}", progid);
    println!(
        "{:#?}",
        registratie::status(&reg, progid.as_deref(), &bestaat)
    );
    if uitkomst.is_err() {
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("alleen Windows");
}
