//! PNG encoding helper + Tauri command for rendering a single PDF page.

use image::{ImageBuffer, Rgba};

/// Encode an RGBA buffer as a PNG and return raw base64 (no `data:` prefix).
pub fn encode_rgba_to_png_base64(
    width: u32,
    height: u32,
    pixels: &[u8],
) -> Result<String, String> {
    if pixels.len() as u32 != width * height * 4 {
        return Err(format!(
            "pixel buffer size mismatch: got {}, expected {}",
            pixels.len(),
            width * height * 4
        ));
    }
    let buffer: ImageBuffer<Rgba<u8>, &[u8]> =
        ImageBuffer::from_raw(width, height, pixels)
            .ok_or_else(|| "failed to construct image buffer".to_string())?;
    let mut png_bytes: Vec<u8> = Vec::with_capacity((width * height) as usize);
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    buffer
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("png encode failed: {e}"))?;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(STANDARD.encode(&png_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_2x2_red_to_valid_png_base64() {
        // 2x2 image, all red pixels (R=255, G=0, B=0, A=255)
        let pixels: Vec<u8> = vec![
            255, 0, 0, 255,
            255, 0, 0, 255,
            255, 0, 0, 255,
            255, 0, 0, 255,
        ];
        let b64 = encode_rgba_to_png_base64(2, 2, &pixels).unwrap();
        // PNG signature in base64 starts with "iVBORw0KGgo" for any valid PNG
        assert!(b64.starts_with("iVBORw0KGgo"), "got: {}", &b64[..30]);
        assert!(!b64.contains('\n'));
    }

    #[test]
    fn rejects_size_mismatch() {
        let pixels = vec![0u8; 8]; // claims 2x2 but only 8 bytes (need 16)
        let err = encode_rgba_to_png_base64(2, 2, &pixels).unwrap_err();
        assert!(err.contains("size mismatch"), "got: {err}");
    }
}

/// Render a PDF page at `target_width` pixels and return a base64-encoded PNG.
/// Used by both the in-app "Export page as image" feature (future) and the MCP
/// regression-test server.
#[tauri::command]
pub async fn render_page_to_png(
    path: String,
    page_index: usize,
    target_width: u32,
) -> Result<String, String> {
    if target_width == 0 {
        return Err("target_width must be > 0".to_string());
    }

    let pdf_bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("failed to read PDF '{path}': {e}"))?;

    // PDFium rendering is sync and CPU-bound; offload to a blocking task so
    // we don't stall the Tauri async runtime.
    let (width, height, rgba) = tokio::task::spawn_blocking(move || -> Result<(u32, u32, Vec<u8>), String> {
        let arc_bytes = std::sync::Arc::new(pdf_bytes);
        let cache = crate::pdfium_renderer::PdfiumDocCache::default();
        let cache_key = format!("render_to_png:{:p}", arc_bytes.as_ptr());
        let handle = crate::pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
            &cache_key, arc_bytes, &cache,
        )?;
        let doc = handle.document();
        let scale = {
            let _guard = crate::pdfium_renderer::inproc_guard();
            let pages = doc.pages();
            let page = pages
                .get(page_index as i32)
                .map_err(|e| format!("page_dimensions: {e}"))?;
            // Scale so the longest page side fits target_width pixels — same
            // convention as render_thumbnail in lib.rs.
            target_width as f32 / page.width().value.max(page.height().value)
        };
        crate::pdfium_renderer::render_page_to_rgba(doc, page_index as u32, scale, 0)
    })
    .await
    .map_err(|e| format!("render task panicked: {e}"))??;

    encode_rgba_to_png_base64(width, height, &rgba)
}
