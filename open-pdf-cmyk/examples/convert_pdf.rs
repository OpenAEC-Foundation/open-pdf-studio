//! Zet een PDF om naar CMYK met een drukprofiel, buiten de app.
//!
//! ```text
//! cargo run -p open-pdf-cmyk --example convert_pdf --release -- in.pdf uit.pdf profiel.icc [perceptual]
//! ```
//!
//! Schrijft de omgezette PDF (zonder output-intent; die voegt de app toe) en
//! drukt het verslag als JSON af. Het invoerbestand wordt alleen gelezen.

use open_pdf_cmyk::{convert_with_profile, RenderingIntent};
use std::path::Path;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("gebruik: convert_pdf <in.pdf> <uit.pdf> <profiel.icc> [relative|perceptual]");
        std::process::exit(2);
    }
    let (input, output, profile) = (&args[1], &args[2], &args[3]);
    if Path::new(input) == Path::new(output) {
        eprintln!("invoer en uitvoer moeten verschillen");
        std::process::exit(2);
    }
    let intent = RenderingIntent::from_code(args.get(4).map(String::as_str).unwrap_or("relative"));
    let pdf = std::fs::read(input).expect("invoer lezen");
    let start = Instant::now();
    match convert_with_profile(&pdf, Path::new(profile), intent, &mut |_, _| {}) {
        Ok(c) => {
            let ms = start.elapsed().as_millis();
            std::fs::write(output, &c.pdf).expect("uitvoer schrijven");
            let json = serde_json::json!({
                "profileName": c.profile_name,
                "milliseconds": ms,
                "inputBytes": pdf.len(),
                "outputBytes": c.pdf.len(),
                "report": c.report,
            });
            println!("{}", serde_json::to_string_pretty(&json).unwrap());
        }
        Err(e) => {
            eprintln!("mislukt: {} ({e})", e.code());
            std::process::exit(1);
        }
    }
}
