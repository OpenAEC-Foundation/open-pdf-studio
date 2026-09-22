# DWG/DXF-import fase 6: layouts, weergave, voorbeeld en onderlegger — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De import van DWG en DXF afmaken volgens Deel E en Deel J van het ontwerp: layouts met viewports die kloppen met wat de verkenning meldt, het tabblad Weergave met werkelijke doorwerking (kleurentabel kleur → lijndikte, lettertypevervanging, externe verwijzingen, afbeeldingen), blokken als formulier-XObject, een voorbeeldweergave uit de echte omzetter, de onderlegger op de huidige pagina via het bestaande vectorknipsel, de MCP-opdracht `app_import_cad`, en de laatste open punten uit fase 5 (dubbele laagnamen, wachtrij).

**Architecture:** De kern blijft in de workspace-crate `open-pdf-cad`, module `import`. Nieuw daarin: `viewport.rs` (één gedeelde beoordeling van een VIEWPORT, gebruikt door zowel de verkenning als de wandeling), `image.rs` (rasterbestanden lezen naar PDF-beeldgegevens) en `xref.rs` (paden van externe verwijzingen oplossen en veilig laden). `style.rs` krijgt de kleurentabel, `text.rs` de lettertypekeuze, `pdf_out.rs` meerdere letterbronnen, beeld-XObjects en formulier-XObjects, `walk.rs` de bijbehorende uitbreidingen van de `Sink`. De Tauri-schil `cad_import.rs` krijgt de nieuwe argumenten plus een commando voor de voorbeeldweergave. Het venster `CadImportDialog.jsx` krijgt de uitgebreide tabbladinhoud, een voorbeeldpaneel (`CadImportPreview.jsx`) en het doel "onderlegger", dat het resultaat als vectorknipsel op de huidige pagina zet. `js/pdf/cad-import-logica.js` houdt alle pure rekenregels (unit-getest onder node).

**Tech Stack:** Rust 2021, `acadrust 0.5.5`, `flate2`, `memmap2`, `serde`; Tauri 2; SolidJS + i18next; `node:test` voor de JS-tests; Python 3 met PyMuPDF voor de meetcontrole op de uitvoer.

## Global Constraints

- Ontwerp: `docs/superpowers/specs/2026-09-19-export-dxf-dwg-ifc-design.md` — Deel E (E2, E3, E4, E5), Deel H en Deel J. Fase 1, 2 en 5 zijn af; dit plan is fase 6.
- Werk in de bestaande worktree op branch `feat/400-export-dxf-dwg`. Nooit `git stash`. Niet pushen.
- **Geen paniek op bestandsinvoer.** In productiecode geen `unwrap`, `expect`, `panic!`, slicing of indexering die op bytes uit een bestand kan falen. Alles wat uit een DWG, DXF, afbeelding of extern bestand komt, wordt gecontroleerd. Tests mogen `unwrap` gebruiken.
- **Werkgrenzen en afbreken gelden overal, ook voor nieuwe code.** Elke nieuwe wandeling telt via `Walker::tick()` mee in `max_visits`; elke nieuwe uitvoer telt mee in `max_content_bytes`; elke nieuwe lus vraagt de afbreekvlag. Het laden van externe verwijzingen, het decoderen van afbeeldingen en de voorbeeldweergave zijn alle drie af te breken en hebben een eigen bovengrens. Overschrijding geeft `ImportError::TooComplex` (`IMPORT_TOO_COMPLEX`).
- **Padveiligheid.** Externe verwijzingen en afbeeldingen worden alleen geladen uit de map van de tekening of uit een zoekpad dat de gebruiker zelf heeft gekozen. Een opgelost pad moet na `canonicalize` binnen een toegestane map liggen; `..`-onderdelen, absolute paden buiten de toegestane mappen, UNC-paden (`\\server\...`), apparaatnamen (`\\?\`, `\\.\`) en paden met een URL-schema worden geweigerd. Geen netwerkpaden zonder expliciete keuze van de gebruiker.
- **Geen namen van commerciële CAD- of PDF-software** in code, comments, doc-strings, i18n-teksten, documentatie, testnamen of commit-berichten. Gebruik "extern geotechnisch/CAD-pakket", "externe referentie-berekening", "het referentiebestand".
- Geen AI-attributie in commit-berichten. Geen lokale of persoonsgebonden paden in de repo. Geen chatgeschiedenis in de repo.
- **i18n:** elke nieuwe tekst in alle 39 locales, echt vertaald (niet het Engels kopiëren), `zh` in vereenvoudigd Chinees. `js/pdf/cad-import-i18n.test.mjs` bewaakt dat; die test heeft een schrifttest voor de CAD-blokken. **Let op:** die test leest de waarschuwingscodes rechtstreeks uit `open-pdf-cad/src/import/mod.rs` en `scan.rs` (`format!("<code>:{…`) en eist voor elke code een sleutel `cadImport.warn_<code>` in alle talen. Een taak die een nieuwe waarschuwingscode toevoegt (Task 3 `fontsReplaced`, Task 4 `xrefsLoaded`/`xrefsMissing`/`xrefsRefused`, Task 5 `imagesEmbedded`/`imagesMissing`/`imagesRefused`, en na de beveiligingsreview `imagesTooLarge`/`imagesUnsupported`/`oddNames`, Task 7 `previewSimplified`) zet de bijbehorende vertalingen dus **in dezelfde commit**; anders is `npm run test:unit` rood. Task 10 vult daarna alleen aan wat nog ontbreekt.
- **Venster in huisstijl** (de richtlijnen in de projectinstructies van de repo): rechte hoeken, titelbalk met verloop `#ffffff` → `#f5f5f5`, rand `#d4d4d4`, sluitknop rood (`#e81123`) bij aanwijzen, verplaatsbaar, sluit niet bij een klik ernaast, geen verplaatscursor op de kop, standaardcursor overal behalve boven de pagina.
- **Bouwen:** lokaal met MSVC en `RUSTFLAGS='-C target-feature=-crt-static'`, en altijd met `CARGO_TARGET_DIR` buiten gesynchroniseerde mappen, bijvoorbeeld `C:/opds-cargo-target-cadplan`. App-Rust-tests starten lokaal alleen met een extern comctl32-manifest naast een kopie van het testbinary.
- **Testinstanties van de app** draaien uitsluitend met `OPDS_DATA_DIR` naar een eigen map. Dat vraagt commit `410859c0` uit de open PR #411: cherry-pick die op een **aparte testbranch**, nooit op de featurebranch. Controleer met een hash vóór en ná de rit dat het echte voorkeurenbestand van de gebruiker niet is aangeraakt.
- **Verificatiebestanden worden nooit overschreven.** Alle uitvoer gaat naar een eigen tijdelijke map; originelen blijven ongemoeid.
- **Vóór elke commit groen:** vanuit `open-pdf-studio/` `npm run test:unit` en `npx vite build` (de enige echte syntaxcontrole voor `js/`; nooit `| tail` op de build-uitvoer om succes te beoordelen), en vanuit de workspace-root `cargo test -p open-pdf-cad`. Waar de app-crate verandert ook `cargo test -p open-pdf-studio --lib cad_import`.
- Printer-, poort- en formulierscripts worden op deze machine nooit uitgevoerd.

## Gemeten uitgangspunten

Vastgesteld op commit `ffe42eae` met `examples/inspect_cad`, `examples/import_drawing` en een eigen dump van de VIEWPORT-velden, over de 365 tekeningen in de verificatieverzameling (73 met viewports, 161 layouts met minstens één viewport).

- **De viewport-fout is een verschil tussen twee filters, niet een rekenfout.** De verkenning (`scan.rs`) laat een viewport vallen zodra `view_height == height`; de wandeling (`walk.rs`) alleen als daarnaast ook `view_center == center`. Op een tekening met meerdere detailvensters op een layout (13 VIEWPORT-entiteiten in `*Paper_Space`) meldt de verkenning daardoor **7** viewports en tekent de omzetting er **12**. Hetzelfde verschil, in de andere richting, staat op tien andere bladen (een van de testbladen 2 tegen 4, een van de testbladen 6 tegen 8, een van de testbladen 15 tegen 16).
- **Waarom die vijf viewports in de verkenning wegvallen:** het zijn detailvensters op 1:1 (`height == view_height == 263,3`), maar met `view_center = (0,0)` en `view_target = (627 508, −22 509, 0)`. In DWG draagt `view_target` de verschuiving naar het model, niet `view_center`; de `view_height`-vergelijking alleen zegt dus niets. De bladviewport is te herkennen aan de **combinatie** `view_center == center`, `view_height == height` én `view_target == (0,0,0)` — op alle geteste bladen klopt dat precies.
- **Nagemeten bij Task 1 (154 omzetbare layouts):** het blad is 62 keer te herkennen aan nummer 1, 83 keer aan "kijkt naar zichzelf", 2 keer is het de standaardviewport van een nooit geopende layout (12 × 9 op (6; 4,5), `view_height = 12`) en 7 keer (één tekening met een leeg model) staat het op (0,0) met het beeld van de papierruimte in `view_center`. De verschuiving naar het model zit in DWG niet altijd in `view_target`: ook `view_center` komt voor. `classify` kent daarom alle vier de vormen; na de wijziging melden verkenning en omzetting op alle 154 layouts hetzelfde aantal.
- **Het viewportnummer is in DWG altijd 0**, ook voor echte viewports; de regel "de eerste is het blad" is daarom een terugval en geen kenmerk. Een terreintekening heeft één viewport die wél het blad is (0 getekend, terecht); een tekening met bouwkundige objecten heeft één isometrische viewport (`view_direction = (−1,−1,1)`) die terecht als 3D wordt overgeslagen.
- **De omzetting van een layout werkt verder goed.** Een van de testbladen levert een pagina van 841 × 1260 mm met 71 614 objecten, 12 viewports en per viewport een `/VP` met eigen `/Measure` en `/OPS_ModelMatrix`; de weergave komt overeen met het blad. Wel loopt de getekende omhullende tot `x = −556 pt`, dus buiten de MediaBox: inhoud van viewports die naast het blad valt wordt wel geschreven en daarna door de knip weggegooid.
- **Niet-rechthoekige viewports worden nu niet geknipt:** `Viewport::clip_boundary_handle` wordt nergens gelezen.
- **Eén testtekening** weigert op alle zes layouts met `IMPORT_PAGE_TOO_LARGE`: de layouts dragen geen bruikbare papiermaat en de terugval kiest een formaat uit de (zeer grote) omhullende van de papierruimte.
- **Wat het tabblad Weergave al écht doet** (doorwerking in de crate, gemeten): kleuren (`file`/`black`/`gray`), lijndikte `file`/`fixed` met factor en ondergrens, lijntypen met `$LTSCALE` én `$PSLTSCALE` (in een viewport wordt `lt_factor = 1/schaal`), tekst aan/uit, arceringen in vier standen inclusief **echte patroonarceringen** (`hatch::pattern` genereert patroonlijnen en laat de PDF-lezer ze op de grens knippen; te fijne patronen vallen terug op de omtrek en tellen als `hatchPatternsSkipped`), maatvoering, attributen en punten.
- **Wat alleen UI of alleen een melding is:** de lettertypen worden getoond als losse mededeling (`cadImport.fonts`) maar niet vervangen — alle tekst gaat naar Helvetica met WinAnsi, tekens daarbuiten tellen als `replacedCharacters`. Er is geen kleurentabel. Externe verwijzingen worden alleen geteld (`xrefsSkipped`), afbeeldingen ook (`imagesSkipped`); voor beide is er geen instelling. De voorinstellingen werken wel volledig (opslaan, toepassen, verwijderen, gecontroleerd terugzetten).
- **Onderin ontbreekt:** de voorbeeldweergave en het doel "onderlegger"; "nieuw document" en "nieuwe pagina" werken.
- **Modelmatrix (terugweg naar CAD).** De import schrijft `/OPS_ModelMatrix` en `/OPS_ModelUnits` al, per viewport, met twaalf significante cijfers; nagemeten op een van de testbladen (`/OPS_ModelMatrix [ 35.27778 0 0 35.27778 -14332.394 -63034.908 ]`). De **export** leest ze nog niet: `OriginMode` kent alleen `Page` en `Area`. Dat is Task 8.
- **Bouwsteen voor de voorbeeldweergave:** het Tauri-commando `render_pdf_page_region` (`path`, `pageIndex`, `scale`, `rotation`, `regionXPt/YPt/WPt/HPt`) levert een RGBA-buffer met een kop van twee `uint32` LE; `js/annotations/vector-snippet-preview.js` gebruikt het al zo.
- **Bouwsteen voor de onderlegger:** `knipselAlsMiniPdf`, `bewaar`/`padVan` (`vector-snippet-store.js`), `zetKnipselOpKlembord`/`plakKnipsel` (`vector-snippet-clipboard.js`) en het schrijfpad `js/pdf/saver/vector-snippet.js` (`tekenKnipselInPagina` tekent met `page.pushOperators`, dus altijd bóven de bestaande inhoud).
- **Uitgangswaarde:** `cargo test -p open-pdf-cad` is groen (55 tests in de crate, 8 in `tests/synthetic_page.rs`, plus `tests/import_roundtrip.rs`).

## Bewust buiten dit plan

- "Tekst als omtrek" uit tabel E5: dat vraagt letteromtrekken uit SHX- of TrueType-bestanden en hoort niet bij fase 6 (Deel J noemt alleen lettertypevervanging). Het venster biedt de keuze niet aan.
- Een UCS per viewport (`ucs_per_viewport`, `ucs_origin`, `ucs_x_axis`): in de hele verificatieverzameling kwam geen blad voor waar dat het beeld verandert; zie "Open risico's" in Task 17.
- IFC (fase 4) en de stromende DXF-schrijver (fase 3).
- Het **exportvenster** (fase 2 van de export, Deel E6). Task 8 maakt de terugweg naar CAD in de crate en in de commando-schil; een keuzelijst "oorspronkelijke modelcoördinaten" in een venster komt met fase 2.

## Takenoverzicht

| # | Taak | Produceert |
|---|------|------------|
| 1 | `import/viewport.rs`: één beoordeling voor verkenning én wandeling, met knipgrens | `classify`, `ViewportUse`, `ViewportView`, `clip_boundary` |
| 2 | Kleurentabel kleur → lijndikte | `style::PenTable`, `LineweightMode::Pens` |
| 3 | Lettertypevervanging en meerdere letterbronnen | `text::FontChoice`, `text::FontMap`, `/F1…/Fn` |
| 4 | Externe verwijzingen laden | `import/xref.rs`, `Walker::draw_xref` |
| 5 | Afbeeldingen insluiten | `import/image.rs`, `Sink::image` |
| 6 | Blokken als formulier-XObject | `Sink::begin_form`, `FormAction`, `PageBuilder::charged_bytes` |
| 7 | Voorbeeldstand in de omzetter | `ImportOptions::preview`, waarschuwing `previewSimplified` |
| 8 | Terugweg naar CAD: exporteren in modelcoördinaten | `model_space.rs`, `OriginMode::Model` |
| 9 | Tauri-schil: nieuwe argumenten en `preview_cad_import` | commando + eenheidstests |
| 10 | i18n: nieuwe sleutels in 39 talen | `cadImport.*` |
| 11 | Venster: tabblad Weergave uitgebreid | kleurentabel, lettertabel, xrefs, afbeeldingen |
| 12 | Venster: voorbeeldweergave | `CadImportPreview.jsx` |
| 13 | Venster: onderlegger op de huidige pagina | `plaatsAlsOnderlegger` |
| 14 | Voorinstellingen, dubbele laagnamen en de wachtrij afronden | `cad-import.test.mjs` |
| 15 | MCP-opdracht `app_import_cad` | tool + brug |
| 16 | Verificatie in een geïsoleerde releasebuild | meetverslag |
| 17 | Ontwerp bijwerken | spec |

---

### Task 1: `import/viewport.rs` — één beoordeling van een viewport, met knipgrens

**Files:**
- Create: `open-pdf-cad/src/import/viewport.rs`
- Modify: `open-pdf-cad/src/import/mod.rs` (module aanmelden)
- Modify: `open-pdf-cad/src/import/walk.rs` (`fn viewport` gebruikt de gedeelde beoordeling)
- Modify: `open-pdf-cad/src/import/scan.rs` (dezelfde beoordeling voor `ViewportScan`)
- Modify: `open-pdf-cad/src/import/tests.rs` (nieuwe tests)

**Interfaces:**
- Consumes: `acadrust::entities::{EntityType, Viewport}`, `acadrust::types::Handle`, `acadrust::CadDocument`, `crate::import::curves::Xform3`.
- Produces (in `crate::import::viewport`):
  - `pub struct ViewportView { pub model_to_paper: Xform3, pub corners: Vec<(f64, f64)>, pub scale: f64, pub frozen_layers: Vec<Handle>, pub covers_page: bool }` — `Debug, Clone`
  - `pub enum ViewportUse { Sheet, Hidden, Degenerate, NotPlan, Draw(Box<ViewportView>) }` — `Debug`
  - `pub struct LayoutSheet { pub first: Option<Handle>, pub pages: Vec<[f64; 4]>, pub twist_in_degrees: bool }` met `LayoutSheet::of(document, record_name, source_is_dxf)` en `LayoutSheet::classify(&self, viewport)` — één keer per layout bepaald, door verkenning en wandeling op dezelfde manier: de eerste VIEWPORT in de rauwe volgorde van het blokrecord (`first_viewport`), de rechthoeken die het hele blad zijn (`LayoutPaper::sheet_rects`) en of de draaiing in graden staat (DXF) of in radialen (DWG).
  - `pub fn classify(viewport: &Viewport, first: bool, pages: &[[f64; 4]]) -> ViewportUse` — herkent het blad aan vijf vormen (de vijfde is het vangnet uit de review: de eerste viewport zonder nummer die minstens 95 % van het papier beslaat, ook als hij niet op ware grootte staat); de kijkrichting wordt vóór de vormen van het blad beoordeeld. De eerste vier: nummer 1 (DXF), "kijkt naar zichzelf", de standaardviewport van een nooit geopende layout (12 × 9 op (6; 4,5), zonder nummer, waar ook in de lijst) en — alleen als eerste viewport zonder nummer — ware grootte op de oorsprong zonder doel. De laatste twee komen uit de sweep op de verificatieverzameling (2 resp. 7 layouts).
  - `pub fn clip_corners(document: &CadDocument, viewport: &Viewport) -> Vec<(f64, f64)>` — gesloten polylijn (bulges uitgerold met `curves::bulge_arc`), cirkel of gesloten ellips, als veelhoek binnen een tienduizendste van de viewportmaat
  - `pub const SHEET_COVER: f64 = 0.95;`
  - `pub const MAX_CLIP_POINTS: usize = 4096;`

- [x] **Step 1: Falende tests schrijven**

Voeg onderaan `open-pdf-cad/src/import/tests.rs` toe (de bestaande helpers `TestDoc`, `Recorder`, `layout_doc()` blijven staan):

```rust
// ── Viewports: één beoordeling voor verkenning en wandeling ─────────────

use super::viewport::{classify, clip_corners, ViewportUse};
use acadrust::entities::{LwPolyline, LwVertex};
use acadrust::types::Vector2;

/// Een viewport zoals een blad hem draagt: het venster kijkt naar zichzelf.
fn sheet_viewport() -> Viewport {
    let mut v = Viewport::with_size(Vector3::new(150.0, 100.0, 0.0), 300.0, 200.0);
    v.id = 0;
    v.view_center = Vector3::new(150.0, 100.0, 0.0);
    v.view_target = Vector3::new(0.0, 0.0, 0.0);
    v.view_height = 200.0;
    v
}

/// Een detailvenster op 1:1 zoals DWG het schrijft: de verschuiving zit in
/// `view_target`, `view_center` blijft (0,0).
fn detail_viewport() -> Viewport {
    let mut v = Viewport::with_size(Vector3::new(60.0, 40.0, 0.0), 50.0, 30.0);
    v.id = 0;
    v.view_center = Vector3::new(0.0, 0.0, 0.0);
    v.view_target = Vector3::new(627_508.0, -22_509.0, 0.0);
    v.view_height = 30.0;
    v
}

#[test]
fn a_detail_viewport_at_one_to_one_is_not_mistaken_for_the_sheet() {
    assert!(matches!(classify(&sheet_viewport(), true, &[]), ViewportUse::Sheet));
    assert!(matches!(classify(&sheet_viewport(), false, &[]), ViewportUse::Sheet));
    match classify(&detail_viewport(), false, &[]) {
        ViewportUse::Draw(view) => {
            assert!((view.scale - 1.0).abs() < 1e-9);
            let p = view.model_to_paper.point([627_508.0, -22_509.0, 0.0]);
            assert!((p.x - 60.0).abs() < 1e-6 && (p.y - 40.0).abs() < 1e-6, "het doel komt in het midden");
        }
        other => panic!("detailvenster valt weg: {other:?}"),
    }
    assert!(matches!(classify(&detail_viewport(), true, &[]), ViewportUse::Draw(_)));
}

#[test]
fn a_viewport_that_is_off_or_degenerate_or_not_a_plan_view_is_named() {
    let mut off = detail_viewport();
    off.status.is_on = false;
    assert!(matches!(classify(&off, false, &[]), ViewportUse::Hidden));

    let mut flat = detail_viewport();
    flat.view_height = 0.0;
    assert!(matches!(classify(&flat, false, &[]), ViewportUse::Degenerate));

    let mut iso = detail_viewport();
    iso.view_direction = Vector3::new(-1.0, -1.0, 1.0);
    assert!(matches!(classify(&iso, false, &[]), ViewportUse::NotPlan));

    let mut numbered = detail_viewport();
    numbered.id = 1;
    assert!(matches!(classify(&numbered, false, &[]), ViewportUse::Sheet), "in DXF draagt het blad nummer 1");
}

#[test]
fn the_scan_and_the_drawing_report_the_same_number_of_viewports() {
    let drawing = layout_doc();
    let scan = scan_drawing(&drawing, &AtomicBool::new(false)).unwrap();
    let blad = scan.spaces.iter().find(|s| s.id == "Blad").unwrap();

    let record = scan::space_record(&drawing.document, "Blad").expect("layout");
    let mut walker = Walker::new(&drawing.document, WalkSettings::default(), true);
    let mut sink = Recorder::default();
    walker.paper_space(&record.record, Xform3::IDENTITY, &mut sink);

    assert_eq!(blad.viewports.len() as u64, walker.stats.viewports_drawn);
    assert_eq!(walker.measure_viewports.len(), blad.viewports.len());
}

#[test]
fn a_non_rectangular_viewport_is_clipped_on_its_own_boundary() {
    let mut t = TestDoc::new();
    t.layer("Wanden", 1, |_| {});
    t.doc.add_layout("Blad").unwrap();
    let mut boundary = LwPolyline::new();
    boundary.is_closed = true;
    for (x, y) in [(10.0, 10.0), (110.0, 10.0), (10.0, 110.0)] {
        boundary.vertices.push(LwVertex {
            location: Vector2::new(x, y),
            bulge: 0.0,
            start_width: 0.0,
            end_width: 0.0,
            vertex_id: 0,
        });
    }
    let clip = t.doc.add_entity_to_layout(EntityType::LwPolyline(boundary), "Blad").unwrap();

    let mut v = Viewport::with_size(Vector3::new(60.0, 60.0, 0.0), 100.0, 100.0);
    v.id = 2;
    v.view_center = Vector3::new(500.0, 50.0, 0.0);
    v.view_height = 10_000.0;
    v.clip_boundary_handle = clip;
    t.doc.add_entity_to_layout(EntityType::Viewport(v.clone()), "Blad").unwrap();

    assert_eq!(clip_corners(&t.doc, &v).len(), 3, "de driehoek, niet de rechthoek");
    match classify(&v, false, &[]) {
        ViewportUse::Draw(view) => assert_eq!(view.corners.len(), 4, "zonder document is het de rechthoek"),
        other => panic!("{other:?}"),
    }
}
```

Verwachte uitvoer vóór de wijziging: `error[E0432]: unresolved import` voor `super::viewport` — de module bestaat nog niet.

- [x] **Step 2: De module schrijven**

Maak `open-pdf-cad/src/import/viewport.rs`. Het blok hieronder is de module zoals hij er na de review staat, met alle vormen van het blad, de gedeelde bepaling van de eerste viewport en de knipgrens met bogen (de tests van de module zelf staan in het bestand en zijn hier weggelaten). `LayoutSheet::of` gebruikt `scan::record_paper` en `LayoutPaper::sheet_rects`; die komen in dezelfde stap in `scan.rs` en `paper.rs`.

```rust
//! Beoordeling van één VIEWPORT van een layout (#400).
//!
//! De verkenning (het importvenster) en de wandeling (de omzetting) gebruiken
//! deze module allebei, zodat het venster precies meldt wat er op de pagina
//! komt. Daarvóór had elk zijn eigen filter en telde het venster op een blad
//! met detailvensters op ware grootte er zeven waar de omzetting er twaalf
//! tekende.
//!
//! De afbeelding model naar papier is:
//!
//! ```text
//! papier = ((model - view_target) x R(twist) - view_center) * schaal + center
//! schaal = height / view_height
//! ```
//!
//! In DWG staat het viewportnummer altijd op 0; in DXF draagt het blad
//! nummer 1. De verschuiving naar het model zit in `view_target`, in
//! `view_center` of in allebei; alle vormen komen met dezelfde formule goed
//! uit. `view_center` staat in het beeldvlak van de viewport (dus ná de
//! draaiing over `twist`), `view_target` in het model.
//!
//! De draaiing staat in DWG in radialen en in DXF in graden (groep 51); het
//! documentmodel neemt het getal uit het bestand ongewijzigd over.
//! [`LayoutSheet`] weet uit welk soort bestand de tekening komt en rekent om.
//! Het teken (positief = het model draait op papier tegen de klok in) en de
//! plaats van `view_center` volgen de beschrijving van het formaat; in de
//! verificatieverzameling (433 viewports) komt geen enkele gedraaide viewport
//! voor, dus tegen een echte tekening is dit niet bevestigd.
//!
//! Welke viewport "de eerste" is, hangt niet af van de tekenvolgorde of van
//! wat er gefilterd wordt: het is de eerste VIEWPORT in de rauwe lijst van het
//! blokrecord ([`LayoutSheet::of`]). Verkenning en wandeling vragen het op
//! dezelfde plek op.

use super::curves::{bulge_arc, cross, Xform3};
use acadrust::entities::{EntityType, Viewport};
use acadrust::types::Handle;
use acadrust::CadDocument;

/// Hoogste aantal hoekpunten van een eigen knipgrens; daarboven valt de
/// viewport terug op zijn rechthoek (werkgrens).
pub const MAX_CLIP_POINTS: usize = 4096;

/// Deel van het blad dat een viewport moet beslaan om "het hele blad" te zijn.
pub const SHEET_COVER: f64 = 0.95;

/// Een viewport die getekend wordt.
#[derive(Debug, Clone)]
pub struct ViewportView {
    /// Model (WCS) naar papierruimte van de layout.
    pub model_to_paper: Xform3,
    /// Knipgrens in papierruimte: de rechthoek van de viewport.
    pub corners: Vec<(f64, f64)>,
    /// Papiereenheden per tekeningeenheid.
    pub scale: f64,
    /// Lagen die alleen in deze viewport bevroren zijn.
    pub frozen_layers: Vec<Handle>,
    /// De rechthoek beslaat (nagenoeg) het hele blad. Geen fout, wel een
    /// melding waard: het kan een blad zijn dat niet als blad herkend is.
    pub covers_page: bool,
}

/// Wat er met een viewport gebeurt.
#[derive(Debug)]
pub enum ViewportUse {
    /// De viewport van het blad zelf: die kijkt naar zichzelf en toont geen model.
    Sheet,
    /// Staat uit.
    Hidden,
    /// Maten of kijkhoogte zijn nul of geen getal.
    Degenerate,
    /// Geen bovenaanzicht (perspectief of een andere kijkrichting).
    NotPlan,
    /// Tekenen.
    Draw(Box<ViewportView>),
}

/// Wat de beoordeling van een viewport over zijn layout moet weten. Eén keer
/// per layout bepaald, door de verkenning en de wandeling op dezelfde manier.
#[derive(Debug, Clone, Default)]
pub struct LayoutSheet {
    /// De eerste VIEWPORT in de rauwe volgorde van het blokrecord.
    pub first: Option<Handle>,
    /// Rechthoeken in papierruimte die het hele blad zijn (zie
    /// [`super::paper::LayoutPaper::sheet_rects`]).
    pub pages: Vec<[f64; 4]>,
    /// De tekening komt uit een DXF: de draaiing van een viewport staat dan
    /// in graden in plaats van in radialen.
    pub twist_in_degrees: bool,
}

impl LayoutSheet {
    /// De gegevens van de layout bij dit blokrecord (`*Paper_Space…`).
    /// `source_is_dxf` zegt uit welk soort bestand de tekening komt.
    pub fn of(document: &CadDocument, record_name: &str, source_is_dxf: bool) -> LayoutSheet {
        LayoutSheet {
            first: first_viewport(document, record_name),
            pages: super::scan::record_paper(document, record_name).map(|paper| paper.sheet_rects()).unwrap_or_default(),
            twist_in_degrees: source_is_dxf,
        }
    }

    /// Beoordeelt een viewport van deze layout.
    pub fn classify(&self, viewport: &Viewport) -> ViewportUse {
        let handle = viewport.common.handle;
        let first = handle != Handle::NULL && self.first == Some(handle);
        let twist = or(viewport.twist_angle, 0.0);
        classify_with(viewport, first, &self.pages, if self.twist_in_degrees { twist.to_radians() } else { twist })
    }
}

/// Handle van de eerste VIEWPORT in `entity_handles` van het blokrecord: de
/// volgorde van het bestand, vóór de tekenvolgorde (SORTENTSTABLE) en vóór elk
/// filter (onzichtbaar, laag uitgesloten). De plaats van het blad mag daar niet
/// van afhangen.
pub fn first_viewport(document: &CadDocument, record_name: &str) -> Option<Handle> {
    let record = document.block_records.get(record_name)?;
    record
        .entity_handles
        .iter()
        .copied()
        .find(|handle| matches!(document.get_entity(*handle), Some(EntityType::Viewport(_))))
}

/// Ligt `a` op `b`, met een tolerantie die met de maat meeschaalt?
fn same(a: f64, b: f64, size: f64) -> bool {
    (a - b).abs() <= 1e-6 * size.abs().max(1.0)
}

/// Een getal dat bruikbaar is, of de terugval.
fn or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// Beslaat `rect` minstens [`SHEET_COVER`] van `page`?
fn covers(rect: [f64; 4], page: [f64; 4]) -> bool {
    let area = (page[2] - page[0]) * (page[3] - page[1]);
    let ix = (rect[2].min(page[2]) - rect[0].max(page[0])).max(0.0);
    let iy = (rect[3].min(page[3]) - rect[1].max(page[1])).max(0.0);
    area.is_finite() && area > 0.0 && ix * iy >= SHEET_COVER * area
}

/// Beoordeelt een viewport. `first` is waar voor de eerste VIEWPORT van de
/// papierruimte ([`first_viewport`]); dat is een terugval voor bestanden
/// zonder bruikbaar nummer. `pages` zijn de rechthoeken die het hele blad zijn.
/// De draaiing wordt als radialen gelezen (DWG); zie [`LayoutSheet::classify`].
pub fn classify(viewport: &Viewport, first: bool, pages: &[[f64; 4]]) -> ViewportUse {
    classify_with(viewport, first, pages, or(viewport.twist_angle, 0.0))
}

/// Als [`classify`], met de draaiing in radialen apart opgegeven.
fn classify_with(viewport: &Viewport, first: bool, pages: &[[f64; 4]], twist: f64) -> ViewportUse {
    if !viewport.status.is_on {
        return ViewportUse::Hidden;
    }
    // Het blad draagt in DXF nummer 1. In DWG is het nummer altijd 0, dus daar
    // telt alleen de vorm hieronder (en, als terugval, de plaats in de lijst).
    if viewport.id == 1 {
        return ViewportUse::Sheet;
    }
    let (w, h, vh) = (viewport.width, viewport.height, viewport.view_height);
    if !(w.is_finite() && h.is_finite() && vh.is_finite()) || w <= 0.0 || h <= 0.0 || vh <= 0.0 {
        return ViewportUse::Degenerate;
    }
    // Terugval: een eerste viewport zonder nummer en zonder bruikbare
    // kijkgegevens is het blad.
    if first && viewport.id <= 0 && !viewport.view_target.x.is_finite() {
        return ViewportUse::Sheet;
    }
    // De kijkrichting gaat vóór de vormen van het blad: een isometrisch venster
    // dat toevallig op de plaats en de maat van een blad staat, is geen blad en
    // hoort in de telling van overgeslagen 3D-viewports.
    let direction = viewport.view_direction;
    let is_plan = direction.x.abs() < 1e-9 && direction.y.abs() < 1e-9 && direction.z >= 0.0;
    if !is_plan || viewport.status.perspective {
        return ViewportUse::NotPlan;
    }
    // Een viewport die naar zichzelf kijkt is het blad: zelfde middelpunt,
    // zelfde hoogte en geen verschuiving naar het model. Alleen de hoogte
    // vergelijken is niet genoeg: een detailvenster op 1:1 heeft die ook.
    let looks_at_itself = same(vh, h, h)
        && same(or(viewport.view_center.x, 0.0), viewport.center.x, w)
        && same(or(viewport.view_center.y, 0.0), viewport.center.y, h)
        && same(or(viewport.view_target.x, 0.0), 0.0, 1.0)
        && same(or(viewport.view_target.y, 0.0), 0.0, 1.0);
    if looks_at_itself {
        return ViewportUse::Sheet;
    }
    // Twee vormen van het blad die niet naar zichzelf kijken, allebei gemeten
    // op de verificatieverzameling en allebei alleen zonder nummer (DWG):
    // - een layout die nooit geopend is, draagt de standaardviewport van
    //   12 x 9 op (6; 4,5), waar hij ook in de lijst staat;
    // - sommige bestanden zetten het blad op (0,0) en bewaren het beeld van
    //   de papierruimte in `view_center`: ware grootte, geen doel. Dat telt
    //   alleen voor de eerste viewport, zodat een echt venster op 1:1 verderop
    //   in de lijst blijft staan.
    let no_target = same(or(viewport.view_target.x, 0.0), 0.0, 1.0) && same(or(viewport.view_target.y, 0.0), 0.0, 1.0);
    if viewport.id <= 0 && no_target {
        let unopened = same(w, 12.0, 1.0)
            && same(h, 9.0, 1.0)
            && same(viewport.center.x, 6.0, 1.0)
            && same(viewport.center.y, 4.5, 1.0)
            && same(or(viewport.view_center.x, 0.0), 6.0, 1.0)
            && same(or(viewport.view_center.y, 0.0), 4.5, 1.0);
        let at_origin =
            first && same(vh, h, h) && same(viewport.center.x, 0.0, 1.0) && same(viewport.center.y, 0.0, 1.0);
        if unopened || at_origin {
            return ViewportUse::Sheet;
        }
    }
    let (cx, cy) = (viewport.center.x, viewport.center.y);
    let (hw, hh) = (w / 2.0, h / 2.0);
    let rect = [cx - hw, cy - hh, cx + hw, cy + hh];
    let covers_page = pages.iter().any(|page| covers(rect, *page));
    // Vangnet: de eerste viewport zonder nummer die het hele blad beslaat, is
    // het blad, ook als hij niet op ware grootte staat (`view_height` wijkt af
    // van `height`). Zonder dit vangnet zou het hele model over het blad heen
    // getekend worden.
    if first && viewport.id <= 0 && covers_page {
        return ViewportUse::Sheet;
    }
    let scale = h / vh;
    if !(scale.is_finite() && scale > 0.0) {
        return ViewportUse::Degenerate;
    }
    let (tx, ty, tz) = (
        or(viewport.view_target.x, 0.0),
        or(viewport.view_target.y, 0.0),
        or(viewport.view_target.z, 0.0),
    );
    let (vcx, vcy) = (or(viewport.view_center.x, 0.0), or(viewport.view_center.y, 0.0));
    let offset = (viewport.center.x - vcx * scale, viewport.center.y - vcy * scale);
    // Eerst draaien, dan pas `view_center` eraf: dat punt staat in het
    // beeldvlak van de viewport, niet in het model.
    let model_to_paper = Xform3::translate(-tx, -ty, -tz)
        .then(&Xform3::scale(scale, scale, scale))
        .then(&Xform3::rotate_z(twist))
        .then(&Xform3::translate(offset.0, offset.1, 0.0));

    let corners = vec![(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])];
    ViewportUse::Draw(Box::new(ViewportView {
        model_to_paper,
        corners,
        scale,
        frozen_layers: viewport.frozen_layers.clone(),
        covers_page,
    }))
}

/// Aantal rechte stukken voor een boog met deze straal en hoek, zodat de
/// koorde nergens verder dan `tolerance` van de boog ligt.
fn arc_steps(radius: f64, sweep: f64, tolerance: f64) -> usize {
    if !(radius.is_finite() && sweep.is_finite()) || radius <= 0.0 {
        return 1;
    }
    let step = if tolerance > 0.0 && tolerance < radius {
        2.0 * (1.0 - tolerance / radius).acos()
    } else {
        std::f64::consts::FRAC_PI_2
    };
    let n = (sweep.abs() / step.max(1e-3)).ceil();
    if n.is_finite() {
        (n as usize).clamp(1, MAX_CLIP_POINTS)
    } else {
        1
    }
}

/// Rolt een gesloten polylijn met bulges uit tot een veelhoek. Stopt zodra de
/// werkgrens overschreden is; de aanroeper ziet dat aan de lengte.
fn unroll(vertices: &[((f64, f64), f64)], tolerance: f64) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = Vec::new();
    let n = vertices.len();
    for (i, (a, bulge)) in vertices.iter().enumerate() {
        out.push(*a);
        if out.len() > MAX_CLIP_POINTS {
            return out;
        }
        let Some((b, _)) = vertices.get((i + 1) % n.max(1)) else { continue };
        // De boogfunctie van de polylijn: middelpunt, straal en de hoeken met
        // teken (negatieve bulge = met de klok mee).
        let Some((center, radius, start, end)) = bulge_arc(*a, *b, *bulge) else { continue };
        let steps = arc_steps(radius, end - start, tolerance);
        for k in 1..steps {
            let t = start + (end - start) * k as f64 / steps as f64;
            out.push((center.0 + radius * t.cos(), center.1 + radius * t.sin()));
            if out.len() > MAX_CLIP_POINTS {
                return out;
            }
        }
    }
    out
}

/// Een gesloten ellips (of cirkel) als veelhoek: `c + u cos t + v sin t`.
fn ellipse_polygon(c: (f64, f64), u: (f64, f64), v: (f64, f64), tolerance: f64) -> Vec<(f64, f64)> {
    let radius = u.0.hypot(u.1).max(v.0.hypot(v.1));
    let steps = arc_steps(radius, std::f64::consts::TAU, tolerance).max(8);
    (0..steps)
        .map(|k| {
            let t = std::f64::consts::TAU * k as f64 / steps as f64;
            (c.0 + u.0 * t.cos() + v.0 * t.sin(), c.1 + u.1 * t.cos() + v.1 * t.sin())
        })
        .collect()
}

/// Een eigen knipgrens (`clip_boundary_handle`), als de viewport er een heeft
/// en die bruikbaar is. Leeg betekent: de rechthoek van de viewport.
///
/// De grens is een gesloten polylijn (bulges worden uitgerold), een cirkel of
/// een gesloten ellips; een boog wordt een veelhoek die nergens verder dan een
/// tienduizendste van de viewportmaat van de kromme ligt. Een spline of een
/// regio als grens valt terug op de rechthoek.
///
/// In het bestand staat ook een statusvlag "niet-rechthoekig knippen aan"
/// (bit 0x10000 van de status). Het documentmodel bewaart alleen de bits 0 tot
/// en met 15, dus die vlag is hier niet te lezen. De handle is het enige
/// kenmerk: de lezer vult hem alleen bij een viewport die een knipgrens
/// draagt. Bekende beperking: een bestand dat de grens bewaart maar het
/// knippen uitzet, wordt hier toch geknipt.
pub fn clip_corners(document: &CadDocument, viewport: &Viewport) -> Vec<(f64, f64)> {
    let handle = viewport.clip_boundary_handle;
    if handle == Handle::NULL {
        return Vec::new();
    }
    let size = viewport.width.abs().max(viewport.height.abs());
    let tolerance = if size.is_finite() && size > 0.0 { size * 1e-4 } else { 0.01 };
    // Eén punt meer dan de grens lezen: zo is te zien dat de grens te groot
    // is, zonder een afgekapte (en dus verkeerde) vorm te gebruiken.
    let points: Vec<(f64, f64)> = match document.get_entity(handle) {
        Some(EntityType::LwPolyline(poly)) => {
            let vertices: Vec<((f64, f64), f64)> =
                poly.vertices.iter().take(MAX_CLIP_POINTS + 1).map(|v| ((v.location.x, v.location.y), v.bulge)).collect();
            unroll(&vertices, tolerance)
        }
        Some(EntityType::Polyline2D(poly)) => {
            let spline_fit = poly.flags.is_spline_fit();
            let vertices: Vec<((f64, f64), f64)> = poly
                .vertices
                .iter()
                .filter(|v| !(spline_fit && v.flags.bits() & 16 != 0))
                .take(MAX_CLIP_POINTS + 1)
                .map(|v| ((v.location.x, v.location.y), v.bulge))
                .collect();
            unroll(&vertices, tolerance)
        }
        Some(EntityType::Circle(circle)) if circle.radius.is_finite() && circle.radius > 0.0 => {
            // Het middelpunt staat in het vlak van de cirkel; de assen draaien mee.
            let ocs = Xform3::ocs([circle.normal.x, circle.normal.y, circle.normal.z]);
            let c = ocs.point([circle.center.x, circle.center.y, circle.center.z]);
            let u = ocs.vector([circle.radius, 0.0, 0.0]);
            let v = ocs.vector([0.0, circle.radius, 0.0]);
            ellipse_polygon((c.x, c.y), (u.x, u.y), (v.x, v.y), tolerance)
        }
        Some(EntityType::Ellipse(ellipse))
            if (ellipse.end_parameter - ellipse.start_parameter).abs() >= std::f64::consts::TAU - 1e-9 =>
        {
            let major = [ellipse.major_axis.x, ellipse.major_axis.y, ellipse.major_axis.z];
            let minor = cross([ellipse.normal.x, ellipse.normal.y, ellipse.normal.z], major);
            let ratio = ellipse.minor_axis_ratio.abs();
            ellipse_polygon(
                (ellipse.center.x, ellipse.center.y),
                (major[0], major[1]),
                (minor[0] * ratio, minor[1] * ratio),
                tolerance,
            )
        }
        _ => Vec::new(),
    };
    if points.len() < 3 || points.len() > MAX_CLIP_POINTS || !points.iter().all(|(x, y)| x.is_finite() && y.is_finite()) {
        return Vec::new();
    }
    points
}
```

- [x] **Step 3: De module aanmelden**

Voeg in `open-pdf-cad/src/import/mod.rs` bij de moduleregels toe, ná `pub mod text;`:

```rust
pub mod viewport;
```

- [x] **Step 4: De wandeling laat de beoordeling doen**

Vervang in `open-pdf-cad/src/import/walk.rs` de hele functie `fn viewport(&mut self, …)` (het blok onder `// ── Viewports ──`, tot en met `sink.pop_clip();` en de sluitende accolade) door:

```rust
    // ── Viewports ────────────────────────────────────────────────────────
    fn viewport(&mut self, viewport: &Viewport, ctx: &Ctx<'a>, sink: &mut dyn Sink) {
        // Alleen viewports die rechtstreeks in een papierruimte staan; een
        // viewport binnen een viewport (of in de modelruimte) zou het model
        // eindeloos opnieuw tekenen.
        if ctx.depth > 0 {
            return;
        }
        // `self.sheet` is in `paper_space` gezet met `LayoutSheet::of`: welke
        // viewport de eerste is, volgt uit het bestand en niet uit een teller.
        let view = match self.sheet.classify(viewport) {
            super::viewport::ViewportUse::Draw(view) => view,
            super::viewport::ViewportUse::NotPlan => {
                self.stats.viewports_3d_skipped += 1;
                return;
            }
            _ => return,
        };

        // Een eigen (niet-rechthoekige) knipgrens gaat voor de rechthoek.
        let own = super::viewport::clip_corners(self.doc, viewport);
        let outline: &[(f64, f64)] = if own.is_empty() { &view.corners } else { &own };
        let on_page: Vec<Point> = outline.iter().map(|(x, y)| ctx.xf.point([*x, *y, 0.0])).collect();
        let mut clip = PagePath::new();
        for (i, p) in on_page.iter().enumerate() {
            if i == 0 {
                clip.move_to(*p);
            } else {
                clip.line_to(*p);
            }
        }
        clip.close();
        let Some(bounds) = clip.bounds() else { return };
        if !sink.wants(bounds) {
            return;
        }

        let model_to_page = view.model_to_paper.then(&ctx.xf);
        let frozen: HashSet<String> = view
            .frozen_layers
            .iter()
            .filter_map(|h| self.layer_by_handle.get(&h.value()))
            .map(|name| name.to_uppercase())
            .collect();
        let mut child = self.root_ctx(model_to_page);
        child.vp_frozen = Some(Rc::new(frozen));
        child.lt_factor = if self.psltscale { 1.0 / view.scale } else { 1.0 };
        child.depth = ctx.depth + 1;

        self.stats.viewports_drawn += 1;
        if view.covers_page {
            self.stats.viewports_cover_page += 1;
        }
        self.measure_viewports.push(MeasureViewport {
            bbox: bounds,
            // De eigen vorm gaat mee als hij meer zegt dan de omhullende.
            outline: if own.is_empty() || fills_its_bounds(&on_page, bounds) { Vec::new() } else { on_page },
            matrix: model_to_page.plane(0.0),
            units_per_point: 1.0 / model_to_page.xy_scale().max(1e-12),
            name: String::new(),
        });
        sink.push_clip(&clip, false);
        self.space("*Model_Space", &child, sink);
        sink.pop_clip();
    }
```

In `fn entity` wordt een VIEWPORT afgehandeld **vóór** het lagenfilter (`if !visible { return; }`): de laag van een viewport is de laag van zijn kader, en die laag weglaten (niet plotbaar, uit, bevroren of door de gebruiker uitgezet) mag nooit verbergen wat het venster toont. Zonder die volgorde komt een blad met de standaardinstelling "niet-plotbare lagen overslaan" leeg binnen.

- [x] **Step 5: De verkenning laat dezelfde beoordeling doen**

Vervang in `open-pdf-cad/src/import/scan.rs` het blok dat de viewports telt (vanaf `let mut viewports = Vec::new();` tot en met de sluitende accolade van `if let Some(record) = document.block_records.get(&space.record) { … }`) door:

```rust
        let mut viewports = Vec::new();
        let mut viewports_3d = 0u64;
        let mut has_model = false;
        if let Some(record) = document.block_records.get(&space.record) {
            // Precies de beoordeling die ook tekent (import/viewport.rs): wat
            // het venster hier meldt, komt zo op de pagina. Welke viewport de
            // eerste is, bepaalt de layout zelf en niet de plaats in deze lus.
            let sheet = super::viewport::LayoutSheet::of(document, &space.record, drawing.is_dxf);
            for handle in &record.entity_handles {
                let Some(EntityType::Viewport(viewport)) = document.get_entity(*handle) else { continue };
                if viewport.common.invisible {
                    continue;
                }
                let view = match sheet.classify(viewport) {
                    super::viewport::ViewportUse::Draw(view) => view,
                    super::viewport::ViewportUse::NotPlan => {
                        viewports_3d += 1;
                        continue;
                    }
                    _ => continue,
                };
                has_model = true;
                let paper_mm = space_paper(document, &space, mm_per_unit).mm_per_unit;
                let ratio = mm_per_unit / (view.scale * paper_mm).max(1e-12);
                viewports.push(ViewportScan {
                    scale: view.scale,
                    ratio: super::paper::scale_text(ratio),
                    width: viewport.width,
                    height: viewport.height,
                    frozen_layers: view.frozen_layers.len(),
                    covers_page: view.covers_page,
                });
            }
        }
```

Het veld `ViewportScan::plan_view` vervalt (het was altijd waar). In de plaats daarvan draagt `SpaceScan` het aantal overgeslagen 3D-viewports (`viewports_3d`, in JSON `viewports3d`) en zet de verkenning de waarschuwingen `viewports3d:N` en `viewportCoversPage:N` in `warnings`, zodat het venster ze vóór de import toont.

- [x] **Step 6: Tests draaien**

```
cd <worktree>
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
```

Alles groen, inclusief de nieuwe tests en de bestaande `viewport_frozen_layers_are_hidden_only_in_that_viewport`, `each_viewport_of_a_layout_gets_its_own_measure_in_the_pdf` en `the_scan_reports_layer_states_counts_and_viewports`.

- [x] **Step 7: Controle op de verificatieverzameling**

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' \
  cargo build -p open-pdf-cad --release --examples
```

Draai daarna per tekening met layouts `import_drawing <tekening> <uit.pdf> --space <layout> --json` en `import_drawing <tekening> <uit.pdf> --scan`, met alle uitvoer in een **eigen tijdelijke map** (verificatiebestanden nooit overschrijven). Vergelijk per ruimte `spaces[].viewports.length` met `stats.viewportsDrawn`: die moeten voor elke layout gelijk zijn. Op een tekening met meerdere detailvensters op een layout zijn het er allebei 12 (was 7 tegen 12). Noteer de uitkomst; Task 16 herhaalt de sweep op de releasebuild.

**Uitkomst na de review (sweep over de hele verzameling, 365 tekeningen, 693 layouts, waarvan 154 een PDF geven; de rest is leeg of geeft dezelfde fout als voorheen):**

- *Met de instellingen van het voorbeeldprogramma* (lagen die uit of bevroren staan weggelaten): vóór en na de review op elke layout hetzelfde aantal, gemeld = getekend op alle 154, samen 260 viewports op 105 layouts en 1 overgeslagen 3D-viewport. Het vangnet en de melding `viewportCoversPage` treffen in de verzameling geen enkele viewport. 150 van de 154 PDF's zijn byte voor byte gelijk aan vóór de review; de 4 andere verschillen alleen doordat 5 vensters met een echt niet-rechthoekige grens (5 tot 10 hoekpunten) nu hun vorm als `/OPS_Clip` dragen. Alle inhoudsstromen zijn gelijk.
- *Met de standaardinstellingen van het venster* (ook niet-plotbare lagen weggelaten): vóór de review tekenden 81 layouts viewports (91 van de 260 gemelde; 24 layouts meldden vensters en tekenden er geen, omdat de kaders op een niet-plotbare laag staan). Na de review tekenen 105 layouts viewports, 260 van de 260, en is gemeld = getekend op alle 154. Vier van die bladen (4, 7, 12 en 36 vensters) zijn vóór en na gerenderd: vóór alleen het kader en wat losse tekst, na het volledige blad met alle vensters op hun plaats.
- In de hele verzameling (433 viewports) komt geen gedraaide viewport voor; zie de open risico's in Task 17.

- [x] **Step 8: Commit**

```
fix(import): verkenning en omzetting beoordelen een viewport op dezelfde manier (#400)
```

---

### Task 2: Kleurentabel kleur naar lijndikte

De pentabel die in CAD bepaalt welke pendikte bij welke kleur hoort, staat niet in het bestand (ontwerp E2). Het venster krijgt daarom een eigen tabel die als voorinstelling te bewaren is. De tabel kijkt naar de kleur **zoals het bestand hem geeft** (dus vóór "alles zwart" of "grijstinten"), want dat is de kleur waarop een pentabel in CAD werkt.

**Files:**
- Modify: `open-pdf-cad/src/import/style.rs`
- Modify: `open-pdf-cad/src/import/walk.rs`
- Modify: `open-pdf-cad/src/import/mod.rs`
- Modify: `open-pdf-cad/examples/import_drawing.rs`
- Modify: `open-pdf-cad/src/import/tests.rs`

**Interfaces:**
- Consumes: `crate::import::style::Rgb`, `acadrust::types::{Color, LineWeight}`.
- Produces:
  - `crate::import::style::PenTable` — `#[derive(Clone, Debug, Default, PartialEq)]` om een `HashMap<Rgb, f64>` (na de review: opzoeken gebeurt per getekende lijn en loopt dus niet meer alle regels af; de codeblokken hieronder tonen nog de eerste vorm met een `Vec`), met `pub fn len(&self) -> usize`, `pub fn from_pairs(pairs: &[(Rgb, f64)]) -> PenTable`, `pub fn is_empty(&self) -> bool`, `pub fn width_mm(&self, rgb: Rgb) -> Option<f64>`, `pub fn widest_mm(&self) -> Option<f64>`, `pub fn parse_color(text: &str) -> Option<Rgb>`.
  - `pub const MAX_PENS: usize = 1024;` in `crate::import::style` — werkgrens: nieuwe kleuren voorbij die grens vallen weg, een latere regel voor een bestaande kleur telt nog wel.
  - `crate::import::style::LineweightMode::Pens` (nieuwe variant naast `File` en `Fixed(f64)`; het type blijft `Copy`).
  - `crate::import::walk::WalkSettings::pens: PenTable`.
  - `crate::import::ImportOptions::pens: PenTable`.
  - `crate::import::ImportArgs::pens: Vec<PenArg>` met `pub struct PenArg { pub color: String, pub lineweight_mm: f64 }` (camelCase, `Deserialize`).
  - Gewijzigde signatuur: `Walker::weight_mm(&self, weight: LineWeight, color: Color, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> f64`.

- [x] **Step 1: Falende tests schrijven**

Voeg in `open-pdf-cad/src/import/style.rs` onderaan toe (of in de bestaande `mod tests`):

```rust
#[cfg(test)]
mod pen_tests {
    use super::*;

    #[test]
    fn a_pen_table_maps_a_colour_to_a_width() {
        let table = PenTable::from_pairs(&[((255, 0, 0), 0.35), ((0, 0, 255), 0.13)]);
        assert_eq!(table.width_mm((255, 0, 0)), Some(0.35));
        assert_eq!(table.width_mm((0, 0, 255)), Some(0.13));
        assert_eq!(table.width_mm((0, 255, 0)), None, "een kleur zonder regel valt terug op het bestand");
        assert_eq!(table.widest_mm(), Some(0.35));
        assert!(PenTable::default().is_empty());
    }

    #[test]
    fn colours_are_read_from_text_and_a_later_rule_wins() {
        assert_eq!(PenTable::parse_color("#FF8000"), Some((255, 128, 0)));
        assert_eq!(PenTable::parse_color("ff8000"), Some((255, 128, 0)));
        assert_eq!(PenTable::parse_color("#FFF"), None, "alleen zes tekens");
        assert_eq!(PenTable::parse_color("rood"), None);
        // Twee regels voor dezelfde kleur: de laatste telt.
        let table = PenTable::from_pairs(&[((1, 2, 3), 0.2), ((1, 2, 3), 0.5)]);
        assert_eq!(table.width_mm((1, 2, 3)), Some(0.5));
        // Ongeldige diktes komen er niet in.
        let table = PenTable::from_pairs(&[((1, 2, 3), f64::NAN), ((4, 5, 6), -1.0)]);
        assert!(table.is_empty());
    }
}
```

En in `open-pdf-cad/src/import/tests.rs`:

```rust
#[test]
fn the_pen_table_decides_the_line_width_and_the_colour_mode_does_not() {
    use super::style::{LineweightMode, PenTable};
    let mut t = TestDoc::new();
    t.layer("Rood", 1, |_| {});
    t.line(None, "Rood", Color::Index(1), (0.0, 0.0), (100.0, 0.0));
    let drawing = t.drawing();

    let pens = PenTable::from_pairs(&[((255, 0, 0), 0.7)]);
    let settings = WalkSettings {
        lineweight: LineweightMode::Pens,
        pens: pens.clone(),
        // Alles zwart op papier: de tabel kijkt naar de kleur uit het bestand.
        color_mode: super::style::ColorMode::Black,
        ..Default::default()
    };
    let (sink, _) = walk_model(&drawing, settings);
    assert_eq!(sink.strokes.len(), 1);
    assert_eq!(sink.strokes[0].1, (0, 0, 0), "zwart op papier");
    assert!((sink.widths[0] - 0.7 * 72.0 / 25.4).abs() < 1e-9, "dikte uit de kleurentabel");

    // Een kleur zonder regel houdt de dikte van het bestand (0,25 mm).
    let settings = WalkSettings {
        lineweight: LineweightMode::Pens,
        pens: PenTable::from_pairs(&[((0, 0, 255), 0.7)]),
        ..Default::default()
    };
    let (sink, _) = walk_model(&drawing, settings);
    assert!((sink.widths[0] - 0.25 * 72.0 / 25.4).abs() < 1e-9);
}

#[test]
fn the_pen_table_comes_through_the_arguments() {
    let args: ImportArgs = serde_json::from_str(
        r##"{"path":"a.dxf","outputPath":"a.pdf","lineweight":"pens",
            "pens":[{"color":"#FF0000","lineweightMm":0.35},{"color":"nonsens","lineweightMm":1.0}]}"##,
    )
    .unwrap();
    let options = args.options();
    assert_eq!(options.lineweight, super::style::LineweightMode::Pens);
    assert_eq!(options.pens.width_mm((255, 0, 0)), Some(0.35));
    assert_eq!(options.pens.width_mm((0, 0, 0)), None);
}
```

De `Recorder` in `tests.rs` houdt nu ook de dikte bij. Vervang zijn definitie en `Sink`-implementatie van `stroke` door:

```rust
/// Onthoudt wat er getekend wordt: laag, kleur, omhullende en lijndikte.
#[derive(Default)]
struct Recorder {
    strokes: Vec<(String, style::Rgb, [f64; 4])>,
    widths: Vec<f64>,
    limit: Option<usize>,
}
```

```rust
    fn stroke(&mut self, layer: &str, style: &Stroke, path: &PagePath) {
        self.strokes.push((layer.to_string(), style.color, path.bounds().unwrap_or([0.0; 4])));
        self.widths.push(style.width);
    }
```

Verwachte uitvoer vóór de wijziging: `error[E0599]: no function or associated item named `from_pairs` found for struct `PenTable`` (en `PenTable` bestaat nog niet).

- [x] **Step 2: `style.rs` uitbreiden**

Voeg in `open-pdf-cad/src/import/style.rs` de variant toe en de tabel. Vervang de `LineweightMode`-definitie door:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", tag = "mode", content = "value")]
pub enum LineweightMode {
    /// Diktes uit het bestand (entiteit, anders laag, anders standaard).
    File,
    /// Eén vaste dikte in mm.
    Fixed(f64),
    /// Uit de kleurentabel; een kleur zonder regel houdt de dikte van het
    /// bestand. Vervangt de pentabel die niet in het bestand staat.
    Pens,
}
```

En voeg toe (na `paper_color`):

```rust
/// Kleurentabel: welke lijndikte hoort bij welke kleur uit het bestand?
///
/// In CAD komt die koppeling uit een pentabel naast de tekening; die staat
/// niet in het bestand zelf. De gebruiker stelt hem hier in en bewaart hem als
/// voorinstelling. De tabel kijkt naar de kleur zoals het bestand hem geeft,
/// dus vóór "alles zwart" of "grijstinten".
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(transparent)]
pub struct PenTable {
    entries: Vec<(Rgb, f64)>,
}

impl PenTable {
    /// Bouwt de tabel; een regel met een onbruikbare dikte valt weg en een
    /// latere regel voor dezelfde kleur vervangt een eerdere.
    pub fn from_pairs(pairs: &[(Rgb, f64)]) -> PenTable {
        let mut entries: Vec<(Rgb, f64)> = Vec::new();
        for (rgb, mm) in pairs {
            if !mm.is_finite() || *mm < 0.0 || *mm > 10.0 {
                continue;
            }
            match entries.iter_mut().find(|e| e.0 == *rgb) {
                Some(found) => found.1 = *mm,
                None => entries.push((*rgb, *mm)),
            }
        }
        PenTable { entries }
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// De dikte in mm voor deze kleur, of `None` als er geen regel is.
    pub fn width_mm(&self, rgb: Rgb) -> Option<f64> {
        self.entries.iter().find(|e| e.0 == rgb).map(|e| e.1)
    }

    /// De dikste pen; nodig om te weten hoeveel ruimte de knip moet laten.
    pub fn widest_mm(&self) -> Option<f64> {
        self.entries.iter().map(|e| e.1).fold(None, |acc: Option<f64>, v| Some(acc.map_or(v, |a| a.max(v))))
    }

    /// `#RRGGBB` of `RRGGBB` naar een kleur; alles anders is geen kleur.
    pub fn parse_color(text: &str) -> Option<Rgb> {
        let hex = text.strip_prefix('#').unwrap_or(text);
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |from: usize| u8::from_str_radix(hex.get(from..from + 2)?, 16).ok();
        Some((byte(0)?, byte(2)?, byte(4)?))
    }
}
```

- [x] **Step 3: De wandeling gebruikt de tabel**

In `open-pdf-cad/src/import/walk.rs`:

1. Voeg aan `WalkSettings` toe, direct na `pub lineweight: LineweightMode,`:

```rust
    /// Kleurentabel; alleen gebruikt bij `LineweightMode::Pens`.
    pub pens: super::style::PenTable,
```

en in `impl Default for WalkSettings` na `lineweight: LineweightMode::File,`:

```rust
            pens: super::style::PenTable::default(),
```

2. Vervang `fn weight_mm` door:

```rust
    fn weight_mm(&self, weight: LineWeight, color: Color, layer: &LayerInfo<'a>, ctx: &Ctx<'a>) -> f64 {
        if let LineweightMode::Fixed(mm) = self.settings.lineweight {
            return mm.max(0.0);
        }
        // De kleurentabel kijkt naar de kleur uit het bestand, niet naar de
        // kleur op papier: "alles zwart" mag de pendikte niet veranderen.
        if matches!(self.settings.lineweight, LineweightMode::Pens) {
            let from_file = self.color_of(color, layer, ctx).rgb;
            if let Some(mm) = self.settings.pens.width_mm(from_file) {
                return (mm * self.settings.lineweight_factor).max(self.settings.lineweight_min_mm);
            }
        }
        let raw = match weight {
            LineWeight::Value(v) if v >= 0 => v as f64 / 100.0,
            LineWeight::ByBlock => ctx.byblock_weight,
            LineWeight::ByLayer | LineWeight::Value(_) => match layer.lineweight {
                LineWeight::Value(v) if v >= 0 => v as f64 / 100.0,
                _ => DEFAULT_LINEWEIGHT_MM,
            },
            LineWeight::Default => DEFAULT_LINEWEIGHT_MM,
        };
        (raw * self.settings.lineweight_factor).max(self.settings.lineweight_min_mm)
    }
```

3. Pas de zes aanroepen aan; elke aanroeper heeft de kleur al bij de hand:

| plaats | was | wordt |
|--------|-----|-------|
| `fn stroke_of` | `self.weight_mm(common.line_weight, layer, ctx)` | `self.weight_mm(common.line_weight, common.color, layer, ctx)` |
| SOLID/TRACE | `self.weight_mm(common.line_weight, &layer, ctx)` | `self.weight_mm(common.line_weight, common.color, &layer, ctx)` |
| attribuut-context | `self.weight_mm(common.line_weight, &layer, ctx)` | `self.weight_mm(common.line_weight, common.color, &layer, ctx)` |
| `fn insert` | `self.weight_mm(common.line_weight, layer, ctx)` | `self.weight_mm(common.line_weight, common.color, layer, ctx)` |
| arcering (patroonlijnen) | `self.weight_mm(entity.common.line_weight, layer, ctx)` | `self.weight_mm(entity.common.line_weight, entity.common.color, layer, ctx)` |
| arcering (omtrek) | `self.weight_mm(entity.common.line_weight, layer, ctx)` | `self.weight_mm(entity.common.line_weight, entity.common.color, layer, ctx)` |

- [x] **Step 4: Opties en argumenten**

In `open-pdf-cad/src/import/mod.rs`:

1. `use style::{ColorMode, LineweightMode};` wordt `use style::{ColorMode, LineweightMode, PenTable};`.

2. In `ImportOptions`, na `pub lineweight_min_mm: f64,`:

```rust
    /// Kleurentabel kleur naar lijndikte (alleen bij `LineweightMode::Pens`).
    pub pens: PenTable,
```

en in `impl Default for ImportOptions` na `lineweight_min_mm: 0.0,`:

```rust
            pens: PenTable::default(),
```

3. In `walk_settings` na `lineweight_min_mm: options.lineweight_min_mm,`:

```rust
        pens: options.pens.clone(),
```

4. Naast `ImportArgs` een eigen type voor één regel, en het veld:

```rust
/// Eén regel van de kleurentabel zoals de webview hem stuurt.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PenArg {
    /// `#RRGGBB`.
    pub color: String,
    pub lineweight_mm: f64,
}
```

In `ImportArgs`, na `pub lineweight_min_mm: Option<f64>,`:

```rust
    /// Kleurentabel: kleur naar lijndikte.
    pub pens: Vec<PenArg>,
```

5. In `ImportArgs::options()` de keuze uitbreiden en de tabel bouwen:

```rust
        let lineweight = match self.lineweight.as_deref() {
            Some("fixed") => LineweightMode::Fixed(self.lineweight_mm.filter(|v| *v >= 0.0).unwrap_or(0.25)),
            Some("pens") => LineweightMode::Pens,
            _ => LineweightMode::File,
        };
        let pens = PenTable::from_pairs(
            &self
                .pens
                .iter()
                .filter_map(|p| PenTable::parse_color(&p.color).map(|rgb| (rgb, p.lineweight_mm)))
                .collect::<Vec<_>>(),
        );
```

en in de opbouw van `ImportOptions`, na `lineweight_min_mm: …,`:

```rust
            pens,
```

6. De knip rond de omhullende hoeft niets te weten van de kleurentabel: `clip_growth_pt` rekent met `BoundsSink::widest_stroke_pt`, de dikste lijn die de grenzenwandeling **werkelijk** tekent, en die wandeling loopt met dezelfde `WalkSettings` (dus met dezelfde tabel). `PenTable::widest_mm` blijft bestaan voor het venster en de tests.

- [x] **Step 5: Opdrachtregel**

In `open-pdf-cad/examples/import_drawing.rs`, bij de optieverwerking naast `--lineweight`:

```rust
            "--pens" => {
                // --pens "#FF0000=0.35,#0000FF=0.13"
                let raw = next(&mut i);
                let pairs: Vec<((u8, u8, u8), f64)> = raw
                    .split(',')
                    .filter_map(|part| {
                        let (color, width) = part.split_once('=')?;
                        let rgb = open_pdf_cad::import::style::PenTable::parse_color(color.trim())?;
                        Some((rgb, width.trim().parse::<f64>().ok()?))
                    })
                    .collect();
                options.pens = open_pdf_cad::import::style::PenTable::from_pairs(&pairs);
                options.lineweight = LineweightMode::Pens;
            }
```

En in de gebruiksaanwijzing bovenaan, onder `--lineweight <mm>`:

```
//!   --pens <lijst>        kleurentabel, bijvoorbeeld "#FF0000=0.35,#0000FF=0.13"
```

- [x] **Step 6: Tests draaien en committen**

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
```

```
feat(import): kleurentabel bepaalt de lijndikte per kleur uit de tekening (#400)
```

---

### Task 3: Lettertypevervanging en meerdere letterbronnen in de PDF

Nu gaat alle tekst naar Helvetica. Het ontwerp (E5, tabel Weergave) vraagt een vervangingstabel "in de tekening" naar "in de PDF", met de regel: een SHX-letter wordt schreefloos, een TrueType-letter houdt zijn soort als dat kan, anders schreefloos. De crate bedt geen letters in (dat zou elk bestand megabytes groter maken), dus de keuze gaat over de standaardletters die elke PDF-lezer heeft: schreefloos (Helvetica) en vast (Courier), elk rechtop of schuin. **Vet** wordt nagebootst met tekenstand `2 Tr` plus een dunne streek, zodat er geen tweede breedtetabel nodig is en de plaatsing van de letters klopt.

**Files:**
- Modify: `open-pdf-cad/src/import/text.rs`
- Modify: `open-pdf-cad/src/import/walk.rs`
- Modify: `open-pdf-cad/src/import/pdf_out.rs`
- Modify: `open-pdf-cad/src/import/mod.rs`
- Modify: `open-pdf-cad/examples/import_drawing.rs`
- Modify: `open-pdf-cad/src/import/tests.rs`

**Interfaces:**
- Produces in `crate::import::text`:
  - `pub enum FontFamily { Sans, Mono }` — `Clone, Copy, Debug, PartialEq, Eq, Default, Deserialize, Serialize`, snake_case, `Sans` is `#[default]`.
  - `pub struct FontChoice { pub family: FontFamily, pub italic: bool, pub bold: bool }` — `Clone, Copy, Debug, PartialEq, Eq, Default`, met `pub const DEFAULT: FontChoice`, `pub fn base_font(&self) -> &'static str`.
  - `pub fn width_with(bytes: &[u8], font: FontChoice) -> f64` en `pub fn width(bytes: &[u8]) -> f64` (blijft, gelijk aan `width_with(bytes, FontChoice::DEFAULT)`).
  - `pub struct FontMap` — `Clone, Debug, Default, PartialEq`, met `pub fn new(rules: Vec<(String, FontChoice)>, fallback: FontChoice) -> FontMap`, `pub fn is_empty(&self) -> bool`, `pub fn choose(&self, font_file: &str, true_type: &str) -> FontChoice`, `pub fn guess(name: &str) -> FontChoice`.
  - `MTextRun` krijgt het veld `pub font: FontChoice`.
- Gewijzigd: `Sink::text(&mut self, layer: &str, color: Rgb, alpha: f64, matrix: Matrix, bytes: &[u8], font: FontChoice)`.
- Gewijzigd: `PageBuilder::finish(self) -> (Vec<u8>, Vec<usize>, Vec<u16>, Vec<FontChoice>)`.
- Gewijzigd: `OutputPage` krijgt `pub fonts: Vec<FontChoice>`.
- Nieuw: `WalkSettings::fonts: FontMap`, `ImportOptions::fonts: FontMap`, `ImportArgs::fonts: Vec<FontArg>` met `pub struct FontArg { pub from: String, pub family: String, pub bold: bool, pub italic: bool }`.
- Nieuw: `WalkStats::fonts_replaced: u64` en de waarschuwingscode `fontsReplaced:<n>`. **Na de review:** het getal is het aantal tekststijlen met tekst waarvan de letter door een standaardletter vervangen is — dus ook een SHX-letter die schreefloos wordt, niet alleen een keuze die van de standaard afwijkt. De wandelaar houdt de stijlnamen bij in `Walker::replaced_styles` (die van een externe verwijzing als `VERWIJZING|STIJL`) en `convert` verenigt ze over alle pagina's in één `HashSet`; het maximum per pagina (de eerste vorm, nog te zien in de codeblokken hieronder) telde twee bladen met verschillende stijlen te laag. Een stijl zonder letternaam heeft niets om te vervangen en telt niet.
- Nieuw: `pub const MAX_FONT_RULES: usize = 1024;` in `crate::import::text` (werkgrens op de vervangingstabel).
- **Zoals uitgevoerd wijkt de PDF-kant af van de code hieronder**, met behoud van de signaturen:
  - De letterbronnen heten `/F1`, `/F2`, … (`PageBuilder::font_number` geeft index + 1), en het object van de gewone schreefloze letter wordt altijd als eerste aangemaakt. Een tekening zonder lettervervanging levert zo byte voor byte dezelfde PDF als voorheen; de bewaakte fixture hoefde niet bijgewerkt. Latere taken die een bron bij naam noemen, gebruiken dus `/F1` voor de eerste letter van de pagina.
  - Vet: streekkleur, streekdikte (3% van de korpsgrootte, afgerond zoals elke lijndikte) en het uitzetten van een lopend streepjespatroon staan **vóór** `BT`, via de gewone toestandsboekhouding van de `PageBuilder`; binnen het tekstobject staan alleen `2 Tr` en, na `Tj`, `0 Tr`. Zo blijft `state.width`/`state.dash` kloppen en wordt vette tekst nooit gestreept.
  - `width_with` houdt voor schreefloos de bestaande som (`Σ breedtes / 1000`) aan, niet `Σ (breedte / 1000)`: het laatste verschilt in de laatste bits en zou de plaatsing (en de fixture) veranderen.
  - `cadImport.warn_fontsReplaced` staat al in alle 39 talen (deze taak): de i18n-bewaking eist de sleutel zodra de code in de crate staat. Task 10 slaat hem over.
  - Zonder tabel wordt er nog steeds geraden uit de letternaam. Nagemeten op de verificatieverzameling: 257 tekeningen geven byte voor byte dezelfde PDF als vóór deze taak, 20 verschillen, en dat zijn precies de 20 met een letter van vaste breedte (`consola.ttf`), die nu in de vaste letter staan en `fontsReplaced` melden. Na de review melden ook de tekeningen met alleen SHX- of schreefloze letters `fontsReplaced` (elke stijl met tekst telt); hun PDF's veranderen daar niet door.
  - **Na de review:** `FontMap::guess` leest "mono" alleen als woord (los, als eind van een woord, of als begin van "monospace"/"monotxt"); de naam van een lettergieterij die met "mono" begint maakt een letter niet langer vast. Dubbele regels in de tabel: de laatste telt, net als in de kleurentabel (`FontMap` houdt de regels in een `HashMap`). De lijsten `pens` en `fonts` van `ImportArgs` worden tijdens het lezen begrensd op `MAX_PENS` en `MAX_FONT_RULES`; een langere lijst geeft de fout `IMPORT_ARGS_TOO_LONG:<veld>:<grens>` in plaats van een onbegrensde lijst in het geheugen.
  - **Tweede byte-gelijke PDF** voor de app: `open-pdf-studio/js/pdf/fixtures/cad-import-tekst.pdf`, een rechthoek met een TEXT op de standaardstijl. De crate schrijft hem (`the_text_fixture_for_the_app_matches_what_the_crate_writes`, zelfde `OPDS_UPDATE_FIXTURES=1`), en de JS-test `the text the crate writes sits where the drawing puts it` leest de letterbron, de plaats en het korps eruit.

- [x] **Step 1: Falende tests schrijven**

In `open-pdf-cad/src/import/text.rs` onderaan bij de tests:

```rust
    #[test]
    fn a_font_name_is_guessed_and_a_rule_wins() {
        use super::{FontChoice, FontFamily, FontMap};
        assert_eq!(FontMap::guess("arial.ttf"), FontChoice::DEFAULT);
        assert_eq!(FontMap::guess("romans.shx"), FontChoice::DEFAULT, "een SHX-letter wordt schreefloos");
        assert_eq!(
            FontMap::guess("consola.ttf"),
            FontChoice { family: FontFamily::Mono, italic: false, bold: false }
        );
        assert_eq!(
            FontMap::guess("Arial Bold Italic"),
            FontChoice { family: FontFamily::Sans, italic: true, bold: true }
        );
        let map = FontMap::new(
            vec![("romans.shx".into(), FontChoice { family: FontFamily::Mono, italic: false, bold: false })],
            FontChoice::DEFAULT,
        );
        assert_eq!(map.choose("romans.shx", ""), FontChoice { family: FontFamily::Mono, italic: false, bold: false });
        assert_eq!(map.choose("ROMANS.SHX", ""), FontChoice { family: FontFamily::Mono, italic: false, bold: false });
        assert_eq!(map.choose("txt.shx", ""), FontChoice::DEFAULT, "geen regel: raden");
        assert_eq!(map.choose("", "Consolas"), FontChoice { family: FontFamily::Mono, italic: false, bold: false });
    }

    #[test]
    fn the_four_base_fonts_are_named_and_mono_is_fixed_width() {
        use super::{width_with, FontChoice, FontFamily};
        let sans = FontChoice::DEFAULT;
        let mono = FontChoice { family: FontFamily::Mono, italic: false, bold: false };
        assert_eq!(sans.base_font(), "Helvetica");
        assert_eq!(FontChoice { italic: true, ..sans }.base_font(), "Helvetica-Oblique");
        assert_eq!(mono.base_font(), "Courier");
        assert_eq!(FontChoice { italic: true, ..mono }.base_font(), "Courier-Oblique");
        // Vet gebruikt dezelfde letter; het wordt met een streek nagebootst.
        assert_eq!(FontChoice { bold: true, ..sans }.base_font(), "Helvetica");
        assert!((width_with(b"MMMM", mono) - 4.0 * 0.6).abs() < 1e-12);
        assert!(width_with(b"iiii", sans) < width_with(b"MMMM", sans));
    }
```

In `open-pdf-cad/src/import/tests.rs`:

```rust
#[test]
fn a_replaced_font_reaches_the_pdf_and_is_reported() {
    use super::text::{FontChoice, FontFamily, FontMap};
    let mut t = TestDoc::new();
    t.layer("Tekst", 7, |_| {});
    let mut style = acadrust::tables::TextStyle::new("VAST");
    style.font_file = "romans.shx".into();
    style.set_handle(t.doc.allocate_handle());
    t.doc.text_styles.add(style).unwrap();
    let mut text = acadrust::entities::Text::with_value("ABC", Vector3::new(0.0, 0.0, 0.0)).with_height(10.0);
    text.style = "VAST".into();
    text.common.layer = "Tekst".into();
    t.add(None, EntityType::Text(text));
    let drawing = t.drawing();

    let dir = work_dir("fonts");
    let pdf = dir.join("tekst.pdf");
    let options = ImportOptions {
        scale: Some(10.0),
        fonts: FontMap::new(
            vec![("romans.shx".into(), FontChoice { family: FontFamily::Mono, italic: false, bold: false })],
            FontChoice::DEFAULT,
        ),
        ..Default::default()
    };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert!(raw.contains("/BaseFont /Courier"), "de vervangende letter staat in de PDF");
    assert!(result.warnings.iter().any(|w| w.starts_with("fontsReplaced:")), "{:?}", result.warnings);
}
```

Verwachte uitvoer vóór de wijziging: `error[E0433]: failed to resolve: could not find `FontMap` in `text``.

- [x] **Step 2: `text.rs` uitbreiden**

Voeg boven `pub fn width` toe:

```rust
/// Letterfamilie die de import gebruikt. Alleen de standaardletters die elke
/// PDF-lezer heeft; er wordt niets ingebed, zodat de PDF klein blijft.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FontFamily {
    /// Schreefloos (Helvetica).
    #[default]
    Sans,
    /// Vaste breedte (Courier).
    Mono,
}

/// De letter waarmee een tekststijl uit de tekening getekend wordt.
///
/// Schuin gebruikt de schuine variant (die dezelfde breedtes heeft). Vet
/// gebruikt dezelfde letter, nagebootst met tekenstand `2 Tr` en een dunne
/// streek: zo is er geen tweede breedtetabel nodig en blijft de plaatsing van
/// de letters kloppen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct FontChoice {
    pub family: FontFamily,
    pub italic: bool,
    pub bold: bool,
}

impl FontChoice {
    pub const DEFAULT: FontChoice = FontChoice { family: FontFamily::Sans, italic: false, bold: false };

    /// Naam van de standaardletter in de PDF.
    pub fn base_font(&self) -> &'static str {
        match (self.family, self.italic) {
            (FontFamily::Sans, false) => "Helvetica",
            (FontFamily::Sans, true) => "Helvetica-Oblique",
            (FontFamily::Mono, false) => "Courier",
            (FontFamily::Mono, true) => "Courier-Oblique",
        }
    }
}

/// Vervangingstabel: welke letter uit de tekening wordt welke letter in de PDF?
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FontMap {
    rules: Vec<(String, FontChoice)>,
    fallback: Option<FontChoice>,
}

impl FontMap {
    /// `rules` koppelt een letternaam uit de tekening (bestandsnaam of
    /// TrueType-naam, hoofdletterongevoelig) aan een keuze. `fallback` geldt
    /// voor namen zonder regel die ook niet te raden zijn.
    pub fn new(rules: Vec<(String, FontChoice)>, fallback: FontChoice) -> FontMap {
        FontMap {
            rules: rules.into_iter().map(|(name, choice)| (name.trim().to_lowercase(), choice)).collect(),
            fallback: Some(fallback),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty() && self.fallback.is_none()
    }

    /// Raadt een letter uit zijn naam. SHX-letters en onbekende namen worden
    /// schreefloos; "mono", "courier" of "consol" wordt vast; "italic",
    /// "oblique" en "bold" worden herkend.
    pub fn guess(name: &str) -> FontChoice {
        let lower = name.to_lowercase();
        let stem = lower.rsplit(['/', '\\']).next().unwrap_or(&lower);
        let family = if stem.contains("mono") || stem.contains("courier") || stem.contains("consol") {
            FontFamily::Mono
        } else {
            FontFamily::Sans
        };
        let italic = stem.contains("italic") || stem.contains("oblique");
        let bold = stem.contains("bold") || stem.contains("black") || stem.contains("heavy");
        FontChoice { family, italic, bold }
    }

    /// De letter voor een tekststijl. `font_file` is de SHX- of TTF-naam uit
    /// de stijl, `true_type` de TrueType-naam als die er is.
    pub fn choose(&self, font_file: &str, true_type: &str) -> FontChoice {
        for name in [true_type, font_file] {
            let key = name.trim().to_lowercase();
            if key.is_empty() {
                continue;
            }
            if let Some((_, choice)) = self.rules.iter().find(|(rule, _)| *rule == key) {
                return *choice;
            }
        }
        for name in [true_type, font_file] {
            if !name.trim().is_empty() {
                return FontMap::guess(name);
            }
        }
        self.fallback.unwrap_or(FontChoice::DEFAULT)
    }
}
```

Vervang `pub fn width` door een paar:

```rust
/// Breedte van WinAnsi-bytes in eenheden van de korpsgrootte, voor de
/// standaardletter.
pub fn width(bytes: &[u8]) -> f64 {
    width_with(bytes, FontChoice::DEFAULT)
}

/// Als [`width`], voor een gekozen letter. Courier is 600/1000 per teken.
pub fn width_with(bytes: &[u8], font: FontChoice) -> f64 {
    match font.family {
        FontFamily::Mono => bytes.len() as f64 * 0.6,
        FontFamily::Sans => bytes.iter().map(|b| WIDTHS[*b as usize] as f64 / 1000.0).sum(),
    }
}
```

> Let op: de bestaande body van `width` telt al op uit `WIDTHS`; neem die letterlijk over in de `Sans`-tak.

Voeg aan `MTextRun` het veld toe (met `Default` voor de overige bouwplaatsen):

```rust
pub struct MTextRun {
    pub bytes: Vec<u8>,
    /// Hoogte (hoofdletter) in tekeningeenheden.
    pub height: f64,
    pub width_factor: f64,
    /// Kleur uit de opmaakcodes, als die afwijkt.
    pub color: Option<(u8, u8, u8)>,
    /// ACI uit de opmaakcodes (`\C`), als die gezet is.
    pub aci: Option<i16>,
    /// Letter van de tekststijl van deze MTEXT.
    pub font: FontChoice,
}
```

en gebruik in `wrap_mtext` overal `width_with(&…, run.font)` in plaats van `width(&…)` (drie plaatsen: `trim`, de woordbreedte en de regelbreedte).

- [x] **Step 3: De wandeling kiest de letter**

In `open-pdf-cad/src/import/walk.rs`:

1. `use super::text::{self, HAlign, MTextRun, VAlign};` wordt `use super::text::{self, FontChoice, FontMap, HAlign, MTextRun, VAlign};`

2. `WalkSettings` krijgt na `pub text: bool,`:

```rust
    /// Vervangingstabel voor lettertypen.
    pub fonts: FontMap,
```

met in `Default` na `text: true,`:

```rust
            fonts: FontMap::default(),
```

3. `WalkStats` krijgt na `pub replaced_characters: u64,`:

```rust
    /// Tekststijlen waarvoor een andere letter gekozen is dan de standaard.
    pub fonts_replaced: u64,
```

4. `Walker` krijgt een geheugen voor de keuze, na `linetypes: HashMap<String, Option<Rc<Vec<f64>>>>,`:

```rust
    fonts: HashMap<String, FontChoice>,
```

met in `Walker::new` na `linetypes: HashMap::new(),`:

```rust
            fonts: HashMap::new(),
```

5. Nieuwe methode, naast `style_oblique` en `style_width`:

```rust
    /// De letter voor een tekststijl; één keer per stijl bepaald.
    fn style_font(&mut self, style: &str) -> FontChoice {
        let key = style.to_uppercase();
        if let Some(found) = self.fonts.get(&key) {
            return *found;
        }
        let (file, ttf) = match self.doc.text_styles.get(style) {
            Some(s) => (s.font_file.clone(), s.true_type_font.clone()),
            None => (String::new(), String::new()),
        };
        let choice = self.settings.fonts.choose(&file, &ttf);
        if choice != FontChoice::DEFAULT {
            self.stats.fonts_replaced += 1;
        }
        self.fonts.insert(key, choice);
        choice
    }
```

6. De `Sink`-methode krijgt de letter:

```rust
    fn text(&mut self, layer: &str, color: Rgb, alpha: f64, matrix: Matrix, bytes: &[u8], font: FontChoice);
```

7. De gemeenschappelijke teksttekenaar (de functie die `sink.text(...)` aanroept en `text::width(&bytes)` gebruikt) krijgt een extra parameter `font: FontChoice`; vervang binnen die functie `let width_em = text::width(&bytes);` door `let width_em = text::width_with(&bytes, font);` en de laatste regel door:

```rust
        sink.text(layer.name, rgb, alpha, tm, &bytes, font);
```

De aanroepers (`text_entity`, `attribute`) bepalen de letter met `let font = self.style_font(&entity.style);` respectievelijk `let font = self.style_font(&entity.text_style);` en geven hem door.

8. In `fn mtext`: bepaal vóór de lus `let font = self.style_font(&entity.style);`, zet `font` in elke `MTextRun { …, font }`, vervang de twee `text::width(&run.bytes)` door `text::width_with(&run.bytes, font)`, en geef `font` mee aan `sink.text(layer.name, rgb, alpha, tm, &run.bytes, run.font);`.

> `MText` draagt de stijlnaam in `entity.style`; de opmaakcodes `\f…` voor vet en schuin binnen één MTEXT worden niet ontleed — de letter geldt per MTEXT.

- [x] **Step 4: De PDF schrijft meerdere letterbronnen**

In `open-pdf-cad/src/import/pdf_out.rs`:

1. Bovenaan: `use super::text::FontChoice;`

2. `PageBuilder` krijgt na `alphas: Vec<u16>,`:

```rust
    /// Letters die op deze pagina voorkomen, in volgorde.
    fonts: Vec<FontChoice>,
```

met in `PageBuilder::new` na `alphas: Vec::new(),`:

```rust
            fonts: Vec::new(),
```

3. `finish` geeft ze mee:

```rust
    pub fn finish(mut self) -> (Vec<u8>, Vec<usize>, Vec<u16>, Vec<FontChoice>) {
        self.set_layer(None);
        while !self.stack.is_empty() {
            self.pop_clip();
        }
        (self.content, self.used, self.alphas, self.fonts)
    }
```

4. Nieuwe hulpmethode in `impl<'a> PageBuilder<'a>`:

```rust
    fn font_index(&mut self, font: FontChoice) -> usize {
        match self.fonts.iter().position(|f| *f == font) {
            Some(i) => i,
            None => {
                self.fonts.push(font);
                self.fonts.len() - 1
            }
        }
    }
```

5. `Sink::text` in `impl Sink for PageBuilder<'_>`:

```rust
    fn text(&mut self, layer: &str, color: Rgb, alpha: f64, matrix: Matrix, bytes: &[u8], font: FontChoice) {
        let index = self.layer(layer);
        self.set_layer(index);
        self.alpha(alpha);
        self.color(color, false);
        let resource = self.font_index(font);
        self.content.extend_from_slice(b"BT ");
        self.content.extend_from_slice(format!("/F{resource} 1 Tf ").as_bytes());
        if font.bold {
            // Vet nabootsen: vullen en strijken met een streek van 3% van de
            // korpsgrootte. De breedtes blijven die van de rechte letter, dus
            // de plaatsing van de regel verandert niet.
            let size = (matrix.a * matrix.d - matrix.b * matrix.c).abs().sqrt();
            self.color(color, true);
            self.number(0.03 * size);
            self.content.extend_from_slice(b" w 2 Tr ");
        }
        for v in [matrix.a, matrix.b, matrix.c, matrix.d] {
            write_real(&mut self.content, v);
            self.content.push(b' ');
        }
        self.number(matrix.e);
        self.content.push(b' ');
        self.number(matrix.f);
        self.content.extend_from_slice(b" Tm ");
        write_literal(&mut self.content, bytes);
        self.content.extend_from_slice(b" Tj ");
        if font.bold {
            self.content.extend_from_slice(b"0 Tr ");
        }
        self.content.extend_from_slice(b"ET\n");
        self.items += 1;
    }
```

> `self.state.stroke` raakt door de vetstand uit de pas met wat er werkelijk staat; `self.color(color, true)` zet hem bij, en de streekbreedte staat los van `self.state.width` omdat `w` binnen `BT … ET` alleen voor tekst telt. Zet daarom direct na de vetstand `self.state.width = None;` zodat de volgende gestreken lijn zijn dikte opnieuw schrijft.

6. `OutputPage` krijgt na `pub alphas: Vec<u16>,`:

```rust
    /// Letters die de inhoudsstroom gebruikt, in de volgorde van `/F0`, `/F1`, …
    pub fonts: Vec<FontChoice>,
```

7. In `write_pdf_with`: vervang de vaste letter door één object per gebruikte standaardletter:

```rust
    let mut font_objects: Vec<(&'static str, u32)> = Vec::new();
    let mut font_ref = |pdf: &mut PdfFile, name: &'static str| -> u32 {
        if let Some((_, id)) = font_objects.iter().find(|(n, _)| *n == name) {
            return *id;
        }
        let id = pdf.add(Obj::dict(vec![
            ("Type", Obj::name("Font")),
            ("Subtype", Obj::name("Type1")),
            ("BaseFont", Obj::name(name)),
            ("Encoding", Obj::name("WinAnsiEncoding")),
        ]));
        font_objects.push((name, id));
        id
    };
```

en binnen de paginalus, in plaats van de vaste `Font`-bron:

```rust
        let mut fonts = Vec::new();
        for (index, choice) in page.fonts.iter().enumerate() {
            let id = font_ref(&mut pdf, choice.base_font());
            fonts.push((format!("F{index}"), Obj::Ref(id)));
        }
        if fonts.is_empty() {
            // Een pagina zonder tekst houdt toch één bron: sommige lezers
            // verwachten /Font in /Resources bij een tekstoperator die er per
            // ongeluk toch staat.
            fonts.push(("F0".to_string(), Obj::Ref(font_ref(&mut pdf, "Helvetica"))));
        }
        let mut resources = vec![
            ("Font".to_string(), Obj::Dict(fonts)),
            ("ProcSet".to_string(), Obj::Array(vec![Obj::name("PDF"), Obj::name("Text")])),
        ];
```

(De `let font = pdf.add(…);` bovenaan `write_pdf_with` vervalt.)

- [x] **Step 5: De overige afnemers bijwerken**

- `BoundsSink` in `mod.rs`: `fn text(&mut self, layer: &str, _color: style::Rgb, _alpha: f64, matrix: Matrix, bytes: &[u8], font: text::FontChoice)` met `let w = text::width_with(bytes, font);`.
- `Recorder` in `tests.rs`: `fn text(&mut self, _layer: &str, _color: style::Rgb, _alpha: f64, _matrix: Matrix, _bytes: &[u8], _font: super::text::FontChoice) {}`.
- Elke plaats die `builder.finish()` uitpakt, krijgt vier waarden. In `convert`:

```rust
        let objects = builder.items;
        let (content, layers, alphas, fonts) = builder.finish();
```

en in `pages.push(OutputPage { … })` het veld `fonts,` erbij. De test `a_page_with_a_measure_scale_is_written` in `pdf_out.rs` past mee.

- [x] **Step 6: Opties, argumenten en waarschuwing**

In `mod.rs`:

1. `ImportOptions` krijgt na `pub text: bool,`:

```rust
    /// Vervangingstabel voor lettertypen.
    pub fonts: text::FontMap,
```

met `fonts: text::FontMap::default(),` in `Default`, en in `walk_settings` `fonts: options.fonts.clone(),`.

2. Nieuw argumenttype en veld:

```rust
/// Eén regel van de lettertypetabel zoals de webview hem stuurt.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FontArg {
    /// Naam in de tekening (SHX- of TTF-bestandsnaam, of de TrueType-naam).
    pub from: String,
    /// `sans` of `mono`.
    pub family: String,
    pub bold: bool,
    pub italic: bool,
}
```

```rust
    /// Lettertypevervanging.
    pub fonts: Vec<FontArg>,
```

3. In `options()`:

```rust
        let fonts = if self.fonts.is_empty() {
            text::FontMap::default()
        } else {
            let rules = self
                .fonts
                .iter()
                .filter(|f| !f.from.trim().is_empty())
                .map(|f| {
                    let family = if f.family.eq_ignore_ascii_case("mono") {
                        text::FontFamily::Mono
                    } else {
                        text::FontFamily::Sans
                    };
                    (f.from.clone(), text::FontChoice { family, italic: f.italic, bold: f.bold })
                })
                .collect();
            text::FontMap::new(rules, text::FontChoice::DEFAULT)
        };
```

en `fonts,` in de opbouw van `ImportOptions`.

4. `warnings_from` krijgt erbij, na het blok voor `replaced_characters`:

```rust
    if stats.fonts_replaced > 0 {
        out.push(format!("fontsReplaced:{}", stats.fonts_replaced));
    }
```

5. `merge_stats` krijgt `target.fonts_replaced += source.fonts_replaced;`.

- [x] **Step 7: Opdrachtregel**

In `examples/import_drawing.rs`, naast de andere opties:

```rust
            "--font" => {
                // --font "romans.shx=mono" of "arial.ttf=sans,bold"
                let raw = next(&mut i);
                if let Some((from, spec)) = raw.split_once('=') {
                    let parts: Vec<&str> = spec.split(',').map(|s| s.trim()).collect();
                    let family = if parts.iter().any(|p| p.eq_ignore_ascii_case("mono")) {
                        open_pdf_cad::import::text::FontFamily::Mono
                    } else {
                        open_pdf_cad::import::text::FontFamily::Sans
                    };
                    font_rules.push((
                        from.to_string(),
                        open_pdf_cad::import::text::FontChoice {
                            family,
                            italic: parts.iter().any(|p| p.eq_ignore_ascii_case("italic")),
                            bold: parts.iter().any(|p| p.eq_ignore_ascii_case("bold")),
                        },
                    ));
                }
            }
```

met `let mut font_rules: Vec<(String, open_pdf_cad::import::text::FontChoice)> = Vec::new();` vóór de lus en, ná de lus:

```rust
    if !font_rules.is_empty() {
        options.fonts = open_pdf_cad::import::text::FontMap::new(font_rules, open_pdf_cad::import::text::FontChoice::DEFAULT);
    }
```

En in de gebruiksaanwijzing:

```
//!   --font <van=naar>     lettervervanging, bijvoorbeeld "romans.shx=mono" (meermaals)
```

- [x] **Step 8: Tests en commit**

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
```

Controleer daarnaast met `import_drawing` op een tekening met `romans.shx` of `txt` dat de tekst in de PDF op dezelfde plek staat als vóór de wijziging wanneer er geen tabel is opgegeven (de standaardkeuze blijft Helvetica).

```
feat(import): lettertypevervanging met de standaardletters van de PDF (#400)
```

---

### Task 4: Externe verwijzingen laden

Nu telt de wandeling een INSERT naar een externe verwijzing alleen (`xrefsSkipped`). Fase 6 laadt de verwezen tekening en tekent hem mee. Veiligheid staat voorop: een tekening mag door een pad in het bestand nooit een willekeurig bestand van de schijf laten lezen.

**Files:**
- Create: `open-pdf-cad/src/import/xref.rs`
- Modify: `open-pdf-cad/src/import/mod.rs`
- Modify: `open-pdf-cad/src/import/walk.rs`
- Modify: `open-pdf-cad/examples/import_drawing.rs`
- Modify: `open-pdf-cad/src/import/tests.rs`

**Interfaces:**
- Produces in `crate::import::xref`:
  - `pub struct SearchPaths { … }` — `Clone, Debug, Default`, met
    `pub fn new(base: Option<&Path>, extra: &[PathBuf]) -> SearchPaths`,
    `pub fn is_empty(&self) -> bool`,
    `pub fn resolve(&self, raw: &str, allowed_extensions: &[&str]) -> Option<PathBuf>`.
  - `pub const MAX_XREF_DEPTH: u32 = 4;`
  - `pub const MAX_XREF_FILES: usize = 64;`
  - `pub const MAX_XREF_BYTES: u64 = 256 * 1024 * 1024;`
  - `pub struct XrefDocs { … }` — `Default`, met
    `pub fn load(document: &CadDocument, paths: &SearchPaths, budget: &mut u64, cancel: &AtomicBool) -> XrefDocs`,
    `pub fn get(&self, block_name: &str) -> Option<&CadDocument>`,
    `pub fn loaded(&self) -> u64`, `pub fn missing(&self) -> u64`.
- Nieuw: `ImportOptions::xrefs: bool` (standaard `true`), `ImportOptions::search_paths: Vec<PathBuf>`.
- Nieuw: `ImportArgs::xrefs: Option<bool>`, `ImportArgs::search_paths: Vec<String>`.
- Nieuw: `WalkStats::xrefs_loaded: u64`, `WalkStats::xrefs_missing: u64` (de bestaande `xrefs_skipped` blijft: dat is "niet geladen omdat de gebruiker dat niet wilde").
- Nieuw: `Walker::with_xrefs(&mut self, xrefs: &'a XrefDocs)`.
- Nieuwe waarschuwingscodes: `xrefsLoaded:<n>`, `xrefsMissing:<n>`.
- **Zoals uitgevoerd wijkt de taak af van de code hieronder**, met behoud van het bedoelde gedrag en van de testverwachtingen. Latere taken gaan uit van deze vorm:
  - `SearchPaths` kent naast `new`, `is_empty` en `resolve` ook `pub fn for_drawing(drawing: &Path, extra: &[PathBuf]) -> SearchPaths` (de map van het echte bestand; een lege oudermap telt niet als werkmap), `pub fn contains(&self, canonical: &Path) -> bool` en `pub fn locate(&self, raw: &str, from: Option<&Path>, allowed_extensions: &[&str]) -> Located` met `pub enum Located { Found(PathBuf), Missing, Refused }`. `from` is de map van het bestand waar het pad in staat (voor verwijzingen in verwijzingen, en in Task 5 voor afbeeldingen in een verwijzing); hij telt alleen als hij zelf binnen een toegestane map ligt. `resolve` is `locate` zonder dat onderscheid.
  - **Geweigerd zonder de schijf of het netwerk aan te raken:** netwerk- en apparaatpaden (`\\server\…`, `//server/…`, `\\?\`, `\\.\`), elke dubbele punt die niet de stationsletter afsluit (URL-schema, alternatieve datastroom `bestand:stroom`, `C:bestand`), een bestandsnaam die het systeem als apparaat leest, ook met extensie (`NUL.dwg`, `COM1`, `LPT9 .dxf`) of die op een punt of spatie eindigt, stuurtekens en paden langer dan 1024 tekens. Van een absoluut pad, van een pad met `..` en van een pad met zo'n vreemde naam als **map** telt alleen de bestandsnaam (in de verificatieverzameling staan afbeeldingen in mappen die op een spatie eindigen; die weigeren zou een valse melding geven). Wat gevonden wordt moet ná `canonicalize` binnen een toegestane map liggen; een koppeling (symlink, junction) naar buiten geeft `Refused`.
  - Het laden is **genest en begrensd**: `pub struct XrefDoc { pub document: CadDocument, pub is_dxf: bool, pub dir: PathBuf, pub children: XrefDocs }`, `XrefDocs::get(&self, block_name) -> Option<&XrefDoc>`, en `XrefDocs::load(document, source: Option<&Path>, paths, budget, cancel)` — `source` is het bestand van de hoofdtekening, zodat een verwijzing daarnaar als kring herkend wordt. Verwijzingen in verwijzingen gaan tot `MAX_XREF_DEPTH` diep; een kring (A → B → A, of terug naar de hoofdtekening) wordt op de terugweg geweigerd; elk bestand wordt één keer gelezen (ook als twee tekeningen het aanhalen), uit het geheugen en nooit verder dan de gemeten grootte (`read_limited`); de grens `MAX_XREF_FILES` telt gelezen bestanden, ook onleesbare. Grote tekst-DXF's gaan door de stukjeslezer, die de afbreekvlag kent. Nieuw daarbij: `XrefDocs::refused()`, `WalkStats::xrefs_refused` en de waarschuwingscode `xrefsRefused:<n>` (onveilig pad, buiten de mappen, kring, te diep, boven de begroting in bytes of aantal). `xrefsMissing` is: niet gevonden, verkeerde soort of onleesbaar.
  - `space_bounds(drawing: &Drawing, space, options, xrefs: Option<&XrefDocs>, cancel, budget: &VisitBudget)`: de verkenning geeft `None` en telt verwijzingen dan alleen (`xrefs_skipped`). Is laden aan maar een verwijzing niet geladen, dan telt de INSERT **niet** ook nog als overgeslagen: het laden heeft hem al gemeld.
  - De wandelaar van een verwijzing (`Walker::draw_xref`) **deelt** het bezoekbudget (`share_budget`), de afbreekvlag (nu een `Rc`) en de afnemer — dus ook de inhoudsgrens — met de hoofdwandeling; er is geen tweede begroting van "wat er nog over is". Hij wordt per verwijzing één keer gemaakt en hergebruikt (`xref_walkers`), zodat blokken, lijntypen en letters één keer worden opgezocht en `fonts_replaced` niet per invoeging oploopt. Tellingen komen via `WalkStats::absorb` bij de hoofdwandeling. De diepte wordt ook bij het tekenen bewaakt (`xref_depth`), een MINSERT van een verwijzing tekent elke cel, en viewports in een verwijzing doen niet mee.
  - **Plaatsing zoals CAD het doet:** het eigen basispunt (`$INSBASE`) van de verwijzing komt op het invoegpunt, en de verwijzing wordt omgerekend naar de eenheid van de hoofdtekening (`$INSUNITS` van beide; onbekend = factor 1). Laag 0 van de verwijzing volgt de laag van de INSERT, net als bij een blok; staat die laag uit, dan blijft inhoud op eigen lagen staan.
  - **Laagnamen:** kent de hoofdtekening de laag als `VERWIJZING|laag` (zo staan ze in het importvenster, in de lijst van uitgezette lagen en in de bevroren lagen van een viewport), dan gebruikt de wandelaar van de verwijzing die naam; anders houdt de laag zijn eigen naam. De test met `(Gevel)` blijft daarom kloppen.
  - `cadImport.warn_xrefsLoaded`, `warn_xrefsMissing` en `warn_xrefsRefused` staan al in alle 39 talen (deze taak). Task 10 slaat ze over.
- **Na de beveiligingsreview van Task 4 en 5** (latere taken gaan uit van deze vorm):
  - `Located` kent een vierde uitkomst, `OddName`: een bestandsnaam die het systeem anders leest dan hij er staat (apparaatnaam, ook met extensie, of eindigend op een punt of spatie). Hij wordt net als `Refused` geweigerd zonder iets aan te raken, maar met een eigen telling (`XrefDocs::odd_names()`, `WalkStats::odd_names`, voor verwijzingen en afbeeldingen samen) en een eigen waarschuwingscode `oddNames:<n>`, zodat de melding niet "onveilig pad" zegt. Alle zulke namen blijven geweigerd (het veiligste), niet alleen de apparaatnamen. Beoordeeld wordt de naam die het systeem eruit haalt (`Path::file_name`), niet het laatste stukje tekst: `NUL/`, `NUL\` en `NUL/.` vallen er dus onder.
  - **Eén keer openen:** `pub fn open_regular(path) -> Option<OpenFile>` met `OpenFile::size()` en `OpenFile::read()` vervangt `fits` en `read_limited`. Grootte en soort komen van de geopende handle, de begroting wordt daarop getoetst en het lezen gaat via dezelfde handle (nooit verder dan gemeten, met `try_reserve_exact`). Het ogenblik tussen `canonicalize` en openen staat in de moduledoc als grens, naast de harde koppeling.
  - **Bij naam:** `pub struct ExternalFile { name, kind: ExternalKind, status: ExternalStatus }` (camelCase, `Serialize`), `ExternalKind::{Xref, Image}`, `ExternalStatus::{Found, Loaded, Missing, Refused, OddName, TooLarge, Unsupported}`, `pub struct ExternalList` (`note`, `note_path`, `extend`, `files`, `truncated`, `into_parts`), `pub fn display_name(raw) -> String`, `MAX_LISTED_EXTERNALS = 50`, `MAX_LISTED_NAME = 80`. `XrefDocs::listed()` en `ImageStore::listed()` leveren zo'n lijst: alleen bestandsnamen (nooit een pad), ontdubbeld en begrensd, met een vlag als er meer waren. `ImportResult` krijgt `externals: Vec<ExternalFile>` en `externals_truncated: bool`; `DrawingScan` krijgt dezelfde twee velden, gevuld door alleen te zoeken in de map van de tekening (`Found`/`Missing`/`Refused`/`OddName`, hooguit 256 zoekacties, niets wordt gelezen). `DrawingScan::xrefs` bevat voortaan ook alleen namen.
  - `space_filtered` en de andere plekken die laag 0 bijzonder behandelen gebruiken `walk::is_layer_zero(name)` (de naam zonder witruimte eromheen).

- [x] **Step 1: Falende tests schrijven**

In `open-pdf-cad/src/import/xref.rs` (onderaan, samen met de module in Step 2) én in `tests.rs`. Begin met de padtests; zet ze in `xref.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn work_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("opds-xref-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_files_inside_a_chosen_folder_are_found() {
        let root = work_dir("paden");
        let sub = root.join("verwijzingen");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(root.join("blad.dwg"), b"x").unwrap();
        std::fs::write(sub.join("gevel.dxf"), b"x").unwrap();
        std::fs::write(root.join("geheim.txt"), b"x").unwrap();
        let buiten = work_dir("buiten");
        std::fs::write(buiten.join("elders.dwg"), b"x").unwrap();

        let paths = SearchPaths::new(Some(&root), &[sub.clone()]);
        assert!(paths.resolve("blad.dwg", &["dwg", "dxf"]).is_some());
        assert!(paths.resolve("gevel.dxf", &["dwg", "dxf"]).is_some(), "ook in een gekozen zoekpad");
        // Alleen de bestandsnaam telt van een absoluut pad van een andere machine.
        assert!(paths.resolve("Z:/projecten/2026/blad.dwg", &["dwg", "dxf"]).is_some());
        assert!(paths.resolve("geheim.txt", &["dwg", "dxf"]).is_none(), "verkeerde soort");
        assert!(paths.resolve("../buiten/elders.dwg", &["dwg", "dxf"]).is_none(), "padtraversal");
        assert!(paths.resolve(&buiten.join("elders.dwg").to_string_lossy(), &["dwg", "dxf"]).is_none());
        assert!(paths.resolve("//server/deel/blad.dwg", &["dwg", "dxf"]).is_none(), "netwerkpad");
        assert!(paths.resolve("\\\\server\\deel\\blad.dwg", &["dwg", "dxf"]).is_none());
        assert!(paths.resolve("\\\\?\\C:\\blad.dwg", &["dwg", "dxf"]).is_none());
        assert!(paths.resolve("https://elders/blad.dwg", &["dwg", "dxf"]).is_none());
        assert!(paths.resolve("", &["dwg", "dxf"]).is_none());
        assert!(SearchPaths::default().resolve("blad.dwg", &["dwg", "dxf"]).is_none(), "zonder map niets");
    }

    #[test]
    fn a_file_over_the_budget_is_not_read() {
        let root = work_dir("begroting");
        std::fs::write(root.join("groot.dxf"), vec![b'0'; 4096]).unwrap();
        let paths = SearchPaths::new(Some(&root), &[]);
        let found = paths.resolve("groot.dxf", &["dwg", "dxf"]).unwrap();
        let mut budget = 1000u64;
        assert!(!fits(&found, &mut budget), "past niet in de begroting");
        let mut budget = 8192u64;
        assert!(fits(&found, &mut budget));
        assert_eq!(budget, 8192 - 4096);
    }
}
```

In `tests.rs`:

```rust
#[test]
fn an_external_reference_is_drawn_when_it_is_next_to_the_drawing() {
    use super::xref::SearchPaths;
    let dir = work_dir("xref");
    // De verwezen tekening: één lijn op laag "Gevel".
    let mut child = TestDoc::new();
    child.layer("Gevel", 2, |_| {});
    child.line(None, "Gevel", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
    let child_path = dir.join("gevel.dxf");
    write_dxf(&child.doc, &child_path);

    // De hoofdtekening: een blokrecord dat naar dat bestand wijst plus een INSERT.
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.line(None, "Kader", Color::ByLayer, (0.0, 0.0), (10.0, 0.0));
    let mut record = acadrust::tables::BlockRecord::new("GEVEL");
    record.xref_path = "gevel.dxf".into();
    record.flags.is_xref = true;
    record.set_handle(t.doc.allocate_handle());
    t.doc.block_records.add(record).unwrap();
    t.insert(None, "GEVEL", "Kader", Color::ByLayer, (0.0, 0.0));
    let mut drawing = t.drawing();
    drawing.path = dir.join("hoofd.dxf");

    let pdf = dir.join("hoofd.pdf");
    let options = ImportOptions { scale: Some(50.0), search_paths: vec![dir.clone()], ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.xrefs_loaded, 1);
    assert_eq!(result.stats.xrefs_missing, 0);
    assert!(result.warnings.iter().any(|w| w == "xrefsLoaded:1"));
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert!(raw.contains("(Gevel)"), "de laag van de verwijzing staat in de PDF");

    // Uit: alleen geteld, niet geladen.
    let pdf2 = dir.join("zonder.pdf");
    let options = ImportOptions { xrefs: false, ..options.clone() };
    let result = convert(&drawing, &options, &pdf2, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.xrefs_skipped, 1);
    assert_eq!(result.stats.xrefs_loaded, 0);
}

#[test]
fn a_missing_external_reference_is_reported_and_the_import_goes_on() {
    let dir = work_dir("xref-weg");
    let mut t = TestDoc::new();
    t.layer("Kader", 1, |_| {});
    t.line(None, "Kader", Color::ByLayer, (0.0, 0.0), (1000.0, 0.0));
    let mut record = acadrust::tables::BlockRecord::new("WEG");
    record.xref_path = "bestaat-niet.dwg".into();
    record.flags.is_xref = true;
    record.set_handle(t.doc.allocate_handle());
    t.doc.block_records.add(record).unwrap();
    t.insert(None, "WEG", "Kader", Color::ByLayer, (0.0, 0.0));
    let mut drawing = t.drawing();
    drawing.path = dir.join("hoofd.dxf");

    let pdf = dir.join("hoofd.pdf");
    let options = ImportOptions { scale: Some(50.0), search_paths: vec![dir.clone()], ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.xrefs_missing, 1);
    assert!(result.warnings.iter().any(|w| w == "xrefsMissing:1"));
    assert!(pdf.exists(), "de import gaat gewoon door");
}
```

Voeg bovenaan `tests.rs` de hulpfunctie toe die een testtekening wegschrijft:

```rust
/// Schrijft een testtekening als DXF, zodat de import hem echt kan lezen.
fn write_dxf(document: &CadDocument, path: &Path) {
    let mut out = Vec::new();
    acadrust::DxfWriter::new(document).write(&mut out).unwrap();
    std::fs::write(path, out).unwrap();
}
```

> Klopt de naam van de schrijfmethode niet, kijk dan hoe `crate::writer::write_drawing` het doet en neem die aanroep over.

Verwachte uitvoer vóór de wijziging: `error[E0433]: failed to resolve: could not find `xref` in `import``.

- [x] **Step 2: `xref.rs` schrijven**

```rust
//! Externe verwijzingen: paden veilig oplossen en tekeningen laden (#400).
//!
//! Een pad uit een tekeningbestand is invoer, geen opdracht. Er wordt alleen
//! gelezen binnen de map van de tekening zelf en binnen zoekpaden die de
//! gebruiker uitdrukkelijk heeft gekozen. Padtraversal (`..`), netwerkpaden
//! (`\\server\...`), apparaatnamen (`\\?\`, `\\.\`) en alles met een
//! URL-schema worden geweigerd. Er geldt bovendien een begroting in bytes, een
//! grens op het aantal bestanden en een grens op de diepte.

use acadrust::CadDocument;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Diepste keten van verwijzingen die nog geladen wordt.
pub const MAX_XREF_DEPTH: u32 = 4;
/// Hoogste aantal bestanden dat één import erbij laadt.
pub const MAX_XREF_FILES: usize = 64;
/// Hoogste aantal bytes dat één import erbij leest.
pub const MAX_XREF_BYTES: u64 = 256 * 1024 * 1024;

/// Mappen waarin gezocht mag worden.
#[derive(Clone, Debug, Default)]
pub struct SearchPaths {
    roots: Vec<PathBuf>,
}

/// Trekt een bestand van de begroting af; false als het er niet meer in past.
pub fn fits(path: &Path, budget: &mut u64) -> bool {
    let size = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => return false,
    };
    if size > *budget {
        return false;
    }
    *budget -= size;
    true
}

fn is_unsafe(raw: &str) -> bool {
    let trimmed = raw.trim();
    trimmed.is_empty()
        || trimmed.contains("://")
        || trimmed.starts_with("\\\\")
        || trimmed.starts_with("//")
        || trimmed.contains('\0')
}

impl SearchPaths {
    /// `base` is de map van de tekening zelf; `extra` zijn zoekpaden die de
    /// gebruiker heeft gekozen. Mappen die niet bestaan vallen weg.
    pub fn new(base: Option<&Path>, extra: &[PathBuf]) -> SearchPaths {
        let mut roots = Vec::new();
        let mut add = |p: &Path| {
            if let Ok(canonical) = p.canonicalize() {
                if canonical.is_dir() && !roots.contains(&canonical) {
                    roots.push(canonical);
                }
            }
        };
        if let Some(base) = base {
            add(base);
        }
        for path in extra {
            add(path);
        }
        SearchPaths { roots }
    }

    pub fn is_empty(&self) -> bool {
        self.roots.is_empty()
    }

    /// Zoekt het bestand waar het pad uit de tekening naar verwijst.
    ///
    /// Geprobeerd wordt, per toegestane map: het pad zoals het er staat (alleen
    /// als het relatief is en geen `..` bevat), en anders alleen de
    /// bestandsnaam. Het gevonden bestand moet ná `canonicalize` nog steeds in
    /// die map liggen en een toegestane extensie hebben.
    pub fn resolve(&self, raw: &str, allowed_extensions: &[&str]) -> Option<PathBuf> {
        if is_unsafe(raw) {
            return None;
        }
        let as_path = PathBuf::from(raw.trim().replace('\\', "/"));
        let file_name = as_path.file_name()?.to_owned();
        let relative_ok = as_path.is_relative()
            && as_path.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
        for root in &self.roots {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if relative_ok {
                candidates.push(root.join(&as_path));
            }
            candidates.push(root.join(&file_name));
            for candidate in candidates {
                let Ok(canonical) = candidate.canonicalize() else { continue };
                if !canonical.starts_with(root) || !canonical.is_file() {
                    continue;
                }
                let extension = canonical.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if !allowed_extensions.iter().any(|e| *e == extension) {
                    continue;
                }
                return Some(canonical);
            }
        }
        None
    }
}

/// De geladen tekeningen, op de naam van het blokrecord (in hoofdletters).
#[derive(Default)]
pub struct XrefDocs {
    documents: HashMap<String, CadDocument>,
    loaded: u64,
    missing: u64,
}

impl XrefDocs {
    pub fn get(&self, block_name: &str) -> Option<&CadDocument> {
        self.documents.get(&block_name.to_uppercase())
    }

    pub fn loaded(&self) -> u64 {
        self.loaded
    }

    pub fn missing(&self) -> u64 {
        self.missing
    }

    /// Laadt de externe verwijzingen van een tekening. Leest niets buiten
    /// `paths`, niet meer dan [`MAX_XREF_FILES`] bestanden en niet meer bytes
    /// dan er in `budget` over zijn. Af te breken via `cancel`.
    pub fn load(document: &CadDocument, paths: &SearchPaths, budget: &mut u64, cancel: &AtomicBool) -> XrefDocs {
        let mut out = XrefDocs::default();
        if paths.is_empty() {
            // Zonder toegestane map is elke verwijzing "niet gevonden".
            out.missing = document.block_records.iter().filter(|r| is_xref(r)).count() as u64;
            return out;
        }
        for record in document.block_records.iter() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if !is_xref(record) {
                continue;
            }
            if out.documents.len() >= MAX_XREF_FILES {
                out.missing += 1;
                continue;
            }
            let raw = if record.xref_path.is_empty() { record.name.clone() } else { record.xref_path.clone() };
            let Some(found) = paths.resolve(&raw, &["dwg", "dxf"]) else {
                out.missing += 1;
                continue;
            };
            if !fits(&found, budget) {
                out.missing += 1;
                continue;
            }
            match read_document(&found) {
                Some(child) => {
                    out.documents.insert(record.name.to_uppercase(), child);
                    out.loaded += 1;
                }
                None => out.missing += 1,
            }
        }
        out
    }
}

fn is_xref(record: &acadrust::tables::BlockRecord) -> bool {
    record.flags.is_xref || record.flags.is_xref_overlay || !record.xref_path.is_empty()
}

/// Leest één verwezen tekening. Een bestand dat niet leesbaar is levert
/// `None`; de import gaat dan door zonder die verwijzing.
fn read_document(path: &Path) -> Option<CadDocument> {
    let data = std::fs::read(path).ok()?;
    let is_dwg = data.get(..4).map(|v| v == b"AC10").unwrap_or(false);
    if is_dwg {
        acadrust::DwgReader::from_file(path).ok()?.read().ok()
    } else {
        acadrust::DxfReader::from_reader(std::io::Cursor::new(data)).ok()?.read().ok()
    }
}
```

Meld de module aan in `mod.rs` (alfabetisch, na `pub mod walk;`):

```rust
pub mod xref;
```

- [x] **Step 3: De wandeling tekent een verwijzing**

In `open-pdf-cad/src/import/walk.rs`:

1. `WalkStats` krijgt na `pub xrefs_skipped: u64,`:

```rust
    /// Externe verwijzingen die geladen en getekend zijn.
    pub xrefs_loaded: u64,
    /// Externe verwijzingen die niet gevonden werden.
    pub xrefs_missing: u64,
```

2. `Walker` krijgt na `sort_tables: …,`:

```rust
    xrefs: Option<&'a super::xref::XrefDocs>,
```

met `xrefs: None,` in `Walker::new`, en een instelmethode naast `on_cancel`:

```rust
    /// Geeft de wandelaar de geladen externe verwijzingen mee.
    pub fn with_xrefs(&mut self, xrefs: &'a super::xref::XrefDocs) {
        self.xrefs = Some(xrefs);
    }
```

3. In `fn insert`: haal het blok op zoals nu, maar verplaats de behandeling van `block.is_xref` naar ná het opbouwen van `child`. Concreet: vervang

```rust
        if block.is_xref {
            self.stats.xrefs_skipped += 1;
            return;
        }
```

door niets, en voeg direct vóór de lus over `rows`/`columns` (dus ná `child.byblock_linetype = …;` en het opbouwen van `base`) toe:

```rust
        if block.is_xref {
            let ocs_scale = ocs.then(&scale);
            let at = Xform3::translate(insert.insertion_point.x, insert.insertion_point.y, insert.insertion_point.z);
            let placed = Xform3::rotate_z(insert.rotation).then(&at);
            let xf = ocs_scale.then(&placed).then(&ctx.xf);
            match self.xrefs.and_then(|x| x.get(&insert.block_name)) {
                Some(document) => self.draw_xref(document, xf, ctx.depth + 1, sink),
                None => self.stats.xrefs_skipped += 1,
            }
            return;
        }
```

> Gebruik de matrix precies zoals de bestaande code hem voor een gewoon blok bouwt (kijk hoe `child.xf` in de rij/kolom-lus tot stand komt) en laat alleen de verschuiving van het blokbasispunt weg: een externe verwijzing heeft geen eigen basispunt in de hoofdtekening.

4. Nieuwe methode, naast `draw_block`:

```rust
    /// Tekent een geladen externe verwijzing met een eigen wandelaar op dat
    /// document. De werkgrens is gedeeld: wat de verwijzing opmaakt, gaat van
    /// de begroting van de hoofdtekening af.
    fn draw_xref(&mut self, document: &CadDocument, xf: Xform3, depth: u32, sink: &mut dyn Sink) {
        if depth > super::xref::MAX_XREF_DEPTH {
            self.stats.deep_nesting += 1;
            return;
        }
        let left = self.settings.max_visits.saturating_sub(self.stats.entities);
        if left == 0 {
            self.too_complex = true;
            self.cancelled = true;
            return;
        }
        let settings = WalkSettings { max_visits: left, viewports: false, ..self.settings.clone() };
        let cancel = self.cancel.take();
        {
            let mut inner = Walker::new(document, settings, self.source_is_dxf);
            if let Some(flag) = cancel.as_ref() {
                inner.on_cancel(move || flag());
            }
            inner.model_space(xf, sink);
            // De tellingen van de verwijzing tellen mee in die van het geheel.
            let stats = inner.stats.clone();
            self.stats.entities += stats.entities;
            self.stats.drawn += stats.drawn;
            self.stats.texts += stats.texts;
            self.stats.hatches += stats.hatches;
            self.stats.hatch_patterns_skipped += stats.hatch_patterns_skipped;
            self.stats.blocks_expanded += stats.blocks_expanded;
            self.stats.missing_blocks += stats.missing_blocks;
            self.stats.images_skipped += stats.images_skipped;
            self.stats.unsupported += stats.unsupported;
            self.stats.replaced_characters += stats.replaced_characters;
            self.stats.fonts_replaced += stats.fonts_replaced;
            self.stats.deep_nesting += stats.deep_nesting;
            self.stats.xrefs_loaded += 1;
            for (name, count) in &stats.skipped_types {
                *self.stats.skipped_types.entry(name.clone()).or_default() += count;
            }
            self.too_complex |= inner.too_complex;
            self.cancelled |= inner.cancelled;
        }
        self.cancel = cancel;
    }
```

> `inner.on_cancel(move || flag())` leent `flag` uit de lokale `cancel`; daarom staat het geheel in een eigen blok en komt `self.cancel` daarna terug.

- [x] **Step 4: Opties, laden en waarschuwingen**

In `open-pdf-cad/src/import/mod.rs`:

1. `ImportOptions` krijgt na `pub points: bool,`:

```rust
    /// Externe verwijzingen laden als ze gevonden worden.
    pub xrefs: bool,
    /// Zoekpaden voor externe verwijzingen en afbeeldingen, naast de map van
    /// de tekening zelf. Alleen mappen die de gebruiker heeft gekozen.
    pub search_paths: Vec<PathBuf>,
```

met in `Default`:

```rust
            xrefs: true,
            search_paths: Vec::new(),
```

2. `ImportArgs` krijgt:

```rust
    pub xrefs: Option<bool>,
    /// Zoekpaden die de gebruiker heeft gekozen.
    pub search_paths: Vec<String>,
```

en in `options()`:

```rust
            xrefs: self.xrefs.unwrap_or(default.xrefs),
            search_paths: self.search_paths.iter().filter(|p| !p.trim().is_empty()).map(PathBuf::from).collect(),
```

3. In `convert`, direct ná het bepalen van `unit` en `mm_per_unit`:

```rust
    // Externe verwijzingen één keer laden voor het hele bestand; de map van de
    // tekening telt altijd mee, andere mappen alleen als de gebruiker ze koos.
    let mut xref_budget = xref::MAX_XREF_BYTES;
    let xrefs = if options.xrefs {
        let paths = xref::SearchPaths::new(drawing.path.parent(), &options.search_paths);
        xref::XrefDocs::load(document, &paths, &mut xref_budget, cancel)
    } else {
        xref::XrefDocs::default()
    };
    if cancelled() {
        return Err(ImportError::Cancelled);
    }
```

> `cancelled` wordt al vlak daarvoor gedefinieerd; zet het `let cancelled = …` zo nodig hoger in de functie.

4. Waar de wandelaars gemaakt worden (in `convert` en in `space_bounds`) direct ná `Walker::new(...)`:

```rust
    walker.with_xrefs(&xrefs);
```

`space_bounds` krijgt daarvoor een extra parameter. Vervang de signatuur door:

```rust
pub fn space_bounds(
    drawing: &Drawing,
    space: &str,
    options: &ImportOptions,
    xrefs: &xref::XrefDocs,
    cancel: &AtomicBool,
) -> Result<(BoundsSink, WalkStats), ImportError> {
    let document = &drawing.document;
    // Oneindige lijnen tellen niet mee voor de grenzen.
    let settings = WalkSettings { infinite_lines: false, ..walk_settings(options) };
    let mut walker = Walker::new(document, settings, drawing.is_dxf);
    walker.with_xrefs(xrefs);
    walker.on_cancel(move || cancel.load(Ordering::Relaxed));
    // ... de rest van de body blijft ongewijzigd.
```

De hele tekening gaat er nu in in plaats van alleen het document en `is_dxf`: Task 5 heeft het pad van de tekening nodig om afbeeldingen te vinden. Werk de twee aanroepers bij: in `convert` `space_bounds(drawing, space, options, &xrefs, cancel)?` en in `scan.rs` `space_bounds(drawing, "model", &options, &super::xref::XrefDocs::default(), cancel)?` — de verkenning laadt geen verwijzingen (dat zou elk venster traag maken); zij meldt alleen hun namen in `DrawingScan::xrefs`.

5. Ná de paginalus, vóór `warnings_from`:

```rust
    stats.xrefs_loaded = xrefs.loaded();
    stats.xrefs_missing = xrefs.missing();
```

> Zet dit ná de lus, zodat `merge_stats` het niet dubbel telt; haal daarom `xrefs_loaded` uit `draw_xref` weg als de tests dubbeltelling laten zien, of laat `merge_stats` die twee velden juist niet optellen. Kies één plaats en leg die in een comment vast.

6. `warnings_from` krijgt, vóór het blok voor `xrefs_skipped`:

```rust
    if stats.xrefs_loaded > 0 {
        out.push(format!("xrefsLoaded:{}", stats.xrefs_loaded));
    }
    if stats.xrefs_missing > 0 {
        out.push(format!("xrefsMissing:{}", stats.xrefs_missing));
    }
```

- [x] **Step 5: Opdrachtregel**

In `examples/import_drawing.rs`:

```rust
            "--no-xrefs" => options.xrefs = false,
            "--search-path" => options.search_paths.push(std::path::PathBuf::from(next(&mut i))),
```

En in de gebruiksaanwijzing:

```
//!   --no-xrefs            externe verwijzingen niet laden
//!   --search-path <map>   extra map om verwijzingen en afbeeldingen te zoeken (meermaals)
```

- [x] **Step 6: Tests, meting en commit**

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
```

Draai daarna `import_drawing` op de veertien tekeningen uit de verificatieverzameling die een externe verwijzing dragen (te vinden met `inspect_cad --json`, veld `xref_blocks`) en noteer per bestand `xrefsLoaded` en `xrefsMissing`. Uitvoer naar een eigen tijdelijke map.

```
feat(import): externe verwijzingen laden uit de map van de tekening of een gekozen zoekpad (#400)
```

---

### Task 5: Afbeeldingen insluiten

Een IMAGE (en een UNDERLAY-kader) wordt nu geteld en overgeslagen. Fase 6 bedt de afbeelding in als beeld-XObject, geknipt op de kaderlijn. Alleen JPEG (die gaat ongewijzigd mee als `DCTDecode`) en PNG (8 bits, grijs, palet of ware kleur, niet vervlochten) — dat dekt wat in bouwtekeningen voorkomt en houdt de crate zonder nieuwe afhankelijkheden.

**Files:**
- Create: `open-pdf-cad/src/import/image.rs`
- Modify: `open-pdf-cad/src/import/mod.rs`, `walk.rs`, `pdf_out.rs`, `examples/import_drawing.rs`, `src/import/tests.rs`

**Interfaces:**
- Produces in `crate::import::image`:
  - `pub enum Pixels { Jpeg(Vec<u8>), Gray8(Vec<u8>), Rgb8(Vec<u8>) }`
  - `pub struct Raster { pub width: u32, pub height: u32, pub pixels: Pixels }` — `Clone, Debug`
  - `pub const MAX_IMAGE_PIXELS: u64 = 40_000_000;` (na de beveiligingsreview `200_000_000`, zie onderaan deze lijst)
  - `pub fn load(path: &Path, max_pixels: u64) -> Option<Raster>`
  - `pub fn decode_png(data: &[u8], max_pixels: u64) -> Option<Raster>`
  - `pub fn jpeg_size(data: &[u8]) -> Option<(u32, u32)>`
- Gewijzigd: `Sink` krijgt `fn image(&mut self, _layer: &str, _alpha: f64, _matrix: Matrix, _key: &str, _raster: &image::Raster) {}` (standaard leeg).
- Nieuw: `PageBuilder` houdt zijn eigen beeldenlijst; `finish` geeft er een vijfde waarde bij: `(Vec<u8>, Vec<usize>, Vec<u16>, Vec<FontChoice>, Vec<(String, Raster)>)`; `OutputPage` krijgt `pub images: Vec<(String, image::Raster)>`.
- Nieuw: `ImportOptions::images: bool` (standaard `true`), `ImportOptions::max_image_pixels: u64`.
- Nieuw: `ImportArgs::images: Option<bool>`, `ImportArgs::max_image_pixels: Option<u64>`.
- Nieuw: `WalkStats::images_embedded: u64`, `WalkStats::images_missing: u64`; waarschuwingen `imagesEmbedded:<n>`, `imagesMissing:<n>`.
- **Zoals uitgevoerd wijkt de taak af van de code hieronder**, met behoud van het bedoelde gedrag en van de testverwachtingen. Latere taken gaan uit van deze vorm:
  - `Pixels::Jpeg { data: Vec<u8>, components: u8 }` in plaats van `Jpeg(Vec<u8>)`: een grijze JPEG moet `/DeviceGray` krijgen (`Raster::color_space()`), anders toont de PDF-lezer onzin. Een JPEG gaat alleen door na controle van de koptekst (`jpeg_info`): gewoon, uitgebreid of progressief (SOF0/1/2), 8 bits, 1 of 3 kanalen, maten niet nul, elke segmentlengte binnen het bestand, en er moet een scan volgen. Vier kanalen (CMYK), 12 bits, verliesvrij en rekenkundig gecodeerd vallen af en tellen als `imagesMissing`.
  - PNG: 1, 2, 4, 8 en 16 bits per monster, palet met `tRNS`, doorzichtigheid op wit; vervlochten blijft geweigerd. **Tegen een decompressiebom:** de maten uit IHDR (dat vooraan moet staan, precies 13 bytes) gaan eerst tegen `max_pixels` en tegen `MAX_IMAGE_SIDE` (65 535 per zijde), het uitpakken gaat **regel voor regel** uit de IDAT-stukken zonder ze te kopiëren (`read_exact` op precies één regel: een afgekapte of kapotte stroom stopt daar, een stroom die meer uitpakt dan de maat vraagt wordt niet verder gelezen), en het eindbeeld wordt met `try_reserve_exact` gevraagd. Naast het eindbeeld staan er dus maar twee regels in het geheugen. Ontfilteren werkt zonder indexering; een onbekend filter weigert het beeld. Af te breken via `decode_png_with(data, max_pixels, cancelled)` / `load_with`.
  - **Eén voorraad per import:** `pub struct ImageStore` (`Clone`, gedeeld door alle wandelingen: grenzen en tekenen, elke ruimte, elke externe verwijzing) met `ImageStore::new(paths: SearchPaths, max_pixels: u64)` en `get(&self, raw, from: Option<&Path>, cancelled) -> Lookup`, `pub enum Lookup { Found { key, raster: Rc<Raster> }, Missing, Refused }`. Elk bestand wordt één keer gelezen; de begroting geldt voor de hele import: `MAX_IMAGE_FILES` (256 verschillende bestanden), `MAX_IMAGE_TOTAL_BYTES` (512 MB aan beeldgegevens), per bestand `MAX_IMAGE_BYTES` (64 MB) en `max_pixels` (nooit meer dan `MAX_IMAGE_PIXELS`). Beelden tellen **niet** mee in `max_content_bytes`: over de begroting wordt het beeld geweigerd en gaat de import door, in plaats van de hele import te laten stranden op `IMPORT_TOO_COMPLEX`. De soort wordt herkend aan de eerste bytes, niet aan de extensie. `WalkSettings` kent daarom alleen `images: bool`; de grens op beeldpunten zit in de voorraad (`ImportOptions::max_image_pixels`).
  - Padveiligheid is die van Task 4 (`SearchPaths::locate`), met als extra onderscheid `WalkStats::images_refused` en de waarschuwingscode `imagesRefused:<n>` (onveilig pad, buiten de mappen, of boven de begroting van de import). Een afbeelding in een externe verwijzing wordt eerst naast die verwijzing gezocht (`Walker::dir`), mits die map binnen een toegestane map ligt. Het pad komt uit de IMAGE of, als dat leeg is (zo leest de DXF-lezer het), uit de beelddefinitie. De sleutel (`key`) is het gecanonicaliseerde pad; hij komt zelf nooit in de PDF.
  - `Sink::image(&mut self, layer, alpha, matrix, key, raster: &Rc<Raster>)`; `PageBuilder::finish` geeft als vijfde waarde `Vec<(String, Rc<Raster>)>` en `OutputPage::images` heeft hetzelfde type: een beeld van tientallen megabytes wordt zo nergens gekopieerd. `write_pdf_with` maakt **één beeldobject per bronbestand voor het hele document** (pagina's en viewports die hetzelfde beeld tonen delen het), pakt in vanuit geleende bytes (`PdfFile::add_packed_stream`) en vraagt de afbreekvlag vóór elk beeld. `/XObject` en de uitgebreide `/ProcSet` komen alleen in de bronnen van een pagina mét beelden; een tekening zonder beelden levert byte voor byte dezelfde PDF als voorheen.
  - `space_bounds(drawing, space, options, externals: Externals<'_>, cancel, budget)` met `pub struct Externals<'e> { pub xrefs: Option<&'e XrefDocs>, pub images: Option<&'e ImageStore> }` (`Copy`, `Default` = niets laden, zo doet de verkenning het). Zonder voorraad telt een IMAGE als `images_skipped` en als niet-ondersteund type, precies zoals vóór deze taak.
  - **Kaderlijn:** de hoekpunten staan in beeldpunten met de oorsprong in het midden van het beeldpunt linksboven en **y naar beneden** — dezelfde afspraak als de WIPEOUT in `walk.rs` — dus `y = (h − p.y − 0,5) / h`, niet `(p.y + 0,5) / h`. Het standaardkader (het hele beeld) wordt niet geknipt; een kader dat het binnenste wegknipt (`ClipMode::Inside`) wordt het hele beeld min de veelhoek, even-oneven. Een IMAGE die in de tekening uit staat (`SHOW_IMAGE` uit) wordt niet getekend; een beeld zonder oppervlak of met niet-eindige vectoren telt als `imagesMissing`.
  - `cadImport.warn_imagesEmbedded`, `warn_imagesMissing` en `warn_imagesRefused` staan al in alle 39 talen (deze taak). Task 10 slaat ze over.
- **Na de beveiligingsreview van Task 4 en 5** (dit vervangt wat hierboven over de begroting en over `Lookup` staat; latere taken gaan uit van deze vorm):
  - **Vier grenzen, elk getoetst vóór het werk waar hij over gaat:** lezen (`MAX_IMAGE_READ_BYTES`, 512 MB aan bestandsbytes, ook van bestanden die niets opleveren; per bestand `MAX_IMAGE_BYTES`, hooguit `MAX_IMAGE_FILES`), uitpakken (`MAX_IMAGE_WORK_BYTES`, 512 MB aan uitgepakte bytes zoals de kopteksten ze beloven; de belofte wordt vóór het uitpakken tegen het restant gehouden en afgeschreven zodra het uitpakken begint, ook als de stroom kapot blijkt), vasthouden en insluiten (`MAX_IMAGE_TOTAL_BYTES`, nu **128 MB aan ingepakte bytes**, de enige bovengrens op de beelduitvoer) en beeldpunten (`MAX_IMAGE_PIXELS` is nu een vangnet van 200 miljoen en via `max_image_pixels` alleen te verlagen; de echte rem is het uitpakwerk). De keuze voor begroten op ingepakte bytes staat gemotiveerd in de moduledoc van `image.rs`. `pub struct Limits` + `ImageStore::with_limits` laten tests met kleine, echte bestanden werken.
  - **Alleen ingepakt vasthouden:** `Pixels` kent `Flate { data, gray }`. Een PNG wordt regel voor regel uitgepakt (`png_rows`) en in dezelfde gang ingepakt (`pdf_writer::Packer`, byte-gelijk aan in één keer inpakken, met een bovengrens en `try_reserve`); het uitgepakte beeld bestaat nooit als geheel. `PdfFile::add_flate_stream` zet de al ingepakte bytes ongewijzigd neer; `add_packed_stream(_with)` geeft `io::Result` en valt niet meer terug op een onverpakte kopie; een gedeeld beeld wordt met `try_reserve` gekopieerd. `decode`, `decode_png` en `decode_png_with` leveren nog het onverpakte beeld (tests); `load`/`load_with` zijn vervallen, de voorraad leest zelf via `open_regular`.
  - `Lookup` kent nu `Found`, `Missing` (niet gevonden), `Refused` (onveilig pad, buiten de mappen, boven het aantal bestanden), `OddName`, `TooLarge` (beeldpunten, zijde, bestandsgrootte of een van de begrotingen) en `Unsupported` (niet te lezen, geen ondersteunde soort, beschadigd). Nieuw: `WalkStats::images_too_large`, `images_unsupported`, waarschuwingscodes `imagesTooLarge:<n>` en `imagesUnsupported:<n>`.
  - Een JPEG wordt afgekapt op de eerste EOI na de scans (`jpeg_end`); een segment na de scan dat niet deugt weigert het beeld. De moduledoc zegt dat PNG-controlesommen niet worden nagerekend. `/ProcSet` krijgt de beeldsoorten ook als de sleutel ontbrak (`image_procset`).
  - `cadImport.warn_imagesTooLarge`, `warn_imagesUnsupported` en `warn_oddNames` staan al in alle 39 talen. Task 10 slaat ze over.
  - **Nagemeten op de verificatieverzameling na deze ronde** (365 tekeningen, standaardinstellingen, de uitvoer van vóór de ronde ernaast): 282 geven een PDF en 83 niet (70 met een lege ruimte, 8 te oud, 4 onleesbaar, 1 boven de tijdgrens van een kwartier van de meting), voor en na dezelfde bestanden met dezelfde uitkomst. Alle 282 PDF's zijn byte voor byte gelijk aan die van vóór de ronde: de 262 zonder ingesloten beeld, en ook de 20 met een ingesloten JPEG (geen van die bestanden heeft bytes achter het einde van het beeld, en er zit geen PNG in de verzameling die wordt ingesloten). Ingesloten: 20 afbeeldingen in 20 tekeningen; te groot: 0; niet ondersteund: 0; niet gevonden: 111 afbeeldingen in 19 tekeningen en 93 verwijzingen in 7; geweigerd: 4 afbeeldingen in 1 tekening (netwerkpaden); vreemde namen: 0; overgeslagen onderleggers: 20. 43 verslagen noemen bestanden van buiten bij naam, nergens met een pad. Eén lijst liep vol (58 niet gevonden verwijzingen) en verdrong daarbij de geweigerde netwerkpaden; sindsdien gaat in een volle lijst wat gelezen of geweigerd is vóór wat alleen niet gevonden is (`ExternalStatus::rank`).
  - **Nagemeten op de verificatieverzameling** (365 tekeningen, standaardinstellingen, 282 geven een PDF, vóór en na dezelfde fouten): 20 tekeningen sluiten een afbeelding in (elk één JPEG; plek, maat en stand nagekeken met PyMuPDF), 19 melden samen 111 afbeeldingen die niet gevonden zijn (de bestanden zitten niet in de verzameling), 1 meldt 4 geweigerde netwerkpaden, en de 20 met een PDF-onderlegger melden die als overgeslagen. 7 tekeningen melden samen 93 externe verwijzingen die niet gevonden zijn; geen enkele verwijzing uit de verzameling is aanwezig, dus het laden zelf is nagekeken met een opgebouwde hoofdtekening die een echte tekening uit de verzameling twee keer invoegt (een keer gedraaid). Alleen de 20 PDF's met een ingesloten afbeelding verschillen van vóór Task 4 en 5; de andere 262 zijn byte voor byte gelijk, waaronder alle 239 zonder verwijzingen of afbeeldingen.

- [x] **Step 1: Falende tests schrijven**

In `open-pdf-cad/src/import/image.rs` (samen met de module):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Een PNG van 2 x 2 in ware kleur, zonder filters.
    fn tiny_png() -> Vec<u8> {
        fn chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
            let mut out = (body.len() as u32).to_be_bytes().to_vec();
            out.extend_from_slice(kind);
            out.extend_from_slice(body);
            let mut crc = crc32(kind);
            crc = crc32_more(crc, body);
            out.extend_from_slice(&crc.to_be_bytes());
            out
        }
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&2u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        // Twee regels van 2 pixels, filter 0 ervoor.
        let raw = [0u8, 255, 0, 0, 0, 255, 0, 0u8, 0, 0, 255, 255, 255, 255];
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        use std::io::Write;
        encoder.write_all(&raw).unwrap();
        let idat = encoder.finish().unwrap();
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        out.extend(chunk(b"IHDR", &ihdr));
        out.extend(chunk(b"IDAT", &idat));
        out.extend(chunk(b"IEND", &[]));
        out
    }

    #[test]
    fn a_png_is_decoded_to_rgb() {
        let raster = decode_png(&tiny_png(), MAX_IMAGE_PIXELS).expect("png");
        assert_eq!((raster.width, raster.height), (2, 2));
        match raster.pixels {
            Pixels::Rgb8(data) => {
                assert_eq!(data.len(), 2 * 2 * 3);
                assert_eq!(&data[0..3], &[255, 0, 0]);
                assert_eq!(&data[9..12], &[255, 255, 255]);
            }
            other => panic!("verwachtte ware kleur: {other:?}"),
        }
    }

    #[test]
    fn nonsense_and_oversized_images_are_refused_without_panic() {
        assert!(decode_png(b"", MAX_IMAGE_PIXELS).is_none());
        assert!(decode_png(b"\x89PNG\r\n\x1a\n", MAX_IMAGE_PIXELS).is_none());
        assert!(decode_png(&tiny_png()[..20], MAX_IMAGE_PIXELS).is_none());
        assert!(decode_png(&tiny_png(), 1).is_none(), "boven de grens");
        // Willekeurige bytes mogen nooit laten vastlopen.
        let mut noise = tiny_png();
        for (i, b) in noise.iter_mut().enumerate() {
            *b = (*b).wrapping_add(i as u8);
        }
        let _ = decode_png(&noise, MAX_IMAGE_PIXELS);
    }

    #[test]
    fn a_jpeg_keeps_its_own_bytes() {
        // Minimale JPEG-kop: SOI, SOF0 met 4 x 8 pixels, EOI.
        let data = vec![
            0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x04, 0x03, 0x01, 0x11, 0x00, 0x02,
            0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9,
        ];
        assert_eq!(jpeg_size(&data), Some((4, 8)));
        assert!(jpeg_size(b"geen jpeg").is_none());
    }
}
```

> Voeg voor de testhulp `crc32`/`crc32_more` een kleine CRC-32 toe in de testmodule, of laat de CRC weg en accepteer in `decode_png` een verkeerde CRC (dat doet de lezer al: de CRC wordt niet gecontroleerd). Kies het tweede: verwijder dan `crc32` uit de test en schrijf vier nulbytes.

In `tests.rs`:

```rust
#[test]
fn an_image_next_to_the_drawing_is_embedded_and_clipped() {
    let dir = work_dir("beeld");
    let png = dir.join("kaart.png");
    std::fs::write(&png, super::image::tests_sample_png()).unwrap();

    let mut t = TestDoc::new();
    t.layer("Beeld", 1, |_| {});
    let mut raster = acadrust::entities::RasterImage::new("kaart.png", Vector3::new(0.0, 0.0, 0.0), 2.0, 2.0);
    raster.common.layer = "Beeld".into();
    raster.u_vector = Vector3::new(500.0, 0.0, 0.0);
    raster.v_vector = Vector3::new(0.0, 500.0, 0.0);
    raster.file_path = "kaart.png".into();
    t.add(None, EntityType::RasterImage(raster));
    let mut drawing = t.drawing();
    drawing.path = dir.join("hoofd.dxf");

    let pdf = dir.join("hoofd.pdf");
    let options = ImportOptions { scale: Some(10.0), search_paths: vec![dir.clone()], ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.images_embedded, 1);
    let raw = String::from_utf8_lossy(&std::fs::read(&pdf).unwrap()).to_string();
    assert!(raw.contains("/Subtype /Image"));
    assert!(raw.contains("/ColorSpace /DeviceRGB"));
    assert!(raw.contains("/XObject"));

    // Uit: alleen geteld.
    let pdf2 = dir.join("zonder.pdf");
    let options = ImportOptions { images: false, ..options.clone() };
    let result = convert(&drawing, &options, &pdf2, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.images_skipped, 1);
    assert_eq!(result.stats.images_embedded, 0);
}
```

Maak daarvoor in `image.rs` een kleine publieke testhulp:

```rust
/// Een PNG van 2 x 2 in ware kleur; alleen voor tests van andere modules.
#[doc(hidden)]
pub fn tests_sample_png() -> Vec<u8> { /* dezelfde bytes als in de testmodule */ }
```

Verwachte uitvoer vóór de wijziging: `error[E0433]: could not find `image` in `import``.

- [x] **Step 2: `image.rs` schrijven**

```rust
//! Rasterbestanden lezen voor de import (#400).
//!
//! JPEG gaat ongewijzigd de PDF in (`DCTDecode`); PNG wordt hier uitgepakt,
//! ontfilterd en opnieuw ingepakt als `FlateDecode`. Ondersteund: 8 bits per
//! monster, grijs (kleurtype 0), ware kleur (2), palet (3), grijs met
//! doorzichtigheid (4) en ware kleur met doorzichtigheid (6); doorzichtigheid
//! wordt op wit gezet. Vervlochten PNG (Adam7) en 16 bits worden geweigerd.
//!
//! Alles komt uit een bestand, dus niets hier mag op rare bytes vastlopen:
//! geen indexering zonder controle, geen `unwrap`.

use std::path::Path;

/// Hoogste aantal beeldpunten dat één afbeelding mag hebben.
pub const MAX_IMAGE_PIXELS: u64 = 40_000_000;
/// Hoogste bestandsgrootte van één afbeelding.
pub const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub enum Pixels {
    /// De oorspronkelijke JPEG-bytes.
    Jpeg(Vec<u8>),
    /// Eén byte per beeldpunt.
    Gray8(Vec<u8>),
    /// Drie bytes per beeldpunt.
    Rgb8(Vec<u8>),
}

#[derive(Clone, Debug)]
pub struct Raster {
    pub width: u32,
    pub height: u32,
    pub pixels: Pixels,
}

/// Leest een afbeelding van schijf. Het pad moet al door
/// [`crate::import::xref::SearchPaths::resolve`] zijn gegaan.
pub fn load(path: &Path, max_pixels: u64) -> Option<Raster> {
    let size = std::fs::metadata(path).ok()?.len();
    if size == 0 || size > MAX_IMAGE_BYTES {
        return None;
    }
    let data = std::fs::read(path).ok()?;
    if data.starts_with(&[0xFF, 0xD8]) {
        let (width, height) = jpeg_size(&data)?;
        if u64::from(width) * u64::from(height) > max_pixels {
            return None;
        }
        return Some(Raster { width, height, pixels: Pixels::Jpeg(data) });
    }
    decode_png(&data, max_pixels)
}

/// Breedte en hoogte uit de SOF-markering van een JPEG.
pub fn jpeg_size(data: &[u8]) -> Option<(u32, u32)> {
    if !data.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut i = 2usize;
    while i + 3 < data.len() {
        if data.get(i) != Some(&0xFF) {
            i += 1;
            continue;
        }
        let marker = *data.get(i + 1)?;
        // Opvulbytes en markeringen zonder inhoud.
        if marker == 0xFF || (0xD0..=0xD9).contains(&marker) || marker == 0x01 {
            i += 2;
            continue;
        }
        let length = u16::from_be_bytes([*data.get(i + 2)?, *data.get(i + 3)?]) as usize;
        if length < 2 {
            return None;
        }
        // SOF0..SOF15, behalve de tabelmarkeringen 0xC4, 0xC8 en 0xCC.
        if (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC {
            let h = u16::from_be_bytes([*data.get(i + 5)?, *data.get(i + 6)?]) as u32;
            let w = u16::from_be_bytes([*data.get(i + 7)?, *data.get(i + 8)?]) as u32;
            if w == 0 || h == 0 {
                return None;
            }
            return Some((w, h));
        }
        i += 2 + length;
    }
    None
}

fn be32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes([
        *data.get(at)?,
        *data.get(at + 1)?,
        *data.get(at + 2)?,
        *data.get(at + 3)?,
    ]))
}

/// Pakt een PNG uit naar grijs of ware kleur.
pub fn decode_png(data: &[u8], max_pixels: u64) -> Option<Raster> {
    if !data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    let mut i = 8usize;
    let (mut width, mut height) = (0u32, 0u32);
    let (mut depth, mut color_type, mut interlace) = (0u8, 0u8, 0u8);
    let mut palette: Vec<u8> = Vec::new();
    let mut idat: Vec<u8> = Vec::new();
    let mut seen_header = false;
    while i + 8 <= data.len() {
        let length = be32(data, i)? as usize;
        let kind = data.get(i + 4..i + 8)?;
        let body_at = i + 8;
        let body = data.get(body_at..body_at.checked_add(length)?)?;
        match kind {
            b"IHDR" => {
                if length < 13 {
                    return None;
                }
                width = be32(body, 0)?;
                height = be32(body, 4)?;
                depth = *body.get(8)?;
                color_type = *body.get(9)?;
                interlace = *body.get(12)?;
                seen_header = true;
            }
            b"PLTE" => palette = body.to_vec(),
            b"IDAT" => {
                if idat.len().saturating_add(length) > 512 * 1024 * 1024 {
                    return None;
                }
                idat.extend_from_slice(body);
            }
            b"IEND" => break,
            _ => {}
        }
        i = body_at.checked_add(length)?.checked_add(4)?; // + CRC
    }
    if !seen_header || width == 0 || height == 0 || depth != 8 || interlace != 0 || idat.is_empty() {
        return None;
    }
    if u64::from(width) * u64::from(height) > max_pixels {
        return None;
    }
    let channels: usize = match color_type {
        0 => 1,
        2 => 3,
        3 => 1,
        4 => 2,
        6 => 4,
        _ => return None,
    };
    if color_type == 3 && palette.len() < 3 {
        return None;
    }

    // Uitpakken met een grens: het onverpakte beeld is bekend van maat.
    let stride = (width as usize).checked_mul(channels)?;
    let expected = stride.checked_add(1)?.checked_mul(height as usize)?;
    let mut raw = Vec::new();
    {
        use std::io::Read;
        let mut decoder = flate2::read::ZlibDecoder::new(&idat[..]).take(expected as u64);
        if decoder.read_to_end(&mut raw).is_err() || raw.len() != expected {
            return None;
        }
    }

    // Ontfilteren, regel voor regel.
    let mut out = vec![0u8; stride.checked_mul(height as usize)?];
    let bpp = channels; // 8 bits per monster
    for y in 0..height as usize {
        let filter = *raw.get(y * (stride + 1))?;
        let line_at = y * (stride + 1) + 1;
        for x in 0..stride {
            let value = *raw.get(line_at + x)? as i32;
            let a = if x >= bpp { out[y * stride + x - bpp] as i32 } else { 0 };
            let b = if y > 0 { out[(y - 1) * stride + x] as i32 } else { 0 };
            let c = if x >= bpp && y > 0 { out[(y - 1) * stride + x - bpp] as i32 } else { 0 };
            let restored = match filter {
                0 => value,
                1 => value + a,
                2 => value + b,
                3 => value + (a + b) / 2,
                4 => {
                    let p = a + b - c;
                    let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
                    value + if pa <= pb && pa <= pc { a } else if pb <= pc { b } else { c }
                }
                _ => return None,
            };
            out[y * stride + x] = (restored & 0xFF) as u8;
        }
    }

    // Naar grijs of ware kleur; doorzichtigheid wordt op wit gezet.
    let count = (width as usize).checked_mul(height as usize)?;
    let pixels = match color_type {
        0 => Pixels::Gray8(out),
        2 => Pixels::Rgb8(out),
        3 => {
            let mut rgb = vec![0u8; count * 3];
            for (n, index) in out.iter().enumerate().take(count) {
                let at = (*index as usize) * 3;
                let (r, g, b) = (
                    *palette.get(at).unwrap_or(&0),
                    *palette.get(at + 1).unwrap_or(&0),
                    *palette.get(at + 2).unwrap_or(&0),
                );
                rgb[n * 3] = r;
                rgb[n * 3 + 1] = g;
                rgb[n * 3 + 2] = b;
            }
            Pixels::Rgb8(rgb)
        }
        4 => {
            let mut gray = vec![255u8; count];
            for n in 0..count {
                let v = *out.get(n * 2).unwrap_or(&0) as u32;
                let a = *out.get(n * 2 + 1).unwrap_or(&255) as u32;
                gray[n] = ((v * a + 255 * (255 - a)) / 255) as u8;
            }
            Pixels::Gray8(gray)
        }
        _ => {
            let mut rgb = vec![255u8; count * 3];
            for n in 0..count {
                let a = *out.get(n * 4 + 3).unwrap_or(&255) as u32;
                for c in 0..3 {
                    let v = *out.get(n * 4 + c).unwrap_or(&0) as u32;
                    rgb[n * 3 + c] = ((v * a + 255 * (255 - a)) / 255) as u8;
                }
            }
            Pixels::Rgb8(rgb)
        }
    };
    Some(Raster { width, height, pixels })
}
```

Meld de module aan in `mod.rs` (`pub mod image;`, alfabetisch na `pub mod hatch;`).

- [x] **Step 3: De `Sink` kent beelden**

In `walk.rs`, in `pub trait Sink`, naast `text`:

```rust
    /// Een ingesloten afbeelding. `matrix` beeldt het eenheidsvierkant
    /// (0,0)-(1,1) af op het vlak waar het beeld komt. `key` is uniek per
    /// bronbestand, zodat dezelfde afbeelding maar één keer in de PDF komt.
    fn image(&mut self, _layer: &str, _alpha: f64, _matrix: Matrix, _key: &str, _raster: &super::image::Raster) {}
```

`WalkStats` krijgt na `pub images_skipped: u64,`:

```rust
    /// Afbeeldingen die zijn ingesloten.
    pub images_embedded: u64,
    /// Afbeeldingen waarvan het bestand niet gevonden of niet leesbaar was.
    pub images_missing: u64,
```

`WalkSettings` krijgt na `pub points: bool,`:

```rust
    /// Afbeeldingen insluiten als het bestand gevonden wordt.
    pub images: bool,
    /// Hoogste aantal beeldpunten per afbeelding.
    pub max_image_pixels: u64,
```

met in `Default`: `images: true,` en `max_image_pixels: super::image::MAX_IMAGE_PIXELS,`.

`Walker` krijgt de zoekpaden en een geheugen:

```rust
    search: super::xref::SearchPaths,
    rasters: HashMap<String, Option<Rc<super::image::Raster>>>,
```

met in `new`: `search: super::xref::SearchPaths::default(),` en `rasters: HashMap::new(),`, en een instelmethode:

```rust
    /// Mappen waarin afbeeldingen gezocht mogen worden.
    pub fn with_search_paths(&mut self, search: super::xref::SearchPaths) {
        self.search = search;
    }
```

Vervang de tak voor beelden in `fn entity`:

```rust
            EntityType::RasterImage(raster) => self.raster_image(raster, &layer, ctx, sink),
            EntityType::Underlay(_) => {
                self.stats.images_skipped += 1;
                self.skip(entity);
            }
```

en voeg de methode toe (naast `fn viewport`):

```rust
    // ── Afbeeldingen ─────────────────────────────────────────────────────
    fn raster_image(
        &mut self,
        entity: &acadrust::entities::RasterImage,
        layer: &LayerInfo<'a>,
        ctx: &Ctx<'a>,
        sink: &mut dyn Sink,
    ) {
        if !self.settings.images {
            self.stats.images_skipped += 1;
            return;
        }
        let raw = if entity.file_path.is_empty() {
            match entity.definition_handle.and_then(|h| self.doc.objects.get(&h)) {
                Some(acadrust::objects::ObjectType::ImageDefinition(def)) => def.file_name.clone(),
                _ => String::new(),
            }
        } else {
            entity.file_path.clone()
        };
        if raw.trim().is_empty() {
            self.stats.images_missing += 1;
            return;
        }
        let raster = match self.rasters.get(&raw) {
            Some(found) => found.clone(),
            None => {
                let loaded = self
                    .search
                    .resolve(&raw, &["png", "jpg", "jpeg"])
                    .and_then(|path| super::image::load(&path, self.settings.max_image_pixels))
                    .map(Rc::new);
                self.rasters.insert(raw.clone(), loaded.clone());
                loaded
            }
        };
        let Some(raster) = raster else {
            self.stats.images_missing += 1;
            return;
        };
        // Het eenheidsvierkant op het vlak van de afbeelding: het invoegpunt
        // is de linkeronderhoek, u en v zijn de maat van één beeldpunt.
        let (w, h) = (entity.size.x.max(1.0), entity.size.y.max(1.0));
        let origin = ctx.xf.point([entity.insertion_point.x, entity.insertion_point.y, entity.insertion_point.z]);
        let ex = ctx.xf.vector([entity.u_vector.x * w, entity.u_vector.y * w, entity.u_vector.z * w]);
        let ey = ctx.xf.vector([entity.v_vector.x * h, entity.v_vector.y * h, entity.v_vector.z * h]);
        let matrix = Matrix::new(ex.x, ex.y, ey.x, ey.y, origin.x, origin.y);
        let corners = [
            matrix.apply(Point::new(0.0, 0.0)),
            matrix.apply(Point::new(1.0, 0.0)),
            matrix.apply(Point::new(1.0, 1.0)),
            matrix.apply(Point::new(0.0, 1.0)),
        ];
        let bounds = [
            corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
            corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
        ];
        if !bounds.iter().all(|v| v.is_finite()) || !sink.wants(bounds) {
            return;
        }
        let alpha = (1.0 - entity.fade as f64 / 100.0).clamp(0.0, 1.0)
            * self.alpha_of(entity.common.transparency, layer, ctx);

        // Kaderlijn: rechthoekig (twee hoekpunten) of veelhoekig, in
        // beeldpunten met de oorsprong linksonder.
        let clip = self.image_clip(entity, &matrix);
        if let Some(path) = &clip {
            sink.push_clip(path, false);
        }
        sink.image(layer.name, alpha, matrix, &raw, &raster);
        if clip.is_some() {
            sink.pop_clip();
        }
        self.stats.images_embedded += 1;
        self.stats.drawn += 1;
    }

    /// De kaderlijn van een afbeelding als pad in paginaruimte, of `None`.
    fn image_clip(&self, entity: &acadrust::entities::RasterImage, matrix: &Matrix) -> Option<PagePath> {
        if !entity.clipping_enabled {
            return None;
        }
        let (w, h) = (entity.size.x.max(1.0), entity.size.y.max(1.0));
        let vertices = &entity.clip_boundary.vertices;
        // In het bestand staan de hoekpunten in beeldpunten, met de oorsprong
        // linksonder en een halve beeldpunt verschoven.
        let to_unit = |p: &acadrust::types::Vector2| Point::new((p.x + 0.5) / w, (p.y + 0.5) / h);
        let points: Vec<Point> = if vertices.len() == 2 {
            let (a, b) = (to_unit(&vertices[0]), to_unit(&vertices[1]));
            vec![Point::new(a.x, a.y), Point::new(b.x, a.y), Point::new(b.x, b.y), Point::new(a.x, b.y)]
        } else if vertices.len() >= 3 && vertices.len() <= super::viewport::MAX_CLIP_POINTS {
            vertices.iter().map(to_unit).collect()
        } else {
            return None;
        };
        if !points.iter().all(|p| p.x.is_finite() && p.y.is_finite()) {
            return None;
        }
        let mut path = PagePath::new();
        for (i, p) in points.iter().enumerate() {
            let mapped = matrix.apply(*p);
            if i == 0 {
                path.move_to(mapped);
            } else {
                path.line_to(mapped);
            }
        }
        path.close();
        Some(path)
    }
```

`BoundsSink` in `mod.rs` krijgt:

```rust
    fn image(&mut self, layer: &str, _alpha: f64, matrix: Matrix, _key: &str, _raster: &image::Raster) {
        let corners = [
            matrix.apply(Point::new(0.0, 0.0)),
            matrix.apply(Point::new(1.0, 0.0)),
            matrix.apply(Point::new(1.0, 1.0)),
            matrix.apply(Point::new(0.0, 1.0)),
        ];
        let b = [
            corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
            corners.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
            corners.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
        ];
        self.add(layer, b);
    }
```

- [x] **Step 4: De PDF schrijft beeld-XObjects**

In `pdf_out.rs`:

1. `PageBuilder` krijgt `images: Vec<(String, super::image::Raster)>,` (met `images: Vec::new(),` in `new`), en `finish` geeft ze mee:

```rust
    pub fn finish(mut self) -> (Vec<u8>, Vec<usize>, Vec<u16>, Vec<FontChoice>, Vec<(String, super::image::Raster)>) {
        self.set_layer(None);
        while !self.stack.is_empty() {
            self.pop_clip();
        }
        (self.content, self.used, self.alphas, self.fonts, self.images)
    }
```

2. In `impl Sink for PageBuilder<'_>`:

```rust
    fn image(&mut self, layer: &str, alpha: f64, matrix: Matrix, key: &str, raster: &super::image::Raster) {
        let index = self.layer(layer);
        self.set_layer(index);
        self.alpha(alpha);
        let slot = match self.images.iter().position(|(k, _)| k == key) {
            Some(i) => i,
            None => {
                self.images.push((key.to_string(), raster.clone()));
                self.images.len() - 1
            }
        };
        self.content.extend_from_slice(b"q ");
        for v in [matrix.a, matrix.b, matrix.c, matrix.d] {
            write_real(&mut self.content, v);
            self.content.push(b' ');
        }
        self.number(matrix.e);
        self.content.push(b' ');
        self.number(matrix.f);
        self.content.extend_from_slice(format!(" cm /Im{slot} Do Q\n").as_bytes());
        self.items += 1;
    }
```

3. `OutputPage` krijgt `pub images: Vec<(String, super::image::Raster)>,`.

4. In `write_pdf_with`, binnen de paginalus vóór het opbouwen van `resources`:

```rust
        let mut xobjects: Vec<(String, Obj)> = Vec::new();
        for (slot, (_, raster)) in page.images.iter().enumerate() {
            let (color_space, components) = match raster.pixels {
                super::image::Pixels::Gray8(_) => ("DeviceGray", 1),
                _ => ("DeviceRGB", 3),
            };
            let _ = components;
            let mut dict = vec![
                ("Type".to_string(), Obj::name("XObject")),
                ("Subtype".to_string(), Obj::name("Image")),
                ("Width".to_string(), Obj::Int(raster.width as i64)),
                ("Height".to_string(), Obj::Int(raster.height as i64)),
                ("ColorSpace".to_string(), Obj::name(color_space)),
                ("BitsPerComponent".to_string(), Obj::Int(8)),
            ];
            let id = match &raster.pixels {
                super::image::Pixels::Jpeg(bytes) => {
                    dict.push(("Filter".to_string(), Obj::name("DCTDecode")));
                    pdf.add_stream(dict, bytes.clone(), false)
                }
                super::image::Pixels::Gray8(bytes) | super::image::Pixels::Rgb8(bytes) => {
                    pdf.add_stream(dict, bytes.clone(), true)
                }
            };
            xobjects.push((format!("Im{slot}"), Obj::Ref(id)));
        }
```

en, ná `resources`:

```rust
        if !xobjects.is_empty() {
            resources.push(("XObject".to_string(), Obj::Dict(xobjects)));
            // Beeldoperatoren horen in /ProcSet.
            resources[1].1 = Obj::Array(vec![Obj::name("PDF"), Obj::name("Text"), Obj::name("ImageC"), Obj::name("ImageB")]);
        }
```

> Controleer dat `resources[1]` echt `ProcSet` is; anders zoek het item op naam op.

> `add_stream` zet zelf `/Filter /FlateDecode` als `compress` waar is; bij JPEG staat het filter al in de woordenboekregels, dus `compress` is dan `false`.

- [x] **Step 5: Opties, doorgeven en waarschuwingen**

In `mod.rs`:

- `ImportOptions` krijgt `pub images: bool,` (`true`) en `pub max_image_pixels: u64,` (`image::MAX_IMAGE_PIXELS`).
- `ImportArgs` krijgt `pub images: Option<bool>,` en `pub max_image_pixels: Option<u64>,`, verwerkt in `options()`.
- `walk_settings` krijgt `images: options.images,` en `max_image_pixels: options.max_image_pixels,`.
- In `convert` en `space_bounds` na `Walker::new(...)`:

```rust
    walker.with_search_paths(xref::SearchPaths::new(drawing.path.parent(), &options.search_paths));
```

`space_bounds` heeft sinds Task 4 de hele `&Drawing` als eerste parameter (en `xrefs: Option<&XrefDocs>`), dus het pad is er al; gebruik `xref::SearchPaths::for_drawing(&drawing.path, &options.search_paths)` en voeg in de body alleen de regel met de zoekpaden toe, direct na het meegeven van de verwijzingen:

```rust
    walker.with_search_paths(xref::SearchPaths::new(drawing.path.parent(), &options.search_paths));
```

- `merge_stats` krijgt `target.images_embedded += source.images_embedded;` en `target.images_missing += source.images_missing;`.
- `warnings_from` krijgt:

```rust
    if stats.images_embedded > 0 {
        out.push(format!("imagesEmbedded:{}", stats.images_embedded));
    }
    if stats.images_missing > 0 {
        out.push(format!("imagesMissing:{}", stats.images_missing));
    }
```

- [x] **Step 6: Opdrachtregel, tests en commit**

`examples/import_drawing.rs`: `"--no-images" => options.images = false,` plus een regel in de gebruiksaanwijzing.

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
```

Draai daarna `import_drawing` op de 39 tekeningen met een IMAGE (te vinden met `inspect_cad --json`, veld `image_files`) en noteer `imagesEmbedded` en `imagesMissing`. Open twee uitkomsten met PyMuPDF en controleer dat het beeld op de goede plek en in de goede maat staat.

```
feat(import): afbeeldingen insluiten als beeld-XObject, geknipt op de kaderlijn (#400)
```

---

### Task 6: Blokken als formulier-XObject

Een blok dat honderden keren op een blad staat (een stip, een boom, een symbool) wordt nu elke keer opnieuw uitgeschreven. Ontwerp E3 noemt als fase 2 van de import: het blok één keer als formulier-XObject in de PDF, en per INSERT een `cm … Do`. Dat mag alleen als de inhoud van de twee plaatsingen werkelijk gelijk is; daarom komt een formulier alleen in aanmerking wanneer een latere plaatsing van hetzelfde blok van de eerste **alleen in verschuiving** verschilt (zelfde schaal, zelfde draaiing, zelfde geërfde laag, kleur, dikte, dekking, lijntype en bevroren lagen). Dan hoeven ook de lijndiktes niet gecorrigeerd te worden.

**Files:**
- Modify: `open-pdf-cad/src/import/walk.rs`, `pdf_out.rs`, `mod.rs`, `examples/import_drawing.rs`, `src/import/tests.rs`

**Interfaces:**
- Produces in `crate::import::walk`:
  - `pub enum FormAction { Draw, Record, Placed }` — `Debug, Clone, Copy, PartialEq, Eq`
  - `Sink::begin_form(&mut self, _key: &str, _origin: Point) -> FormAction { FormAction::Draw }`
  - `Sink::end_form(&mut self) {}`
  - `WalkSettings::reuse_blocks: bool` (standaard `true`)
  - `WalkStats::forms_written: u64`, `WalkStats::forms_reused: u64`
- Produces in `crate::import::pdf_out`:
  - `pub struct PageForm { pub content: Vec<u8>, pub bbox: [f64; 4] }`
  - `pub const MAX_FORMS: usize = 2048;`
  - `pub const MAX_FORM_BYTES: usize = 4 * 1024 * 1024;`
  - `PageBuilder::with_forms(self, on: bool) -> Self`
  - `PageBuilder::finish` geeft een zesde waarde: `Vec<PageForm>`; `OutputPage` krijgt `pub forms: Vec<PageForm>`. (De vijfde waarde is sinds Task 5 `Vec<(String, Rc<Raster>)>`; de beelden van de pagina staan al onder `XObject` in `resources` op het moment dat de formulierbronnen worden gekopieerd.)
- Nieuw: `ImportOptions::reuse_blocks: bool`, `ImportArgs::reuse_blocks: Option<bool>`.
- **Zoals uitgevoerd wijkt de taak af van de code hieronder**, met behoud van het bedoelde gedrag (standaard aan; met de optie uit byte voor byte de oude uitvoer). Latere taken gaan uit van deze vorm:
  - **Waarom anders.** De vorm hieronder neemt een blok bij de eerste plaatsing op, zonder te knippen. Op een blad dat een klein deel van een groot model toont zou dan het hele model in de PDF komen, en een blok dat één keer voorkomt zou een eigen object kosten. Bovendien erft een formulier de grafische toestand van de plek waar het staat, zou een blok dat zichzelf verdubbelt de werkgrenzen omzeilen (een klein bestand dat uitgevouwen miljoenen lijnen tekent), en telde het verslag de geplaatste blokken niet meer mee.
  - `pub enum FormAction { Draw, Measure, Record, Placed, Skipped }`. De **eerste** plaatsing van een sleutel wordt gewoon getekend en intussen gemeten (`Measure`: de omhullende van alles wat de wandelaar via `Sink::wants` aanbood, ook wat buiten beeld viel). Vanaf de tweede: valt de plaatsing helemaal buiten beeld dan `Skipped` (geen wandeling), half in beeld dan `Draw` (gewoon tekenen, per onderdeel geknipt), helemaal in beeld dan `Record` (één keer) en daarna `Placed`. Een formulier bevat zo nooit iets dat zonder formulieren weggeknipt was, en er komt nooit meer in de PDF dan zonder.
  - `Sink::wants(&mut self, …)` (was `&self`): de afnemer leest er de omhullende van een plaatsing af. Nieuw: `Sink::takes_forms(&self) -> bool` (standaard `false`; de wandelaar rekent dan geen sleutels uit) en `Sink::end_form(&mut self, complete: bool) -> bool` (`complete = false` als de wandeling onderweg stopte: dan wordt de opname geen formulier; het antwoord zegt of er een formulier van gemaakt is).
  - **Sleutel** (`Walker::form_key`): bloknaam, het lineaire deel van de afbeelding naar de pagina **bit voor bit** (twee rijen van drie; afronden op negen decimalen zou bij een blok met landelijke eigen coördinaten tot 0,2 pt verschuiven), de laag die laag 0 erft en of die aan staat, ByBlock-kleur, -dikte, -dekking en -lijntype, de lijntypefactor, een nummer voor de verzameling bevroren lagen van de viewport (één keer per viewport bepaald; twee viewports met dezelfde bevroren lagen delen hun formulieren) en de diepte. De wandelaar van een externe verwijzing zet er zijn eigen voorvoegsel voor (`form_scope`): een blok met dezelfde naam is daar een ander blok.
  - **Formulieren in formulieren.** Een blok in een blok wordt een formulier dat een formulier plaatst (hooguit zo diep als de dieptegrens van de wandelaar, 24; de export wikkelt tot 32 af). Alle formulieren van een pagina delen één bronnenobject, en de pagina verwijst naar datzelfde object (`/Resources N 0 R`), zodat wie later de lagen van de pagina hernoemt of samenvoegt dat meteen voor haar formulieren doet. Een pagina zonder formulieren houdt haar bronnen in het paginawoordenboek, byte voor byte zoals voorheen. Een formulier krijgt alleen `/Type`, `/Subtype`, `/BBox` (de gemeten omhullende plus ruimte voor lijndikte en letters) en `/Resources`.
  - **De werkgrenzen en het verslag blijven die van de uitgevouwen pagina.** De wandelaar bewaart per sleutel wat het doorlopen van het blok telde (`WalkStats::since`) en telt dat bij elke `Placed` of `Skipped` weer op (`Walker::replay`), de bezoeken gaan in één keer van het budget af (`VisitBudget::spend_many`), en `PageBuilder::charged_bytes()` rekent elke plaatsing mee met de omvang die het blok uitgevouwen had gehad; `convert` trekt dat getal van de begroting van de import af, niet de lengte van de inhoudsstroom. Het afbreken vraagt de wandelaar op zijn eigen teller (`ticks`), omdat de bezoeken vooruit springen. `entities`, `visits`, `drawn`, `texts`, de waarschuwingen en `PageResult::objects` zijn met en zonder formulieren gelijk (getest en nagemeten op alle 563 omzettingen van de verificatieverzameling).
  - **Of een opname een formulier wordt, beslist `PageBuilder::finish`** (`settle_forms`), als bekend is hoe vaak ze geplaatst is: `plaatsingen × omvang/8 > plaatsingen × 12 + omvang/2 + 250`, voorzichtig geschat in ingepakte bytes. Loont het niet, dan komt de opname op elke plek alsnog in de stroom zelf te staan, tussen `q` en `Q` (`splice`). `pub struct PageForm { pub number: usize, pub content: Vec<u8>, pub bbox: [f64; 4], pub uses: u64 }`: de naam is `/Fm<number>` en de nummers lopen niet altijd door. `WalkStats::forms_written` en `forms_reused` vult `convert` in uit wat `finish` teruggeeft (formulieren in de PDF, en hun plaatsingen); de wandelaar telt ze niet. Een blok dat bij de eerste plaatsing in beeld stond en minder dan `MIN_FORM_BYTES` (96) kostte, wordt nooit opgenomen.
  - Grenzen: `MAX_FORMS = 2048` formulieren per pagina (de minst lonende vallen af), `MAX_FORM_CANDIDATES = 8192` opnamen, `MAX_FORM_KEYS = 32 768` bijgehouden sleutels, `MAX_FORM_BYTES = 4 MB` per formulier.
  - De grenzenwandeling (`space_bounds`) loopt zonder formulieren, zoals hieronder: het papier en de schaal volgen zo precies uit dezelfde omhullenden als voorheen.
  - De tests heten zoals hieronder, met dezelfde verwachtingen (1 formulier en 39 plaatsingen; 2 formulieren), maar met zwaardere blokken (twaalf, dertig lijnen; de tweede test plaatst elk blok twaalf keer, dus 22 plaatsingen): een blok van twee lijnen loont niet. Erbij: een vergelijking onderdeel voor onderdeel van een pagina met en zonder formulieren (laag, kleur, dikte, lijntype, dekking, plaats, tekst, volgorde; ook per viewport met bevroren lagen, in een venster dat half over een blok valt, en met een gelijknamig blok in een externe verwijzing), de werkgrenzen met en zonder formulieren, een blok dat zichzelf verdubbelt, en afbreken midden in een opname.
  - **Nagemeten op de verificatieverzameling** (365 tekeningen, elk de standaardruimte en alle layouts: 730 omzettingen, 563 geven een PDF, vóór en na dezelfde). Met de optie uit zijn alle 563 PDF's byte voor byte gelijk aan vóór deze taak. Met de optie aan: 442 byte-gelijk, 98 verschillen alleen doordat een opname die niet loonde tussen `q` en `Q` in de pagina staat (samen 0,05% kleiner), 23 hebben formulieren (samen 22,97 → 22,04 MB, −4,1%; de beste −24,8% met 89 formulieren en 2 975 plaatsingen; één blad +0,5%: een inhoudsstroom die zelf al veertig keer kleiner inpakt). Alles samen 49,62 → 48,68 MB (−1,9%). Tellingen, waarschuwingen en onderdelen per pagina zijn op alle 563 gelijk. De 23 PDF's met formulieren zijn vóór en na gerenderd op 150 dpi met twee weergaven: 0,004% van de beeldpunten verschilt, nergens meer dan 61 van 255 (één beeldpunt; verder hooguit 28), het afrondingsverschil van 0,001 pt in de plaatsing. De duur is gelijk (de acht zwaarste: 12,6 s vóór, 12,5 s na): de grenzenwandeling doorloopt nog steeds elk blok.

- [x] **Step 1: Falende test schrijven**

In `tests.rs`:

```rust
#[test]
fn a_block_placed_many_times_becomes_one_form_object() {
    let mut t = TestDoc::new();
    t.layer("Symbolen", 1, |_| {});
    let blok = t.block("STIP");
    t.line(Some(blok), "Symbolen", Color::ByLayer, (0.0, 0.0), (10.0, 0.0));
    t.line(Some(blok), "Symbolen", Color::ByLayer, (0.0, 0.0), (0.0, 10.0));
    for n in 0..40 {
        t.insert(None, "STIP", "Symbolen", Color::ByLayer, (n as f64 * 100.0, 0.0));
    }
    let drawing = t.drawing();

    let dir = work_dir("formulieren");
    let met = dir.join("met.pdf");
    let options = ImportOptions { scale: Some(20.0), ..Default::default() };
    let result = convert(&drawing, &options, &met, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.forms_written, 1, "één formulier voor het blok");
    assert_eq!(result.stats.forms_reused, 39, "de andere 39 plaatsingen verwijzen ernaar");
    let raw = String::from_utf8_lossy(&std::fs::read(&met).unwrap()).to_string();
    assert!(raw.contains("/Subtype /Form"));

    // Zonder hergebruik is het bestand groter en staan er geen formulieren in.
    let zonder = dir.join("zonder.pdf");
    let options = ImportOptions { reuse_blocks: false, ..options.clone() };
    let plat = convert(&drawing, &options, &zonder, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(plat.stats.forms_written, 0);
    assert!(
        std::fs::metadata(&zonder).unwrap().len() > std::fs::metadata(&met).unwrap().len(),
        "hergebruik hoort kleiner te zijn"
    );
}

#[test]
fn a_block_at_another_scale_or_angle_gets_its_own_form() {
    let mut t = TestDoc::new();
    t.layer("Symbolen", 1, |_| {});
    let blok = t.block("PIJL");
    t.line(Some(blok), "Symbolen", Color::ByLayer, (0.0, 0.0), (10.0, 0.0));
    for n in 0..5 {
        t.insert(None, "PIJL", "Symbolen", Color::ByLayer, (n as f64 * 50.0, 0.0));
    }
    // Vijf keer gedraaid: een eigen formulier.
    for n in 0..5 {
        let handle = t.insert(None, "PIJL", "Symbolen", Color::ByLayer, (n as f64 * 50.0, 100.0));
        if let Some(EntityType::Insert(insert)) = t.doc.get_entity_mut(handle) {
            insert.rotation = std::f64::consts::FRAC_PI_2;
        }
    }
    let drawing = t.drawing();
    let dir = work_dir("formulieren-hoek");
    let pdf = dir.join("hoek.pdf");
    let options = ImportOptions { scale: Some(20.0), ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.stats.forms_written, 2);
    assert_eq!(result.stats.forms_reused, 8);
}
```

> Heet de methode om een entiteit te wijzigen anders dan `get_entity_mut`, kijk dan in `acadrust` hoe een entiteit na toevoegen aan te passen is, of bouw de `Insert` met de draaiing vóór `add`.

Verwachte uitvoer: `error[E0560]: struct `ImportOptions` has no field named `reuse_blocks``.

- [x] **Step 2: De `Sink` kent formulieren**

In `walk.rs`, boven `pub trait Sink`:

```rust
/// Wat de afnemer met een blokplaatsing doet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormAction {
    /// Gewoon tekenen (geen hergebruik).
    Draw,
    /// De afnemer neemt de inhoud op; teken hem één keer en sluit af met
    /// [`Sink::end_form`].
    Record,
    /// De afnemer had hem al en heeft hem geplaatst; niets tekenen.
    Placed,
}
```

en in de trait:

```rust
    /// Begin van een blokplaatsing die als formulier hergebruikt kan worden.
    /// `key` is gelijk voor plaatsingen die op een verschuiving na dezelfde
    /// inhoud geven; `origin` is waar de oorsprong van het blok op de pagina
    /// ligt.
    fn begin_form(&mut self, _key: &str, _origin: Point) -> FormAction {
        FormAction::Draw
    }

    /// Sluit een opname die met [`FormAction::Record`] begon.
    fn end_form(&mut self) {}
```

`WalkSettings` krijgt `pub reuse_blocks: bool,` (standaard `true`) en `WalkStats` krijgt:

```rust
    /// Blokken die als formulier-XObject in de PDF staan.
    pub forms_written: u64,
    /// Plaatsingen die naar een bestaand formulier verwijzen.
    pub forms_reused: u64,
```

- [x] **Step 3: De wandeling biedt de plaatsing aan**

In `fn insert`, binnen de lus over `rows`/`columns`: vervang de binnenste lus over `block.entities` door:

```rust
                    let action = if self.settings.reuse_blocks && !block.is_xref {
                        let key = self.form_key(&insert.block_name, &child);
                        sink.begin_form(&key, child.xf.point([0.0, 0.0, 0.0]))
                    } else {
                        FormAction::Draw
                    };
                    if action == FormAction::Placed {
                        self.stats.forms_reused += 1;
                        continue;
                    }
                    for entity in &block.entities {
                        if self.cancelled {
                            return;
                        }
                        // Als de laag van de INSERT uit staat, blijft alleen
                        // inhoud op een eigen (zichtbare) laag over. Een
                        // geneste INSERT op laag 0 gaat wel door: zijn blok kan
                        // inhoud op eigen zichtbare lagen hebben.
                        if !visible && entity.common().layer == "0" && !matches!(entity, EntityType::Insert(_)) {
                            continue;
                        }
                        self.entity(entity, &child, sink);
                    }
                    if action == FormAction::Record {
                        sink.end_form();
                        self.stats.forms_written += 1;
                    }
```

> Neem de bestaande regels binnen die lus (de `base`/`offset`-berekening en `child.xf = …`) ongewijzigd over; alleen de entiteitenlus wordt door het bovenstaande vervangen.

En een nieuwe methode naast `fn block`:

```rust
    /// Sleutel van een blokplaatsing. Plaatsingen met dezelfde sleutel geven
    /// op een verschuiving na precies dezelfde inhoud, dus mogen ze hetzelfde
    /// formulier-XObject delen. Alles wat de inhoud kan veranderen zit erin:
    /// het lineaire deel van de matrix (schaal en draaiing), de geërfde laag,
    /// de ByBlock-stijl, de lijntypefactor en de bevroren lagen.
    fn form_key(&self, name: &str, ctx: &Ctx<'a>) -> String {
        let p0 = ctx.xf.point([0.0, 0.0, 0.0]);
        let px = ctx.xf.point([1.0, 0.0, 0.0]);
        let py = ctx.xf.point([0.0, 1.0, 0.0]);
        let frozen = match &ctx.vp_frozen {
            Some(set) => {
                let mut names: Vec<&str> = set.iter().map(|s| s.as_str()).collect();
                names.sort_unstable();
                names.join(",")
            }
            None => String::new(),
        };
        format!(
            "{}|{:.9}|{:.9}|{:.9}|{:.9}|{}|{:?}|{}|{:.6}|{:.6}|{:.9}|{}|{}",
            name.to_uppercase(),
            px.x - p0.x,
            px.y - p0.y,
            py.x - p0.x,
            py.y - p0.y,
            ctx.inherit.map(|l| l.name).unwrap_or(""),
            ctx.byblock_color.rgb,
            ctx.byblock_color.aci7,
            ctx.byblock_weight,
            ctx.byblock_alpha,
            ctx.lt_factor,
            ctx.byblock_linetype.unwrap_or(""),
            frozen
        )
    }
```

- [x] **Step 4: De PDF-bouwer neemt op en plaatst**

In `pdf_out.rs`:

```rust
/// Een blok dat één keer als formulier-XObject in de pagina staat.
pub struct PageForm {
    pub content: Vec<u8>,
    pub bbox: [f64; 4],
}

/// Hoogste aantal formulieren per pagina.
pub const MAX_FORMS: usize = 2048;
/// Hoogste omvang van één formulier; daarboven wordt het blok gewoon getekend.
pub const MAX_FORM_BYTES: usize = 4 * 1024 * 1024;
```

`PageBuilder` krijgt erbij:

```rust
    /// Formulieren die op deze pagina staan.
    forms: Vec<PageForm>,
    /// Sleutel naar (nummer van het formulier, oorsprong bij de opname).
    form_keys: HashMap<String, (usize, Point)>,
    /// Loopt er een opname? Dan de inhoud tot nu toe en de sleutel.
    recording: Option<(String, Point, Vec<u8>, GraphicsState, Option<usize>)>,
    reuse: bool,
```

met in `new`: `forms: Vec::new(), form_keys: HashMap::new(), recording: None, reuse: false,` en:

```rust
    /// Zet hergebruik van blokken aan.
    pub fn with_forms(mut self, on: bool) -> Self {
        self.reuse = on;
        self
    }
```

De implementatie:

```rust
    fn begin_form(&mut self, key: &str, origin: Point) -> FormAction {
        if !self.reuse || self.recording.is_some() {
            return FormAction::Draw;
        }
        if let Some((slot, reference)) = self.form_keys.get(key).copied() {
            // Alleen de verschuiving verschilt; de rest van de matrix zit al
            // in de opgenomen inhoud.
            self.set_layer(None);
            self.content.extend_from_slice(b"q 1 0 0 1 ");
            self.number(origin.x - reference.x);
            self.content.push(b' ');
            self.number(origin.y - reference.y);
            self.content.extend_from_slice(format!(" cm /Fm{slot} Do Q\n").as_bytes());
            self.items += 1;
            return FormAction::Placed;
        }
        if self.forms.len() >= MAX_FORMS {
            return FormAction::Draw;
        }
        // De opname begint met een schone grafische toestand: een formulier
        // erft de toestand van de plaats waar het staat niet.
        self.set_layer(None);
        let outer = std::mem::replace(&mut self.content, Vec::with_capacity(4096));
        let state = std::mem::replace(&mut self.state, GraphicsState::empty());
        let layer = self.current_layer.take();
        self.recording = Some((key.to_string(), origin, outer, state, layer));
        FormAction::Record
    }

    fn end_form(&mut self) {
        let Some((key, origin, outer, state, layer)) = self.recording.take() else { return };
        self.set_layer(None);
        let inner = std::mem::replace(&mut self.content, outer);
        self.state = state;
        self.current_layer = layer;
        if inner.is_empty() || inner.len() > MAX_FORM_BYTES {
            // Te groot of leeg: de inhoud die net is opgenomen gaat alsnog
            // rechtstreeks de pagina in, zodat er niets verdwijnt.
            self.content.extend_from_slice(&inner);
            return;
        }
        let slot = self.forms.len();
        // De omhullende is ruim: de inhoud staat in paginaruimte.
        let bbox = [-1.0e6, -1.0e6, 1.0e6, 1.0e6];
        self.forms.push(PageForm { content: inner, bbox });
        self.form_keys.insert(key, (slot, origin));
        self.content.extend_from_slice(format!("q /Fm{slot} Do Q\n").as_bytes());
        self.items += 1;
    }
```

> De inhoud van een formulier staat in paginaruimte, niet in blokruimte: daarom is de `/Matrix` van het formulier de eenheidsmatrix en is de omhullende ruim genomen. Dat kost niets — `/BBox` knipt alleen — en houdt de opname gelijk aan wat er anders rechtstreeks was geschreven.

`finish` geeft de formulieren mee; `OutputPage` krijgt `pub forms: Vec<PageForm>,`. Zorg dat `finish` eerst een eventueel openstaande opname afsluit:

```rust
    pub fn finish(mut self) -> (Vec<u8>, Vec<usize>, Vec<u16>, Vec<FontChoice>, Vec<(String, Rc<Raster>)>, Vec<PageForm>) {
        if self.recording.is_some() {
            self.end_form();
        }
        self.set_layer(None);
        while !self.stack.is_empty() {
            self.pop_clip();
        }
        (self.content, self.used, self.alphas, self.fonts, self.images, self.forms)
    }
```

En `is_full` telt de formulieren mee:

```rust
    pub fn is_full(&self) -> bool {
        let forms: usize = self.forms.iter().map(|f| f.content.len()).sum();
        self.content.len() + forms > self.max_bytes
    }
```

In `write_pdf_with`, na het opbouwen van `resources` (dus mét Font, ExtGState en Properties) en vóór het paginawoordenboek:

```rust
        // Elk formulier krijgt dezelfde bronnen als de pagina, zonder de
        // formulieren zelf: een formulier verwijst nooit naar een ander.
        let form_resources = Obj::Dict(resources.clone());
        let mut form_objects: Vec<(String, Obj)> = Vec::new();
        for (slot, form) in page.forms.iter().enumerate() {
            let dict = vec![
                ("Type".to_string(), Obj::name("XObject")),
                ("Subtype".to_string(), Obj::name("Form")),
                ("FormType".to_string(), Obj::Int(1)),
                ("BBox".to_string(), Obj::reals(&form.bbox)),
                ("Matrix".to_string(), Obj::reals(&[1.0, 0.0, 0.0, 1.0, 0.0, 0.0])),
                ("Resources".to_string(), form_resources.clone()),
            ];
            let id = pdf.add_stream(dict, form.content.clone(), true);
            form_objects.push((format!("Fm{slot}"), Obj::Ref(id)));
        }
        if !form_objects.is_empty() {
            match resources.iter_mut().find(|(name, _)| name == "XObject") {
                Some((_, Obj::Dict(entries))) => entries.extend(form_objects),
                _ => resources.push(("XObject".to_string(), Obj::Dict(form_objects))),
            }
        }
```

> Let op de volgorde: `form_resources` wordt gemaakt vóór de formulieren aan `resources` worden toegevoegd, zodat een formulier niet naar zichzelf verwijst. De beeld-XObjects uit Task 5 zitten er wel in, want een blok kan een afbeelding bevatten.

- [x] **Step 5: Optie doorgeven**

- `ImportOptions::reuse_blocks: bool` (standaard `true`), `ImportArgs::reuse_blocks: Option<bool>`, `walk_settings` krijgt `reuse_blocks: options.reuse_blocks,`.
- In `convert`, bij het maken van de bouwer:

```rust
        let mut builder = PageBuilder::new(plan.width_pt, plan.height_pt, &mut registry, use_ocg)
            .with_max_bytes(options.max_content_bytes)
            .with_forms(options.reuse_blocks);
```

- De grenzenwandeling (`space_bounds`) zet `reuse_blocks: false` — `BoundsSink` doet toch niets met formulieren en moet elke omhullende zien:

```rust
    let settings = WalkSettings { infinite_lines: false, reuse_blocks: false, ..walk_settings(options) };
```

- `merge_stats` krijgt `target.forms_written += source.forms_written;` en `target.forms_reused += source.forms_reused;`.
- `examples/import_drawing.rs`: `"--no-blocks-reuse" => options.reuse_blocks = false,` plus een regel in de gebruiksaanwijzing.

- [x] **Step 6: Tests, meting en commit**

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
```

Meet daarna op drie zware bladen (bijvoorbeeld een plattegrond met veel symbolen) de bestandsgrootte met en zonder `--no-blocks-reuse` en de duur, en controleer met PyMuPDF dat het aantal getekende paden en hun omhullenden gelijk blijven. Zet de uitkomst in het commit-bericht.

```
feat(import): een blok dat vaker op dezelfde manier staat, komt één keer in de PDF (#400)
```

---

### Task 7: Voorbeeldstand in de omzetter

De voorbeeldweergave (E5, "Onderin") draait de echte omzetter naar een tijdelijke PDF. Boven 200 000 entiteiten gaat dat zonder arceringen en zonder tekst, met een melding. Die grens hoort in de crate, zodat ook de opdrachtregel en de MCP-koppeling hem krijgen.

**Files:**
- Modify: `open-pdf-cad/src/import/mod.rs`, `examples/import_drawing.rs`, `src/import/tests.rs`

**Interfaces:**
- Produces: `ImportOptions::preview: bool` (standaard `false`), `pub const PREVIEW_SIMPLE_ABOVE: u64 = 200_000;`
- Produces: `ImportArgs::preview: Option<bool>`
- Produces: `ImportResult::simplified: bool` (camelCase `simplified`) en de waarschuwingscode `previewSimplified:<n>`
- **Zoals uitgevoerd:**
  - De beslissing valt per ruimte (`bounds_stats.entities`, blokken uitgevouwen), na de grenzenwandeling met de volledige instellingen: papier, schaal en plaatsing van het voorbeeld zijn precies die van de echte import (getest). Alleen wát er getekend wordt verandert (`hatch = None`, `text = false`, `dimensions = false` op een kopie van de opties voor die ene pagina); `simplified` en de waarschuwing gelden voor de import als geheel en de waarschuwing komt er één keer in, met de grens als getal.
  - De voorbeeldstand heeft geen eigen, ruimere grenzen: bezoekbudget, inhoudsbudget (met formulieren de uitgevouwen omvang), de begrotingen voor verwijzingen en afbeeldingen en de afbreekvlag gelden onverkort. Getest: te weinig bezoeken en te weinig inhoudsruimte geven `IMPORT_TOO_COMPLEX`, afbreken vooraf en tijdens het tekenen geeft `IMPORT_CANCELLED`, en er blijft geen (deel)bestand achter.
  - De test bouwt de zware tekening als één invoeging in 500 × 402 cellen (201 001 entiteiten uit een document van een handvol objecten) met een tekst en een effen arcering erbij, in plaats van 200 010 losse lijnen: zo is te zien dát tekst en arcering wegvallen, en blijft de test snel.
  - `cadImport.warn_previewSimplified` staat in alle 39 talen (deze taak). Task 10 slaat hem over; de sleutel `previewSimplified` (zonder `warn_`) van het voorbeeldpaneel hoort nog wel bij Task 10.

- [x] **Step 1: Falende test**

```rust
#[test]
fn a_heavy_preview_leaves_out_hatches_and_text() {
    let mut t = TestDoc::new();
    t.layer("Vlak", 1, |_| {});
    // Meer entiteiten dan de voorbeeldgrens.
    for n in 0..(super::PREVIEW_SIMPLE_ABOVE + 10) {
        t.line(None, "Vlak", Color::ByLayer, (0.0, n as f64), (100.0, n as f64));
    }
    let drawing = t.drawing();
    let dir = work_dir("voorbeeld");
    let pdf = dir.join("voorbeeld.pdf");
    let options = ImportOptions { preview: true, scale: Some(500.0), ..Default::default() };
    let result = convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(result.simplified, "boven de grens wordt het voorbeeld vereenvoudigd");
    assert!(result.warnings.iter().any(|w| w.starts_with("previewSimplified:")));
    assert_eq!(result.stats.texts, 0);

    // Een kleine tekening blijft volledig.
    let mut t = TestDoc::new();
    t.layer("Vlak", 1, |_| {});
    t.line(None, "Vlak", Color::ByLayer, (0.0, 0.0), (100.0, 0.0));
    let klein = dir.join("klein.pdf");
    let result = convert(&t.drawing(), &options, &klein, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(!result.simplified);
}
```

- [x] **Step 2: Bouwen**

In `mod.rs`:

```rust
/// Boven dit aantal entiteiten tekent de voorbeeldweergave zonder arceringen
/// en zonder tekst; het venster meldt dat.
pub const PREVIEW_SIMPLE_ABOVE: u64 = 200_000;
```

`ImportOptions` krijgt:

```rust
    /// Voorbeeldstand: boven [`PREVIEW_SIMPLE_ABOVE`] entiteiten vervallen
    /// arceringen en tekst, zodat het venster snel iets laat zien.
    pub preview: bool,
```

(standaard `false`), `ImportArgs::preview: Option<bool>`, verwerkt in `options()`.

`ImportResult` krijgt:

```rust
    /// Het voorbeeld is vereenvoudigd (te veel entiteiten).
    pub simplified: bool,
```

In `convert`, in de lus per ruimte, direct ná `let (bounds_sink, bounds_stats) = space_bounds(…)?;`:

```rust
        // Voorbeeldweergave van een zware tekening: zonder arceringen en
        // zonder tekst is hij snel klaar en laat hij toch de opbouw zien.
        let mut page_options = options.clone();
        if options.preview && bounds_stats.entities > PREVIEW_SIMPLE_ABOVE {
            page_options.hatch = HatchMode::None;
            page_options.text = false;
            page_options.dimensions = false;
            simplified = true;
        }
        let options = &page_options;
```

met `let mut simplified = false;` vóór de lus, en `simplified,` in de `ImportResult`. Voeg in `warnings_from` niets toe; zet de waarschuwing in `convert` zelf, direct vóór het teruggeven:

```rust
    let mut warnings = warnings_from(&stats);
    if simplified {
        warnings.push(format!("previewSimplified:{}", PREVIEW_SIMPLE_ABOVE));
    }
```

> `options` wordt in de lus opnieuw gebonden; controleer dat de rest van de lus die gebruikt (dus niet per ongeluk de buitenste). Laat de toplaag-variabele `effective` staan zoals hij is.

- [x] **Step 3: Opdrachtregel, tests en commit**

`examples/import_drawing.rs`: `"--preview" => options.preview = true,` plus een regel in de gebruiksaanwijzing.

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
```

```
feat(import): voorbeeldstand laat arceringen en tekst weg boven 200 000 entiteiten (#400)
```

---

### Task 8: Terugweg naar CAD — exporteren in de oorspronkelijke modelcoördinaten

De import schrijft per (viewport van de) pagina `/OPS_ModelMatrix` en `/OPS_ModelUnits` (E4, "Voorstel — terugweg naar CAD"). Die kant is af. Wat ontbreekt is de andere kant: de export leest die matrix nog niet, dus een geïmporteerde pagina komt niet terug in de coördinaten van de oorspronkelijke tekening. Deze taak maakt de kring rond.

**Files:**
- Create: `open-pdf-cad/src/model_space.rs`
- Modify: `open-pdf-cad/Cargo.toml`, `src/lib.rs`, `src/convert.rs`, `src/page_space.rs`, `src/error.rs`
- Modify: `open-pdf-cad/examples/export_page.rs`
- Modify: `open-pdf-studio/src-tauri/src/cad_export.rs`

**Interfaces:**
- Consumes: `lopdf 0.34` (staat al in `Cargo.lock` van de workspace via de app en `open-pdf-render`).
- Produces in `crate::model_space`:
  - `pub struct ModelSpace { pub page_to_model: Matrix, pub unit: DrawingUnit, pub name: String }` — `Clone, Copy` past niet door `name`; dus `Clone, Debug, PartialEq`.
  - `pub fn read(pdf_path: &Path, page_index: u32) -> Option<ModelSpace>`
  - `pub fn from_viewports(page: &lopdf::Dictionary, document: &lopdf::Document, page_width_pt: f64, page_height_pt: f64) -> Option<ModelSpace>`
- Produces: `crate::convert::OriginMode::Model` (serde `model`), `ConvertOptions::model: Option<ModelSpace>`.
- Produces: `OutputTransform::from_model(frame: &PageFrame, page_to_model: Matrix) -> OutputTransform`.
- Produces: `ExportError::NoModelSpace` met de vaste vorm `NO_MODEL_SPACE`.
- Produces: `pub fn read_model_space(pdf_path: &Path, page_index: u32) -> Option<ModelSpace>` in `lib.rs` (heruitvoer van `model_space::read`).
- **Zoals uitgevoerd wijkt de taak af van de code hieronder**, met behoud van het bedoelde gedrag. Latere taken (de exportschil van Task 9, het exportvenster van fase 2) gaan uit van deze vorm:
  - **De PDF-bibliotheek leest reële getallen in 32 bits.** Een verschuiving van 155 000 000,123 mm komt daar acht millimeter of meer naast terug; de code hieronder (de matrix uit `lopdf::Object::Real`) is voor landelijke coördinaten dus onbruikbaar. `lopdf 0.34` (zelfde versie en vlaggen als de app en `open-pdf-render`; in `Cargo.lock` komt alleen de regel `lopdf` bij `open-pdf-cad` erbij, geen tweede variant) leest nu alleen de **opbouw** van het bestand: kruisverwijzingen (tabel of stroom), objectstromen en de paginaboom, met een filter dat alle andere stromen bij het lezen al weggooit. De bytes van de pagina, van `/VP` en van wat daarbinnen een verwijzing is, leest `model_space::Parser` zelf, met getallen in 64 bits, grenzen op diepte en omvang en zonder indexering die kan falen. Dat werkt ook voor een document dat de app heeft opgeslagen (pagina in een objectstroom, kruisverwijzingsstroom); getest met een met de hand opgebouwd bestand in die vorm. `from_viewports(page: &lopdf::Dictionary, …)` bestaat daarom niet.
  - `pub struct ModelSpace { pub page_to_model: Matrix, pub unit: DrawingUnit, pub name: String, pub bbox: Option<[f64; 4]> }`: de matrix beeldt de **gebruikersruimte** van de pagina af (zonder `/Rotate`), `bbox` is de `/BBox` van de viewport. `pub struct PageModelSpaces { pub frame: PageFrame, pub spaces: Vec<ModelSpace> }` met `choose(&self, area: Option<AreaRect>) -> Result<ModelSpace, ExportError>`; `pub fn read_page(path, page_index) -> Option<PageModelSpaces>`, `read_mem(bytes, page_index)`, en `read` = `read_page(…)?.choose(None).ok()`. `MediaBox`, `CropBox`, `Rotate` en `UserUnit` mogen van een ouder in de paginaboom komen. Alle eenheden van `DrawingUnit` worden herkend (`DrawingUnit::from_app_unit`).
  - **Welke viewport geldt.** Met een exportgebied: de kleinste viewport waar het gebied helemaal in ligt (het gebied staat in de weergegeven pagina en wordt eerst naar de gebruikersruimte gebracht). Zonder gebied: de viewport die het hele blad beslaat (zo schrijft de import een modelpagina), anders de enige viewport. Meer vensters zonder gebied, of een gebied dat in geen enkel venster past: `ExportError::AmbiguousModelSpace { viewports }` (`MODEL_SPACE_AMBIGUOUS:<n>`), niet stilzwijgend de eerste. Het blad van een layout heeft zelf geen terugweg (papier op ware grootte); elke viewport wel.
  - `pub fn resolve_model_space(pdf_path, page_index, options: &mut ConvertOptions, cancel: Option<&AtomicBool>) -> Result<(), ExportError>` in `lib.rs` (de afbreekvlag kwam erbij in de fixgolf na de review, zie onderaan): leest en kiest bij `OriginMode::Model` en zet `options.model`; bij een andere oorsprong gebeurt er niets. De schil (`cad_export.rs`, in de werkdraad), het voorbeeldprogramma (`--origin model`) en de tests roepen dit aan; `extract_page` weigert `OriginMode::Model` zonder `model` met `NO_MODEL_SPACE` vóór PDFium iets opent. De omzetter leest zelf nooit van schijf.
  - **Twee stappen in plaats van één matrix.** `OutputTransform::from_model(frame, page_to_model) -> Option<(OutputTransform, Matrix)>`: eerst naar een tussenruimte op de schaal van het model maar nog langs de assen van de weergegeven pagina (daar knipt de omzetter op het rechthoekige exportgebied en gelden de toleranties), en helemaal aan het eind (`Converter::finish`) de draaiing en verschuiving naar het model, waarbij ook de hoek van tekst en de omhullende meegaan. Met één matrix zou een gedraaide tekening op de omhullende van twee gedraaide hoekpunten geknipt worden, en stond de grote verschuiving in elke tussenberekening. De eenheid van de uitvoer wordt die van de tekening (`$INSUNITS` komt terug); lijntypen en teksthoogten staan in tekeningeenheden van het model. De matrix geldt in de gebruikersruimte, dus een pagina die later gedraaid of bijgesneden is, komt ook goed terug (getest).
  - `Converter::output_scale()` en `ExtractedPage::scale`: de schaal in het verslag volgt bij de terugweg uit de matrix. `write_page` krijgt de schaal daarom niet meer als argument (de aanroep in `cad_export.rs` is aangepast). `Matrix::inverse()` staat in `geom.rs`; `import::invert` gebruikt hem.
  - **Gemeten (heen en terug, `tests/model_roundtrip.rs`, met de meegeleverde PDFium):** de afwijking in het model is 0,017 mm bij 1:100, 0,006 mm bij 1:50 met 30° draaiing en marge 25, 0,021 mm bij 1:200 in meters met een kwartslag, 0,037 mm passend op papier (1:200) met 12,5° draaiing, 0,0002 mm bij 1:1, en op een layout met twee vensters 0,023 mm (1:100) en 0,005 mm (1:20), elk in zijn eigen modelcoördinaten. Op papier is dat overal minder dan 0,0002 mm. De matrix zelf draagt hooguit 0,0004 mm bij (twaalf cijfers); wat overblijft is de afronding van de PDF: de import schrijft paginacoördinaten in duizendsten van een punt (0,018 mm in het model bij 1:100) en PDFium leest ze in 32 bits. **Binnen 0,01 mm in het model blijft de terugweg dus tot ongeveer 1:50; bij 1:100 is het 0,02 mm.** Wie dat scherper wil, moet de import vier decimalen laten schrijven (grotere bestanden, alle bewaakte PDF's opnieuw); dat is hier niet gedaan. Een pagina met blokken als formulier komt met dezelfde lijnen op dezelfde plek terug als de platte pagina (12 × 30 lijnen, grootste verschil 0,025 mm bij 1:50: de plaatsing van een formulier rondt één keer extra af).

- [x] **Step 1: Falende tests schrijven**

In `open-pdf-cad/tests/import_roundtrip.rs` (daar staat al een import die een PDF maakt, dus de heen- en terugweg zijn in één test te meten):

```rust
#[test]
fn an_imported_page_exports_back_in_the_original_model_coordinates() {
    // Een DXF met een lijn op landelijke coördinaten.
    let dir = work_dir("terugweg");
    let dxf = dir.join("tracé.dxf");
    write_line_dxf(&dxf, (155_000_000.0, 463_000_000.0), (155_007_500.0, 463_000_000.0));

    // Importeren op 1:100 met de modelmatrix aan (standaard).
    let pdf = dir.join("tracé.pdf");
    let drawing = open_pdf_cad::import::read(&dxf, &AtomicBool::new(false), |_| {}).unwrap();
    let options = open_pdf_cad::import::ImportOptions { scale: Some(100.0), ..Default::default() };
    open_pdf_cad::import::convert(&drawing, &options, &pdf, &AtomicBool::new(false), |_| {}).unwrap();

    // De pagina draagt de afbeelding terug naar het model.
    let model = open_pdf_cad::read_model_space(&pdf, 0).expect("modelmatrix op de pagina");
    assert_eq!(model.unit, open_pdf_cad::DrawingUnit::Mm);

    // Exporteren met oorsprong "model": de coördinaten zijn weer die van de
    // tekening, op 0,1 mm nauwkeurig.
    let dxf_terug = dir.join("terug.dxf");
    let mut options = open_pdf_cad::ConvertOptions::default();
    options.origin = open_pdf_cad::OriginMode::Model;
    options.model = Some(model);
    export_with(&pdf, 0, &options, &dxf_terug);
    let punten = read_line_endpoints(&dxf_terug);
    assert!((punten[0].0 - 155_000_000.0).abs() < 0.1, "x links: {}", punten[0].0);
    assert!((punten[1].0 - 155_007_500.0).abs() < 0.1, "x rechts: {}", punten[1].0);
    assert!((punten[0].1 - 463_000_000.0).abs() < 0.1, "y: {}", punten[0].1);

    // Zonder matrix op de pagina is het een nette fout, geen paniek.
    let kaal = dir.join("kaal.pdf");
    let options_zonder = open_pdf_cad::import::ImportOptions { model_matrix: false, scale: Some(100.0), ..Default::default() };
    open_pdf_cad::import::convert(&drawing, &options_zonder, &kaal, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(open_pdf_cad::read_model_space(&kaal, 0).is_none());
}
```

> `write_line_dxf`, `export_with` en `read_line_endpoints` zijn kleine hulpfuncties in dat testbestand; bouw ze op de manier die er al staat (de bestaande test maakt een DXF met de eigen schrijver en leest de uitvoer terug met `examples/inspect_cad`-achtige code of met `acadrust::DxfReader`).

En in `open-pdf-cad/src/model_space.rs` zelf:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_whole_page_viewport_wins_and_nonsense_is_refused() {
        let mut document = lopdf::Document::with_version("1.7");
        let mut page = lopdf::Dictionary::new();
        let whole = lopdf::Dictionary::from_iter([
            ("BBox", lopdf::Object::Array(vec![0.into(), 0.into(), 842.into(), 595.into()])),
            ("OPS_ModelMatrix", lopdf::Object::Array(vec![
                35.27778.into(), 0.into(), 0.into(), 35.27778.into(), 1000.into(), 2000.into(),
            ])),
            ("OPS_ModelUnits", lopdf::Object::string_literal("mm")),
        ]);
        let detail = lopdf::Dictionary::from_iter([
            ("BBox", lopdf::Object::Array(vec![10.into(), 10.into(), 100.into(), 100.into()])),
            ("OPS_ModelMatrix", lopdf::Object::Array(vec![
                7.0.into(), 0.into(), 0.into(), 7.0.into(), 0.into(), 0.into(),
            ])),
            ("OPS_ModelUnits", lopdf::Object::string_literal("m")),
        ]);
        page.set("VP", lopdf::Object::Array(vec![detail.clone().into(), whole.into()]));
        let found = from_viewports(&page, &document, 842.0, 595.0).expect("modelmatrix");
        assert!((found.page_to_model.a - 35.27778).abs() < 1e-9, "de viewport over het hele blad wint");
        assert_eq!(found.unit, crate::DrawingUnit::Mm);

        // Alleen een detailviewport: die telt ook.
        let mut alleen = lopdf::Dictionary::new();
        alleen.set("VP", lopdf::Object::Array(vec![detail.into()]));
        assert_eq!(from_viewports(&alleen, &document, 842.0, 595.0).map(|m| m.unit), Some(crate::DrawingUnit::M));

        // Geen /VP, een lege array, een matrix met te weinig getallen of een
        // ontaarde matrix: niets, en geen paniek.
        assert!(from_viewports(&lopdf::Dictionary::new(), &document, 842.0, 595.0).is_none());
        let mut kapot = lopdf::Dictionary::new();
        kapot.set("VP", lopdf::Object::Array(vec![lopdf::Dictionary::from_iter([(
            "OPS_ModelMatrix",
            lopdf::Object::Array(vec![1.into(), 0.into()]),
        )])
        .into()]));
        assert!(from_viewports(&kapot, &document, 842.0, 595.0).is_none());
        let _ = &mut document;
    }
}
```

Verwachte uitvoer: `error[E0433]: failed to resolve: use of undeclared crate or module `lopdf``.

- [x] **Step 2: `lopdf` als afhankelijkheid**

In `open-pdf-cad/Cargo.toml`, bij `[dependencies]`:

```toml
# Alleen om de terugweg naar CAD te lezen: /VP met /OPS_ModelMatrix op een
# pagina die de import zelf heeft gemaakt. Zelfde versie als de app.
lopdf = { version = "0.34", default-features = false, features = ["chrono_time", "pom_parser"] }
```

> Neem de feature-vlaggen over uit `open-pdf-studio/src-tauri/Cargo.toml`, zodat er geen tweede variant in de lock komt. Controleer met `cargo tree -p open-pdf-cad -i lopdf` dat er één versie staat.

- [x] **Step 3: `model_space.rs` schrijven**

```rust
//! De terugweg naar CAD: de afbeelding pagina naar model van een geïmporteerde
//! pagina lezen (#400).
//!
//! De import schrijft per (viewport van de) pagina `/OPS_ModelMatrix` en
//! `/OPS_ModelUnits` in het `/VP`-woordenboek. Met die matrix kan de export een
//! geïmporteerde pagina terugschrijven in de coördinaten van de oorspronkelijke
//! tekening.
//!
//! Alles komt uit een bestand: geen `unwrap`, geen indexering zonder controle.

use crate::geom::Matrix;
use crate::page_space::DrawingUnit;
use std::path::Path;

/// De afbeelding van een pagina naar het model van de oorspronkelijke tekening.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelSpace {
    /// Paginapunten (oorsprong linksonder) naar tekeningeenheden.
    pub page_to_model: Matrix,
    /// Eenheid van de tekening.
    pub unit: DrawingUnit,
    /// Naam van de viewport, voor het verslag.
    pub name: String,
}

fn number(object: &lopdf::Object) -> Option<f64> {
    match object {
        lopdf::Object::Integer(i) => Some(*i as f64),
        lopdf::Object::Real(r) => Some(*r as f64),
        _ => None,
    }
}

fn text(object: Option<&lopdf::Object>) -> String {
    match object {
        Some(lopdf::Object::String(bytes, _)) => String::from_utf8_lossy(bytes).into_owned(),
        Some(lopdf::Object::Name(bytes)) => String::from_utf8_lossy(bytes).into_owned(),
        _ => String::new(),
    }
}

fn matrix_of(dictionary: &lopdf::Dictionary) -> Option<Matrix> {
    let array = dictionary.get(b"OPS_ModelMatrix").ok()?.as_array().ok()?;
    if array.len() != 6 {
        return None;
    }
    let v: Vec<f64> = array.iter().filter_map(number).collect();
    if v.len() != 6 {
        return None;
    }
    let m = Matrix::new(v[0], v[1], v[2], v[3], v[4], v[5]);
    let determinant = m.a * m.d - m.b * m.c;
    if !determinant.is_finite() || determinant.abs() < 1e-18 {
        return None;
    }
    Some(m)
}

fn unit_of(dictionary: &lopdf::Dictionary) -> DrawingUnit {
    match text(dictionary.get(b"OPS_ModelUnits").ok()).to_lowercase().as_str() {
        "cm" => DrawingUnit::Cm,
        "m" => DrawingUnit::M,
        "in" => DrawingUnit::In,
        "ft" => DrawingUnit::Ft,
        _ => DrawingUnit::Mm,
    }
}

/// Zoekt de bruikbare viewport op een pagina. Een viewport die het hele blad
/// beslaat gaat voor; anders de eerste met een matrix.
pub fn from_viewports(
    page: &lopdf::Dictionary,
    document: &lopdf::Document,
    page_width_pt: f64,
    page_height_pt: f64,
) -> Option<ModelSpace> {
    let viewports = page.get(b"VP").ok()?;
    let viewports = match viewports {
        lopdf::Object::Reference(id) => document.get_object(*id).ok()?.as_array().ok()?,
        other => other.as_array().ok()?,
    };
    let mut first: Option<ModelSpace> = None;
    for item in viewports.iter().take(1024) {
        let dictionary = match item {
            lopdf::Object::Reference(id) => match document.get_object(*id).and_then(|o| o.as_dict().cloned()) {
                Ok(d) => d,
                Err(_) => continue,
            },
            lopdf::Object::Dictionary(d) => d.clone(),
            _ => continue,
        };
        let Some(page_to_model) = matrix_of(&dictionary) else { continue };
        let found = ModelSpace {
            page_to_model,
            unit: unit_of(&dictionary),
            name: text(dictionary.get(b"Name").ok()),
        };
        // Beslaat deze viewport (vrijwel) het hele blad?
        if let Ok(box_array) = dictionary.get(b"BBox").and_then(|o| o.as_array()) {
            let v: Vec<f64> = box_array.iter().filter_map(number).collect();
            if v.len() == 4 {
                let (w, h) = ((v[2] - v[0]).abs(), (v[3] - v[1]).abs());
                if (w - page_width_pt).abs() <= 1.0 && (h - page_height_pt).abs() <= 1.0 {
                    return Some(found);
                }
            }
        }
        if first.is_none() {
            first = Some(found);
        }
    }
    first
}

/// Leest de terugweg van een pagina in een PDF-bestand. `None` als de pagina
/// hem niet draagt, of als het bestand niet te lezen is.
pub fn read(pdf_path: &Path, page_index: u32) -> Option<ModelSpace> {
    let document = lopdf::Document::load(pdf_path).ok()?;
    let pages = document.get_pages();
    let (_, id) = pages.iter().nth(page_index as usize)?;
    let page = document.get_object(*id).ok()?.as_dict().ok()?.clone();
    // MediaBox mag van een ouder erven.
    let media = document
        .get_dictionary_inherited(*id, b"MediaBox")
        .ok()
        .and_then(|o| o.as_array().ok().cloned())
        .unwrap_or_default();
    let v: Vec<f64> = media.iter().filter_map(number).collect();
    let (w, h) = if v.len() == 4 { ((v[2] - v[0]).abs(), (v[3] - v[1]).abs()) } else { (0.0, 0.0) };
    from_viewports(&page, &document, w, h)
}
```

> `lopdf 0.34` heeft geen `get_dictionary_inherited`; gebruik de functie die er wél is om een geërfde sleutel op te halen (bijvoorbeeld `Document::get_page_media_box` of `get_inherited_page_attribute`). Kies de bestaande functie en laat de terugval `(0.0, 0.0)` staan: dan wint gewoon de eerste viewport met een matrix, wat op een geïmporteerde pagina hetzelfde is.

Meld de module aan in `src/lib.rs`:

```rust
pub mod model_space;
```

en voeg een heruitvoer toe naast de andere:

```rust
pub use model_space::{read as read_model_space, ModelSpace};
```

- [x] **Step 4: De omzetting gebruikt de matrix**

In `open-pdf-cad/src/convert.rs`:

```rust
pub enum OriginMode {
    /// Linksonder van de weergegeven pagina.
    #[default]
    Page,
    /// Linksonder van het gekozen gebied.
    Area,
    /// De oorspronkelijke modelcoördinaten van een geïmporteerde pagina
    /// (`/OPS_ModelMatrix`). Dan bepalen de matrix en `OPS_ModelUnits` de
    /// eenheid en de schaal; `scale`, `units` en `offset` tellen niet mee.
    Model,
}
```

`ConvertOptions` krijgt:

```rust
    /// De terugweg naar CAD; alleen gebruikt bij `OriginMode::Model`.
    pub model: Option<crate::model_space::ModelSpace>,
```

met `model: None,` in `Default`.

Vervang op de plaats waar de transformatie wordt gemaakt:

```rust
        let transform = match (options.origin, &options.model) {
            (OriginMode::Model, Some(model)) => OutputTransform::from_model(frame, model.page_to_model),
            (OriginMode::Model, None) => return Err(ExportError::NoModelSpace),
            _ => OutputTransform::with_post(frame, options.scale, options.units, origin, options.offset),
        };
```

> Geeft de omringende functie geen `Result<_, ExportError>` terug, geef dan de fout door op de plaats waar `ConvertOptions` gecontroleerd wordt (in `extract_page`), vóór de eerste PDFium-aanroep.

In `open-pdf-cad/src/page_space.rs`:

```rust
    /// De terugweg naar CAD: de pagina wordt rechtstreeks met de matrix uit
    /// `/OPS_ModelMatrix` naar tekeningeenheden afgebeeld. De schaal, de
    /// eenheid en de verschuiving zitten al in die matrix.
    pub fn from_model(frame: &PageFrame, page_to_model: Matrix) -> Self {
        let display_matrix = page_to_model;
        let matrix = frame.to_display_points().then(&display_matrix);
        let determinant = display_matrix.a * display_matrix.d - display_matrix.b * display_matrix.c;
        let scale = determinant.abs().sqrt();
        OutputTransform {
            matrix,
            display_matrix,
            units_per_user_unit: scale * frame.user_unit,
            paper_mm_per_user_unit: MM_PER_POINT * frame.user_unit,
        }
    }
```

In `open-pdf-cad/src/error.rs`:

```rust
    /// De pagina draagt geen terugweg naar CAD (`/OPS_ModelMatrix`).
    NoModelSpace,
```

met in `Display`:

```rust
            // Vaste vorm: de app herkent deze fout aan het voorvoegsel.
            ExportError::NoModelSpace => write!(f, "NO_MODEL_SPACE"),
```

- [x] **Step 5: Aanroepers**

- `ExportArgs::options()` laat `origin` gewoon door; het lezen van de matrix doet de aanroeper, zodat de crate niets stilzwijgend van schijf leest.
- In `open-pdf-cad/examples/export_page.rs`, ná het opbouwen van de opties:

```rust
    if options.origin == OriginMode::Model {
        options.model = open_pdf_cad::read_model_space(std::path::Path::new(&args.pdf_path), args.page_index);
        if options.model.is_none() {
            eprintln!("deze pagina draagt geen terugweg naar CAD (/OPS_ModelMatrix)");
            std::process::exit(2);
        }
    }
```

plus een regel `--origin model` in de gebruiksaanwijzing.

- In `open-pdf-studio/src-tauri/src/cad_export.rs`, op de plaats waar `ConvertOptions` uit de argumenten komt:

```rust
    // De terugweg naar CAD staat op de pagina zelf; de crate leest niets van
    // schijf zonder dat de schil het vraagt.
    if options.origin == open_pdf_cad::OriginMode::Model {
        options.model = open_pdf_cad::read_model_space(std::path::Path::new(&args.pdf_path), args.page_index);
        if options.model.is_none() {
            return Err("NO_MODEL_SPACE".to_string());
        }
    }
```

- [x] **Step 6: Tests en commit**

```
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test -p open-pdf-cad
cargo tree -p open-pdf-cad -i lopdf
```

Meet daarna met `examples/import_drawing` en `examples/export_page` op een tekening met landelijke coördinaten dat heen en terug binnen 0,1 mm gelijk blijft, en zet dat getal in het commit-bericht.

```
feat(cad): een geïmporteerde pagina exporteert terug in de oorspronkelijke modelcoördinaten (#400)
```

---

### Task 9: Tauri-schil — nieuwe argumenten en het voorbeeldcommando

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/cad_import.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (commando aanmelden)

**Interfaces:**
- Consumes: `open_pdf_cad::import::{ImportArgs, ImportResult, ImportProgress, ImportPhase}` met de velden uit Task 2 tot en met 7. `ImportResult` draagt sinds de beveiligingsreview ook `externals: Vec<ExternalFile>` en `externalsTruncated` (camelCase; de bestandsnamen van geladen, niet gevonden en geweigerde verwijzingen en afbeeldingen, nooit paden), en `DrawingScan` dezelfde twee velden uit de verkenning. De commando's geven ze ongewijzigd door; ook `preview_cad_import` levert ze, zodat het venster na een voorbeeld al kan tonen wat er van buiten gelezen is.
- Produces:
  - `#[tauri::command] pub async fn preview_cad_import(app: tauri::AppHandle, state: tauri::State<'_, CadImportState>, job_id: String, args: ImportArgs) -> Result<ImportResult, String>`
  - `#[tauri::command] pub fn cad_import_limits() -> ImportLimits` met `pub struct ImportLimits { pub preview_simple_above: u64, pub max_image_pixels: u64, pub max_image_total_bytes: u64, pub max_xref_files: usize, pub max_listed_externals: usize }` (camelCase, `Serialize`), gevuld uit `image::MAX_IMAGE_PIXELS` (200 miljoen, alleen te verlagen), `image::MAX_IMAGE_TOTAL_BYTES`, `xref::MAX_XREF_FILES` en `xref::MAX_LISTED_EXTERNALS`.
- **Zoekpaden in de verkenning:** `scan_cad_file` kent de zoekpaden van de gebruiker niet en zoekt alleen in de map van de tekening. Geef het commando een optioneel argument `search_paths: Vec<String>` (dezelfde schoonmaak als in `ImportArgs::options`) dat doorgaat naar de verkenning, zodat "niet gevonden" in het venster klopt zodra de gebruiker een zoekpad kiest (Task 11 verkent dan opnieuw). Het hergebruik van de gelezen tekening blijft: alleen het zoeken wordt herhaald.

- **Zoals uitgevoerd wijkt de taak af van de code hieronder**, met behoud van het bedoelde gedrag. Latere taken (het venster van Task 11 en 12, de MCP-opdracht van Task 15) gaan uit van deze vorm:
  - **Het voorbeeld kiest zijn eigen bestand.** `preview_cad_import` gebruikt het `outputPath` van de aanroeper niet: het bestand komt met een unieke naam (`voorbeeld-<tijd>-<proces>-<teller>-<willekeurig>.pdf`) in de map `cad-voorbeeld` van de cachemap van de app (`cad_import::preview_dir`), dezelfde aanpak als de ondertekende versies. Het pad staat in het verslag (`outputPath`) en komt in de fs-scope. De schil onthoudt welke voorbeelden deze sessie gemaakt heeft (`CadImportState::previews`): `#[tauri::command] discard_cad_preview(path) -> bool` gooit er één weg (alleen een bestand uit die lijst; `false` als het er niet bij hoort of nog in gebruik is), `release_cad_import` gooit ze allemaal weg, en bij het opstarten ruimt `cad_import::sweep_previews(dir, PREVIEW_MAX_AGE)` op wat ouder is dan een dag (in `lib.rs`, naast de opruiming van de ondertekende versies). Bij een fout of afbreken blijft er niets staan (de omzetter schrijft naar een deelbestand). De test "zonder uitvoerpad geweigerd" uit de code hieronder vervalt daarmee; ervoor in de plaats: het pad van de aanroeper wordt niet gebruikt, een tweede voorbeeld krijgt een eigen naam, weggooien werkt alleen op eigen bestanden, en de opruiming bij de start laat verse voorbeelden en andere bestanden staan.
  - **Zoekpaden worden in de schil gecontroleerd** (`clean_search_paths`, in de werkdraad omdat het de schijf aanraakt): alleen een absoluut pad zonder stuurtekens, hooguit 1024 tekens, dat na `canonicalize` een bestaande map is; zonder dubbele, hooguit `xref::MAX_SEARCH_PATHS` (16, nieuw in de crate). Wat afvalt wordt niet gebruikt en de import gaat door; `#[tauri::command] check_cad_search_paths(paths) -> Vec<bool>` zegt het venster welke paden dat zijn. `ImportArgs::search_paths` wordt tijdens het lezen begrensd (`IMPORT_ARGS_TOO_LONG:searchPaths:16`), net als `pens` en `fonts`; het losse argument van `scan_cad_file` en `locate_cad_externals` geeft dezelfde fout. `options_for(args)` is `args.options()` met de gecontroleerde zoekpaden; import en voorbeeld gebruiken die.
  - **Zoeken zonder opnieuw te verkennen.** `scan_cad_file` kent het optionele argument `searchPaths`. Daarnaast: `#[tauri::command] locate_cad_externals(job_id, path, search_paths) -> ExternalsReport { externals, externalsTruncated }`, dat alleen het zoeken herhaalt op de tekening uit het geheugen (af te breken via `cancel_cad_import`). Het venster gebruikt dat als de gebruiker een zoekpad toevoegt of weghaalt: een volledige verkenning zou bij een grote tekening seconden kosten en de lagenkeuze terugzetten. In de crate: `scan::scan_with_paths`, `import::scan_drawing_with_paths(drawing, search_paths, cancel, progress)` en `import::locate_externals(drawing, search_paths, cancel) -> (Vec<ExternalFile>, bool)`; `scan::outside_files` is nu `pub` en krijgt de zoekpaden mee.
  - `ImportLimits` heeft naast de velden hierboven ook `max_search_paths`, `max_pens` en `max_font_rules`.
  - **Export in modelcoördinaten:** de exportschil roept `resolve_model_space` al aan sinds Task 8 (in de werkdraad, vóór PDFium); `NO_MODEL_SPACE` en `MODEL_SPACE_AMBIGUOUS:<n>` komen als vaste tekst bij de webview. De vertaling naar de taal van de gebruiker (`leesExportFout`, `cadExport.noModelSpace`, `cadExport.modelSpaceAmbiguous`) zit in Task 10.
  - De test met de externe verwijzing bouwt de hoofdtekening als kale tekst-DXF (BLOCK met vlag 4 en groep 1): de app-crate hoeft de CAD-bibliotheek daarvoor niet als eigen afhankelijkheid te krijgen.

De bestaande commando's `import_cad_to_pdf` en `cancel_cad_import` blijven ongewijzigd; de nieuwe argumenten komen vanzelf mee omdat `ImportArgs` ze kent. `scan_cad_file` krijgt het optionele argument `searchPaths` en `release_cad_import` ruimt ook de voorbeelden op.

- [x] **Step 1: Falende tests schrijven**

Voeg onderaan `open-pdf-studio/src-tauri/src/cad_import.rs` in `mod tests` toe:

```rust
    #[test]
    fn a_preview_always_runs_in_preview_mode_and_writes_its_own_file() {
        let dir = work_dir("voorbeeld");
        let dxf = sample_dxf(&dir, "plan.dxf", 10000.0);
        let state = CadImportState::default();
        let cancel = AtomicBool::new(false);
        let pdf = dir.join("voorbeeld.pdf");
        let mut args = args(&dxf, &pdf);
        // De aanroeper hoeft "preview" niet te zetten; het commando doet het.
        args.preview = None;
        let result = preview_blocking(&state, &args, &cancel, |_| {}).unwrap();
        assert_eq!(result.pages.len(), 1);
        assert!(pdf.exists());
        assert!(!result.simplified, "kleine tekening blijft volledig");
    }

    #[test]
    fn a_preview_without_an_output_path_is_refused() {
        let state = CadImportState::default();
        let args = ImportArgs { path: "x.dxf".into(), ..Default::default() };
        assert!(preview_blocking(&state, &args, &AtomicBool::new(false), |_| {}).is_err());
    }

    #[test]
    fn the_limits_are_the_ones_from_the_converter() {
        let limits = limits();
        assert_eq!(limits.preview_simple_above, open_pdf_cad::import::PREVIEW_SIMPLE_ABOVE);
        assert_eq!(limits.max_image_pixels, open_pdf_cad::import::image::MAX_IMAGE_PIXELS);
        assert_eq!(limits.max_xref_files, open_pdf_cad::import::xref::MAX_XREF_FILES);
    }

    #[test]
    fn search_paths_and_the_pen_table_reach_the_options() {
        let args: ImportArgs = serde_json::from_str(
            r##"{"path":"a.dxf","outputPath":"a.pdf","lineweight":"pens",
                "pens":[{"color":"#00FF00","lineweightMm":0.5}],
                "searchPaths":["C:/wel","  "],"xrefs":false,"images":false,
                "fonts":[{"from":"romans.shx","family":"mono","bold":true,"italic":false}]}"##,
        )
        .unwrap();
        let options = args.options();
        assert!(!options.xrefs && !options.images);
        assert_eq!(options.search_paths.len(), 1);
        assert_eq!(options.pens.width_mm((0, 255, 0)), Some(0.5));
        assert_eq!(
            options.fonts.choose("romans.shx", ""),
            open_pdf_cad::import::text::FontChoice {
                family: open_pdf_cad::import::text::FontFamily::Mono,
                italic: false,
                bold: true
            }
        );
    }
```

Verwachte uitvoer: `error[E0425]: cannot find function `preview_blocking` in this scope`.

- [x] **Step 2: De schil uitbreiden**

Voeg in `open-pdf-studio/src-tauri/src/cad_import.rs` toe:

```rust
/// Grenzen van de omzetter, zodat het venster dezelfde getallen toont als de
/// crate hanteert.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLimits {
    /// Boven dit aantal entiteiten wordt een voorbeeld vereenvoudigd.
    pub preview_simple_above: u64,
    /// Hoogste aantal beeldpunten per ingesloten afbeelding.
    pub max_image_pixels: u64,
    /// Hoogste aantal externe verwijzingen per import.
    pub max_xref_files: usize,
}

fn limits() -> ImportLimits {
    ImportLimits {
        preview_simple_above: open_pdf_cad::import::PREVIEW_SIMPLE_ABOVE,
        max_image_pixels: open_pdf_cad::import::image::MAX_IMAGE_PIXELS,
        max_xref_files: open_pdf_cad::import::xref::MAX_XREF_FILES,
    }
}

/// Voorbeeldomzetting op de huidige draad. Hetzelfde pad als een echte import,
/// maar altijd in voorbeeldstand: bij een zware tekening vallen arceringen en
/// tekst weg zodat het venster snel iets laat zien.
fn preview_blocking(
    state: &CadImportState,
    args: &ImportArgs,
    cancel: &AtomicBool,
    progress: impl FnMut(ImportProgress),
) -> Result<ImportResult, String> {
    let output = PathBuf::from(&args.output_path);
    if output.as_os_str().is_empty() {
        return Err("Geen uitvoerbestand opgegeven".into());
    }
    let drawing = read_drawing(state, Path::new(&args.path), cancel)?;
    let mut options = args.options();
    options.preview = true;
    open_pdf_cad::import::convert(&drawing, &options, &output, cancel, progress).map_err(|e| e.to_string())
}
```

en de commando's:

```rust
/// Zet de tekening om naar een tijdelijke PDF voor de voorbeeldweergave van
/// het importvenster. Zelfde argumenten als `import_cad_to_pdf`; voortgang
/// komt als event `cad-preview-progress`, zodat een lopend voorbeeld de balk
/// van een echte import niet verstoort.
#[tauri::command]
pub async fn preview_cad_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, CadImportState>,
    job_id: String,
    args: ImportArgs,
) -> Result<ImportResult, String> {
    let cancel = state.cancel_flag(&job_id)?;
    let result = tauri::async_runtime::spawn_blocking({
        let state = state.inner().clone();
        let job_id = job_id.clone();
        let cancel = Arc::clone(&cancel);
        move || {
            let mut throttle = Throttle::new(Duration::from_millis(150));
            preview_blocking(&state, &args, &cancel, |p: ImportProgress| {
                if throttle.should_emit(p.phase, Instant::now()) {
                    let _ = app.emit(
                        "cad-preview-progress",
                        ProgressEvent { job_id: &job_id, phase: p.phase, done: p.done, total: p.total },
                    );
                }
            })
        }
    })
    .await
    .map_err(|e| format!("CAD preview task panicked: {e}"));
    state.done(&job_id);
    result?
}

/// De grenzen die de omzetter hanteert.
#[tauri::command]
pub fn cad_import_limits() -> ImportLimits {
    limits()
}
```

- [x] **Step 3: Aanmelden**

In `open-pdf-studio/src-tauri/src/lib.rs`, bij de `invoke_handler`-lijst, na `cad_import::release_cad_import,`:

```rust
            cad_import::preview_cad_import,
            cad_import::cad_import_limits,
```

- [x] **Step 4: Tests en commit**

App-Rust-tests starten lokaal alleen met een extern comctl32-manifest naast een kopie van het testbinary; volg de bestaande werkwijze voor deze crate.

```
cd open-pdf-studio/src-tauri
CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo test --lib cad_import
```

```
feat(import): commando voor de voorbeeldweergave en de grenzen van de omzetter (#400)
```

---

### Task 10: Nieuwe teksten in alle 39 talen

**Files:**
- Modify: `open-pdf-studio/js/i18n/locales/<taal>/dialogs.json` (39 bestanden)
- Modify: `open-pdf-studio/js/pdf/cad-import-i18n.test.mjs`

**Interfaces:**
- Produces: nieuwe sleutels onder `dialogs.cadImport`.
- **Zoals uitgevoerd wijkt de lijst af van die hieronder.** Latere taken gaan uit van deze sleutels (alle in 39 talen):
  - Kleurstanden (wens van de gebruiker, zie Task 11): `colorsMono`, `colorsSingle`, `monoThreshold`, `monoHint`, `singleColour`, en de melding `warn_lightFillsDropped` (die laatste staat er al sinds de commit met de kleurstanden).
  - Kleurentabel: `lineweightPens`, `penTable`, `penTableHint`, `penAdd`, `penColour`, `penWidth`, `penFromDrawing` (de laagkleuren uit de tekening toevoegen). **Eén sleutel `remove`** vervangt `penRemove` en `searchPathRemove`.
  - Letters: `fontTable`, `fontFrom`, `fontTo`, `fontSans`, `fontMono`, `fontBold`, `fontItalic`. Externe bestanden: `xrefs`, `images`, `xrefsHint`, `searchPaths`, `searchPathAdd`, `searchPathMissing` (een zoekpad dat niet meer bestaat). Geavanceerd: `advanced`, `reuseBlocks`. Fout: `argsTooLong` (`{{max}}`), voor `IMPORT_ARGS_TOO_LONG:<veld>:<grens>`; `leesImportFout` herkent de code ook midden in de melding van de app.
  - Voor Task 12 en 13, ongewijzigd: `preview`, `previewOff`, `previewBusy`, `previewFailed`, `previewSimplified` (`{{n}}`), `previewWindowHint`, `targetUnderlay`, `underlayOpacity`, `underlayBelow`, `underlayDone` (`{{page}}`).
  - Onder `dialogs.cadExport`: `noModelSpace` en `modelSpaceAmbiguous` (`{{n}}`), met `leesExportFout(fout)` in `cad-export-logica.js`; het exportvenster toont er de fouten `NO_MODEL_SPACE` en `MODEL_SPACE_AMBIGUOUS:<n>` mee.
  - **De i18n-test verbiedt dode sleutels.** Wat het venster nog niet gebruikt staat daarom in de lijst `NOG_NIET_IN_HET_VENSTER` in `cad-import-i18n.test.mjs`; de test eist dat een sleutel van die lijst af gaat zodra de code hem gebruikt. Task 11 haalt de sleutels van het tabblad Weergave eraf, Task 12 die van het voorbeeld, Task 13 die van de onderlegger; daarna moet de lijst leeg zijn.
  - De schrifttest voor het Chinees bestond al (`TRADITIONEEL`, over `cadImport` én `cadExport`); de extra test uit Step 3 is daarom niet toegevoegd. De ondergrens van het aantal sleutels is 180.

- [x] **Step 1: De sleutels vaststellen**

Voeg in `js/i18n/locales/en/dialogs.json` onder `cadImport` toe (Engels als bron):

```json
{
  "penTable": "Colour table",
  "penTableHint": "Line width per colour from the drawing; a colour without a rule keeps the width from the file.",
  "penAdd": "Add",
  "penRemove": "Remove",
  "penColour": "Colour",
  "penWidth": "Width (mm)",
  "lineweightPens": "Colour table",
  "fontTable": "Font substitution",
  "fontFrom": "In the drawing",
  "fontTo": "In the PDF",
  "fontSans": "Sans serif",
  "fontMono": "Fixed width",
  "fontBold": "Bold",
  "fontItalic": "Italic",
  "xrefs": "Load external references",
  "xrefsHint": "Only from the folder of the drawing and from search paths you choose.",
  "images": "Embed images",
  "searchPaths": "Search paths",
  "searchPathAdd": "Add folder…",
  "searchPathRemove": "Remove",
  "preview": "Preview",
  "previewOff": "Preview off",
  "previewBusy": "Drawing preview…",
  "previewFailed": "No preview available",
  "previewSimplified": "Preview without hatches and text ({{n}} objects)",
  "previewWindowHint": "Drag in the preview to set the window.",
  "targetUnderlay": "Underlay on the current page",
  "underlayOpacity": "Opacity",
  "underlayBelow": "Below the existing content",
  "underlayDone": "Placed as an underlay on page {{page}}.",
  "warn_previewSimplified": "Preview simplified above {{n}} objects"
}
```

Niet opnieuw toevoegen, die staan er al: `warn_previewSimplified` (sinds Task 7; hij staat hierboven nog in de lijst), `warn_xrefsLoaded`, `warn_xrefsMissing` en `warn_xrefsRefused` (sinds Task 4), `warn_imagesEmbedded`, `warn_imagesMissing` en `warn_imagesRefused` (sinds Task 5), `warn_fontsReplaced` (sinds Task 3) en `warn_viewportCoversPage` (sinds de review van Task 1).

- [x] **Step 2: Vertalen**

Zet dezelfde sleutels in de 38 andere locales, **echt vertaald**. Niet het Engels kopiëren; `zh` in vereenvoudigd Chinees (dus `导入`, niet `匯入`). Let op de tijdelijke aanduidingen: `{{n}}` en `{{page}}` moeten in elke taal precies één keer voorkomen waar ze in het Engels staan.

Woorden die in een taal werkelijk gelijk zijn aan het Engels (bijvoorbeeld "Preview" in het Nederlands is dat níét — daar staat "Voorbeeld"), komen in de lijst `SAME_AS_ENGLISH` in de i18n-test.

- [x] **Step 3: De test aanscherpen**

In `js/pdf/cad-import-i18n.test.mjs`:

- verhoog de ondergrens `assert.ok(Object.keys(en).length >= 100);` naar `>= 160`;
- vul `SAME_AS_ENGLISH` aan voor de talen waar een nieuwe term echt gelijk is;
- voeg een test toe die bewaakt dat de Chinese teksten in vereenvoudigd schrift staan:

```javascript
test("the Chinese import texts are in simplified characters", () => {
  const zh = block("zh");
  // Traditionele vormen die bij deze woordenschat horen; komen ze voor, dan is
  // de tekst niet vereenvoudigd.
  const traditional = /[匯導線條圖層顏預覽參數選擇檔]/u;
  for (const [key, text] of Object.entries(zh)) {
    assert.ok(!traditional.test(text), `zh cadImport.${key}: ${text}`);
  }
});
```

- [x] **Step 4: Draaien en committen**

```
cd open-pdf-studio && npm run test:unit
```

```
i18n(import): teksten voor kleurentabel, letters, verwijzingen, voorbeeld en onderlegger in 39 talen (#400)
```

---

### Task 11: Venster — tabblad Weergave uitgebreid

**Files:**
- Modify: `open-pdf-studio/js/solid/stores/cad-import-instellingen.js`
- Modify: `open-pdf-studio/js/pdf/cad-import-logica.js`
- Modify: `open-pdf-studio/js/solid/components/dialogs/CadImportDialog.jsx`
- Modify: `open-pdf-studio/styles/dialogs.css`
- Modify: `open-pdf-studio/js/pdf/cad-import.test.mjs`

**Interfaces:**
- Consumes: `cadImport.*` uit Task 10; `ImportArgs`-velden uit Task 2 tot en met 7.
- Produces in `cad-import-instellingen.js`: `CAD_IMPORT_STANDAARD` krijgt
  `lineweight` met de extra keuze `'pens'`, `pens: []`, `fonts: []`, `xrefs: true`,
  `images: true`, `searchPaths: []`, `target` met de extra keuze `'underlay'`,
  `underlayOpacity: 50`, `underlayBelow: true`, `preview: true`.
- Produces in `cad-import-logica.js`:
  - `export function schoonPennen(lijst)` → `{color, lineweightMm}[]`, hoogstens 64, kleuren als `#RRGGBB`
  - `export function schoonLetters(lijst)` → `{from, family, bold, italic}[]`, hoogstens 64
  - `export function schoonZoekpaden(lijst)` → `string[]`, hoogstens 16
  - `export function lettersVanScan(scan)` → `{from, family, bold, italic}[]` — beginwaarden uit de lettertypen van het bestand
  - `importArgumenten` stuurt de nieuwe velden mee.
- **Al aanwezig sinds de review- en testronde** (niet opnieuw maken, wel op aansluiten):
  - `export function buitenBestanden(lijst, afgekapt)` → `{sleutel, namen}[]` met de sleutels `externalsFound`, `externalsUsed`, `externalsMissing` en `externalsRefused` (alle vier in 39 talen). Het venster toont ze onder de meldingen: vóór de import uit `scan.externals`, erna uit het importverslag. **Deze taak** zet dezelfde regels ook op het tabblad Weergave bij de schakelaars voor externe verwijzingen en afbeeldingen, en verkent opnieuw (met `search_paths`, zie Task 9) zodra de gebruiker een zoekpad toevoegt of weghaalt, zodat de lijst "gevonden / niet gevonden" bij de gekozen mappen hoort.
  - Papier van een layout: `LAYOUT_PAPIER_STANDAARD`, `papierInstellingen(inst, isModel, layoutKeuze)`, `layoutPagina(keuze, layoutPapier, inhoudMm)`, `modelInhoudOpPapier`, `papierTeKlein` (tekst `paperTooSmall`) en `papierSamenvatting`. Het onthouden papier (`inst.paper`) geldt alleen voor de modelruimte; een layout heeft een eigen, niet onthouden keuze die bij elke layout op "van de layout" begint. Voorinstellingen (Task 14) bewaren dus alleen het papier van de modelruimte.
  - `eenheidMelding(units, gekozen)` beslist de tekst naast het veld voor de eenheid (`noUnits` of `warn_unitsUnsupported`).
  - `.cad-select-short` is zo breed als zijn langste keuze (90 tot 210 px, beletselteken, volledige tekst in `title`): geef elke nieuwe korte keuzelijst ook een `title`. Een uitgeschakelde `.pref-btn` in het venster heeft halve dekking; de huisregeltest verbiedt een `cursor`-regel in de CAD-stijlen.
- **Zoals uitgevoerd wijkt de taak af van de code hieronder.** Latere taken (12 tot en met 16) gaan uit van deze vorm:
  - **Eigen bestand voor het tabblad.** De nieuwe onderdelen staan in `js/solid/components/dialogs/CadImportWeergave.jsx` (`CadKleurstand`, `CadKleurentabel`, `CadLettertabel`, `CadBuitenBestanden`, `CadGeavanceerd`; elk krijgt `inst` en `setInst`). `cad-import-i18n.test.mjs` leest de sleutels en de huisregels uit de lijst `VENSTER`; een taak die het venster met nog een bestand uitbreidt (Task 12: `CadImportPreview.jsx`) zet dat bestand in die lijst. De sleutels van het tabblad Weergave zijn van `NOG_NIET_IN_HET_VENSTER` af; er staan alleen nog die van het voorbeeld en de onderlegger.
  - **Instellingen (`CAD_IMPORT_STANDAARD`).** Erbij: `colors` met `'mono'` en `'single'`, `monoThreshold: 50` (heel getal, 0 tot 100), `singleColor: '#000000'`, `lineweight` met `'pens'`, `pens`, `fonts`, `xrefs`, `images`, `searchPaths`, `reuseBlocks: true`, `maxImageMegapixels: 200` (heel getal, 1 tot 200). De lijsten in de standaard zijn bevroren; `herstelCadImportInstellingen` geeft altijd verse lijsten. **Niet** in deze taak: `target: 'underlay'`, `underlayOpacity`, `underlayBelow` (Task 13) en `preview` (Task 12): een instelling komt in de opslag in dezelfde commit als het veld dat haar zet, zodat er geen waarde onthouden wordt waar het venster niets mee doet. Bij het importeren gaan de instellingen gecontroleerd de voorkeuren in.
  - **Pure regels in `cad-import-logica.js`** (alle met een optionele grens `max`, waarvan nooit meer dan de eigen grens telt): `MAX_PENNEN = 256`, `MAX_LETTERS = 256`, `MAX_ZOEKPADEN = 16`, `MAX_PENDIKTE_MM = 5`, `PENDIKTE_STANDAARD_MM = 0.25`, `MAX_MEGAPIXELS = 200`, `MONO_DREMPEL_STANDAARD = 50`; `kleurTekst`, `pendikte`, `schoonPennen(lijst, max)` (dubbele kleur: de laatste regel telt, zoals in de omzetter), `pennenUitLagen(pennen, lagen, max)`, `metNieuwePen(pennen, voorkeur, max)`, `metPenKleur(pennen, index, kleur)` (`null` als de kleur al een regel heeft), `raadLetter(naam)` (gelijk aan `FontMap::guess`, getest tegen de namen uit de test van de omzetter), `schoonLetters(lijst, max)`, `lettersVanScan(scan)` geeft **namen** (`string[]`), `lettersVoorTekening(scan, regels)` geeft de rijen van de tabel met `eigen`, `metLetterRegel(regels, regel, max)`, `schoonZoekpaden(lijst, max)`, `drempelProcent`, `beeldpuntenGrens(megapixels, plafond)`. Een test leest de grenzen uit de bron van de omzetter (`MAX_PENS`, `MAX_FONT_RULES`, `MAX_SEARCH_PATHS`, `MAX_IMAGE_PIXELS`, `DEFAULT_MONO_THRESHOLD_PCT`).
  - **De lettertabel onthoudt alleen afwijkingen.** `inst.fonts` bevat de regels die de gebruiker zelf gezet heeft (ook voor letters van andere tekeningen); het venster toont de letters van deze tekening met de onthouden keuze of anders met wat de omzetter raadt. Een keuze die gelijk is aan het raden valt uit de tabel. De verkenning schrijft dus niets in `inst.fonts` (anders dan punt 5 van Step 4 hieronder).
  - **De omzetter kent twee letterfamilies** (`sans`, `mono`); een schreefletter vraagt een eigen breedtetabel in de crate (Task 3) en is er niet. Het venster biedt dus schreefloos en vaste breedte, elk met vet en cursief.
  - **`importArgumenten(inst, o)`** kent `o.limits` (het antwoord van `cad_import_limits`) en stuurt: `pens` alleen in de stand `pens`, `fonts`, `xrefs`, `images`, `searchPaths`, `reuseBlocks`, `monoThreshold` alleen bij `mono`, `singleColor` alleen bij `single`, `maxImagePixels` alleen als het veld onder de grens van de omzetter staat.
  - **In `cad-import.js`:** `verkenTekening(jobId, pad, zoekpaden)`, `zoekBuitenBestanden(jobId, pad, zoekpaden)` (`locate_cad_externals`), `controleerZoekpaden(zoekpaden)` (`check_cad_search_paths`), `importGrenzen()` (`cad_import_limits`, `null` buiten de app) en `kiesZoekpad(titel)` (via `openFolderDialog` uit `core/platform.js`). Het venster houdt de grenzen in het signaal `grenzen` (gevuld in `onMount`).
  - **Zoekpaden wijzigen verkent niet opnieuw** maar herhaalt alleen het zoeken (`zoekBuitenBestanden`), zoals Task 9 het voorbereid heeft: de lagenkeuze blijft staan. De uitkomst staat in het signaal `gezocht` en wint in `buiten()` van de lijst uit de verkenning; een zoekopdracht die nog loopt wordt afgebroken zodra de lijst weer verandert, en bij het sluiten. De verkenning zelf krijgt de zoekpaden ook mee.
  - **Kleur kiezen** gaat zoals in de andere vensters met het kleurvak van het systeem (`input type="color"`), hier met de code `#RRGGBB` ernaast; de uitklapkiezer van de voorkeuren heeft afgeronde hoeken, een eigen cursor en vaste Engelse teksten en past niet binnen de huisregels van dit venster.
  - Eén nieuwe tekst: `cadImport.maxImagePixels` (39 talen). `cadImport.fonts` blijft in gebruik als `title` op de kop van de lettertabel.
  - Het tabblad schuift zelf (`.cad-tab-scroll`, 330 px hoog), zodat het venster niet hoger wordt dan bij de andere tabbladen; de tabellen hebben een eigen hoogte (`.cad-sublist`).

- [x] **Step 1: Falende tests schrijven**

In `js/pdf/cad-import.test.mjs`:

```javascript
test("the colour table, the font table and the search paths are cleaned up", () => {
  assert.deepEqual(
    schoonPennen([
      { color: "#ff0000", lineweightMm: 0.35 },
      { color: "00FF00", lineweightMm: "0.5" },
      { color: "rood", lineweightMm: 1 },
      { color: "#0000FF", lineweightMm: -1 },
      { color: "#0000FF", lineweightMm: 99 },
    ]),
    [
      { color: "#FF0000", lineweightMm: 0.35 },
      { color: "#00FF00", lineweightMm: 0.5 },
    ],
  );
  assert.equal(schoonPennen(Array.from({ length: 200 }, (_, i) => ({ color: `#0000${String(i % 100).padStart(2, "0")}`, lineweightMm: 0.2 }))).length, 64);
  assert.deepEqual(
    schoonLetters([
      { from: " romans.shx ", family: "mono", bold: true, italic: "ja" },
      { from: "", family: "sans" },
      { from: "arial.ttf", family: "onbekend" },
    ]),
    [
      { from: "romans.shx", family: "mono", bold: true, italic: false },
      { from: "arial.ttf", family: "sans", bold: false, italic: false },
    ],
  );
  assert.deepEqual(schoonZoekpaden(["C:/een", "  ", "C:/een", "C:/twee"]), ["C:/een", "C:/twee"]);
});

test("the font table starts from the fonts in the drawing", () => {
  const scan = {
    fonts: [
      { style: "Standard", font: "txt" },
      { style: "Kop", font: "arialbd.ttf" },
      { style: "Vast", font: "consola.ttf" },
      { style: "Nog een", font: "txt" },
    ],
  };
  assert.deepEqual(lettersVanScan(scan), [
    { from: "txt", family: "sans", bold: false, italic: false },
    { from: "arialbd.ttf", family: "sans", bold: true, italic: false },
    { from: "consola.ttf", family: "mono", bold: false, italic: false },
  ]);
  assert.deepEqual(lettersVanScan(null), []);
});

test("the new display settings reach the converter arguments", () => {
  const inst = {
    ...CAD_IMPORT_STANDAARD,
    lineweight: "pens",
    pens: [{ color: "#FF0000", lineweightMm: 0.35 }],
    fonts: [{ from: "romans.shx", family: "mono", bold: false, italic: false }],
    xrefs: false,
    images: false,
    searchPaths: ["C:/verwijzingen"],
  };
  const args = importArgumenten(inst, { path: "a.dwg", outputPath: "a.pdf", spaces: ["model"] });
  assert.equal(args.lineweight, "pens");
  assert.deepEqual(args.pens, [{ color: "#FF0000", lineweightMm: 0.35 }]);
  assert.deepEqual(args.fonts, [{ from: "romans.shx", family: "mono", bold: false, italic: false }]);
  assert.equal(args.xrefs, false);
  assert.equal(args.images, false);
  assert.deepEqual(args.searchPaths, ["C:/verwijzingen"]);
});

test("remembered settings survive nonsense in the preferences", () => {
  const s = herstelCadImportInstellingen({
    lineweight: "pens",
    target: "underlay",
    underlayOpacity: 500,
    underlayBelow: "nee",
    pens: "geen lijst",
    fonts: [{ from: "x", family: "mono" }],
    searchPaths: ["C:/een", 5],
    preview: false,
  });
  assert.equal(s.lineweight, "pens");
  assert.equal(s.target, "underlay");
  assert.equal(s.underlayOpacity, 100, "wordt naar het bereik getrokken");
  assert.equal(s.underlayBelow, CAD_IMPORT_STANDAARD.underlayBelow, "geen booleaan: standaard");
  assert.deepEqual(s.pens, []);
  assert.deepEqual(s.fonts, [{ from: "x", family: "mono", bold: false, italic: false }]);
  assert.deepEqual(s.searchPaths, ["C:/een"]);
  assert.equal(s.preview, false);
});
```

Vul de `import`-regels bovenaan het testbestand aan met `schoonPennen`, `schoonLetters`, `schoonZoekpaden` en `lettersVanScan`.

- [x] **Step 2: De instellingen uitbreiden**

In `js/solid/stores/cad-import-instellingen.js`:

```javascript
export const CAD_IMPORT_STANDAARD = Object.freeze({
  target: 'new',
  layersAsOcg: true,
  includeOffLayers: false,
  skipNonPlottable: true,
  units: 'file',
  area: 'extents',
  scale: 0,
  paper: 'auto',
  paperWidthMm: 297,
  paperHeightMm: 420,
  orientation: 'auto',
  marginMm: 10,
  placement: 'center',
  ownBasePoint: false,
  basePointX: 0,
  basePointY: 0,
  rotation: 0,
  measure: true,
  modelMatrix: true,
  colors: 'file',
  lineweight: 'file',
  lineweightMm: 0.25,
  lineweightFactor: 1,
  lineweightMinMm: 0,
  linetypes: true,
  text: true,
  hatch: 'all',
  dimensions: true,
  attributes: true,
  points: false,
  // Fase 6.
  pens: [],
  fonts: [],
  xrefs: true,
  images: true,
  searchPaths: [],
  preview: true,
  underlayOpacity: 50,
  underlayBelow: true,
});
```

```javascript
const KEUZES = Object.freeze({
  target: ['new', 'append', 'underlay'],
  units: ['file', 'mm', 'cm', 'm', 'in', 'ft'],
  area: ['extents', 'limits', 'window'],
  paper: ['auto', 'A4', 'A3', 'A3L', 'A2', 'A2L', 'A1', 'A1L', 'A0', 'Letter', 'Tabloid', 'custom'],
  orientation: ['auto', 'portrait', 'landscape'],
  placement: ['center', 'lower_left', 'origin'],
  colors: ['file', 'black', 'gray'],
  lineweight: ['file', 'fixed', 'pens'],
  hatch: ['all', 'solid_only', 'outline', 'none'],
});

const SCHAKELAARS = [
  'layersAsOcg', 'includeOffLayers', 'skipNonPlottable', 'measure', 'modelMatrix', 'linetypes', 'text',
  'dimensions', 'attributes', 'points', 'ownBasePoint', 'xrefs', 'images', 'preview', 'underlayBelow',
];

const GETALLEN = Object.freeze({
  scale: [0, 1e6],
  basePointX: [-1e12, 1e12],
  basePointY: [-1e12, 1e12],
  paperWidthMm: [1, 5080],
  paperHeightMm: [1, 5080],
  marginMm: [0, 200],
  rotation: [-360, 360],
  lineweightMm: [0, 5],
  lineweightFactor: [0.1, 10],
  lineweightMinMm: [0, 5],
  underlayOpacity: [5, 100],
});
```

en in `herstelCadImportInstellingen`, ná de bestaande lussen:

```javascript
  // Lijsten: schoongemaakt door de pure regels, zodat een kapot
  // voorkeurenbestand het venster nooit kan breken.
  s.pens = schoonPennen(o.pens);
  s.fonts = schoonLetters(o.fonts);
  s.searchPaths = schoonZoekpaden(o.searchPaths);
  return s;
```

met bovenaan het bestand:

```javascript
import { schoonLetters, schoonPennen, schoonZoekpaden } from '../../pdf/cad-import-logica.js';
```

- [x] **Step 3: De pure regels**

In `js/pdf/cad-import-logica.js`:

```javascript
/** Hoogste aantal regels in de kleuren- en lettertabel, en aantal zoekpaden. */
export const MAX_PENNEN = 64;
export const MAX_LETTERS = 64;
export const MAX_ZOEKPADEN = 16;

/** `#RRGGBB` uit wat de gebruiker intypt, of null. */
export function kleurTekst(waarde) {
  const tekst = String(waarde || '').trim();
  const hex = tekst.startsWith('#') ? tekst.slice(1) : tekst;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/**
 * Maakt de kleurentabel schoon: alleen geldige kleuren, diktes tussen 0 en 5
 * mm, geen dubbele kleuren, hoogstens MAX_PENNEN regels.
 * @returns {{color:string, lineweightMm:number}[]}
 */
export function schoonPennen(lijst) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  for (const regel of lijst) {
    const color = kleurTekst(regel?.color);
    const mm = Number(regel?.lineweightMm);
    if (!color || !Number.isFinite(mm) || mm < 0 || mm > 5) continue;
    if (uit.some((p) => p.color === color)) continue;
    uit.push({ color, lineweightMm: mm });
    if (uit.length >= MAX_PENNEN) break;
  }
  return uit;
}

/**
 * Maakt de lettertabel schoon: een naam uit de tekening en een familie die we
 * kennen.
 * @returns {{from:string, family:string, bold:boolean, italic:boolean}[]}
 */
export function schoonLetters(lijst) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  for (const regel of lijst) {
    const from = String(regel?.from || '').trim();
    if (!from) continue;
    if (uit.some((f) => f.from.toLowerCase() === from.toLowerCase())) continue;
    uit.push({
      from,
      family: regel?.family === 'mono' ? 'mono' : 'sans',
      bold: regel?.bold === true,
      italic: regel?.italic === true,
    });
    if (uit.length >= MAX_LETTERS) break;
  }
  return uit;
}

/** Zoekpaden: tekst, niet leeg, geen dubbele, hoogstens MAX_ZOEKPADEN. */
export function schoonZoekpaden(lijst) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  for (const pad of lijst) {
    if (typeof pad !== 'string') continue;
    const schoon = pad.trim();
    if (!schoon || uit.includes(schoon)) continue;
    uit.push(schoon);
    if (uit.length >= MAX_ZOEKPADEN) break;
  }
  return uit;
}

/**
 * Beginwaarden voor de lettertabel: elke letter die in de tekening voorkomt,
 * één keer, met de soort die uit de naam te raden is. Dezelfde regel als de
 * omzetter (`FontMap::guess`).
 */
export function lettersVanScan(scan) {
  const uit = [];
  for (const item of scan?.fonts || []) {
    const from = String(item?.font || '').trim();
    if (!from || uit.some((f) => f.from.toLowerCase() === from.toLowerCase())) continue;
    const stem = from.toLowerCase().split(/[\\/]/).pop();
    uit.push({
      from,
      family: /mono|courier|consol/.test(stem) ? 'mono' : 'sans',
      bold: /bold|black|heavy/.test(stem),
      italic: /italic|oblique/.test(stem),
    });
    if (uit.length >= MAX_LETTERS) break;
  }
  return uit;
}
```

En in `importArgumenten`, ná `lineweightMinMm: inst.lineweightMinMm,`:

```javascript
    pens: schoonPennen(inst.pens),
    fonts: schoonLetters(inst.fonts),
    xrefs: inst.xrefs !== false,
    images: inst.images !== false,
    searchPaths: schoonZoekpaden(inst.searchPaths),
```

- [x] **Step 4: Het tabblad Weergave**

In `CadImportDialog.jsx`, in het paneel `cad-panel-view`:

1. De keuzelijst voor de lijndikte krijgt de derde stand:

```jsx
            <select class="cad-select cad-select-short" value={inst.lineweight} onChange={(e) => setInst('lineweight', e.target.value)}>
              <option value="file">{t('cadImport.lineweightFile')}</option>
              <option value="fixed">{t('cadImport.lineweightFixed')}</option>
              <option value="pens">{t('cadImport.lineweightPens')}</option>
            </select>
```

2. Onder de dikte-rijen de kleurentabel:

```jsx
          <Show when={inst.lineweight === 'pens'}>
            <div class="cad-row cad-row-top">
              <label class="cad-label">{t('cadImport.penTable')}</label>
              <div class="cad-subtable">
                <For each={inst.pens}>
                  {(pen, index) => (
                    <div class="cad-subrow">
                      <input
                        type="color"
                        class="cad-color"
                        aria-label={t('cadImport.penColour')}
                        value={pen.color}
                        onInput={(e) => setInst('pens', index(), 'color', kleurTekst(e.target.value) || '#000000')}
                      />
                      <input
                        type="number" class="cad-input cad-input-short" step="0.05" min="0" max="5"
                        aria-label={t('cadImport.penWidth')}
                        value={pen.lineweightMm}
                        onChange={(e) => setInst('pens', index(), 'lineweightMm', Math.min(5, Math.max(0, Number(e.target.value) || 0)))}
                      />
                      <span class="cad-note">mm</span>
                      <button class="pref-btn cad-small-btn" onClick={() => setInst('pens', (p) => p.filter((_, i) => i !== index()))}>
                        {t('cadImport.penRemove')}
                      </button>
                    </div>
                  )}
                </For>
                <div class="cad-subrow">
                  <button
                    class="pref-btn cad-small-btn"
                    disabled={inst.pens.length >= MAX_PENNEN}
                    onClick={() => setInst('pens', (p) => [...p, { color: '#000000', lineweightMm: 0.25 }])}
                  >{t('cadImport.penAdd')}</button>
                  <span class="cad-note">{t('cadImport.penTableHint')}</span>
                </div>
              </div>
            </div>
          </Show>
```

3. De lettertabel in plaats van de losse mededeling. De sleutel `cadImport.fonts` blijft bestaan (alle 39 locales houden hem) en wordt nu de toelichting boven de tabel, als `title` op de kop:

```jsx
          <Show when={inst.fonts.length}>
            <div class="cad-row cad-row-top">
              <label class="cad-label">{t('cadImport.fontTable')}</label>
              <div class="cad-subtable">
                <div class="cad-subrow cad-subhead">
                  <span class="cad-col-font">{t('cadImport.fontFrom')}</span>
                  <span class="cad-col-font">{t('cadImport.fontTo')}</span>
                </div>
                <For each={inst.fonts}>
                  {(regel, index) => (
                    <div class="cad-subrow">
                      <span class="cad-col-font" title={regel.from}>{regel.from}</span>
                      <select
                        class="cad-select cad-select-short"
                        aria-label={`${regel.from} — ${t('cadImport.fontTo')}`}
                        value={regel.family}
                        onChange={(e) => setInst('fonts', index(), 'family', e.target.value)}
                      >
                        <option value="sans">{t('cadImport.fontSans')}</option>
                        <option value="mono">{t('cadImport.fontMono')}</option>
                      </select>
                      <label class="cad-check">
                        <input type="checkbox" checked={regel.bold} onChange={(e) => setInst('fonts', index(), 'bold', e.target.checked)} />
                        {t('cadImport.fontBold')}
                      </label>
                      <label class="cad-check">
                        <input type="checkbox" checked={regel.italic} onChange={(e) => setInst('fonts', index(), 'italic', e.target.checked)} />
                        {t('cadImport.fontItalic')}
                      </label>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
```

4. Verwijzingen, afbeeldingen en zoekpaden:

```jsx
          <label class="cad-check">
            <input type="checkbox" checked={inst.xrefs} onChange={(e) => setInst('xrefs', e.target.checked)} /> {t('cadImport.xrefs')}
          </label>
          <label class="cad-check">
            <input type="checkbox" checked={inst.images} onChange={(e) => setInst('images', e.target.checked)} /> {t('cadImport.images')}
          </label>
          <div class="cad-row cad-row-top">
            <label class="cad-label">{t('cadImport.searchPaths')}</label>
            <div class="cad-subtable">
              <For each={inst.searchPaths}>
                {(pad, index) => (
                  <div class="cad-subrow">
                    <span class="cad-path" title={pad}>{pad}</span>
                    <button class="pref-btn cad-small-btn" onClick={() => setInst('searchPaths', (l) => l.filter((_, i) => i !== index()))}>
                      {t('cadImport.searchPathRemove')}
                    </button>
                  </div>
                )}
              </For>
              <div class="cad-subrow">
                <button class="pref-btn cad-small-btn" disabled={bezig()} onClick={async () => {
                  const map = await kiesZoekpad();
                  if (map) setInst('searchPaths', (l) => schoonZoekpaden([...l, map]));
                }}>{t('cadImport.searchPathAdd')}</button>
                <span class="cad-note">{t('cadImport.xrefsHint')}</span>
              </div>
            </div>
          </div>
```

5. Beginwaarde van de lettertabel bij het verkennen: in `verken()`, ná `setScan(uitkomst);`:

```javascript
      // De letters komen uit het bestand en winnen van wat onthouden is; een
      // onthouden keuze voor dezelfde naam blijft wel staan.
      const uitBestand = lettersVanScan(uitkomst);
      const onthouden = new Map((inst.fonts || []).map((f) => [f.from.toLowerCase(), f]));
      setInst('fonts', uitBestand.map((f) => onthouden.get(f.from.toLowerCase()) || f));
```

6. Vul de `import`-regels aan met `kleurTekst`, `lettersVanScan`, `schoonZoekpaden`, `MAX_PENNEN` uit `cad-import-logica.js` en `kiesZoekpad` uit `cad-import.js`.

In `js/pdf/cad-import.js`:

```javascript
/** Laat de gebruiker een map kiezen om verwijzingen en afbeeldingen te zoeken. */
export async function kiesZoekpad() {
  const dialoog = window.__TAURI__?.dialog;
  if (!dialoog?.open) return null;
  const gekozen = await dialoog.open({ directory: true, multiple: false });
  return typeof gekozen === 'string' ? gekozen : null;
}
```

- [x] **Step 5: Opmaak**

In `styles/dialogs.css`, bij het CAD-blok:

```css
.cad-row-top { align-items: flex-start; }
.cad-subtable { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.cad-subrow { display: flex; align-items: center; gap: 6px; }
.cad-subhead { font-weight: 600; color: var(--theme-text-dim, #666); }
.cad-col-font { width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cad-color { width: 34px; height: 22px; padding: 0; border: 1px solid #d4d4d4; border-radius: 0; background: none; }
.cad-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
```

Rechte hoeken, geen animaties, geen eigen cursor: net als de rest van het venster.

- [x] **Step 6: Draaien en committen**

```
cd open-pdf-studio && npm run test:unit && npx vite build
```

```
feat(import): kleurentabel, lettervervanging, verwijzingen en afbeeldingen in het tabblad Weergave (#400)
```

---

### Task 12: Venster — voorbeeldweergave

De voorbeeldweergave draait de echte omzetter naar een tijdelijke PDF en toont die via de bestaande PDFium-route (`render_pdf_page_region`): wat je ziet is wat je krijgt, en er is geen tweede tekenaar. Vertraagd (300 ms na de laatste wijziging), af te breken, en slepen in het beeld zet het venster.

**Files:**
- Create: `open-pdf-studio/js/pdf/cad-import-voorbeeld.js`
- Create: `open-pdf-studio/js/solid/components/dialogs/CadImportPreview.jsx`
- Modify: `open-pdf-studio/js/pdf/cad-import.js`
- Modify: `open-pdf-studio/js/solid/components/dialogs/CadImportDialog.jsx`
- Modify: `open-pdf-studio/styles/dialogs.css`
- Modify: `open-pdf-studio/js/pdf/cad-import.test.mjs`

**Interfaces:**
- Consumes: `preview_cad_import` en `discard_cad_preview` (Task 9), `render_pdf_page_region`, `importArgumenten`. **Let op (zoals Task 9 is uitgevoerd):** het voorbeeld kiest zelf zijn bestand in de cachemap van de app; geef dus géén `outputPath` mee (hij wordt genegeerd) en gebruik `tijdelijkPdfPad`/`ruimOp` hier niet. Het pad staat in `verslag.outputPath`; een voorbeeld dat vervangen is gaat weg met `gooiVoorbeeldWeg(pad)` (`invoke('discard_cad_preview', { path })`), en `release_cad_import` ruimt bij het sluiten de rest op. De codeblokken hieronder tonen nog de eerste vorm met `tijdelijkPdfPad`. Voortgang komt als event `cad-preview-progress`, afbreken gaat met `annuleerImport(jobId)`.
- Produces in `js/pdf/cad-import-voorbeeld.js` (puur, zonder app-imports, dus onder node te testen):
  - `export function maakVertrager(ms)` → `{ plan(fn), stop() }`
  - `export function voorbeeldMaat(paginaMm, vakPx, maxPx = 1400)` → `{ breedte, hoogte, pixelsPerMm }`
  - `export function vensterUitVoorbeeld(rect, pagina, mmPerEenheid, pixelsPerMm)` → `{x0,y0,x1,y1} | null`
  - `export function voorbeeldSleutel(args)` → `string` — alles wat het beeld bepaalt, zodat een wijziging die niets verandert geen nieuwe omzetting start
- Produces in `js/pdf/cad-import.js`:
  - `export function voorbeeldTekening(jobId, args)` → `invoke('preview_cad_import', { jobId, args })`
  - `export async function tekenPdfNaarBitmap(pad, breedtePt, hoogtePt, schaal)` → `ImageBitmap | null`
  - `cadImportGrenzen()` hoeft niet meer: sinds Task 11 bestaat `importGrenzen()` en heeft het venster het antwoord in het signaal `grenzen` (`grenzen()?.previewSimpleAbove`). Waar de code hieronder `cadImportGrenzen` noemt, is dat `importGrenzen`/`grenzen`.
  - Sinds Task 11: de instelling `preview: true` komt in **deze** taak in `CAD_IMPORT_STANDAARD` en bij de schakelaars; `CadImportPreview.jsx` komt in de lijst `VENSTER` van `cad-import-i18n.test.mjs`; de argumenten voor het voorbeeld krijgen `limits: grenzen()` mee, net als de import.
- Produces: `CadImportPreview.jsx` met `props`: `{ pad, args, actief, mmPerEenheid, onVenster, onMelding }`.

- [ ] **Step 1: Falende tests schrijven**

In `js/pdf/cad-import.test.mjs`:

```javascript
import { maakVertrager, voorbeeldMaat, vensterUitVoorbeeld, voorbeeldSleutel } from "./cad-import-voorbeeld.js";

test("the delay runs only the last plan", async () => {
  const vertrager = maakVertrager(10);
  const gedaan = [];
  vertrager.plan(() => gedaan.push("een"));
  vertrager.plan(() => gedaan.push("twee"));
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(gedaan, ["twee"]);
  vertrager.plan(() => gedaan.push("drie"));
  vertrager.stop();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(gedaan, ["twee"], "gestopt: niets meer");
});

test("the preview fits the page in the pane without going over the pixel limit", () => {
  const maat = voorbeeldMaat({ breedte: 841, hoogte: 1189 }, { breedte: 260, hoogte: 360 });
  assert.ok(maat.breedte <= 260 && maat.hoogte <= 360);
  assert.ok(Math.abs(maat.breedte / maat.hoogte - 841 / 1189) < 1e-6, "verhouding blijft");
  assert.ok(maat.pixelsPerMm > 0);
  // Een heel groot paneel wordt afgetopt.
  const groot = voorbeeldMaat({ breedte: 841, hoogte: 1189 }, { breedte: 100000, hoogte: 100000 }, 1400);
  assert.ok(Math.max(groot.breedte, groot.hoogte) <= 1400);
  assert.equal(voorbeeldMaat(null, { breedte: 10, hoogte: 10 }), null);
});

test("dragging in the preview gives a window in drawing units", () => {
  // Pagina van 100 x 100 mm op 1:10, de tekening begint op (1000, 2000).
  const pagina = { widthMm: 100, heightMm: 100, scale: 10, offset: [1000, 2000] };
  const venster = vensterUitVoorbeeld({ x: 10, y: 10, breedte: 20, hoogte: 20 }, pagina, 1, 2);
  // 2 pixels per mm: 10 px = 5 mm papier = 50 mm tekening.
  assert.deepEqual(venster, { x0: 1050, y0: 2450, x1: 1150, y1: 2550 });
  assert.equal(vensterUitVoorbeeld({ x: 0, y: 0, breedte: 0, hoogte: 5 }, pagina, 1, 2), null, "te klein");
  assert.equal(vensterUitVoorbeeld({ x: 0, y: 0, breedte: 5, hoogte: 5 }, null, 1, 2), null);
});

test("the preview key changes only when the picture would change", () => {
  const a = { path: "a.dwg", outputPath: "x.pdf", spaces: ["model"], scale: 100 };
  const b = { ...a, outputPath: "y.pdf" };
  const c = { ...a, scale: 50 };
  assert.equal(voorbeeldSleutel(a), voorbeeldSleutel(b), "het doelbestand telt niet mee");
  assert.notEqual(voorbeeldSleutel(a), voorbeeldSleutel(c));
});
```

- [ ] **Step 2: `cad-import-voorbeeld.js` schrijven**

```javascript
// Rekenregels van de voorbeeldweergave van het importvenster (#400).
//
// Geen imports uit de app: de unit-tests draaien hier onder node op.

/** Wachttijd na de laatste wijziging voordat het voorbeeld opnieuw loopt. */
export const VOORBEELD_VERTRAGING_MS = 300;

/** Grootste zijde van het voorbeeld in beeldpunten. */
export const VOORBEELD_MAX_PIXELS = 1400;

/**
 * Voert alleen het laatste plan uit, `ms` nadat het binnenkwam.
 * @returns {{plan: (fn: Function) => void, stop: () => void}}
 */
export function maakVertrager(ms = VOORBEELD_VERTRAGING_MS) {
  let teller = null;
  return {
    plan(fn) {
      if (teller) clearTimeout(teller);
      teller = setTimeout(() => {
        teller = null;
        fn();
      }, ms);
    },
    stop() {
      if (teller) clearTimeout(teller);
      teller = null;
    },
  };
}

/**
 * Maat van het voorbeeld: de pagina passend in het paneel, met een bovengrens
 * aan het aantal beeldpunten.
 * @param {{breedte:number, hoogte:number}|null} paginaMm
 * @param {{breedte:number, hoogte:number}} vakPx
 * @returns {{breedte:number, hoogte:number, pixelsPerMm:number}|null}
 */
export function voorbeeldMaat(paginaMm, vakPx, maxPx = VOORBEELD_MAX_PIXELS) {
  const pb = Number(paginaMm?.breedte);
  const ph = Number(paginaMm?.hoogte);
  if (!(pb > 0) || !(ph > 0)) return null;
  const vb = Math.max(1, Number(vakPx?.breedte) || 1);
  const vh = Math.max(1, Number(vakPx?.hoogte) || 1);
  let pixelsPerMm = Math.min(vb / pb, vh / ph);
  pixelsPerMm = Math.min(pixelsPerMm, maxPx / Math.max(pb, ph));
  if (!(pixelsPerMm > 0) || !Number.isFinite(pixelsPerMm)) return null;
  return { breedte: Math.max(1, Math.round(pb * pixelsPerMm)), hoogte: Math.max(1, Math.round(ph * pixelsPerMm)), pixelsPerMm };
}

/**
 * Een gesleept vak in het voorbeeld naar een venster in tekeningeenheden.
 *
 * Het voorbeeld toont de pagina van linksboven naar rechtsonder; de tekening
 * heeft y omhoog. `pagina` is het verslag van de omzetting voor deze pagina
 * (`widthMm`, `heightMm`, `scale`, `offset`): `offset` is het punt van de
 * tekening dat op de oorsprong van de pagina ligt.
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null}
 */
export function vensterUitVoorbeeld(rect, pagina, mmPerEenheid, pixelsPerMm) {
  const schaal = Number(pagina?.scale);
  const hoogteMm = Number(pagina?.heightMm);
  const offset = pagina?.offset;
  const k = Number(mmPerEenheid) > 0 ? Number(mmPerEenheid) : 1;
  if (!(schaal > 0) || !(hoogteMm > 0) || !Array.isArray(offset) || !(pixelsPerMm > 0)) return null;
  if (!(rect?.breedte > 2) || !(rect?.hoogte > 2)) return null;
  // Beeldpunt naar papier-mm, papier-mm naar tekeningeenheden.
  const perPixel = schaal / (pixelsPerMm * k);
  const x0 = offset[0] + rect.x * perPixel;
  const x1 = offset[0] + (rect.x + rect.breedte) * perPixel;
  // y in het voorbeeld loopt omlaag.
  const y1 = offset[1] + (hoogteMm / k) * (schaal) - rect.y * perPixel;
  const y0 = y1 - rect.hoogte * perPixel;
  if (![x0, y0, x1, y1].every((v) => Number.isFinite(v))) return null;
  const rond = (v) => Math.round(v * 1000) / 1000;
  return { x0: rond(x0), y0: rond(y0), x1: rond(x1), y1: rond(y1) };
}

/** Alles wat het beeld bepaalt; het doelbestand en de taak tellen niet mee. */
export function voorbeeldSleutel(args) {
  const { outputPath, ...rest } = args || {};
  return JSON.stringify(rest);
}
```

> Controleer de omrekening in `vensterUitVoorbeeld` tegen `oorsprongVerschuiving`: `offset` is in tekeningeenheden, de paginahoogte in mm; `hoogteMm / k * schaal` is de hoogte van de pagina in tekeningeenheden. De test hierboven legt het getal vast.

- [ ] **Step 3: Brug naar de app**

In `js/pdf/cad-import.js`:

```javascript
/** Zet de tekening om naar een tijdelijke PDF voor de voorbeeldweergave. */
export function voorbeeldTekening(jobId, args) {
  return invoke('preview_cad_import', { jobId, args });
}

/** Grenzen die de omzetter hanteert (voor de meldingen in het venster). */
export function cadImportGrenzen() {
  return invoke('cad_import_limits').catch(() => ({ previewSimpleAbove: 200000, maxImagePixels: 0, maxXrefFiles: 0 }));
}

/**
 * Rastert de eerste pagina van een PDF op schijf. Dezelfde route als de
 * voorvertoning van een vectorknipsel: de worker rendert vanaf een pad en
 * levert RGBA met een kop van twee uint32 LE.
 * @returns {Promise<ImageBitmap|null>}
 */
export async function tekenPdfNaarBitmap(pad, breedtePt, hoogtePt, schaal) {
  if (!pad || !(breedtePt > 0) || !(hoogtePt > 0) || !(schaal > 0)) return null;
  const res = await invoke('render_pdf_page_region', {
    path: pad,
    pageIndex: 0,
    scale: schaal,
    rotation: 0,
    regionXPt: 0,
    regionYPt: 0,
    regionWPt: breedtePt,
    regionHPt: hoogtePt,
  });
  const bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
  if (!bytes || bytes.length <= 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const w = dv.getUint32(0, true);
  const h = dv.getUint32(4, true);
  if (w * h * 4 !== bytes.length - 8) return null;
  const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * h * 4);
  return await createImageBitmap(new ImageData(rgba, w, h));
}
```

- [ ] **Step 4: Het paneel**

Maak `js/solid/components/dialogs/CadImportPreview.jsx`:

```jsx
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  maakVertrager, voorbeeldMaat, vensterUitVoorbeeld, voorbeeldSleutel, VOORBEELD_VERTRAGING_MS,
} from '../../../pdf/cad-import-voorbeeld.js';
import {
  annuleerImport, nieuwJobId, ruimOp, tekenPdfNaarBitmap, tijdelijkPdfPad, voorbeeldTekening,
} from '../../../pdf/cad-import.js';

const PT_PER_MM = 72 / 25.4;
/** Kleinste sleep die als venster telt (beeldpunten). */
const MIN_SLEEP = 6;

/**
 * Voorbeeldweergave van het importvenster (#400).
 *
 * Draait de echte omzetter naar een tijdelijke PDF en toont die; vertraagd,
 * af te breken, en slepen zet het venster. `props.args` is het volledige
 * argumentenpakket zoals de import het zou krijgen (zonder `outputPath`).
 */
export default function CadImportPreview(props) {
  const { t } = useTranslation('dialogs');
  const [bitmap, setBitmap] = createSignal(null);
  const [maat, setMaat] = createSignal(null);
  const [bezig, setBezig] = createSignal(false);
  const [fout, setFout] = createSignal('');
  const [pagina, setPagina] = createSignal(null);
  const [sleep, setSleep] = createSignal(null);

  let vak;
  let canvas;
  let job = null;
  let laatste = '';
  let weg = false;
  const vertrager = maakVertrager(VOORBEELD_VERTRAGING_MS);

  onCleanup(() => {
    weg = true;
    vertrager.stop();
    if (job) annuleerImport(job);
    const b = bitmap();
    if (b?.close) b.close();
  });

  async function draai() {
    const args = props.args;
    if (!args?.path || !props.actief) return;
    const sleutel = voorbeeldSleutel(args);
    if (sleutel === laatste && bitmap()) return;
    if (job) annuleerImport(job);
    setFout('');
    setBezig(true);
    job = nieuwJobId('preview');
    const dezeJob = job;
    let pad = null;
    try {
      pad = await tijdelijkPdfPad(`${args.path}.voorbeeld`);
      const verslag = await voorbeeldTekening(dezeJob, { ...args, outputPath: pad });
      if (weg || dezeJob !== job) return;
      const blad = verslag.pages?.[0];
      if (!blad) throw new Error('geen pagina');
      setPagina(blad);
      const vakPx = { breedte: vak?.clientWidth || 260, hoogte: vak?.clientHeight || 360 };
      const m = voorbeeldMaat({ breedte: blad.widthMm, hoogte: blad.heightMm }, vakPx);
      if (!m) throw new Error('geen maat');
      const bmp = await tekenPdfNaarBitmap(
        pad,
        blad.widthMm * PT_PER_MM,
        blad.heightMm * PT_PER_MM,
        m.pixelsPerMm / PT_PER_MM,
      );
      if (weg || dezeJob !== job) return;
      const oud = bitmap();
      if (oud?.close) oud.close();
      setMaat(m);
      setBitmap(bmp);
      laatste = sleutel;
      props.onMelding?.(verslag.simplified ? { sleutel: 'previewSimplified', waarschuwingen: verslag.warnings } : null);
    } catch (e) {
      if (!weg) {
        setFout(t('cadImport.previewFailed'));
        props.onMelding?.(null);
      }
    } finally {
      if (pad) ruimOp(pad).catch(() => {});
      if (dezeJob === job) {
        job = null;
        if (!weg) setBezig(false);
      }
    }
  }

  // Elke wijziging van de argumenten plant een nieuwe omzetting.
  createEffect(() => {
    const sleutel = voorbeeldSleutel(props.args);
    const aan = props.actief;
    if (!aan) {
      vertrager.stop();
      if (job) annuleerImport(job);
      return;
    }
    // Lees de sleutel zodat het effect erop reageert.
    void sleutel;
    vertrager.plan(() => { draai().catch(() => {}); });
  });

  // Tekenen.
  createEffect(() => {
    const bmp = bitmap();
    const m = maat();
    const s = sleep();
    if (!canvas || !m) return;
    canvas.width = m.breedte;
    canvas.height = m.hoogte;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, m.breedte, m.hoogte);
    // Papier.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, m.breedte, m.hoogte);
    if (bmp) ctx.drawImage(bmp, 0, 0, m.breedte, m.hoogte);
    ctx.strokeStyle = '#d4d4d4';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, m.breedte - 1, m.hoogte - 1);
    // Marge.
    const marge = Number(props.args?.marginMm) || 0;
    if (marge > 0) {
      const d = marge * m.pixelsPerMm;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#9a9a9a';
      ctx.strokeRect(d, d, Math.max(0, m.breedte - 2 * d), Math.max(0, m.hoogte - 2 * d));
      ctx.setLineDash([]);
    }
    if (s) {
      ctx.strokeStyle = '#0a5ca8';
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.breedte, s.hoogte);
    }
  });

  const puntIn = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div class="cad-preview" ref={vak}>
      <div class="cad-preview-head">
        <span>{t('cadImport.preview')}</span>
        <Show when={bezig()}><span class="cad-note">{t('cadImport.previewBusy')}</span></Show>
      </div>
      <canvas
        ref={canvas}
        class="cad-preview-canvas"
        onPointerDown={(e) => {
          if (e.button !== 0 || !maat()) return;
          const p = puntIn(e);
          setSleep({ x: p.x, y: p.y, breedte: 0, hoogte: 0, vanX: p.x, vanY: p.y });
          canvas.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const s = sleep();
          if (!s) return;
          const p = puntIn(e);
          setSleep({
            ...s,
            x: Math.min(s.vanX, p.x),
            y: Math.min(s.vanY, p.y),
            breedte: Math.abs(p.x - s.vanX),
            hoogte: Math.abs(p.y - s.vanY),
          });
        }}
        onPointerUp={(e) => {
          const s = sleep();
          setSleep(null);
          try { canvas.releasePointerCapture(e.pointerId); } catch { /* al los */ }
          if (!s || s.breedte < MIN_SLEEP || s.hoogte < MIN_SLEEP) return;
          const venster = vensterUitVoorbeeld(s, pagina(), props.mmPerEenheid, maat()?.pixelsPerMm);
          if (venster) props.onVenster?.(venster);
        }}
      />
      <Show when={fout()}><span class="cad-status cad-status-fout" role="alert">{fout()}</span></Show>
      <Show when={!fout()}><span class="cad-note">{t('cadImport.previewWindowHint')}</span></Show>
    </div>
  );
}
```

- [ ] **Step 5: Inhangen in het venster**

In `CadImportDialog.jsx`:

1. `import CadImportPreview from './CadImportPreview.jsx';`
2. Een geheugen voor de argumenten van het voorbeeld:

```javascript
  const voorbeeldArgs = createMemo(() => {
    if (!scan() || !pad()) return null;
    const { excludedLayers, hiddenLayers } = lagenKeuze(lagen(), uit(), inst);
    return importArgumenten(inst, {
      path: pad(),
      outputPath: '',
      spaces: [ruimteId() || 'model'],
      excludedLayers,
      hiddenLayers,
      window: inst.area === 'window' ? [venster.x0, venster.y0, venster.x1, venster.y1] : null,
    });
  });
```

3. Het paneel rechts van de tabbladen (de `fieldset` en het paneel komen naast elkaar in een `cad-main`-rij):

```jsx
      <div class="cad-main">
        <fieldset class="cad-panels" …>…</fieldset>
        <Show when={inst.preview}>
          <CadImportPreview
            pad={pad()}
            args={voorbeeldArgs()}
            actief={!bezig() && !!scan()}
            mmPerEenheid={mmPerEenheid()}
            onVenster={(v) => { setInst('area', 'window'); setVenster(v); }}
            onMelding={(m) => setVoorbeeldMelding(m)}
          />
        </Show>
      </div>
```

met `const [voorbeeldMelding, setVoorbeeldMelding] = createSignal(null);` en, in `samenvatting()`, aan het eind:

```javascript
    if (voorbeeldMelding()?.sleutel === 'previewSimplified') {
      delen.push(t('cadImport.previewSimplified', { n: getal(grenzen()?.previewSimpleAbove || 200000) }));
    }
```

met `const [grenzen, setGrenzen] = createSignal(null);` en in `onMount`: `cadImportGrenzen().then(setGrenzen).catch(() => {});`

4. Een schakelaar om het voorbeeld uit te zetten, onderin naast de voorinstellingen:

```jsx
        <label class="cad-check">
          <input type="checkbox" checked={inst.preview} onChange={(e) => setInst('preview', e.target.checked)} />
          {inst.preview ? t('cadImport.preview') : t('cadImport.previewOff')}
        </label>
```

5. Vul de `import`-regel uit `js/pdf/cad-import.js` aan met `cadImportGrenzen` (voor de melding over de vereenvoudigde voorbeeldweergave).

6. Bij het sluiten van het venster loopt er misschien nog een voorbeeld: `onCleanup` van het paneel breekt het af en ruimt het tijdelijke bestand op; het venster hoeft daar niets extra's voor te doen.

- [ ] **Step 6: Opmaak**

```css
.cad-dialog.cad-dialog-import { width: 1040px; }
.cad-main { display: flex; gap: 12px; align-items: stretch; }
.cad-panels { flex: 1; min-width: 0; }
.cad-preview { width: 300px; display: flex; flex-direction: column; gap: 4px; }
.cad-preview-head { display: flex; justify-content: space-between; align-items: baseline; font-weight: 600; }
.cad-preview-canvas {
  flex: 1;
  border: 1px solid #d4d4d4;
  background: var(--theme-input-bg, #fff);
  align-self: center;
  max-width: 100%;
}
```

Geen afgeronde hoeken, geen overgangen, geen eigen cursor op het paneel.

- [ ] **Step 7: Draaien en committen**

```
cd open-pdf-studio && npm run test:unit && npx vite build
```

Controleer daarna met de hand (Task 16 doet het in de releasebuild) dat het voorbeeld na 300 ms bijwerkt, dat sneller klikken geen stapel omzettingen oplevert, en dat sluiten tijdens een voorbeeld geen achtergebleven bestand laat staan.

```
feat(import): voorbeeldweergave uit de echte omzetter, vertraagd en af te breken (#400)
```

---

### Task 13: Venster — onderlegger op de huidige pagina

Doel C uit E1: hetzelfde omzettingsresultaat, maar als onderlegger op de pagina die open staat. Er komt geen tweede route: de PDF die de omzetter maakt, gaat als **vectorknipsel** op de pagina — verplaatsbaar, schaalbaar, vast te zetten, en in het bestand echte vectordata. Nieuw is alleen: een dekking, en "onder de bestaande inhoud" (dan wordt het knipsel bij het opslaan vóór de bestaande inhoudsstroom getekend in plaats van erachter).

**Files:**
- Modify: `open-pdf-studio/js/pdf/cad-import.js`
- Modify: `open-pdf-studio/js/pdf/saver/vector-snippet.js`
- Modify: `open-pdf-studio/js/solid/components/dialogs/CadImportDialog.jsx`
- Modify: `open-pdf-studio/js/pdf/cad-import.test.mjs`
- Modify: `open-pdf-studio/js/annotations/vector-snippet-store.test.mjs` (of een nieuwe test naast de bestaande knipseltests)

**Interfaces:**
- Consumes: `knipselAlsMiniPdf`, `paginaRotatie` (`js/pdf/vector-embed.js`), `bewaar` (`js/annotations/vector-snippet-store.js`), `zetKnipselOpKlembord`, `plakKnipsel` (`js/annotations/vector-snippet-clipboard.js`), `tekenKnipselInPagina` (`js/pdf/saver/vector-snippet.js`).
- Produces in `js/pdf/cad-import.js`:
  - `export async function plaatsAlsOnderlegger(pad, { tekening, opacity = 0.5, onder = true })` → `Promise<object>` (de nieuwe annotatie)
- Sinds Task 11: `target` met de keuze `'underlay'`, `underlayOpacity: 50` (5 tot 100) en `underlayBelow: true` komen in **deze** taak in `cad-import-instellingen.js` (`KEUZES`, `GETALLEN`, `SCHAKELAARS`), met een test dat onzin in de voorkeuren op de standaard terugvalt.
- Produces in `js/pdf/saver/vector-snippet.js`:
  - gewijzigde signatuur `tekenKnipselInPagina(page, ingebedRef, plaatsing, opacity = 1, onder = false)`
  - `export async function voegInhoudVooraanToe(page, ops)`

- [ ] **Step 1: Falende tests schrijven**

In `js/pdf/cad-import.test.mjs`:

```javascript
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
import { voegInhoudVooraanToe } from "./saver/vector-snippet.js";

test("content added at the front comes before what the page already had", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.drawRectangle({ x: 10, y: 10, width: 10, height: 10 });
  await voegInhoudVooraanToe(page, "q 1 0 0 1 0 0 cm Q");
  const contents = page.node.normalizedEntries().Contents;
  assert.ok(contents instanceof PDFArray);
  assert.ok(contents.size() >= 2);
  const bytes = await doc.save();
  const tekst = new TextDecoder("latin1").decode(bytes);
  assert.ok(tekst.includes("q 1 0 0 1 0 0 cm Q"));
});
```

En een test op de pure keuze in `cad-import-logica.js`:

```javascript
test("the underlay target only works with an open document", () => {
  assert.equal(effectiefDoel("underlay", true), "underlay");
  assert.equal(effectiefDoel("underlay", false), "new");
  assert.equal(effectiefDoel("append", false), "new");
});
```

Pas daarvoor `effectiefDoel` aan:

```javascript
/**
 * Het doel dat werkelijk gebruikt wordt: een nieuwe pagina en een onderlegger
 * kunnen alleen in een geopend document; anders wordt het een nieuw document.
 */
export function effectiefDoel(doel, heeftDocument) {
  return (doel === 'append' || doel === 'underlay') && heeftDocument ? doel : 'new';
}
```

- [ ] **Step 2: Vooraan in de inhoudsstroom schrijven**

In `js/pdf/saver/vector-snippet.js`:

```javascript
/**
 * Zet een inhoudsstroom vóór wat de pagina al heeft. `page.pushOperators`
 * schrijft altijd achteraan (dus bóven de bestaande inhoud); een onderlegger
 * hoort eronder.
 * @param {import('pdf-lib').PDFPage} page
 * @param {string} ops
 */
export async function voegInhoudVooraanToe(page, ops) {
  const { PDFContentStream, PDFName } = await import('pdf-lib');
  const context = page.doc.context;
  const stream = PDFContentStream.of(context.obj({}), [], false);
  // De operatoren staan al als tekst klaar; zet ze rechtstreeks in de stroom.
  const ref = context.register(context.flateStream(new TextEncoder().encode(ops)));
  void stream;
  const entries = page.node.normalizedEntries();
  const contents = entries.Contents;
  if (contents && typeof contents.insert === 'function') {
    contents.insert(0, ref);
  } else {
    page.node.set(PDFName.of('Contents'), context.obj([ref]));
  }
}
```

> `normalizedEntries()` maakt van `/Contents` een array als dat nog geen array was; `insert(0, …)` zet de nieuwe stroom vooraan. Blijkt `PDFContentStream` niet nodig, haal de regel dan weg — hij staat er alleen om te laten zien dat de stroom als gewone inhoudsstroom telt.

En pas het vastzetten aan:

```javascript
/**
 * Vastzetten: tekent het knipsel met dezelfde plaatsing als de appearance
 * rechtstreeks in de inhoudstroom van de pagina. Niet via page.drawPage — die
 * schaalt met de maat van het ongedraaide bronvak, wat een knipsel uit een
 * gedraaid blad vervormt.
 *
 * Met `onder` komt het knipsel vóór de bestaande inhoud te staan: dat is de
 * onderlegger van de CAD-import.
 */
export async function tekenKnipselInPagina(page, ingebedRef, plaatsing, opacity = 1, onder = false) {
  const {
    pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, setGraphicsState,
  } = await import('pdf-lib');
  const naam = page.node.newXObject('OPSKnipsel', ingebedRef);
  const ops = [pushGraphicsState()];
  if (Number.isFinite(opacity) && opacity < 1) {
    const context = page.doc.context;
    const gs = context.register(context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }));
    ops.push(setGraphicsState(page.node.newExtGState('GS', gs)));
  }
  ops.push(concatTransformationMatrix(...plaatsing.map(getal)), drawObject(naam), popGraphicsState());
  if (onder) {
    await voegInhoudVooraanToe(page, ops.map((op) => op.toString()).join('\n'));
    return;
  }
  page.pushOperators(...ops);
}
```

De aanroeper in de saver geeft de vlag door: zoek waar `tekenKnipselInPagina` wordt aangeroepen en voeg `ann.belowContent === true` als vijfde argument toe.

- [ ] **Step 3: De onderlegger plaatsen**

In `js/pdf/cad-import.js`:

```javascript
/**
 * Zet de PDF die de import maakte als onderlegger op de huidige pagina van
 * het actieve document. Dat gebeurt met het bestaande vectorknipsel: de
 * eerste pagina van de import wordt de bron, het knipsel komt op ware grootte
 * linksboven en is daarna te verplaatsen en te schalen.
 *
 * @param {string} pad        pad van de gemaakte PDF
 * @param {object} o
 * @param {string} o.tekening pad van de tekening (voor het bijschrift)
 * @param {number} [o.opacity] dekking, 0 tot 1
 * @param {boolean} [o.onder]  onder de bestaande inhoud bij het opslaan
 * @returns {Promise<object>} de nieuwe annotatie
 */
export async function plaatsAlsOnderlegger(pad, { tekening, opacity = 0.5, onder = true } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) throw new Error('geen document open');
  const fs = window.__TAURI__?.fs;
  if (!fs?.readFile) throw new Error('IMPORT_INSERT_FAILED');
  const bytes = await fs.readFile(pad);
  const { PDFDocument } = await import('pdf-lib');
  const bron = await PDFDocument.load(bytes);
  const pagina = bron.getPage(0);
  const vak = pagina.getCropBox();
  const { knipselAlsMiniPdf, paginaRotatie } = await import('./vector-embed.js');
  const rotatie = paginaRotatie(pagina);
  const mini = await knipselAlsMiniPdf(bytes, 0, 0);
  const { bewaar } = await import('../annotations/vector-snippet-store.js');
  const sleutel = bewaar(mini);
  const gedraaid = rotatie === 90 || rotatie === 270;
  const knipsel = {
    snippetKey: sleutel,
    srcBox: { left: vak.x, bottom: vak.y, right: vak.x + vak.width, top: vak.y + vak.height },
    srcLabel: pdfNaamVoor(tekening || pad),
    breedte: gedraaid ? vak.height : vak.width,
    hoogte: gedraaid ? vak.width : vak.height,
  };
  const klembord = await import('../annotations/vector-snippet-clipboard.js');
  klembord.zetKnipselOpKlembord(knipsel);
  const ann = klembord.plakKnipsel({ x: 0, y: 0, page: doc.currentPage || 1 });
  if (!ann) throw new Error('IMPORT_INSERT_FAILED');
  ann.opacity = Math.min(1, Math.max(0.05, Number(opacity) || 0.5));
  ann.belowContent = onder === true;
  // Een onderlegger hoort bij de pagina-inhoud, niet bij de annotaties: bij
  // het opslaan wordt hij in de inhoudsstroom getekend.
  ann.flattened = true;
  markDocumentModified();
  return ann;
}
```

> `plakKnipsel` zet het knipsel al in `doc.annotations` en in de ongedaan-maken-lijst.

- [ ] **Step 4: Het venster**

In `CadImportDialog.jsx`:

1. De doelkeuze krijgt de derde stand:

```jsx
          <option value="underlay" disabled={!heeftDocument}>{t('cadImport.targetUnderlay')}</option>
```

2. Dekking en "onder de inhoud", alleen zichtbaar bij dat doel:

```jsx
        <Show when={doel() === 'underlay'}>
          <label class="cad-label cad-label-short" for={veld('opacity')}>{t('cadImport.underlayOpacity')}</label>
          <input
            id={veld('opacity')} type="number" class="cad-input cad-input-short" min="5" max="100" step="5"
            value={inst.underlayOpacity}
            onChange={(e) => setInst('underlayOpacity', Math.min(100, Math.max(5, Number(e.target.value) || 50)))}
          />
          <span class="cad-note">%</span>
          <label class="cad-check">
            <input type="checkbox" checked={inst.underlayBelow} onChange={(e) => setInst('underlayBelow', e.target.checked)} />
            {t('cadImport.underlayBelow')}
          </label>
        </Show>
```

3. In `importeer()`, bij het afhandelen van het doel:

```javascript
      if (doel() === 'underlay') {
        await plaatsAlsOnderlegger(verslag.outputPath, {
          tekening: bestand,
          opacity: (Number(inst.underlayOpacity) || 50) / 100,
          onder: inst.underlayBelow !== false,
        });
        await ruimOp(verslag.outputPath);
      } else if (doel() === 'append') {
        await voegImportToeAanDocument(verslag.outputPath);
      } else {
        await openImportAlsNieuwDocument(verslag.outputPath, bestand);
      }
```

en bij de slotmelding:

```javascript
      if (doel() === 'underlay' && !extra.length) {
        setMelding({ soort: 'ok', tekst: t('cadImport.underlayDone', { page: getal(doc?.currentPage || 1) }) });
        return;
      }
```

4. Vul de `import`-regel uit `cad-import.js` aan met `plaatsAlsOnderlegger`.

- [ ] **Step 5: Draaien en committen**

```
cd open-pdf-studio && npm run test:unit && npx vite build
```

```
feat(import): een tekening als onderlegger op de huidige pagina, met dekking (#400)
```

---

### Task 14: Voorinstellingen, dubbele laagnamen en de wachtrij afronden

De laatste open punten uit fase 5. De voorinstellingen werken al, maar kennen de velden van fase 6 nog niet; dubbele laagnamen krijgen al een achtervoegsel maar dat is alleen in `voegLagenSamen` getest, niet van begin tot eind; de wachtrij is getest als losse rekenregel, niet als keten.

**Files:**
- Modify: `open-pdf-studio/js/solid/stores/cad-import-instellingen.js`
- Modify: `open-pdf-studio/js/pdf/cad-import-logica.js`
- Modify: `open-pdf-studio/js/pdf/cad-import.test.mjs`

**Interfaces:**
- Produces in `cad-import-logica.js`:
  - `export function voegLagenSamen(destDoc, paginas, pdfLib, bronDoc, herkomst)` — ongewijzigde signatuur, uitgebreid gedrag: ook een naam die in dezelfde oproep twee keer voorkomt wordt uniek.
  - `export function maakWachtrij()` — ongewijzigde signatuur, uitgebreid met `bevat(pad)`.
- Sinds Task 11 bewaren voorinstellingen de velden van het tabblad Weergave al, gecontroleerd en getest (`a preset carries the colour table, the font table and the search paths, checked`). Wat hier nog bij komt zijn de velden van Task 12 en 13 (`preview`, `underlayOpacity`, `underlayBelow`, `target: 'underlay'`). Let op in de test hieronder: een letterregel is alleen een regel als `family` `sans` of `mono` is; de regel `txt` naar `mono` blijft dus staan.

- [ ] **Step 1: Falende tests schrijven**

```javascript
test("a preset keeps the new display settings and drops unknown ones", () => {
  const lijst = metVoorinstelling([], "Kaal zwart", {
    ...CAD_IMPORT_STANDAARD,
    colors: "black",
    lineweight: "pens",
    pens: [{ color: "#123456", lineweightMm: 0.18 }],
    fonts: [{ from: "txt", family: "mono", bold: false, italic: false }],
    xrefs: false,
    images: false,
    searchPaths: ["C:/een"],
    underlayOpacity: 30,
    onzin: 42,
  });
  assert.equal(lijst.length, 1);
  const s = lijst[0].settings;
  assert.equal(s.colors, "black");
  assert.equal(s.lineweight, "pens");
  assert.deepEqual(s.pens, [{ color: "#123456", lineweightMm: 0.18 }]);
  assert.deepEqual(s.fonts, [{ from: "txt", family: "mono", bold: false, italic: false }]);
  assert.equal(s.xrefs, false);
  assert.equal(s.images, false);
  assert.deepEqual(s.searchPaths, ["C:/een"]);
  assert.equal(s.underlayOpacity, 30);
  assert.equal(s.onzin, undefined, "onbekende sleutels gaan niet mee");
});

test("two imports in one document keep their layers apart, also within one call", async () => {
  const doc = await PDFDocument.create();
  const maakPagina = async (namen) => {
    const bron = await PDFDocument.create();
    const p = bron.addPage([100, 100]);
    const props = bron.context.obj({});
    namen.forEach((naam, i) => {
      props.set(PDFName.of(`L${i}`), bron.context.register(bron.context.obj({ Type: 'OCG', Name: PDFString.of(naam) })));
    });
    p.node.set(PDFName.of('Resources'), bron.context.obj({ Properties: props }));
    return { bron, p };
  };
  const een = await maakPagina(["Wanden", "Maten"]);
  const [kopie1] = await doc.copyPages(een.bron, [0]);
  doc.addPage(kopie1);
  assert.equal(voegLagenSamen(doc, [kopie1], { PDFName, PDFArray, PDFDict, PDFString }, een.bron, "eerste.dwg"), 2);

  const twee = await maakPagina(["Wanden", "Wanden"]);
  const [kopie2] = await doc.copyPages(twee.bron, [0]);
  doc.addPage(kopie2);
  assert.equal(voegLagenSamen(doc, [kopie2], { PDFName, PDFArray, PDFDict, PDFString }, twee.bron, "tweede.dwg"), 2);

  const namen = [];
  const oc = doc.catalog.lookup(PDFName.of('OCProperties'));
  for (const ref of oc.lookup(PDFName.of('OCGs')).asArray()) {
    namen.push(doc.context.lookup(ref).lookup(PDFName.of('Name')).decodeText());
  }
  assert.equal(new Set(namen).size, namen.length, `dubbele namen: ${namen.join(", ")}`);
  assert.ok(namen.includes("Wanden (tweede.dwg)"));
});

test("the queue hands out every drawing exactly once and knows what it holds", () => {
  const rij = maakWachtrij();
  assert.equal(rij.voegToe("a.dwg"), true);
  assert.equal(rij.voegToe("a.dwg"), false, "geen dubbele");
  assert.equal(rij.voegToe("b.dxf"), true);
  assert.equal(rij.voegToe("c.pdf"), false, "geen tekening");
  assert.equal(rij.bevat("b.dxf"), true);
  assert.equal(rij.lengte, 2);
  assert.equal(rij.volgende(), "a.dwg");
  assert.equal(rij.bevat("a.dwg"), false);
  assert.equal(rij.volgende(), "b.dxf");
  assert.equal(rij.volgende(), null);
  rij.voegToe("d.dwg");
  rij.leeg();
  assert.equal(rij.lengte, 0);
});
```

- [ ] **Step 2: De voorinstellingen**

`herstelCadImportInstellingen` uit Task 11 maakt al elke lijst schoon en laat onbekende sleutels vallen, dus `metVoorinstelling` klopt vanzelf zodra Task 11 af is. Controleer dat `MAX_VOORINSTELLINGEN` ongewijzigd blijft en dat `herstelCadImportVoorinstellingen` de nieuwe velden meeneemt (dat doet hij, want hij roept `herstelCadImportInstellingen` aan).

- [ ] **Step 3: Dubbele laagnamen binnen één oproep**

In `voegLagenSamen` komt `bestaandeNamen` nu alleen uit de lagen die er al waren. Een pagina die zelf twee lagen met dezelfde naam draagt, levert dan nog steeds twee keer dezelfde naam. Voeg daarom de zojuist gegeven naam toe aan `bestaandeNamen` (dat gebeurt al met `if (naam) bestaandeNamen.add(naam);`) én zorg dat de vergelijking ook de eigen naam ziet vóór het hernoemen. Vervang het blok binnen de lus door:

```javascript
    const dict = destDoc.context.lookup(ref);
    const origineel = ocgNaam(dict, PDFName);
    let naam = origineel;
    if (naam && bestaandeNamen.has(naam)) {
      const achtervoegsel = herkomst ? ` (${herkomst})` : ' (2)';
      let uniek = `${naam}${achtervoegsel}`;
      for (let n = 2; bestaandeNamen.has(uniek); n += 1) uniek = `${naam}${achtervoegsel} ${n}`;
      try { dict.set(PDFName.of('Name'), PDFString.of(uniek)); } catch { /* laat de naam staan */ }
      naam = uniek;
    }
    if (naam) bestaandeNamen.add(naam);
```

Dat is de bestaande code; de test bewijst dat hij ook binnen één oproep werkt omdat `bestaandeNamen` per laag bijgewerkt wordt. Blijkt de test toch te falen, dan zit het probleem in `ocgs`: dubbele verwijzingen worden ontdubbeld op ref, niet op naam — twee verschillende OCG-objecten met dezelfde naam komen dus allebei binnen, en dat is precies wat de test wil.

- [ ] **Step 4: De wachtrij**

In `maakWachtrij`:

```javascript
export function maakWachtrij() {
  const rij = [];
  return {
    voegToe(pad) {
      if (!isCadTekening(pad) || rij.includes(pad)) return false;
      rij.push(pad);
      return true;
    },
    volgende() {
      return rij.shift() || null;
    },
    bevat(pad) {
      return rij.includes(pad);
    },
    get lengte() {
      return rij.length;
    },
    leeg() {
      rij.length = 0;
    },
  };
}
```

- [ ] **Step 5: Draaien en committen**

```
cd open-pdf-studio && npm run test:unit && npx vite build
```

```
test(import): voorinstellingen met de nieuwe keuzes, dubbele laagnamen en de wachtrij (#400)
```

---

### Task 15: MCP-opdracht `app_import_cad`

Ontwerp E6: beide richtingen ook als opdracht voor de MCP-koppeling, zodat de assistent en de testrig ze kunnen aansturen. `app_open_pdf` opent nu al het importvenster voor een DWG of DXF; `app_import_cad` doet de import zonder venster, met de instellingen uit de opdracht.

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/mcp_server.rs`
- Modify: `open-pdf-studio/src-tauri/src/mcp_tool_meta.rs`
- Modify: `open-pdf-studio/js/mcp-bridge.js`

**Interfaces:**
- Consumes: `importArgumenten`, `herstelCadImportInstellingen`, `verkenTekening`, `importeerTekening`, `tijdelijkPdfPad`, `openImportAlsNieuwDocument`, `voegImportToeAanDocument`, `plaatsAlsOnderlegger`, `ruimOp`, `nieuwJobId`.
- Produces: MCP-gereedschap `app_import_cad` met invoer
  `{ path, space?, scale?, paper?, orientation?, marginMm?, placement?, rotation?, units?, layersOff?, target?, opacity?, colors?, hatch?, text?, xrefs?, images?, searchPaths? }`
  en uitvoer `{ ok, file_path, space, paper, scale, pages, objects, warnings }`.
- Sinds Task 11: de opdracht kan ook `monoThreshold`, `singleColor`, `pens`, `fonts`, `reuseBlocks` en `maxImageMegapixels` doorgeven; alles gaat door `herstelCadImportInstellingen`, dus onzin valt terug op de standaard. Geef `importArgumenten` de grenzen mee (`limits: await importGrenzen()`) en `verkenTekening(jobId, pad, zoekpaden)` de zoekpaden.
- Produces in `js/mcp-bridge.js`: `async function handleImportCad(params)` plus de regel `'mcp:import-cad': handleImportCad,` in de tabel.

- [ ] **Step 1: Het gereedschap beschrijven**

In `open-pdf-studio/src-tauri/src/mcp_server.rs`, in de lijst met gereedschappen (bij de andere `app_*`-beschrijvingen):

```rust
            {
                "name": "app_import_cad",
                "description": "Import a DWG or DXF drawing as a vector PDF page, without opening the import dialog. Choose the space (model space or a layout), the scale, the paper size and what happens with the result: a new document, a new page after the current one, or an underlay on the current page. Returns what was made, including warnings about anything that could not be converted.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":        { "type": "string", "description": "Path of the .dwg or .dxf file." },
                        "space":       { "type": "string", "description": "\"model\" or the name of a layout (default: what the file suggests)." },
                        "scale":       { "type": "number", "description": "Denominator N of 1:N. Leave out to fit on the paper." },
                        "paper":       { "type": "string", "description": "A4, A3, A3L, A2, A2L, A1, A1L, A0, Letter, Tabloid, auto (default) or custom." },
                        "orientation": { "type": "string", "description": "auto, portrait or landscape." },
                        "marginMm":    { "type": "number", "description": "Margin around the drawing in mm (default 10)." },
                        "placement":   { "type": "string", "description": "center, lower_left or origin." },
                        "rotation":    { "type": "number", "description": "Rotate the drawing before placing it, in degrees." },
                        "units":       { "type": "string", "description": "mm, cm, m, in or ft; overrides the unit in the file." },
                        "layersOff":   { "type": "array", "items": { "type": "string" }, "description": "Layer names to leave out." },
                        "target":      { "type": "string", "description": "new (default), append or underlay." },
                        "opacity":     { "type": "number", "description": "Opacity of an underlay, 0.05 to 1 (default 0.5)." },
                        "colors":      { "type": "string", "description": "file, black or gray." },
                        "hatch":       { "type": "string", "description": "all, solid_only, outline or none." },
                        "text":        { "type": "boolean", "description": "Convert text (default true)." },
                        "xrefs":       { "type": "boolean", "description": "Load external references (default true)." },
                        "images":      { "type": "boolean", "description": "Embed images (default true)." },
                        "searchPaths": { "type": "array", "items": { "type": "string" }, "description": "Extra folders to look for references and images." }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }
            },
```

en bij de afhandeling, naast `app_snippet_paste`:

```rust
        "app_import_cad"         => tool_app_request(state, "mcp:import-cad",         &arguments, Duration::from_secs(300)).await,
```

In `open-pdf-studio/src-tauri/src/mcp_tool_meta.rs`, bij de gereedschappen die iets toevoegen:

```rust
    voegt_toe("app_import_cad", "Import CAD drawing"),
```

- [ ] **Step 2: De brug**

In `open-pdf-studio/js/mcp-bridge.js`, bij de andere afhandelaars:

```javascript
// ─── CAD-import zonder venster (issue #400) ───────────────────────────────

async function handleImportCad(params) {
  const p = params || {};
  if (typeof p.path !== 'string' || !p.path) {
    return { ok: false, error: 'missing or invalid params.path' };
  }
  const cad = await import('./pdf/cad-import.js');
  const logica = await import('./pdf/cad-import-logica.js');
  const store = await import('./solid/stores/cad-import-instellingen.js');
  if (!logica.isCadTekening(p.path)) {
    return { ok: false, error: 'not a CAD drawing (expected .dwg or .dxf)', file_path: p.path };
  }
  const stateMod = await import('./core/state.js');
  const heeftDocument = !!stateMod.getActiveDocument()?.pdfDoc;
  const doel = logica.effectiefDoel(p.target || 'new', heeftDocument);

  // De onthouden instellingen als basis; de opdracht wint per veld.
  const inst = store.herstelCadImportInstellingen({
    ...(stateMod.state.preferences?.cadImportSettings || {}),
    ...(p.scale !== undefined ? { scale: Number(p.scale) || 0 } : {}),
    ...(p.paper !== undefined ? { paper: p.paper } : {}),
    ...(p.orientation !== undefined ? { orientation: p.orientation } : {}),
    ...(p.marginMm !== undefined ? { marginMm: Number(p.marginMm) } : {}),
    ...(p.placement !== undefined ? { placement: p.placement } : {}),
    ...(p.rotation !== undefined ? { rotation: Number(p.rotation) } : {}),
    ...(p.units !== undefined ? { units: p.units } : {}),
    ...(p.colors !== undefined ? { colors: p.colors } : {}),
    ...(p.hatch !== undefined ? { hatch: p.hatch } : {}),
    ...(p.text !== undefined ? { text: p.text === true } : {}),
    ...(p.xrefs !== undefined ? { xrefs: p.xrefs === true } : {}),
    ...(p.images !== undefined ? { images: p.images === true } : {}),
    ...(Array.isArray(p.searchPaths) ? { searchPaths: p.searchPaths } : {}),
    ...(p.opacity !== undefined ? { underlayOpacity: Math.round((Number(p.opacity) || 0.5) * 100) } : {}),
    target: doel,
  });

  const scanJob = cad.nieuwJobId('scan');
  let scan;
  try {
    scan = await cad.verkenTekening(scanJob, p.path);
  } catch (e) {
    const fout = logica.leesImportFout(e);
    return { ok: false, error: `scan failed: ${fout.sleutel}`, file_path: p.path };
  }
  const ruimte = typeof p.space === 'string' && p.space ? p.space : (scan.defaultSpace || 'model');
  if (!(scan.spaces || []).some((s) => s.id.toLowerCase() === ruimte.toLowerCase())) {
    return { ok: false, error: `space not found: ${ruimte}`, spaces: (scan.spaces || []).map((s) => s.id) };
  }
  const lagen = logica.lagenVoorRuimte(scan, ruimte);
  const uit = logica.standaardUitgesloten(lagen, inst.skipNonPlottable);
  for (const naam of Array.isArray(p.layersOff) ? p.layersOff : []) {
    if (typeof naam === 'string') uit.add(naam.toUpperCase());
  }
  const { excludedLayers, hiddenLayers } = logica.lagenKeuze(lagen, uit, inst);

  const job = cad.nieuwJobId('import');
  let verslag;
  let pad = null;
  try {
    pad = await cad.tijdelijkPdfPad(p.path);
    verslag = await cad.importeerTekening(job, logica.importArgumenten(inst, {
      path: p.path,
      outputPath: pad,
      spaces: [ruimte],
      excludedLayers,
      hiddenLayers,
      window: null,
    }));
  } catch (e) {
    if (pad) await cad.ruimOp(pad);
    const fout = logica.leesImportFout(e);
    return { ok: false, error: `import failed: ${fout.sleutel}`, file_path: p.path };
  }
  try {
    if (doel === 'underlay') {
      await cad.plaatsAlsOnderlegger(verslag.outputPath, {
        tekening: p.path,
        opacity: (Number(inst.underlayOpacity) || 50) / 100,
        onder: inst.underlayBelow !== false,
      });
      await cad.ruimOp(verslag.outputPath);
    } else if (doel === 'append') {
      await cad.voegImportToeAanDocument(verslag.outputPath);
    } else {
      await cad.openImportAlsNieuwDocument(verslag.outputPath, p.path);
    }
  } catch (e) {
    await cad.ruimOp(verslag.outputPath);
    return { ok: false, error: `placing the result failed: ${e?.message ?? e}`, file_path: p.path };
  }
  await _redrawActive();
  const blad = verslag.pages?.[0] || {};
  return {
    ok: true,
    file_path: p.path,
    target: doel,
    space: blad.space || ruimte,
    paper: blad.paper || '',
    scale: blad.scaleText || '',
    pages: verslag.pages?.length || 0,
    objects: blad.objects || 0,
    warnings: verslag.warnings || [],
  };
}
```

en in de tabel met afhandelaars:

```javascript
  'mcp:import-cad':         handleImportCad,
```

- [ ] **Step 3: Bouwen en committen**

```
cd open-pdf-studio && npx vite build
cd src-tauri && CARGO_TARGET_DIR=C:/opds-cargo-target-cadplan RUSTFLAGS='-C target-feature=-crt-static' cargo check
```

Controleer in de rig (Task 16) dat `app_list_commands` de opdracht noemt en dat een import via `app_import_cad` dezelfde pagina oplevert als via het venster.

```
feat(mcp): app_import_cad zet een DWG of DXF om zonder het importvenster (#400)
```

---

### Task 16: Verificatie in een geïsoleerde releasebuild

**Files:** geen (meetrit; de uitkomst komt in Task 17 in het ontwerp).

- [ ] **Step 1: Testbranch met de gescheiden gegevensmap**

De testinstantie mag de echte voorkeuren van de gebruiker niet aanraken. Maak een **aparte** branch vanaf de featurebranch en cherry-pick daar commit `410859c0` uit PR #411 (`OPDS_DATA_DIR`). Nooit op de featurebranch zelf.

```
git switch -c test/400-fase6-rig
git cherry-pick 410859c0
```

Noteer vóór de rit de hash van het echte voorkeurenbestand van de gebruiker en controleer die ná de rit opnieuw; hij moet gelijk zijn.

- [ ] **Step 2: Bouwen**

Bouw de app in release met `CARGO_TARGET_DIR` buiten gesynchroniseerde mappen, MSVC en `RUSTFLAGS='-C target-feature=-crt-static'`. Start de testinstantie met een eigen `OPDS_DATA_DIR` en met de MCP-testkoppeling.

- [ ] **Step 3: De meetpunten**

1. **Viewports.** Importeer een tekening met meerdere detailvensters op een layout als layout. Het venster meldt evenveel viewports als het verslag tekent (12), en de pagina toont de plattegrond én de detailvensters. Doe dezelfde controle op een van de testbladen, een van de testbladen, een van de testbladen en `pair.dwg`.
2. **Maat blijft kloppen.** Importeer een DXF met een bekende maat (een lijn van 7 500 mm en een van 3 000 mm) op 1:100 en meet ze in de app: 7 500 mm en 3 000 mm, ook op een als nieuwe pagina ingevoegde import. Dit is de bestaande ijkmeting uit fase 5; hij mag door fase 6 niet verlopen.
3. **Kleurentabel.** Twee regels (rood 0,70 mm, blauw 0,13 mm), kleuren op "alles zwart": de dikte verschilt wél, de kleur niet.
4. **Lettervervanging.** Een tekening met `romans.shx` naar vaste breedte; de tekst blijft selecteerbaar en staat op dezelfde plek.
5. **Externe verwijzingen.** Een tekening met een verwijzing naast het bestand: geladen en zichtbaar. Dezelfde tekening in een map zonder de verwijzing: melding "niet gevonden", import gaat door. Een verwijzing met een pad dat buiten de map wijst: niet geladen, geen fout.
6. **Afbeeldingen.** Een tekening met een PNG en een met een JPEG: ingesloten, op de goede plek, geknipt op de kaderlijn.
7. **Blokken als formulier.** Een blad met veel herhaalde symbolen: bestandsgrootte met en zonder hergebruik, en een beeldvergelijking (PyMuPDF) die laat zien dat er niets verschuift.
8. **Voorbeeldweergave.** Schuif de schaal en de marge; het beeld werkt 300 ms na de laatste wijziging bij, een druk op Annuleren stopt hem, en er blijft geen tijdelijk bestand staan. Sleep een venster in het voorbeeld: het tabblad Coördinaten springt naar "Venster" met de gesleepte waarden.
9. **Onderlegger.** Open een bestaande PDF, importeer een tekening als onderlegger met 50 % dekking en "onder de bestaande inhoud", sla op, open opnieuw: het lijnwerk staat onder de bestaande inhoud en is nog vector (inzoomen blijft scherp).
10. **Wachtrij.** Sleep drie tekeningen tegelijk op het venster: ze komen één voor één aan de beurt, geen enkele verdwijnt.
11. **Dubbele laagnamen.** Importeer twee keer dezelfde tekening als nieuwe pagina in één document: het lagenpaneel toont geen twee gelijke namen.
12. **Afbreken en grenzen.** Breek een zware import af: geen half bestand, geen achtergebleven deelbestand. Zet `maxVisits` laag via `app_import_cad`: `IMPORT_TOO_COMPLEX` met de vertaalde uitleg.
13. **MCP.** `app_import_cad` met `target: "underlay"` en met `target: "new"`.
14. **Tabblad Weergave (sinds Task 11).** Zuiver zwart-wit met drempel 50 en met drempel 90 op een tekening met lichte en donkere effen vullingen: het verslag telt wat wegviel en het aantal verschilt. Eén eigen kleur: lijnen, tekst en vullingen in die kleur. Zoekpad toevoegen voor een verwijzing die niet naast de tekening staat: de lijst springt van "niet gevonden" naar "gevonden" zonder dat de lagenkeuze terugspringt; een zoekpad dat niet meer bestaat krijgt zijn melding. Sluit en open het venster: kleurentabel, letterkeuzes, zoekpaden en de instellingen onder "Geavanceerd" staan er nog, ook via een voorinstelling.

- [ ] **Step 4: Regressie op de hele verzameling**

Draai de sweep uit Task 1 Step 7 op de releasebuild over alle 365 tekeningen: geen crash, geen enkel bestand dat eerder lukte en nu faalt, en voor elke layout evenveel gemelde als getekende viewports. Bewaar het verslag als JSON in een eigen tijdelijke map (verificatiebestanden blijven ongemoeid).

- [ ] **Step 5: Opruimen**

Stop de testinstantie, verwijder de testbranch, controleer de hash van het voorkeurenbestand en ruim de tijdelijke mappen op.

---

### Task 17: Het ontwerp bijwerken

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-export-dxf-dwg-ifc-design.md`

- [x] **Step 1: De statusregels**

- De kop: status van fase 6 op "gebouwd en gemeten", met de datum.
- Deel E2: bij "Viewports met papiermaat, modelhoogte (→ schaal), draaiing, bevroren lagen" de bevinding toevoegen dat in DWG `view_target` de verschuiving naar het model draagt en `view_center` vaak (0,0) is, en dat de bladviewport te herkennen is aan de combinatie `view_center == center`, `view_height == height` én `view_target == (0,0,0)`.
- Deel E3: "Blokken als formulier-XObject (fase 2)" wordt "gebouwd", met de voorwaarde (alleen plaatsingen die op een verschuiving na gelijk zijn).
- Deel E5, tabblad Weergave: per regel de stand bijwerken; "Tekst · als omtrek" blijft open met de reden.
- Deel E5, Onderin: voorbeeldweergave en onderlegger op "gebouwd".
- Deel J: fase 6 als afgerond beschrijven, met wat er in zit en wat er open blijft.

- [x] **Step 2: Nieuwe meetresultaten**

Voeg aan Deel F of een nieuwe alinea in Deel G toe wat Task 16 heeft gemeten: de viewportsweep (gemeld = getekend op alle layouts), de ijkmeting 7 500 / 3 000 mm, de winst van blokken als formulier, en de uitkomsten voor verwijzingen en afbeeldingen. Noem geen namen van commerciële software; verwijs naar "de verificatieverzameling" en naar bestandsnamen.

- [x] **Step 3: Open risico's**

Voeg aan Deel H toe:

| Risico | Ernst | Maatregel |
|--------|-------|-----------|
| Een gedraaide viewport (`twist`) is niet tegen een echte tekening bevestigd | middel | De formule volgt de beschrijving van het formaat: positief draait het model op papier tegen de klok in, `view_center` staat in het beeldvlak, en een DXF geeft de hoek in graden waar een DWG radialen geeft (de beoordeling rekent om). Getest met opgebouwde vensters; in de verificatieverzameling (433 viewports) komt geen enkele draaiing voor. Nakijken met een render zodra er een blad met een gedraaid venster opduikt |
| De vlag "niet-rechthoekig knippen aan" (bit 0x10000 van de viewportstatus) zit niet in het documentmodel | laag | De handle van de knipgrens is het kenmerk; de lezer vult hem alleen bij een viewport die een grens draagt (alleen DWG: de DXF-lezer leest de handle niet). Een bestand dat de grens bewaart maar het knippen uitzet, wordt toch geknipt |
| Een spline of een regio als knipgrens valt terug op de rechthoek van de viewport | laag | Polylijn (met bogen), cirkel en gesloten ellips worden wel gevolgd; in de verzameling zijn alle eigen grenzen polylijnen |
| Een eigen UCS per viewport (`ucs_per_viewport`) wordt niet toegepast | laag | Kwam in de hele verzameling niet voor; de viewport wordt dan als gewoon bovenaanzicht getekend. Melden zodra er een bestand opduikt waar het misgaat |
| Lagen uit een externe verwijzing staan niet in de lagenlijst van het venster | laag | Ze komen wel mee en volgen de laagnamen van de verwijzing; het lagenfilter werkt op naam. Een verwijzing openen tijdens de verkenning zou elk venster traag maken |
| Vet is nagebootst met een streek, niet met een vette letter | laag | De breedtes blijven die van de rechte letter, dus de regel blijft op zijn plaats; een echte vette letter zou een tweede breedtetabel vragen |
| Een layout zonder bruikbare papiermaat kan een te grote pagina opleveren (`IMPORT_PAGE_TOO_LARGE`, gezien op één bestand) | middel | De gebruiker kan het papier zelf kiezen; de melding noemt de gevraagde maat. Noemt de tekening zelf een papier boven de grootste PDF-pagina (14 400 pt), dan telt dat als "geen papier" en kiest de inhoud een standaardblad; kiest de gebruiker zo'n maat, dan is het een fout, en het venster laat hem niet invullen |
| De terugweg naar CAD is zo nauwkeurig als de PDF ertussen | laag | De import schrijft paginacoördinaten in duizendsten van een punt: een half duizendste punt afronding is op papier 0,00018 mm en op 1:100 dus ongeveer 0,02 mm in het model (op 1:1000 0,2 mm). De matrix zelf (twaalf cijfers, in 64 bits gelezen) draagt niets meetbaars bij. Wie het nauwkeuriger wil, moet de tekening zelf bewaren, niet de PDF |
| De voorbeeldstand laat bij een zware ruimte inhoud weg | laag | Boven 200 000 entiteiten (geteld ná de laagkeuze, per ruimte): geen tekst, geen maatvoering en verwijslijnen, arceerpatronen alleen als omtrek; effen vullingen blijven. Het venster meldt het (`previewSimplified`). Een voorbeeld-PDF draagt `/OPS_Preview true`; alleen het voorbeeldcommando maakt er een, en de app weigert zo'n PDF bij invoegen, samenvoegen en opslaan |
| Het vangnet "de eerste viewport over het hele blad is het blad" kan een echt venster wegnemen | laag | De grens is 95 % van het papier of van de limieten. Met 10 mm marge rondom vult een venster op A1 94 % en op A0 96 %: op A0 scheidt de grens blad en venster dus niet zuiver. In de verificatieverzameling raakt het vangnet geen enkele viewport. De import meldt elk geval (`sheetByCoverage`), in de verkenning en in het verslag |
| Een venster is niet weg te laten via de laag van zijn kader | laag | Zoals in CAD verbergt die laag (uit, bevroren, niet-plotbaar of uitgevinkt) alleen het kader; de inhoud volgt de lagen van het model en de lagen die in het venster bevroren zijn. Wie een venster niet wil, zet het in de tekening uit of laat de lagen van de inhoud weg |
| Het lezen van de terugweg uit een vreemde PDF is begrensd, niet onbeperkt | laag | Nestdiepte 64 (lineaire voorscan vóór de PDF-bibliotheek), 2 miljoen waarden, 8 MB tekst en 256 MB uitgepakte objectstromen per leesronde, alleen `FlateDecode`. Een bestand daarboven geeft `NO_MODEL_SPACE`. De kruisverwijzingsstroom pakt de bibliotheek nog zelf en onbegrensd uit: dat vraagt een eigen lezer voor de kruisverwijzingen |
| Alleen JPEG en PNG worden ingesloten | laag | Een andere extensie wordt niet gezocht en telt als "niet gevonden"; een gevonden bestand van een andere of beschadigde soort telt als "niet ondersteund" (`imagesUnsupported`) |
| De beelden van één import samen mogen ingepakt 128 MB zijn en uitgepakt 512 MB aan werk kosten | laag | Wat er niet meer bij past wordt gemeld als "te groot" (`imagesTooLarge`) en de import gaat door; de namen staan in het verslag. De grenzen staan in de moduledoc van `image.rs`; neem ze op in de tabel van werkgrenzen van het ontwerp |
| Tussen het oplossen van een pad en het openen kan wie in de map mag schrijven het bestand verwisselen voor een koppeling naar buiten | laag | Dezelfde grens als de harde koppeling: het vraagt schrijfrechten in een map die de gebruiker zelf heeft aangewezen. Grootte en bytes komen wel van één geopende handle |

- [x] **Step 4: Committen**

```
docs(cad): stand van de import na fase 6 in het ontwerp (#400)
```

---

## Fixgolf na de review van taken 6 tot en met 8

De review van de taken 6, 7 en 8 (met wat uit de eerdere rondes openstond) is in één ronde verwerkt. Wat daardoor anders is dan de taken hierboven beschrijven:

**Task 1 (viewports).**
- De laag van een VIEWPORT is de laag van zijn kader, zoals in CAD: uit, bevroren, niet-plotbaar of door de gebruiker uitgevinkt verbergt alleen het kader (dat de import nooit tekent), nooit wat het venster toont. De inhoud volgt de lagen van de modelentiteiten en de lagen die in het venster bevroren zijn. De review stelde voor om een venster op een uitgezette of bevroren laag met inhoud en al weg te laten; dat is gebouwd, nagekeken tegen het gedrag van CAD en weer teruggedraaid. Een venster bewust weglaten kan niet via zijn laag, wel via de zichtbaarheid van het venster zelf als het bestand die draagt. De verkenning meldt per venster de laag van het kader (`layer`), ter informatie; gemeld is getekend bij elke laagkeuze (vijf gevallen maal drie laagkeuzes getest).
- Het vangnet "de eerste viewport zonder nummer over het hele blad is het blad" is een eigen uitkomst (`ViewportUse::SheetByCoverage`) met de waarschuwing `sheetByCoverage`, in de verkenning en in het verslag. De onderbouwing van de 95 % staat bij `SHEET_COVER`: met 10 mm marge vult een venster op A1 94 % en op A0 96 %, dus op A0 scheidt de grens niet zuiver.
- Een eigen knipgrens wordt afgesneden op de rechthoek van de viewport; raakt ze die nergens, dan geldt de rechthoek. Een grens die er al binnen ligt, blijft punt voor punt wat ze was.
- `plan_layout_page`: het eigen papier van de layout blijft langs alle vier de wegen binnen de grootste PDF-pagina. Noemt de tekening zo'n papier, dan is het "geen papier"; koos de gebruiker het, dan is het `IMPORT_PAGE_TOO_LARGE`. Het venster begrenst de invoer op 5080 mm.

**Task 5 (afbeeldingen).** Een JPEG gaat van het uitpakwerk af met breedte × hoogte × kanalen, niet met zijn bestandsgrootte: de import pakt hem niet uit, de kijker van de PDF wel.

**Task 6 (formulieren).**
- Een formulier dat binnen de opname van een ander blok voor het eerst wordt opgenomen, telt uitgevouwen mee voor het formulier eromheen (het stond er alleen met de regel die het plaatst: een blok-in-blok-in-blok telde daardoor 7,5 kB waar het plat 39 kB kost). Hetzelfde voor plaatsingen in een opname die geen formulier wordt.
- Een blok zonder bekende omhullende dat wel iets in de stroom zette, wordt nooit overgeslagen.
- De bezoeken die een geplaatst formulier bijschrijft, tellen mee voor het vragen naar afbreken en voor de voortgang.

**Task 7 (voorbeeldstand).**
- De grens van 200 000 telt entiteiten ná de laagkeuze en beslist per ruimte (`PageResult.simplified`). Effen vullingen blijven, een patroon wordt zijn omtrek; verwijslijnen (LEADER, MULTILEADER) volgen de schakelaar voor maatvoering en vallen dus ook weg.
- Een voorbeeld-PDF draagt `/OPS_Preview true` in de catalogus en op elke pagina. `import_cad_to_pdf` weigert `preview: true` (`IMPORT_PREVIEW_ONLY`); de app weigert een gemerkte PDF bij invoegen, samenvoegen en opslaan.

**Task 8 (terugweg naar CAD).**
- `resolve_model_space(pdf_path, page_index, options, cancel)` heeft een afbreekvlag gekregen; de schil geeft die van de export mee.
- Het lezen is begrensd: een lineaire voorscan op nestdiepte (grens 64) gaat vooraf aan de PDF-bibliotheek, die recursief en zonder grens leest (200 000 open haken kostten de stapel en daarmee het proces). De bibliotheek levert alleen nog de kruisverwijzingen; de paginaboom en de objecten leest de module zelf, elk object één keer, met één budget per leesronde voor waarden, tekst en uitgepakte objectstromen (alleen `FlateDecode`, begrensd uitgepakt).
- `choose`: twee even goede kandidaten met een andere afbeelding zijn `MODEL_SPACE_AMBIGUOUS`; "het hele blad" toetst ook de plaats. Een aanwezige maar onbekende `/OPS_ModelUnits` is `MODEL_UNITS_UNKNOWN:<naam>` in plaats van stil millimeter. Een bestand dat niet te openen is, is een bestandsfout en geen `NO_MODEL_SPACE`.
- `scan_page` zoekt bij de oorsprong van het model zelf de terugweg op en telt op de schaal van de export (`PageScan.scale_denominator`).
- Een spiegelende terugweg: tekst blijft leesbaar en op haar plek.

**App.** De opruiming van werkbestanden neemt ook `opds-edit-…` mee en laat staan wat een open document gebruikt; het sluiten van een tabblad wacht het vrijgeven af. De brontekst-test op de werkbestanden is vervangen door gedragstests.

**Tests van de app-crate onder de MSVC-toolchain.** `cargo test -p open-pdf-studio --lib` start niet (`STATUS_ENTRYPOINT_NOT_FOUND`): het testprogramma mist het manifest voor de gemeenschappelijke besturingselementen. Werkwijze: bouwen met `--no-run`, het programma kopiëren naar een nieuwe naam met ernaast een `<naam>.exe.manifest` dat `Microsoft.Windows.Common-Controls` 6.0.0.0 vraagt, en dat draaien met het filter `cad_`.

**De voorscan op echte bestanden.** De 32 PDF's van de verificatieverzameling (303 MB samen) gaan in 1,6 s door de voorscan en geen enkele wordt voor te diep genest aangezien (meetrit `real_files_are_never_too_deep`, met `OPDS_PDF_SWEEP_DIR`). Het lezen van de terugweg uit de grootste (116 MB) kost met voorscan en kruisverwijzingen samen 1,5 s.

**Sweep na deze ronde** (365 tekeningen, 693 layouts, met de standaarden van het venster: lagen die uit staan, bevroren zijn of niet geplot worden weggelaten; `import_drawing --window-defaults`): 154 layouts geven een PDF (533 zijn leeg, 6 geven `IMPORT_PAGE_TOO_LARGE` zoals voorheen). Gemeld 260 en getekend 260 viewports op 105 layouts, 1 overgeslagen 3D-viewport, geen enkel geval van `sheetByCoverage`: gelijk aan de vorige stand (260). Van de 260 vensters staan er 169 op een laag die alleen niet geplot wordt en 91 op een gewone laag; geen enkel venster in de verzameling staat op een laag die uit staat of bevroren is. De sweep is gedraaid met de tussenstand waarin zo'n laag het venster nog meenam; omdat dat geval in de verzameling niet voorkomt, is de uitkomst met de eindstand (de laag verbergt alleen het kader) dezelfde. 13 tekeningen geven geen verkenning: 8 zijn te oud (`IMPORT_TOO_OLD`), 4 zijn onleesbaar (`IMPORT_READ`) en één tekst-DXF van 475 MB kwam niet binnen de tijdsgrens van de sweep (300 s) door het lezen, en los gedraaid ook niet binnen 585 s (het geheugen stond toen op 1,9 GB; het lezen is in deze ronde niet aangeraakt, zie het risico "DXF-lezer kwadratisch" in het ontwerp).

---

## Volgorde en reviewpoorten

Taken 1 tot en met 8 raken de crate (taak 8 ook de exportschil in `src-tauri`) en zijn los te reviewen; elk sluit af met een groene `cargo test -p open-pdf-cad`. Taak 9 hangt aan 2 tot en met 8 (de argumenten en het commando), taak 10 aan 9 (de teksten), taken 11 tot en met 14 aan 10, taak 15 aan 13, en taken 16 en 17 aan alles. Binnen 1 tot en met 8 is de volgorde vrij, behalve dat taak 6 ná taak 5 komt (de formulierbronnen bevatten de beeld-XObjects) en taak 3 vóór taak 5 en 6 (alle drie raken `PageBuilder::finish`).

Vóór elke commit: `npm run test:unit`, `npx vite build` en `cargo test -p open-pdf-cad` groen. Niet pushen.
