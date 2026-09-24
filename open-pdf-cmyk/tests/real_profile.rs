//! Omzetting met een echt CMYK-drukprofiel van deze machine.
//!
//! Op Windows staat er standaard een SWOP-profiel (`RSWOP.icm`) in de
//! systeemmap; elders wordt het eerste gevonden CMYK-drukprofiel gebruikt.
//! Staat er geen, dan slaat de test zich over met een melding.

use lopdf::{dictionary, Document, Object, Stream};
use open_pdf_cmyk::lcms::{LcmsTransform, RenderingIntent};
use open_pdf_cmyk::profiles::{find_profiles, system_profile_dirs};
use open_pdf_cmyk::transform::CmykTransform;
use open_pdf_cmyk::{convert_with_profile, pack_response};
use std::path::PathBuf;

fn real_profile() -> Option<PathBuf> {
    let dirs = system_profile_dirs();
    if cfg!(windows) {
        let swop = dirs[0].join("RSWOP.icm");
        if swop.exists() {
            return Some(swop);
        }
    }
    find_profiles(&dirs).into_iter().next().map(|p| PathBuf::from(p.path))
}

macro_rules! profile_or_skip {
    () => {
        match real_profile() {
            Some(p) => p,
            None => {
                eprintln!("overgeslagen: geen CMYK-drukprofiel op deze machine");
                return;
            }
        }
    };
}

#[test]
fn real_profile_gives_plausible_cmyk() {
    let path = profile_or_skip!();
    let bytes = std::fs::read(&path).unwrap();
    for intent in [RenderingIntent::RelativeColorimetricBpc, RenderingIntent::Perceptual] {
        let t = LcmsTransform::new(&bytes, intent).unwrap();
        // Papierwit blijft onbedrukt: geen zweem over elk wit vlak.
        let white = t.rgb_to_cmyk([1.0, 1.0, 1.0]);
        assert_eq!(white, [0.0; 4], "wit {white:?}");
        let black = t.rgb_to_cmyk([0.0, 0.0, 0.0]);
        assert!(black[3] > 0.6, "zwart {black:?}");
        let red = t.rgb_to_cmyk([1.0, 0.0, 0.0]);
        assert!(red[1] > 0.8 && red[2] > 0.8 && red[0] < 0.15, "rood {red:?}");

        // Het pixelpad (8 bits) en het kleurpad (double) komen overeen.
        let rgb = [255u8, 0, 0, 255, 255, 255, 0, 0, 0, 30, 120, 200];
        let mut cmyk = [0u8; 16];
        t.rgb8_to_cmyk8(&rgb, &mut cmyk);
        for (px, chunk) in rgb.chunks(3).zip(cmyk.chunks(4)) {
            let one = t.rgb_to_cmyk([px[0] as f32 / 255.0, px[1] as f32 / 255.0, px[2] as f32 / 255.0]);
            for (a, b) in chunk.iter().zip(one) {
                assert!((*a as f32 - b * 255.0).abs() <= 3.0, "{chunk:?} vs {one:?}");
            }
        }
    }
}

#[test]
fn embedded_srgb_source_profile_is_accepted() {
    let path = profile_or_skip!();
    let t = LcmsTransform::new(&std::fs::read(&path).unwrap(), RenderingIntent::RelativeColorimetricBpc).unwrap();
    let srgb = lcms2::Profile::new_srgb().icc().unwrap();
    let own = t.with_source_profile(&srgb).expect("een RGB-profiel is een bruikbare bron");
    let a = own.rgb_to_cmyk([0.2, 0.5, 0.8]);
    let b = t.rgb_to_cmyk([0.2, 0.5, 0.8]);
    for (x, y) in a.iter().zip(b) {
        assert!((x - y).abs() < 0.01, "{a:?} vs {b:?}");
    }
    // Een CMYK-profiel is geen RGB-bron.
    assert!(t.with_source_profile(&std::fs::read(&path).unwrap()).is_none());
}

#[test]
fn whole_document_with_the_real_profile_and_the_wire_format() {
    let path = profile_or_skip!();
    let mut doc = Document::with_version("1.7");
    let pages = doc.new_object_id();
    let content = doc.add_object(Stream::new(dictionary! {}, b"1 0 0 rg 0 0 50 50 re f".to_vec()));
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages, "Contents" => content, "Resources" => dictionary! {},
        "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
    });
    doc.objects.insert(pages, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    doc.trailer.set("Root", catalog);
    let mut pdf = Vec::new();
    doc.save_to(&mut pdf).unwrap();

    let out = convert_with_profile(&pdf, &path, RenderingIntent::RelativeColorimetricBpc).unwrap();
    assert_eq!(out.report.colour_operators.converted, 1);
    assert!(!out.profile_name.is_empty());
    assert_eq!(out.profile, std::fs::read(&path).unwrap());
    let back = Document::load_mem(&out.pdf).unwrap();
    let text = String::from_utf8(back.get_page_content(page).unwrap()).unwrap();
    assert!(text.ends_with(" k 0 0 50 50 re f"), "{text}");

    // Draadformaat: [u32 LE lengte][JSON][u32 LE lengte][profiel][pdf].
    let packed = pack_response(&out);
    let meta_len = u32::from_le_bytes(packed[0..4].try_into().unwrap()) as usize;
    let meta: serde_json::Value = serde_json::from_slice(&packed[4..4 + meta_len]).unwrap();
    assert_eq!(meta["profileName"], out.profile_name.as_str());
    assert_eq!(meta["report"]["colourOperators"]["converted"], 1);
    let at = 4 + meta_len;
    let profile_len = u32::from_le_bytes(packed[at..at + 4].try_into().unwrap()) as usize;
    assert_eq!(&packed[at + 4..at + 4 + profile_len], &out.profile[..]);
    assert_eq!(&packed[at + 4 + profile_len..], &out.pdf[..]);
}

#[test]
fn a_file_that_is_not_a_printing_profile_gives_a_clear_code() {
    let dir = std::env::temp_dir().join(format!("open-pdf-cmyk-geen-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("scherm.icc");
    std::fs::write(&path, lcms2::Profile::new_srgb().icc().unwrap()).unwrap();
    let err = convert_with_profile(b"%PDF-1.7", &path, RenderingIntent::Perceptual).err().unwrap();
    assert_eq!(err.code(), "profile:notCmyk");
    let _ = std::fs::remove_dir_all(&dir);
}
