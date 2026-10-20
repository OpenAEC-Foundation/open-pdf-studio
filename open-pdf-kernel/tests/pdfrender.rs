use std::path::PathBuf;
use std::sync::Arc;

use open_pdf_kernel::pdfrender::{HayroDocument, RenderError};
use open_pdf_kernel::raster::RgbaImage;

const WHITE: [u8; 4] = [255, 255, 255, 255];
const RED: [u8; 4] = [255, 0, 0, 255];

fn test_pdf(name: &str) -> Arc<Vec<u8>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../test pdf-bestanden/Testbestanden")
        .join(name);
    Arc::new(std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display())))
}

struct PageSpec<'a> {
    media: [f32; 4],
    crop: Option<[f32; 4]>,
    rotate: i32,
    content: &'a str,
    /// Black-filled Square annotation with an appearance stream over this rect.
    annot: Option<[f32; 4]>,
}

/// A one-page PDF with a correct cross-reference table.
fn one_page_pdf(spec: &PageSpec) -> Arc<Vec<u8>> {
    let fmt = |b: [f32; 4]| format!("[{} {} {} {}]", b[0], b[1], b[2], b[3]);
    let mut page = format!(
        "<< /Type /Page /Parent 2 0 R /MediaBox {} /Rotate {} /Contents 4 0 R",
        fmt(spec.media),
        spec.rotate
    );
    if let Some(c) = spec.crop {
        page += &format!(" /CropBox {}", fmt(c));
    }
    if spec.annot.is_some() {
        page += " /Annots [5 0 R]";
    }
    page += " >>";
    let mut objs = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        page,
        format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            spec.content.len(),
            spec.content
        ),
    ];
    if let Some(r) = spec.annot {
        let ap = format!("0 g 0 0 {} {} re f", r[2] - r[0], r[3] - r[1]);
        objs.push(format!(
            "<< /Type /Annot /Subtype /Square /Rect {} /AP << /N 6 0 R >> >>",
            fmt(r)
        ));
        objs.push(format!(
            "<< /Type /XObject /Subtype /Form /BBox [0 0 {} {}] /Length {} >>\nstream\n{}\nendstream",
            r[2] - r[0],
            r[3] - r[1],
            ap.len(),
            ap
        ));
    }
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for o in offsets {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objs.len() + 1
        )
        .as_bytes(),
    );
    Arc::new(out)
}

/// 200×100 pt page, left 50 pt red.
fn red_left_strip(rotate: i32, crop: Option<[f32; 4]>) -> Arc<Vec<u8>> {
    one_page_pdf(&PageSpec {
        media: [0.0, 0.0, 200.0, 100.0],
        crop,
        rotate,
        content: "1 0 0 rg 0 0 50 100 re f",
        annot: None,
    })
}

fn px(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * img.width + x) * 4) as usize;
    img.data[i..i + 4].try_into().unwrap()
}

#[test]
fn page_count_matches() {
    let doc = HayroDocument::open(test_pdf("Tekst.pdf")).unwrap();
    assert_eq!(doc.page_count(), 5);
}

#[test]
fn page_size_ceil_matches_bitmap() {
    let pdf = one_page_pdf(&PageSpec {
        media: [0.0, 0.0, 200.5, 100.2],
        crop: None,
        rotate: 0,
        content: "",
        annot: None,
    });
    let doc = HayroDocument::open(pdf).unwrap();
    let (w, h) = doc.page_size(0).unwrap();
    assert!(
        (w - 200.5).abs() < 1e-3 && (h - 100.2).abs() < 1e-3,
        "{w}x{h}"
    );
    let img = doc.render_page(0, 1.5, 0).unwrap();
    assert_eq!((img.width, img.height), (301, 151));
    assert_eq!(px(&img, 150, 75), WHITE, "background is opaque white");
}

#[test]
fn rotation_90_swaps_axes() {
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    let img = doc.render_page(0, 1.0, 90).unwrap();
    assert_eq!((img.width, img.height), (100, 200));
    // Clockwise: the red left edge ends up at the top.
    assert_eq!(px(&img, 50, 10), RED);
    assert_eq!(px(&img, 50, 190), WHITE);
}

#[test]
fn rotated_page_size_matches_display_size() {
    let doc = HayroDocument::open(red_left_strip(90, None)).unwrap();
    assert_eq!(doc.page_size(0).unwrap(), (100.0, 200.0));
    let img = doc.render_page(0, 1.0, 0).unwrap();
    assert_eq!((img.width, img.height), (100, 200));
    assert_eq!(px(&img, 50, 10), RED);
    assert_eq!(px(&img, 50, 190), WHITE);
}

#[test]
fn cropbox_offset_is_applied() {
    let doc = HayroDocument::open(red_left_strip(0, Some([50.0, 0.0, 200.0, 100.0]))).unwrap();
    assert_eq!(doc.page_size(0).unwrap(), (150.0, 100.0));
    let img = doc.render_page(0, 1.0, 0).unwrap();
    assert_eq!(
        px(&img, 5, 50),
        WHITE,
        "the red strip lies outside the crop box"
    );
}

#[test]
fn annotations_are_not_drawn() {
    let pdf = one_page_pdf(&PageSpec {
        media: [0.0, 0.0, 200.0, 100.0],
        crop: None,
        rotate: 0,
        content: "",
        annot: Some([100.0, 20.0, 180.0, 80.0]),
    });
    let img = HayroDocument::open(pdf)
        .unwrap()
        .render_page(0, 1.0, 0)
        .unwrap();
    assert_eq!(px(&img, 140, 50), WHITE, "the app draws annotations itself");
}

#[test]
fn region_matches_crop_of_page() {
    let doc = HayroDocument::open(test_pdf("Technische tekening.pdf")).unwrap();
    let page = doc.render_page(0, 1.0, 0).unwrap();
    let (rx, ry, rw, rh) = (300u32, 200u32, 240u32, 160u32);
    let region = doc
        .render_region(0, 1.0, rx as f32, ry as f32, rw as f32, rh as f32)
        .unwrap();
    assert_eq!((region.width, region.height), (rw, rh));
    let mut worst = 0u8;
    for y in 1..rh - 1 {
        for x in 1..rw - 1 {
            let a = px(&region, x, y);
            let b = px(&page, rx + x, ry + y);
            for c in 0..4 {
                worst = worst.max(a[c].abs_diff(b[c]));
            }
        }
    }
    assert!(worst <= 3, "region differs from the page crop by {worst}");
}

#[test]
fn region_outside_page_is_white() {
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    let img = doc.render_region(0, 2.0, -50.0, -50.0, 40.0, 40.0).unwrap();
    assert_eq!((img.width, img.height), (80, 80));
    assert!(img.data.chunks(4).all(|p| p == WHITE));
}

#[test]
fn invalid_pdf_is_error() {
    let err = HayroDocument::open(Arc::new(b"not a pdf".to_vec()));
    assert!(matches!(err, Err(RenderError::Open(_))));
}

#[test]
fn bad_arguments_are_errors() {
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    assert!(matches!(
        doc.render_page(1, 1.0, 0),
        Err(RenderError::PageOutOfRange(1))
    ));
    assert!(matches!(
        doc.render_page(0, 1.0, 45),
        Err(RenderError::BadRotation(45))
    ));
    assert!(matches!(
        doc.render_region(0, 1.0, 0.0, 0.0, 0.0, 10.0),
        Err(RenderError::EmptyRegion)
    ));
    assert!(matches!(
        doc.render_page(0, 200.0, 0),
        Err(RenderError::TooLarge { .. })
    ));
}

/// A 600×400 pt page that fills `n` rectangles, each with its own shading
/// pattern of type 4 (free-form mesh). Hayro samples every non-gradient
/// shading into a texture that stays alive until the page is rasterized.
fn mesh_page_pdf(n: usize) -> Arc<Vec<u8>> {
    let first_pattern = 5;
    let mut objs = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
    ];
    let patterns: String = (0..n)
        .map(|i| format!("/P{i} {} 0 R ", first_pattern + 2 * i))
        .collect();
    objs.push(format!(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 4 0 R /Resources << /Pattern << {patterns}>> >> >>"
    ));
    let content: String = (0..n)
        .map(|i| format!("/Pattern cs /P{i} scn 0 0 600 400 re f\n"))
        .collect();
    objs.push(format!(
        "<< /Length {} >>\nstream\n{}\nendstream",
        content.len(),
        content
    ));
    // One triangle per mesh: flag, x, y (16-bit), r g b (8-bit).
    let mesh: Vec<u8> = [
        [0u8, 0, 0, 0, 0, 255, 0, 0],
        [0, 255, 255, 0, 0, 0, 255, 0],
        [0, 0, 0, 255, 255, 0, 0, 255],
    ]
    .concat();
    for i in 0..n {
        objs.push(format!(
            "<< /PatternType 2 /Shading {} 0 R >>",
            first_pattern + 2 * i + 1
        ));
        let mut stream = format!(
            "<< /ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 16 /BitsPerComponent 8 /BitsPerFlag 8 /Decode [0 600 0 400 0 1 0 1 0 1] /Length {} >>\nstream\n",
            mesh.len()
        )
        .into_bytes();
        stream.extend_from_slice(&mesh);
        stream.extend_from_slice(b"\nendstream");
        objs.push(unsafe_utf8(stream));
    }
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(&body_bytes(body));
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for o in offsets {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objs.len() + 1
        )
        .as_bytes(),
    );
    Arc::new(out)
}

/// Binary stream data travels through `String` as Latin-1 code points.
fn unsafe_utf8(bytes: Vec<u8>) -> String {
    bytes.into_iter().map(char::from).collect()
}

fn body_bytes(body: &str) -> Vec<u8> {
    body.chars().map(|c| c as u32 as u8).collect()
}

#[test]
fn a_few_mesh_shadings_render() {
    let doc = HayroDocument::open(mesh_page_pdf(2)).unwrap();
    assert!(doc.render_page(0, 1.0, 0).is_ok());
}

#[test]
fn many_mesh_shadings_are_refused_before_they_exhaust_memory() {
    let doc = HayroDocument::open(mesh_page_pdf(200)).unwrap();
    match doc.render_page(0, 1.0, 0) {
        Err(RenderError::Unsupported(why)) => assert!(why.contains("200"), "{why}"),
        other => panic!(
            "expected Unsupported, got {:?}",
            other.map(|i| (i.width, i.height))
        ),
    }
    let msg = doc.render_page(0, 1.0, 0).unwrap_err().to_string();
    assert!(msg.starts_with("HAYRO_UNSUPPORTED"), "{msg}");
}

#[test]
fn mesh_textures_beyond_the_memory_budget_are_refused() {
    let doc = HayroDocument::open(mesh_page_pdf(10)).unwrap();
    assert!(doc.render_page(0, 1.0, 0).is_ok());
    // 10 page-sized textures of 6600x4400 px need more than 1 GiB.
    assert!(matches!(
        doc.render_page(0, 11.0, 0),
        Err(RenderError::Unsupported(_))
    ));
    // A tile of the same zoom only needs tile-sized textures.
    assert!(doc.render_region(0, 11.0, 0.0, 0.0, 50.0, 50.0).is_ok());
}

#[test]
fn multithreaded_rendering_matches_single_threaded() {
    let single = HayroDocument::open(test_pdf("Technische tekening.pdf")).unwrap();
    let multi = HayroDocument::open(test_pdf("Technische tekening.pdf"))
        .unwrap()
        .with_threads(4);
    let a = single.render_page(0, 0.5, 0).unwrap();
    let b = multi.render_page(0, 0.5, 0).unwrap();
    assert_eq!((a.width, a.height), (b.width, b.height));
    let worst = a
        .data
        .iter()
        .zip(&b.data)
        .map(|(x, y)| x.abs_diff(*y))
        .max()
        .unwrap();
    assert!(worst <= 3, "threads change the picture by {worst}");
}

#[test]
fn the_render_cache_is_reused_between_renders() {
    let doc = HayroDocument::open(test_pdf("Tekst.pdf")).unwrap();
    let first = doc.render_page(0, 1.0, 0).unwrap();
    let again = doc.render_page(0, 1.0, 0).unwrap();
    assert_eq!(first, again, "a warm cache draws the same page");
}

/// A PDF from raw object bodies (object i+1 = objs[i]), catalog = object 1.
fn build_pdf(objs: &[Vec<u8>]) -> Arc<Vec<u8>> {
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for o in offsets {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objs.len() + 1
        )
        .as_bytes(),
    );
    Arc::new(out)
}

fn stream(dict: &str, data: &[u8]) -> Vec<u8> {
    let mut s = format!("<< {dict} /Length {} >>\nstream\n", data.len()).into_bytes();
    s.extend_from_slice(data);
    s.extend_from_slice(b"\nendstream");
    s
}

#[test]
fn page_weight_counts_the_content_stream() {
    let content = "1 0 0 rg 0 0 50 100 re f";
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    assert_eq!(doc.page_weight(0).unwrap(), content.len() as u64);
}

#[test]
fn page_weight_includes_forms_but_not_images() {
    // Page draws form F0 and image Im0; F0 draws nested form F1, which the
    // page also draws directly: F1 counts once.
    let page_content = b"/F0 Do /F1 Do /Im0 Do".to_vec();
    let f0 = vec![b'x'; 3000];
    let f1 = vec![b'y'; 700];
    let image = vec![0u8; 50_000];
    let objs = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /XObject << /F0 5 0 R /F1 6 0 R /Im0 7 0 R >> >> >>".to_vec(),
        stream("", &page_content),
        stream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /XObject << /F1 6 0 R >> >>", &f0),
        stream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", &f1),
        stream("/Type /XObject /Subtype /Image /Width 100 /Height 125 /ColorSpace /DeviceGray /BitsPerComponent 8", &image),
    ];
    let doc = HayroDocument::open(build_pdf(&objs)).unwrap();
    assert_eq!(
        doc.page_weight(0).unwrap(),
        (page_content.len() + f0.len() + f1.len()) as u64
    );
}

#[test]
fn page_weight_of_a_missing_page_is_an_error() {
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    assert!(matches!(doc.page_weight(3), Err(RenderError::PageOutOfRange(3))));
}

#[test]
fn the_thread_share_fits_the_machine() {
    use open_pdf_kernel::pdfrender::default_render_threads;
    assert_eq!(default_render_threads(1), 0);
    assert_eq!(default_render_threads(8), 1);
    assert_eq!(default_render_threads(16), 3);
    assert_eq!(default_render_threads(32), 4);
    assert_eq!(default_render_threads(128), 4);
}
