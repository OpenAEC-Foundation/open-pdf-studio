# PDF-verbeteringen — 30 september 2026

## Vectorfragmenten (#509)

Bron: https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/509

- Knippen hergebruikt de reeds geparste bron en cachet de mini-PDF per bronbyte-object, pagina en rotatie. Een nieuwe bronrevisie met nieuwe bytes krijgt een nieuwe cache-entry.
- Opslaan deelt één zware bron-Form XObject per bron/pagina/doeldocument. Verschillende uitsneden krijgen een kleine wrapper met eigen BBox en matrix; identieke uitsneden delen ook die wrapper. PDFRefs worden niet tussen doeldocumenten hergebruikt.
- Previews volgen plaatsingsmaat, zoom en DPR, delen begrensde resoluties en kunnen bij uitzoomen een scherpere bestaande bitmap gebruiken. De previewcache heeft een budget van 128 MiB onbewerkte pixels en actualiseert de gebruiksvolgorde.
- Gelijktijdig wegschrijven van dezelfde tijdelijke bron is gededupliceerd. Preview-redraws worden per animation frame gebundeld; een geleegde cache accepteert geen oude renderresultaten.
- Afdrukken/exporteren wacht expliciet op fragmentbitmaps op uitvoerschaal, onafhankelijk van schermzoom of een gepauzeerde RAF. Een ontbrekende/mislukte render breekt af met een fout in plaats van placeholders op papier. Ook MCP-screenshots wachten op fragmentpreviews.

Er worden geen bronobjecten op geometrie verwijderd: dat kan bij clipping, formulieren, transparantie en tekst onbedoeld inhoud verliezen. De eerste preview van een zware bronpagina kan dus nog duur zijn. Print gebruikt voor de annotatielaag rasterbeelden, met de bestaande limiet van 4096 pixels aan de langste snippet-zijde; opgeslagen fragmenten blijven vectoren.

### Metingen en controle

Drie verschillende uitsneden per blad, vier kwartslagrotaties, echte `Technische tekening.pdf`: oude uitvoer 3.828.483 bytes, nieuwe uitvoer 1.282.337 bytes (circa 66,5% kleiner). In dezelfde verkennende run: inbedden + serialiseren circa 258 ms versus 104 ms. Alle vier pagina's renderen met MuPDF pixel voor pixel identiek. Dit is een componentproef, geen volledige opslagbenchmark of garantie voor ieder document.

## PR #500 en #503

Beide zijn al aanwezig in de lokale Git-geschiedenis: `abc0edff` en `52942545`, geïntegreerd via `287563d7`. Geen tweede toepassing nodig.

Bronnen: https://github.com/OpenAEC-Foundation/open-pdf-studio/pull/500 en https://github.com/OpenAEC-Foundation/open-pdf-studio/pull/503

Bestaande `scripts/bench/undo-node.mjs`, medianen van drie runs met 2.000 synthetische annotaties:

- Hoeveelhedenpaneel dicht: undo toevoegen 24,1 ms, undo verwijderen 19,4 ms, undo verplaatsen 6,5 ms; nul hoeveelhedenberekeningen bij undo verplaatsen.
- Paneel open: respectievelijk 211,5 / 198,4 / 170,9 ms; één hoeveelhedenberekening. Verplaatsen 353,4 ms. Dit blijft een concrete vervolgbottleneck.

De benchmark gebruikt echte reactieve stores met gestubde canvas-/bridgefuncties; dit zijn geen schermframetijden.

## PDFium-threadveiligheid (#262)

Bron: https://github.com/ajrcarey/pdfium-render/issues/262

De app heeft een eigen procesbrede mutex voor in-process renderen/laden; de losse workers verwerken verzoeken serieel in aparte processen. Wel gevonden: documentvrijgave, initialisatie van de renderer/CAD-binding, paginamaten in MCP/PNG-rendering en het aantal afdrukpagina's waren niet overal vergrendeld.

Deze routes gebruiken nu dezelfde mutex. `PdfiumDocumentHandle` sluit de C-documenthandle onder het slot, terwijl de bronbytes nog leven. De native regressietest `document_drop_waits_for_inproc_guard` slaagt met de echte PDFium-bibliotheek. Dit repareert de gevonden app-routes; het is geen upstream fix of bewijs dat de wrapper algemeen thread-safe is. Windows-afdrukken is niet op Windows uitgevoerd.

Native test reproduceerbaar met `OPDS_TEST_PDFIUM_DIR` (bibliotheekmap) en `OPDS_TEST_PDF` (bestaande PDF):

```sh
cargo test -p open-pdf-studio --lib document_drop_waits_for_inproc_guard -- --ignored
```

## PDF.js 6.3.289

Bron: https://github.com/mozilla/pdf.js/releases/tag/v6.3.289

Dependency en npm-lock bijgewerkt naar exact 6.3.289. Afsluiten gebeurt via `loadingTask.destroy()`. Maps voor bijlagen, bestemmingen, formuliervelden en JavaScript-acties worden op de UI-grens omgezet naar de verwachte records; PDF.js-objecten zelf blijven intact. De Vite-build levert CMaps, standaardfonts en WASM-decoders uit dezelfde geïnstalleerde release, en de developmentserver serveert diezelfde bestanden.

## Validatie

- Volledige JavaScript-suite: 2.580 geslaagd, 1 bestaande test overgeslagen, 0 mislukt.
- Laatste gerichte snippet/PDF.js-tests na previewgeometriecontrole: 28 geslaagd.
- TypeScript-controle en Vite-productiebuild geslaagd.
- Rust `cargo check -p open-pdf-studio --lib` geslaagd; bestaande deprecation-waarschuwing voor `Shell::open`.
- Native PDFium-vrijgavetest geslaagd.
- Chromium-browsertest: PDF.js 6.3.289 rendert paginatekst en een invulveld met waarde `Ada`; export wacht op een fragment en tekent de verwachte pixels. Alleen de snippet-rasterbackend is in die test gestubd; PDF.js-worker, tekstlaag, formulierlaag en canvas zijn echt. De Vite-HMR-websocket meldt twee bestaande verbindingsmeldingen op de afwijkende testpoort.
- De browsertest is vastgelegd in `open-pdf-studio/scripts/test-pdfjs-snippet-browser.mjs`; starten tegen een Vite-server op `OPDS_TEST_URL` (standaard http://127.0.0.1:3087).
- CMap/font/WASM-bestanden in `dist` zijn op inhoud vergeleken met de geïnstalleerde dependency.
- Linux `.deb` succesvol gebouwd met de bijgewerkte frontend: `target/debug/bundle/deb/Open PDF Studio_2026.39.0_amd64.deb` (206.531.290 bytes). Dit is een lokale debugbuild zonder updater-artifacts; nog niet geïnstalleerd.

Bestaande lokale wijzigingen zijn behouden. Geen Git-commit, push of installatie uitgevoerd.

## Live-controle van de gebouwde app

De bijgewerkte ontwikkelversie is gestart via de bestaande lokale binary; de snelkoppeling `Open PDF Studio Dev` verwijst hier al naar. PDFium en vier renderworkers initialiseren succesvol. De lokale MCP-interface op poort 9323 werkt.

- Technische tekening (vier pagina's) geopend in circa 1,4 seconde via MCP; fragment knippen circa 86 ms, twee keer plakken circa 118/91 ms, opslaan circa 315 ms. Eenmalige waarnemingen, geen vergelijkende benchmark.
- Apart testdocument met twee fragmenten opgeslagen en opnieuw geopend. Afdruk-PDF visueel gecontroleerd: fragmentinhoud aanwezig, geen placeholders.
- Een nieuw leeg bronblad valt bij afdrukken terug op een paginabeeld, ook na opslaan/heropenen. Deze resterende beperking is niet opgelost in deze ronde.
- Bestaande tekst-PDF met toegevoegd fragment afgedrukt via de vectorroute zonder waarschuwingen.
- Testresultaten staan onder `/tmp/opds-live-*`; oorspronkelijke corpusbestanden zijn niet overschreven. Geen systeembrede installatie uitgevoerd (sudo vereist een wachtwoord).

## Uitgebreide functietest na verzoek gebruiker

Uitgevoerd op 30 september 2026 in de draaiende ontwikkelversie, met aparte synthetische testbestanden in `/tmp/opds-feature-test`.

- 39 gerichte tests voor fragmentpreview, fragmentstore, vector-embedding en PDF.js-recordconversie: alle geslaagd.
- Herkenbaar blauw/oranje vectorfragment geknipt en tweemaal geplakt; tweede fragment verkleind van 240 naar 120 punten. Undo herstelt 240 punten, redo herstelt 120 punten (programmatisch gecontroleerd).
- Zoom 50%, 200% en 75% succesvol toegepast.
- Afdruk-PDF zonder waarschuwingen; visueel gecontroleerd naast de opgeslagen PDF: beide fragmenten zichtbaar op de juiste positie en schaal, zonder placeholders.
- Opgeslagen PDF heropend. Fragmenten zijn ingebakken vectorinhoud, geen bewerkbare annotaties na heropenen. Inspectie van de PDF-objecten bevestigt één gedeelde bron-Form en één gedeelde uitsnede-wrapper voor de twee plaatsingen.
- PDF.js-formulierveld zichtbaar in de app. Waarde `Ada` blijft behouden in de canonieke formulierstructuur na opslaan. Bewerken van het veld is niet bevestigd: de synthetische klik gaf geen invoerfocus, waardoor de typtest op de document-body belandde. Dit is een beperking van deze test, geen aangetoonde formulierregressie.
- Eigen testtabs gesloten en de eerder actieve tab hersteld; gebruikersdocumenten niet overschreven.

Ruwe resultaten: `/tmp/opds-feature-test/live.json`, `unit.log` en de test-PDF's. De eerder gemelde rasterfallback bij een nieuw leeg bronblad blijft een open punt; deze ronde testte een bronblad met inhoud.
