/// Widgets for the synthetic test page (`page_with`). Each one has a stored
/// appearance that fills its whole rectangle with one colour.
#[derive(Clone, Copy, PartialEq)]
#[allow(dead_code)]
pub enum Widget {
    /// Text field at PDF rect [100 100 200 150], black appearance: the editable
    /// HTML form layer draws it on screen.
    Text,
    /// Signature field at PDF rect [220 200 340 250], blue appearance, like a
    /// visible signature from open-pdf-signatures.
    Signature,
    /// Push button at PDF rect [60 260 160 300], red appearance.
    PushButton,
}

#[allow(dead_code)]
impl Widget {
    /// PDF rect (x0, y0, x1, y1) in user space.
    pub fn rect(self) -> (f32, f32, f32, f32) {
        match self {
            Widget::Text => (100.0, 100.0, 200.0, 150.0),
            Widget::Signature => (220.0, 200.0, 340.0, 250.0),
            Widget::PushButton => (60.0, 260.0, 160.0, 300.0),
        }
    }

    /// RGB of the appearance fill.
    pub fn colour(self) -> (u8, u8, u8) {
        match self {
            Widget::Text => (0, 0, 0),
            Widget::Signature => (0, 0, 255),
            Widget::PushButton => (255, 0, 0),
        }
    }
}

/// One 400 x 400 pt page with a line drawing; with `widget` also an
/// AcroForm text field at PDF rect [100 100 200 150] whose appearance is a
/// filled black box (what a filled-in field looks like in pdf.js).
pub fn form_page(widget: bool, rotate: i32) -> Vec<u8> {
    page_with(if widget { &[Widget::Text] } else { &[] }, rotate)
}

/// The test page with the given widgets (each at most once).
pub fn page_with(widgets: &[Widget], rotate: i32) -> Vec<u8> {
    let stream = |dict: &str, data: &str| format!("<< {} /Length {} >>\nstream\n{}\nendstream", dict, data.len(), data);
    // Objects 1-4 are fixed; each widget adds an annotation and its appearance.
    let refs: Vec<String> = (0..widgets.len()).map(|i| format!("{} 0 R", 5 + 2 * i)).collect();
    let refs = refs.join(" ");
    let mut bodies = vec![
        if widgets.is_empty() {
            "<< /Type /Catalog /Pages 2 0 R >>".to_string()
        } else {
            format!("<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [{refs}] >> >>")
        },
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Rotate {} /Contents 4 0 R {} >>",
            rotate,
            if widgets.is_empty() { String::new() } else { format!("/Annots [{refs}]") }
        ),
        stream("", "2 w 20 20 m 380 20 l S 20 20 m 20 380 l S 300 300 m 380 360 l S"),
    ];
    for (i, &widget) in widgets.iter().enumerate() {
        let (x0, y0, x1, y1) = widget.rect();
        let field = match widget {
            Widget::Text => "/FT /Tx /T (veld) /V (x)",
            Widget::Signature => "/FT /Sig /T (handtekening)",
            Widget::PushButton => "/FT /Btn /Ff 65536 /T (knop) /MK << >>",
        };
        bodies.push(format!(
            "<< /Type /Annot /Subtype /Widget {field} /F 4 /P 3 0 R /Rect [{x0} {y0} {x1} {y1}] /AP << /N {} 0 R >> >>",
            6 + 2 * i
        ));
        let (r, g, b) = widget.colour();
        let (w, h) = (x1 - x0, y1 - y0);
        bodies.push(stream(
            &format!("/Type /XObject /Subtype /Form /BBox [0 0 {w} {h}]"),
            &format!("{} {} {} rg 0 0 {w} {h} re f", r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0),
        ));
    }
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in bodies.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f\r\n", bodies.len() + 1).as_bytes());
    for offset in offsets {
        out.extend_from_slice(format!("{:010} 00000 n\r\n", offset).as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", bodies.len() + 1, xref).as_bytes());
    out
}

/// Display-space pixel rectangle (x0, y0, x1, y1) of `widget` on a 400 x 400
/// page with /Rotate `rotate`, at `scale` pixels per point, no extra rotation.
#[allow(dead_code)]
pub fn display_rect(widget: Widget, rotate: i32, scale: f32) -> (f32, f32, f32, f32) {
    let (x0, y0, x1, y1) = widget.rect();
    let map = |x: f32, y: f32| match rotate.rem_euclid(360) {
        0 => (x, 400.0 - y),
        90 => (y, x),
        180 => (400.0 - x, y),
        _ => (400.0 - y, 400.0 - x),
    };
    let (a, b) = (map(x0, y0), map(x1, y1));
    (a.0.min(b.0) * scale, a.1.min(b.1) * scale, a.0.max(b.0) * scale, a.1.max(b.1) * scale)
}

/// Display-space pixel (x, y) of the centre of `widget`, see `display_rect`.
#[allow(dead_code)]
pub fn centre_px(widget: Widget, rotate: i32, scale: f32) -> (usize, usize) {
    let (x0, y0, x1, y1) = display_rect(widget, rotate, scale);
    (((x0 + x1) / 2.0) as usize, ((y0 + y1) / 2.0) as usize)
}
