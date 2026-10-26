# Drukwerk-flattening: no-go voor de huidige rasterexport (#731)

Besluit op 2026-10-26: gebruik de huidige rasterexport niet als een
kleurbehoudende transparantieflattener. Voeg geen drukklare/PDF/X-belofte toe aan
dit pad. Een nieuw selectief exportpad vraagt een afzonderlijke kwalificatie.
De bestaande Tauri-app blijft de basis; er is geen overstap naar een andere app.

## Reproduceerbare proef

De eigen fixture `scripts/fixtures/print-flattening/corpus.pdf` heeft zeven
pagina's: K over cyaan, steunkleur-overdruk, geïsoleerde groep, knockoutgroep,
RGBA-afbeelding met zacht masker over tekst, ICC-outputintent en geneste forms.
Elke pagina bevat controletekst. Het profiel is een synthetisch sRGB-profiel,
geen drukpersprofiel. Er wordt geen PDF/X-conformiteit gesuggereerd. Generator:
`generate.py` naast de PDF; Python met reportlab, pypdf en Pillow. De fixture
bevat geen artwork of fonts van derden; standaard Helvetica wordt verwezen.

Voer vanuit `open-pdf-studio/` uit met Vite op poort 3042:

```sh
OUTPUT_PDF=/tmp/print-output.pdf node scripts/check-print-flattening-export.mjs
python3 scripts/check-print-flattening-output.py /tmp/print-output.pdf /tmp/print-report.json
```

De eerste proef roept de echte `exportAsRasterPdf` aan, met de echte PDF.js-render,
markeringenroute, JPEG-worker en pdf-lib-writer. Alleen de Tauri-bestandswrite is
gemockt om de uitvoer op te vangen. `motor: pdfjs`, 150 dpi, Chromium; dit is geen
native PDFium- of Tauri/WebKit-kwalificatie. De tweede proef controleert de PDF
met pypdf en rendert bron én uitvoer onafhankelijk met Ghostscript `tiffsep`.
Het rapport bevat hashes, tekst, vakken, profielaantal en inktdekking per plaat.

| Eigenschap | Bron | Werkelijke rasterexport |
| --- | --- | --- |
| Pagina's | 7 | 7 |
| Bestandsgrootte | 8.565 bytes | 108.873 bytes |
| Doorzoekbare controletekst | alle 7 pagina's | geen enkele pagina |
| Steunkleurplaat `StudioSpot` | aanwezig | ontbreekt |
| Outputintent | 1 | 0 |
| MediaBox | 0,0,300,200 pt | 0,0,280,180 pt |
| CropBox | 10,10,290,190 pt | gelijk aan nieuwe MediaBox |
| TrimBox | 20,20,280,180 pt | gelijk aan nieuwe MediaBox |
| Overige inhoud | tekst/vectoren/transparantie | hele pagina als JPEG |

Eén meetrun: 327,4 ms binnen de exporter; piek van gesommeerde Chromium-RSS
737.656 KiB, elke 50 ms bemonsterd inclusief opstarten van de browserpagina.
Gedeelde geheugenpagina's kunnen dubbel tellen; Vite en native Tauri ontbreken.
Dit is geen decoderlimiet, geen zuivere exportdelta en geen snelheidsvergelijking
met Craft. Kleine pagina's zeggen niets over A0-piekgeheugen. De afzonderlijke
proces-RSS en end-to-endlatentie van een toekomstig native pad moeten opnieuw
worden gemeten.

De bron en uitvoer van de steunkleurpagina zijn ook via Poppler bekeken. Beide
hebben zichtbaar tekst en vlakken, maar de export bewaart geen tekstsemantiek of
steunkleur. Visuele gelijkenis is dus onvoldoende. JPEG-quantisatie en RGB-
conversie maken exacte plaatgelijkheid sowieso onhaalbaar in dit pad. De tests
bewaken deze bekende verliezen; bij verbetering moeten ze bewust worden herzien.

## Apart selectief pad: voorwaarden

[Craft PR 194](https://github.com/storytold/craft-libs/pull/194) is gemergd als
`24a472717acacfade2964241842745d7f0dd2929`. De flattener is de feature `flatten`
van **craft-prepress**, niet alleen craft-pdf. Hij gebruikt craft-pdf, craft-cms,
kurbo, linesweeper, ttf-parser en aangepaste Hayro/Krilla-code. De workspace
verklaart `MIT OR Apache-2.0`; dat vervangt geen controle van alle transitieve
licenties, notices en eventuele fontrechten. Er is geen dependency toegevoegd
en geen lokaal resultaat van deze kandidaat gemeten.

Een eventuele integratie hoort in een beëindigbaar exportproces met expliciete
geheugen-/tijdgrenzen. Input is een onveranderde documentgeneratie; uitvoer is
altijd een afzonderlijke kopie met atomische publicatie na succes. Een afgebroken
of deels verwerkte pagina mag nooit als geslaagde export worden opgeslagen.

Voor vrijgave moeten beide backends op dezelfde corpuspagina's aantonen:
steunkleurnamen/DeviceN en overprintbehoud, correcte soft masks en groepisolatie,
behoud van niet geraakte tekst/vectoren en de oorspronkelijke paginavakken,
expliciete outputintentbehandeling en controle van resterende transparantie.
Een volledige groepsrasterfallback moet als verlies worden gerapporteerd.
Onbekende blendmodes, niet ondersteunde ICC/DeviceN-combinaties en niet opnieuw
in te sluiten fonts geven een expliciet unsupported-resultaat. Metadata of een
PDF/X-label is geen vervanging voor plaatvergelijking en externe validatie.

Voorlopig is er dus geen nieuw ondersteund drukwerk-flatteningpad. Deze no-go is
het resultaat van de haalbaarheidsproef; de fixture en scripts maken een latere
kandidaatvergelijking concreet.
