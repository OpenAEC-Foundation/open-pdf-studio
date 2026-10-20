# Rust-migratie: plan fase 1 — Rust-kernel met annotaties

*Opgesteld 19-10-2026. Dit is een plandocument; er is nog geen code gebouwd.*

## 1. Doel en fasering

Open PDF Studio gaat gefaseerd naar Rust.

- **Fase 1 — Rust-kernel (dit document).** Een nieuwe kernel in Rust neemt stap voor stap het werk over: pagina's renderen, en voor annotaties het model, het inlezen, het tekenen (inclusief tekst) en het opslaan. De bestaande Tauri-app met de Solid-UI blijft de schil. Elke stap is via een vlag schakelbaar naast het huidige pad.
- **Fase 2 — native UI (later).** Tauri + Solid gaat eruit en Iced komt ervoor in de plaats, bovenop dezelfde kernel. Fase 2 wordt pas uitgewerkt als fase 1 ver genoeg is.

Gemaakte keuzes:

| Onderwerp | Keuze |
|---|---|
| Basis voor paginarendering | **Hayro** (pure Rust, MIT/Apache) |
| Annotaties | model, lezen, **tekenen en tekst** en opslaan in Rust, per soort |
| Volgorde annotatiesoorten | eerst de standaard-PDF-soorten, daarna de bouwkundige soorten |
| Werkplek | nieuwe crates in deze repository, geleverd in de normale releaserondes |
| PDFium | blijft schakelbaar, als referentie en terugval |

## 2. Huidige stand

### 2.1 Wat al in Rust draait

- **PDFium** in de sidecar `pdfium-worker/`: vier workers, JSON-regels over stdin, pixels via gedeeld geheugen. De operaties zijn `render`, `render_region` en `trim`. Daarnaast is er een in-process terugval (`src-tauri/src/pdfium_renderer.rs`).
  - PDFium levert pagina's, regiotegels, miniaturen, printen en OCR.
  - Annotaties worden met `render_annotations(false)` overgeslagen; de app tekent die zelf.
- **open-pdf-render** (lopdf + tiny-skia): de "scene"-tegels voor zware pagina's (> 6 MB inhoud), tekstposities voor hoeveelheden, en een debug-renderer (`render_pdf_page_skia`).
- **CAD-import/-export** (`open-pdf-cad`), **CMYK** (`open-pdf-cmyk`) en **miniaturen in Verkenner** (`open-pdf-thumbnails`).
- Engine-keuze bestaat al als `renderEngineOverride` (`js/core/state.ts:77`, vast op `'pdfium'`). De router staat in `js/pdf/engine-router.js`. De statusbalk toont alleen welke engine actief is.

### 2.2 Wat nog in JS zit en het zwaarst weegt

| Gebied | Omvang | Opmerking |
|---|---:|---|
| `js/annotations` | ~23k regels / 95 bestanden | `rendering.js` (3 346) tekent álle annotaties op een Canvas2D-overlay |
| `js/pdf` (incl. loader en saver) | ~29k regels | `saver.js` (3 241) met pdf-lib; loader via pdf.js `getAnnotations` |
| `js/tools` | ~13k regels | tools, previews, snappen |
| `mcp-bridge.js` | 3 826 regels | muteert annotaties direct |

Er zijn ruim 40 annotatiesoorten. Daaronder vallen bouwkundige soorten zoals wall, systeemraster, stavenreeks, betonbalk, parametrische symbolen, schedule-tabellen en vector-snippets.

### 2.3 Eerdere metingen (#463)

- De JavaScript is zelden zelf het knelpunt. Opslaan kost 1,36 s bij 2 000 markups, maar dat zit in pdf-lib `save()`: de app herschrijft het hele bestand. Onze eigen appearance-code neemt daarvan maar 1,9 % voor zijn rekening.
- IPC is goedkoop met ruwe `ArrayBuffer`-antwoorden. Met geneste JSON-bytearrays is het duur: ongeveer 105 ms per MB.
- Hit-testing en snappen zijn op te lossen met de bestaande spatial-index en hoeven niet naar Rust.

Dit plan respecteert die metingen. Over de grens gaan alleen kleine JSON-snapshots per gewijzigde pagina en ruwe bitmaps.

### 2.4 Bestaand Rust-migratiewerk (tak `feat/rust-native` van oscar981-op)

De tak heeft 232 commits (30-9 t/m 16-10); er wordt niet meer aan gewerkt. Alles staat in een losse workspace `rust-studio/`; de bestaande app is niet aangeraakt.

| Onderdeel | Beoordeling |
|---|---|
| `engine-probe` (Hayro 0.7.1-wrapper, ~340 regels, geen unsafe) | **Bruikbaar.** Rendert 36/36 gevallen in een corpus van technische tekeningen en 28/30 publieke gevallen. De twee missers zitten op de bitmapgrens. Mediaan ongeveer even snel als PDFium. |
| DynLex (eigen kernel) | Niet overnemen. 0/36 tekeningen, heeft een externe compiler + LLVM nodig, de tekstworker draait alleen op Linux, en hij is trager dan Hayro. |
| Own Rust-kernel | Niet overnemen: alleen pagina 1 op 100 %. |
| PDFium-FFI-backend | Niet nodig, de app heeft PDFium al. |
| `studio-core` (viewport, annotatiemodel, undo) | Referentie voor fase 2. |
| `native-app` (Iced 0.14) | Referentie voor fase 2. **Licentie GPL-3.0**, omdat de UI-code van OpenCADStudio is overgenomen. Deze repository is LGPL-3.0. |
| Opslaan via lopdf-incrementeel (Square, Highlight, FreeText) | Bruikbaar als voorbeeld voor de schrijver. |

Nadelen van Hayro die we zelf moeten oplossen:

- er is geen regio/tegel-rendering (alleen hele pagina's onder 4096 px / 16 MP);
- een lopende render is niet te annuleren;
- er is geen tekstextractie;
- op grote JPEG-scans gebruikt hij veel meer geheugen: 439 MiB tegen 93 MiB voor PDFium op een zware scan.

Daarnaast verschilt de paginagrootte 1 px door afronding, en de anti-aliasing is niet bytegelijk aan PDFium.

## 3. Architectuur fase 1

### 3.1 Nieuwe crate `open-pdf-kernel`

Een workspace-member zonder Tauri-afhankelijkheid, met een eigen `cargo test` die ook in CI draait. CI draait nu geen Rust-tests, en de libtests van `app_lib` falen lokaal. Alle nieuwe logica komt daarom in deze crate.

| Module | Inhoud |
|---|---|
| `model` | serde-types per annotatiesoort; `#[serde(flatten)] extra` zodat onbekende velden ongeschonden heen en terug gaan |
| `doc` | `Session` per document: bytes/pad, paginaboxen, `/Rotate`, model-spiegel, blob-store voor beelden |
| `dl` | één display list (paden, lijnstijl, glyph-runs, beelden, alpha/blend-groepen, clips): de gezamenlijke tekentaal voor scherm én PDF |
| `raster` | display list → `vello_cpu`, dezelfde rasterizer als Hayro, dus gelijke anti-aliasing |
| `pdfrender` | Hayro-wrapper (uit `engine-probe`) plus regio/tegels, annulering en groottegrens |
| `text` | fonts laden en tekst opmaken (rustybuzz/skrifa) op meegeleverde fonts: Liberation (metrisch gelijk aan Helvetica/Times/Courier) en Noto TC/SC uit `src-tauri/resources/fonts` |
| `annot/<soort>.rs` | model → display list, per soort |
| `read` | annotaties lezen met lopdf |
| `write` | display list → content stream / appearance stream; incrementeel opslaan met lopdf 0.34 (al een afhankelijkheid) |

### 3.2 Waar wat draait

- **Pagina-inhoud (Hayro)** draait in de bestaande `pdfium-worker`-sidecar, via een extra veld `engine: "pdfium" | "hayro"` in `pdfium-worker/src/protocol.rs` (met `#[serde(default)]`). Dat geeft crash-isolatie, parallellisme en geheugenvrijgave zonder een tweede protocol.
  - De engine moet in de pixmap-cachesleutel (`src-tauri/src/lib.rs`, `pixmap_key`).
  - `'hayro'` wordt een waarde van `renderEngineOverride` en `engine-router.js`.
- **Annotatielaag, tekstlayout, lezen en schrijven** draaien in-process, als dunne Tauri-commands met `catch_unwind`:
  - `kernel_open(docId, path|bytes)`
  - `kernel_sync_page(docId, page, rev, json)`
  - `kernel_put_blob(hash, bytes)`: beelden één keer per inhouds-hash, als ruwe bytes
  - `kernel_render_annot_layer(docId, page, regionPt, pxPerPt, viewRot, excludeIds, layer)`: geeft `[w][h][rgba]` terug via `tauri::ipc::Response`
  - `kernel_text_layout(json)`
  - `kernel_read_annots(docId, page)`
  - `kernel_fill_slots(bytes, json)`

### 3.3 Wie is eigenaar van het annotatiemodel?

In fase 1 blijft **JS eigenaar** van het model; Rust houdt per pagina een spiegel bij. Ongeveer 130 bestanden muteren `doc.annotations` direct, en undo en MCP werken ook op die JS-objecten. Het eigenaarschap nu verplaatsen zou een herschrijving zijn, geen migratie.

Synchronisatie:

- Elke pagina krijgt een revisieteller, die wordt opgehoogd vanuit `js/core/undo-manager.js`. `pagesForCommand` bepaalt al welke pagina's een opdracht raakt.
- Een helper `markPageDirty` vangt de plekken af die undo omzeilen: push/splice in `mcp-bridge.js` en het loslaten van een sleepbeweging.
- Als vangnet wordt bij het renderen een goedkope vingerafdruk per pagina gecontroleerd (aantal + laatste `modifiedAt`).
- Alleen na een wijziging gaat er een JSON-snapshot van die pagina over, met alleen de gemigreerde soorten. Schatting: 300 annotaties ≈ 7 ms.

### 3.4 Tekenen: Rust-laag naast de JS-overlay

- De kernel rendert per pagina of regio een **transparante annotatielaag** op zoom × dpr.
- JS tekent die bitmap in het bestaande annotatiecanvas, vóór de lus die annotaties tekent (`js/annotations/rendering.js`, rond `redrawAnnotations` en `tekenPaginaLagen`). Die lus slaat daarna de soorten over die de kernel tekent.
- Er komt **geen nieuwe DOM-canvaslaag**: extra lagen gaven eerder witte zware pagina's.
- Tekstmarkering (multiply) krijgt een tweede laag in de bestaande highlight-context.
- **Per soort schakelbaar** via een tabel `js/kernel/kernel-types.js` met de waarden `js | shadow | kernel`, achter de hoofdvoorkeur `kernelAnnotations` (standaard uit). In `shadow` tekenen beide; de dev-build logt het pixelverschil.
- **Z-volgorde-wacht:** de Rust-laag ligt altijd onder de JS-getekende soorten. Overlapt een niet-gemigreerde annotatie die eerder in de volgorde staat een gemigreerde, dan tekent die pagina volledig in JS.
- **Pannen en zoomen:** de laag wordt opgerekt zoals de paginabitmap en opnieuw gerenderd als het gebaar stilstaat. Dat haalt ook de huidige volledige JS-hertekening per frame weg.
- **Slepen en bewerken:**
  1. Bij de start rendert de kernel de laag één keer opnieuw zonder de bewegende annotaties (`excludeIds`).
  2. Tijdens het slepen tekent JS die bewegende annotaties per frame.
  3. Na het loslaten volgen sync en een nieuwe render.

  Er gaat geen IPC per frame over. Vanaf M10 kan de kernel ook de bewegende annotatie als losse sprite leveren.

### 3.5 Tekst

- Eén Rust-tekstlayout, een poort van `js/annotations/rendering/textbox-layout.js`: marges, `/DS`, runs, CJK-afbreking, `noWrap` en regelafstand.
- Die layout levert regels → glyph-runs voor drie afnemers:
  - het scherm (display list);
  - de appearance stream (breedtes gelijk, CJK als ingebedde subset);
  - de inline editor.
- Nu bepalen browserfonts (`ctx.measureText`) zowel het scherm als de opgeslagen PDF, zodat beide alleen gelijk zijn zolang de fonts toevallig overeenkomen. Met één layout op vaste fontbestanden zijn scherm en bestand altijd gelijk.
- De DOM-editor (`js/tools/text-editing.js`) blijft in fase 1. Hij laadt dezelfde fontbestanden via `@font-face` en volgt de regelafbreking van de kernel, zodat de cursor klopt met de uiteindelijke weergave.
- De bestaande JS-tests van de tekstlayout gaan als golden cases mee naar `cargo test`.

### 3.6 Opslaan tijdens de overgang — één schrijver per object

1. pdf-lib stript en schrijft zoals nu (`js/pdf/saver.js`).
2. Voor gemigreerde soorten schrijft de saver alleen een **placeholder-slot** (`Subtype`, `Rect`, `OPS_KernelSlot = id`) op de juiste plek in `/Annots`. Zo blijft de z-volgorde behouden.
3. Na `save()` vervangt `kernel_fill_slots` elke slot via lopdf door het volledige dict met appearance stream en fonts, onder hetzelfde objectnummer, als incrementele update.
4. JS schrijft het bestand weg en regelt de vergrendeling zoals nu.

Zodra een opslag alleen gemigreerde soorten raakt, en niets wat alleen pdf-lib kan (formulieren, paginarotatie, lagen, bladwijzers), neemt een **Rust-snelpad** het over: het verwijdert en schrijft incrementeel op de originele bytes (M10). Hiermee vervalt de 1,36 s volledige herschrijving.

### 3.7 Laden

- `kernel_read_annots` geeft per `/Annots`-referentie óf een model terug, óf `defer`.
- pdf.js `getAnnotations`, de converter (`js/pdf/loader/annotation-converter.js`) en de kleurextractie (`color-extraction.js`) draaien alleen nog voor `defer`-referenties. De koppeling loopt via de pdf.js-id (`"12R"`).
- Pariteit wordt getoetst tegen eenmalig gedumpte JSON-snapshots van de huidige converter-uitvoer.

## 4. Mijlpalen

Elke mijlpaal past in één releaseronde. Nieuwe vlaggen staan standaard uit. Een soort gaat pas standaard aan na een ronde in `shadow` zonder afwijkingen.

| M | Wat verandert | Meetbaar criterium / test | Risico → terugdraaien |
|---|---|---|---|
| **M0** | Crate `open-pdf-kernel`: model, display list, raster, golden-harness; `cargo test` in CI; `rust-version` omhoog (Hayro vraagt een nieuwere Rust dan 1.77.2, te controleren) | model-JSON verliesvrij op een gedumpt corpus; CI groen | geen (nog niet aangesloten) |
| **M1** | Hayro als pagina-engine via de worker, met regio/tegels en engine in de cachesleutel | `open-pdf-render/examples/corpus_diff.rs` binnen drempel op de 36 tekening-gevallen; MuPDF-sweep geen nieuwe vlaggen; ≤ 2× PDFium-tijd | geheugen op scans, regio-ondersteuning van Hayro → override terug naar PDFium |
| **M2** | Spiegel-sync en laag-loodgieterij, nog geen gemigreerde soorten | MuPDF-sweep identiek; geen prestatie-regressie; sync < 10 ms bij 500 annotaties | verouderde laag → hoofdvlag uit |
| **M3** | line, arrow, box/square, circle (+ shadow-modus) | ≥ 99,5 % van de pixels binnen 8/255 t.o.v. de JS-weergave op zoom 1/2/4 en dpr 1/1,5; rotatie-sweep | visuele afwijking → soort terug naar `js` |
| **M4** | polygon, polyline, cloud(s), ink/draw, arc, spline(Arrow) | zelfde pixeltest; wolk-rondgangtests | idem |
| **M5** | `kernel::text` + textbox, callout, text/comment | identieke regelafbreking op het corpus; cursoruitlijning in de editor | font-terugval → soort terug naar `js` |
| **M6** | Schrijver v1 (slots) voor de soorten uit M3–M5 | `*-rondgang`-tests, opslag-rondgang en duplicatencontrole groen; opgeslagen appearance via Hayro ≈ schermlaag | corrupt bestand → schrijfvlag uit (pdf-lib schrijft weer volledig) |
| **M7** | Lezer v1 voor gemigreerde soorten | JSON gelijk aan converter-snapshots; laden per pagina sneller | veldverlies → alles `defer` |
| **M8** | highlight/tekstmarkering (multiply), caret, stamp, image/signature, mask/redaction | pixel- en rondgangtests; blob-deduplicatie | blend-verschil → soort terug |
| **M9** | meetsoorten (afstand, omtrek, oppervlak, hoek) + scaleBar | rondgangtests voor maatlijnen en meetvlakken | labellayout → soort terug |
| **M10** | Rust-snelpad voor opslaan; sleep-sprite uit de kernel; JS-tekenaars verwijderd voor soorten die één release standaard aan stonden | 2 000 markups opslaan < 200 ms (nu 1,36 s); minder JS-regels | snelpad-vlag uit |
| **M11+** | Bouwkundige soorten: wall, systeemraster, stavenreeks, betonbalk, parametrische symbolen, schedule-tabellen, vector-snippets, gevulde vlakken met arcering; zelfde stappen | idem per soort | idem |

### 4.1 Testen per ronde

Elke ronde doorloopt de bestaande releasepoort (`docs/release-testprotocol.md`):

- opslag-rondgang (save round trip) en duplicatencontrole;
- rotatie-sweep op alle verificatie-PDF's;
- MuPDF-vergelijkings-sweep;
- `npx vite build` en `node --test` (inclusief de test op ongedefinieerde namen);
- **nieuw:** `cargo test -p open-pdf-kernel`, met golden-bitmaps en golden-JSON;
- **nieuw, vanaf M1:** `corpus_diff` met Hayro als kandidaat naast PDFium;
- **nieuw, vanaf M3:** een `shadow`-pixelvergelijking per gemigreerde soort.

Om de sweeps per engine te kunnen draaien, rapporteert `app_get_viewport_state` het veld `engine` al, en de engine wordt via een vlag te forceren.

### 4.2 Overname van `feat/rust-native`, per fase

Het werk op de tak wordt niet in één keer samengevoegd. Elk onderdeel wordt overgenomen bij de mijlpaal die het nodig heeft, krijgt dan tests binnen de releasepoort, en gaat los van de Iced-UI. Paden zijn relatief aan `rust-studio/crates/`.

| Mijlpaal | Over te nemen | Omvang | Aanpassing |
|---|---|---:|---|
| M0 | `studio-core/src/annotations.rs`: annotatiemodel, versies, undo (zonder afhankelijkheden) | 949 r. | als startpunt van `kernel::model`; velden afstemmen op `js/types/annotation.ts` |
| M1 | `engine-probe/src/lib.rs`: Hayro-wrapper (`ParsedPdf`, `render_page`, inhoud zonder annotaties) | 338 r. | uitbreiden met regio/tegels, annulering en groottegrens; `pdfium-backend`: de groottecontrole (1 px afrondingsverschil) als test |
| M1 | benchmark- en corpusscripts (`rust-studio/scripts/`, `docs/four-kernel-*.md`) | — | als vergelijkingsbasis naast `corpus_diff` |
| M3/M7 | `engine-probe/src/imported_annotations.rs`: tekenen van Square/Highlight zonder `/AP` | 297 r. | in `annot/` onderbrengen, via de display list |
| M5 | `native-app/src/text_layout.rs`: gedeelde regelafbreking voor editor, scherm en PDF | 142 r. | **opnieuw schrijven** als onderdeel van de poort van `textbox-layout.js` (referentie, niet kopiëren) |
| M6 | `native-app/src/pdf_save.rs`: incrementeel opslaan via lopdf met appearance streams en ingebed Unicode-font, ook op gedraaide/gecropte pagina's | 4 788 r. | **opnieuw schrijven** als `kernel::write` (slot-vuller, later het snelpad); gedrag en testgevallen als referentie |
| M8+ | `native-app/src/xfdf_import.rs` / `xfdf_export.rs`: XFDF-uitwisseling | 540 r. | optioneel; **opnieuw schrijven** als losse functie |
| Fase 2 | `native-app` (Iced-shell, `annotation_layer.rs`, `inline_text.rs`, miniaturen, bestandsbrowser), `mcp_server.rs` (MCP via axum), printpad, `image_export.rs` | ~22k r. | pas bij de Iced-fase; **opnieuw schrijven**, zonder de GPL-UI-code van OpenCADStudio |
| Niet | DynLex (`dynlex-backend`, `opdl-adapter`, `dynlex-engine-poc`), `rust-kernel`, `pdfium-backend` als engine, PdfCraft-route | — | geen dekking op tekeningen, Linux/LLVM-afhankelijk of overbodig |

**Licentie bij overname:**
- `engine-probe` en `studio-core` zijn LGPL-3.0-or-later, net als deze repository. Die kunnen direct over.
- De crate `native-app` staat op GPL-3.0-only, omdat hij gekopieerde OpenCADStudio-UI linkt. `pdf_save.rs`, `text_layout.rs` en de XFDF-bestanden gebruiken die UI-code niet en zijn volledig door oscar981-op geschreven.
- **Besluit:** onderdelen uit `native-app` worden **niet gekopieerd maar opnieuw geschreven** in `open-pdf-kernel`, onder LGPL-3.0-or-later. De tak dient daarbij alleen als functionele referentie: welk gedrag, welke randgevallen, welke testgevallen. Zo hangt de licentie niet af van een bevestiging achteraf.
- Alleen `engine-probe` en `studio-core` (al LGPL-3.0-or-later) worden waar nuttig rechtstreeks overgenomen, met behoud van de auteursvermelding in de commit.

## 5. Wat in fase 1 in JS blijft

- het annotatiemodel, undo/redo;
- hit-testing (spatial-index), snappen, hulplijnen;
- tools en live-previews (tot M10);
- selectiegrepen, rubber band, crop- en proefleesoverlays;
- de DOM-teksteditor, panelen en `mcp-bridge.js`;
- print- en exportcompositie;
- het volledige web- en Android-pad (pdf.js).

## 6. Fase 2 (Iced) — alleen de kaders

- `open-pdf-kernel` gaat ongewijzigd mee. De Tauri-commands zijn dunne adapters; Iced roept `Session` direct aan.
- In fase 2 wordt de kernel eigenaar van het model. Undo, hit-testing en tools komen erbovenop, op basis van de bounds van de display list.
- **Licentie:** de Iced-schil op `feat/rust-native` is GPL-3.0 door de overgenomen OpenCADStudio-UI, terwijl deze repository LGPL-3.0 is. Besluit: de Iced-UI wordt in fase 2 opnieuw geschreven onder LGPL-3.0-or-later; de tak is alleen functionele referentie.
- **Optioneel:** de kernel naar WebAssembly. Hayro is pure Rust, dus web en Android kunnen dan ook van pdf.js af. Android heeft dan wel commands nodig die met bytes werken, omdat `content://`-URI's geen bestandspad zijn.

## 7. Open punten

1. **Tak `feat/rust-native`.** oscar981-op werkt er niet meer aan; de migratie gaat verder in deze repository. Onderdelen worden fasegewijs overgenomen (zie 4.2); DynLex en de eigen proefkernel gaan niet mee. Onderdelen uit `native-app` worden opnieuw geschreven (licentie, zie 4.2).
2. **Drempel voor pixelpariteit.** Voorstel: 99,5 % van de pixels binnen 8/255.
3. **Hayro op zware scans.** Blijft PDFium standaard voor scans, of kiest de app automatisch een engine per paginatype? De bestaande `analyze_page_type` kan dat onderscheid al maken.
4. **Pre-1.0-afhankelijkheden.** `vello_cpu` (0.0.x) en Hayro worden exact vastgepind. Updates gaan als losse ronde, met de volledige sweep.

## 8. Verwijzingen

- #454 — Reduce the JavaScript (opruimplan)
- #463 — JS→Rust gemeten (gesloten); scripts in `open-pdf-studio/scripts/bench-rust/` op tak `research/js-naar-rust`
- #395 — rendertijd zware tekeningen
- Tak `feat/rust-native` op de fork van oscar981-op: `rust-studio/docs/` (enginevergelijkingen, opslaan, MCP)

## 9. Voortgang

### M0 — kernel-crate (19-10-2026)

`open-pdf-kernel` bevat:
- het annotatiemodel: het ruwe JSON-object is de bron, met getypeerde leesfuncties;
- de display list;
- de rasterizer: vello_cpu 0.3;
- de golden-harness.

Status:
- 29 tests; ze draaien in CI op alle drie de platformen;
- een onafhankelijke review is verwerkt;
- nog niet aangesloten op de app.

### M1 — Hayro als schakelbare pagina-engine (19-10-2026)

Gebouwd:
- `open_pdf_kernel::pdfrender` op Hayro 0.8;
- een Hayro-route in de worker (`engine`-veld);
- de engine wordt doorgegeven via de pool, de commands en de cachesleutels;
- een voorkeur "Paginarender-engine" onder Paginaweergave, vertaald in alle 40 talen;
- de statuschip toont "Hayro".

Standaard blijft PDFium.

**Engine-vergelijking**

Gemeten met `pdfium-worker/examples/engine_compare.rs`, in release-modus:
- beide verificatiemappen, 219 unieke pagina's (dubbele bestanden één keer geteld);
- de langste zijde gerenderd op 2048 px;
- per pagina de eerste render (inclusief openen van de pagina) en een herhaling.

| | PDFium | Hayro |
|---|---:|---:|
| Pagina's gerenderd | 219/219 | 219/219 (geen fout, paniek of time-out) |
| Mediaan per pagina, eerste render | 76 ms | 91 ms |
| Mediaan per pagina, herhaling | 74 ms | 87 ms |
| Totaal alle pagina's | 88,2 s | 85,9 s |
| Lichte pagina's (< 200 ms bij PDFium), 148 stuks | 8,6 s (mediaan 39 ms) | 11,1 s (mediaan 61 ms) |
| Zware pagina's (≥ 200 ms), 71 stuks | 79,6 s (mediaan 540 ms) | 74,7 s (mediaan 415 ms) |

Snelheid:
- Hayro is sneller op zware tekeningen. De sterkste winst is MV-03: 7,3 s tegenover 21,9 s. Zware vector, NKD1a en NKE2D2 zijn 30–40 % sneller.
- Op lichte tekst- en rapportpagina's is Hayro trager, gemiddeld ongeveer 25 ms extra per pagina.
- De grote uitschieter is 2196-CB-21 p1 (de bekende mesh-shading-pagina, #395): 24,5 s tegenover 3,3 s.

Volledigheid:
- Het aandeel duidelijk afwijkende pixels (een kanaal > 64 verschil) heeft een mediaan van 0,43 %, een p95 van 1,57 % en een maximum van 6,4 % (2196-CB-21).
- Het inktverschil heeft een mediaan van 0,12 procentpunt en een maximum van 1,5.
- Alleen 2196-CB-21 is gevlagd. Visueel is die pagina gelijk; het verschil komt van de anti-aliasing van zeer fijne tekst.
- Er is geen enkele lege of half getekende pagina.

Bekende verschillen:
- `thin_lines` werkt nog niet met Hayro.
- PDFium tekent het uiterlijk van formuliervelden in de paginabitmap mee, Hayro niet. De app heeft een eigen formulierlaag (`form-layer.js`); of die dit volledig opvangt, wordt in de sweep met formulierbestanden gecontroleerd.
- Het geheugengebruik op zware scans is niet gemeten.

**Geheugenwacht voor mesh-shadings (bevinding uit de sweep in de app)**

Hayro sampelt elke mesh- of functie-shading naar een textuur zo groot als het gevulde gebied, en houdt alle texturen vast tot de pagina is gerasterd.

Gevolg op 2196-CB-21 (576 mesh-vullingen):
- 4,4 GB bij 50 %;
- 14,8 GB bij 100 %;
- vastgelopen bij 200 %.

In de app tellen vier workers dit op, waarna het geheugen opraakte en de app crashte.

Oplossing:
- De kernel weigert vooraf een pagina met meer dan 64 van zulke shadings, of waarvan de texturen bij de gevraagde grootte boven 1 GiB kunnen uitkomen. De weigering is herkenbaar aan `HAYRO_UNSUPPORTED`.
- De app rendert zo'n pagina vanaf dan met PDFium, en de statuschip toont daar "PDFium".
- Andere fouten worden niet verborgen.

**Optimalisatie: cache-hergebruik en multithreading**

Hayro's render-cache (fonts, glyph-contouren) blijft nu per document bestaan. De rasterizer kan extra threads gebruiken.

Meting:
- verificatiemap, 213 pagina's;
- 32 logische kernen;
- verhouding van de totale rendertijd Hayro/PDFium (lager is beter voor Hayro);
- de geweigerde mesh-pagina telt niet mee.

| Threads | Alle pagina's | Lichte pagina's | Zware pagina's | Mediaan licht (ms, H/P) | Mediaan zwaar (ms, H/P) |
|---:|---:|---:|---:|---:|---:|
| 0 | 0,56 | 1,21 | 0,51 | 57 / 36 | 478 / 665 |
| 2 | 0,45 | 1,06 | 0,41 | 45 / 32 | 370 / 611 |
| 4 | 0,42 | 1,00 | 0,38 | 37 / 27 | 378 / 554 |
| 8 | 0,39 | 0,98 | 0,35 | 33 / 25 | 355 / 507 |

De worker kiest `min(4, kernen/4 − 1)` threads, omdat de app vier workers naast elkaar draait. Op deze machine zijn dat 4 threads; `OPDS_HAYRO_THREADS` overschrijft dit.

Met 4 threads is Hayro:
- op lichte pagina's even snel als PDFium;
- op zware tekeningen ongeveer 2,6× sneller.

**Volledigheid in de app (MuPDF-vergelijkings-sweep, zelfde build, beide engines)**

Opzet:
- 46 bestanden, 167 pagina's;
- gemeten met `verify-mupdf-compare.mjs` in een geïsoleerde rig (MCP 9235);
- elke pagina vergeleken met een onafhankelijke MuPDF-render.

| | PDFium | Hayro |
|---|---:|---:|
| Gevlagde pagina's | 13 | 10 |
| Mediaan \|inktverschil\| met de referentie (procentpunt) | 2,27 | 1,31 |
| Mediaan occupancy-overeenkomst | 1,000 | 1,000 |

Wat alleen bij PDFium gevlagd is:
- MV-03;
- Technische tekening p3 (beide mappen);
- Zware vector p8 (beide mappen).

Wat alleen bij Hayro gevlagd is: NKD1a p5 en p6. Bij nader onderzoek was dat een tegel die bij de schermafbeelding nog niet klaar was; de rig draait een debug-build. Na wachten is de pagina compleet.

2196-CB-21 is in beide sweeps leeg op het moment van de schermafbeelding. Dat is de bekende trage pagina (#395). Met Hayro valt die pagina nu terug op PDFium en wordt hij correct getoond.

**Snelheid in de app (prestatiepoort, release-build, mediaan van 3 rondes)**

Gemeten met `PRESTATIE_ENGINES=pdfium,hayro node scripts/verify-prestaties.mjs <exe> pdfium <exe> hayro`. Getoond is de tijd van openen tot de eerste inkt, en van zoomen naar 200 %.

| Bestand | Openen PDFium | Openen Hayro | Zoom PDFium | Zoom Hayro |
|---|---:|---:|---:|---:|
| licht (Tekst) | 329 ms | 343 ms | 172 ms | 171 ms |
| middel (Technische tekening) | 504 ms | 505 ms | 196 ms | 226 ms |
| annotatierijk (NKD1a) | 730 ms | 693 ms | — | — |
| zwaar (Zware vector) | 1178 ms | 1222 ms | 176 ms | 167 ms |

In de app is het verschil tussen de engines binnen de meetruis:
- De eerste inkt is een voorvertoning op lage resolutie, waarin vooral de app-pijplijn de tijd bepaalt.
- Het voordeel van Hayro op zware tekeningen (2,6× in de engine-vergelijking) zie je pas bij het scherp worden en bij tegels op hoge zoom. Die momenten meet deze poort niet.
- De zoommeting op NKD1a lukt bij beide engines niet; dat was al zo.

## 10. Vervolgonderzoek: meer naar Rust, en sneller opstarten (20-10-2026)

Gevonden door code te lezen en de bestaande opstartlog te analyseren. Niets is nog gebouwd. De milliseconden zijn schattingen, tenzij anders vermeld.

### 10.1 Opstarten

Opstartlog (`startup-diagnostics.jsonl`, laatste 8 starts):
- van het Rust-setupmoment tot `frontend-boot-start`: 540–970 ms;
- van `frontend-boot-start` tot `frontend-rendered`: 140–280 ms.

Het grootste deel zit dus vóór `main.js`: het opstarten van WebView2 en het laden en evalueren van de **5,17 MB grote hoofdchunk**. De Rust-setup zelf is goedkoop.

| # | Maatregel | Geschatte winst | Moeite / risico |
|---|---|---|---|
| 1 | Eerst splitsen: een meetpunt in `opds-vooraf.js` en aan het begin van `main()`, om WebView2-tijd en bundeltijd te scheiden | bepaalt de rest | triviaal |
| 2 | De ±55 dialogen in `DialogHost.jsx`, plus `CompareView`, `SchedulePanel`, `SymbolTypeEditor`, `AssistantPanel` en `MobileApp`, lazy laden (`lazy()`) | 60–150 ms, > 1 MB | laag–midden |
| 3 | fontkit (±750 KB) dynamisch laden; het komt nu binnen via AppMenu → saver → text-edits → mcp-text-font | 20–50 ms | zeer laag |
| 4 | pdf-lib en pdf.js uit het opstartpad: dynamische import in loader/saver | 30–80 ms, ±1 MB | midden |
| 5 | De worker-pool pas na de eerste render starten, en de 4 workers parallel in plaats van na elkaar | 10–50 ms; 100+ ms op trage of virusscanner-zware machines | laag |
| 6 | i18n: Engels en de gekozen taal parallel laden (nu twee opeenvolgende batches met top-level await) | 5–30 ms | laag |
| 7 | De drie IPC-aanroepen vóór `render()` parallel uitvoeren | 5–15 ms | laag |
| 8 | `init_pdfium` op een achtergrondthread, en het overbodige decoderen van het venster-icoon weg | 15–40 ms | midden / laag |

Daarnaast:
- de MCP-bridge registreert 84 listeners, ook als MCP uit staat;
- donkere thema's zien bij de start een lichte flits.

### 10.2 Meer naar Rust (naast de annotatie-mijlpalen M2–M11)

| # | Onderdeel | Nu | Rust-route | Winst | Moeite |
|---|---|---|---|---|---|
| 1 | **MuPDF-WASM verwijderen** | dode code: 10 MB `.wasm` in de bundel, en de licentie is **AGPL-3.0** | niets nodig, alleen verwijderen | 10 MB kleiner, licentieprobleem weg | triviaal |
| 2 | Binaire IPC | `extract_draw_commands` en `write_temp_pdf` sturen bytes nog als JSON-getallen; miniaturen als base64 | `ipc::Response` / ruwe body (patroon bestaat al) | MB's minder parsen per vectorpagina en printopdracht | klein |
| 3 | Quick wins uit #463 (JS) | `findAnnotationAt` scant alles; `searchPage` filtert per treffer | spatial index aansluiten; binair zoeken | ms → µs bij duizenden markups | klein |
| 4 | Printen naar printer | rastert elke pagina met pdf.js naar JPEG | de vectorroute die printen-naar-PDF al gebruikt | sneller, scherper, minder geheugen | klein–midden |
| 5 | Comprimeren | rastert alles naar JPEG (tekst en vectoren gaan verloren) | alleen beeld-XObjects herschalen met lopdf, `image` en turbojpeg | echte compressie, veel sneller | midden |
| 6 | Tekstlaag en zoeken | pdf.js `getTextContent` naast een tweede Rust-pad zonder fontinfo | PDFium-tekst-API (al gelinkt, nog ongebruikt); `search_document` parallel met rayon | snel zoeken in het hele document, één tekstmodel | midden–groot |
| 7 | Snap-geometrie | pdf.js `getOperatorList` (decodeert ook beelden, breekt bij pdf.js-updates) | interpreter van open-pdf-render | seconden op zware CAD-pagina's | midden |
| 8 | Pagina-bewerkingen, splitsen, samenvoegen | pdf-lib laden + opslaan per bewerking; undo bewaart twee volledige PDF-kopieën | PDFium-pagina-API of lopdf | seconden en veel geheugen | midden |
| 9 | Pagina's vergelijken | eigen pdf.js-documenten en `getImageData` | worker-pool-render + diff in Rust | geen tweede parse, parallel | midden |
| 10 | Beelden decoderen | handgeschreven JS-decoder | Hayro of PDFium (JPX, JBIG2, CCITT, ICC) | vooral correctheid | midden |
| 11 | Fonts subsetten (fontkit weg) | fontkit plus runtime-patch van de CFF-subsetter | ttf-parser / hayro-font + `subsetter`-crate | afhankelijkheid en patch weg | midden, samen met M10 |

**pdf.js helemaal weg op desktop** kan nog niet:
- formulieren (de HTML-widgets van `AnnotationLayer`) zijn de lastigste blokkade;
- tekstbewerking gebruikt pdf.js-fonts.

Als tussenstap kan pdf.js lui geladen worden, alleen bij formulieren of tekstbewerking. Dat kan zodra #6, #7 en M7 er zijn, en scheelt de parse van de 2,4 MB pdf.js-worker en een extra volledige kopie van elke PDF in het geheugen.

Wat door Rust gaat, is alleen voor desktop. Web en Android houden de pdf.js-route, tenzij de kernel naar WASM gaat (§6). Uitzondering: #1 en #3 helpen alle builds.

### Stand Automatisch (standaard sinds 20-10-2026)

Voorkeur "Paginarender-engine": **Automatisch** (standaard), PDFium of Hayro.

Regel voor Automatisch, per pagina:
1. Het **paginagewicht** wordt gemeten met `page_render_weight`: de ruwe (gecomprimeerde) bytes van de content-streams plus alle form-XObjects die de pagina tekent, recursief en elk één keer. Beelden tellen niet mee.
2. Een pagina met **meer dan 6 MB gecomprimeerde content** blijft op PDFium. Die gaat bij tegels naar de scene-engine, die de pagina één keer voorbereidt (bijvoorbeeld MV-03). Reden in de log: `auto-scene`.
3. Bij een **gewicht vanaf 100 KB** tekent Hayro de paginabitmap (`auto-heavy`). Op de verificatieset waren dat 36 pagina's, en Hayro was op alle 36 sneller (0,21–0,63× de tijd van PDFium).
4. Daaronder blijft het PDFium (`auto-light`).
5. **Tegels bij inzoomen** gaan in Automatisch altijd over de PDFium-route. Hayro interpreteert per tegel de hele pagina, terwijl PDFium een zware pagina geparst openhoudt. Gemeten op NKD1a p2: scherp bij 400 % na 4,2 s met Hayro-tegels, tegen 0,7 s.
6. De geheugenwacht blijft: een pagina die Hayro weigert (`hayro-refused`) gaat naar PDFium.

Waarom NKD1a "met PDFium opende": pagina 1 is vrijwel leeg (0 bytes content; PDFium 9 ms, Hayro 35 ms) en gaat dus terecht naar PDFium. De pagina's 2–7 (1,0–1,9 MB) gaan naar Hayro. Daarnaast vergeleek de eerste regel gecomprimeerde bytes met een drempel die op gedecomprimeerde bytes was gekalibreerd; dat is hersteld.

Logging per pagina:
- in de console: `[render-engine] <bestand> p<n>: hayro (auto-heavy, weight 1792 KB, threshold 100 KB, 4 threads; tiles pdfium)`;
- in de MCP-status: `app_get_viewport_state.pageEngine` = `{ mode, engine, tiles, reason, weightKB, threads }`;
- in `verify-mupdf-compare` en `verify-prestaties` per pagina of bestand.

**Vervolgstap — tegel-cache voor Hayro:** de voorbereide scène per zoomniveau één keer opbouwen en tegels daaruit rasteren (vello_cpu `render_with` met een offset). Dan kunnen ook tegels naar Hayro.
