# PDF.js: inhoud buiten een soft mask (#1028)

De lokale display-fix voor PDF.js 6.4.299 bouwt voort op het voorstel in
Mozilla PDF.js #22480, commit `848363523c6d625710b2960238a91a06e9340e93`.
Dat voorstel is **niet gemerged**. De code is Apache-2.0, met attributie in
`pdfjs-soft-mask-bounds.mjs`. De dependency blijft ongewijzigd.

`drawImage` doet niets wanneer zijn bronvak het masker helemaal mist. Bij
`destination-in` blijft daardoor onterecht een rood vlak staan. Voor een
masker met nul buitenalpha slaat de fix de blit van een afzonderlijk
scratch-canvas over; bij in-place masking wist hij alleen het dirty-vak.
De bestaande afhandeling van gedeeltelijke overlap en niet-nul buitenalpha
blijft behouden. De knockout-bounds-optimalisatie (#637) blijft toegepast.

## Reproduceerbare controles

Vanuit `open-pdf-studio`:

```
node --test scripts/pdfjs-soft-mask-bounds.test.mjs scripts/pdfjs-knockout-bounds.test.mjs
node scripts/test-soft-mask-browser.mjs
```

De tweede opdracht vereist Chromium van Playwright en `pdftoppm` van Poppler.
Hij bouwt beide echte Vite-configuraties in tijdelijke mappen met een extra
testentry; de entry zit niet in normale builds. De app gebruikt de legacy
PDF.js-build, de webunit de moderne build. De worker komt uit de normale
patchpipeline. De browser rendert met de werkelijk gebouwde assets.

Alle fixtures worden zelf gegenereerd in `soft-mask-fixture.mjs`: vier
maskervarianten (luminositeit met zwarte, witte en grijze achtergrond en
een alphamasker), met/zonder knockout-groep en met/zonder eerder blauw vlak.
Geen externe voorbeeld-PDF of gebruikersdocument wordt gecommit. Het groene
controlevlak ligt buiten alle gewijzigde tekengebieden.

De tests controleren drie schalen (1, 1,5 en 4), vier rotaties, gedeeltelijke
overlap, disjuncte inhoud, eerder getekende inhoud en uitvoer via de echte
`renderPageOffscreen` plus PNG-codering. Een raster over vrijwel het gehele
paginabeeld wordt met MuPDF vergeleken; alleen twee pixels rond kleurovergangen
worden voor verschillen in anti-aliasing uitgesloten. Poppler controleert
onafhankelijk de kernpixels van de gegenereerde referenties.

## Referentieverschillen en grenzen

Poppler verwijdert bij een knockout-groep het eerdere blauwe vlak onder een
volledig transparant masker. MuPDF en de lokaal gepinde Linux-PDFium-bibliotheek
behouden het, net als de gecorrigeerde PDF.js-route. Daarom is MuPDF hier de
beeldreferentie. PDFium is aanvullend via zijn C-API gecontroleerd op zwart,
grijs en wit, met en zonder knockout; dit is geen test van de verpakte app.

PDF.js heeft daarnaast al vóór deze wijziging afwijkende kleuren bij grijze
maskers binnen knockout-groepen. Die **niet-nul-alpha**-route valt buiten de
nul-alpha-fix. Voor deze gevallen vergelijkt de browsertest de volledige PNG
met dezelfde PDF.js-build met alleen de bestaande #637-patch; de uitkomst
moet byte voor byte gelijk blijven. De test noemt dit expliciet en telt deze
gevallen niet als overeenkomst met MuPDF. Dit resterende compositorverschil
is niet opgelost en wordt in de PR/het issue vermeld.

Native weergave, een verpakte desktopinstaller en fysieke printers worden
niet door de browsertest gevalideerd. Er wordt geen release gepubliceerd.
