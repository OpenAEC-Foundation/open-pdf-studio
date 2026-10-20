use open_pdf_kernel::dl::{BlendMode, Color, DisplayList, FillRule, Item, Path, StrokeStyle};
use open_pdf_kernel::raster::{render, RasterError, RasterTarget, RgbaImage};

const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
const RED: Color = Color {
    r: 255,
    g: 0,
    b: 0,
    a: 255,
};

fn target(width: u32, height: u32, transform: [f64; 6]) -> RasterTarget {
    RasterTarget {
        width,
        height,
        transform,
    }
}

fn px(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * img.width + x) * 4) as usize;
    img.data[i..i + 4].try_into().unwrap()
}

fn fill(path: Path, color: Color) -> Item {
    Item::Fill {
        path,
        color,
        rule: FillRule::NonZero,
    }
}

fn red_rect() -> DisplayList {
    let mut dl = DisplayList::new();
    dl.push(fill(Path::rect(5.0, 5.0, 10.0, 10.0), RED));
    dl
}

#[test]
fn fill_rect_is_opaque_inside_and_empty_outside() {
    let img = render(&red_rect(), &target(20, 20, IDENTITY)).unwrap();
    assert_eq!(
        (img.width, img.height, img.data.len()),
        (20, 20, 20 * 20 * 4)
    );
    assert_eq!(px(&img, 10, 10), [255, 0, 0, 255]);
    assert_eq!(px(&img, 1, 1), [0, 0, 0, 0]);
}

#[test]
fn transform_scales_geometry() {
    let mut dl = DisplayList::new();
    dl.push(fill(Path::rect(2.0, 2.0, 3.0, 3.0), RED));
    let img = render(&dl, &target(20, 20, [2.0, 0.0, 0.0, 2.0, 0.0, 0.0])).unwrap();
    assert_eq!(px(&img, 8, 8), [255, 0, 0, 255]);
    assert_eq!(px(&img, 12, 12), [0, 0, 0, 0]);
}

#[test]
fn group_opacity_halves_alpha() {
    let mut dl = DisplayList::new();
    dl.push(Item::PushGroup {
        opacity: 0.5,
        blend: BlendMode::Normal,
        clip: None,
    });
    dl.push(fill(Path::rect(5.0, 5.0, 10.0, 10.0), RED));
    dl.push(Item::PopGroup);
    let p = px(&render(&dl, &target(20, 20, IDENTITY)).unwrap(), 10, 10);
    assert!(p[3] == 127 || p[3] == 128, "alpha {}", p[3]);
    assert_eq!(p[0], 255);
}

#[test]
fn multiply_blend_darkens() {
    let mut dl = DisplayList::new();
    dl.push(fill(
        Path::rect(0.0, 0.0, 20.0, 20.0),
        Color {
            r: 200,
            g: 200,
            b: 200,
            a: 255,
        },
    ));
    dl.push(Item::PushGroup {
        opacity: 1.0,
        blend: BlendMode::Multiply,
        clip: None,
    });
    dl.push(fill(
        Path::rect(0.0, 0.0, 20.0, 20.0),
        Color {
            r: 128,
            g: 128,
            b: 128,
            a: 255,
        },
    ));
    dl.push(Item::PopGroup);
    let p = px(&render(&dl, &target(20, 20, IDENTITY)).unwrap(), 10, 10);
    for c in &p[..3] {
        assert!((*c as i32 - 100).abs() <= 2, "channel {c} in {p:?}");
    }
    assert_eq!(p[3], 255);
}

#[test]
fn transparent_pixels_are_zero() {
    let mut dl = DisplayList::new();
    dl.push(Item::Stroke {
        path: Path::polyline(&[(1.0, 2.0), (19.0, 17.0)], false),
        color: Color {
            r: 30,
            g: 140,
            b: 220,
            a: 255,
        },
        style: StrokeStyle {
            width: 1.3,
            ..StrokeStyle::default()
        },
    });
    let img = render(&dl, &target(20, 20, IDENTITY)).unwrap();
    let mut partial = 0;
    for p in img.data.chunks(4) {
        if p[3] == 0 {
            assert_eq!(p, [0, 0, 0, 0]);
        } else if p[3] < 255 {
            partial += 1;
        }
    }
    assert!(partial > 0, "expected anti-aliased edge pixels");
}

#[test]
fn rejects_oversized_target() {
    let dl = red_rect();
    assert!(matches!(
        render(&dl, &target(0, 20, IDENTITY)),
        Err(RasterError::EmptyTarget)
    ));
    assert!(matches!(
        render(&dl, &target(20_000, 20, IDENTITY)),
        Err(RasterError::TooLarge { .. })
    ));
    assert!(matches!(
        render(&dl, &target(9_000, 9_000, IDENTITY)),
        Err(RasterError::TooLarge { .. })
    ));
}

#[test]
fn unbalanced_groups_error() {
    let mut dl = red_rect();
    dl.push(Item::PushGroup {
        opacity: 1.0,
        blend: BlendMode::Normal,
        clip: None,
    });
    assert!(matches!(
        render(&dl, &target(20, 20, IDENTITY)),
        Err(RasterError::UnbalancedGroups)
    ));
    let mut extra_pop = red_rect();
    extra_pop.push(Item::PopGroup);
    assert!(matches!(
        render(&extra_pop, &target(20, 20, IDENTITY)),
        Err(RasterError::UnbalancedGroups)
    ));
}

#[test]
fn png_roundtrip_is_exact() {
    let img = render(&red_rect(), &target(20, 20, IDENTITY)).unwrap();
    assert_eq!(RgbaImage::from_png(&img.to_png()).unwrap(), img);
}

fn long_line(dash: Vec<f64>) -> DisplayList {
    let mut dl = DisplayList::new();
    dl.push(Item::Stroke {
        path: Path::polyline(&[(0.0, 10.0), (1.0e7, 10.0)], false),
        color: RED,
        style: StrokeStyle {
            width: 2.0,
            dash,
            ..StrokeStyle::default()
        },
    });
    dl
}

/// Renders on a worker thread and fails instead of hanging the test run.
fn render_within(dl: DisplayList, secs: u64) -> RgbaImage {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(render(&dl, &target(20, 20, IDENTITY)).unwrap());
    });
    rx.recv_timeout(std::time::Duration::from_secs(secs))
        .expect("render did not finish in time")
}

#[test]
fn degenerate_dash_falls_back_to_solid() {
    let solid = render_within(long_line(vec![]), 20);
    assert_eq!(render_within(long_line(vec![-1.0, -2.0]), 20), solid);
    assert_eq!(render_within(long_line(vec![1e-3, 1e-3]), 20), solid);
    assert_eq!(render_within(long_line(vec![f64::NAN, 2.0]), 20), solid);
}

#[test]
fn path_without_moveto_renders() {
    use open_pdf_kernel::dl::PathEl;
    let style = StrokeStyle {
        width: 2.0,
        ..StrokeStyle::default()
    };
    let mut dl = DisplayList::new();
    dl.push(Item::Stroke {
        path: Path(vec![PathEl::LineTo(5.0, 5.0), PathEl::LineTo(15.0, 15.0)]),
        color: RED,
        style: style.clone(),
    });
    let mut after_close = Path::rect(2.0, 2.0, 4.0, 4.0);
    after_close.0.push(PathEl::LineTo(18.0, 18.0));
    after_close.0.insert(0, PathEl::Close);
    dl.push(Item::Stroke {
        path: after_close,
        color: RED,
        style,
    });
    let img = render(&dl, &target(20, 20, IDENTITY)).unwrap();
    assert_eq!(px(&img, 10, 10)[3], 255, "the LineTo segment is drawn");
}
