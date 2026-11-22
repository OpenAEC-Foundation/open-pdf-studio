# Annotaties uitlijnen tijdens slepen — #1216

Normaal slepen met Selecteren verplaatste alle annotaties met de ruwe
muisdelta. Alleen afbeeldingen hadden een eigen uitlijnfunctie. De bestaande
G-verplaatsmodus had al puntsnap en inferentie; de muissleep gebruikte die
geometrie niet.

Bij een gewone sleep worden de snappunten van de oorspronkelijke selectie en
van de overige annotaties op dezelfde pagina eenmaal geïndexeerd. Het dichtste
paar binnen de ingestelde schermstraal bepaalt één verplaatsing voor de hele
groep. Als er geen puntsnap is, levert de bestaande verplaatsinferentie de
uitlijn-, verlengings- en evenwijdige hulplijnen. De bestaande voorkeuren
bepalen welke punten en hulplijnen beschikbaar zijn. De correctie wordt steeds
vanaf de oorspronkelijke geometrie berekend; terugbewegen stapelt niets op.

- Object snap uit: vrij slepen.
- Shift tijdens de sleep: tijdelijk vrij slepen; Shift bij de eerste klik
  behoudt zijn bestaande selectiefunctie.
- Alleen afbeeldingen met afbeeldinguitlijning aan: de bestaande
  afbeeldinguitlijning houdt voorrang.
- Ctrl-sleep: de kopieën bewegen; de originelen blijven beschikbare doelen.
- Een groep krijgt één delta en één bestaande undo-stap.
- Indicatoren en hulplijnen worden ook in doorlopende weergave getekend en bij
  loslaten opgeruimd.

## Regressiebewijs

Op upstream `41ee1abd68949c446e11309ee3f98dcf6259d695` eindigt de lijn na de
proefsleep op `(197,148)` in plaats van het naburige eindpunt `(200,150)`.
Dezelfde browserproef met de wijziging eindigt exact op `(200,150)`.

Uit de appmap:

```sh
node --test js/tools/annotation-drag-snap.test.mjs
node scripts/test-annotation-drag-snap.mjs
node scripts/draai-unit-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/bump-version.js --check v2026.48.6
```

Zes gerichte geometrische tests behandelen lijnuiteinden, cirkelkwadranten,
veelhoekpunten, groepsafstand, zelfuitsluiting, pagina-uitsluiting,
zoomniveaus 25–6400%, terugbewegen en het uitschakelen van inferentie.
Acht geïsoleerde Chromium-scenario's doorlopen de echte dispatcher:
puntsnap, snap uit, Shift tijdens slepen, groep, Ctrl-kopie, uitlijnhulplijn,
doorlopende weergave en de bestaande afbeeldinguitlijning. Elk controleert
ook één undo-stap en het herstel van de oorspronkelijke geometrie.
De browserproef start een eigen Vite-server zonder HMR en raakt geen
gebruikersapp aan.

## Grenzen

Deze uitbreiding betreft bestaande annotatiegeometrie op de startpagina.
PDF-inhoud, de 2D-cursor en basispuntinvoer blijven beschikbaar via de bestaande
G-verplaatsmodus; die worden hier niet toegevoegd. De kandidaat-geometrie
komt uit dezelfde snap-engine als G-verplaatsen; rotatie- en
zichtbaarheidsregels van die engine zijn niet uitgebreid. Er zijn geen nieuwe
voorkeuren, vertaalteksten of wijzigingen aan greep-resize.

Lokaal geslaagd: 9.054 unit-tests (9.013 geslaagd, 41 overgeslagen, geen fouten),
zes gerichte geometrische tests, acht browserscenario’s, TypeScript, de
productiebuild en 54 runtime/release/signingcontroles. De snapindicator en
uitlijnhulplijn zijn ook op het gerenderde canvas bekeken.

Native Tauri-installers moeten nog worden gebouwd en gekwalificeerd. De PR
blijft concept zolang die vereiste controle geblokkeerd is. Er wordt geen
release gepubliceerd.
