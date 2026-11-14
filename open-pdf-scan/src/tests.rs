//! Pariteit met js/search/symbol-matcher.js en js/pdf/form-recognition.js:
//! dezelfde invoer, dezelfde uitvoer.
//!
//! De fixtures in tests/fixtures/scan/ zijn gemaakt door
//! open-pdf-studio/scripts/bench-rust/scan-golden.mjs: binaire beelden en
//! RGBA-rasters plus wat de JS-modules ervan maakten. Alles moet gelijk zijn:
//! sjabloon, treffers in volgorde, afkapvlag, vormen in volgorde, en de
//! kommagetallen bit voor bit (de generator geeft ze als f64-bitpatroon mee
//! onder "<sleutel>#").

use crate::form::detect_form_shapes;
use crate::symbol::{binary_image, crop_template, match_symbols, Binary};
use serde_json::Value;
use std::io::Read;
use std::path::PathBuf;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("scan")
}

fn cases(kind: &str) -> Vec<Value> {
    let text = std::fs::read_to_string(dir().join("cases.json")).expect("cases.json");
    let v: Value = serde_json::from_str(&text).unwrap();
    v[kind].as_array().unwrap().clone()
}

fn inflate(file: &str) -> Vec<u8> {
    let raw = std::fs::read(dir().join(file)).unwrap_or_else(|e| panic!("{file}: {e}"));
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(&raw[..]).read_to_end(&mut out).unwrap();
    out
}

fn f64_hex(v: &Value) -> f64 {
    f64::from_bits(u64::from_str_radix(v.as_str().unwrap(), 16).unwrap())
}

fn usize_of(v: &Value) -> usize {
    v.as_u64().unwrap() as usize
}

#[test]
fn symbol_search_matches_the_js_matcher() {
    let all = cases("symbol");
    assert!(all.len() >= 15, "fixtures present");
    let mut total = 0;
    for case in &all {
        let name = case["name"].as_str().unwrap();
        let image = Binary {
            width: usize_of(&case["image"]["width"]),
            height: usize_of(&case["image"]["height"]),
            pixels: inflate(case["image"]["file"].as_str().unwrap()),
        };
        let r: Vec<f64> = case["rect#"].as_array().unwrap().iter().map(f64_hex).collect();
        let template = match crop_template(&image, (r[0], r[1], r[2], r[3])) {
            Ok(t) => t,
            Err(code) => {
                assert_eq!(case["error"].as_str(), Some(code), "{name}: crop error");
                assert!(case.get("template").is_none(), "{name}: JS did crop");
                continue;
            }
        };
        let expect = &case["template"];
        assert_eq!((template.width, template.height), (usize_of(&expect["width"]), usize_of(&expect["height"])), "{name}: template size");
        let pixels: String = template.pixels.iter().map(|&p| if p != 0 { '1' } else { '0' }).collect();
        assert_eq!(pixels, expect["pixels"].as_str().unwrap(), "{name}: template pixels");

        let rotations: Vec<f64> = case["rotations"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
        let scales: Vec<f64> = case["scales#"].as_array().unwrap().iter().map(f64_hex).collect();
        let found = crate::rotations(&rotations)
            .map_err(str::to_string)
            .and_then(|rot| match_symbols(&image, &template, f64_hex(&case["threshold#"]), &rot, &scales).map_err(str::to_string));
        let found = match found {
            Ok(f) => f,
            Err(code) => {
                assert_eq!(case["error"].as_str(), Some(code.as_str()), "{name}: match error");
                continue;
            }
        };
        assert!(case.get("error").is_none(), "{name}: JS failed with {}", case["error"]);
        let want = case["matches"].as_array().unwrap();
        assert_eq!(found.matches.len(), want.len(), "{name}: number of matches");
        assert_eq!(found.truncated, case["truncated"].as_bool().unwrap(), "{name}: truncated");
        for (i, (m, w)) in found.matches.iter().zip(want).enumerate() {
            assert_eq!(
                (m.x, m.y, m.width, m.height, m.rotation),
                (usize_of(&w["x"]), usize_of(&w["y"]), usize_of(&w["width"]), usize_of(&w["height"]), w["rotation"].as_u64().unwrap() as u32),
                "{name}: match {i}"
            );
            assert_eq!(m.score.to_bits(), f64_hex(&w["score#"]).to_bits(), "{name}: score of match {i}");
            assert_eq!(m.scale.to_bits(), f64_hex(&w["scale#"]).to_bits(), "{name}: scale of match {i}");
        }
        total += want.len();
    }
    assert!(total > 1500, "the fixtures exercise real matches ({total})");
}

#[test]
fn binary_image_matches_the_js_threshold() {
    for case in &cases("rgba") {
        let (w, h) = (usize_of(&case["width"]), usize_of(&case["height"]));
        let bin = binary_image(&inflate(case["rgba"].as_str().unwrap()), w, h, 2_000_000).unwrap();
        assert_eq!(bin.pixels, inflate(case["binary"].as_str().unwrap()), "{}", case["name"]);
    }
    assert_eq!(binary_image(&[0; 8], 1, 1, 2_000_000), Err("INVALID_IMAGE"), "wrong length");
    assert_eq!(binary_image(&[0; 16], 2, 2, 3), Err("INVALID_IMAGE"), "too large");
}

#[test]
fn form_shapes_match_the_js_detector() {
    let all = cases("form");
    assert!(all.len() >= 5, "fixtures present");
    let mut total = 0;
    for case in &all {
        let name = case["name"].as_str().unwrap();
        let (w, h) = (usize_of(&case["width"]), usize_of(&case["height"]));
        let image = binary_image(&inflate(case["rgba"].as_str().unwrap()), w, h, crate::FORM_MAX_PIXELS).unwrap();
        let shapes = detect_form_shapes(&image, f64_hex(&case["scale#"])).unwrap();
        let want = case["shapes"].as_array().unwrap();
        assert_eq!(shapes.len(), want.len(), "{name}: number of shapes");
        for (i, (s, e)) in shapes.iter().zip(want).enumerate() {
            for (got, key) in [(s.x, "x#"), (s.y, "y#"), (s.width, "width#"), (s.height, "height#")] {
                assert_eq!(got.to_bits(), f64_hex(&e[key]).to_bits(), "{name}: shape {i} {key}");
            }
            assert_eq!(s.kind.name(), e["type"].as_str().unwrap(), "{name}: shape {i} type");
            assert_eq!(s.confidence, e["confidence"].as_f64().unwrap(), "{name}: shape {i} confidence");
            assert_eq!(if s.outline { "empty-outline" } else { "writing-line" }, e["source"].as_str().unwrap(), "{name}: shape {i} source");
        }
        total += want.len();
    }
    assert!(total > 500, "the fixtures exercise real shapes ({total})");
}
