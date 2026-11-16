#[path = "render_budget.rs"]
mod render_budget;
use render_budget::{dimensions, SCREEN_RGBA_BYTES};
#[path = "screen_widgets.rs"]
mod screen_widgets;
use screen_widgets::ScreenWidgets;
use anyhow::{anyhow, Context, Result};
use pdfium_render::prelude::*;
use std::sync::OnceLock;

pub struct RenderResult {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

// Eén Pdfium-instantie voor de levensduur van de worker. Nodig om geladen
// documenten te kunnen CACHEN: PdfDocument leent van Pdfium, en via een
// 'static Pdfium krijgt de handle een 'static levensduur (zelfde patroon als
// pdfium_renderer.rs in de app). NB: pdfium-render staat maar ÉÉN binding per
// proces toe (PdfiumLibraryBindingsAlreadyInitialized) — alles loopt dus via
// deze ene instantie.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

pub(crate) fn pdfium() -> Result<&'static Pdfium> {
    if PDFIUM.get().is_none() {
        // Zoekvolgorde voor de PDFium-bibliotheek:
        //   1. systeem-zoekpad (Windows vindt pdfium.dll naast de exe);
        //   2. naast de sidecar-binary zelf;
        //   3. ../Resources t.o.v. de binary — op macOS draait de sidecar in
        //      Contents/MacOS terwijl de gebundelde libpdfium.dylib als resource
        //      in Contents/Resources staat;
        //   4. ../lib/<productName> t.o.v. de binary — de .deb en de AppImage
        //      zetten de sidecar in usr/bin en de resources (libpdfium.so) in
        //      usr/lib/Open PDF Studio, Tauri's resource_dir op Linux (#923);
        //   5. de huidige werkdirectory (dev / handmatige runs).
        // Zonder 2-4 zou de worker op macOS/Linux geen bibliotheek vinden;
        // Ready komt dan nooit en de app rendert alles in-proc.
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let res_dir = exe_dir.join("../Resources");
        let linux_res_dir = exe_dir.join("../lib/Open PDF Studio");
        let bindings = Pdfium::bind_to_system_library()
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&exe_dir)))
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&res_dir)))
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&linux_res_dir)))
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./")))
            .or_else(|e| test_library().map_or(Err(e), Pdfium::bind_to_library))
            .context("PDFium library not found (system, exe-dir, ../Resources, ../lib/Open PDF Studio, or ./)")?;
        let _ = PDFIUM.set(Pdfium::new(bindings));
    }
    Ok(PDFIUM.get().expect("PDFIUM set above"))
}

/// Unit tests (`cargo test -p pdfium-worker`): de meegeleverde PDFium uit
/// open-pdf-studio/src-tauri/binaries, zodat de tests zonder PATH-instelling
/// draaien. Buiten tests nooit.
#[cfg(test)]
fn test_library() -> Option<std::path::PathBuf> {
    let platform = if cfg!(windows) {
        if cfg!(target_arch = "aarch64") { "win-arm64" } else { "win-x64" }
    } else if cfg!(target_os = "macos") {
        "macos-universal"
    } else {
        "linux-x64"
    };
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries")
        .join(platform);
    Some(Pdfium::pdfium_platform_library_name_at_path(&dir)).filter(|p| p.exists())
}

#[cfg(not(test))]
fn test_library() -> Option<std::path::PathBuf> {
    None
}

/// PDFium voor unit tests van de worker (zie `test_library`).
#[cfg(test)]
pub(crate) fn pdfium_for_tests() -> &'static Pdfium {
    pdfium().expect("PDFium voor de tests (open-pdf-studio/src-tauri/binaries)")
}

/// Gecachet geladen document + open pagina-handle. Houdt de bytes levend voor
/// de document-levensduur; VELDVOLGORDE = DROP-VOLGORDE: `page` leent uit
/// `document`, `document` leent uit `_bytes`.
///
/// Safety: `document` leent uit `_bytes` (heap-buffer verplaatst niet, ook
/// niet als de struct move't) en uit PDFIUM ('static, nooit gedropt). `page`
/// leent uit `document`; de entry zit in een Box zodat het document-adres
/// stabiel is, ook als de cache-Vec verplaatst. De bytes leven per
/// constructie langer dan document en pagina binnen deze struct.
struct CachedDoc {
    path: String,
    mtime: Option<std::time::SystemTime>,
    len: u64,
    /// Open handle met pagina-index en parse-duur in ms. De parse-duur bepaalt
    /// of de handle na de render blijft leven (zie release_page_if_cheap).
    page: Option<OpenPage>,
    /// Ruwe tweede handle voor de zoektekst (page_text/mod.rs), pas bij de
    /// eerste tekstaanvraag geopend; leent net als `document` uit `_bytes`.
    text: Option<crate::page_text::RuwDocument>,
    document: PdfDocument<'static>,
    _bytes: Vec<u8>,
}

// Structuurboom (#634): pdfium-render opent sinds 0.9.5 de structuurboom van
// een pagina niet meer bij het openen van die pagina (vóór 0.9.5 riep ELKE
// PdfPage `FPDF_StructTree_GetForPage` aan, en PDFium hield de geparste
// structuur-objecten vast tot het document sloot). De worker leest de boom
// nergens, dus een getagd document stapelt bij doorbladeren geen
// structuurdata meer op en hoeft niet meer periodiek vers geladen te worden.

/// Laad een document uit bytes die de aanroeper levend houdt (zie CachedDoc).
///
/// Safety: de aanroeper garandeert dat `bytes` niet verplaatst of vrijkomt
/// zolang het teruggegeven document bestaat.
unsafe fn load_document(bytes: &[u8]) -> Result<PdfDocument<'static>> {
    let bytes_ref: &'static [u8] = std::slice::from_raw_parts(bytes.as_ptr(), bytes.len());
    pdfium()?
        .load_pdf_from_byte_slice(bytes_ref, None)
        .map_err(|e| anyhow!("PDFium parse: {}", e))
}

/// Een open pagina-handle. Blijft bij zware pagina's tussen renders leven, dus
/// ook de lijndiktes die Thin Lines (#595) erop zette: `thin_originals` houdt
/// de echte diktes vast zodat een render zonder Thin Lines ze terugzet.
struct OpenPage {
    index: u32,
    load_ms: u32,
    thin_originals: Option<Vec<f32>>,
    page: PdfPage<'static>,
}

impl OpenPage {
    /// Breng de lijndiktes van deze handle in de gevraagde stand.
    fn set_thin_lines(&mut self, want_thin: bool) {
        use crate::thin_lines::{restore_strokes, stroke_mode_change, thin_strokes, StrokeModeChange};
        match stroke_mode_change(self.thin_originals.is_some(), want_thin) {
            StrokeModeChange::None => {}
            StrokeModeChange::Thin => self.thin_originals = Some(thin_strokes(&self.page)),
            StrokeModeChange::Restore => {
                if let Some(originals) = self.thin_originals.take() {
                    restore_strokes(&self.page, &originals);
                }
            }
        }
    }
}

/// Max gecachete documenten per worker. Zware CAD-documenten kunnen honderden
/// MB's parse-state dragen; 2 dekt "actief document + vergelijk-/vorig doc"
/// zonder het werkgeheugen te laten ontsporen.
const DOC_CACHE_CAP: usize = 2;

pub struct Renderer {
    cache: Vec<Box<CachedDoc>>,
}

impl Renderer {
    pub fn new() -> Result<Self> {
        // Bind PDFium meteen zodat een ontbrekende DLL bij worker-start faalt
        // (Ready wordt dan nooit gemeld) i.p.v. pas bij de eerste render.
        pdfium()?;
        Ok(Self { cache: Vec::new() })
    }

    /// Cache-lookup met verversing: hit alleen als pad + mtime + lengte
    /// overeenkomen (het bestand kan herschreven zijn door opslaan van
    /// annotaties). Miss → lees + parse en evict de oudste boven de cap.
    /// De parse van een zwaar CAD-document kost seconden — deze cache is
    /// wat regio-tegels goedkoop maakt.
    fn get_or_load(&mut self, path: &str) -> Result<usize> {
        let meta = std::fs::metadata(path).with_context(|| format!("stat {}", path))?;
        let mtime = meta.modified().ok();
        let len = meta.len();

        if let Some(i) = self.cache.iter().position(|c| c.path == path && c.mtime == mtime && c.len == len) {
            return Ok(i);
        }
        // Verouderde versie van hetzelfde pad weggooien.
        self.cache.retain(|c| c.path != path);

        let original = std::fs::read(path).with_context(|| format!("read {}", path))?;
        // Safety: zie CachedDoc — buffer-adres is stabiel (ook als de Vec
        // daarna verplaatst) en de bytes blijven in dezelfde struct levend
        // zolang het document bestaat.
        let load = |bytes: &Vec<u8>| -> Result<PdfDocument<'static>> { unsafe { load_document(bytes) } };
        // Tiny mesh shadings get a render-only /BBox (#395); only this
        // in-memory copy changes, never the file. Should PDFium reject the
        // patched copy, the original bytes are rendered as before.
        let (bytes, document) = match crate::mesh_bbox::bound_tiny_mesh_shadings(&original) {
            Some(patched) => match load(&patched) {
                Ok(document) => (patched, document),
                Err(e) => {
                    eprintln!("[mesh-bbox] patched copy rejected ({}); rendering the original", e);
                    let document = load(&original)?;
                    (original, document)
                }
            },
            None => {
                let document = load(&original)?;
                (original, document)
            }
        };

        if self.cache.len() >= DOC_CACHE_CAP {
            self.cache.remove(0);
        }
        self.cache.push(Box::new(CachedDoc {
            path: path.to_string(),
            mtime,
            len,
            page: None,
            text: None,
            document,
            _bytes: bytes,
        }));
        Ok(self.cache.len() - 1)
    }

    /// Sluit alle open pagina-handles (de dure parse-state); documenten en
    /// bytes blijven. De volgende render op die pagina betaalt eenmalig de
    /// her-parse. Aangeroepen bij pool-inactiviteit om het werkgeheugen van
    /// zware CAD-pagina's (ruim 1 GB per open handle) terug te geven.
    pub fn trim(&mut self) {
        for e in self.cache.iter_mut() {
            e.page = None;
            e.text = None;
        }
    }

    /// Zoektekst van pagina's `first..first + count` (page_text/mod.rs),
    /// gecodeerd als `OPT1`. Stopt eerder zodra `budget_ms` verstreken is (na
    /// minstens één pagina) of het antwoord de helft van de SHM-regio vult,
    /// zodat tegelrenders op deze worker niet lang hoeven te wachten; de app
    /// vraagt de rest daarna op. `expect_len`: de lengte die de app van het
    /// bestand heeft; wijkt het bestand op schijf af, dan een fout (de app
    /// leest dan met pdf.js).
    /// Geeft (bytes, gecodeerde pagina's, pagina's in het document).
    pub fn page_text(&mut self, path: &str, first: u32, count: u32, expect_len: Option<u64>, budget_ms: u32) -> Result<(Vec<u8>, u32, u32)> {
        let idx = self.get_or_load(path)?;
        if let Some(expect) = expect_len {
            if self.cache[idx].len != expect {
                return Err(anyhow!("PDF_TEXT_STALE: file on disk is {} bytes, the app has {}", self.cache[idx].len, expect));
            }
        }
        let entry = &mut self.cache[idx];
        if entry.text.is_none() {
            let bindings = pdfium()?.bindings();
            // Safety: de bytes leven in dezelfde entry en dropen na `text`.
            entry.text = Some(unsafe { crate::page_text::RuwDocument::open(bindings, &entry._bytes)? });
        }
        let doc = entry.text.as_ref().expect("zojuist gezet");
        let total = doc.page_count();
        let mut out = Vec::new();
        crate::page_text::encode_header(&mut out, total);
        let t0 = std::time::Instant::now();
        let end = first.saturating_add(count).min(total);
        let mut done = 0u32;
        for index in first..end {
            let page = doc.pagina(index)?;
            crate::page_text::encode_page(&mut out, &page);
            done += 1;
            if t0.elapsed().as_millis() >= u128::from(budget_ms) || out.len() > crate::shm::PAYLOAD_CAP / 2 {
                break;
            }
        }
        crate::page_text::zet_aantal(&mut out, done);
        Ok((out, done, total))
    }

    /// Open (of hergebruik) de pagina-handle. FPDF_LoadPage parset de volledige
    /// content-stream — op zware CAD-pagina's SECONDEN per keer, en dat gebeurde
    /// voorheen bij ÉLKE regio-render opnieuw. Met een open handle betaalt
    /// alleen de eerste render die parse; daarna is een tegel puur rasterwerk.
    fn get_or_load_page(&mut self, doc_idx: usize, page_index: u32, thin_lines: bool) -> Result<&PdfPage<'static>> {
        let open = self.open_page(doc_idx, page_index)?;
        open.set_thin_lines(thin_lines);
        Ok(&open.page)
    }

    /// Open (of hergebruik) de pagina-handle zonder de lijndiktes aan te raken.
    fn open_page(&mut self, doc_idx: usize, page_index: u32) -> Result<&mut OpenPage> {
        let entry = &mut self.cache[doc_idx];
        let reuse = matches!(&entry.page, Some(open) if open.index == page_index);
        if !reuse {
            entry.page = None; // oude handle expliciet sluiten vóór de nieuwe opent
            // Safety: het document zit in een Box (stabiel heap-adres, ook als de
            // cache-Vec verplaatst) en leeft zolang deze entry bestaat; `page`
            // staat vóór `document` in de struct en dropt dus altijd eerder.
            let doc_ref: &'static PdfDocument<'static> =
                unsafe { &*(&entry.document as *const PdfDocument<'static>) };
            let t0 = std::time::Instant::now();
            let page = doc_ref
                .pages()
                .get(page_index as i32)
                .map_err(|e| anyhow!("page {}: {}", page_index, e))?;
            let load_ms = t0.elapsed().as_millis() as u32;
            entry.page = Some(OpenPage { index: page_index, load_ms, thin_originals: None, page });
        }
        Ok(self.cache[doc_idx].page.as_mut().expect("zojuist gezet"))
    }

    /// Sluit de pagina-handle weer als de parse GOEDKOOP was. Alleen zware
    /// pagina's (parse in de honderden ms tot seconden — grote CAD-bladen)
    /// verdienen de open handle met zijn forse parse-state (~1 GB op extreme
    /// bladen); normale pagina's parsen in enkele tientallen ms en hun handle
    /// vasthouden zou bij veel tabs/documenten onnodig geheugen stapelen.
    fn release_page_if_cheap(&mut self, doc_idx: usize) {
        const KEEP_HANDLE_MS: u32 = 250;
        if let Some(open) = &self.cache[doc_idx].page {
            if open.load_ms < KEEP_HANDLE_MS {
                self.cache[doc_idx].page = None;
            }
        }
    }

    /// Snap-geometrie van een pagina (zie snap_geometry.rs), gecodeerd voor de
    /// app. `viewport` = de weergavematrix van de pagina bij schaal 1 die de app
    /// zelf gebruikt. Leest de pagina die PDFium voor het tekenen al geparst
    /// heeft (open handle van een zware pagina); de lijndiktes van Thin Lines
    /// blijven zoals ze zijn, die doen voor de geometrie niet ter zake.
    pub fn snap_geometry(&mut self, path: &str, page_index: u32, viewport: [f64; 6]) -> Result<Vec<u8>> {
        if viewport.iter().any(|v| !v.is_finite()) {
            return Err(anyhow!("PDF_INVALID_GEOMETRY: non-finite viewport"));
        }
        let idx = self.get_or_load(path)?;
        let bytes = {
            let open = self.open_page(idx, page_index)?;
            crate::snap_geometry::uit_pagina(&open.page, viewport).afronden()
        };
        self.release_page_if_cheap(idx);
        Ok(bytes)
    }

    /// Whole page for the screen; see `render_with_forms`.
    #[cfg(test)]
    pub fn render(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        thin_lines: bool,
    ) -> Result<RenderResult> {
        self.render_with_forms(path, page_index, scale, rotation, thin_lines, false)
    }

    /// Whole page. `all_forms`: every widget's stored appearance, for a
    /// picture without the HTML form layer on top (page thumbnails). Without
    /// it the screen look: editable fields are left out (#1101).
    pub fn render_with_forms(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        thin_lines: bool,
        all_forms: bool,
    ) -> Result<RenderResult> {
        let idx = self.get_or_load(path)?;
        let result = {
            let page = self.get_or_load_page(idx, page_index, thin_lines)?;

            let w_pt = page.width().value;
            let h_pt = page.height().value;
            // Past de bitmap niet in de SHM-regio, dan meteen een nette fout i.p.v.
            // eerst volledig rasteren; de app valt dan terug op in-proc. Ook bij
            // die fout geen open handle van een goedkope pagina vasthouden.
            let (target_w, target_h) = match dimensions(w_pt, h_pt, scale, SCREEN_RGBA_BYTES) {
                Ok(maat) => maat,
                Err(e) => {
                    self.release_page_if_cheap(idx);
                    return Err(e.into());
                }
            };

            let rot = match rotation.rem_euclid(360) {
                0 => PdfPageRenderRotation::None,
                90 => PdfPageRenderRotation::Degrees90,
                180 => PdfPageRenderRotation::Degrees180,
                270 => PdfPageRenderRotation::Degrees270,
                other => return Err(anyhow!("unsupported rotation {}", other)),
            };

            // Editable fields belong to the PDF.js form layer (#1101): baking
            // their saved appearance here leaves stale text after edits. The
            // form pass stays for signatures and push buttons, which that
            // layer cannot draw; the editable widgets are hidden meanwhile.
            let widgets = (!all_forms).then(|| ScreenWidgets::prepare(page));
            let config = PdfRenderConfig::new()
                .set_target_width(target_w)
                .set_maximum_height(target_h)
                .rotate(rot, true)
                .render_form_data(widgets.as_ref().is_none_or(|w| w.render_form_data()))
                .render_annotations(false)
                .use_lcd_text_rendering(true)
                .set_format(PdfBitmapFormat::BGRA);

            let bitmap = page.render_with_config(&config)
                .map_err(|e| anyhow!("PDFium render: {}", e))?;
            drop(widgets);

            RenderResult {
                width: bitmap.width() as u32,
                height: bitmap.height() as u32,
                rgba: bitmap.as_rgba_bytes(),
            }
        };
        // Goedkope pagina's houden geen open handle vast (geheugen-garantie
        // voor normale PDF's); zware behouden hem voor snelle vervolg-tegels.
        self.release_page_if_cheap(idx);
        Ok(result)
    }

    /// Pad-identiteit (mtime + lengte) zoals de documentcache hem gebruikt:
    /// sleutel voor afgeleide caches (de inktmaskers van Vergelijken).
    pub fn file_identity(path: &str) -> Result<(Option<std::time::SystemTime>, u64)> {
        let meta = std::fs::metadata(path).with_context(|| format!("stat {}", path))?;
        Ok((meta.modified().ok(), meta.len()))
    }

    /// Render tegels van een pagina voor Vergelijken (#465): elke tegel
    /// (x, y, w, h in pixels) op `scale` pixels per punt, wit papier,
    /// annotatie-weergaven en formuliervelden mee (zoals pdf.js met intent
    /// 'display'), geen LCD-tekst. `each` krijgt per tegel de BGRA-pixels (rijbreedte w·4).
    /// De pagina blijft open tussen de tegels en wordt daarna (als hij
    /// goedkoop was) weer gesloten.
    pub fn render_tiles(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f64,
        tiles: &[(usize, usize, usize, usize)],
        mut each: impl FnMut(usize, &[u8]),
    ) -> Result<()> {
        let idx = self.get_or_load(path)?;
        let result = (|| -> Result<()> {
            let page = self.get_or_load_page(idx, page_index, false)?;
            // Formuliervelden tekent PDFium alleen in de formulier-stap
            // (FPDF_FFLDraw), niet als annotatie; pdf.js tekent ze wel. Die
            // stap kent geen matrix: op een pagina met velden gaat de tegel
            // daarom via de hele pagina op schaal met een verschoven oorsprong.
            let has_fields = page.annotations().iter().any(|a| a.annotation_type() == PdfPageAnnotationType::Widget);
            let page_px = (
                (page.width().value as f64 * scale).round().max(1.0) as i32,
                (page.height().value as f64 * scale).round().max(1.0) as i32,
            );
            for (i, &(x, y, w, h)) in tiles.iter().enumerate() {
                if w == 0 || h == 0 || w > i32::MAX as usize || h > i32::MAX as usize {
                    return Err(anyhow!("PDF_INVALID_GEOMETRY: compare tile {}x{}", w, h));
                }
                let bitmap = if has_fields {
                    let config = PdfRenderConfig::new()
                        .set_fixed_size(page_px.0, page_px.1)
                        .set_origin(-(x as i32), -(y as i32))
                        .render_annotations(true)
                        .render_form_data(true)
                        .use_lcd_text_rendering(false)
                        .set_format(PdfBitmapFormat::BGRA);
                    let mut bitmap = PdfBitmap::empty(w as i32, h as i32, PdfBitmapFormat::BGRA)
                        .map_err(|e| anyhow!("PDFium compare bitmap: {}", e))?;
                    page.render_into_bitmap_with_config(&mut bitmap, &config)
                        .map_err(|e| anyhow!("PDFium compare render: {}", e))?;
                    bitmap
                } else {
                    let config = PdfRenderConfig::new()
                        .set_fixed_size(w as i32, h as i32)
                        .transform(scale as f32, 0.0, 0.0, scale as f32, -(x as f32), -(y as f32))
                        .map_err(|e| anyhow!("invalid transform: {}", e))?
                        .render_annotations(true)
                        .render_form_data(false)
                        .use_lcd_text_rendering(false)
                        .set_format(PdfBitmapFormat::BGRA);
                    page.render_with_config(&config).map_err(|e| anyhow!("PDFium compare render: {}", e))?
                };
                let raw = bitmap.as_raw_bytes();
                let stride = raw.len() / h;
                if stride == w * 4 {
                    each(i, &raw);
                } else if stride > w * 4 {
                    let mut packed = Vec::with_capacity(w * h * 4);
                    for row in raw.chunks(stride).take(h) {
                        packed.extend_from_slice(&row[..w * 4]);
                    }
                    each(i, &packed);
                } else {
                    return Err(anyhow!("PDFium compare render: bitmap stride {} < {}", stride, w * 4));
                }
            }
            Ok(())
        })();
        self.release_page_if_cheap(idx);
        result
    }

    /// Render een hele pagina op precies `width` x `height` pixels voor het
    /// pixelwerk van symbolen zoeken en formulierherkenning (raster_scan):
    /// wit papier, geen annotaties of formuliervelden (pdf.js annotationMode
    /// 0), geen LCD-tekst. `rotation` is de draaiing bovenop /Rotate, zoals bij
    /// `render`; de maat is die van het gedraaide beeld. Geeft BGRA terug,
    /// rijbreedte `width * 4`.
    pub fn render_scan(&mut self, path: &str, page_index: u32, width: usize, height: usize, rotation: i32) -> Result<Vec<u8>> {
        if width == 0 || height == 0 || width > 16_384 || height > 16_384 {
            return Err(anyhow!("PDF_INVALID_GEOMETRY: scan raster {}x{}", width, height));
        }
        let quarter = match rotation.rem_euclid(360) {
            r @ (0 | 90 | 180 | 270) => r / 90,
            other => return Err(anyhow!("unsupported rotation {}", other)),
        };
        let idx = self.get_or_load(path)?;
        let result = (|| -> Result<Vec<u8>> {
            let page = self.get_or_load_page(idx, page_index, false)?;
            // De matrix werkt in weergaveruimte (na /Rotate, y omlaag, zie
            // render_region); de extra draaiing gaat erin mee. (pw, ph) is de
            // pagina zoals PDFium hem zonder extra draaiing toont.
            let (pw, ph) = (page.width().value, page.height().value);
            let (w, h) = (width as f32, height as f32);
            let m = match quarter {
                0 => (w / pw, 0.0, 0.0, h / ph, 0.0, 0.0),
                1 => (0.0, h / pw, -w / ph, 0.0, w, 0.0),
                2 => (-w / pw, 0.0, 0.0, -h / ph, w, h),
                _ => (0.0, -h / pw, w / ph, 0.0, 0.0, h),
            };
            let config = PdfRenderConfig::new()
                .set_fixed_size(width as i32, height as i32)
                .transform(m.0, m.1, m.2, m.3, m.4, m.5)
                .map_err(|e| anyhow!("invalid transform: {}", e))?
                .render_annotations(false)
                .render_form_data(false)
                .use_lcd_text_rendering(false)
                .set_format(PdfBitmapFormat::BGRA);
            let bitmap = page.render_with_config(&config).map_err(|e| anyhow!("PDFium scan render: {}", e))?;
            if bitmap.width() as usize != width || bitmap.height() as usize != height {
                return Err(anyhow!("PDFium scan render: {}x{} instead of {}x{}", bitmap.width(), bitmap.height(), width, height));
            }
            let raw = bitmap.as_raw_bytes();
            let stride = raw.len() / height;
            if stride == width * 4 {
                return Ok(raw);
            }
            if stride < width * 4 {
                return Err(anyhow!("PDFium scan render: bitmap stride {} < {}", stride, width * 4));
            }
            let mut packed = Vec::with_capacity(width * height * 4);
            for row in raw.chunks(stride).take(height) {
                packed.extend_from_slice(&row[..width * 4]);
            }
            Ok(packed)
        })();
        self.release_page_if_cheap(idx);
        result
    }

    /// Render a sub-region of a page at `scale` into an output bitmap of
    /// (region_w_pt*scale × region_h_pt*scale) px. `rotation` (extra
    /// gebruikersrotatie) must be 0.
    ///
    /// De regio-coördinaten komen uit de viewer in WEERGAVE-ruimte (na de
    /// intrinsieke /Rotate van de pagina). De matrix-API van PDFium werkt
    /// in RUWE paginaruimte, dus voor /Rotate-pagina's wordt de rotatie in
    /// de matrix meegebakken.
    pub fn render_region(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        region_x_pt: f32,
        region_y_pt: f32,
        region_w_pt: f32,
        region_h_pt: f32,
        thin_lines: bool,
        annotations: bool,
    ) -> Result<RenderResult> {
        if rotation != 0 {
            return Err(anyhow!("render_region: rotation {} not supported", rotation));
        }
        if region_w_pt <= 0.0 || region_h_pt <= 0.0 {
            return Err(anyhow!("render_region: region must be positive"));
        }
        // Bitmap-afmetingen hangen alleen van regio + schaal af: valideer ze
        // (incl. de SHM-grens) voordat het document/de pagina geladen wordt.
        let (bitmap_w, bitmap_h) = dimensions(region_w_pt, region_h_pt, scale, SCREEN_RGBA_BYTES)?;
        if !region_x_pt.is_finite() || !region_y_pt.is_finite() ||
            !(region_x_pt * scale).is_finite() || !(region_y_pt * scale).is_finite() {
            return Err(anyhow!("PDF_INVALID_GEOMETRY: non-finite tile origin"));
        }
        let idx = self.get_or_load(path)?;
        let result = {
            let page = self.get_or_load_page(idx, page_index, thin_lines)?;

            // De matrix van FPDF_RenderPageBitmapWithMatrix werkt in WEERGAVE-ruimte
            // (ná de intrinsieke /Rotate van de pagina), y-omlaag vanaf linksboven —
            // exact de ruimte waarin de viewer regio's aanlevert. Empirisch
            // vastgesteld met hoek-probes op /Rotate=0- én /Rotate=90-pagina's
            // (titelblok/logo-ankers): een plain schaal+translatie-matrix levert
            // voor élke paginarotatie de juiste tegel. Geen rotatie-mapping nodig.
            let config = PdfRenderConfig::new()
                .set_fixed_size(bitmap_w, bitmap_h)
                .transform(scale, 0.0, 0.0, scale, -region_x_pt * scale, -region_y_pt * scale)
                .map_err(|e2| anyhow!("invalid transform: {}", e2))?
                .render_annotations(annotations)
                .use_lcd_text_rendering(!annotations)
                .set_format(PdfBitmapFormat::BGRA);

            let bitmap = page.render_with_config(&config)
                .map_err(|e| anyhow!("PDFium region render: {}", e))?;
            let (width, height) = (bitmap.width() as u32, bitmap.height() as u32);
            let mut rgba = bitmap.as_rgba_bytes();
            // A matrix render has no form pass: signatures and push buttons
            // (#1101) are drawn in separately; editable fields stay out.
            ScreenWidgets::prepare(page).draw_faces_into_tile(
                &mut rgba, width as usize, height as usize, scale,
                region_x_pt * scale, region_y_pt * scale, true,
            );

            RenderResult { width, height, rgba }
        };
        // Goedkope pagina's houden geen open handle vast (geheugen-garantie
        // voor normale PDF's); zware behouden hem voor snelle vervolg-tegels.
        self.release_page_if_cheap(idx);
        Ok(result)
    }
}

#[cfg(test)]
#[path = "test_form.rs"]
mod test_form;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_budget_is_the_shm_payload() {
        assert_eq!(SCREEN_RGBA_BYTES, crate::shm::PAYLOAD_CAP as u64);
    }

    /// De pdfium-render-binding (pdfium_xxxx-feature in Cargo.toml) moet passen
    /// bij de meegeleverde PDFium: pdfium-render bindt alle functies bij het
    /// laden, en één ontbrekende export laat het binden mislukken. Vraagt
    /// PDFium op het bibliotheekpad (bijv. PATH=open-pdf-studio/src-tauri/binaries/win-x64).
    #[test]
    #[ignore]
    fn binds_the_bundled_pdfium() {
        Renderer::new().expect("pdfium-render binds the bundled PDFium");
    }

    /// Renders `bytes` page 0 the way `Renderer::render` (whole page) or
    /// `Renderer::render_region` (`tile` = x, y, w, h in points) does.
    fn render_bytes(bytes: &[u8], scale: f32, tile: Option<(f32, f32, f32, f32)>) -> (u32, u32, Vec<u8>, f64) {
        let document = pdfium().unwrap().load_pdf_from_byte_slice(bytes, None).unwrap();
        let page = document.pages().get(0).unwrap();
        // Same configs as render() and render_region(); a transform implies
        // no form data; whole screen pages must omit widgets as well.
        let config = match tile {
            None => {
                let (w, h) = dimensions(page.width().value, page.height().value, scale, SCREEN_RGBA_BYTES).unwrap();
                PdfRenderConfig::new().set_target_width(w).set_maximum_height(h).render_form_data(false)
            }
            Some((x, y, w, h)) => {
                let (bw, bh) = dimensions(w, h, scale, SCREEN_RGBA_BYTES).unwrap();
                PdfRenderConfig::new()
                    .set_fixed_size(bw, bh)
                    .transform(scale, 0.0, 0.0, scale, -x * scale, -y * scale)
                    .unwrap()
            }
        }
        .render_annotations(false)
        .use_lcd_text_rendering(true)
        .set_format(PdfBitmapFormat::BGRA);
        let t0 = std::time::Instant::now();
        let bitmap = page.render_with_config(&config).unwrap();
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        (bitmap.width() as u32, bitmap.height() as u32, bitmap.as_rgba_bytes(), ms)
    }

    use test_form::form_page;

    /// Compare tiles (x, y, w, h px at `scale`) of page 0 of `bytes`, via a file like the worker.
    fn compare_tiles(bytes: &[u8], name: &str, scale: f64, tiles: &[(usize, usize, usize, usize)]) -> Vec<Vec<u8>> {
        let path = std::env::temp_dir().join(format!("opds-worker-test-{}-{}.pdf", std::process::id(), name));
        std::fs::write(&path, bytes).unwrap();
        let mut renderer = Renderer::new().expect("renderer");
        let mut out = vec![Vec::new(); tiles.len()];
        renderer.render_tiles(path.to_str().unwrap(), 0, scale, tiles, |i, px| out[i] = px.to_vec()).unwrap();
        drop(renderer);
        let _ = std::fs::remove_file(&path);
        out
    }

    fn dark(px: &[u8], w: usize, x: usize, y: usize) -> bool {
        let o = (y * w + x) * 4;
        px[o] < 100 && px[o + 1] < 100 && px[o + 2] < 100
    }

    #[test]
    fn screen_render_leaves_widgets_to_interactive_layer() {
        for rotation in [0, 90, 180, 270] {
            let with = std::env::temp_dir().join(format!("opds-screen-form-{}-{rotation}.pdf", std::process::id()));
            let without = with.with_extension("plain.pdf");
            std::fs::write(&with, form_page(true, 0)).unwrap();
            std::fs::write(&without, form_page(false, 0)).unwrap();
            let mut renderer = Renderer::new().unwrap();
            for scale in [1.0, 2.0] {
                let form = renderer.render(with.to_str().unwrap(), 0, scale, rotation, false).unwrap();
                let plain = renderer.render(without.to_str().unwrap(), 0, scale, rotation, false).unwrap();
                assert_eq!((form.width, form.height), (plain.width, plain.height));
                assert!(form.rgba == plain.rgba, "stored widget must not be baked under editable field: rotation={rotation}, scale={scale}");
                if rotation == 0 {
                    let tile = renderer.render_region(with.to_str().unwrap(), 0, scale, 0, 50.0, 230.0, 200.0, 100.0, false, false).unwrap();
                    assert!(!dark(&tile.rgba, tile.width as usize, (100.0 * scale) as usize, (45.0 * scale) as usize));
                }
            }
            drop(renderer);
            std::fs::remove_file(with).unwrap();
            std::fs::remove_file(without).unwrap();
        }
    }

    /// `bytes` page 0 the way the output renderers draw it: whole page with
    /// PDFium's form pass, so every widget shows its stored appearance.
    fn render_with_forms(bytes: &[u8], scale: f32, rotation: i32) -> (u32, u32, Vec<u8>) {
        let document = pdfium().unwrap().load_pdf_from_byte_slice(bytes, None).unwrap();
        let page = document.pages().get(0).unwrap();
        let (w, h) = dimensions(page.width().value, page.height().value, scale, SCREEN_RGBA_BYTES).unwrap();
        let rot = match rotation {
            0 => PdfPageRenderRotation::None,
            90 => PdfPageRenderRotation::Degrees90,
            180 => PdfPageRenderRotation::Degrees180,
            _ => PdfPageRenderRotation::Degrees270,
        };
        let config = PdfRenderConfig::new()
            .set_target_width(w)
            .set_maximum_height(h)
            .rotate(rot, true)
            .render_form_data(true)
            .render_annotations(false)
            .use_lcd_text_rendering(true)
            .set_format(PdfBitmapFormat::BGRA);
        let bitmap = page.render_with_config(&config).unwrap();
        (bitmap.width() as u32, bitmap.height() as u32, bitmap.as_rgba_bytes())
    }

    fn rgb_at(px: &[u8], w: usize, (x, y): (usize, usize)) -> (u8, u8, u8) {
        let o = (y * w + x) * 4;
        (px[o], px[o + 1], px[o + 2])
    }

    fn temp_pdf(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("opds-screen-{}-{}.pdf", std::process::id(), name));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    /// The HTML form layer only draws editable fields. Signatures and push
    /// buttons have no HTML counterpart, so the screen bitmap must keep their
    /// stored appearance exactly as the output render draws it (#1101).
    #[test]
    fn screen_render_keeps_signature_and_button_faces() {
        use test_form::{centre_px, page_with, Widget::*};
        for rotate in [0, 90] {
            let all = temp_pdf(&format!("all-{rotate}"), &page_with(&[Text, Signature, PushButton], rotate));
            let faces = page_with(&[Signature, PushButton], rotate);
            let mut renderer = Renderer::new().unwrap();
            for rotation in [0, 90, 180, 270] {
                for scale in [1.0, 2.0] {
                    let screen = renderer.render(all.to_str().unwrap(), 0, scale, rotation, false).unwrap();
                    let expected = render_with_forms(&faces, scale, rotation);
                    assert_eq!((screen.width, screen.height), (expected.0, expected.1));
                    assert!(screen.rgba == expected.2, "screen must equal page + signature + button: /Rotate {rotate}, rotation {rotation}, scale {scale}");
                    if rotation == 0 {
                        let w = screen.width as usize;
                        assert_eq!(rgb_at(&screen.rgba, w, centre_px(Signature, rotate, scale)), (0, 0, 255));
                        assert_eq!(rgb_at(&screen.rgba, w, centre_px(PushButton, rotate, scale)), (255, 0, 0));
                        assert_eq!(rgb_at(&screen.rgba, w, centre_px(Text, rotate, scale)), (255, 255, 255));
                    }
                }
            }
            // The text field is hidden only for the screen render: output
            // paths on the same cached document still draw it.
            let mut tiles = Vec::new();
            renderer.render_tiles(all.to_str().unwrap(), 0, 1.0, &[(0, 0, 400, 400)], |_, px| tiles = px.to_vec()).unwrap();
            let (x, y) = centre_px(Text, rotate, 1.0);
            assert!(dark(&tiles, 400, x, y), "text field must stay visible outside the screen render: /Rotate {rotate}");
            drop(renderer);
            std::fs::remove_file(all).unwrap();
        }
    }

    /// Thumbnails have no form layer on top: they ask for every widget.
    #[test]
    fn render_with_forms_draws_every_widget() {
        use test_form::{centre_px, page_with, Widget::*};
        let all = temp_pdf("thumb-all", &page_with(&[Text, Signature, PushButton], 0));
        let mut renderer = Renderer::new().unwrap();
        let thumb = renderer.render_with_forms(all.to_str().unwrap(), 0, 1.0, 0, false, true).unwrap();
        let w = thumb.width as usize;
        assert_eq!(rgb_at(&thumb.rgba, w, centre_px(Text, 0, 1.0)), (0, 0, 0));
        assert_eq!(rgb_at(&thumb.rgba, w, centre_px(Signature, 0, 1.0)), (0, 0, 255));
        assert_eq!(rgb_at(&thumb.rgba, w, centre_px(PushButton, 0, 1.0)), (255, 0, 0));
        let screen = renderer.render_with_forms(all.to_str().unwrap(), 0, 1.0, 0, false, false).unwrap();
        assert_eq!(rgb_at(&screen.rgba, w, centre_px(Text, 0, 1.0)), (255, 255, 255));
        drop(renderer);
        std::fs::remove_file(all).unwrap();
    }

    /// High-zoom tiles: same rule as whole pages. Before #1101 tiles had no
    /// widgets at all, so a signature vanished when the view zoomed in.
    #[test]
    fn screen_tiles_keep_signature_and_button_faces() {
        use test_form::{centre_px, display_rect, page_with, Widget::*};
        for rotate in [0, 90] {
            let all = temp_pdf(&format!("tile-all-{rotate}"), &page_with(&[Text, Signature, PushButton], rotate));
            let plain = temp_pdf(&format!("tile-plain-{rotate}"), &page_with(&[], rotate));
            let mut renderer = Renderer::new().unwrap();
            for scale in [1.0f32, 2.0, 3.5] {
                let (rx, ry, rw, rh) = (40.0f32, 50.0f32, 330.0f32, 290.0f32);
                let tile = renderer.render_region(all.to_str().unwrap(), 0, scale, 0, rx, ry, rw, rh, false, false).unwrap();
                let bare = renderer.render_region(plain.to_str().unwrap(), 0, scale, 0, rx, ry, rw, rh, false, false).unwrap();
                assert_eq!((tile.width, tile.height), (bare.width, bare.height));
                let w = tile.width as usize;
                let local = |(x, y): (usize, usize)| (x - (rx * scale) as usize, y - (ry * scale) as usize);
                assert_eq!(rgb_at(&tile.rgba, w, local(centre_px(Signature, rotate, scale))), (0, 0, 255), "signature in tile: /Rotate {rotate}, scale {scale}");
                assert_eq!(rgb_at(&tile.rgba, w, local(centre_px(PushButton, rotate, scale))), (255, 0, 0), "button in tile: /Rotate {rotate}, scale {scale}");
                assert_eq!(rgb_at(&tile.rgba, w, local(centre_px(Text, rotate, scale))), (255, 255, 255), "no stale text field in tile: /Rotate {rotate}, scale {scale}");
                // Outside the two faces the tile is the plain page tile, pixel for pixel.
                let faces: Vec<_> = [Signature, PushButton].iter().map(|&f| display_rect(f, rotate, scale)).collect();
                for y in 0..tile.height as usize {
                    for x in 0..w {
                        let (px, py) = (x as f32 + rx * scale, y as f32 + ry * scale);
                        if faces.iter().any(|r| px >= r.0 - 2.0 && px <= r.2 + 2.0 && py >= r.1 - 2.0 && py <= r.3 + 2.0) {
                            continue;
                        }
                        let o = (y * w + x) * 4;
                        assert_eq!(tile.rgba[o..o + 4], bare.rgba[o..o + 4], "pixel ({x}, {y}) outside the faces changed: /Rotate {rotate}, scale {scale}");
                    }
                }
            }
            // A tile that cuts through the signature: only its part is drawn.
            let (sx0, sy0, _, _) = display_rect(Signature, rotate, 1.0);
            let tile = renderer.render_region(all.to_str().unwrap(), 0, 4.0, 0, sx0 + 10.0, sy0 + 10.0, 300.0, 300.0, false, false).unwrap();
            assert_eq!(rgb_at(&tile.rgba, tile.width as usize, (8, 8)), (0, 0, 255), "partly covered signature: /Rotate {rotate}");
            let mut tiles = Vec::new();
            renderer.render_tiles(all.to_str().unwrap(), 0, 1.0, &[(0, 0, 400, 400)], |_, px| tiles = px.to_vec()).unwrap();
            let (x, y) = centre_px(Text, rotate, 1.0);
            assert!(dark(&tiles, 400, x, y), "a screen tile must leave the text field flags as they were: /Rotate {rotate}");
            drop(renderer);
            std::fs::remove_file(all).unwrap();
            std::fs::remove_file(plain).unwrap();
        }
    }

    /// Vergelijken toont formuliervelden zoals pdf.js (intent 'display'):
    /// een gewijzigde veldwaarde moet in de inktmaskers zitten, anders meldt
    /// de desktop hem niet terwijl de webversie hem wel meldt.
    #[test]
    fn compare_tiles_draw_form_fields_like_pdfjs() {
        let tile = (50usize, 230usize, 200usize, 100usize); // displayed y: field at 250..300, x 100..200
        let met = compare_tiles(&form_page(true, 0), "met", 1.0, &[tile]);
        assert!(dark(&met[0], tile.2, 100, 45), "field appearance inside the tile");
        assert!(!dark(&met[0], tile.2, 20, 5), "paper outside the field stays white");
    }

    /// Met of zonder veld: de tekening zelf komt op dezelfde pixels, ook op
    /// een gedraaide pagina en in een verschoven tegel.
    #[test]
    fn compare_tiles_with_form_fields_keep_the_drawing_in_place() {
        for rotate in [0, 90] {
            let tiles = [(0usize, 0usize, 400usize, 400usize), (250, 30, 120, 90), (10, 300, 64, 100)];
            let met = compare_tiles(&form_page(true, rotate), &format!("met{rotate}"), 1.5, &tiles);
            let zonder = compare_tiles(&form_page(false, rotate), &format!("zonder{rotate}"), 1.5, &tiles);
            for (t, &(x0, y0, w, h)) in tiles.iter().enumerate() {
                let mut verschil = 0;
                for y in 0..h {
                    for x in 0..w {
                        // skip the field itself (display space at scale 1.5, both rotations, with a margin)
                        let (dx, dy) = ((x0 + x) as f64 / 1.5, (y0 + y) as f64 / 1.5);
                        let veld = if rotate == 0 { (95.0..205.0).contains(&dx) && (245.0..305.0).contains(&dy) } else { (95.0..155.0).contains(&dx) && (95.0..205.0).contains(&dy) };
                        if !veld && dark(&met[t], w, x, y) != dark(&zonder[t], w, x, y) {
                            verschil += 1;
                        }
                    }
                }
                assert_eq!(verschil, 0, "rotate {rotate}, tile {t}: drawing moved");
                let veld_inkt = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).filter(|&(x, y)| dark(&met[t], w, x, y) && !dark(&zonder[t], w, x, y)).count();
                if t == 0 {
                    assert!(veld_inkt > 1000, "rotate {rotate}: the field is drawn ({veld_inkt} px)");
                }
            }
        }
    }

    fn scan(bytes: &[u8], name: &str, w: usize, h: usize, rotation: i32) -> Vec<u8> {
        let path = std::env::temp_dir().join(format!("opds-worker-scan-{}-{}.pdf", std::process::id(), name));
        std::fs::write(&path, bytes).unwrap();
        let mut renderer = Renderer::new().expect("renderer");
        let out = renderer.render_scan(path.to_str().unwrap(), 0, w, h, rotation);
        drop(renderer);
        let _ = std::fs::remove_file(&path);
        out.unwrap()
    }

    /// The scan raster shows the page as pdf.js does for the same total
    /// rotation: the short diagonal stroke of the test page (PDF 300,300 to
    /// 380,360) lands top right unrotated and bottom right after a quarter
    /// turn, whether that turn comes from /Rotate or from the request.
    #[test]
    fn scan_raster_follows_page_and_extra_rotation() {
        let ink = |px: &[u8], x0: usize, y0: usize| (y0..y0 + 60).any(|y| (x0..x0 + 80).any(|x| dark(px, 400, x, y)));
        let differing = |a: &[u8], b: &[u8]| (0..400 * 400).filter(|&i| dark(a, 400, i % 400, i / 400) != dark(b, 400, i % 400, i / 400)).count();
        let plain = scan(&form_page(false, 0), "r0", 400, 400, 0);
        assert!(ink(&plain, 300, 40) && !ink(&plain, 300, 300), "unrotated: stroke top right");
        let by_page = scan(&form_page(false, 90), "r90", 400, 400, 0);
        assert!(ink(&by_page, 300, 300) && !ink(&by_page, 300, 40), "/Rotate 90: stroke bottom right");
        let by_request = scan(&form_page(false, 0), "x90", 400, 400, 90);
        assert!(ink(&by_request, 300, 300) && !ink(&by_request, 300, 40), "extra 90: stroke bottom right");
        assert!(differing(&by_page, &by_request) < 40, "extra rotation equals /Rotate ({} px differ)", differing(&by_page, &by_request));
        // Form recognition asks for the unrotated page: extra = -/Rotate.
        let undone = scan(&form_page(false, 90), "u90", 400, 400, 270);
        assert!(differing(&undone, &plain) < 40, "extra rotation undoes /Rotate ({} px differ)", differing(&undone, &plain));
    }

    /// No annotations and no form fields, like pdf.js with annotationMode 0.
    #[test]
    fn scan_raster_leaves_form_fields_out() {
        let px = scan(&form_page(true, 0), "veld", 400, 400, 0);
        assert!(!dark(&px, 400, 150, 275), "the field appearance is not drawn");
        assert!(dark(&px, 400, 20, 200), "the drawing is");
    }

    /// A non-square page keeps its proportions when turned.
    #[test]
    fn scan_raster_has_the_requested_size() {
        let px = scan(&form_page(false, 0), "maat", 300, 150, 0);
        assert_eq!(px.len(), 300 * 150 * 4);
    }

    fn median(mut v: Vec<f64>) -> f64 {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v[v.len() / 2]
    }

    /// #395: the render-only /BBox on tiny mesh shadings must not change a
    /// single pixel, and must make the page fast. Needs PDFium on the
    /// library path (e.g. LD_LIBRARY_PATH=open-pdf-studio/src-tauri/binaries/linux-x64)
    /// and OPDS_MESH395_PDF pointing at a page with degenerate mesh fills.
    #[test]
    #[ignore]
    fn mesh_bbox_renders_identical_pixels_faster() {
        let path = std::env::var("OPDS_MESH395_PDF").expect("OPDS_MESH395_PDF");
        let original = std::fs::read(&path).unwrap();
        let patched = crate::mesh_bbox::bound_tiny_mesh_shadings(&original).expect("file has tiny mesh shadings");
        let runs: usize = std::env::var("OPDS_MESH395_RUNS").ok().and_then(|r| r.parse().ok()).unwrap_or(3);

        let cases: Vec<(f32, Option<(f32, f32, f32, f32)>)> = vec![
            (0.05, None),
            (0.1, None),
            (0.25, None),
            (0.5, None),
            (1.0, None),
            (1.0, Some((0.0, 2000.0, 512.0, 512.0))),
            (2.0, Some((0.0, 0.0, 256.0, 256.0))),
            (4.0, Some((0.0, 0.0, 128.0, 128.0))),
            // The specks themselves: /Rotate 90 puts page point (4, 5.4) at
            // the top-left corner of the displayed page.
            (1.0, Some((0.0, 0.0, 64.0, 64.0))),
            (8.0, Some((0.0, 0.0, 64.0, 64.0))),
            (32.0, Some((0.0, 0.0, 16.0, 16.0))),
        ];
        for (scale, tile) in cases {
            let mut before_ms = Vec::new();
            let mut after_ms = Vec::new();
            let mut before = None;
            let mut after = None;
            for _ in 0..runs {
                let b = render_bytes(&original, scale, tile);
                before_ms.push(b.3);
                before = Some(b);
                let a = render_bytes(&patched, scale, tile);
                after_ms.push(a.3);
                after = Some(a);
            }
            let (bw, bh, before_px, _) = before.unwrap();
            let (aw, ah, after_px, _) = after.unwrap();
            assert_eq!((bw, bh), (aw, ah));
            let changed = before_px.chunks(4).zip(after_px.chunks(4)).filter(|(b, a)| b != a).count();
            let ink = before_px.chunks(4).filter(|p| p[..3] != [255, 255, 255]).count();
            eprintln!(
                "scale {:>4} {:<28} {:>5}x{:<5} before {:>9.1} ms  after {:>7.1} ms  changed px {}  (non-white px {})",
                scale,
                format!("{:?}", tile),
                bw,
                bh,
                median(before_ms),
                median(after_ms),
                changed,
                ink
            );
            if let Ok(dir) = std::env::var("OPDS_MESH395_DUMP") {
                // Binary PPM of the "before" render, for eyeballing.
                let mut ppm = format!("P6 {} {} 255\n", bw, bh).into_bytes();
                before_px.chunks(4).for_each(|p| ppm.extend_from_slice(&p[..3]));
                std::fs::write(format!("{}/s{}_{:?}.ppm", dir, scale, tile.map(|t| (t.0 as i32, t.1 as i32))), ppm).unwrap();
            }
            assert_eq!(changed, 0, "scale {} tile {:?}", scale, tile);
        }

        // The worker path itself: load (incl. the mesh scan) + render.
        let mut renderer = Renderer::new().unwrap();
        let t0 = std::time::Instant::now();
        let r = renderer.render(&path, 0, 0.5, 0, false).unwrap();
        eprintln!("Renderer::render cold, scale 0.5: {:.1} ms ({}x{})", t0.elapsed().as_secs_f64() * 1000.0, r.width, r.height);
        let t0 = std::time::Instant::now();
        renderer.render(&path, 0, 1.0, 0, false).unwrap();
        eprintln!("Renderer::render warm, scale 1.0: {:.1} ms", t0.elapsed().as_secs_f64() * 1000.0);
    }
}
