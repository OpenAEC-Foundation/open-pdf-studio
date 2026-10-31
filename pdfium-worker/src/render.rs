#[path = "render_budget.rs"]
mod render_budget;
use render_budget::{dimensions, SCREEN_RGBA_BYTES};
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

fn pdfium() -> Result<&'static Pdfium> {
    if PDFIUM.get().is_none() {
        // Zoekvolgorde voor de PDFium-bibliotheek:
        //   1. systeem-zoekpad (Windows vindt pdfium.dll naast de exe);
        //   2. naast de sidecar-binary zelf;
        //   3. ../Resources t.o.v. de binary — op macOS draait de sidecar in
        //      Contents/MacOS terwijl de gebundelde libpdfium.dylib als resource
        //      in Contents/Resources staat;
        //   4. de huidige werkdirectory (dev / handmatige runs).
        // Zonder 2/3 zou de worker op macOS geen dylib vinden en elke render
        // laten terugvallen op in-proc PDFium in de hoofd-app.
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let res_dir = exe_dir.join("../Resources");
        let bindings = Pdfium::bind_to_system_library()
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&exe_dir)))
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&res_dir)))
            .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./")))
            .context("PDFium library not found (system, exe-dir, ../Resources, or ./)")?;
        let _ = PDFIUM.set(Pdfium::new(bindings));
    }
    Ok(PDFIUM.get().expect("PDFIUM set above"))
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
    document: PdfDocument<'static>,
    _bytes: Vec<u8>,
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

        let bytes = std::fs::read(path).with_context(|| format!("read {}", path))?;
        // Tiny mesh shadings get a render-only /BBox (#395); only this
        // in-memory copy changes, never the file.
        let bytes = crate::mesh_bbox::prepare_for_render(bytes);
        // Safety: zie CachedDoc — buffer-adres is stabiel en de bytes blijven
        // in dezelfde struct levend zolang het document bestaat.
        let bytes_ref: &'static [u8] = unsafe { std::slice::from_raw_parts(bytes.as_ptr(), bytes.len()) };
        let document = pdfium()?
            .load_pdf_from_byte_slice(bytes_ref, None)
            .map_err(|e| anyhow!("PDFium parse: {}", e))?;

        if self.cache.len() >= DOC_CACHE_CAP {
            self.cache.remove(0);
        }
        self.cache.push(Box::new(CachedDoc {
            path: path.to_string(),
            mtime,
            len,
            page: None,
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
        }
    }

    /// Open (of hergebruik) de pagina-handle. FPDF_LoadPage parset de volledige
    /// content-stream — op zware CAD-pagina's SECONDEN per keer, en dat gebeurde
    /// voorheen bij ÉLKE regio-render opnieuw. Met een open handle betaalt
    /// alleen de eerste render die parse; daarna is een tegel puur rasterwerk.
    fn get_or_load_page(&mut self, doc_idx: usize, page_index: u32, thin_lines: bool) -> Result<&PdfPage<'static>> {
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
        let open = self.cache[doc_idx].page.as_mut().expect("zojuist gezet");
        open.set_thin_lines(thin_lines);
        Ok(&open.page)
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

    pub fn render(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        thin_lines: bool,
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
                .render_annotations(false)
                .use_lcd_text_rendering(true)
                .set_format(PdfBitmapFormat::BGRA);

            let bitmap = page.render_with_config(&config)
                .map_err(|e| anyhow!("PDFium region render: {}", e))?;

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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_budget_is_the_shm_payload() {
        assert_eq!(SCREEN_RGBA_BYTES, crate::shm::PAYLOAD_CAP as u64);
    }

    #[test]
    #[ignore]
    fn renders_a4_at_scale_1() {
        let _r = Renderer::new();
    }

    /// Renders `bytes` page 0 the way `Renderer::render` (whole page) or
    /// `Renderer::render_region` (`tile` = x, y, w, h in points) does.
    fn render_bytes(bytes: &[u8], scale: f32, tile: Option<(f32, f32, f32, f32)>) -> (u32, u32, Vec<u8>, f64) {
        let document = pdfium().unwrap().load_pdf_from_byte_slice(bytes, None).unwrap();
        let page = document.pages().get(0).unwrap();
        // Same configs as render() and render_region(); a transform implies
        // no form data, so render_form_data(true) only goes on whole pages.
        let config = match tile {
            None => {
                let (w, h) = dimensions(page.width().value, page.height().value, scale, SCREEN_RGBA_BYTES).unwrap();
                PdfRenderConfig::new().set_target_width(w).set_maximum_height(h).render_form_data(true)
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
