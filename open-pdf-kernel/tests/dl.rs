use open_pdf_kernel::dl::{
    BlendMode, Color, DisplayList, FillRule, Item, LineJoin, Path, PathEl, Rect, StrokeStyle,
};

const RED: Color = Color {
    r: 255,
    g: 0,
    b: 0,
    a: 255,
};

fn fill(path: Path) -> Item {
    Item::Fill {
        path,
        color: RED,
        rule: FillRule::NonZero,
    }
}

#[test]
fn bounds_of_empty_is_none() {
    assert_eq!(DisplayList::new().bounds(), None);
}

#[test]
fn bounds_of_fill_rect() {
    let mut dl = DisplayList::new();
    dl.push(fill(Path::rect(10.0, 20.0, 30.0, 40.0)));
    assert_eq!(
        dl.bounds(),
        Some(Rect {
            x0: 10.0,
            y0: 20.0,
            x1: 40.0,
            y1: 60.0
        })
    );
}

#[test]
fn bounds_include_half_stroke_width() {
    let mut dl = DisplayList::new();
    let style = StrokeStyle {
        width: 4.0,
        join: LineJoin::Round,
        ..StrokeStyle::default()
    };
    dl.push(Item::Stroke {
        path: Path::polyline(&[(0.0, 0.0), (100.0, 0.0)], false),
        color: RED,
        style,
    });
    assert_eq!(
        dl.bounds(),
        Some(Rect {
            x0: -2.0,
            y0: -2.0,
            x1: 102.0,
            y1: 2.0
        })
    );
}

#[test]
fn bounds_clipped_by_group() {
    let mut dl = DisplayList::new();
    dl.push(Item::PushGroup {
        opacity: 1.0,
        blend: BlendMode::Normal,
        clip: Some(Path::rect(50.0, 50.0, 10.0, 10.0)),
    });
    dl.push(fill(Path::rect(0.0, 0.0, 100.0, 100.0)));
    dl.push(Item::PopGroup);
    assert_eq!(
        dl.bounds(),
        Some(Rect {
            x0: 50.0,
            y0: 50.0,
            x1: 60.0,
            y1: 60.0
        })
    );
}

#[test]
fn polyline_closed_ends_with_close() {
    let closed = Path::polyline(&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)], true);
    assert_eq!(closed.0.last(), Some(&PathEl::Close));
    assert_eq!(closed.0.first(), Some(&PathEl::MoveTo(0.0, 0.0)));
    let open = Path::polyline(&[(0.0, 0.0), (1.0, 0.0)], false);
    assert_eq!(open.0.last(), Some(&PathEl::LineTo(1.0, 0.0)));
}

#[test]
fn bounds_cover_square_caps() {
    use open_pdf_kernel::dl::LineCap;
    let mut dl = DisplayList::new();
    dl.push(Item::Stroke {
        path: Path::polyline(&[(0.0, 0.0), (10.0, 10.0)], false),
        color: RED,
        style: StrokeStyle {
            width: 2.0,
            cap: LineCap::Square,
            join: LineJoin::Round,
            ..StrokeStyle::default()
        },
    });
    let b = dl.bounds().unwrap();
    assert!(b.y1 >= 10.0 + 2f64.sqrt() - 1e-9, "y1 {}", b.y1);
    assert!(b.x0 <= -(2f64.sqrt()) + 1e-9, "x0 {}", b.x0);
}
