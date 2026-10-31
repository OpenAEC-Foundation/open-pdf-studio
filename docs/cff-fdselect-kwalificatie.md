# FDSelect-regressieproef (#901)

De ruwe `@pdf-lib/fontkit` **1.1.1** bevat de fout uit
[fontkit #207](https://github.com/foliojs/fontkit/pull/207): de eerste glyph
van een volgend FDSelect-bereik krijgt soms het vorige Font DICT. De Tauri-app
herstelt dit al sinds [PR #416](https://github.com/OpenAEC-Foundation/open-pdf-studio/pull/416)
(commit `e800a2e25`) via `laadFontkit()` → `metCffHerstel()`.
Dezelfde omhulling herstelt ook de CFF-subsetkop en de koppeling van lokale
subroutines aan Font DICTs. Alleen `>` in de dependency veranderen zou die
andere noodzakelijke correcties niet vervangen.

Deze uitbreiding voegt bewijs en regressiedekking toe; er is geen tweede
productiefix, dependency-upgrade of wijziging aan `node_modules` nodig.
Alle productie-imports van fontkit lopen via `laadFontkit()`, ook de
CJK-keten, tekstbewerking/MCP en OCR-opslag.

## Reproduceren

Vanuit `open-pdf-studio`, met Node 22 en `npm ci`:

```sh
export OPS_UNICODE_FONT_DIR=/tmp/ops-unicode-fonts
node scripts/prepare-unicode-fonts.mjs
node --test js/pdf/saver/cff-boundaries.test.mjs
```

De bestaande CI haalt deze fixtures al vóór de volledige unit-tests op.
Zonder `OPS_UNICODE_FONT_DIR` worden de negen fixturetests lokaal overgeslagen;
met een ingestelde map zijn ontbrekende bestanden of verkeerde hashes fouten.
Er wordt tijdens de tests niets van het netwerk gehaald.

## Bewijs en grenzen

- Noto Sans JP, Sans2.004: 17.936 glyphs, 63 verkeerde Font DICTs met de ruwe
  dependency; nul met de bestaande wrapper. Elke glyph, elke bereikstart en de
  laatste glyph worden getoetst aan een onafhankelijke lineaire opzoeking.
  Dit draait op ES en UMD, elk met en zonder minificatie.
- `・ー：Ａ㐂ぁ` zijn echte bereikstarts in deze fixture. Elke glyph wordt apart
  opgeslagen en met MuPDF gerenderd op 144 dpi. De pixels moeten exact gelijk
  zijn aan MuPDF dat het **originele OTF rechtstreeks** tekent, zonder fontkit,
  pdf-lib, subsetting of PDF-CID-mapping in de referentie. De tekst wordt uit
  de opgeslagen PDF teruggelezen, niet uit metadata.
- De echte `saveTextEditsToPages()`-route gebruikt de normale fontkeuze en
  wrapper. Alleen platform-I/O is nagebootst: de JP-fixture vervangt de TC/SC-
  resource voor deze proef. Ook `maakCjkFontKeten()` wordt opgeslagen en met
  dezelfde referentie vergeleken. Dit is geen claim dat JP met de app wordt
  meegeleverd en geen interactieve Windows/WebView2-proef.
- CFF- en TrueType-OCR blijven onzichtbaar en exact terugleesbaar. De zichtbare
  TrueType-controle (Inter) vergelijkt volledige insluiting, subset en het
  originele font rechtstreeks in MuPDF.
- De test-PDF met zes CJK-glyphs is circa **19,8 kB** met subsetting, tegenover
  **3,96 MB** met volledige insluiting. Alleen de grootte van die volledige
  CFF-insluiting wordt gemeten: bij deze JP-fixture geeft pdf-lib 1.17.1 met
  `subset:false` afwijkende glyphs in MuPDF (onder meer `・` en `：`). Die route
  is dus **niet gekwalificeerd** als CFF-oplossing of als beeldreferentie.
  De productie gebruikt `subset:true`; er wordt geen volledige CJK-fontfallback
  toegevoegd. De proef kwalificeert evenmin alle mogelijke CFF-fonts.
- Negatieve controle: met uitsluitend de FDSelect-correctie tijdelijk
  uitgeschakeld falen zowel de losse glyph-renderproef als de daadwerkelijke
  tekstbewerkingsproef. De tests bewaken daardoor de bestaande correctie.

## Herkomst en licentie

De JP-fixture en bijbehorende OFL-licentie komen uit
[`notofonts/noto-cjk`, commit `523d033d6cb47f4a80c58a35753646f5c3608a78`](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78)
(tag Sans2.004). Download-URL's en SHA-256 staan in
`scripts/unicode-fonts.json`; beide bestanden worden gecontroleerd.
Het font staat alleen in de externe testcache, niet in Git of de appbundel.
Noto Sans JP en de bestaande Inter-fixture vallen onder **OFL-1.1**;
`@pdf-lib/fontkit` blijft de bestaande **1.1.1** onder MIT.
