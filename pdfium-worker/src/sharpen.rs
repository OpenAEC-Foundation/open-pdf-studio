//! Lichte verscherping van een vers gerenderd paginabeeld: regel voor regel
//! uit sharpenRgba() in open-pdf-studio/js/pdf/render-sharpen.js (3 x 3
//! onscherp masker: bron + sterkte * (bron - vervaagd); alfa en de rand van
//! één pixel blijven zoals ze zijn). Op dezelfde pixels dezelfde uitkomst,
//! byte voor byte (tests met fixtures uit scripts/bench-rust/sharpen-golden.mjs).
//!
//! In JavaScript draaide dit op de interface-thread bij elk paginabeeld en
//! elke tegel (~21 ms per megapixel), en zo lang reageerde het venster niet.
//! De app-crate neemt dit bestand over met `#[path]` (zoals render_budget.rs)
//! en verscherpt het beeld vóór het naar de WebView gaat, op een paar threads.

/// `rgba`: breedte x hoogte x 4 bytes, ter plekke aangepast. Niets bij een
/// sterkte van 0 of minder, een beeld smaller of lager dan 3, of te weinig
/// bytes (dezelfde voorwaarden als de JS-functie).
pub fn sharpen_rgba(rgba: &mut [u8], width: usize, height: usize, amount: f64) {
    if !(amount > 0.0) || width < 3 || height < 3 || rgba.len() < width * height * 4 {
        return;
    }
    let src = rgba[..width * height * 4].to_vec();
    let row = width * 4;
    // De rijen 1..hoogte-1 hangen alleen van de kopie af: verdeel ze.
    let inner = &mut rgba[row..(height - 1) * row];
    let threads = std::thread::available_parallelism().map(|v| v.get()).unwrap_or(1).clamp(1, 8).min(height - 2);
    let rows_per = (height - 2).div_ceil(threads);
    std::thread::scope(|scope| {
        for (c, part) in inner.chunks_mut(rows_per * row).enumerate() {
            let src = &src;
            scope.spawn(move || {
                for (r, out) in part.chunks_mut(row).enumerate() {
                    let y = 1 + c * rows_per + r;
                    for x in 1..width - 1 {
                        for ch in 0..3 {
                            let k = y * row + x * 4 + ch;
                            let px = |i: usize| f64::from(src[i]);
                            let blur = (px(k - row - 4) + 2.0 * px(k - row) + px(k - row + 4)
                                + 2.0 * (px(k - 4) + 2.0 * px(k) + px(k + 4))
                                + px(k + row - 4) + 2.0 * px(k + row) + px(k + row + 4))
                                / 16.0;
                            // Toekennen aan een Uint8ClampedArray: begrenzen
                            // op 0..255 en afronden, halven naar even.
                            out[x * 4 + ch] = (px(k) + amount * (px(k) - blur)).clamp(0.0, 255.0).round_ties_even() as u8;
                        }
                    }
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::sharpen_rgba;
    use std::io::Read;

    fn fixture(name: &str) -> Vec<u8> {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("sharpen").join(name);
        let raw = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let mut out = Vec::new();
        flate2::read::ZlibDecoder::new(&raw[..]).read_to_end(&mut out).unwrap();
        out
    }

    /// Dezelfde bytes als sharpenRgba() voor elke sterkte uit SHARPEN_LEVELS.
    #[test]
    fn matches_the_js_filter_byte_for_byte() {
        let cases: serde_json::Value = serde_json::from_slice(&fixture("cases.json.z")).unwrap();
        let cases = cases.as_array().unwrap();
        assert!(cases.len() >= 8, "fixtures present");
        for case in cases {
            let (w, h) = (case["width"].as_u64().unwrap() as usize, case["height"].as_u64().unwrap() as usize);
            let amount = f64::from_bits(u64::from_str_radix(case["amount#"].as_str().unwrap(), 16).unwrap());
            let mut px = fixture(case["source"].as_str().unwrap());
            sharpen_rgba(&mut px, w, h, amount);
            let want = fixture(case["result"].as_str().unwrap());
            let first = px.iter().zip(&want).position(|(a, b)| a != b);
            assert_eq!(first, None, "{}: first difference at byte {:?}", case["name"], first);
        }
    }

    #[test]
    fn leaves_alpha_the_border_and_degenerate_input_alone() {
        let (w, h) = (5usize, 4usize);
        let src: Vec<u8> = (0..w * h * 4).map(|i| (i * 37 % 251) as u8).collect();
        let mut px = src.clone();
        sharpen_rgba(&mut px, w, h, 1.2);
        assert_ne!(px, src, "the inside changes");
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                assert_eq!(px[i + 3], src[i + 3], "alpha at {x},{y}");
                if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                    assert_eq!(&px[i..i + 3], &src[i..i + 3], "border pixel {x},{y}");
                }
            }
        }
        for (w, h, amount, len) in [(5, 4, 0.0, 80), (5, 4, -1.0, 80), (5, 4, f64::NAN, 80), (2, 4, 0.5, 32), (5, 2, 0.5, 40), (5, 4, 0.5, 79)] {
            let before: Vec<u8> = (0..len).map(|i| (i * 13) as u8).collect();
            let mut px = before.clone();
            sharpen_rgba(&mut px, w, h, amount);
            assert_eq!(px, before, "{w}x{h} amount {amount} len {len}");
        }
    }

    /// Een beeld van één binnenrij en een hoog smal beeld: de verdeling over
    /// threads mag geen rij overslaan of dubbel doen.
    #[test]
    fn every_inner_row_is_processed_once() {
        for (w, h) in [(7usize, 3usize), (3, 40), (64, 9)] {
            let src: Vec<u8> = (0..w * h * 4).map(|i| ((i * 97 + i / 7) % 256) as u8).collect();
            let mut par = src.clone();
            sharpen_rgba(&mut par, w, h, 0.5);
            // Dezelfde rekenregel, één rij tegelijk, zonder threads.
            let mut seq = src.clone();
            let row = w * 4;
            for y in 1..h - 1 {
                for x in 1..w - 1 {
                    for ch in 0..3 {
                        let k = y * row + x * 4 + ch;
                        let p = |i: usize| f64::from(src[i]);
                        let blur = (p(k - row - 4) + 2.0 * p(k - row) + p(k - row + 4) + 2.0 * (p(k - 4) + 2.0 * p(k) + p(k + 4)) + p(k + row - 4) + 2.0 * p(k + row) + p(k + row + 4)) / 16.0;
                        seq[k] = (p(k) + 0.5 * (p(k) - blur)).clamp(0.0, 255.0).round_ties_even() as u8;
                    }
                }
            }
            assert_eq!(par, seq, "{w}x{h}");
        }
    }
}
