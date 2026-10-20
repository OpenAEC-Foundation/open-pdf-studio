# Rust-kernel M1 — Hayro als schakelbare pagina-engine

> **Voor agentische uitvoerders:** VERPLICHTE SUB-SKILL: superpowers:executing-plans. Stappen gebruiken checkbox-syntax (`- [ ]`).

**Doel:** naast PDFium kan de app pagina's en regiotegels laten renderen door Hayro (pure Rust), via een voorkeur "Render-engine". De keuze loopt door de bestaande worker-sidecar, en de statusbalk toont welke engine een pagina tekende.

**Architectuur:**
- `open-pdf-kernel::pdfrender` wrapt Hayro 0.8 (`render_into` met eigen transform, zodat regio's en rotatie werken).
- `pdfium-worker` krijgt in `Render`/`RenderRegion` een veld `engine` (`#[serde(default)]` = pdfium) en een eigen Hayro-documentcache.
- `worker_pool` en de commands `render_pdf_page`/`render_pdf_page_region` geven `engine` door; de engine zit in de pixmap-cachesleutel.
- JS leest `preferences.renderEngine` en geeft het mee aan de router, de tegel-route en de cachesleutels.

**Tech stack:** `hayro =0.8.0`, `vello_cpu =0.3.0` (al in de kernel), bestaande Tauri/worker-code, Solid-voorkeurendialoog.

**Spec:** `docs/rust-migratie-plan.md` §3.2 en §4 rij M1. Issue #625.

## Globale randvoorwaarden

- De standaard blijft `pdfium`. Hayro is alleen actief na een expliciete keuze in de voorkeuren.
- Geen stille terugval: faalt Hayro op een pagina, dan geeft het command een fout, net als bij PDFium. De statusbalk-chip toont altijd de engine die werkelijk tekende.
- Uitvoer volgt dezelfde conventies als PDFium:
  - RGBA, opaak wit;
  - de grootte is `ceil(w_pt*scale)` × `ceil(h_pt*scale)`;
  - de regio staat in weergave-punten (na /Rotate), linksboven;
  - bij een hele pagina geldt een extra rotatie van 0/90/180/270.
- `thin_lines` heeft bij Hayro geen effect in M1. Dat staat gedocumenteerd.
- i18n: nieuwe sleutels komen in alle 37 taalmappen (Engels als terugval voor talen zonder vertaling, Nederlands vertaald).
- Lokaal bouwen: MSVC-toolchain met `RUSTFLAGS=-C target-feature=-crt-static`, en `CARGO_TARGET_DIR` buiten OneDrive. Een gebouwde sidecar in `src-tauri/binaries/` nooit committen.
- Live testen alleen in een geïsoleerde rig:
  - eigen poorten (MCP 9235, CDP 9345), nooit 9223/9233;
  - eigen `OPDS_DATA_DIR` en `WEBVIEW2_USER_DATA_FOLDER`;
  - nooit printer-, poort- of formulierscripts;
  - verificatiebestanden nooit overschrijven.

## Review-focus

1. **Pagina met /Rotate 90 en een verschoven CropBox.** Grootte en oriëntatie moeten gelijk zijn aan PDFium. → test `rotated_page_size_matches_display_size` (Taak 1).
2. **Regio over de paginarand.** Buiten de pagina wordt het wit, niet transparant en niet met vuil. → test `region_outside_page_is_white` (Taak 1).
3. **Een bestand dat Hayro niet kan openen.** Dat geeft een fout terug, geen paniek in de worker. → test `invalid_pdf_is_error` (Taak 1). De worker vangt panics op per request (Taak 2).
4. **Een bitmap groter dan het gedeelde geheugen (64 MiB).** Die geeft dezelfde fout als bij PDFium. Dat gaat via de bestaande `ensure_bitmap_fits` (Taak 2).
5. **Wisselen van engine terwijl pagina's in de cache staan.** Dan mogen geen bitmaps van de andere engine verschijnen. → cachesleutels bevatten de engine; JS-test `engine_changes_cache_key` (Taak 4).

---

### Taak 1: `open_pdf_kernel::pdfrender`

**Bestanden:** `open-pdf-kernel/src/pdfrender.rs`, `open-pdf-kernel/Cargo.toml` (`hayro = "=0.8.0"`), `open-pdf-kernel/tests/pdfrender.rs`.

**Levert:**
- `pub struct HayroDocument`, met `open(bytes: Arc<Vec<u8>>) -> Result<HayroDocument, RenderError>`, `page_count() -> u32` en `page_size(page_index: u32) -> Result<(f32, f32), RenderError>` (weergavegrootte in punten, na /Rotate).
- `render_page(&self, page_index: u32, scale: f32, rotation: i32) -> Result<RgbaImage, RenderError>`. Rotation is 0/90/180/270 met de klok mee; bij 90/270 wisselen de assen.
- `render_region(&self, page_index: u32, scale: f32, x_pt: f32, y_pt: f32, w_pt: f32, h_pt: f32) -> Result<RgbaImage, RenderError>`.
- `pub enum RenderError { Open(String), PageOutOfRange(u32), BadRotation(i32), EmptyRegion, TooLarge { width: u32, height: u32 } }`, met Display en Error. Dezelfde grenzen als `raster::MAX_SIDE`/`MAX_PIXELS`.

**Tests**, op `test pdf-bestanden/Testbestanden/Tekst.pdf` en `Technische tekening.pdf`:
- `page_count_matches`;
- `page_size_ceil_matches_bitmap`;
- `rotation_90_swaps_axes`;
- `region_matches_crop_of_page` (per kanaal ≤ 3, behalve de randpixels);
- `region_outside_page_is_white`;
- `invalid_pdf_is_error`;
- `page_out_of_range_is_error`;
- `rotated_page_size_matches_display_size`. Hiervoor zoek ik een bestand met /Rotate in de testbestanden, of maak ik er een via een fixture.

### Taak 2: worker-protocol en Hayro-route in `pdfium-worker`

**Bestanden:** `pdfium-worker/src/protocol.rs`, `pdfium-worker/src/main.rs`, nieuw `pdfium-worker/src/hayro_render.rs`, `pdfium-worker/Cargo.toml` (dependency op `open-pdf-kernel`).

**Levert:**
- `pub enum Engine { Pdfium, Hayro }` (serde lowercase, `Default = Pdfium`) en een veld `#[serde(default)] engine: Engine` in `Render` en `RenderRegion`.
- `HayroRenderer` met een documentcache (cap 2, sleutel pad+mtime+lengte). De methoden `render` en `render_region` geven `RenderResult` terug.
- In `main.rs` dispatcht een `engine == Hayro`-request naar `HayroRenderer`, binnen `catch_unwind`.

**Tests:**
- `engine_defaults_to_pdfium`;
- `engine_hayro_parses`;
- `hayro_renderer_renders_tekst_p1` (geen ignore: zuiver Rust, geen PDFium nodig).

### Taak 3: pool, commands en cachesleutel

**Bestanden:** `src-tauri/src/worker_pool/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/pdfium_renderer.rs`, `src-tauri/Cargo.toml` (kernel-dependency, `rust-version = "1.92"`).

**Levert:**
- `render`/`render_region` op de pool krijgen een parameter `engine: &str`, die in het request-JSON komt.
- Commands `render_pdf_page`/`render_pdf_page_region` krijgen `engine: Option<String>` (standaard `"pdfium"`).
- `PixmapKey` krijgt de engine als zesde element.
- De in-process terugval voor `hayro` loopt via `open_pdf_kernel::pdfrender`; voor `pdfium` blijft die zoals hij is.

**Tests:** `request_tests` uitgebreid met het veld `engine`. Een cachesleutel-test controleert dat pdfium en hayro verschillende sleutels geven.

### Taak 4: JS — voorkeur, routing, caches, chip

**Bestanden:**
- `js/types/preferences.ts`, `js/core/constants.ts` (`renderEngine: 'pdfium'`);
- nieuw `js/pdf/render-engine.js` (`renderEngineOn(prefs = state.preferences): 'pdfium' | 'hayro'`);
- `js/pdf/engine-router.js`, `js/pdf/progressive-render.js` (`invokeTileRegion`: engine meegeven, de scene-engine overslaan bij hayro);
- `js/pdf/page-bitmap-cache.js` en `js/pdf/tile-cache.js` (engine in de sleutel);
- `js/screenshot.js`, `js/pdf/vector-snippet-preview.js` (engine meegeven);
- `renderer.js` (`state.renderEngine` noemt Hayro);
- `engineStatusStore` (`'hayro'`);
- `PageDisplayTab.jsx` (`PrefSelect`) en `PreferencesDialog.jsx` (bij wijziging: `clearAllBitmaps()`, `tileCacheClearAll()` en opnieuw renderen);
- i18n: `statusbar.json` `engine.hayro` en `preferences.json` `pageDisplay.renderEngine*`, in alle 37 talen.

**Test:** nieuw `js/pdf/render-engine.test.mjs`, in de stijl van `thin-lines.test.mjs` en opgenomen in `scripts/unit-testlijst.txt`:
- `render_pdf_page` krijgt `engine`;
- `invokeTileRegion` slaat de scene-engine over bij hayro en geeft `engine` mee;
- de cachesleutels verschillen per engine.

### Taak 5: deeloplevering — bouwen en live testen

1. `npm run test:unit`, `npx vite build`, `cargo test -p open-pdf-kernel -p pdfium-worker` en `cargo check` van de app (MSVC).
2. Bouw een rig volgens het recept en zet in de rig-`OPDS_DATA_DIR` de voorkeur `renderEngine: 'hayro'`.
3. Draai de MuPDF-vergelijkings-sweep op beide verificatiemappen, eerst met hayro en daarna met pdfium als referentie op dezelfde build. Vergelijk met de bekende baseline-vlaggen.
4. Draai de rotatie-sweep met hayro.
5. Meet de tijd tot de eerste scherpe pagina voor licht, middel en zwaar materiaal, hayro tegenover pdfium.
6. Leg de resultaten vast in `docs/rust-migratie-plan.md` (§9 "Voortgang") met cijfers, vlaggen en bekende verschillen.
