//! Pariteit met js/compare/*: dezelfde invoer, dezelfde uitvoer.
//!
//! De fixtures in tests/fixtures/compare/ zijn gemaakt door
//! open-pdf-studio/scripts/bench-rust/compare-golden.mjs: inktmaskers (en een
//! RGBA-tegel) plus wat de JS-modules ervan maakten. Alles moet bit voor bit
//! gelijk zijn: gehele getallen (soort, pixelgrenzen, pixelCount, runs,
//! componenten, inktmaskers) en ook de kommagetallen (old-rechthoek,
//! uitlijning, betrouwbaarheid), die de generator naast het JSON-getal als
//! f64-bitpatroon ("<sleutel>#") meegeeft. Invoermatrices en -maten gaan ook
//! als bitpatroon mee, zodat het JSON-inlezen niets afrondt.

use super::align::{estimate_alignment, AlignOptions};
use super::detect::{detect_mask_changes, DetectOptions};
use super::ink::{estimate_background, write_ink_tile, Mask, Rgb, BGRA, RGBA};
use super::matrix::{Matrix, Size};
use serde_json::Value;
use std::io::Read;
use std::path::PathBuf;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("compare")
}

fn cases() -> Vec<Value> {
    let text = std::fs::read_to_string(dir().join("cases.json")).expect("cases.json");
    let v: Value = serde_json::from_str(&text).unwrap();
    v["cases"].as_array().unwrap().clone()
}

fn inflate(file: &str) -> Vec<u8> {
    let raw = std::fs::read(dir().join(file)).unwrap_or_else(|e| panic!("{file}: {e}"));
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(&raw[..]).read_to_end(&mut out).unwrap();
    out
}

fn mask(v: &Value) -> Mask {
    let (w, h, s) = (v["width"].as_u64().unwrap() as usize, v["height"].as_u64().unwrap() as usize, v["stride"].as_u64().unwrap() as usize);
    Mask::from_bytes(w, h, s, &inflate(v["file"].as_str().unwrap()))
}

fn f64_hex(v: &Value) -> f64 {
    f64::from_bits(u64::from_str_radix(v.as_str().unwrap(), 16).unwrap())
}

fn matrix(v: &Value) -> Option<Matrix> {
    let a = v.as_array()?;
    let mut m = [0.0; 6];
    for (i, x) in a.iter().enumerate() {
        m[i] = f64_hex(x);
    }
    Some(m)
}

/// Een getal uit de fixture: het bitpatroon onder "<key>#" als het er is
/// (kommagetallen), anders het JSON-getal (gehele getallen, exact).
fn num(obj: &Value, key: &str) -> f64 {
    match obj.get(format!("{key}#")) {
        Some(bits) => f64_hex(bits),
        None => obj[key].as_f64().unwrap_or_else(|| panic!("missing {key} in {obj}")),
    }
}

fn size(v: &Value) -> Size {
    Size { width: num(v, "width"), height: num(v, "height") }
}

/// Bit voor bit gelijk (NaN telt als gelijk aan NaN).
fn same(a: f64, obj: &Value, key: &str, what: &str, checked: &mut usize) {
    let b = num(obj, key);
    *checked += 1;
    assert!(a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan()), "{what}.{key}: rust {a:e} vs js {b:e}");
}

#[test]
fn detection_matches_js_on_every_fixture() {
    let mut checked = 0;
    let mut floats = 0;
    for c in cases() {
        let Some(detects) = c["detects"].as_array() else { continue };
        let old = mask(&c["old"]);
        let new = mask(&c["new"]);
        for d in detects {
            let what = format!("{} / {}", c["name"], d["preset"]);
            let opts: DetectOptions = serde_json::from_value(d["params"].clone()).unwrap();
            let t = matrix(&d["transform"]);
            let got = detect_mask_changes(&old, &new, t.as_ref(), &opts);
            let want = &d["expected"];
            assert_eq!(got.runs as u64, want["runs"].as_u64().unwrap(), "{what}: runs");
            assert_eq!(got.components as u64, want["components"].as_u64().unwrap(), "{what}: components");
            assert_eq!(got.truncated, want["truncated"].as_bool().unwrap(), "{what}: truncated");
            let wc = want["clusters"].as_array().unwrap();
            assert_eq!(got.clusters.len(), wc.len(), "{what}: cluster count");
            for (g, w) in got.clusters.iter().zip(wc) {
                assert_eq!(g.kind.name(), w["type"].as_str().unwrap(), "{what}: type");
                assert_eq!(
                    (g.x, g.y, g.width, g.height, g.pixel_count),
                    (
                        w["x"].as_i64().unwrap(),
                        w["y"].as_i64().unwrap(),
                        w["width"].as_i64().unwrap(),
                        w["height"].as_i64().unwrap(),
                        w["pixelCount"].as_i64().unwrap()
                    ),
                    "{what}: cluster"
                );
                for (k, v) in [("x", g.old.x), ("y", g.old.y), ("width", g.old.width), ("height", g.old.height)] {
                    same(v, &w["old"], k, &format!("{what}: old"), &mut floats);
                }
            }
            checked += 1;
        }
    }
    eprintln!("detection fixtures: {checked}, {floats} floats bit-identical");
    assert!(checked >= 13, "only {checked} detection fixtures");
}

#[test]
fn alignment_matches_js_on_every_fixture() {
    let mut checked = 0;
    let mut floats = 0;
    for c in cases() {
        if c["align"].is_null() {
            continue;
        }
        let a = &c["align"];
        let what = c["name"].to_string();
        let old = mask(&c["old"]);
        let new = mask(&c["new"]);
        let got = estimate_alignment(
            &old,
            &new,
            &AlignOptions {
                px_per_pt: f64_hex(&a["px_per_pt"]),
                old_size: size(&a["old_size"]),
                new_size: size(&a["new_size"]),
                measure_ratio: a["measure_ratio"].as_f64(),
                rotation_range: None,
            },
        );
        let w = &a["expected"];
        assert_eq!(got.method, w["method"].as_str().unwrap(), "{what}: method");
        let ga = got.alignment;
        for (k, v) in [("dx", ga.dx), ("dy", ga.dy), ("rotation", ga.rotation), ("scale", ga.scale)] {
            same(v, &w["alignment"], k, &format!("{what}: alignment"), &mut floats);
        }
        same(got.confidence, w, "confidence", &what, &mut floats);
        same(got.identity_confidence, w, "identityConfidence", &what, &mut floats);
        checked += 1;
    }
    eprintln!("alignment fixtures: {checked}, {floats} floats bit-identical");
    assert!(checked >= 5, "only {checked} alignment fixtures");
}

#[test]
fn ink_masks_and_background_match_js() {
    let c = cases().into_iter().find(|c| c["name"] == "ink").expect("ink case");
    let (w, h) = (c["rgba"]["width"].as_u64().unwrap() as usize, c["rgba"]["height"].as_u64().unwrap() as usize);
    let rgba = inflate(c["rgba"]["file"].as_str().unwrap());
    let rgb = |v: &Value| Rgb { r: v["r"].as_u64().unwrap() as u8, g: v["g"].as_u64().unwrap() as u8, b: v["b"].as_u64().unwrap() as u8 };
    let bg = rgb(&c["background"]);
    assert_eq!(estimate_background(&rgba, RGBA, w, h, 250_000.0), bg);
    assert_eq!(estimate_background(&rgba, RGBA, w, h, 5000.0), rgb(&c["background_small"]));
    // Hetzelfde beeld als BGRA (zoals PDFium het levert) geeft hetzelfde masker.
    let mut bgra = rgba.clone();
    for p in bgra.chunks_mut(4) {
        p.swap(0, 2);
    }
    for m in c["masks"].as_array().unwrap() {
        let threshold = m["threshold"].as_f64().unwrap();
        let use_bg = if m["bg"].is_null() { bg } else { rgb(&m["bg"]) };
        let want = mask(&m["mask"]);
        let mut got = Mask::new(w, h);
        let ink = write_ink_tile(&mut got, &rgba, RGBA, w, h, 0, 0, use_bg, threshold);
        assert_eq!(ink, m["ink"].as_u64().unwrap(), "ink count at {threshold}");
        assert!(got.bytes() == want.bytes(), "mask at {threshold}");
        let mut got2 = Mask::new(w, h);
        write_ink_tile(&mut got2, &bgra, BGRA, w, h, 0, 0, use_bg, threshold);
        assert!(got2.bytes() == want.bytes(), "BGRA mask at {threshold}");
    }
}
