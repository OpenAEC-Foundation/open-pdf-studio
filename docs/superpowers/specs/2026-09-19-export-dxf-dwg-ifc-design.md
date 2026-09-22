# Uitwisseling met CAD en BIM: export naar DXF, DWG en IFC, import van DWG en DXF

Ontwerp, 19 september 2026. Issue #400. Status (22 september 2026): de export
(fase 1 en het exportvenster) en de import van DWG en DXF (fase 5 en fase 6, zie
Deel J) zijn **gebouwd en gemeten**; de terugweg naar het model (modelmatrix)
is gebouwd en bereikbaar via het exportvenster en de MCP-opdracht; IFC is
alleen ontworpen.

## Aanleiding

Tekeningen komen vaak alleen als PDF binnen. Het lijnwerk terug in een CAD- of
BIM-model krijgen betekent nu overtekenen of een los conversieprogramma. De
meeste bouwtekeningen zijn vector-PDF's: de geometrie zit er al in. Omgekeerd
komt er regelmatig een DWG of DXF binnen die je in deze app wilt bekijken,
bemeten en van opmerkingen voorzien; ook daarvoor is nu een ander programma
nodig.

Dit document beschrijft beide richtingen, omdat ze dezelfde begrippen delen
(lagen, eenheden, schaal, oorsprong, papierformaat) en dezelfde bibliotheek.

## Beslispunten in het kort

| # | Onderwerp | Aanbeveling |
|---|-----------|-------------|
| 1 | Bron van de geometrie | PDFium-pagina-objecten, via een eigen smalle FFI-laag (niet `pdfium-render`, niet de draw-commands van `open-pdf-render`) |
| 2 | DXF/DWG-bibliotheek | `acadrust` (pure Rust, MPL-2.0); niet de GPL-bibliotheek uit de issuetekst |
| 3 | Eén model | Eén CAD-neutraal geometriemodel; DXF, DWG en later IFC zijn alleen verschillende schrijvers |
| 4 | Plaats van de code | Eigen workspace-crate `open-pdf-cad`; de app-crate bevat alleen de commando-schil |
| 5 | Eenheden en assen | Uitvoer in mm, oorsprong linksonder van de **weergegeven** pagina, y omhoog; `/Rotate` en de paginabox-oorsprong verwerkt |
| 6 | Lagen | OCG-naam van het object, anders kleur + lijndikte |
| 7 | DWG-versie | Standaard 2013-formaat (AC1027); keuze 2004, 2010, 2013, 2018 |
| 8 | IFC | Eigen kleine STEP-schrijver in dezelfde crate, IFC4, `IfcAnnotation` per laag |
| 9 | Import | DWG/DXF → nieuwe vector-PDF-pagina op schaal; "onderlegger" is dezelfde pagina, geplaatst als vectorknipsel |
| 10 | Meetschaal na import | `/VP` + `/Measure` schrijven én de lader van de app die laten lezen |

De onderbouwing staat hieronder; de open vragen voor de maintainer staan aan
het eind.

---

## Deel A — Onderzoek

### A1. Waar komt de geometrie vandaan?

**Wat `pdfium-render` 0.9.1 (de versie in de workspace) biedt.** De
hoog-niveau-API geeft per pagina-object: type, matrix, omhullende, vul- en
lijnkleur, lijndikte, streeppatroon en -fase, lijnkap en -verbinding, knippad
(`get_clip_path`), padsegmenten met Béziers (`segments()`), vulmodus en
gestreken-ja/nee, tekstobjecten met lettergrootte en font, beeldobjecten, en de
kinderen van een formulier-XObject (`PdfPageXObjectFormObject`). Dat is genoeg
voor geometrie.

**Wat ontbreekt.** De inhoudsmarkeringen van een object — en daarmee de
PDF-laag (OCG) waar het op staat — zijn niet bereikbaar:

- de ruwe functies staan wel in de bindings-trait
  (`FPDFPageObj_CountMarks`, `FPDFPageObj_GetMark`,
  `FPDFPageObjMark_GetParamStringValue`, `src/bindings.rs` vanaf regel 7955),
  maar er is geen hoog-niveau-omhulling (geen treffer op `CountMarks` onder
  `src/pdf/`);
- de object-handle is privé (`object_handle()` in de `pub(crate)`-trait
  `PdfPageObjectPrivate`, `object/private.rs:43`), net als de pagina- en
  documenthandle;
- de bindings-instantie is sinds 0.9 een privé-static (`BINDINGS`,
  `src/pdfium.rs:50`), en `Pdfium::bind_to_library` weigert een tweede
  binding zodra de app de eerste heeft gemaakt
  (`PdfiumLibraryBindingsAlreadyInitialized`, `src/pdfium.rs:143-156`).

Mengen van hoog-niveau-objecten met ruwe aanroepen kan dus niet.

**PDFium zelf levert de laagnaam wél.** Bij `/OC /MC0 BDC … EMC` lost PDFium
de verwijzing naar `/Properties` op; de parameter `Name` van de markering is de
OCG-naam. Gemeten op het referentieblad met 41 PDF-lagen (41 OCG's,
`/Rotate 90`): alle 3422 pagina-objecten dragen een `OC`-markering, met 41
verschillende namen ("-Legenda Gas" 1094×, "G_PIPE_LABEL" 320×, "Topo|topo"
143×, …). De export zet ze om in 41 lagen met dezelfde namen (alleen tekens die
in een laagnaam verboden zijn worden een onderstrepingsteken: `Topo|topo` →
`Topo_topo`).

**Gekozen oplossing: een eigen smalle FFI-laag** (`open-pdf-cad/src/pdfium_ffi.rs`)
die met `libloading` — al aanwezig in de lock via `pdfium-render` — 45 C-functies
bindt uit **hetzelfde bibliotheekbestand** dat de app al laadt. Het
besturingssysteem geeft dan dezelfde module-instantie terug, dus de
bibliotheektoestand is gedeeld; `FPDF_InitLibrary` is idempotent en
`FPDF_DestroyLibrary` wordt nooit aangeroepen. Voordelen: OCG-lagen,
onafhankelijk van API-wijzigingen in `pdfium-render` (0.8 → 0.9 brak veel),
werkt in de app, in de sidecar en in tests. Nadeel: ~150 regels
FFI-declaraties in eigen beheer. Als `pdfium-render` later een markeringen-API
krijgt, kan de laag vervallen zonder dat de rest verandert: alleen `extract.rs`
raakt PDFium.

**Alternatief: de draw-commands van `open-pdf-render` hergebruiken.**
Afgewezen, om vijf redenen die in de code te zien zijn:

| Punt | Draw-commands (`interpreter.rs`, `draw_commands.rs`) | PDFium-pagina-objecten |
|------|------------------------------------------------------|------------------------|
| Lagen (OCG) | Geen: `BDC`/`EMC` worden niet bijgehouden (enige treffer is een lexertest) | Ja, via markeringen |
| Zware bladen | Breekt af boven 128 MB buffer (`EXTRACT_DRAW_COMMANDS_BUDGET_BYTES`) — precies de A0-bladen waar dit om gaat | Geen grens; 4,9 miljoen paden gemeten |
| Tekst | Geen tekstobjecten in de buffer (`text_at` wordt nergens aangeroepen); aparte `TextSpan`-lijst zonder hoek | Tekst, lettergrootte, matrix (dus hoek), fontnaam |
| Vorm | Canvas-toestandsmachine (`save`/`restore`/`transform`) in `f32`; de afnemer moet de CTM-stapel opnieuw afspelen | Per object één matrix; keten in `f64` samengesteld |
| Getrouwheid | Eigen interpreter met bekende gaten (inline-afbeeldingen buiten formaat, patronen) | Dezelfde interpretatie als wat de gebruiker op het scherm ziet |

Het voordeel van de draw-commands (pure Rust, stromend, weinig geheugen) weegt
daar niet tegenop; het geheugen van PDFium is bovendien niet de bottleneck (zie
A4).

**Wat de publieke PDFium-API níét geeft, en de terugval:**

| Gegeven | Gevolg | Terugval |
|---------|--------|----------|
| `/UserUnit` | Pagina's met een andere eenheid dan 1/72 inch | `PageFrame::user_unit` is instelbaar; fase 2 leest de sleutel met `lopdf` |
| Kleurruimte van een vulling (patroon, shading) | PDFium meldt zo'n vulling als effen kleur. In het referentieblad A0 met patroonvullingen zijn dat 576 paginagrote "witte" vlakken | Vullingen die ≥ 95% van paginabreedte én -hoogte beslaan worden overgeslagen (optie `skip_page_fills`) |
| Standaardzichtbaarheid van een OCG (`/OCProperties /D /OFF`) | Lagen die in de PDF uit staan komen zichtbaar in de CAD-tekening | Fase 2: met `lopdf` lezen en de laag "uit" schrijven |
| `/OC` op het XObject-woordenboek zelf (in plaats van `BDC`) | Laag niet herkend | Kinderen erven de laag van hun formulierobject als dát een markering heeft; anders kleur/lijndikte-laag |
| Knippad als bewerking | Objecten die groter zijn dan hun knippad komen volledig mee | Volledig weggeknipte objecten vervallen; gedeeltelijk geknipte worden geteld (`objects_clipped`). Fase 2: rechthoekige knippaden echt toepassen |

### A2. `acadrust`

**Licentie.** MPL-2.0 (`Cargo.toml:37`, volledige tekst in `LICENSE`). Geen
enkel bronbestand draagt de kennisgeving "Incompatible With Secondary Licenses"
(Exhibit B), dus artikel 3.3 van de MPL staat toe het geheel onder
LGPL-3.0-or-later te verspreiden. MPL is copyleft per bestand: alleen
wijzigingen **in acadrust-bestanden zelf** moeten onder MPL beschikbaar blijven;
onze eigen code valt er niet onder.

De GPL-bibliotheek uit de issuetekst valt af: GPL-3.0-or-later maakt het
gecombineerde programma GPL, wat niet samengaat met de LGPL-licentie van de
app; ze vraagt een C-toolchain op vier platforms (Windows, macOS, Linux,
Android); en haar eigen documentatie zegt dat schrijven alleen werkt voor de
oudere formaten tot en met 2004, met CRC-fouten bij 2010–2018.

**Onderhoud.** Eerste publicatie 7 februari 2026, 28 versies, laatste (0.5.5)
op 10 september 2026; 12 249 downloads waarvan 9 759 recent; repository met
496 commits, 83 sterren, 38 forks, 7 open issues. Actief, maar jong en met één
hoofdauteur. De stichting heeft al een fork (`OpenAEC-Foundation/acadifc`, in
gebruik bij OpenCADStudio via `[patch.crates-io]`), dus een noodzakelijke
reparatie hoeft niet op upstream te wachten.

**Afhankelijkheden.** 14 crates, allemaal pure Rust (`ahash`, `anyhow`,
`bitflags`, `byteorder`, `encoding_rs`, `flate2`, `indexmap`, `itoa`, `nom`,
`once_cell`, `ryu`, `thiserror`, `web-time`, plus `memmap2` en `rayon` buiten
wasm). Geen C-code, twee `unsafe`-blokken in de hele crate. `flate2`, `rayon`,
`memmap2` en `anyhow` zitten al in de app.

**Wat het schrijft.** Eén documentmodel (`CadDocument`) met twee schrijvers:
`DxfWriter` (tekst en binair) en `DwgWriter`. DWG-versies R13 t/m 2018
(AC1012–AC1032); de enige weigering in de schrijver is "onbekende versie"
(`dwg_writer.rs:512`). De meegeleverde controlematrix
(`src/docs/entity_status_matrix.md`, opgesteld tegen twee gangbare
CAD-programma's) meldt LINE, LWPOLYLINE, ARC, SPLINE, TEXT, MTEXT, effen en
patroon-HATCH en IMAGE als in orde voor DWG in alle versies. In de hele crate
staat geen `todo!()` of `unimplemented!()`.

**Eigen bevindingen (gemeten in deze snede):**

| Bevinding | Bewijs | Gevolg |
|-----------|--------|--------|
| DXF en DWG uit hetzelfde model lezen terug met gelijke aantallen per type | 12 verificatiepagina's, zie deel F | Eén model volstaat |
| SPLINE als Bézier-keten (graad 3, knopen `0,0,0,0,1,1,1,…`) komt exact terug, ook uit DWG | integratietest `spline_mode_and_real_world_scale` | "Krommen behouden" is betrouwbaar |
| `$MEASUREMENT` komt niet in de DWG (de templatesectie wordt leeg geschreven, `dwg_writer.rs:1387`) | teruggelezen waarde 0 | Onschuldig: lijntypen staan in tekeneenheden met `$LTSCALE` 1. Melden upstream |
| `TextStyle::true_type_font` wordt door geen schrijver gebruikt | geen treffer buiten `textstyle.rs` | TrueType kiezen via `font_file = "arial.ttf"` (gedaan) |
| Een entiteit kost 2 320 bytes (`size_of::<EntityType>()`), ongeacht het type | meetprogramma | 1 miljoen entiteiten ≈ 2,3 GB; zie A4 |
| **De DXF-lezer is kwadratisch** in het aantal entiteiten: per entiteit twee keer `document.entities().count()` (`section_reader.rs:3448` en `:3721`) | 15,8k entiteiten 0,7 s · 31,8k 2,5 s · 47k 6,4 s · 165k 82 s · 431k > 15 min; dezelfde inhoud als DWG: 165k in 0,17 s | Raakt de **import** van grote DXF's (niet de export). Eénregelige reparatie; upstream melden of in de fork oplossen vóór de import gebouwd wordt |
| Tabelregels zonder handle overleven een DWG-opslag niet altijd | regressietests in OpenCADStudio (`roundtrip_layers`) | Lagen, lijntypen en tekststijlen krijgen bij ons altijd `allocate_handle()` |

**Hoe OpenCADStudio het gebruikt.** `DxfWriter::new(&doc).write_to_file(pad)`
en `DwgWriter::write_to_file(pad, &doc)` (`src/io/mod.rs:393-412`), versiekeuze
2000–2018, lagen met expliciete handle (`layerprops.rs:49-53`), lijntypen met
handmatig gezette `pattern_length` (`io/linetypes.rs:139-148`), arceringen met
`BoundaryPath::external()` + `PolylineEdge` (`scene/entity.rs:1774-1824`), tekst
met hoek in radialen (`commands/dim.rs:1043`). Let op: OpenCADStudio draait op
de fork van 0.4.0, niet op de gepubliceerde 0.5.5; onze code is tegen 0.5.5
geschreven en getest.

**Omvang van het programma.** Eigen meting, losse uitvoerbare bestanden
(release, zonder LTO): alleen exporteren 5,35 MB, alleen lezen 5,54 MB, tegen
0,13 MB voor een leeg programma. De hoofdsessie mat in de release-build van de
app ongeveer **4,3 MB** voor alleen schrijven en **7,6 MB** voor lezen plus
schrijven. Dat past bij elkaar: lezer en schrijver delen het model.

### A3. Coördinatenmodel

PDF-gebruikersruimte is y-omhoog, net als DXF/DWG: er is **geen spiegeling**
nodig. De uitvoerruimte is de pagina *zoals ze wordt weergegeven*:

```
u = x − box.links        v = y − box.onder          (box = CropBox ∩ MediaBox)
/Rotate   0:  (u, v)            90:  (v, W − u)
        180:  (W − u, H − v)   270:  (H − v, u)      (W, H = maten van de box)
X_mm = x_weergave × UserUnit × k        k = 25,4/72 (papier) of N × 25,4/72 (1:N)
```

- **Oorsprong buiten (0,0).** CAD-plots hebben vaak een MediaBox rond de
  oorsprong (referentieblad met grote negatieve oorsprong, p2: `[-2578,2 -1191,96 2578,2 1191,96]`;
  het zware vectorblad: `[-846,24 -595,26 …]`). De boxoorsprong wordt eerst
  afgetrokken. Het referentieblad met geneste formulieren heeft een y-oorsprong van 7,83 pt en
  het synthetische cropbox-blad een CropBox binnen de MediaBox; alle vier zijn
  gemeten (deel F).
- **Relatie met de annotatieruimte van de app.** Die is dezelfde weergegeven
  pagina, maar met y omlaag en de oorsprong linksboven: `y_uit = hoogte −
  y_app`. Annotaties kunnen dus later mee zonder eigen rotatielogica.
- **Matrixketen.** Per object één matrix (`FPDFPageObj_GetMatrix`); bij
  formulier-XObjects geldt `punt × M_kind × M_formulier × … × M_pagina`.
  Alles wordt in `f64` samengesteld; PDFium levert `f32`-punten, wat op een
  A0 (3 400 pt) een resolutie van ~0,0001 mm geeft.
- **Tekst.** Invoegpunt = oorsprong van de tekstmatrix; hoogte = lettergrootte
  × verticale schaal × factor (zie onder); hoek = hoek van de x-as van de
  matrix ná de paginatransformatie; breedtefactor = x-schaal / y-schaal.
  Een CAD-teksthoogte is de hoogte van **hoofdletters**, een PDF-lettergrootte
  die van het em-vierkant. De standaardfactor is 0,72 (hoofdletterhoogte van
  gangbare schreefloze letters); instelbaar.
- **Lijndikte en toleranties zijn papiermaten.** Bij uitvoer op ware grootte
  schalen de afvlaktolerantie en de collineariteitstolerantie mee met de
  schaalnoemer; lijndiktes blijven in papier-millimeters (DXF-lijndiktes zijn
  plotmaten) en worden afgerond op de 24 waarden die het formaat kent.

**Ware grootte via de meetschaal.** Twee bronnen:

1. *De maatvoering van de app.* Eén grootheid: `pixelsPerUnit` (PDF-punten per
   eenheid) plus `unit`; per punt opgelost door
   `getMeasureScale(pagina, x, y)` in de volgorde schaalgebied → viewport →
   schaalbalk → documentschaal → voorkeur → 1
   (`js/annotations/measurement.js:18-47`). De omrekening is
   `mm_per_punt = mmPerEenheid / pixelsPerUnit`
   (`js/symbols/real-size.js:15-23`); de crate heeft daarvoor
   `OutputScale::from_points_per_unit`. De documentschaal staat **niet** in de
   PDF maar in `localStorage` (`ops_measureScale_<pad>`); schaalgebieden staan
   als `/Square`-annotatie met `OPS_`-sleutels in de PDF.
2. *De PDF zelf: `/VP` met `/Measure`.* Nergens in de app gelezen (geen treffer
   op `VP` of `Measure` in de Rust-code; in JS alleen per maatlijn-annotatie).
   Komt in de verificatieset wél voor: het referentieblad A1 heeft drie
   viewports met `/X [<< /C 17.63734 >>]` (1 pt = 17,64 mm → 1:50),
   het referentieblad op schaal 1:100 heeft `/R (1 cm = 1 m)` met `/C 0.03527778` en `/U (m)`
   (→ 1:100).

Voor de export geeft de webview de schaal mee (bron 1); fase 2 leest bron 2 in
Rust als terugval, zodat ook een export zonder app-context (MCP, opdrachtregel)
op ware grootte kan.

**Meerdere schalen op één pagina.** Een blad met details op verschillende
schalen kan niet in één keer op ware grootte: elk gebied zou om zijn eigen
oorsprong opgeblazen worden en over de andere heen vallen. Daarom geldt per
export **één schaal**: de schaal van het gekozen schaalgebied (en dan wordt
alleen dat gebied geëxporteerd), of een schaal voor de hele pagina.

### A4. Geheugen en duur

Gemeten met `scripts/measure_export.py` (release-build, DXF, standaardopties).

| Pagina | Paden | Entiteiten | Duur | Piekgeheugen | DXF | DWG |
|--------|------:|-----------:|-----:|-------------:|----:|----:|
| Referentieblad A1, p1 | 1 917 | 2 528 | 0,05 s | 12 MB | 1,1 MB | 0,15 MB |
| Zwaar vectorblad p18 (A0) | 16 848 | 15 846 | 0,07 s | 54 MB | 3,6 MB | 0,44 MB |
| Referentieblad 1:100, p1 | 118 895 | 46 951 | 0,22 s | — | 13,4 MB | 1,3 MB |
| Zwaar vectorblad p19 (A0) | 176 045 | 165 519 | 0,86 s | 420 MB | 37 MB | 6,5 MB |
| Uiterste geval p1 (A0, 139 MB inhoud) | 4 923 201 | 2 459 192 | 21,9 s | 6,3 GB | 624 MB | — |

Waar het geheugen zit (p19, per fase): laden 71 MB, uitlezen 77 MB, opbouwen
400 MB, schrijven 420 MB. PDFium's geparste pagina en ons eigen model zijn dus
klein; **het `CadDocument` van de bibliotheek is de bottleneck** (2,3 kB per
entiteit). Bij het uiterste geval: uitlezen 1,6 GB (waarvan PDFium 1,4 GB), opbouwen 6,3 GB.

Dat blad is het uiterste geval van de verificatieset: uitlezen 10,8 s (waarvan
PDFium 4,6 s parsen), opbouwen 3,9 s, schrijven 5,4 s. Zonder het aaneenrijgen
van lijnstukken waren het 3,6 miljoen entiteiten en 9,0 GB (17,6 s); mét
aaneenrijgen 2,46 miljoen entiteiten en 6,3 GB. **6 GB is te veel om
stilzwijgend in de app te doen**; zie de grens in deel B en de risico's. Ter
vergelijking: de op één na zwaarste pagina (p19) blijft onder een halve GB.

---

## Deel B — Architectuur van de export

### Crate-indeling

```
open-pdf-cad/                     LGPL-3.0-or-later, bouwt en test zonder de app
  src/geom.rs          punt, matrix, Bézier afvlakken, collineair samenvoegen
  src/page_space.rs    paginabox, /Rotate, UserUnit, schaal → uitvoer-mm
  src/raw.rs           ruwe pagina-inhoud in gebruikersruimte
  src/pdfium_ffi.rs    45 C-functies van PDFium via libloading        ┐ enige plek
  src/extract.rs       pagina-objecten doorlopen, OCG, knippad, tekst ┘ met PDFium
  src/model.rs         CAD-neutraal model: lagen, lijntypen, entiteiten
  src/convert.rs       ruw → model: eenheden, afvlakken, rijgen, lagen
  src/writer.rs        model → acadrust → DXF / binaire DXF / DWG     ← enige plek met acadrust
  src/lib.rs           extract_page(), write_page(), export_page()
  examples/export_page.rs   opdrachtregel-export (JSON-verslag)
  examples/inspect_cad.rs   leesproef DXF/DWG
  scripts/                  verify_export.py, verify_batch.py, measure_export.py, inspect_batch.py
  tests/synthetic_page.rs   integratietest zonder externe bestanden
open-pdf-studio/src-tauri/src/cad_export.rs   commando-schil
```

### Gegevensstroom

```
PDFium-pagina ──extract──▶ RawItem (pad | tekst | beeld, gebruikersruimte, OCG-naam)
     │  stromend: elk object gaat direct door, er is geen tweede kopie van de pagina
     ▼
Converter ──▶ Drawing { lagen, lijntypen, entiteiten }   mm, y omhoog
     │  paginasessie dicht: PDFium-geheugen is terug vóór de volgende stap
     ▼
writer::build_document ──▶ CadDocument ──▶ DxfWriter | DwgWriter ──▶ bestand
                                           (eerst naar <naam>.deel, dan hernoemen)
```

Het model is bewust klein (vijf geometriesoorten: lijn, polylijn, Bézier-keten,
vulling met lussen, tekst). IFC en een eventuele stromende DXF-schrijver
sluiten op hetzelfde model aan.

### Tauri-commando's

```
export_page_to_cad(jobId, args) → ExportReport      async, op een blokkerende werkdraad
cancel_cad_export(jobId) → bool
event "cad-export-progress" { jobId, phase: load|extract|build|write, done, total }
```

`args` (camelCase): `pdfPath`, `pageIndex`, `outputPath`, en optioneel `format`
(`dxf` | `dxf_binary` | `dwg`; anders uit de extensie), `version`
(`r2004`…`r2018`), `scaleDenominator`, `curves` (`flatten` | `spline`),
`curveToleranceMm`, `mergeCollinear`, `joinConnected`, `layers`
(`ocg_then_style` | `style` | `single`), `fills` (`hatch` | `outline` | `skip`),
`skipPageFills`, `text` (`text` | `skip`), `textHeightFactor`. Het verslag bevat
aantallen per entiteittype, lagen, wat is overgeslagen en de duur per fase.

**De UI blokkeert niet.** Het commando is `async` en zet het werk op
`spawn_blocking`; de IPC-draad blijft vrij. PDFium is niet thread-safe, dus het
uitlezen gebeurt achter het in-proc-slot van de renderer
(`pdfium_renderer::inproc_guard`, nu `pub(crate)`). Dat slot gaat los zodra de
pagina is uitgelezen; opbouwen en schrijven — samen het grootste deel van de
tijd op zware bladen — houden de renderer niet op. Op Windows rendert de
werkerpool in eigen processen en is het slot vrijwel onbetwist; op Linux en
macOS staat het renderen tijdens het uitlezen stil (gemeten: 0,05–0,5 s voor
gewone zware bladen, 7 s in het uiterste geval). De crate heeft daarnaast een
eigen processlot zodat twee exports tegelijk elkaar niet raken.

**Voortgang.** Fase `load` (PDFium parset; duur onbekend, dus een onbepaalde
balk), `extract` (teller over topniveau-objecten, elke 512 objecten), `build`,
`write`. De schil stuurt hooguit tien events per seconde plus één per
fasewissel.

**Afbreken.** Een vlag per `jobId`, gecontroleerd tussen objecten (elke 512 op
topniveau, elke 2 048 binnen een formulier) en vóór opbouwen en schrijven. Het
bestand wordt eerst als `<naam>.deel` geschreven en pas na succes hernoemd: een
afgebroken of mislukte export laat geen half bestand achter op de plek van een
eerder resultaat.

**Grens op de omvang (fase 2).** Vóór het opbouwen is het aantal entiteiten
bekend. Boven een grens (voorstel: 750 000 entiteiten ≈ 1,7 GB) vraagt de app
de gebruiker om een keuze: doorgaan, vullingen en tekst weglaten, of — alleen
voor DXF — de stromende schrijver gebruiken (fase 3), die het `CadDocument`
overslaat en constant geheugen gebruikt.

**Procesisolatie (fase 3, optioneel).** Dezelfde crate in de
`pdfium-worker`-sidecar met een nieuw protocolbericht `export_page`, in een
vers proces per export: geen slot, afbreken is het proces stoppen, geheugen is
na afloop gegarandeerd terug, en een crash in PDFium raakt de app niet. Pas
zinvol als de grens hierboven in de praktijk te vaak geraakt wordt; de sidecar
bestaat nu alleen op Windows en macOS.

---

## Deel C — Afbeelding van PDF op CAD

| PDF | DXF/DWG | Status |
|-----|---------|--------|
| Gestreken pad, 1 segment | LINE | gebouwd |
| Gestreken pad, meer segmenten | LWPOLYLINE (open of gesloten) | gebouwd |
| Opeenvolgende losse paden die kop-aan-staart aansluiten, zelfde stijl | één LWPOLYLINE (`join_connected`, tot 4 096 punten) | gebouwd |
| Bézier, "afvlakken" | punten in de LWPOLYLINE binnen tolerantie (standaard 0,01 mm papier) | gebouwd |
| Bézier, "behouden" | SPLINE graad 3, stuurpunten exact, drievoudige knopen op de naden | gebouwd |
| Bézier die een cirkelboog is | ARC / CIRCLE, of `bulge` in de LWPOLYLINE | fase 2 (herkenning binnen tolerantie) |
| Rechthoek (`re`) | gesloten LWPOLYLINE met 4 punten | gebouwd |
| Gevuld pad | HATCH, effen, één lus per deelpad (gaten via oneven-pariteit) | gebouwd |
| Vulling + lijn (`B`) | HATCH + LWPOLYLINE | gebouwd |
| Paginagroot vlak | overgeslagen (`skip_page_fills`) | gebouwd |
| Patroon- of shadingvulling | niet te onderscheiden via PDFium; zie A1 | fase 2 (`lopdf`) |
| Tekstobject | TEXT: invoegpunt, hoogte, hoek, breedtefactor, stijl `PDF_TEKST` (arial.ttf) | gebouwd |
| Opeenvolgende tekstobjecten op één regel | samenvoegen tot één TEXT; alinea's tot MTEXT | fase 2 |
| Onzichtbare tekst (modus 3, OCR-laag) | overgeslagen, optioneel mee | gebouwd |
| Tekst als omtrek (geen tekstobject) | gewone lijnen en vullingen | gebouwd (vanzelf) |
| Afbeelding | IMAGE + IMAGEDEF met verwijzing naar `<naam>_img/<n>.png` naast het bestand | fase 2 (nu geteld en overgeslagen) |
| Streeppatroon `[a b …] fase` | LTYPE `PDF_DASH_n` in tekeneenheden, gedeeld per patroon; oneven rij wordt verdubbeld | gebouwd |
| Lijndikte | lijndikte van laag of entiteit, afgerond op de 24 geldige waarden | gebouwd |
| Kleur | ware kleur (24 bit); zuiver zwart wordt index 7, zodat het op een donkere tekenachtergrond zichtbaar blijft | gebouwd |
| Knippad | geheel weggeknipt → vervalt; gedeeltelijk → volledig mee en geteld | gebouwd / fase 2 |
| Shading-object | geteld, overgeslagen | — |
| Formulier-XObject | recursief afgewikkeld (max. diepte 32), matrixketen | gebouwd |
| Annotaties van de app | entiteiten op lagen `OPS_<soort>`; de webview levert ze als eenvoudige vormen in app-ruimte | fase 2 |

### Lagenstrategie

1. **OCG** (standaard als die er is): de naam van de binnenste `/OC`-markering
   van het object, of van het omhullende formulier. Verboden tekens worden `_`,
   lengte ≤ 255, niet hoofdlettergevoelig samengevoegd.
2. **Stijl**: `PDF_<RRGGBB>_W<dikte in 0,01 mm>` voor lijnen,
   `PDF_FILL_<RRGGBB>` voor vullingen, `PDF_TEXT_<RRGGBB>` voor tekst.
3. **Eén laag** `PDF`.

De laag krijgt kleur en lijndikte van het eerste object; latere objecten met
een andere stijl op dezelfde (OCG-)laag dragen hun afwijking zelf. Zo blijft
"volgens laag" kloppen waar het kan, en gaat er nooit stijl verloren.

### DWG-versie

Standaard het **2013-formaat (AC1027)**: gelezen door alle gangbare
CAD-programma's van de laatste tien jaar en door open-source CAD-software, met
ware kleuren en lijndiktes. Keuze: 2004, 2010, 2013, 2018. Ouder dan 2004
bieden we niet aan (geen ware kleuren). 2007 (AC1021) slaan we over: het is het
enige formaat met een eigen, zeldzaam gebruikte codering.

---

## Deel D — IFC (alleen ontwerp)

**Doel volgens de issue:** 2D-lijnwerk als `IfcAnnotation` in een
plattegrondrepresentatie op een gekozen bouwlaag, lagen als
`IfcPresentationLayerAssignment`, IFC4, geen herkenning van bouwelementen.

**Opbouw van het bestand**

```
IfcProject ─ IfcUnitAssignment (mm, radiaal)
  └ IfcGeometricRepresentationContext 'Plan' (2D)
      └ IfcGeometricRepresentationSubContext 'Annotation', PLAN_VIEW
IfcSite ─ IfcBuilding ─ IfcBuildingStorey (naam en peil door de gebruiker gekozen)
  └ IfcRelContainedInSpatialStructure
      └ IfcAnnotation  — één per laag per pagina (niet per lijn: 4,9 miljoen
          │              objecten als losse annotaties is onwerkbaar)
          └ IfcShapeRepresentation 'Annotation' / 'Annotation2D'
              ├ IfcIndexedPolyCurve + IfcCartesianPointList2D   (lijnen, polylijnen, bogen)
              ├ IfcAnnotationFillArea                           (vullingen met gaten)
              └ IfcTextLiteralWithExtent                        (tekst)
IfcPresentationLayerWithStyle (naam = laagnaam, aan/uit)  → de items van die laag
IfcStyledItem → IfcCurveStyle (IfcColourRgb, lijndikte, IfcCurveStyleFont voor strepen)
```

- **Schaal is verplicht.** IFC is een model op ware grootte; zonder meetschaal
  vraagt het venster er een (of bevestiging van 1:1).
- **GlobalId deterministisch** (afgeleid van bestand + pagina + laag), zodat
  een herhaalde export dezelfde objecten oplevert en BCF-verwijzingen blijven
  kloppen.
- **Plaatsing:** `IfcLocalPlacement` ten opzichte van de bouwlaag; de
  paginaoorsprong of een door de gebruiker aangewezen punt wordt het
  invoegpunt, met een optionele draaiing (noordpijl).

**Bibliotheek of eigen schrijver?** Aanbeveling: een **eigen kleine
STEP-schrijver** (ISO 10303-21) als module `ifc` in `open-pdf-cad`, ongeveer 25
entiteitsoorten, met de tekenreeks-escapes van de norm (`\X2\…\X0\`).
Onderbouwing: op crates.io bestaan alleen lezers en geometriekernen
(`ifc-lite-*`, `oxideav-ifc`, `tree-sitter-ifc`) en één schrijvende crate in
alfa-status die sinds december 2024 stilstaat (`ifc_rs` 0.1.0-alpha.9). De
gangbare open-source IFC-bibliotheek is C++/Python met een zware
geometriekern: niet proportioneel voor het wegschrijven van platte entiteiten,
en weer een C++-toolchain op vier platforms. Die bibliotheek gebruiken we wél
in de **tests** (niet in het product) om elk bestand tegen het IFC4-schema te
valideren.

**Samenhang met wat er al is.** `js/pdf/ifc-export.js` schrijft een
`.ifcreport` (JSON in IFCX-vorm) waarin annotaties al op IFC-klassen worden
afgebeeld via `ifcCategoryMap`. De nieuwe export is echte IFC4-STEP; annotaties
met een IFC-categorie kunnen er in een latere stap als `IfcAnnotation` met die
categorie in een eigenschappenset bij (nog steeds geen bouwelementen).

---

## Deel E — Import van DWG en DXF (ontwerp en haalbaarheid)

### E1. Wat is het zinvolste doel?

| Optie | Wat het oplevert | Oordeel |
|-------|------------------|---------|
| **A. Nieuwe vector-PDF-pagina op schaal** (nieuw document of pagina in het huidige) | Een echte PDF: scherp op elke zoom, bemeetbaar, met lagen, te annoteren, te printen en te delen met mensen zonder CAD | **Kern.** Past bij wat de app is: alles wat ze kan werkt meteen op het resultaat |
| B. Onderlegger op een bestaande pagina | De DWG onder of naast bestaande inhoud, met dekking | Nuttig, maar technisch **dezelfde omzetting**: het resultaat van A wordt als vectorknipsel (spec 10 september) op de pagina gezet — verplaatsbaar, schaalbaar, vast te zetten. Geen tweede route |
| C. DWG rechtstreeks weergeven (eigen CAD-weergave) | Bekijken zonder omzetting | Afgewezen: een tweede renderer naast PDFium, en niets van de app (annotaties, meten, printen) werkt erop |
| D. Entiteiten omzetten naar annotaties van de app | Bewerkbaar lijnwerk | Afgewezen als hoofdroute: een tekening heeft 10⁴–10⁶ objecten, de annotatielaag is daar niet voor gemaakt. Wel denkbaar voor een kleine selectie (later) |

**Aanbeveling: A bouwen, B als laatste stap erbovenop.** De omzetter levert
altijd één PDF-pagina; het doel bepaalt alleen wat daarmee gebeurt:
openen als nieuw document, invoegen als pagina (de app heeft `copyPages` al),
of plaatsen als vectorknipsel met dekking.

### E2. Wat `acadrust` bij het lezen betrouwbaar levert

Leesproef met `examples/inspect_cad` over 434 lokale bestanden (alleen
gelezen): de verzameling `verification-files/DWG-DXF` (365 bestanden uit vier
testsets en eigen projecten) en 69 projectbestanden (41 bladen uit een
BIM-export, 26 DXF-profielen van een leverancier, 2 DXF's uit een IFC-export).

| Onderwerp | Resultaat |
|-----------|-----------|
| **Geslaagd** | 419 van 434. DWG 258/269, DXF 161/165 |
| **Mislukt, verwacht** | 12: DWG en DXF van vóór R13 (R1.4 t/m R11; de bibliotheek leest DWG vanaf R13) |
| **Mislukt, onverwacht** | 3 grote DXF's (51, 99 en 499 MB; 380 000+ entiteiten) lopen tegen de tijdslimiet door de kwadratische DXF-lezer (A2). Geen enkele crash, geen enkel beschadigd resultaat |
| **Versies gelezen** | DWG R13, R14, 2000, 2004, 2007, 2010, 2013, 2018 — alle acht; DXF idem plus bestanden zonder versiekop |
| **Snelheid DWG** | 295 729 entiteiten (65 MB) in 1,6 s; 165 000 in 0,17 s. Lineair |
| **Herstelde fouten / overgeslagen records** | 0 in alle 419 bestanden |
| **Entiteiten** | 3,2 miljoen totaal; LINE, LWPOLYLINE, ARC, INSERT, SPLINE, HATCH, ELLIPSE, POINT, MTEXT, CIRCLE, ATTDEF, TEXT, DIMENSION, SOLID, POLYLINE, WIPEOUT, LEADER, MULTILEADER, VIEWPORT, IMAGE, TABLE, … Slechts 30 `UNKNOWN` in 3 bestanden (objecten van een bouwkundige uitbreiding) |
| **Blokken** | INSERT met schaal, hoek en rijen/kolommen; geneste blokken (diepte > 1 in 21 bestanden); de bibliotheek heeft `explode()` en `apply_transform()` voor elk entiteittype |
| **Maatvoering** | DIMENSION verwijst naar een anoniem blok met het getekende resultaat (`block_name`): omzetten = dat blok invoegen |
| **Tekst** | TEXT en MTEXT met stijl; MTEXT-opmaakcodes zijn te ontleden (`to_plain_text()`) |
| **Externe verwijzingen** | Herkend (blokvlag + pad, 14 bestanden), maar niet geladen: dat moet de import zelf doen |
| **Afbeeldingen** | IMAGE met bestandspad (39 bestanden) |

**Welke gegevens levert het bestand voor de beginwaarden van het venster?**

| Gegeven | Beschikbaar | Bruikbaar als beginwaarde? |
|---------|-------------|----------------------------|
| Lagenlijst met naam, kleur, lijndikte, lijntype, **uit/bevroren/vergrendeld/niet-plotten** | altijd | Ja. 44 van 419 bestanden hebben lagen die uit of bevroren zijn |
| Aantal objecten per laag | te tellen (goedkoop) | Ja |
| Eenheden `$INSUNITS` | gezet in 374 van 419 (mm 199, inch 170, m 5; 45 zonder) | Ja, met "overschrijven"; zonder eenheid → mm en een waarschuwing. Alle 69 echte projectbestanden hadden de eenheid gezet |
| Tekeninggrenzen in de kop (`$EXTMIN/$EXTMAX`) | bruikbaar in 340 van 419, maar **slechts in 130 gelijk aan de werkelijke grenzen** | Nee. De import rekent de grenzen zelf uit (één doorgang, inclusief ingevoegde blokken) |
| Limits (`$LIMMIN/$LIMMAX`) | altijd aanwezig, vaak de standaardwaarde 12×9 of 420×297 | Alleen aanbieden als ze de tekening werkelijk omvatten |
| Layouts met naam en volgorde | altijd | Ja |
| Papiermaat van een layout | 65 van de 80 layouts met inhoud | Ja; anders uit de grenzen van de layout |
| Viewports met papiermaat, modelhoogte (→ schaal), draaiing, bevroren lagen | 82 bestanden | Ja: schaal per viewport. Let op: in DWG is het viewportnummer altijd 0, dus de "hele-papier"-viewport is alleen aan zijn maat te herkennen. Bevinding uit fase 6: in DWG draagt `view_target` de verschuiving naar het model en is `view_center` vaak (0,0); de bladviewport is te herkennen aan de combinatie `view_center == center`, `view_height == height` én `view_target == (0,0,0)`. Een DXF geeft de draaiing (`twist`) in graden, een DWG in radialen; de beoordeling rekent om |
| Lettertypen in tekststijlen | arial.ttf 560×, txt 360×, segoeui.ttf, swissc.ttf, romans.shx, isocp.shx, simplex.shx, … | Ja, voor de vervangingstabel |
| Grote coördinaten (> 10⁵) | 73 van 419 | Ja: dan "oorsprong verplaatsen" standaard aan |
| Pentabel (kleur → lijndikte) | **niet in het bestand** | Nee; zie "Lijndiktes" hieronder |

Een opvallend geval uit de projectbestanden: de 41 bladen uit de BIM-export
hebben een **lege modelruimte**; alles staat in de papierruimte van `Layout1`.
Wie daar blind de modelruimte importeert krijgt een lege pagina. Vandaar de
standaardkeuze hieronder.

### E3. Hoe de PDF geschreven wordt

**In Rust, als module `import` in `open-pdf-cad`.** Het ontwerp voorzag
`lopdf`; gebouwd is een eigen, stromende PDF-schrijver (`pdf_writer.rs`,
`pdf_out.rs`) die in stukken wegschrijft en de inhoudsgrens bewaakt, en voor
de terugweg een eigen begrensde lezer (`model_space.rs`) die trailer,
kruisverwijzingen, objectstromen en alleen de objecten op de weg naar de pagina
leest. De crate heeft daardoor geen PDF-bibliotheek meer als afhankelijkheid.
Niet met pdf-lib in de webview: een tekening heeft 10⁴–10⁶ entiteiten en die
horen niet door de IPC en de JS-heap.

```
DWG/DXF ─acadrust─▶ CadDocument
  ─ ruimte kiezen (model | layout) ─ lagenfilter ─ venster
  ─ blokken uitvouwen (INSERT genest, ByBlock/ByLayer oplossen, attributen)
  ─ per viewport: modelaanzicht → papier, geknipt op de viewportrand, eigen bevroren lagen
  ─ krommen: boog/cirkel/ellips/bulge → Béziers; spline → Béziers
  ─ eenheden → mm ─ schaal 1:N ─ oorsprong ─ draaiing ─ plaatsing op het papier ─ punten
  ─ inhoudsstroom per laag:  /OC /Ln BDC … EMC ,  lijndikte `w`, streep `d`, kleur `RG`/`rg`
  ─ pagina: MediaBox, /Resources (fonts, /Properties → OCG's), /VP met /Measure
  ─ catalogus: /OCProperties (lagen, standaard uit voor lagen die uit of bevroren waren)
─▶ PDF-bestand (tijdelijk) ─▶ openen | pagina invoegen | vectorknipsel
```

- **Nauwkeurigheid bij grote coördinaten.** Landelijke coördinaten in mm zijn
  getallen van 10⁸; een PDF-lezer rekent in `f32` (7 cijfers). Alle
  berekeningen lopen daarom in `f64` en de vensteroorsprong wordt afgetrokken
  **vóór** er iets naar de inhoudsstroom gaat: op de pagina staan alleen
  getallen tussen 0 en ~3 400. De verschuiving blijft bewaard (zie onder).
- **Lijndiktes.** Entiteit → laag → standaard (0,25 mm). De koppeling
  kleur → pendikte uit een pentabel staat niet in het bestand; daarvoor komt
  een eigen, op te slaan kleurentabel (voorstel).
- **Tekst.** Fase 1: de standaardletter Helvetica (geen inbedding nodig,
  West-Europese tekens), breedtefactor en schuinstand via de tekstmatrix; de
  tekst blijft doorzoekbaar en selecteerbaar. Gebouwd in fase 6: een
  lettervervanging naar de vier standaardletters (schreefloos of vaste breedte,
  recht of schuin; vet wordt nagebootst met een streek). **Nog open:** een
  ingebedde open letter en tekens buiten WinAnsi — die worden nu `?`, geteld en
  gemeld in het verslag (`characters`).
- **Arceringen.** Effen → gevuld pad met gaten (oneven-pariteit).
  Patroonarcering → patroonlijnen genereren en op de grens knippen (gebouwd in
  fase 6, `hatch.rs`; boven 20 000 patroonlijnen per arcering alleen de
  omtrek).
- **Blokken als formulier-XObject** (gebouwd in fase 6): een blok dat vaker
  dan één keer voorkomt gaat één keer in de PDF en per INSERT een `cm … Do`,
  **alleen** voor plaatsingen die op een verschuiving na gelijk zijn (zelfde
  schaal, hoek en bevroren lagen); een afwijkende plaatsing wordt uitgevouwen.
  De eerste plaatsing wordt gemeten, de tweede opgenomen als formulier.

### E4. Meetschaal: zodat de maatvoering meteen klopt

De import schrijft per (viewport van de) pagina een standaard-viewport:

```
/VP [ << /Type /Viewport /BBox [x0 y0 x1 y1] /Name (…)
        /Measure << /Type /Measure /Subtype /RL /R (1:100)
                    /X [ << /U (mm) /C 35.27778 /D 1 >> ]      % mm per punt
                    /D [ << /U (mm) /C 1 /D 1 >> ]
                    /A [ << /U (m²) /C 0.000001 /D 100 >> ] >> >> ]
```

Dat is de norm (ISO 32000) en wordt door andere PDF-programma's begrepen.
Oorspronkelijk las de app `/VP` niet; er waren twee mogelijkheden, en de
eerste is gebouwd (`js/pdf/pdf-viewports.js`: de lader leest de viewports bij
het openen, `getMeasureScale` gebruikt de binnenste viewport onder het punt,
en na elke paginawijziging — invoegen, verwijderen — worden ze opnieuw
gelezen omdat ze per paginanummer staan):

1. **De lader leert `/VP` + `/Measure` lezen** en maakt er (alleen-lezen)
   schaalgebieden van. *Aanbevolen*: dan kloppen ook PDF's uit andere
   programma's meteen (het referentieblad A1 heeft drie viewports met
   schaal die de app nu negeert), en de export kan dezelfde bron gebruiken.
2. Daarnaast de eigen `scaleRegion`-annotatie schrijven
   (`OPS_Subtype=scaleRegion`, `OPS_ScaleString`, `OPS_Units`). Werkt zonder
   wijziging aan de lader, maar is dubbel en alleen voor deze app.

Bij een layout met meerdere viewports krijgt elke viewport zijn eigen schaal:
een blad met een plattegrond 1:100 en details 1:20 meet na import overal goed.

Een venster met een eigen, niet-rechthoekige knipgrens schrijft in `/BBox` de
omhullende van die grens en daarnaast de vorm zelf als
`/OPS_Clip [x0 y0 x1 y1 …]` (paginapunten). De lader kiest de kleinste
viewport onder het punt, en slaat een viewport met `/OPS_Clip` over als het
punt wel in de omhullende maar buiten de vorm ligt: de lege hoek van een
L-vormig venster is van het buurvenster, ook als dat groter is. Een eigen
grens die gewoon een rechthoek langs de assen is, krijgt geen `/OPS_Clip`.
Een gedraaide viewport is met opgebouwde tekeningen getest maar niet tegen een
echte tekening bevestigd: in de verificatieverzameling komt er geen voor.

**Voorstel — terugweg naar CAD.** In de viewport ook de afbeelding pagina →
model bewaren (`/OPS_ModelMatrix [a b c d e f]`, `/OPS_ModelUnits (mm)`). Dan
kan de app coördinaten in het stelsel van de tekening tonen, en kan de export
een geïmporteerde pagina in de **oorspronkelijke coördinaten** terugschrijven.
*Gebouwd.* De export leest de terugweg begrensd (nestdiepte, aantal waarden,
tekst en uitgepakte objectstromen per leesronde; af te breken) en meldt met
een vaste code wat er ontbreekt: `NO_MODEL_SPACE` (de pagina draagt er geen),
`MODEL_SPACE_AMBIGUOUS:<n>` (meer viewports, of twee even goede met een andere
afbeelding, en het gebied beslist niet) en `MODEL_UNITS_UNKNOWN:<naam>` (een
eenheid die de export niet kent; stil millimeter aannemen zou de maat
bederven). Een bestand dat niet te openen is, is een bestandsfout. De
nauwkeurigheid is die van de PDF ertussen: duizendsten van een punt, op 1:100
ongeveer 0,02 mm in het model.

### E5. Het importvenster

Opzet: links de instellingen in tabbladen, rechts een voorbeeldweergave,
onderin voorinstelling, voortgang en de knoppen. Eén `Dialog.jsx`-venster in
Windows-Forms-stijl (rechte hoeken, titelbalk met verloop `#ffffff`→`#f5f5f5`,
sluitknop rood bij aanwijzen, verplaatsbaar, sluit niet bij klikken ernaast,
standaardcursor). Alle teksten in de naamruimte `dialogs` van de 39 talen.

Herkomst van de beginwaarde: **B** = uit het bestand gelezen, **O** = onthouden
van de vorige keer (voorkeuren, gevalideerd zoals `print-instellingen.js`),
**V** = vaste standaard. Wat uit het bestand komt wint altijd van wat onthouden
is: een laag of layout van een ander bestand zegt niets over dit bestand.

#### Tabblad Lagen — *verplicht*

| Instelling | Betekenis | Standaard | Herkomst | Doorwerking |
|------------|-----------|-----------|----------|-------------|
| Lagenlijst: aan/uit per laag | Welke lagen meegaan | Aan, behalve lagen die in het bestand **uit of bevroren** staan | B | Entiteiten op een uitgezette laag worden niet omgezet (ook niet binnen blokken; laag 0 in een blok volgt de laag van de INSERT) |
| Kolommen | Kleurvlakje, naam, aantal objecten, status (uit / bevroren / vergrendeld / niet-plotten) | — | B | Alleen informatie; sorteerbaar per kolom |
| Alles / Niets / Omkeren | Snelkeuze | — | — | — |
| Zoekfilter | Filtert de lijst op naam (ook `*` en `?`) | leeg | — | "Alles/Niets" werkt op de gefilterde lijst |
| Niet-plotbare lagen | Lagen met "niet plotten" | uit | B | Als uitgezette laag |
| De laag van een viewport | Doet niet mee aan de keuze of een venster getekend wordt | — | B | Zoals in CAD is de laag van een VIEWPORT de laag van zijn **kader**. Staat ze uit, is ze bevroren, wordt ze niet geplot of vinkt de gebruiker haar uit, dan verdwijnt alleen het kader (dat de import nooit tekent); wat het venster toont blijft staan. De inhoud volgt uitsluitend de lagen van de modelentiteiten en de lagen die in het venster zelf bevroren zijn. Een venster bewust weglaten kan dus **niet** via zijn laag; wel via de zichtbaarheid van het venster zelf, als het bestand die draagt (een venster dat in de tekening uit staat, wordt niet getekend en niet gemeld). De verkenning noemt per venster de laag van het kader (`layer`), alleen ter informatie; gemeld is getekend bij elke laagkeuze |
| Lagen behouden als PDF-lagen | Elke laag wordt een OCG met dezelfde naam | aan | O | Inhoud per laag tussen `/OC … BDC/EMC`; zichtbaar in het lagenpaneel. Uit: één platte inhoudsstroom (kleiner) |
| Uitgezette lagen toch meenemen, verborgen | De laag komt mee maar staat in de PDF uit | uit | O | OCG in `/OCProperties /D /OFF` |
| *Voorstel, niet gebouwd:* lagenselectie onthouden per bestandsnaam | Zelfde tekening opnieuw importeren na een revisie | uit | O | Niet gebouwd in fase 5/6: de lagenlijst komt bij elke import uit het bestand en de standaardregel (uit/bevroren) dekt het gewone geval. Open voor een volgende ronde |

#### Tabblad Coördinaten — *verplicht*

| Instelling | Betekenis | Standaard | Herkomst | Doorwerking |
|------------|-----------|-----------|----------|-------------|
| Ruimte | Modelruimte of een layout (papierruimte) | Modelruimte; **de eerste layout met inhoud** als de modelruimte leeg is | B | Layout: papier 1:1, elke viewport rendert zijn modelaanzicht geknipt op zijn rand met zijn eigen schaal en bevroren lagen. Alleen bovenaanzichten; een 3D-viewport wordt overgeslagen met een melding |
| Gebied | Tekeninggrenzen · Limits · Venster | Tekeninggrenzen (zelf berekend) | B | Bepaalt wat op het papier komt; wat buiten het venster valt wordt weggeknipt. "Limits" alleen kiesbaar als ze de tekening omvatten. Venster: vier getallen, of slepen in de voorbeeldweergave |
| Eenheden | Eenheid van de tekening: mm, cm, m, inch (voet) | `$INSUNITS`; zonder → mm, met waarschuwing | B, te overschrijven | Omrekenfactor naar mm vóór de schaal |
| Schaal | 1:1 … 1:1000 uit een lijst, vrij getal, of **Passend op papier** | Passend, afgerond naar de eerstvolgende standaardschaal (1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000); bij een layout 1:1 | V / B | `punten = mm / N × 72 / 25,4` |
| Papierformaat | A4, A3, A2, A1, A0, **A3L 297×630, A2L 420×804, A1L 594×1051**, Letter, Tabloid, aangepast, of **Automatisch** | Layout: papier van de layout. Model: kleinste formaat waar de tekening op de gekozen schaal op past | B / O | MediaBox van de nieuwe pagina. De formatenlijst wordt gedeeld met `PAPER_SIZES` (nu in `NewDocDialog.jsx`) |
| Oriëntatie | Staand, liggend, automatisch | Automatisch (naar de verhouding van het gebied) | V | Wisselt breedte en hoogte; geen `/Rotate` |
| Marges | Rand rondom in mm | 10 mm; 0 bij een layout | O | Verkleint het bruikbare vlak voor "Passend" en voor de plaatsing |
| Plaatsing | Gecentreerd · linksonder · op oorsprong | Gecentreerd | O | Verschuiving op de pagina |
| Draaiing | 0, 90, 180, 270°, of vrij | 0 | V | Draait de tekening vóór de plaatsing (bijvoorbeeld noord naar boven) |
| Oorsprong verplaatsen | Trek de linkeronderhoek van het gebied af vóór de omrekening | altijd intern; de optie bepaalt alleen of de verschuiving bewaard wordt | B | Bewaakt de nauwkeurigheid bij landelijke coördinaten (E3). Het venster toont de verschuiving (bijvoorbeeld "X −155 000 000, Y −463 000 000 mm") |
| Invoegpunt / basispunt | `$INSBASE` of zelf opgeven | `$INSBASE` | B | Referentiepunt voor "op oorsprong" en voor het plaatsen als onderlegger |
| Meetschaal schrijven | `/VP` + `/Measure` per (viewport van de) pagina | aan | V | De maatvoering van de app klopt direct (E4). Geldt voor de doelen "nieuw document" en "nieuwe pagina"; bij "onderlegger" is de optie uitgeschakeld — de meetschaal komt dan van de pagina waarop de onderlegger ligt |
| Modelmatrix bewaren (gebouwd) | Afbeelding pagina → model in de viewport (`/OPS_ModelMatrix`, met `/OPS_Clip` voor een niet-rechthoekige knipgrens) | aan | V | De export terug naar DXF/DWG kan de oorsprong "modelcoördinaten" kiezen en schrijft dan in de oorspronkelijke coördinaten (E6, `resolve_model_space`). Niet bij "onderlegger" (zie boven) |

#### Tabblad Weergave — *gebouwd (fase 6)*

| Instelling | Keuzes | Standaard | Herkomst | Stand en doorwerking |
|------------|--------|-----------|----------|-------------|
| Kleuren | Volgens bestand · alles zwart · grijstinten · zwart-wit (drempel) · één kleur | Volgens bestand | O | Gebouwd. Index 7 en wit worden zwart op papier; anders de kleur van entiteit of laag. Zwart-wit zet alles onder de drempel op zwart en de rest op wit; één kleur kleurt alles in de gekozen kleur |
| Lijndiktes | Volgens bestand · kleurentabel · vaste dikte | Volgens bestand | O | Gebouwd. Entiteit → laag → standaard 0,25 mm. Kleurentabel: eigen tabel kleur → dikte, opgeslagen met de voorinstelling (vervangt de pentabel die niet in het bestand zit) |
| Factor en minimum | Vermenigvuldiger en ondergrens | 1,0 en **0 mm** | O | Gebouwd; **de standaard-ondergrens is 0** en niet de hier eerder voorgestelde 0,05 mm: een haarlijn krijgt dan `w 0` (de dunste lijn van het apparaat), wat overeenkomt met een CAD-plot en op het scherm het scherpste beeld geeft. Wie een minimum wil voor de afdruk, zet het zelf; het wordt onthouden. `w = max(min, dikte × factor)` |
| Lijntypen | Volgens bestand · alles doorgetrokken | Volgens bestand | O | Gebouwd. Patroon × `$LTSCALE` × schaal van de entiteit → `d`; bij papierruimte volgens `$PSLTSCALE` |
| Tekst | Als tekst · weglaten | Als tekst | O | Gebouwd als aan/uit. **"Als omtrek" is niet gebouwd en blijft open:** de omzetter leest geen letteromtrekken (geen SHX- of TrueType-lezer), dus er is geen bron voor een omtrek; het zou een letterlezer in de crate vragen. Tekst blijft doorzoekbaar |
| Lettertypevervanging | Tabel "in de tekening" → "in de PDF" | SHX → schreefloos, anders schreefloos; vaste-breedte-letters → vaste breedte; vet en schuin volgen de stijl | B (lijst) / O (keuzes) | Gebouwd als keuze tussen de vier standaardletters (schreefloos/vaste breedte × recht/schuin; vet als streek). **Niet gebouwd:** "TrueType → zelfde naam als geïnstalleerd" en het inbedden van een letter; tekens buiten WinAnsi worden `?` en geteld. Het venster toont welke letters in de tekening voorkomen |
| Arceringen | Alles · alleen effen · alleen omtrek · weglaten | Alles | O | Gebouwd, met patroonlijnen (E3) |
| Maatvoering | Meenemen · weglaten | Meenemen | O | Gebouwd. Het anonieme blok van de DIMENSION invoegen |
| Blokken en attributen | Uitvouwen of als formulier (automatisch, E3) · attributen tonen ja/nee | ja | O | Gebouwd. Onzichtbare attributen blijven weg |
| Externe verwijzingen | Laden indien gevonden · overslaan; extra zoekpaden kiesbaar | Laden; zoekpad = map van het bestand | O | Gebouwd. Alleen bestanden in de map van de tekening of in een gekozen zoekpad worden geopend; niet gevonden of geweigerd → in het verslag met de bestandsnaam, de import gaat door. Nestdiepte begrensd, kringen geweigerd |
| Afbeeldingen | Insluiten · overslaan | Insluiten indien gevonden | O | Gebouwd voor JPEG en PNG. Als beeld-XObject, geknipt op de kaderlijn; begrotingen in de tabel van werkgrenzen (Deel J) |
| Punten (POINT) | Weglaten · als stip | Weglaten | O | Gebouwd |

#### Onderin — *gebouwd (fase 6)*

| Onderdeel | Beschrijving |
|-----------|--------------|
| **Doel** | Nieuw document · nieuwe pagina in het huidige document (na de huidige) · onderlegger op de huidige pagina, met dekking (standaard 50%), "onder de bestaande inhoud", "op schaal" (naar de meetschaal van de pagina) en als vector (knipsel, blijft scherp) of als afbeelding (gerasterd op de plaatsingsmaat, dpi kiesbaar). Beginwaarde: onthouden. Gebouwd |
| **Voorbeeldweergave** | De echte omzetter draait op de achtergrond naar een tijdelijke PDF en die wordt via de bestaande PDFium-route getoond: gegarandeerd gelijk aan het resultaat, geen tweede renderer. Vertraagd bijgewerkt (300 ms na de laatste wijziging), af te breken; boven 200 000 entiteiten (geteld ná de laagkeuze, per ruimte) zonder arceerpatronen (effen vullingen blijven, een patroon wordt zijn omtrek), tekst en maatvoering (met de verwijslijnen), met een melding. Een voorbeeld-PDF draagt `/OPS_Preview true` in de catalogus en op elke pagina; alleen `preview_cad_import` maakt er een, de echte import weigert de voorbeeldstand, en de app weigert zo'n PDF bij invoegen, samenvoegen en opslaan. Toont papierrand, marges en het venster; slepen zet het venster |
| **Samenvatting** | "A1 liggend · 1:100 · 38 van 52 lagen · 12 480 objecten · eenheid mm (uit bestand)" plus waarschuwingen (geen eenheid, ontbrekende externe verwijzing, 3D-viewport overgeslagen, lettertype vervangen) |
| **Voorinstellingen** | Keuzelijst met benoemde voorinstellingen + opslaan / verwijderen, en "laatst gebruikt". Opslag in de voorkeuren (`cadImport`, `cadImportPresets`), bij het laden gecontroleerd en aangevuld met standaardwaarden, zoals `herstelPrintInstellingen` dat doet. Een voorinstelling bevat alleen de **O**-instellingen |
| **Knoppen** | Importeren · Annuleren; tijdens het werk een voortgangsbalk met Afbreken |

### E6. Het exportvenster — dezelfde begrippen, dezelfde opzet

| Tabblad | Instelling | Standaard | Status |
|---------|-----------|-----------|--------|
| Lagen | Lijst van PDF-lagen (of de afgeleide kleur/dikte-lagen) met aan/uit, aantal objecten, kleur; alles/niets, zoekfilter | alles aan | gebouwd: de lijst komt uit een telronde over de pagina |
| Lagen | Laagindeling: PDF-lagen · kleur + lijndikte · één laag | PDF-lagen indien aanwezig | gebouwd |
| Coördinaten | Pagina's: huidige · alle · bereik (`parsePageRange`); één bestand per pagina (`naam_p1.dxf`) | huidige | gebouwd; "naast elkaar in één bestand" niet gebouwd |
| Coördinaten | Gebied: hele pagina · schaalgebied/viewport · venster | hele pagina | gebouwd |
| Coördinaten | Eenheden en schaal: papier-mm (1:1) · ware grootte volgens de meetschaal · vrije schaal; tekeneenheid mm, cm of m | ware grootte als de pagina een schaal heeft, anders papier | gebouwd |
| Coördinaten | Oorsprong: linksonder van de pagina · linksonder van het gebied · oorspronkelijke modelcoördinaten (na een import, uit `/OPS_ModelMatrix`; fouten `NO_MODEL_SPACE`, `MODEL_SPACE_AMBIGUOUS`, `MODEL_UNITS_UNKNOWN`) | linksonder van de pagina | gebouwd; "zelf opgeven" niet gebouwd |
| Geometrie | Krommen: afvlakken (tolerantie in mm papier) · behouden als spline | afvlakken, 0,01 mm | gebouwd |
| Geometrie | Collineaire punten samenvoegen; aansluitende lijnstukken aaneenrijgen | beide aan | gebouwd |
| Geometrie | Vullingen: arcering · alleen omtrek · weglaten; paginagrote vlakken overslaan | arcering; aan | gebouwd |
| Geometrie | Tekst: als TEXT · weglaten; hoogtefactor; onzichtbare tekst mee | TEXT; 0,72; uit | gebouwd |
| Geometrie | Annotaties van de app: mee op lagen `OPS_<soort>` · weglaten (alleen annotaties uit het opgeslagen bestand) | mee | gebouwd |
| Geometrie | Afbeeldingen: als verwijzing met PNG naast het bestand · weglaten | weglaten | niet gebouwd |
| Onderin | Formaat (DXF tekst · DWG) en versie; samenvatting met aantallen en een waarschuwing boven de omvanggrens; Exporteren · Annuleren; voortgang met Afbreken | DXF tekst, 2013 | gebouwd; DXF binair, IFC en voorinstellingen niet |

Ingang: **Bestand → Exporteren** krijgt een kaart "CAD (DXF, DWG)" naast de
bestaande kaarten; **Bestand → Importeren** een kaart "CAD-tekening (DWG,
DXF)" naast XFDF en BCF; een DWG of DXF openen via *Openen* of slepen start
hetzelfde importvenster. Beide ook als opdracht voor de MCP-koppeling
(`app_export_cad`, `app_import_cad`), zodat de assistent en de testrig ze
kunnen aansturen — beide gebouwd; ze lopen dezelfde weg als de vensters.

### E7. Omvang

Schrijven alleen: ± 4,3 MB; lezen en schrijven: ± 7,6 MB (meting hoofdsessie in
de release-build van de app; eigen losse meting 5,35 en 5,54 MB). Op een
installatie van deze omvang (PDFium 7,2 MB, de sidecar 9,4 MB) is dat
verantwoord. Als de import in de sidecar komt in plaats
van in de app, verhuist de leescode daarheen en blijft de app zelf kleiner.

---

## Deel F — Meetresultaten van de verticale snede

Controle met `scripts/verify_batch.py`. De referentie is **MuPDF**
(`page.get_drawings()` via PyMuPDF): een andere PDF-interpreter dan PDFium, met
een eigen afhandeling van `/Rotate` en de paginabox. De DXF wordt teruggelezen
met **ezdxf**, dus ook dat is onafhankelijk van de schrijver. Twee richtingen:
A = elk eindpunt uit de PDF ligt op een DXF-segment (volledigheid); B = elk
DXF-hoekpunt ligt op een PDF-segment (geen ruis). Annotaties en formuliervelden
zijn uit de referentie gehaald (de export leest alleen de pagina-inhoud).
Eis uit de issue: < 0,1 mm bij 1:1.

| Geval | `/Rotate` | Bijzonderheid | Punten | Max. A (mm) | Max. B (mm) | Tekst max. (mm) | DWG = DXF |
|-------|----------:|---------------|-------:|------------:|------------:|----------------:|:---------:|
| Referentieblad A1, p1 | 90 | A1, annotaties aanwezig | 16 166 | 0,00007 | 0,00007 | 0,00002 | ja |
| Constructieoverzicht, gedraaid, p1 | 90 | — | 786 | 0,00002 | 0,00002 | 0,00000 | ja |
| Constructieoverzicht, ongedraaid, p1 | 0 | — | 285 | 0,00003 | 0,00002 | 0,00002 | ja |
| Referentieblad A0 met 576 patroonvlakken, p1 | 90 | A0, 576 paginagrote patroonvlakken | 24 996 | 0,00006 | 0,00006 | 0,00061 | ja |
| Zwaar vectorblad p18 | 0 | MediaBox-oorsprong (−846, −595) | 81 598 | 0,00006 | 0,00006 | 0,00010 | ja |
| Blad met grote negatieve oorsprong, p2 | 0 | MediaBox-oorsprong (−2578, −1192) | 195 479 | 0,00096 | 0,00010 | 0,00095 | ja |
| Blad met negatieve oorsprong, p1 | 0 | MediaBox-oorsprong (−842, −595) | 172 | 0,00003 | 0,00002 | 0,00001 | ja |
| Blad met geneste formulieren, p1 | 0 | y-oorsprong 7,83 pt; formulier-XObjects, diepte 3 | 24 | 0,00002 | 0,00004 | 0,00006 | ja |
| Synthetisch cropbox-blad, p1 | 0 | CropBox binnen MediaBox | 60 | 0,00000 | 0,00000 | 0,00000 | ja |
| Referentieblad met 41 PDF-lagen, p1 | 90 | **41 OCG's → 41 lagen** | 28 086 | 0,00098 | 0,00004 | 0,00002 | ja |
| Referentieblad 1:100, p1, **1:100** | 90 | ware grootte; eis 10 mm | 367 122 | 0,080 | 0,0065 | 0,027 | ja |
| Referentieblad A1, p1, splines | 90 | 428 SPLINE | 12 410 | 0,00007 | 0,00007 | 0,00002 | ja |

**Grootste afwijking bij 1:1: 0,001 mm** — honderd keer binnen de eis. Bij
1:100 is het 0,08 mm in werkelijkheid (0,0008 mm op papier). Alle twaalf
gevallen: nul punten boven de tolerantie, en DXF en DWG lezen terug met gelijke
aantallen per entiteittype.

Tekst: het invoegpunt valt samen met de oorsprong van het eerste teken volgens
MuPDF, het eerste teken klopt, de hoek wijkt 0,0° af, en de hoogte is 0,72 ×
de lettergrootte (bij versmalde tekst gaat het verschil in de breedtefactor).

Wat de meting **niet** dekt: of een CAD-programma het bestand opent en goed
toont. Dat is met de hand te doen (deel G); op deze machine stond geen
CAD-programma ter beschikking van de meting.

---

## Deel G — Teststrategie, gekoppeld aan de acceptatie-eisen

| Eis uit de issue | Test | Staat |
|------------------|------|-------|
| Lijnen op de juiste coördinaten, < 0,1 mm bij 1:1 | `verify_batch.py` (12 gevallen, MuPDF + ezdxf); `tests/synthetic_page.rs` (in CI, zonder externe bestanden) met `/Rotate 90`, boxoorsprong (−100, −50), formulier-XObject, exacte verwachting | **gehaald**, 0,001 mm |
| Tekst op de juiste plek en maat | zelfde scripts, optie `--texts`; integratietest controleert invoegpunt, hoogte, hoek 270° | **gehaald** |
| Opent in open-source CAD-software | handmatig: DXF en DWG openen in open-source CAD-software en in OpenCADStudio; schermafdruk naast de PDF | **te doen** door de maintainer |
| Tekening met meetschaal exporteert op ware grootte | `b3-schaal100` (1:100) in de batch; integratietest 1:50 | **gehaald** in de crate; de koppeling met `getMeasureScale` komt met de UI |
| PDF-lagen worden DXF-lagen met dezelfde naam | `ocg-rot90`: 41 van 41; integratietest laag "Wanden" | **gehaald** |
| Grote tekeningen blokkeren de UI niet | async commando + werkdraad + slot alleen tijdens uitlezen; gemeten 0,07–0,9 s voor zware bladen. Nog te doen: een rig-test die tijdens een export blijft pannen | **deels** |
| IFC valideert tegen IFC4 en toont het lijnwerk op de bouwlaag | schema-validatie met de open-source IFC-bibliotheek in de testomgeving; handmatig openen in een open-source BIM-programma | fase 4 |
| DWG leest terug | `inspect_cad` na elke export in de batch; aantallen per type gelijk aan DXF | **gehaald** |
| Afbreken laat geen half bestand achter | `cancel_flag_aborts_without_output` | **gehaald** |
| Opties | 47 eenheidstests: matrix, rotaties, boxoorsprong, UserUnit, afvlaktolerantie (gemeten tegen de echte kromme), collineair samenvoegen (ook de naad en het omkeerpunt), aaneenrijgen met behoud van tekenvolgorde, lagen, lijntypen, lijndikte-afronding, tekst | **gehaald** |

Voor de import: dezelfde opzet andersom. **Stand 21 september 2026:**
`open-pdf-cad/tests/import_roundtrip.rs` maakt een DXF met de eigen schrijver,
importeert hem en controleert papier en schaal, de ligging van de hoekpunten op
de pagina (op 0,001 pt), `/VP` + `/Measure`, lagen als OCG, weggelaten en
verborgen lagen, afbreken en een schrijffout zonder achtergebleven bestand;
`src-tauri/src/cad_import.rs` heeft eenheidstests voor de commando-schil;
`js/pdf/cad-import.test.mjs` test de pure rekenregels van het venster (en
vergelijkt papierformaten en standaardschalen met de crate) en
`cad-import-i18n.test.mjs` de 39 talen. In de geïsoleerde releasebuild is een
bekende maat gemeten: een lijn van 7 500 mm en een van 3 000 mm in een DXF,
geïmporteerd op 1:100, meten met de maatvoering van de app 7 500 mm en 3 000 mm
— ook op een als nieuwe pagina ingevoegde import. Oorspronkelijk plan: Een DXF met bekende
coördinaten importeren, de PDF met MuPDF uitlezen en de punten vergelijken
(< 0,1 mm op papier); de leesproef over de 434 bestanden als regressieset
(geen crash, zelfde aantallen); per tabblad van het venster eenheidstests op de
pure omrekening (eenheden, schaal, passend-op-papier, plaatsing); de meetschaal
controleren door in de rig een bekende maat te meten.

**Metingen na fase 6 (22 september 2026, geïsoleerde releasebuild met eigen
datamap en MCP-testkoppeling; verificatieverzameling en opgebouwde
testbestanden):**

| Meting | Uitkomst |
|--------|----------|
| Viewportsweep met `import_drawing --all-layouts` over 20 bestanden uit de verificatieverzameling (voorbeeldverzamelingen van twee open-source lezers plus eigen bladen) | 17 omgezet, 3 geweigerd met `IMPORT_EMPTY:model` (bestanden zonder tekenbare 2D-inhoud: een helix, een constructielijn, een 3D-punt). Viewports **gemeld = getekend: 14 = 14**, geen enkele afwijking; langste omzetting 0,4 s |
| Vijf bladen met veel viewports (13, 12, 12, 17 en 14 viewports op vellen van 841×1260 tot 1470×841 mm) en een opgebouwd blad met 37 viewports | Alle viewports gemeld én getekend; in de app 16 van 16 viewports op het blad met de meeste inhoud zichtbaar op hun plek |
| IJkmeting (fase 5) | Een lijn van 7 500 mm en een van 3 000 mm, geïmporteerd op 1:100, meten met de maatvoering van de app 7 500 mm en 3 000 mm; ook op een als nieuwe pagina ingevoegde import |
| Kleurentabel en kleurstanden | Twee lijnen (rood 0,70 mm, blauw 0,13 mm) met kleuren op "alles zwart": in de PDF verschilt de dikte, de kleur is `0 G`; de standen grijstinten, zwart-wit en één kleur zijn in de inhoudsstroom gecontroleerd |
| Onderlegger | Een tekening als onderlegger op een bestaande pagina met meetschaal 1:100, "op schaal", 50 % dekking, "onder de bestaande inhoud": het lijnwerk staat onder de inhoud, blijft vector (scherp bij inzoomen) en is aanklikbaar, te slepen en te schalen; na opslaan en heropenen ongewijzigd |
| Terugweg naar het model | Een geïmporteerde tekening geëxporteerd met oorsprong "modelcoördinaten": de hoekpunten komen op **0,012 mm** van de oorspronkelijke coördinaten terug (op 1:100, dus 0,00012 mm op papier) |
| MCP | `app_import_cad` met `target: "new"` en `target: "underlay"` geeft een verslag met paden, aantallen en waarschuwingen; de onderlegger loopt dezelfde plaatsing als het venster |
| Afbreken | Een zware import afgebroken tijdens het tekenen: de omzetting stopt binnen 40 ms en er blijft geen deelbestand achter |
| Voorbeeldweergave | Werkt 300 ms na de laatste wijziging bij; slepen in het voorbeeld zet het venster; een gevonden fout (het beeld verdween na de eerste wijziging doordat de oude bitmap vóór het wisselen dichtging) is opgelost met een test |

Niet gemeten: de winst van blokken als formulier in bytes op een echt blad (de
eenheidstests borgen alleen dat de plaatsing byte-gelijk uitvouwt), en het
openen van de uitvoer in een CAD-programma (handmatig, Deel G eerste tabel).

---

## Deel H — Risico's

| Risico | Ernst | Maatregel |
|--------|-------|-----------|
| Geheugen bij extreme bladen (2,3 kB per entiteit in de bibliotheek; 6 GB bij 2,45 miljoen) | hoog, zeldzaam | Grens met keuzevenster (fase 2); aaneenrijgen scheelt al 30%; stromende DXF-schrijver (fase 3); upstream voorstellen grote varianten te `Box`-en |
| `acadrust` is jong, één hoofdauteur | middel | Vastgepinde versie; alle aanroepen in één bestand (`writer.rs`); de fork van de stichting als uitwijk; eigen batch als regressietest bij elke versieverhoging |
| DXF-lezer kwadratisch | hoog voor import van grote DXF's | Eénregelige reparatie upstream/fork vóór de import gebouwd wordt; tot dan een tijdslimiet en Afbreken |
| Bestand opent niet in een bepaald CAD-programma | middel | De controlematrix van de bibliotheek dekt twee gangbare programma's; handmatige controle in fase 1; DXF als terugval voor DWG |
| Gedeeltelijk geknipte objecten komen volledig mee | middel | Geteld in het verslag; rechthoekig knippen in fase 2 |
| Patroon- en shadingvullingen komen als effen vlak | laag | Paginagrote vlakken vervallen al; de rest in fase 2 via `lopdf` |
| Tekstbreedte wijkt af (andere letter in CAD dan in de PDF) | laag | Invoegpunt, hoogte en hoek kloppen; breedtefactor mee; fase 2: uitlijning "passend" tussen begin- en eindpunt |
| Eigen FFI-laag naast `pdfium-render` | laag | 45 functies met een stabiele C-ABI; alleen `extract.rs` gebruikt ze; bij een ontbrekende functie een duidelijke fout bij het laden |
| Slot op de renderer tijdens uitlezen (Linux/macOS) | laag | Kort (< 0,5 s gewoon); fase 3: sidecar |
| Import: viewports, externe verwijzingen, SHX-letters, patroonarceringen, pentabellen | middel | Gebouwd in fase 6 (deel J); het venster meldt wat is overgeslagen. SHX-letters blijven vervangen door een standaardletter |
| Een gedraaide viewport (`twist`) is niet tegen een echte tekening bevestigd | middel | De formule volgt de beschrijving van het formaat: positief draait het model op papier tegen de klok in, `view_center` staat in het beeldvlak, en een DXF geeft de hoek in graden waar een DWG radialen geeft (de beoordeling rekent om). Getest met opgebouwde vensters; in de verificatieverzameling (433 viewports) komt geen enkele draaiing voor. Nakijken met een render zodra er een blad met een gedraaid venster opduikt |
| De vlag "niet-rechthoekig knippen aan" (bit 0x10000 van de viewportstatus) zit niet in het documentmodel | laag | De handle van de knipgrens is het kenmerk; de lezer vult hem alleen bij een viewport die een grens draagt (alleen DWG: de DXF-lezer leest de handle niet). Een bestand dat de grens bewaart maar het knippen uitzet, wordt toch geknipt |
| Een spline of een regio als knipgrens valt terug op de rechthoek van de viewport | laag | Polylijn (met bogen), cirkel en gesloten ellips worden wel gevolgd; in de verzameling zijn alle eigen grenzen polylijnen |
| Een eigen UCS per viewport (`ucs_per_viewport`) wordt niet toegepast | laag | Kwam in de hele verzameling niet voor; de viewport wordt dan als gewoon bovenaanzicht getekend. Melden zodra er een bestand opduikt waar het misgaat |
| Lagen uit een externe verwijzing staan niet in de lagenlijst van het venster | laag | Ze komen wel mee en volgen de laagnamen van de verwijzing; het lagenfilter werkt op naam, dus een laag die ook in de hoofdtekening bestaat volgt die keuze. Een verwijzing openen tijdens de verkenning zou elk venster traag maken |
| Vet is nagebootst met een streek, niet met een vette letter | laag | De breedtes blijven die van de rechte letter, dus de regel blijft op zijn plaats; een echte vette letter zou een tweede breedtetabel vragen |
| Een layout zonder bruikbare papiermaat kan een te grote pagina opleveren (`IMPORT_PAGE_TOO_LARGE`, gezien op één bestand) | middel | De gebruiker kan het papier zelf kiezen; de melding noemt de gevraagde maat. Noemt de tekening zelf een papier boven de grootste PDF-pagina (14 400 pt), dan telt dat als "geen papier" en kiest de inhoud een standaardblad; kiest de gebruiker zo'n maat, dan is het een fout, en het venster laat hem niet invullen |
| De terugweg naar CAD is zo nauwkeurig als de PDF ertussen | laag | De import schrijft paginacoördinaten in duizendsten van een punt: een half duizendste punt afronding is op papier 0,00018 mm en op 1:100 dus ongeveer 0,02 mm in het model (op 1:1000 0,2 mm); gemeten 0,012 mm op 1:100 (Deel G). De matrix zelf (twaalf cijfers, in 64 bits gelezen) draagt niets meetbaars bij. Wie het nauwkeuriger wil, moet de tekening zelf bewaren, niet de PDF |
| De voorbeeldstand laat bij een zware ruimte inhoud weg | laag | Boven 200 000 entiteiten (geteld ná de laagkeuze, per ruimte): geen tekst, geen maatvoering en verwijslijnen, arceerpatronen alleen als omtrek; effen vullingen blijven. Het venster meldt het (`previewSimplified`). Een voorbeeld-PDF draagt `/OPS_Preview true`; alleen het voorbeeldcommando maakt er een, en de app weigert zo'n PDF bij invoegen, samenvoegen en opslaan |
| Het vangnet "de eerste viewport over het hele blad is het blad" kan een echt venster wegnemen | laag | De grens is 95 % van het papier of van de limieten. Met 10 mm marge rondom vult een venster op A1 94 % en op A0 96 %: op A0 scheidt de grens blad en venster dus niet zuiver. In de verificatieverzameling raakt het vangnet geen enkele viewport. De import meldt elk geval (`sheetByCoverage`), in de verkenning en in het verslag |
| Een venster is niet weg te laten via de laag van zijn kader | laag | Zoals in CAD verbergt die laag (uit, bevroren, niet-plotbaar of uitgevinkt) alleen het kader; de inhoud volgt de lagen van het model en de lagen die in het venster bevroren zijn. Wie een venster niet wil, zet het in de tekening uit of laat de lagen van de inhoud weg |
| Het lezen van de terugweg uit een vreemde PDF is begrensd, niet onbeperkt | laag | De eigen lezer leest `startxref`, kruisverwijzingstabel en -stroom (met `/Prev`, `/XRefStm`, `/Index`, `/W`; elk deel één keer, ten hoogste 64 delen en 4 miljoen verwijzingen), trailer, objectstromen en objecten met een begrensde parser: 2 miljoen waarden, 8 MB tekst, 64 MB per objectstroom en 256 MB samen, alleen `FlateDecode` met PNG-voorspellers op de gemeten bytes, ten hoogste 1 024 viewports per pagina; een stroomlengte komt alleen uit een getal of een gewoon object, nooit uit een keten. Een bestand daarboven geeft `NO_MODEL_SPACE`; niets kost stapel of onbegrensd geheugen (getest met 5 000 gekoppelde stroomlengtes en een voorspeller met 10¹² kolommen) |
| Alleen JPEG en PNG worden ingesloten | laag | Een andere extensie wordt niet gezocht en telt als "niet gevonden"; een gevonden bestand van een andere of beschadigde soort telt als "niet ondersteund" (`imagesUnsupported`) |
| De beelden van één import samen mogen ingepakt 128 MB zijn en uitgepakt 512 MB aan werk kosten | laag | Wat er niet meer bij past wordt gemeld als "te groot" (`imagesTooLarge`) en de import gaat door; de namen staan in het verslag. De grenzen staan in de tabel van werkgrenzen (Deel J) |
| Tussen het oplossen van een pad en het openen kan wie in de map mag schrijven het bestand verwisselen voor een koppeling naar buiten | laag | Dezelfde grens als de harde koppeling: het vraagt schrijfrechten in een map die de gebruiker zelf heeft aangewezen. Grootte en bytes komen wel van één geopende handle. Een tekening in de hoofdmap van een schijf maakt die schijf niet tot zoekpad; de gebruiker kiest zo'n map dan uitdrukkelijk |
| Een vijandig of beschadigd bestand kan de omzetter lang laten rekenen | middel | Het bezoekbudget rekent naar werk (hoekpunten, splinemonsters, patroonlijnen), niet alleen naar entiteiten; afbreken en de inhoudsgrens worden ook binnen lange lussen gepolld; booghoeken worden modulo een volle cirkel genomen en niet-eindige hoeken laten de entiteit vallen. Padopzoekingen voor verwijzingen en beelden worden per naam onthouden en in aantal begrensd |

## Deel I — Open vragen voor de maintainer

1. **Eigen FFI-laag akkoord?** Het alternatief is `pdfium-render` zonder
   OCG-lagen, of een wijziging upstream afwachten.
2. **Naam en plaats van de crate:** `open-pdf-cad` in de workspace-root — goed
   zo? (Hernoemd van `open-pdf-export` toen de import erbij kwam.)
3. **Teksthoogte:** factor 0,72 als standaard (hoofdletterhoogte), of 1,0
   (lettergrootte = teksthoogte, tekst wordt dan ~40% groter dan in de PDF)?
4. **Zwart → kleurindex 7** (zichtbaar op een donkere tekenachtergrond) — of
   letterlijk ware kleur 0,0,0?
5. **Standaard-DWG-versie:** 2013-formaat. Akkoord, of liever 2018 zoals
   OpenCADStudio?
6. **Meerdere pagina's:** één bestand per pagina (voorstel), of alle pagina's
   naast elkaar in één tekening?
7. **Annotaties mee:** lagen `OPS_<soort>` en in fase 2 — akkoord?
8. **Omvanggrens:** 750 000 entiteiten met een keuzevenster — akkoord, of
   stilzwijgend doorgaan zolang er geheugen is?
9. **Import, standaardruimte:** de eerste layout met inhoud zodra de
   modelruimte leeg is; anders modelruimte. Of altijd de layout als die een
   bruikbare papiermaat heeft (dan komen kader en schaal vanzelf goed)?
10. **Meetschaal:** mag de lader `/VP` + `/Measure` gaan lezen (aanbevolen), of
    alleen de eigen `scaleRegion`-annotatie schrijven?
11. **Upstream:** de kwadratische DXF-lezer en `$MEASUREMENT` in DWG melden bij
    de auteur, of meteen in de fork van de stichting oplossen?
12. **IFC:** eigen STEP-schrijver akkoord? En: één `IfcAnnotation` per laag per
    pagina (voorstel) of per pad?

## Deel J — Gefaseerd plan

**Fase 1 — export, snede (klaar, deze branch).** Crate, FFI, model, DXF/DWG,
lagen uit OCG, schaal, opties, commando-schil, tests en metingen.

**Fase 2 — export compleet.** Exportvenster volgens E6 met voorscan van de
lagen, paginabereik, gebied en oorsprong; koppeling met `getMeasureScale` en
`/VP` lezen in Rust; annotaties mee; afbeeldingen als verwijzing; bogen en
cirkels herkennen; tekst samenvoegen tot regels/MTEXT; rechthoekig knippen;
OCG-standaardzichtbaarheid en patroonvullingen via `lopdf`; omvanggrens;
vertalingen in 39 talen; MCP-opdracht `app_export_cad`; handmatige controle in
CAD-software.

**Fase 3 — robuustheid.** Stromende DXF-schrijver voor extreme bladen;
eventueel de export in de sidecar; upstream-bijdragen aan de bibliotheek.

**Fase 4 — IFC.** STEP-schrijver, bouwlaag- en plaatsingskeuze in het venster,
schema-validatie in de tests.

**Fase 5 — import, kern.** Reparatie van de DXF-lezer; module `import`:
modelruimte, lagenfilter, blokken uitvouwen, krommen, effen arceringen, tekst
in de standaardletter, eenheden/schaal/papier/plaatsing, OCG's, `/VP` +
`/Measure`; importvenster met de tabbladen Lagen en Coördinaten; doel "nieuw
document" en "nieuwe pagina"; de lader leest `/VP`.

*Stand 21 september 2026 — fase 5 is gebouwd.* De kern (module `import`,
met de DXF-lezer in stukken in plaats van de kwadratische lezer), de
Tauri-commando's (`scan_cad_file`, `import_cad_to_pdf`, `cancel_cad_import`,
`release_cad_import`; de ingelezen tekening blijft tussen verkennen en
importeren vastgehouden) en het importvenster: tabblad Lagen (aan/uit, kleur,
aantal, status, sorteren per kolom, Alles/Niets/Omkeren op de gefilterde lijst,
zoekfilter met `*` en `?`, niet-plotbare lagen, PDF-lagen, uitgezette lagen
verborgen meenemen), tabblad Coördinaten (ruimte, gebied, eenheid, schaal uit
de lijst, vrij of passend en afgerond, papier automatisch of vast incl. de
verlengde vellen, oriëntatie, marge, plaatsing, draaiing ook vrij,
oorsprongsverschuiving en basispunt, meetschaal), doel "nieuw document" en
"nieuwe pagina na de huidige" (PDF-lagen gaan mee naar de lagenlijst van het
document), onthouden van de instellingen (gecontroleerd zoals de
printinstellingen), voortgang met Afbreken, en ingangen via Bestand >
Importeren, Openen, slepen en `app_open_pdf`. De lader leest `/VP` +
`/Measure`. Bij een paginawijziging (invoegen, verwijderen, verplaatsen,
vervangen, samenvoegen) verhuizen de meetschalen mee met hun pagina en komen
die van nieuwe pagina's uit die pagina's zelf; het document wordt daar niet
opnieuw voor gelezen. Zonder paginatoewijzing (bijsnijden, rechtzetten, formaat
wijzigen, ongedaan maken) gelden er even geen meetschalen uit de PDF en wordt
op de achtergrond opnieuw gelezen; alleen de laatst begonnen lezing mag haar
uitkomst zetten, en een wijziging die binnenkomt terwijl er nog een lezing
loopt, laat de nieuwe bytes alsnog lezen. Alvast meegekomen uit
fase 6: layouts met viewports (in de kern), het tabblad Weergave (kleuren,
lijndiktes, arceringen, lijntypen, tekst, maatvoering, attributen, punten) en
voorinstellingen.

Werkgrenzen (na de review van fase 5): de wandeling telt elk bezoek, ook elke
cel van een MINSERT en elke keer dat een blok wordt uitgevouwen, en stopt
boven de grens; de inhoudsstromen hebben een bovengrens; een spline van
absurde graad valt terug op zijn fitpunten. Dat alles geeft de fout
`IMPORT_TOO_COMPLEX`, met een uitleg in alle talen. Verkennen, grenzen bepalen
en tekenen zijn alle drie af te breken, net als het schrijven van de PDF; het
deelbestand heeft een unieke naam en een bestaand doelbestand wordt nooit
stilletjes vervangen (`IMPORT_EXISTS:<pad>`). Een venster zonder positieve
breedte en hoogte is een fout (`IMPORT_WINDOW_INVALID`), geen stille terugval
op de grenzen. Getallen in `/Measure` en de modelmatrix hebben twaalf
significante cijfers, zodat een schaal in meters per punt nauwkeurig blijft.

Beide werkgrenzen gelden per import, niet per wandeling of per pagina:

| Grens | Standaard | Telt over |
|---|---|---|
| Bezoeken (`maxVisits`) | 40 miljoen | één gedeelde teller voor alle wandelingen van een verkenning (modelruimte en elk blad), en voor alle wandelingen van een omzetting (grenzen bepalen én tekenen, voor elke gekozen ruimte); een bezoek is een entiteit, een MINSERT-cel, en sinds fase 6 ook een portie werk binnen een entiteit (hoekpunten, splinemonsters, patroonlijnen) |
| Inhoud (`maxContentBytes`) | 256 MB | de ongecomprimeerde inhoudsstromen van alle pagina's samen; elke pagina krijgt wat er nog over is |
| Patroonlijnen per arcering (`max_hatch_lines`) | 20 000 | daarboven alleen de omtrek |
| Beelden, ingepakt (`MAX_IMAGE_TOTAL_BYTES`) | 128 MB | alle beeld-XObjects van één import samen, zoals ze in de PDF komen; wat er niet bij past wordt "te groot" |
| Beelden, uitpakwerk (`MAX_IMAGE_WORK_BYTES`) | 512 MB | de gedecodeerde pixels die tijdens één import samen door de handen gaan; leesgrens per bestand 512 MB (`MAX_IMAGE_READ_BYTES`) |
| Beelden, pixels (`max_image_pixels`) | 200 Mpx | per afbeelding; ten hoogste 256 beeldbestanden (`MAX_IMAGE_FILES`) per import |
| Zoekpaden (`MAX_SEARCH_PATHS`) | 16 | gekozen mappen, naast de map van de tekening; alleen bestanden daaronder worden geopend |
| Externe verwijzingen (`MAX_XREF_DEPTH`) | nestdiepte 4, kringen geweigerd | een verwijzing die dieper zit of naar zichzelf terugwijst telt als geweigerd (`refused`) |
| Terugweg (`model_space`) | 64 kruisverwijzingsdelen, 4 miljoen verwijzingen, 2 miljoen waarden, 8 MB tekst, 64 MB per objectstroom en 256 MB samen, 1 024 viewports per pagina | per leesronde van de PDF; daarboven `NO_MODEL_SPACE` |

Per wandeling tellen zou tien bladen die elk net onder de grens blijven tien
keer zo lang laten duren, en per pagina zou het geheugen met het aantal
pagina's meegroeien. De 256 MB is ruwweg tien miljoen lijnstukken: ver voorbij
wat een PDF-weergave nog vlot toont, terwijl de zwaarste gewone tekeningen op
enkele tientallen MB uitkomen. De stromen staan tot het wegschrijven alle
tegelijk in het geheugen, naast de ingelezen tekening en tijdelijk de
gecomprimeerde kopie; met deze grens blijft dat samen onder een halve GB (de
eerdere 768 MB per pagina kon met een paar bladen het werkgeheugen van een
gewone werkplek vullen). Het verslag houdt bezoeken (`stats.visits`, waar de
grens op telt) en entiteiten (`stats.entities`, voor weergave) uit elkaar.

Het knipvlak om de grenzen of de limits groeit met de helft van de dikste
lijn die werkelijk getekend wordt (gemeten tijdens het bepalen van de grenzen,
dus na vaste dikte, factor en minimum, en zonder lagen die niet meedoen), met
een kwart millimeter als ondergrens voor haarlijnen. Een eigen venster knipt
precies.

Opgelost sinds de review: bij een tweede import in hetzelfde document krijgt
een laag waarvan de naam al bestaat de bestandsnaam als achtervoegsel.

**Fase 6 — import, volledig.** Layouts met viewports; tabblad Weergave
(kleuren, kleurentabel, lijntypen, lettertypevervanging, patroonarceringen,
maatvoering, externe verwijzingen, afbeeldingen); voorbeeldweergave;
voorinstellingen; onderlegger via het vectorknipsel; blokken als
formulier-XObject; modelmatrix voor de terugweg naar CAD.

*Stand 22 september 2026 — fase 6 is gebouwd en gemeten (Deel G).* Erin:

- **Viewports.** Elke layout tekent zijn viewports geknipt op hun rand (ook
  een polylijn-, cirkel- of ellipsgrens) met eigen schaal, verschuiving,
  draaiing en bevroren lagen; de bladviewport wordt herkend (E2) en het
  95 %-vangnet meldt zich (`sheetByCoverage`). Het open punt uit fase 5 (7
  viewports gemeld, pagina toont alleen papier) is daarmee opgelost: gemeld =
  getekend in de hele sweep.
- **Weergave.** Kleurstanden (bestand, zwart, grijs, zwart-wit, één kleur),
  kleurentabel voor lijndiktes, lijntypen, lettervervanging naar vier
  standaardletters, patroonarceringen met vier standen, maatvoering,
  attributen, punten.
- **Externe verwijzingen en afbeeldingen.** Alleen uit de map van de tekening
  of gekozen zoekpaden; JPEG en PNG als beeld-XObject; alles begrensd (tabel
  hierboven) en gemeld in het verslag per bestandsnaam.
- **Blokken als formulier-XObject** voor gelijke plaatsingen (E3).
- **Voorbeeldweergave** met de echte omzetter naar een voorbeeld-PDF
  (`/OPS_Preview`), vertraagd, af te breken, met slepen van het venster.
- **Onderlegger** op de huidige pagina, als vectorknipsel of als afbeelding,
  op schaal van de pagina, met dekking en "onder de inhoud".
- **Voorinstellingen** met de O-instellingen.
- **Modelmatrix** (`/OPS_ModelMatrix`, `/OPS_Clip`) per viewport, en de
  terugweg in de export: oorsprong "modelcoördinaten" in het exportvenster
  en in `app_export_cad`, met de foutcodes `NO_MODEL_SPACE`,
  `MODEL_SPACE_AMBIGUOUS` en `MODEL_UNITS_UNKNOWN`.
- **MCP.** `app_import_cad` en `app_export_cad` lopen dezelfde weg als de
  vensters.
- **Meetschaal in de app.** `getMeasureScale` kiest schaalgebied →
  viewport-/schaalbalkannotatie → `/VP` van de PDF → documentschaal, en alle
  schaalbruggen (stempels, stavenreeks, betonbalk, systeemraster, dynamisch
  schalen, vastklikken) gebruiken dezelfde helper; `/VP` draait mee met een
  paginarotatie en verhuist mee bij verschuiven van de pagina-inhoud.

Open na fase 6 (bewust, met reden): tekst "als omtrek" en het inbedden van
een letter (E5 Weergave); lagenselectie per bestandsnaam (E5 Lagen);
afbeeldingen als verwijzing en DXF binair in de export (E6); een
gedraaide viewport en een eigen UCS per viewport zijn niet tegen echte
tekeningen bevestigd (Deel H).
