use super::*;

fn bindings() -> &'static dyn PdfiumLibraryBindings {
    crate::render::pdfium_for_tests().bindings()
}

fn tekst(items: &[pdfjs::Item]) -> Vec<String> {
    items.iter().map(|i| String::from_utf16(&i.str).unwrap()).collect()
}

/// Eén pagina met een eigen inhoud en Helvetica als /F1.
fn pdf(inhoud: &str, extra: &str) -> Vec<u8> {
    let objecten = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> {extra} >>"),
        format!("<< /Length {} >>\nstream\n{}\nendstream", inhoud.len(), inhoud),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_string(),
    ];
    let mut uit = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objecten.iter().enumerate() {
        offsets.push(uit.len());
        uit.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, o).as_bytes());
    }
    let xref = uit.len();
    uit.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f\r\n", objecten.len() + 1).as_bytes());
    for o in offsets {
        uit.extend_from_slice(format!("{:010} 00000 n\r\n", o).as_bytes());
    }
    uit.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", objecten.len() + 1, xref).as_bytes());
    uit
}

fn lees(bytes: &[u8]) -> PaginaTekst {
    let doc = unsafe { RuwDocument::open(bindings(), bytes).unwrap() };
    doc.pagina(0).unwrap()
}

#[test]
fn reads_a_line_like_pdfjs() {
    let bytes = pdf("BT /F1 12 Tf 72 740 Td (Hello world, plain line.) Tj 0 -18 Td (Multiple   spaces) Tj ET", "");
    let p = lees(&bytes);
    // pdf.js 6.4: "Hello world, plain line." (EOL), "Multiple", " ", "spaces".
    assert_eq!(tekst(&p.items), vec!["Hello world, plain line.", "Multiple", " ", "spaces"]);
    assert!(p.items[0].has_eol);
    let t = p.items[0].transform;
    assert_eq!([t[0], t[3], t[4], t[5]], [12.0, 12.0, 72.0, 740.0]);
    // Helvetica-metriek: H e l l o ... samen 131,4 pt bij 12 pt.
    assert!((p.items[1].width - 41.34).abs() < 0.01, "breedte {}", p.items[1].width);
    assert_eq!(p.view, [0.0, 0.0, 612.0, 792.0]);
}

#[test]
fn kerning_gaps_become_spaces() {
    let bytes = pdf("BT /F1 12 Tf 72 700 Td [(Kerned)-250(words)] TJ 0 -18 Td [(Tight)-60(kern)] TJ ET", "");
    assert_eq!(tekst(&lees(&bytes).items), vec!["Kerned words", "Tightkern"]);
}

#[test]
fn rotated_text_keeps_its_matrix_and_width() {
    let bytes = pdf("BT /F1 12 Tf 0 1 -1 0 300 300 Tm (Rotated ninety degrees) Tj ET", "");
    let p = lees(&bytes);
    assert_eq!(tekst(&p.items), vec!["Rotated ninety degrees"]);
    let t = p.items[0].transform;
    assert!((t[1] - 12.0).abs() < 1e-6 && (t[2] + 12.0).abs() < 1e-6 && t[0].abs() < 1e-6);
    assert!((p.items[0].width - 124.068).abs() < 0.05, "breedte {}", p.items[0].width);
}

#[test]
fn the_encoding_is_aligned_and_self_describing() {
    let bytes = pdf("BT /F1 12 Tf 72 740 Td (Ab) Tj ET", "");
    let p = lees(&bytes);
    let mut uit = Vec::new();
    encode_header(&mut uit, 1);
    encode_page(&mut uit, &p);
    zet_aantal(&mut uit, 1);
    assert_eq!(&uit[0..4], MAGIC);
    assert_eq!(uit.len() % 4, 0);
    assert_eq!(u32::from_le_bytes(uit[4..8].try_into().unwrap()), 1);
    // kop 16 + pagina 4 + 16 + 16, font "Helvetica" 4 + 12, 1 item 48, 2 tekens 4, 2 vakken 8
    assert_eq!(uit.len(), 16 + 36 + 16 + 48 + 4 + 8);
}

/// Handmatig: `OPDS_TEKST_DUMP=<pdf> cargo test -p pdfium-worker dump -- --nocapture`.
#[test]
fn dump() {
    let Ok(pad) = std::env::var("OPDS_TEKST_DUMP") else { return };
    let bytes = std::fs::read(&pad).unwrap();
    let doc = unsafe { RuwDocument::open(bindings(), &bytes).unwrap() };
    let alleen: Option<u32> = std::env::var("OPDS_TEKST_PAGINA").ok().and_then(|s| s.parse().ok());
    for i in 0..doc.page_count() {
        if alleen.is_some_and(|a| a != i + 1) {
            continue;
        }
        if std::env::var("OPDS_TEKST_RUW").is_ok() {
            let r = unsafe { pdfium::lees(bindings(), doc.handle, i as i32).unwrap() };
            for e in &r.gebeurtenissen {
                match e {
                    pdfjs::Gebeurtenis::Tekst { font, glyphs } => {
                        println!("tekst font {}", font);
                        for g in glyphs {
                            println!("  {:?} x {:.3} y {:.3} m {:?} fs {} w {:.4}", String::from_utf16_lossy(&g.unicode), g.x, g.y, g.m, g.fs, g.w);
                        }
                    }
                    other => println!("{:?}", other),
                }
            }
        }
        let p = doc.pagina(i).unwrap();
        println!("--- page {} view {:?}{}{} fonts {:?}", i + 1, p.view, if p.verticaal { " VERTICAAL" } else { "" }, if p.rtl { " RTL" } else { "" }, p.fonts);
        for it in &p.items {
            let t: Vec<f64> = it.transform.iter().map(|v| (v * 1000.0).round() / 1000.0).collect();
            println!("{:?} {:?} w {:.3} h {:.3} {}{}", String::from_utf16_lossy(&it.str), t, it.width, it.height, if it.has_eol { "EOL" } else { "" }, if it.rtl { " rtl" } else { "" });
        }
    }
}

/// Handmatig: `OPDS_TEKST_PROFIEL=<pdf> cargo test --release -p pdfium-worker profiel -- --nocapture`.
#[test]
fn profiel() {
    let Ok(pad) = std::env::var("OPDS_TEKST_PROFIEL") else { return };
    let bytes = std::fs::read(&pad).unwrap();
    let b = bindings();
    let doc = unsafe { RuwDocument::open(b, &bytes).unwrap() };
    let n = doc.page_count();
    let (mut laden, mut tekstpagina, mut tekens, mut totaal) = (0.0, 0.0, 0.0, 0.0);
    let mut aantal = 0usize;
    for i in 0..n {
        unsafe {
            let t0 = std::time::Instant::now();
            let page = b.FPDF_LoadPage(doc.handle, i as i32);
            let t1 = std::time::Instant::now();
            let tp = b.FPDFText_LoadPage(page);
            let t2 = std::time::Instant::now();
            let c = b.FPDFText_CountChars(tp);
            for k in 0..c {
                let (mut x, mut y) = (0f64, 0f64);
                b.FPDFText_IsGenerated(tp, k);
                b.FPDFText_GetTextObject(tp, k);
                b.FPDFText_GetCharOrigin(tp, k, &mut x, &mut y);
                b.FPDFText_GetUnicode(tp, k);
            }
            aantal += c as usize;
            let t3 = std::time::Instant::now();
            b.FPDFText_ClosePage(tp);
            b.FPDF_ClosePage(page);
            laden += (t1 - t0).as_secs_f64();
            tekstpagina += (t2 - t1).as_secs_f64();
            tekens += (t3 - t2).as_secs_f64();
        }
    }
    let t0 = std::time::Instant::now();
    let mut uit = Vec::new();
    for i in 0..n {
        encode_page(&mut uit, &doc.pagina(i).unwrap());
    }
    totaal += t0.elapsed().as_secs_f64();
    println!("{} pagina's, {} tekens: FPDF_LoadPage {:.0} ms, FPDFText_LoadPage {:.0} ms, 4 aanroepen per teken {:.0} ms; volledige route {:.0} ms", n, aantal, laden * 1e3, tekstpagina * 1e3, tekens * 1e3, totaal * 1e3);
}
