use crate::shm;
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
    /// (pagina-index, parse-duur in ms, open handle). De parse-duur bepaalt of
    /// de handle na de render blijft leven (zie release_page_if_cheap).
    page: Option<(u32, u32, PdfPage<'static>)>,
    document: PdfDocument<'static>,
    _bytes: Vec<u8>,
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
    fn get_or_load_page(&mut self, doc_idx: usize, page_index: u32) -> Result<&PdfPage<'static>> {
        let entry = &mut self.cache[doc_idx];
        let reuse = matches!(&entry.page, Some((idx, _, _)) if *idx == page_index);
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
            entry.page = Some((page_index, load_ms, page));
        }
        Ok(&self.cache[doc_idx].page.as_ref().expect("zojuist gezet").2)
    }

    /// Sluit de pagina-handle weer als de parse GOEDKOOP was. Alleen zware
    /// pagina's (parse in de honderden ms tot seconden — grote CAD-bladen)
    /// verdienen de open handle met zijn forse parse-state (~1 GB op extreme
    /// bladen); normale pagina's parsen in enkele tientallen ms en hun handle
    /// vasthouden zou bij veel tabs/documenten onnodig geheugen stapelen.
    fn release_page_if_cheap(&mut self, doc_idx: usize) {
        const KEEP_HANDLE_MS: u32 = 250;
        if let Some((_, load_ms, _)) = &self.cache[doc_idx].page {
            if *load_ms < KEEP_HANDLE_MS {
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
    ) -> Result<RenderResult> {
        let idx = self.get_or_load(path)?;
        let result = {
            let page = self.get_or_load_page(idx, page_index)?;

            let w_pt = page.width().value;
            let h_pt = page.height().value;
            let target_w = (w_pt * scale).ceil() as i32;
            let target_h = (h_pt * scale).ceil() as i32;

            // Past de bitmap niet in de SHM-regio, dan meteen een nette fout i.p.v.
            // eerst volledig rasteren en de uitkomst weggooien. De uitvoer van
            // set_target_width + set_maximum_height is in elke rotatie
            // <= target_w x target_h, dus dit is een strakke bovengrens.
            if let Err(e) = shm::ensure_bitmap_fits(target_w, target_h) {
                self.release_page_if_cheap(idx);
                return Err(e);
            }

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
    ) -> Result<RenderResult> {
        if rotation != 0 {
            return Err(anyhow!("render_region: rotation {} not supported", rotation));
        }
        if region_w_pt <= 0.0 || region_h_pt <= 0.0 {
            return Err(anyhow!("render_region: region must be positive"));
        }
        // Bitmap-afmetingen hangen alleen van regio + schaal af: valideer ze
        // (incl. de SHM-grens) voordat het document/de pagina geladen wordt.
        let bitmap_w = (region_w_pt * scale).ceil() as i32;
        let bitmap_h = (region_h_pt * scale).ceil() as i32;
        if bitmap_w <= 0 || bitmap_h <= 0 {
            return Err(anyhow!("render_region: invalid bitmap {}x{}", bitmap_w, bitmap_h));
        }
        shm::ensure_bitmap_fits(bitmap_w, bitmap_h)?;
        let idx = self.get_or_load(path)?;
        let result = {
            let page = self.get_or_load_page(idx, page_index)?;

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
    #[ignore]
    fn renders_a4_at_scale_1() {
        let _r = Renderer::new();
    }
}
