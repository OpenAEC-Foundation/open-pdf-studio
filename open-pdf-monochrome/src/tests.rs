use super::*;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::Write;

fn stride(w: usize) -> usize {
    w.div_ceil(8)
}

fn bitmap(width: usize, height: usize, pixel: impl Fn(usize, usize) -> bool) -> Vec<u8> {
    let mut out = vec![0u8; stride(width) * height];
    for y in 0..height {
        for x in 0..width {
            if pixel(x, y) {
                out[y * stride(width) + (x >> 3)] |= 128 >> (x & 7);
            }
        }
    }
    out
}

// Zelfde LCG als ccitt-g4.test.mjs (s * 1664525 + 1013904223, / 2^32).
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        self.0 as f64 / 4294967296.0
    }
}

// textLike() uit ccitt-g4.test.mjs.
fn text_like(width: usize, height: usize, seed: u32) -> Vec<u8> {
    let mut r = Rng(seed);
    let mut out = vec![0u8; stride(width) * height];
    for y in 0..height {
        if (y % 24) > 14 {
            continue;
        }
        let mut x = (r.next() * 12.0).floor() as usize;
        while x < width {
            let black = 1 + (r.next() * 6.0).floor() as usize;
            // JS evalueert eerst de linkeroperand van `*`, dan de keuze.
            let f = r.next();
            let range = if r.next() < 0.1 { 60.0 } else { 9.0 };
            let white = 1 + (f * range).floor() as usize;
            for i in x..width.min(x + black) {
                out[y * stride(width) + (i >> 3)] |= 128 >> (i & 7);
            }
            x += black + white;
        }
    }
    out
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

// Lengte en FNV-1a-64 van de JS-encoder (js/pdf/ccitt-g4.js) op dezelfde
// bitmaps; opnieuw te maken met scripts/bench-rust/09-monochrome.mjs --golden.
const GOLDEN: &[(&str, bool, usize, u64)] = &[
    ("all_white", false, 7, 0x5219944d6757d7f8),
    ("all_white", true, 15, 0x50e8d704080549a1),
    ("all_black", false, 15, 0x50e8d704080549a1),
    ("all_black", true, 7, 0x5219944d6757d7f8),
    ("all_white_odd", false, 4, 0x09c8866ce85e8b91),
    ("all_white_odd", true, 7, 0x0ff3cb7569b7bbcc),
    ("all_black_odd", false, 7, 0x0ff3cb7569b7bbcc),
    ("all_black_odd", true, 4, 0x09c8866ce85e8b91),
    ("single_pixel", false, 4, 0x42d1ae1a89b0e76a),
    ("single_pixel", true, 4, 0x052f22aa916b8d9d),
    ("single_column", false, 19, 0x89bcb857e5d97ba5),
    ("single_column", true, 17, 0x79608fa446f3de52),
    ("checkerboard", false, 1559, 0x69d6c23cdb4fb191),
    ("checkerboard", true, 1559, 0x214e19aba7c6436c),
    ("checkerboard_odd", false, 418, 0xdee01f0840ad982c),
    ("checkerboard_odd", true, 417, 0x599996b7f01309d9),
    ("coarse_checkerboard", false, 576, 0xe9d1c7647aeb8e29),
    ("coarse_checkerboard", true, 575, 0x15fd54a176bb503c),
    ("vertical_stripes", false, 126, 0x319a496971c14cec),
    ("vertical_stripes", true, 129, 0x017ea57548baeac5),
    ("diagonals", false, 745, 0x15b193c461e17d36),
    ("diagonals", true, 729, 0x65bee03b436b0865),
    ("shifting_edges", false, 439, 0xc65e79452ecf94b1),
    ("shifting_edges", true, 436, 0x6add15e3280fb0e9),
    ("random_noise", false, 1244, 0x7f173231813e5d28),
    ("random_noise", true, 1244, 0xaaf02b4af0ca1cf2),
    ("text_1001x133_1", false, 11656, 0xd145005081a58f2f),
    ("text_1001x133_1", true, 11120, 0xa5dc91fe15ea7423),
    ("text_2479x61_2", false, 14081, 0x40b5484186070c8c),
    ("text_2479x61_2", true, 13479, 0x227c86fa65875388),
    ("text_9x300_3", false, 284, 0xab9fbd81a6dc7967),
    ("text_9x300_3", true, 256, 0x7abcc50c4a7259d5),
    ("text_517x517_4", false, 22952, 0xfe8ebd6695929be6),
    ("text_517x517_4", true, 22045, 0x990e69090b7be946),
];

fn case(label: &str) -> (usize, usize, Vec<u8>) {
    let b = |w, h, f: &dyn Fn(usize, usize) -> bool| (w, h, bitmap(w, h, f));
    match label {
        "all_white" => b(64, 32, &|_, _| true),
        "all_black" => b(64, 32, &|_, _| false),
        "all_white_odd" => b(13, 7, &|_, _| true),
        "all_black_odd" => b(13, 7, &|_, _| false),
        "single_pixel" => b(1, 1, &|_, _| false),
        "single_column" => b(1, 41, &|_, y| y % 3 == 0),
        "checkerboard" => b(64, 64, &|x, y| (x + y) & 1 == 1),
        "checkerboard_odd" => b(37, 29, &|x, y| (x + y) & 1 == 1),
        "coarse_checkerboard" => b(203, 97, &|x, y| ((x >> 3) + (y >> 3)) & 1 == 1),
        "vertical_stripes" => b(100, 30, &|x, _| (x % 7) < 3),
        "diagonals" => b(150, 150, &|x, y| ((x + 600 - y) % 40) < 6 || ((x + y) % 50) < 2),
        "shifting_edges" => b(120, 140, &|x, y| {
            let (x, y) = (x as i64, y as i64);
            x >= 20 + ((y * 37) % 7) - 3 && x < 90 + ((y * 11) % 7) - 3
        }),
        "random_noise" => {
            let mut r = Rng(7);
            let bits: Vec<bool> = (0..77 * 61).map(|_| r.next() < 0.5).collect();
            b(77, 61, &|x, y| bits[y * 77 + x])
        }
        _ => {
            let parts: Vec<&str> = label.trim_start_matches("text_").split(['x', '_']).collect();
            let (w, h, seed) = (parts[0].parse().unwrap(), parts[1].parse().unwrap(), parts[2].parse().unwrap());
            (w, h, text_like(w, h, seed))
        }
    }
}

#[test]
fn g4_is_byte_identical_to_the_js_encoder() {
    for &(label, black_is1, len, hash) in GOLDEN {
        let (w, h, samples) = case(label);
        let out = encode_ccitt_g4(&samples, w, h, black_is1, None).unwrap();
        assert_eq!((out.len(), fnv(&out)), (len, hash), "{label} BlackIs1={black_is1}");
    }
}

#[test]
fn g4_padding_limit_and_arguments() {
    let (w, h) = (11, 5);
    let clean = bitmap(w, h, |x, y| (x * y) % 3 == 0);
    let dirty: Vec<u8> = clean.iter().enumerate().map(|(i, &v)| if i % 2 == 1 { v | 0x1f } else { v }).collect();
    assert_eq!(encode_ccitt_g4(&clean, w, h, false, None), encode_ccitt_g4(&dirty, w, h, false, None));
    let (_, _, noise) = case("random_noise");
    assert_eq!(encode_ccitt_g4(&noise, 77, 61, false, Some(16)), Err(G4Error::OutputLimit));
    // Precies op de grens past nog; één byte minder niet.
    let full = encode_ccitt_g4(&noise, 77, 61, false, None).unwrap();
    assert_eq!(encode_ccitt_g4(&noise, 77, 61, false, Some(full.len())).unwrap(), full);
    assert_eq!(encode_ccitt_g4(&noise, 77, 61, false, Some(full.len() - 1)), Err(G4Error::OutputLimit));
    assert_eq!(encode_ccitt_g4(&[0u8; 3], 64, 64, false, None), Err(G4Error::InvalidArguments));
    assert_eq!(encode_ccitt_g4(&noise, 0, 61, false, None), Err(G4Error::InvalidArguments));
}

fn zlib(data: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

fn inflate_all(data: &[u8]) -> Vec<u8> {
    let mut d = flate2::read::ZlibDecoder::new(data);
    let mut out = Vec::new();
    std::io::Read::read_to_end(&mut d, &mut out).unwrap();
    out
}

fn params(width: usize, height: usize, bits: u8, channels: u8, flate_source: bool, input_len: usize) -> Params {
    let decoded_size = (width * channels as usize * bits as usize).div_ceil(8) * height;
    Params {
        width, height, bits, channels, flate_source, decoded_size,
        output_cap: input_len + 1024, ccitt_fits: true, black_is1: false, decode_ok: true,
        before: u64::MAX, flate_base: 100, ccitt_base: 160,
    }
}

#[test]
fn packs_gray_and_rgb_and_keeps_the_samples() {
    let (w, h) = (37, 29);
    let bits = bitmap(w, h, |x, y| (x * 7 + y * 3) % 5 < 2);
    let gray: Vec<u8> = (0..h).flat_map(|y| (0..w).map(move |x| (y, x))).map(|(y, x)| {
        if bits[y * stride(w) + (x >> 3)] & (128 >> (x & 7)) != 0 { 255 } else { 0 }
    }).collect();
    let rgb: Vec<u8> = gray.iter().flat_map(|&v| [v, v, v]).collect();
    assert_eq!(pack_bilevel(&gray, w, h, 1).unwrap(), bits);
    assert_eq!(pack_bilevel(&rgb, w, h, 3).unwrap(), bits);
    for (src, ch) in [(gray.clone(), 1u8), (rgb.clone(), 3u8)] {
        let input = zlib(&src);
        let p = params(w, h, 8, ch, true, input.len());
        match optimize(&input, &p) {
            Outcome::Encoded { filter, data, .. } => match filter {
                Filter::Flate => assert_eq!(inflate_all(&data), bits),
                Filter::Ccitt => assert_eq!(data, encode_ccitt_g4(&bits, w, h, false, None).unwrap()),
            },
            other => panic!("{other:?}"),
        }
    }
    let mut grayish = gray.clone();
    grayish[5] = 128;
    assert_eq!(optimize(&grayish, &params(w, h, 8, 1, false, grayish.len())), Outcome::Skip("not-black-and-white"));
    let mut tinted = rgb.clone();
    tinted[3 * 4 + 1] = if tinted[3 * 4] == 0 { 255 } else { 0 };
    assert_eq!(optimize(&tinted, &params(w, h, 8, 3, false, tinted.len())), Outcome::Skip("not-black-and-white"));
    let mut bad = params(w, h, 8, 1, false, gray.len());
    bad.decode_ok = false;
    assert_eq!(optimize(&gray, &bad), Outcome::Skip("unsupported-decode"));
}

#[test]
fn flate_source_errors_match_the_decompression_stream() {
    let (w, h) = (64, 8);
    let bits = bitmap(w, h, |x, y| (x + y) % 3 == 0);
    let input = zlib(&bits);
    let p = params(w, h, 1, 1, true, input.len());
    let mut junk = input.clone();
    junk.extend_from_slice(b"\n\n");
    assert_eq!(optimize(&junk, &p), Outcome::Skip("invalid-image-data"));
    assert_eq!(optimize(&input[..input.len() - 3], &p), Outcome::Skip("invalid-image-data"));
    assert_eq!(optimize(b"not zlib at all", &p), Outcome::Skip("invalid-image-data"));
    let longer = zlib(&[bits.clone(), vec![0u8; 8]].concat());
    assert_eq!(optimize(&longer, &p), Outcome::Skip("decoded-or-output-limit"));
    let shorter = zlib(&bits[..bits.len() - 1]);
    assert_eq!(optimize(&shorter, &p), Outcome::Skip("invalid-sample-length"));
    assert_eq!(optimize(&bits[1..], &params(w, h, 1, 1, false, bits.len())), Outcome::Skip("invalid-sample-length"));
}

#[test]
fn chooses_the_smallest_complete_stream_with_flate_on_ties() {
    // Randen die per rij willekeurig een paar kolommen verschuiven: G4
    // (verticaalmodus) wint ruim van Flate.
    let (w, h) = (1203, 701);
    let mut r = Rng(3);
    let mut edges = [40i64, 300, 700, 1100];
    let rows: Vec<[i64; 4]> = (0..h).map(|_| {
        for e in edges.iter_mut() { *e += (r.next() * 5.0).floor() as i64 - 2; }
        edges
    }).collect();
    let samples = bitmap(w, h, |x, y| {
        let (x, e) = (x as i64, rows[y]);
        (x >= e[0] && x < e[1]) || (x >= e[2] && x < e[3])
    });
    let input = samples.clone();
    let mut p = params(w, h, 1, 1, false, input.len());
    let g4 = encode_ccitt_g4(&samples, w, h, false, None).unwrap();
    let flate = deflate(&samples, p.output_cap).unwrap();
    assert!(g4.len() < flate.len());
    match optimize(&input, &p) {
        Outcome::Encoded { filter, data, flate_len, ccitt_len } => {
            assert_eq!(filter, Filter::Ccitt);
            assert_eq!(data, g4);
            assert_eq!((flate_len, ccitt_len), (Some(flate.len()), Some(g4.len())));
        }
        other => panic!("{other:?}"),
    }
    // Een duurdere CCITT-kop die het verschil precies opheft: Flate wint.
    p.ccitt_base = stream_size(p.flate_base, flate.len()) - (g4.len() as u64) - digits(g4.len()) + 1;
    assert_eq!(stream_size(p.ccitt_base, g4.len()), stream_size(p.flate_base, flate.len()));
    assert!(matches!(optimize(&input, &p), Outcome::Encoded { filter: Filter::Flate, .. }));
    // Niet kleiner dan het origineel: overslaan.
    p.before = stream_size(p.flate_base, flate.len());
    assert_eq!(optimize(&input, &p), Outcome::Skip("not-smaller"));
    // Zonder CCITT-budget beslist Flate alleen.
    let mut q = params(w, h, 1, 1, false, input.len());
    q.ccitt_fits = false;
    assert!(matches!(optimize(&input, &q), Outcome::Encoded { filter: Filter::Flate, ccitt_len: None, .. }));
    // Geen van beide past binnen het plafond.
    q.output_cap = 10;
    assert_eq!(optimize(&input, &q), Outcome::Skip("decoded-or-output-limit"));
}
