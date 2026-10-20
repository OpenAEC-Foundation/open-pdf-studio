# Rust-kernel M0 — uitvoeringsplan

> **Voor agentische uitvoerders:** VERPLICHTE SUB-SKILL: gebruik superpowers:subagent-driven-development (aanbevolen) of superpowers:executing-plans om dit plan taak voor taak uit te voeren. Stappen gebruiken checkbox-syntax (`- [ ]`).

**Doel:** een nieuwe workspace-crate `open-pdf-kernel` met annotatiemodel, display list en rasterizer, met eigen tests die ook in CI draaien. De crate wordt nog niet aangesloten op de app.

**Architectuur:**
- Een pure Rust-bibliotheek zonder Tauri-afhankelijkheid.
- `model` spiegelt het JS-annotatieobject verliesvrij: getypeerde velden plus `extra` voor de rest.
- `dl` is de gezamenlijke tekentaal.
- `raster` zet een display list om naar een rechte (niet-voorvermenigvuldigde) RGBA-bitmap via `vello_cpu`, dezelfde rasterizer die Hayro in M1 gebruikt.
- Een golden-harness legt bitmaps vast als PNG.

**Tech stack:** Rust (edition 2021, `rust-version = "1.92"`), `serde`/`serde_json`, `vello_cpu =0.0.8`.

**Spec:** `docs/rust-migratie-plan.md` (§3.1, §4 rij M0, §4.2 rij M0). Issue #625.

## Globale randvoorwaarden

- Licentie van de crate: `LGPL-3.0-or-later` (gelijk aan de repository).
- `vello_cpu` exact vastgepind op `=0.0.8` met `default-features = false, features = ["std", "png", "u8_pipeline"]`. Dit is de versie die Hayro 0.7.1 gebruikt.
- `rust-version = "1.92"` op de kernel-crate (Hayro 0.7.1 eist 1.92). `src-tauri` blijft ongewijzigd tot M1, want de app hangt in M0 nog niet van de kernel af.
- Geen code kopiëren uit `rust-studio/crates/native-app` op `feat/rust-native` (GPL). `studio-core` (LGPL) mag als referentie dienen.
- Geen namen van commerciële software in code, comments of tests. Commits volgen Conventional Commits, in het Engels, zonder AI-vermelding.
- Lokaal bouwen buiten OneDrive: `CARGO_TARGET_DIR=C:\opds-cargo-target-kernel`.
- Raak de draaiende app van de gebruiker niet aan, en gebruik geen poorten 9223/9233.

## Review-focus

1. **`null` versus ontbrekend.** JS schrijft bijvoorbeeld `"groupId": null`. Na een round trip moet het veld óf `null` blijven, óf weggelaten zijn. Getypeerde velden behandelen beide als "afwezig"; de vergelijker in de tests doet dat ook. Velden die met `null` voorkomen typen we niet, zodat ze in `extra` blijven staan. → test `null_valued_untyped_field_survives` (Taak 1).
2. **Gehele getallen versus floats.** `"page": 1` mag na een round trip `1` blijven. `"x": 10` wordt `10.0`; numeriek is dat gelijk, maar JS ziet geen verschil. → de vergelijker vergelijkt getallen als f64 (Taak 1).
3. **Onbekend annotatietype** (bijvoorbeeld van een plugin). Dat type mag niet weggegooid of omgezet worden. → test `unknown_type_survives` (Taak 1).
4. **Halfdoorzichtige randen.** Rechte RGBA moet correct terugrekenen uit voorvermenigvuldigd. Een pixel met alpha 0 levert `[0,0,0,0]` op, nooit willekeurige kleur. → test `transparent_pixels_are_zero` (Taak 3).
5. **Te grote of lege doelbitmap.** Breedte of hoogte 0, of groter dan de grens, geeft een `Err` en geen paniek of enorme allocatie. → test `rejects_oversized_target` (Taak 3).

---

### Taak 1: crate-skelet en annotatiemodel

**Bestanden:**
- Wijzigen: `Cargo.toml` (root) — `"open-pdf-kernel"` toevoegen aan `members`, plus een `[profile.dev.package.open-pdf-kernel] opt-level = 1`-regel in de stijl van de bestaande overrides als die er zijn.
- Aanmaken: `open-pdf-kernel/Cargo.toml`, `open-pdf-kernel/src/lib.rs`, `open-pdf-kernel/src/model.rs`
- Aanmaken: `open-pdf-kernel/README.md` (Nederlands, kort: doel, modules, `cargo test -p open-pdf-kernel`, verwijzing naar `docs/rust-migratie-plan.md`)
- Test: `open-pdf-kernel/tests/model.rs`, fixture `open-pdf-kernel/tests/fixtures/annotations-all-types.json`

**Interfaces:**
- Levert (`open_pdf_kernel::model`):
  - `pub struct Point { pub x: f64, pub y: f64 }`
  - `pub struct Annotation` met `#[serde(rename_all = "camelCase")]`:
    - verplicht: `id: String`, `r#type: String` (`#[serde(rename = "type")]`), `page: u32`;
    - getypeerd als `Option<…>` met `skip_serializing_if = "Option::is_none"`:
      - `opacity, rotation, line_width, border_width, x, y, width, height, start_x, start_y, end_x, end_y, center_x, center_y, radius, start_angle, end_angle, head_size, arrow_x, arrow_y, knee_x, knee_y, font_size: f64`
      - `color, fill_color, stroke_color, border_style, start_head, end_head, text, font_family, font_weight, font_style, text_align: String`
      - `fill_none, printable, locked: bool`
      - `path, points, control_points: Vec<Point>`
      - `holes: Vec<Vec<Point>>`
    - `#[serde(flatten)] pub extra: serde_json::Map<String, serde_json::Value>`.
  - `pub enum Kind` met één variant per waarde van `AnnotationType` uit `open-pdf-studio/js/types/annotation.ts` (41 stuks, CamelCase-namen: `Highlight, TextHighlight, …, Systeemraster`) plus `Unknown`.
  - `impl Annotation { pub fn kind(&self) -> Kind }`
  - `pub fn annotations_from_json(s: &str) -> Result<Vec<Annotation>, serde_json::Error>` en `pub fn annotations_to_json(a: &[Annotation]) -> Result<String, serde_json::Error>`
- Dependencies: `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`. `vello_cpu` komt pas in Taak 3.

- [ ] **Stap 1: Schrijf de fixture.**

  `tests/fixtures/annotations-all-types.json` bevat een JSON-array met één object per `AnnotationType` (41). Elk object gebruikt de velden die bij dat type horen volgens `annotation.ts`, met realistische waarden in app-coördinaten (linksboven, punten). Verplicht erin:
  - een `textbox` met `textRuns` (genest) en `leaders`;
  - een `measureArea` met `holes`;
  - een `stavenreeks` met `count`, `diameter`, `legDir`;
  - een object met `"groupId": null`;
  - een object met `"replies": [...]`;
  - een object met een niet-bestaand veld `"pluginData": {"a": [1, 2.5, "x"]}`;
  - een extra 42e object met `"type": "pluginShape"`.

- [ ] **Stap 2: Schrijf de falende tests in `tests/model.rs`.**
  - `model_roundtrip_is_lossless`: lees de fixture, parse met `annotations_from_json`, serialiseer met `annotations_to_json`, parse beide als `serde_json::Value` en vergelijk met `json_equivalent(a, b)`.
    - `json_equivalent` is een testhelper in hetzelfde bestand. Getallen gelden als gelijk als hun f64-waarden gelijk zijn. Een object-sleutel met waarde `null` geldt als gelijk aan het ontbreken van die sleutel.
  - `kind_maps_all_known_types`: voor elk object in de fixture behalve `pluginShape` is `kind() != Kind::Unknown`. Het aantal verschillende `Kind`s is 41.
  - `unknown_type_survives`: `pluginShape` geeft `Kind::Unknown`, en na de round trip is `type == "pluginShape"`.
  - `null_valued_untyped_field_survives`: na de round trip bevat het object met `groupId` de sleutel `groupId` met waarde `null`. Dit moet echt zo zijn, niet alleen equivalent: `groupId` staat in `extra`.
  - `extra_preserves_nested_unknown_field`: `pluginData` is na de round trip exact `{"a":[1,2.5,"x"]}`.

- [ ] **Stap 3: Draai de tests en controleer dat ze falen.**
  Run: `CARGO_TARGET_DIR=C:/opds-cargo-target-kernel cargo test -p open-pdf-kernel --test model`
  Verwacht: compileerfout (module of functies bestaan nog niet).

- [ ] **Stap 4: Implementeer `model.rs` en `lib.rs`.**
  `lib.rs`: `pub mod model;` (later `pub mod dl; pub mod raster;`) en een doc-comment met het doel van de crate.
  `Cargo.toml` van de crate krijgt `name = "open-pdf-kernel"`, `version = "0.1.0"`, `edition = "2021"`, `rust-version = "1.92"`, `license = "LGPL-3.0-or-later"`, `publish = false`.

- [ ] **Stap 5: Draai de tests en controleer dat ze slagen.**
  Run: zelfde commando. Verwacht: 5 passed.

- [ ] **Stap 6: Commit.**
  `feat(kernel): add open-pdf-kernel crate with a lossless annotation model` (inclusief `Cargo.lock`).

### Taak 2: display list

**Bestanden:**
- Aanmaken: `open-pdf-kernel/src/dl.rs`
- Test: `open-pdf-kernel/tests/dl.rs`

**Interfaces:**
- Levert (`open_pdf_kernel::dl`), alle typen `Clone + Debug + PartialEq`:
  - `pub enum PathEl { MoveTo(f64, f64), LineTo(f64, f64), QuadTo(f64, f64, f64, f64), CubicTo(f64, f64, f64, f64, f64, f64), Close }`
  - `pub struct Path(pub Vec<PathEl>)`, met `Path::rect(x, y, w, h) -> Path` en `Path::polyline(points: &[(f64, f64)], closed: bool) -> Path`
  - `pub struct Color { pub r: u8, pub g: u8, pub b: u8, pub a: u8 }` (recht, niet voorvermenigvuldigd)
  - `pub enum FillRule { NonZero, EvenOdd }`
  - `pub enum LineCap { Butt, Round, Square }`
  - `pub enum LineJoin { Miter, Round, Bevel }`
  - `pub struct StrokeStyle { pub width: f64, pub cap: LineCap, pub join: LineJoin, pub miter_limit: f64, pub dash: Vec<f64>, pub dash_offset: f64 }`, met `Default` (width 1, Butt, Miter, 10, geen dash)
  - `pub enum BlendMode { Normal, Multiply }`
  - `pub enum Item { Fill { path: Path, color: Color, rule: FillRule }, Stroke { path: Path, color: Color, style: StrokeStyle }, PushGroup { opacity: f32, blend: BlendMode, clip: Option<Path> }, PopGroup }`
  - `pub struct DisplayList { pub items: Vec<Item> }`, met `new()`, `push(Item)` en `bounds(&self) -> Option<Rect>`
  - `pub struct Rect { pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64 }`
- Bounds-regels:
  - de bounds zijn de unie van de controlepunten van alle Fill- en Stroke-paden;
  - een Stroke vergroot zijn eigen bounds met `width / 2`, en bij `LineJoin::Miter` met `width / 2 * miter_limit`;
  - een `PushGroup` met `clip` snijdt de bounds van de items tot de bijbehorende `PopGroup`;
  - een lege lijst geeft `None`.

- [ ] **Stap 1: Schrijf de falende tests.**
  - `bounds_of_empty_is_none`.
  - `bounds_of_fill_rect`: `Path::rect(10, 20, 30, 40)` geeft `Rect { 10, 20, 40, 60 }`.
  - `bounds_include_half_stroke_width`: lijn (0,0)–(100,0) met width 4 en `LineJoin::Round` geeft `Rect { -2, -2, 102, 2 }`.
  - `bounds_clipped_by_group`: fill-rect (0,0,100,100) binnen een groep met clip-rect (50,50,10,10) geeft `Rect { 50, 50, 60, 60 }`.
  - `polyline_closed_ends_with_close`.
- [ ] **Stap 2: Draai de tests en controleer dat ze falen.** Run: `… cargo test -p open-pdf-kernel --test dl`. Verwacht: compileerfout.
- [ ] **Stap 3: Implementeer `dl.rs`.**
- [ ] **Stap 4: Draai de tests en controleer dat ze slagen.** Verwacht: 5 passed.
- [ ] **Stap 5: Commit.** `feat(kernel): add the display list shared by screen and PDF output`

### Taak 3: rasterizer

**Bestanden:**
- Wijzigen: `open-pdf-kernel/Cargo.toml` — `vello_cpu = { version = "=0.0.8", default-features = false, features = ["std", "png", "u8_pipeline"] }`
- Aanmaken: `open-pdf-kernel/src/raster.rs`
- Test: `open-pdf-kernel/tests/raster.rs`

**Interfaces:**
- Gebruikt: `dl::*` uit Taak 2.
- Levert (`open_pdf_kernel::raster`):
  - `pub const MAX_SIDE: u32 = 16_384;` en `pub const MAX_PIXELS: u64 = 64 * 1024 * 1024;`
  - `pub struct RasterTarget { pub width: u32, pub height: u32, pub transform: [f64; 6] }`. De transform is een affiene matrix `[a, b, c, d, e, f]` van paginaruimte naar pixels, met dezelfde volgorde als `kurbo::Affine::new`.
  - `pub struct RgbaImage { pub width: u32, pub height: u32, pub data: Vec<u8> }` (rechte RGBA8, rij voor rij, transparante achtergrond)
  - `pub enum RasterError { EmptyTarget, TooLarge { width: u32, height: u32 }, UnbalancedGroups }`, met `impl std::error::Error`
  - `pub fn render(dl: &DisplayList, target: &RasterTarget) -> Result<RgbaImage, RasterError>`
  - `impl RgbaImage { pub fn to_png(&self) -> Vec<u8>; pub fn from_png(bytes: &[u8]) -> Result<RgbaImage, String> }` (via `Pixmap::into_png` / `Pixmap::from_png`)
- Aanpak:
  1. Maak een `RenderContext::new(w, h)` en zet de transform met `set_transform`.
  2. Per item:
     - Fill: `set_fill_rule`, `set_paint`, `fill_path`;
     - Stroke: `set_stroke` met een `kurbo::Stroke` met cap, join, miter en dash; daarna `stroke_path`;
     - PushGroup: `push_layer(clip, Some(blend), Some(opacity), None, None)`, met `Multiply` naar het peniko-`Mix::Multiply`;
     - PopGroup: `pop_layer`.
  3. Rond af met `flush`, `render_to_pixmap(&mut Resources::new(), &mut pixmap)` en `take_unpremultiplied`.
  4. Controleer de groepsbalans vóór het renderen. Te veel of te weinig `PopGroup` geeft `UnbalancedGroups`.

- [ ] **Stap 1: Schrijf de falende tests.** Gebruik telkens een doel van 20×20 met identiteitstransform, tenzij anders vermeld.
  - `fill_rect_is_opaque_inside_and_empty_outside`: rect (5,5,10,10), kleur (255,0,0,255). Pixel (10,10) is `[255,0,0,255]`, pixel (1,1) is `[0,0,0,0]`.
  - `transform_scales_geometry`: transform `[2,0,0,2,0,0]`, rect (2,2,3,3). Pixel (8,8) is rood en pixel (12,12) is transparant.
  - `group_opacity_halves_alpha`: dezelfde rect binnen `PushGroup { opacity: 0.5, Normal, None }`. Pixel (10,10) heeft alpha 127 of 128 en rood 255.
  - `multiply_blend_darkens`: eerst een fill van het hele doel in (200,200,200,255), daarna een groep met `Multiply` en een fill (128,128,128,255). Pixel (10,10) ligt per kanaal binnen ±2 van 100.
  - `transparent_pixels_are_zero`: een anti-aliased schuine lijn. Elke pixel met alpha 0 is `[0,0,0,0]`.
  - `rejects_oversized_target`: breedte 0 geeft `EmptyTarget`, breedte 20000 geeft `TooLarge`, en 9000×9000 geeft `TooLarge` (boven `MAX_PIXELS`).
  - `unbalanced_groups_error`: een `PushGroup` zonder `PopGroup` geeft `UnbalancedGroups`.
  - `png_roundtrip_is_exact`: `from_png(to_png(img)) == img` voor de render uit de eerste test.
- [ ] **Stap 2: Draai de tests en controleer dat ze falen.** Run: `… cargo test -p open-pdf-kernel --test raster`. Verwacht: compileerfout.
- [ ] **Stap 3: Implementeer `raster.rs`** en voeg `pub mod raster;` toe aan `lib.rs`.
- [ ] **Stap 4: Draai de tests en controleer dat ze slagen.** Verwacht: 8 passed.
- [ ] **Stap 5: Commit.** `feat(kernel): rasterize display lists with vello_cpu`

### Taak 4: golden-harness

**Bestanden:**
- Aanmaken: `open-pdf-kernel/tests/golden.rs`, plus de PNG's in `open-pdf-kernel/tests/golden/`
- Wijzigen: `open-pdf-kernel/README.md` (sectie "Golden-bitmaps bijwerken")

**Interfaces:**
- Gebruikt: `raster::{render, RasterTarget, RgbaImage}`, `dl::*`.
- Levert een testhelper in `tests/golden.rs`: `fn assert_golden(name: &str, img: &RgbaImage)`.
  - Met `OPDS_UPDATE_GOLDEN=1` schrijft hij `tests/golden/<name>.png` en slaagt.
  - Zonder die variabele leest hij de PNG en faalt hij bij een andere grootte of als een kanaal meer dan **3** afwijkt. Die marge vangt verschillen in SIMD-niveau tussen machines op.
  - Bij falen schrijft hij `target/golden-diff/<name>.actual.png` en noemt hij in de foutmelding de eerste afwijkende pixel.

- [ ] **Stap 1: Schrijf drie golden-tests** op een doel van 200×200 met transform `[2,0,0,2,0,0]`:
  - `golden_dashed_round_cap_line`: lijn (10,10)–(90,60), width 3, `Round` cap, dash `[6,4]`, kleur (0,90,200,255).
  - `golden_evenodd_polygon_with_hole`: buitenste vierkant (10,10,80,80) en binnenste (30,30,40,40) in één pad, `EvenOdd`, kleur (230,120,0,255).
  - `golden_curve_in_opacity_group`: een `CubicTo`-curve (10,90)→(30,10)(70,10)(90,90), width 5, `Round` join, binnen `PushGroup { opacity: 0.6 }`.
- [ ] **Stap 2: Controleer dat ze falen zonder PNG's.** Run: `… cargo test -p open-pdf-kernel --test golden`. Verwacht: 3 failed (PNG ontbreekt).
- [ ] **Stap 3: Genereer de golden-PNG's en beoordeel ze visueel.** Run: `OPDS_UPDATE_GOLDEN=1 … cargo test -p open-pdf-kernel --test golden`. Bekijk de drie PNG's met de Read-tool: ze moeten de beschreven vormen tonen.
- [ ] **Stap 4: Draai de tests zonder update en controleer dat ze slagen.** Verwacht: 3 passed.
- [ ] **Stap 5: Commit.** `test(kernel): add golden-bitmap harness`

### Taak 5: CI en documentatie

**Bestanden:**
- Wijzigen: `.github/workflows/ci.yml`. Voeg direct na de stap "Run unit tests" een stap toe met `name: Run kernel tests` en `run: cargo test -p open-pdf-kernel --locked`. Die draait op alle platformen in de matrix; de working-directory `open-pdf-studio` vindt de workspace bovenliggend.
- Wijzigen: `docs/rust-migratie-plan.md`, met bij M0 een statusregel "in uitvoering: PR …" (de PR-link vul je na het aanmaken in).

- [ ] **Stap 1: Controleer de hele crate lokaal.**
  Run: `CARGO_TARGET_DIR=C:/opds-cargo-target-kernel cargo test -p open-pdf-kernel --locked`.
  Verwacht: alle tests uit Taak 1–4 slagen (21 passed).
- [ ] **Stap 2: Controleer formattering en lints.**
  Run: `cargo fmt -p open-pdf-kernel -- --check` en `CARGO_TARGET_DIR=… cargo clippy -p open-pdf-kernel --all-targets -- -D warnings`.
  Verwacht: geen uitvoer of fouten.
- [ ] **Stap 3: Controleer dat de app-build niet geraakt is.**
  Run: `CARGO_TARGET_DIR=… cargo check -p pdfium-worker` en `npx vite build` (in `open-pdf-studio/`).
  Verwacht: beide slagen. `Cargo.lock` mag alleen nieuwe pakketten bevatten, geen versiewijzigingen van bestaande; controleer dat met `git diff Cargo.lock`.
- [ ] **Stap 4: Voeg de CI-stap toe en commit.** `ci: run the kernel tests on every platform`

---

## Afronding (na de taken)

1. Laat de gebruiker het samenvattende commitoverzicht zien en vraag akkoord.
2. Push de tak en open een PR naar `main` (Engels, `Refs #625`), zonder versiebump: dit is geen release.
3. Wacht op de CI-uitslag en meld die.
4. De gebruiker test en merget zelf.
