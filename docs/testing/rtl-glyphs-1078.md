# RTL-glyphgrenzen bij tekstextractie (#1078)

PDF.js 6.4.299 voegt de Unicode-tekst van alle glyphs samen vóór bidi.
Een glyph waarvan de ToUnicode-CMap `لا` bevat, heeft zelf al de logische
volgorde. Nogmaals omkeren levert `ال` op en verandert bijvoorbeeld `سلام`
in `سالم`. De bestaande NSM-classificatiepatch voor #957 voorkomt dit niet.

## Backport

`open-pdf-studio/scripts/pdfjs-bidi-glyphs.mjs` volgt Mozilla PR
[22521](https://github.com/mozilla/pdf.js/pull/22521), mergecommit
`5f2d7186f72c87e40150314c5cf856133f0b2466` (Apache-2.0).
Bidi ontvangt de glyphteksten als array. Tekens binnen één glyph blijven
bijeen wanneer hun berekende bidi-niveau gelijk is; gemengde niveaus blijven
per teken herschikt. Normalisatie gebeurt per glyph en wordt niet-enumerabel
gecached. De normalisatieverzameling van PDF.js wordt niet uitgebreid.

De patch wordt toegevoegd aan de bestaande productie-pijplijn, na de andere
workerbackports. Alle zeven vervangingsplaatsen worden vooraf gevalideerd.
Een ontbrekende, dubbele of gedeeltelijk gepatchte plaats stopt de build.
Een volledige herhaling is idempotent. Legacy en modern verschillen alleen
in de gebundelde naam van `shadow`; beide worden getest.

## Fixtures en tegenproeven

De vaste CI-cases zijn zelf gegenereerde minimale Type3-PDFs met expliciete
ToUnicode-glyphgrenzen, op basis van `bidi-marks-fixture.mjs`. Ze bevatten geen
gebruikersdata of externe fontbestanden. Ze testen lam–alef, een door PDF.js
genormaliseerde presentatievorm (U+FC42), cijfers, gemengde richting,
leestekens en combinatietekens. Bidi behoudt een spatie naast een glyph;
de publieke tekstextractie laat een spatie aan de rand weg (bestaand gedrag).
De regressies voor #957 blijven afzonderlijk actief.

Aanvullende lokale kwalificatie gebruikt Mozilla's `test/pdfs/issue16880.pdf`
op dezelfde commit, SHA-256
`762c9801a97104e209e2a9d66285a1136cca57d7e2fb5996a4625e36b4f388ed`.
Deze externe fixture wordt niet herverdeeld in deze repository; de tests
hebben haar niet nodig en accepteren optioneel een lokaal pad.
Verwacht volgens Mozilla's exacte assertion: `سلام کلاس لاله`.
De volledige oude patchpijplijn geeft `سالم کالس الله`, ook met
`disableNormalization: true`. Poppler is voor deze fixture geen onafhankelijke
juiste tekstoracle: het issue rapporteert dezelfde verkeerde woordvolgorde.

## Reproduceren

Vanuit `open-pdf-studio`:

```sh
node --test scripts/pdfjs-bidi-glyphs.test.mjs scripts/pdfjs-bidi-marks.test.mjs
node scripts/test-bidi-glyphs-browser.mjs
# Optioneel ook de hierboven beschreven officiële fixture:
node scripts/test-bidi-glyphs-browser.mjs /pad/naar/issue16880.pdf
```

De browserproef gebruikt de echte app en een eigen browserprofiel:
PDF-laden, tekstlaag, selectie, Ctrl+C/klembord, `extractPageText` en
`exportOffice` naar echte gedownloade DOCX/ODT-bestanden. De oude worker
bevat alle eerdere patches, inclusief #957; de weergavebibliotheek houdt
haar productiepatches. Zowel de oude verkeerde tekst als de nieuwe juiste
tekst wordt exact gecontroleerd. De canvasafbeelding vóór en na moet
bytegelijk blijven. De gegenereerde glyphs zijn eenvoudige rechthoeken;
de optionele officiële fixture controleert ook echte Arabische glyphbeelden.

## Bereik en beperkingen

Office-export opent altijd een PDF.js-extractiedocument. De PDF.js-tekstlaag,
browserkopie en PDF.js-zoekfallback gebruiken dezelfde gecorrigeerde tekst.
Desktopzoeken kan via `rust-zoektekst.js` de PDFium-worker gebruiken
(`extract_search_text`); deze patch wijzigt die backend niet. Een uitspraak
over de native PDFium-tekstcorrectheid vereist een aparte kwalificatie.
De browserproef kwalificeert geen verpakte Windows/macOS-WebView of installer.
