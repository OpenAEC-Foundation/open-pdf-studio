/// One 400 x 400 pt page with a line drawing; with `widget` also an
/// AcroForm text field at PDF rect [100 100 200 150] whose appearance is a
/// filled black box (what a filled-in field looks like in pdf.js).
pub fn form_page(widget: bool, rotate: i32) -> Vec<u8> {
    let stream = |dict: &str, data: &str| format!("<< {} /Length {} >>\nstream\n{}\nendstream", dict, data.len(), data);
    let mut bodies = vec![
        format!("<< /Type /Catalog /Pages 2 0 R {} >>", if widget { "/AcroForm << /Fields [5 0 R] >>" } else { "" }),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Rotate {} /Contents 4 0 R {} >>",
            rotate,
            if widget { "/Annots [5 0 R]" } else { "" }
        ),
        stream("", "2 w 20 20 m 380 20 l S 20 20 m 20 380 l S 300 300 m 380 360 l S"),
    ];
    if widget {
        bodies.push("<< /Type /Annot /Subtype /Widget /FT /Tx /T (veld) /V (x) /F 4 /P 3 0 R /Rect [100 100 200 150] /AP << /N 6 0 R >> >>".to_string());
        bodies.push(stream("/Type /XObject /Subtype /Form /BBox [0 0 100 50]", "0 g 0 0 100 50 re f"));
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

