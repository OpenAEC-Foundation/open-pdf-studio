//! Meet- en pariteitshulp voor scripts/bench-rust/09-monochrome.mjs.
//!
//!   cargo run --release -p open-pdf-monochrome --example mono_cli -- <map> [herhalingen]
//!
//! Elke opdracht in <map> is een paar `<naam>.job` (één regel tekst) +
//! `<naam>.bin` (de ruwe streambytes of gepakte samples). Regelvormen:
//!   opt <width> <height> <bits> <channels> <flateSource> <decodedSize> <outputCap>
//!       <ccittFits> <blackIs1> <decodeOk> <before> <flateBase> <ccittBase>
//!   g4 <width> <height> <blackIs1>
//! Schrijft `<naam>.out` (opt: dezelfde opmaak als het Tauri-commando
//! `monochroom_beeld`; g4: de G4-bytes) en per opdracht een regel
//! `<naam> <mediaan-ns>` op stdout.

use open_pdf_monochrome::{encode_ccitt_g4, optimize, Filter, Outcome, Params};
use std::time::Instant;

fn lengte(n: Option<usize>) -> [u8; 4] {
    n.map(|n| n as u32).unwrap_or(u32::MAX).to_le_bytes()
}

fn respons(o: Outcome) -> Vec<u8> {
    match o {
        Outcome::Skip(r) => [&[0u8][..], r.as_bytes()].concat(),
        Outcome::Encoded { filter, data, flate_len, ccitt_len } => {
            let mut out = vec![if filter == Filter::Flate { 1 } else { 2 }];
            out.extend_from_slice(&lengte(flate_len));
            out.extend_from_slice(&lengte(ccitt_len));
            out.extend_from_slice(&data);
            out
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = std::path::PathBuf::from(args.get(1).expect("map met opdrachten"));
    let repeat: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(5);
    let mut jobs: Vec<_> = std::fs::read_dir(&dir).unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "job"))
        .collect();
    jobs.sort();
    for job in jobs {
        let naam = job.file_stem().unwrap().to_string_lossy().to_string();
        let regel = std::fs::read_to_string(&job).unwrap();
        let v: Vec<&str> = regel.split_whitespace().collect();
        let input = std::fs::read(job.with_extension("bin")).unwrap();
        let n = |i: usize| -> u64 { v[i].parse().unwrap() };
        let b = |i: usize| v[i] == "1" || v[i] == "true";
        let run: Box<dyn Fn() -> Vec<u8>> = match v[0] {
            "opt" => {
                let p = Params {
                    width: n(1) as usize, height: n(2) as usize, bits: n(3) as u8, channels: n(4) as u8,
                    flate_source: b(5), decoded_size: n(6) as usize, output_cap: n(7) as usize,
                    ccitt_fits: b(8), black_is1: b(9), decode_ok: b(10),
                    before: n(11), flate_base: n(12), ccitt_base: n(13),
                };
                let input = input.clone();
                Box::new(move || respons(optimize(&input, &p)))
            }
            "g4" => {
                let (w, h, black) = (n(1) as usize, n(2) as usize, b(3));
                let input = input.clone();
                Box::new(move || encode_ccitt_g4(&input, w, h, black, None).expect("g4"))
            }
            other => panic!("onbekende opdracht {other}"),
        };
        let mut tijden = Vec::with_capacity(repeat);
        let mut uit = Vec::new();
        for _ in 0..repeat.max(1) {
            let t = Instant::now();
            uit = run();
            tijden.push(t.elapsed().as_nanos());
        }
        tijden.sort();
        std::fs::write(job.with_extension("out"), &uit).unwrap();
        println!("{naam} {}", tijden[tijden.len() / 2]);
    }
}
