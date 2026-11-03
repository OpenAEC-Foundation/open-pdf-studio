//! Selected-region OCR for page labels. Keep one Tesseract instance and try
//! quarter turns of the crop; a page can contain several text orientations.
//! Returned words retain recognition order, with boxes mapped back to the page.
use super::{parse_tsv_words, OcrWord, AUTO_LANG};
use image::{imageops, RgbaImage};
use serde::Deserialize;
use tesseract_rs::{TessPageSegMode, TesseractAPI};

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct LabelRegion {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

fn crop_bounds(
    region: LabelRegion,
    scale: f32,
    width: u32,
    height: u32,
) -> Result<(u32, u32, u32, u32), String> {
    let r = region;
    if ![r.x, r.y, r.width, r.height, scale]
        .iter()
        .all(|v| v.is_finite())
        || r.width <= 0.0
        || r.height <= 0.0
        || scale <= 0.0
    {
        return Err("Invalid label OCR region".into());
    }
    let x = (r.x * scale).floor().clamp(0.0, width as f32) as u32;
    let y = (r.y * scale).floor().clamp(0.0, height as f32) as u32;
    let right = ((r.x + r.width) * scale).ceil().clamp(0.0, width as f32) as u32;
    let bottom = ((r.y + r.height) * scale).ceil().clamp(0.0, height as f32) as u32;
    if right <= x || bottom <= y {
        return Err("Empty label OCR region".into());
    }
    Ok((x, y, right - x, bottom - y))
}

// Reward confident character coverage without letting many low-confidence
// fragments from a sideways line beat a short, correctly recognized label.
fn score(words: &[OcrWord]) -> f32 {
    let mut confidence = 0.0;
    let mut count = 0.0_f32;
    for word in words {
        let n = word.text.chars().filter(|c| c.is_alphanumeric()).count() as f32;
        count += n;
        confidence += n * (word.confidence - 50.0).max(0.0);
    }
    confidence / count.max(1.0).sqrt()
}

fn restore_box(word: &mut OcrWord, turn: u32, width: u32, height: u32, x: u32, y: u32, scale: f32) {
    let (l, t, w, h) = (word.left, word.top, word.width, word.height);
    let (l, t, w, h) = match turn {
        90 => (t, height as f32 - l - w, h, w),
        180 => (width as f32 - l - w, height as f32 - t - h, w, h),
        270 => (width as f32 - t - h, l, h, w),
        _ => (l, t, w, h),
    };
    word.left = (l + x as f32) / scale;
    word.top = (t + y as f32) / scale;
    word.width = w / scale;
    word.height = h / scale;
}

pub fn recognize(
    image: RgbaImage,
    region: LabelRegion,
    scale: f32,
    tessdata: &str,
    lang: &str,
) -> Result<Vec<OcrWord>, String> {
    let (x, y, width, height) = crop_bounds(region, scale, image.width(), image.height())?;
    let crop = imageops::crop_imm(&image, x, y, width, height).to_image();
    drop(image);
    let api = TesseractAPI::new();
    api.init(tessdata, if lang == "auto" { AUTO_LANG } else { lang })
        .map_err(|e| format!("Label OCR init: {e}"))?;
    api.set_page_seg_mode(TessPageSegMode::PSM_SINGLE_BLOCK)
        .map_err(|e| format!("Label OCR segmentation: {e}"))?;
    let mut best = Vec::new();
    // Keep the unrotated result when every candidate has low confidence.
    let mut best_score = -1.0;
    for turn in [0, 90, 270, 180] {
        let rotated = match turn {
            90 => imageops::rotate90(&crop),
            180 => imageops::rotate180(&crop),
            270 => imageops::rotate270(&crop),
            _ => crop.clone(),
        };
        // Tight selections need a small white border for Tesseract segmentation.
        let border = 10;
        let mut padded = RgbaImage::from_pixel(
            rotated.width() + border * 2,
            rotated.height() + border * 2,
            image::Rgba([255; 4]),
        );
        imageops::overlay(&mut padded, &rotated, border as i64, border as i64);
        api.set_image(
            padded.as_raw(),
            padded.width() as i32,
            padded.height() as i32,
            4,
            (padded.width() * 4) as i32,
        )
        .map_err(|e| format!("Label OCR image: {e}"))?;
        api.recognize()
            .map_err(|e| format!("Label OCR recognition: {e}"))?;
        let tsv = api
            .get_tsv_text(0)
            .map_err(|e| format!("Label OCR TSV: {e}"))?;
        let mut words = parse_tsv_words(&tsv, 1.0);
        let quality = score(&words);
        if quality > best_score {
            for word in &mut words {
                word.left -= border as f32;
                word.top -= border as f32;
                restore_box(word, turn, width, height, x, y, scale);
            }
            best = words;
            best_score = quality;
        }
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_region_and_rejects_empty_or_invalid_geometry() {
        let r = LabelRegion {
            x: -2.0,
            y: 3.0,
            width: 20.0,
            height: 4.0,
        };
        assert_eq!(crop_bounds(r, 2.0, 30, 40).unwrap(), (0, 6, 30, 8));
        for r in [
            LabelRegion { x: 40.0, ..r },
            LabelRegion { width: 0.0, ..r },
            LabelRegion { y: f32::NAN, ..r },
        ] {
            assert!(crop_bounds(r, 2.0, 30, 40).is_err());
        }
    }

    #[test]
    fn restores_boxes_for_every_orientation_and_scale() {
        // Same original box (10,20,30,40) in a 100x200 crop.
        for (turn, (left, top, width, height)) in [
            (0, (10., 20., 30., 40.)),
            (90, (140., 10., 40., 30.)),
            (180, (60., 140., 30., 40.)),
            (270, (20., 60., 40., 30.)),
        ] {
            let mut w = OcrWord {
                text: "A".into(),
                left,
                top,
                width,
                height,
                confidence: 90.,
            };
            restore_box(&mut w, turn, 100, 200, 50, 100, 2.);
            assert_eq!((w.left, w.top, w.width, w.height), (30., 60., 15., 20.));
        }
    }

    #[test]
    #[ignore = "requires OPDS_TESSDATA_DIR with eng.traineddata"]
    fn recognizes_horizontal_and_vertical_title_blocks() {
        let tessdata = std::env::var("OPDS_TESSDATA_DIR").expect("OPDS_TESSDATA_DIR");
        let base = image::load_from_memory(include_bytes!("../../test-data/label-ocr.png"))
            .unwrap()
            .to_rgba8();
        // Reproduce the previous unrotated OCR path on a sideways title.
        let sideways = imageops::rotate270(&base);
        let baseline = TesseractAPI::new();
        baseline.init(&tessdata, AUTO_LANG).unwrap();
        baseline
            .set_image(
                sideways.as_raw(),
                sideways.width() as i32,
                sideways.height() as i32,
                4,
                (sideways.width() * 4) as i32,
            )
            .unwrap();
        baseline.recognize().unwrap();
        let old_words = parse_tsv_words(&baseline.get_tsv_text(0).unwrap(), 1.0);
        let old_text = old_words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        eprintln!("Uncorrected vertical OCR: {old_text:?}");
        assert_ne!(old_text, "GRADING PLAN GENERAL NOTES");
        drop(baseline);
        for turn in [0, 90, 180, 270] {
            let rotated = match turn {
                90 => imageops::rotate90(&base),
                180 => imageops::rotate180(&base),
                270 => imageops::rotate270(&base),
                _ => base.clone(),
            };
            let mut page = RgbaImage::from_pixel(
                rotated.width() + 80,
                rotated.height() + 120,
                image::Rgba([255; 4]),
            );
            imageops::overlay(&mut page, &rotated, 30, 50);
            let region = LabelRegion {
                x: 15.,
                y: 25.,
                width: rotated.width() as f32 / 2.,
                height: rotated.height() as f32 / 2.,
            };
            for lang in ["eng", "auto"] {
                let words = recognize(page.clone(), region, 2., &tessdata, lang).unwrap();
                let text = words
                    .iter()
                    .map(|w| w.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                assert_eq!(
                    text, "GRADING PLAN GENERAL NOTES",
                    "turn={turn}, lang={lang}"
                );
                assert!(words.iter().all(|w| w.left >= region.x
                    && w.top >= region.y
                    && w.left + w.width <= region.x + region.width
                    && w.top + w.height <= region.y + region.height));
            }
        }
        let blank = RgbaImage::from_pixel(100, 100, image::Rgba([255; 4]));
        assert!(recognize(
            blank,
            LabelRegion {
                x: 0.,
                y: 0.,
                width: 100.,
                height: 100.
            },
            1.,
            &tessdata,
            "eng"
        )
        .unwrap()
        .is_empty());
    }
}
