# PDF.js: volgorde van combinerende tekens (#957)

PDF.js 6.4.299 classificeert onder andere U+034F (CGJ) als een sterke
links-naar-rechts-letter. Daardoor wisselen CGJ en fatha van plaats bij
extractie van de Arabische voorbeeldtekst. `disableNormalization` lost dat
niet op. De lokale correctie geeft BMP-tekens met Unicode `Bidi_Class=NSM`
die klasse vóór de bestaande blokclassificatie. De bestaande bidi-regels
doen vervolgens de ordening. Er worden geen tekens verwijderd of toegevoegd.

Dit is een lokale correctie, geen overgenomen upstreamfix.
[PDF.js #22433](https://github.com/mozilla/pdf.js/issues/22433) is de melding.
De tabel komt uit [Unicode 17.0.0 DerivedBidiClass](https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt),
SHA-256 `4867b4b7f0731ed1bfcd34cc6251211ff1542541fce0734b6fbda139ee80b3a4`.
De Unicode-licentie staat naast de tabel. `verify-bidi-nsm.mjs` vergelijkt alle
65.536 BMP-code-eenheden met die gepinde bron: 1.104 zijn NSM. De algemene
Unicode-categorie Mark is hier ongeschikt: sommige spatiërende tekens zijn L.

De correctie loopt door de bestaande workerpipeline voor de legacy-appworker
en de moderne web-unitworker. Versiecontrole, fout bij afwijkende broncode,
idempotentie, bestaande patches en de Chrome 91-transformatie blijven intact.
Gedeelde `node_modules` worden niet gewijzigd. De onafhankelijke kleurfix
in concept-PR #950 zit niet in deze branch; bij integratie moeten beide
pipeline-uitbreidingen behouden blijven.

## Betrokken paden

De PDF.js-tekstlaag en `find-controller.extractPageText` gebruiken
`getTextContent()`. De selectie bewaart de tekst uit die laag; contextmenu
en mobiele kopieeractie schrijven de geselecteerde waarde naar het klembord.
Office-export opent de actuele documentbytes opnieuw voor strikte extractie
en geeft die tekst via de bestaande layoutfuncties aan de DOCX/ODT-schrijvers.
Deze paden profiteren van dezelfde workerfix.

`createTextLayerFromRust` roept `extract_page_text` aan. Dat is een afzonderlijk
PDFium-pad: daarvoor claimen we geen gereproduceerde fout of oplossing.

## Verificatie

- Elf nieuwe tests: echte legacy/moderne workers, oude WebView-transformatie,
  exacte Unicode-volgorde met normalisatie aan/uit en DOCX/ODT-inhoud.
  Het originele workerbestand faalt aantoonbaar op de gegenereerde CGJ-PDF.
  Controls omvatten U+0300, U+034F, U+FE0F, Arabisch, Hebreeuws, gemengde
  scripts, cijfers, interpunctie, verticale tekst en een spatiërend L-teken.
- Appbrowsertest met eigen browser: echte loader, zoeken, selectie,
  klembord-API-roundtrip en echte Office-downloads. Zowel de gegenereerde
  fixture als het upstreamvoorbeeld behouden `مَ͏رْحَبًا` exact. De test
  gebruikt de geselecteerde waarde voor clipboard write/read; hij simuleert
  geen native toetsenbordactie en bedient niet het contextmenu.
- Volledige unitsuite: 6.779 geslaagd, 28 bestaande optionele tests overgeslagen,
  nul fouten. De bestaande Unicode-export- en shapingbewaking daarnaast
  afzonderlijk met gecontroleerde fonts: elf geslaagd, nul overgeslagen.
  Niet-ondersteunde nieuwe Arabische PDF-tekst blijft expliciet geweigerd.
- Typecontrole, appbuild en web-unitbuild geslaagd. Beide werkelijk uitgeleverde
  workers door `postscript-build-check.mjs` getest, inclusief de nieuwe
  extractie-/Officeproef en de bestaande PostScript-, nulfont- en XRef-proeven.
- 24 projectcontroles, versiecontrole 2026.45.10 en `git diff --check` geslaagd.
- Pixelcontrole van het echte upstreamvoorbeeld op schaal 2: vóór en na
  correctie dezelfde SHA-256
  `06992d8ecda36f27d5272bd14759cd5d6abcb5b3b7ab9d90fb1fed896b38d9cb`
  en 357 donkere pixels. Dit bewaakt bestaande PDF-glyphweergave; het is
  geen bewijs van de vormgeving in een externe Office-renderer.

De fixturegenerator `bidi-marks-fixture.mjs` valt onder de projectlicentie.
Hij maakt een eigen PDF met één ToUnicode-koppeling per glyphcode in visuele
volgorde. Er is geen ActualText of verwachte tekst in metadata. De zichtbare
Helvetica-glyphs zijn placeholders en testen bewust geen Arabische shaping.
De uitvoer is reproduceerbaar door vaste datums.

Het echte [upstreamvoorbeeld](https://github.com/user-attachments/files/34347372/pdfjs-cgj-repro.pdf)
is alleen lokaal getest en wordt niet meegeleverd wegens niet vastgestelde
herdistributierechten. SHA-256:
`865b902ac3a6555b10aaff5557decb21695b0c3f9470b9048430b4aef863341b`.

## Grenzen en vervolg

Deze wijziging is BMP-only, inclusief variation selectors U+FE00–FE0F.
PDF.js' bestaande bidi-implementatie werkt per UTF-16-code-eenheid;
supplementaire tekens, waaronder U+E0100–E01EF, zijn niet hiermee gekwalificeerd.
Het is geen volledige UAX #9-implementatie en geen algemene herschrijfslag
van RTL-selectie, geometrie of Office-layout. Een volgende uitbreiding moet
codepunten en bijbehorende positionering samen kwalificeren.

Een verpakte native app en visuele Office-rendering zijn niet getest.
Installerkwalificatie en upstreamreview blijven voorwaarden voor samenvoegen.
Er wordt geen release gepubliceerd. Het issue blijft gekoppeld voor deze
openstaande kwalificatie.

## Herhalen

Vanuit `open-pdf-studio`, met een geschikte Node-versie:

```sh
node --test scripts/pdfjs-bidi-marks.test.mjs
node scripts/verify-bidi-nsm.mjs /pad/naar/DerivedBidiClass.txt
node scripts/bidi-marks-office-e2e.mjs http://127.0.0.1:32857 /pad/naar/pdfjs-cgj-repro.pdf
node scripts/bidi-marks-render-probe.mjs original /pad/naar/pdfjs-cgj-repro.pdf
node scripts/bidi-marks-render-probe.mjs patched /pad/naar/pdfjs-cgj-repro.pdf
node scripts/postscript-build-check.mjs dist/assets
node scripts/postscript-build-check.mjs dist-web-unit/brokken
```

De browserproef vereist een eigen, al gestarte Vite-server. Het tweede
argument (upstream-PDF) is optioneel; zonder dat bestand draait de eigen fixture.
