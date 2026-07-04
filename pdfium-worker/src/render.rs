use std::path::Path;

use anyhow::{anyhow, Context, Result};
use pdfium_render::prelude::*;

pub struct RenderResult {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub struct Renderer {
    pdfium: Pdfium,
}

impl Renderer {
    pub fn new() -> Result<Self> {
        #[cfg(target_os = "linux")]
        let search_path: &Path = match std::env::var_os("APPDIR") {
            // Inside an AppImage: resources are under the mounted APPDIR.
            Some(appdir) => &Path::new(&appdir).join("usr/lib/Open PDF Studio/"),
            None => &std::path::PathBuf::from("/usr/lib/Open PDF Studio/"),
        };
        #[cfg(target_os = "macos")]
        let search_path: &Path = &core_foundation::bundle::CFBundle::main_bundle()
            .path()
            .unwrap_or_default()
            .join("Contents/Resources");
        #[cfg(target_os = "windows")]
        let search_path: &Path = Path::new("./");

        let bindings = Pdfium::bind_to_system_library()
            .or_else(|_| {
                Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&search_path))
            })
            .context(format!(
                "PDFium DLL not found (system or {})",
                search_path.display()
            ))?;
        Ok(Self {
            pdfium: Pdfium::new(bindings),
        })
    }

    pub fn render(
        &self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<RenderResult> {
        let bytes = std::fs::read(path).with_context(|| format!("read {}", path))?;
        let doc = self.pdfium.load_pdf_from_byte_slice(&bytes, None)
            .map_err(|e| anyhow!("PDFium parse: {}", e))?;
        let pages = doc.pages();
        let page = pages.get(page_index as i32)
            .map_err(|e| anyhow!("page {}: {}", page_index, e))?;

        let w_pt = page.width().value;
        let h_pt = page.height().value;
        let target_w = (w_pt * scale).ceil() as i32;
        let target_h = (h_pt * scale).ceil() as i32;

        let rot = match rotation.rem_euclid(360) {
            0 => PdfPageRenderRotation::None,
            90 => PdfPageRenderRotation::Degrees90,
            180 => PdfPageRenderRotation::Degrees180,
            270 => PdfPageRenderRotation::Degrees270,
            other => return Err(anyhow!("unsupported rotation {}", other)),
        };

        let config = PdfRenderConfig::new()
            .set_target_width(target_w)
            .set_maximum_height(target_h)
            .rotate(rot, true)
            .render_form_data(true)
            .render_annotations(false)
            .use_lcd_text_rendering(true)
            .set_format(PdfBitmapFormat::BGRA);

        let bitmap = page.render_with_config(&config)
            .map_err(|e| anyhow!("PDFium render: {}", e))?;

        Ok(RenderResult {
            width: bitmap.width() as u32,
            height: bitmap.height() as u32,
            rgba: bitmap.as_rgba_bytes(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn renders_a4_at_scale_1() {
        let _r = Renderer::new();
    }
}
