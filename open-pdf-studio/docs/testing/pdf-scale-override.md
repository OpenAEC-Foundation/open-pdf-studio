# Ingebouwde PDF-schalen overrulen (#1175)

Een PDF kan meerdere `/VP`-viewports met `/Measure` bevatten. Deze kregen
altijd voorrang op de documentkalibratie, ook nadat de gebruiker zelf een
referentielijn of verhouding instelde. De voorbeeldtekening van #1175 bevat
zes zulke viewports; bij (500, 500) geldt 0,07965182593845782 punt/mm.

In **Kalibratie** staat bij een document met ingebouwde schalen nu de optie
**Ingebouwde PDF-schalen overrulen**. Vink deze aan en pas een kalibratie toe.
De document-/paginaschaal wint dan van de geïmporteerde PDF-viewports.
Eigen schaalgebieden, viewport-annotaties en schaalbalken houden hun voorrang.
De standaard blijft het volgen van de ingebouwde schalen. Uitvinken of
Herstellen schakelt daarnaar terug; Annuleren verandert niets.

De keuze staat in `measureScale.overridePdfScale`, gaat mee met undo/redo en
browseropslag en wordt als `/OPS_OverridePdfScale true` in de eigen
Document-viewport opgeslagen. Bij override komen de eigen document- en
paginaviewports na de oorspronkelijke viewports, zodat ook de standaard
PDF-volgorde de gekozen schaal weergeeft. Oorspronkelijke woordenboeken en
onbekende sleutels blijven behouden. Niet-geladen pagina's krijgen eveneens
de actuele documentkalibratie; hun schaalannotaties blijven intact.

## Controle

- `node --test js/annotations/schaal-op-punt.test.mjs js/pdf/schaal-in-pdf.test.mjs`
  controleert schaalprioriteit, bron voor schaalcontrole, metadata, terugzetten,
  niet-geladen pagina's en `/UserUnit` met rotatie/CropBox.
- `node scripts/test-pdf-scale-override-browser.mjs` gebruikt de echte dialoog,
  maatberekening, undo/redo, saver en `loadPDF`. De standaardfixture is een
  kleine gegenereerde PDF; `OPS_SCALE_SAMPLE=/pad/naar/voorbeeld.pdf` gebruikt
  een lokale voorbeeldtekening zonder die aan de repository toe te voegen.
- De oorspronkelijke eerste drie regressies falen op upstream main vóór de fix.

Een browsercontrole is geen kwalificatie van een geïnstalleerde Tauri-app.
