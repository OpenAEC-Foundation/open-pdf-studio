# Systeemlettertypen insluiten — issue #1066

## Probleem en wijziging

Een tekstvak met BIZ UDGothic kon na opslaan een niet-ingesloten vervangend
lettertype en een ongeldige fontdictionary bevatten. De Windows-distributie
gebruikt TTC-bestanden; de insluitketen ondersteunde alleen losse TTF/OTF-fonts.
Daarnaast verwees `/DA` nog naar een losse fontnaam wanneer de appearance al
wel een ingesloten font gebruikte. Bij de openbare BIZ TTF bleek ook dat
fontkit oneven glyph-offsets afrondde bij het schrijven van een korte `loca`.

De native scanner indexeert nu ieder TTC/OTC-gezicht. De leesopdracht maakt van
het geselecteerde gezicht een losse sfnt met herberekende offsets/checksums.
Alleen geïndexeerde gezichten zijn leesbaar; de actuele insluitrechten worden
opnieuw gecontroleerd. De JavaScript-cache onderscheidt gezichtnummers en
respecteert het verbod op subsetting. `/DA`, `/AcroForm/DR` en de appearance
verwijzen naar hetzelfde ingesloten font. De fontkit-wrapper lijnt TrueType
glyphrecords uit op twee bytes voordat de `loca` wordt geschreven.

De bestaande native scanner staat nu in een GUI-onafhankelijke kernmodule,
zodat CI exact de productieparser en -selectie op drie platforms kan testen.
De nieuwe kleine glyphfixture is gegenereerd met eigen geometrie; er worden
geen lettertypen van derden aan de repository toegevoegd.

## Reproduceerbare controles

Vanuit `open-pdf-studio`:

```sh
node --test js/pdf/saver/systeem-fonts.test.mjs js/pdf/systeem-font-rondgang.test.mjs js/pdf/saver/ttf-subset-padding.test.mjs js/pdf/saver/tekstfont.test.mjs js/pdf/saver/cff-subset-herstel.test.mjs js/pdf/saver/typemachine.test.mjs js/pdf/haakjes-rondgang.test.mjs scripts/versievelden.test.mjs scripts/native-runtime.test.mjs scripts/release-config.test.mjs scripts/square-image-annotation.test.mjs scripts/linux-release-config.test.mjs
cargo test --locked --manifest-path scripts/font-native-tests/Cargo.toml --bin font-embedding-probe
node scripts/test-font-embedding-browser.mjs
npx tsc --noEmit
npx vite build
```

Lokaal: 96 JavaScript-/projecttests geslaagd, één overgeslagen omdat Cascadia
hier niet geïnstalleerd is; 9 native tests geslaagd. De afzonderlijke
Chromium-test controleert ook fontkits browser-Buffer. TypeScript en de
productiebuild slagen. De regressies falen met de oorspronkelijke saver;
de glyphfixture toont ook het foutieve resultaat van ongewijzigde fontkit.
De tests vergelijken echte glyphcontouren, fontresources en tekst na heropenen.

Aanvullend zijn twee gezichten (JP/SC) uit dezelfde geïnstalleerde Noto CJK
collectie uitgelezen. De Japanse tekstvak/callout-ronde slaagt. De openbare
BIZ UDGothic Regular TTF is met `BIZ UDGothic 日本語 123` opgeslagen, heropend
en door MuPDF gerenderd zonder de eerdere invalid-composite-glyph-meldingen.

Bronbestand voor die aanvullende proef:
[Google Fonts / Morisawa BIZ UD Gothic](https://github.com/googlefonts/morisawa-biz-ud-gothic/tree/a58cc6885c32c3a5eee197a28e67a35c05f2648d/fonts/ttf),
`BIZUDGothic-Regular.ttf`, SHA-256
`7d2b48d84ef4e65c9f85bcf65fb1fb41c92b134be641fab6a7141d597c9a92b0`.
De [Windows-fontdocumentatie](https://learn.microsoft.com/en-us/typography/font-list/biz-udgothic)
noemt de TTC-distributie. De openbare TTF is niet hetzelfde bestand als de
Windows TTC uit de melding.

Een aanvullende fontproef kan met `font-embedding-probe FAMILIE UITVOERFONT`
en `OPDS_TEST_FONT_FACE=/pad/font.ttf OPDS_TEST_FONT_TEXT='tekst' node --test
js/pdf/systeem-font-rondgang.test.mjs`. Optioneel schrijft
`OPDS_TEST_FONT_PDF=/pad/proef.pdf` het resultaat voor inspectie.

## Nog te kwalificeren

De exacte Windows TTC en de externe lezer uit de melding zijn hier niet
end-to-end getest. Controleer op Windows: installeer de nieuwe build, maak
een tekstvak en callout met BIZ UDGothic, sla op, open in de gemelde lezer en
controleer de zichtbare tekst, ingesloten font en het ontbreken van de
`/Widths`-fout. Installerbouw en upstream review blijven nodig voordat de
concept-PR gereed is voor merge. Versie 2026.46.28 volgt de repositoryregel
om de versie bij iedere push te verhogen; er wordt geen release gepubliceerd.
