//! Pariteit met de JS-route op vaste gevallen.
//!
//! `tests/fixtures/gevallen.bin` komt uit
//! `open-pdf-studio/scripts/bench-rust/beeld-golden.mjs`: per geval de invoer
//! zoals het commando die krijgt en wat de JS-route ervan maakt. Opmaak, per
//! geval: u32 LE lengte + naam, lengte + kop, lengte + body, lengte + verwacht.
//!   kop "png": body = de PNG, verwacht = "skip", of byte alfa (0/1) + RGB +
//!   (bij alfa) alfa

use crate::png_xobject::{kanalen, png_to_xobject, PngOutcome};

struct Geval {
    naam: String,
    kop: String,
    body: Vec<u8>,
    verwacht: Vec<u8>,
}

fn gevallen() -> Vec<Geval> {
    let pad = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("gevallen.bin");
    let data = std::fs::read(&pad).expect("tests/fixtures/gevallen.bin");
    let mut pos = 0usize;
    let mut deel = || {
        let n = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
        pos += 4 + n;
        data[pos - n..pos].to_vec()
    };
    let mut uit = Vec::new();
    loop {
        let naam = String::from_utf8(deel()).unwrap();
        let kop = String::from_utf8(deel()).unwrap();
        let body = deel();
        let verwacht = deel();
        uit.push(Geval { naam, kop, body, verwacht });
        if uit.last().unwrap().naam == "einde" {
            uit.pop();
            return uit;
        }
    }
}

#[test]
fn png_naar_xobject_volgt_de_js_route() {
    let mut n = 0;
    let mut overgeslagen = 0;
    for g in gevallen() {
        assert_eq!(g.kop, "png", "{}: onbekend soort geval", g.naam);
        n += 1;
        if g.verwacht == b"skip" {
            overgeslagen += 1;
            assert!(matches!(png_to_xobject(&g.body), PngOutcome::Skip(_)), "{}: hoort naar JavaScript te gaan", g.naam);
            continue;
        }
        let k = kanalen(&g.body).unwrap_or_else(|e| panic!("{}: {e}", g.naam));
        let area = k.width as usize * k.height as usize;
        let alfa = g.verwacht[0] == 1;
        assert_eq!(k.heeft_alfa, alfa, "{}: alfa", g.naam);
        assert_eq!(k.rgb, g.verwacht[1..1 + area * 3], "{}: RGB", g.naam);
        if alfa {
            assert_eq!(k.alpha, g.verwacht[1 + area * 3..], "{}: alfa-kanaal", g.naam);
        }
        // En door de hele route: de streams pakken uit tot dezelfde kanalen.
        let PngOutcome::Streams(s) = png_to_xobject(&g.body) else { panic!("{}: geen streams", g.naam) };
        assert_eq!((s.width, s.height, s.bits), (k.width, k.height, 8));
        assert_eq!(crate::inflate(&s.rgb, area * 3, area * 3 + 1).unwrap(), k.rgb, "{}: RGB-stream", g.naam);
        assert_eq!(s.alpha.is_some(), alfa);
        if let Some(a) = s.alpha {
            assert_eq!(crate::inflate(&a, area, area + 1).unwrap(), k.alpha, "{}: alfastream", g.naam);
        }
    }
    assert!(n >= 20 && overgeslagen >= 4, "te weinig PNG-gevallen: {n} ({overgeslagen} overgeslagen)");
}

#[test]
fn kapotte_invoer_gaat_naar_javascript() {
    assert!(matches!(png_to_xobject(b"geen png"), PngOutcome::Skip("not-png")));
    assert!(matches!(png_to_xobject(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), PngOutcome::Skip("invalid-png")));
    // Afgekapte Flate-stream.
    let goed = crate::deflate(&[7u8; 64], 6).unwrap();
    assert!(crate::inflate(&goed, 64, 1 << 20).is_some());
    assert!(crate::inflate(&goed[..goed.len() - 3], 64, 1 << 20).is_none());
    let mut rommel = goed.clone();
    rommel.push(0);
    assert!(crate::inflate(&rommel, 64, 1 << 20).is_none());
    assert!(crate::inflate(&goed, 64, 32).is_none());
}

#[test]
fn verdeeld_inpakken_is_een_gewone_zlib_stroom() {
    // Groottes rond de grens waarboven de invoer over draden verdeeld wordt.
    let mut toestand = 12345u32;
    let mut volgende = move || {
        toestand = toestand.wrapping_mul(1664525).wrapping_add(1013904223);
        (toestand >> 24) as u8
    };
    for lengte in [0usize, 1, 1000, (1 << 20) - 1, 2 << 20, (2 << 20) + 1, (5 << 20) + 12345, 7 << 20] {
        let data: Vec<u8> = (0..lengte).map(|i| if (i >> 12) % 3 == 0 { volgende() } else { (i >> 4) as u8 }).collect();
        for niveau in [1, 6] {
            let gepakt = crate::deflate(&data, niveau).unwrap();
            assert_eq!(gepakt[0], 0x78);
            assert_eq!(u16::from_be_bytes([gepakt[0], gepakt[1]]) % 31, 0, "kop van {lengte} op niveau {niveau}");
            // Strikt uitpakken: geen rommel erna, juiste Adler-32.
            assert_eq!(crate::inflate(&gepakt, lengte, lengte + 1).unwrap(), data, "{lengte} bytes op niveau {niveau}");
        }
    }
}

#[test]
fn grote_png_door_de_hele_route() {
    // Groot genoeg om de kleurstream verdeeld te pakken (1100 x 900 x 3 bytes).
    // De PNG komt uit de schrijver van de png-crate; de streams moeten
    // uitpakken tot de pixels waarmee die PNG gemaakt is.
    let (w, h) = (1100usize, 900usize);
    for dekkend in [false, true] {
        let mut rgba = vec![0u8; w * h * 4];
        for (i, p) in rgba.chunks_exact_mut(4).enumerate() {
            let (x, y) = (i % w, i / w);
            p.copy_from_slice(&[(x ^ y) as u8, (x * 3 + y) as u8, (i >> 7) as u8, if dekkend { 255 } else { (x + y * 5) as u8 }]);
        }
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, w as u32, h as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&rgba).unwrap();
        }
        let PngOutcome::Streams(s) = png_to_xobject(&png) else { panic!("geen streams (dekkend = {dekkend})") };
        assert_eq!((s.width as usize, s.height as usize, s.bits), (w, h, 8));
        let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
        assert_eq!(crate::inflate(&s.rgb, rgb.len(), rgb.len() + 1).unwrap(), rgb, "RGB (dekkend = {dekkend})");
        // Een alfastream alleen als ergens alfa onder 255 ligt.
        assert_eq!(s.alpha.is_some(), !dekkend);
        if let Some(a) = s.alpha {
            let alfa: Vec<u8> = rgba.chunks_exact(4).map(|p| p[3]).collect();
            assert_eq!(crate::inflate(&a, alfa.len(), alfa.len() + 1).unwrap(), alfa, "alfa");
        }
    }
}
