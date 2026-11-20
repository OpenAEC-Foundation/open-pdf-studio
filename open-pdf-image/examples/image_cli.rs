//! Meet- en pariteitshulp voor scripts/bench-rust/12-beeld.mjs.
//!
//!   cargo run --release -p open-pdf-image --example image_cli -- <map> [herhalingen]
//!
//! Elke opdracht in <map> is een paar `<naam>.job` (één regel tekst) +
//! `<naam>.bin` (de body van het commando). Regelvormen:
//!   png            body = de PNG
//! Schrijft `<naam>.out` (het antwoord van het commando) en per opdracht een
//! regel `<naam> <mediaan-ns>` op stdout.

use open_pdf_image::png_xobject;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = std::path::PathBuf::from(args.get(1).expect("map met opdrachten"));
    let repeat: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(3);
    let mut jobs: Vec<_> = std::fs::read_dir(&dir).unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "job"))
        .collect();
    jobs.sort();
    for job in jobs {
        let naam = job.file_stem().unwrap().to_string_lossy().to_string();
        let regel = std::fs::read_to_string(&job).unwrap();
        let soort = regel.trim();
        let input = std::fs::read(job.with_extension("bin")).unwrap();
        let mut tijden = Vec::with_capacity(repeat);
        let mut uit = Vec::new();
        for _ in 0..repeat.max(1) {
            let t = Instant::now();
            uit = match soort {
                "png" => png_xobject::response(png_xobject::png_to_xobject(&input)),
                other => panic!("onbekende opdracht {other}"),
            };
            tijden.push(t.elapsed().as_nanos());
        }
        tijden.sort();
        std::fs::write(job.with_extension("out"), &uit).unwrap();
        println!("{naam} {}", tijden[tijden.len() / 2]);
    }
}
