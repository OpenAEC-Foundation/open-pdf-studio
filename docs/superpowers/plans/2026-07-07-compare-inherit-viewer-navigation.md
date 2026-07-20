# Compare-modus erft de normale viewer-navigatie — Implementatieplan

> **Voor uitvoerders:** volg fase voor fase; elke fase is los testbaar en committen. Steps met checkbox (`- [ ]`).

**Doel:** De pan/scroll/zoom-navigatie én rendering in de PDF-vergelijkmodus zijn *identiek* aan de normale PDF-weergave — geen aparte omgeving meer. Overlay = de normale viewer met een verschil-laag erover; naast-elkaar = split screen met een **kopie** van de normale navigatie per kant, gesynchroniseerd. **Compare vergelijkt zowel de PDF-inhoud als de annotaties** (toegevoegd / verwijderd / gewijzigd) — nu ontbreekt het annotatie-vergelijk volledig omdat de compared image alleen het kale PDF-raster bevat (PDF.js), niet de annotatie-overlay.

**Architectuur:** De viewport/navigatie wordt **instantieerbaar** gemaakt (factory `createViewport(canvas, container, opts)`) i.p.v. een singleton. De bestaande `viewport`-export wordt de **default-instantie** → de normale app-navigatie blijft byte-voor-byte behouden. Compare maakt extra instanties (1 voor overlay, 2 voor split) die via **dezelfde** render-pijplijn (PDFium worker-pool via `engine-router.renderPdfPage`) tekenen. PDF.js verdwijnt uit compare.

**Tech:** Bestaande `pdf-viewport.js` (RAF-paint, pan/zoom/wheel/momentum/zoom-anker), `engine-router.renderPdfPage`, `page-bitmap-cache.ensureBitmap`, `change-detector.js` (blijft), SolidJS `CompareView.jsx`.

---

## Kernontwerp

1. **De-singletonisatie (additief).** `pdf-viewport.js` levert `createViewport(canvas, container, { onAnnotationRedraw })` → een object met eigen `state` (het huidige `viewport`-object), eigen `_canvas/_ctx/_rafId/_resizeObserver`, en methodes `startPan/updatePan/endPan/wheelZoom/paint/setPage/destroy`. Alle module-locals worden instance-velden.
   - De bestaande `export const viewport` + `initViewport()` blijven bestaan als **dunne wrapper** rond één default-instantie. Alle bestaande imports (`viewport.zoom`, `viewport.offsetX`, …) blijven werken → **normale nav ongewijzigd**.
   - `#pdf-container` wordt niet meer hardcoded in de instance: de container komt als param. De default-instantie krijgt `#pdf-container` (zoals nu).
2. **Rendering via de hoofd-pijplijn.** Een compare-instantie zet `state.filePath`/`state.pageNum` op het OUD- of NIEUW-document en tekent via `engine-router.renderPdfPage` + `ensureBitmap` — exact het pad van de normale viewer → **identieke look & feel** (zelfde PDFium-raster, zelfde tegels/zoom-buckets, zelfde progressive-render).
3. **Overlay-modus** = één compare-viewport-instantie op het NIEUW-document (volledige normale navigatie) + een transparant **highlight-canvas** als bovenlaag (bestaande `drawHighlights`), meebewegend met de viewport-transform (offset/zoom).
4. **Naast-elkaar** = twee instanties (OUD links, NIEUW rechts), elk met volledige normale navigatie; pan/zoom van de één wordt naar de ander gespiegeld (gedeelde `offsetX/offsetY/zoom`). Per kant een highlight-laag (rood op OUD, groen op NIEUW, geel beide).
5. **Verschildetectie** (`change-detector.js`) blijft ongewijzigd; voedt de highlight-lagen en de bestaande verschillenlijst.
6. **Annotatie-vergelijk (nieuw).** Twee complementaire lagen:
   - **Visueel:** omdat compare elke kant rendert zoals de normale viewer, worden de annotaties (`doc.annotations` via `drawAnnotation`) mee-gecomposit in de compared image. De bestaande pixel-diff pakt daardoor annotatie-toevoegingen/-verwijderingen/-wijzigingen automatisch mee → "Toegevoegd" werkt weer.
   - **Structureel:** een aparte annotatie-diff vergelijkt de twee `doc.annotations`-lijsten (matchen op type + positie + inhoud) en toont een eigen **"Annotaties"**-sectie in de wijzigingenlijst (toegevoegd = in nieuw niet in oud, verwijderd = omgekeerd, gewijzigd = gematcht maar andere eigenschappen). Klik → beide panelen navigeren ernaartoe. Zo is "annotaties" een herkenbare categorie, los van inhouds-verschillen.
   - Toggle "PDF-inhoud / Annotaties / Beide" zodat de gebruiker kan kiezen wat vergeleken wordt.
7. **Verwijderen:** PDF.js-render + bespoke pan/zoom/scroll in `CompareView.jsx` en de PDF.js-render in `compare-viewport.js` vervallen.

---

## Bestandsstructuur

- **Wijzigen** `open-pdf-studio/js/pdf/pdf-viewport.js` — factory `createViewport()`; singleton → default-instantie-wrapper. Grootste/risicovolste wijziging.
- **Wijzigen** `open-pdf-studio/js/pdf/bitmap-orchestrator.js` — functies die nu de globale `viewport` lezen krijgen een `vp`-parameter (default = de default-instantie), zodat compare-instanties hun eigen orchestrator hebben.
- **Wijzigen** `open-pdf-studio/js/solid/components/compare/CompareView.jsx` — bespoke nav eruit; canvassen gedreven door compare-viewport-instanties; sync-laag tussen de twee.
- **Wijzigen** `open-pdf-studio/js/compare/compare-viewport.js` — PDF.js-render eruit; alleen nog detectie-orkestratie (rasterisatie voor detectie kan via `render_pdf_page`-worker i.p.v. PDF.js).
- **Mogelijk nieuw** `open-pdf-studio/js/compare/compare-nav.js` — dunne helper die twee instanties synchroniseert (pan/zoom mirror) + de highlight-lagen positioneert.
- **Ongemoeid:** `change-detector.js`, `overlay-renderer.js` (drawHighlights), `compare-store.js` (mode/pages/changes/toggles blijven).

---

## Fasen (elk los testbaar + commit)

### Fase 0 — Vangnet: karakteriseer de huidige normale nav
- [ ] Rig-meetscript: open een PDF (enkel-modus), leg vast: `viewport.offsetX/offsetY/zoom` na een reeks pan/zoom/wheel-gebaren (referentiewaarden). Dit is de **regressie-oracle** voor "normale nav ongewijzigd".
- [ ] Idem continuous-modus: scroll-posities na wiel/sleep.
- [ ] Commit het meetscript onder `mcp-server/`.

### Fase 1 — `createViewport()` factory, default-instantie identiek
- [ ] Refactor `pdf-viewport.js`: verplaats module-locals naar een instance-object; `createViewport(canvas, container, opts)` retourneert het. `viewport`/`initViewport` worden een wrapper om één default-instantie.
- [ ] `bitmap-orchestrator.js`: voeg optionele `vp`-param toe (default = default-instantie) aan de functies die `viewport` lezen.
- [ ] Verifieer met Fase-0-oracle: normale nav (enkel + continuous) geeft **identieke** waarden. `esbuild`-bundle schoon. Geen zichtbaar verschil in de rig.
- [ ] Commit.

### Fase 2 — Compare-overlay op een compare-viewport-instantie
- [ ] `CompareView.jsx` overlay-tak: één `createViewport()` op het NIEUW-doc (canvas + container in de compare-body). Render via `renderPdfPage`. Highlight-canvas als bovenlaag, gepositioneerd met de viewport-transform.
- [ ] Pan/zoom/wheel = de normale viewer-handlers (via de instantie). Verwijder de bespoke overlay-nav.
- [ ] Verifieer: overlay voelt identiek aan de normale viewer; highlights blijven exact op de verschillen bij pan/zoom.
- [ ] Commit.

### Fase 3 — Naast-elkaar met twee gesynchroniseerde instanties
- [ ] Twee `createViewport()`-instanties (OUD/NIEUW) in twee panelen. `compare-nav.js`: spiegel `offsetX/offsetY/zoom` bidirectioneel (met her-entry-guard). Per kant een highlight-laag.
- [ ] Klik op een verschil in de lijst → beide instanties pannen/zoomen ernaartoe.
- [ ] Verifieer: identieke look & feel; panelen lopen exact synchroon; highlights kloppen; verschillend-grote pagina's netjes.
- [ ] Commit.

### Fase 3.5 — Annotatie-vergelijk (inhoud + annotaties)
- [ ] **Visueel:** composit `doc.annotations` (via `drawAnnotation`) op elke compare-render vóór detectie, zodat de pixel-diff annotatie-toevoegingen/-wijzigingen meepakt. Verifieer: de eerder getekende annotaties op NIEUW verschijnen nu onder "Toegevoegd".
- [ ] **Structureel:** `compare-annotations.js` (nieuw) — diff de twee `doc.annotations`-lijsten (match op type + genormaliseerde positie + inhoud), lever `{added, removed, modified}`-records. Toon een aparte **"Annotaties"**-sectie in de wijzigingenlijst; klik navigeert beide panelen.
- [ ] Toggle **PDF-inhoud / Annotaties / Beide** in de compare-toolbar (default: Beide).
- [ ] Verifieer met de twee CP-21-varianten uit de screenshot: toevoegingen/verwijderingen/wijzigingen van annotaties correct gecategoriseerd.
- [ ] Commit.

### Fase 4 — PDF.js verwijderen uit compare + detectie op de worker
- [ ] `compare-viewport.js`: vervang PDF.js-rasterisatie voor detectie door de PDFium-worker (`render_pdf_page` naar RGBA) op detectie-schaal. Verwijder de `pdfjs-dist`-import uit compare.
- [ ] Controleer of `pdfjs-dist` elders nog nodig is (tekstlaag gebruikt PDF.js — die blijft; alleen de **compare**-render vervalt).
- [ ] Verifieer: detectie-resultaten gelijk; geen PDF.js meer in het compare-render-pad.
- [ ] Commit.

### Fase 5 — Volledige verificatie
- [ ] Regressie: normale viewer (enkel/continuous/boek) ongewijzigd (Fase-0-oracle + visuele check).
- [ ] Compare overlay + naast-elkaar: pan/zoom/scroll identiek aan normaal; kleuren + lijst werken; sync klopt; Passend/100%.
- [ ] Alle voorbeeld-PDF's kort door de compare-flow.
- [ ] Linux-compat check (geen platform-specifieke aannames toegevoegd).

---

## Risico's & mitigatie

- **Kern-viewport raken kan de hele app breken.** → Fase 1 is puur additief met een regressie-oracle (Fase 0) die byte-gelijkheid van de default-instantie bewijst vóór er compare-werk op gebouwd wordt. Niet verder tot Fase 1 groen is.
- **De just-gefixte compare-diff-functie.** → Detectie/lijst/kleuren blijven; alleen de render+nav-laag wisselt. Fase 2/3 verifiëren dat highlights exact blijven kloppen.
- **`bitmap-orchestrator` leest nu een globale `viewport`.** → `vp`-param met default; bestaande callers ongewijzigd.
- **Zware pagina's / progressive render in compare.** → Komt gratis mee omdat compare nu hetzelfde pad gebruikt.

## Bewuste keuzes

- Instantieerbaar maken i.p.v. de compare-instantie hardcoden: nodig voor split-screen "kopie van de navigatie".
- Detectie blijft pixel-diff (ongewijzigd) — buiten scope van dit nav-plan.
- Annotatie-bewerken in compare blijft buiten scope (compare is vergelijken, niet annoteren).
