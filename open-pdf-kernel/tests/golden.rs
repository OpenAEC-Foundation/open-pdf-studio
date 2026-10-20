//! Golden bitmaps. Regenerate with `OPDS_UPDATE_GOLDEN=1 cargo test -p open-pdf-kernel --test golden`
//! and inspect the PNGs in `tests/golden/` before committing them.

use std::path::PathBuf;

use open_pdf_kernel::dl::{
    BlendMode, Color, DisplayList, FillRule, Item, LineCap, LineJoin, Path, PathEl, StrokeStyle,
};
use open_pdf_kernel::raster::{render, RasterTarget, RgbaImage};

/// Allowed per-channel difference: absorbs SIMD-level differences between machines.
const TOLERANCE: u8 = 3;

fn assert_golden(name: &str, img: &RgbaImage) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden");
    let file = dir.join(format!("{name}.png"));
    if std::env::var_os("OPDS_UPDATE_GOLDEN").is_some_and(|v| v == "1") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&file, img.to_png()).unwrap();
        return;
    }
    let expected = std::fs::read(&file)
        .map(|b| RgbaImage::from_png(&b).unwrap())
        .unwrap_or_else(|e| {
            panic!(
                "golden {} missing ({e}); run with OPDS_UPDATE_GOLDEN=1",
                file.display()
            )
        });
    let mismatch = if (expected.width, expected.height) != (img.width, img.height) {
        Some(format!(
            "size {}x{} differs from golden {}x{}",
            img.width, img.height, expected.width, expected.height
        ))
    } else {
        img.data
            .chunks(4)
            .zip(expected.data.chunks(4))
            .position(|(a, b)| a.iter().zip(b).any(|(x, y)| x.abs_diff(*y) > TOLERANCE))
            .map(|i| {
                let (x, y) = (i as u32 % img.width, i as u32 / img.width);
                format!(
                    "pixel ({x},{y}) is {:?}, golden {:?}",
                    &img.data[i * 4..i * 4 + 4],
                    &expected.data[i * 4..i * 4 + 4]
                )
            })
    };
    if let Some(msg) = mismatch {
        let out = std::env::var_os("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target"))
            .join("golden-diff");
        std::fs::create_dir_all(&out).unwrap();
        let actual = out.join(format!("{name}.actual.png"));
        std::fs::write(&actual, img.to_png()).unwrap();
        panic!(
            "golden {name}: {msg}; actual written to {}",
            actual.display()
        );
    }
}

fn scene(dl: &DisplayList) -> RgbaImage {
    let target = RasterTarget {
        width: 200,
        height: 200,
        transform: [2.0, 0.0, 0.0, 2.0, 0.0, 0.0],
    };
    render(dl, &target).unwrap()
}

#[test]
fn golden_dashed_round_cap_line() {
    let mut dl = DisplayList::new();
    dl.push(Item::Stroke {
        path: Path::polyline(&[(10.0, 10.0), (90.0, 60.0)], false),
        color: Color {
            r: 0,
            g: 90,
            b: 200,
            a: 255,
        },
        style: StrokeStyle {
            width: 3.0,
            cap: LineCap::Round,
            dash: vec![6.0, 4.0],
            ..StrokeStyle::default()
        },
    });
    assert_golden("dashed_round_cap_line", &scene(&dl));
}

#[test]
fn golden_evenodd_polygon_with_hole() {
    let mut outer = Path::rect(10.0, 10.0, 80.0, 80.0);
    outer.0.extend(Path::rect(30.0, 30.0, 40.0, 40.0).0);
    let mut dl = DisplayList::new();
    dl.push(Item::Fill {
        path: outer,
        color: Color {
            r: 230,
            g: 120,
            b: 0,
            a: 255,
        },
        rule: FillRule::EvenOdd,
    });
    assert_golden("evenodd_polygon_with_hole", &scene(&dl));
}

#[test]
fn golden_curve_in_opacity_group() {
    let mut dl = DisplayList::new();
    dl.push(Item::PushGroup {
        opacity: 0.6,
        blend: BlendMode::Normal,
        clip: None,
    });
    dl.push(Item::Stroke {
        path: Path(vec![
            PathEl::MoveTo(10.0, 90.0),
            PathEl::CubicTo(30.0, 10.0, 70.0, 10.0, 90.0, 90.0),
        ]),
        color: Color {
            r: 20,
            g: 20,
            b: 20,
            a: 255,
        },
        style: StrokeStyle {
            width: 5.0,
            join: LineJoin::Round,
            ..StrokeStyle::default()
        },
    });
    dl.push(Item::PopGroup);
    assert_golden("curve_in_opacity_group", &scene(&dl));
}
