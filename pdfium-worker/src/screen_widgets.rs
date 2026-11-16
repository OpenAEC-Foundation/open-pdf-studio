//! Form widgets in the interactive page bitmap (#1101).
//!
//! On screen the editable fields (text, check box, radio button, combo box,
//! list box) live in the HTML form layer of PDF.js. Their stored appearance
//! must stay out of the page bitmap, or the old value shows through under the
//! newly typed one. Signature fields and push buttons have no HTML
//! counterpart: PDFium has to keep drawing their stored appearance.
//!
//! PDFium draws widgets only in its form pass (FPDF_FFLDraw), which draws all
//! of them and checks the Hidden flag at draw time. `ScreenWidgets` therefore
//! hides the editable widgets for the duration of one screen render and
//! restores their flags afterwards, so every other path (print, export,
//! compare) sees the document unchanged.
//!
//! Shared by the pdfium-worker sidecar and the in-process renderer of the app
//! (included there with `#[path]`).

use pdfium_render::prelude::*;

/// Field types that the HTML form layer draws itself.
fn drawn_as_html(field_type: PdfFormFieldType) -> bool {
    matches!(
        field_type,
        PdfFormFieldType::Text
            | PdfFormFieldType::Checkbox
            | PdfFormFieldType::RadioButton
            | PdfFormFieldType::ComboBox
            | PdfFormFieldType::ListBox
    )
}

fn shown(annotation: &PdfPageAnnotation) -> bool {
    !annotation.is_hidden() && !annotation.is_printable_but_not_viewable()
}

/// Editable widgets of one page, hidden while this value lives.
pub struct ScreenWidgets<'p, 'a> {
    page: &'p PdfPage<'a>,
    /// Annotation index of each widget hidden here (all were shown before).
    hidden: Vec<usize>,
    /// Page-space rectangles of the visible widgets that PDFium must draw.
    faces: Vec<PdfRect>,
}

impl<'p, 'a> ScreenWidgets<'p, 'a> {
    /// Look at the widgets of `page`. Only when it has a visible widget that
    /// the HTML layer cannot draw are the editable widgets hidden; otherwise
    /// the page is left alone and the screen render needs no form pass.
    pub fn prepare(page: &'p PdfPage<'a>) -> Self {
        let mut editable = Vec::new();
        let mut faces = Vec::new();
        for (index, annotation) in page.annotations().iter().enumerate() {
            let Some(widget) = annotation.as_widget_annotation() else { continue };
            if !shown(&annotation) {
                continue;
            }
            match widget.form_field().map(|field| field.field_type()) {
                Some(field_type) if drawn_as_html(field_type) => editable.push(index),
                // Signature, push button, or a field PDFium cannot type:
                // PDF.js shows none of these as HTML.
                Some(_) => {
                    if let Ok(rect) = annotation.bounds() {
                        faces.push(rect);
                    }
                }
                // No form environment: the form pass would draw nothing.
                None => {}
            }
        }
        let mut this = ScreenWidgets { page, hidden: Vec::new(), faces };
        if !this.faces.is_empty() {
            for index in editable {
                if this.set_hidden(index, true) {
                    this.hidden.push(index);
                }
            }
        }
        this
    }

    /// Whether the screen render needs PDFium's form pass.
    pub fn render_form_data(&self) -> bool {
        !self.faces.is_empty()
    }

    fn set_hidden(&self, index: usize, hidden: bool) -> bool {
        match self.page.annotations().get(index) {
            Ok(mut annotation) => annotation.set_is_hidden(hidden).is_ok(),
            Err(_) => false,
        }
    }

    /// Draw the signature and push-button faces into a screen tile.
    ///
    /// A tile is rendered with a matrix, and PDFium's form pass has none. So
    /// for each face that meets the tile, the part of the tile under it is
    /// rendered twice the way a whole page is (page size at `scale`, shifted
    /// origin): once with the faces and once without. Only the pixels that
    /// differ are copied into the tile, so the page drawing in the tile keeps
    /// its own pixels.
    ///
    /// `rgba` is the tile (RGBA, `width` x `height`); its top-left corner is
    /// at (`left`, `top`) pixels on the page at `scale`, in display space.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_faces_into_tile(&self, rgba: &mut [u8], width: usize, height: usize, scale: f32, left: f32, top: f32, lcd_text: bool) {
        if self.faces.is_empty() || width == 0 || height == 0 || rgba.len() < width * height * 4 {
            return;
        }
        let page_w = (self.page.width().value * scale).round().max(1.0);
        let page_h = (self.page.height().value * scale).round().max(1.0);
        if !(page_w < i32::MAX as f32 && page_h < i32::MAX as f32 && left.is_finite() && top.is_finite()) {
            return;
        }
        let page_px = (page_w as i32, page_h as i32);
        let mapping = PdfRenderConfig::new().set_fixed_size(page_px.0, page_px.1);
        let (left, top) = (left.round() as i64, top.round() as i64);
        for rect in &self.faces {
            // Display-space bounding box of the face in tile pixels, 2 px margin.
            let corners = [
                (rect.left(), rect.bottom()),
                (rect.right(), rect.top()),
                (rect.left(), rect.top()),
                (rect.right(), rect.bottom()),
            ];
            let mut bbox: Option<(i64, i64, i64, i64)> = None;
            for (x, y) in corners {
                let Ok((px, py)) = self.page.points_to_pixels(x, y, &mapping) else { continue };
                let (px, py) = (px as i64 - left, py as i64 - top);
                bbox = Some(match bbox {
                    None => (px, py, px, py),
                    Some((x0, y0, x1, y1)) => (x0.min(px), y0.min(py), x1.max(px), y1.max(py)),
                });
            }
            let Some((x0, y0, x1, y1)) = bbox else { continue };
            let (x0, y0) = ((x0 - 2).max(0), (y0 - 2).max(0));
            let (x1, y1) = ((x1 + 2).min(width as i64), (y1 + 2).min(height as i64));
            if x1 <= x0 || y1 <= y0 {
                continue;
            }
            let (w, h) = ((x1 - x0) as usize, (y1 - y0) as usize);
            let origin = (-(left + x0) as i32, -(top + y0) as i32);
            let render = || -> Option<Vec<u8>> {
                let config = PdfRenderConfig::new()
                    .set_fixed_size(page_px.0, page_px.1)
                    .set_origin(origin.0, origin.1)
                    .render_form_data(true)
                    .render_annotations(false)
                    .use_lcd_text_rendering(lcd_text)
                    .set_format(PdfBitmapFormat::BGRA);
                let mut bitmap = PdfBitmap::empty(w as i32, h as i32, PdfBitmapFormat::BGRA).ok()?;
                self.page.render_into_bitmap_with_config(&mut bitmap, &config).ok()?;
                let rgba = bitmap.as_rgba_bytes();
                (rgba.len() == w * h * 4).then_some(rgba)
            };
            let Some(with) = render() else { continue };
            let without = {
                let faces = self.hide_faces();
                let without = render();
                for index in faces {
                    self.set_hidden(index, false);
                }
                without
            };
            let Some(without) = without else { continue };
            for y in 0..h {
                for x in 0..w {
                    let o = (y * w + x) * 4;
                    if with[o..o + 4] == without[o..o + 4] {
                        continue;
                    }
                    let t = ((y0 as usize + y) * width + x0 as usize + x) * 4;
                    rgba[t..t + 4].copy_from_slice(&with[o..o + 4]);
                }
            }
        }
    }

    /// Hide the visible widgets that are not hidden yet (the faces); returns
    /// what to restore.
    fn hide_faces(&self) -> Vec<usize> {
        let mut hidden = Vec::new();
        for (index, annotation) in self.page.annotations().iter().enumerate() {
            if annotation.as_widget_annotation().is_some() && shown(&annotation) && self.set_hidden(index, true) {
                hidden.push(index);
            }
        }
        hidden
    }
}

impl Drop for ScreenWidgets<'_, '_> {
    fn drop(&mut self) {
        for &index in &self.hidden {
            self.set_hidden(index, false);
        }
    }
}
