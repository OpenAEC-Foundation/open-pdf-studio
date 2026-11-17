# Iosevka opslaan — issue #1124

De fout `Not a fixed size` is gereproduceerd met de openbare Iosevka SS03
Regular 34.9.1 en een kleine zelfgemaakte fontfixture. Het papierformaat is
niet de oorzaak. De GSUB-type-8-parser van `@pdf-lib/fontkit` 1.1.1 mist
`backtrackGlyphCount`. Na herstel daarvan bleek ook de uitvoering van dat
substitutietype te ontbreken.

De gekwalificeerde broncorrectie in `scripts/fontkit-reverse-substitution.mjs`
voegt het lengteveld toe en voert de reverse chaining single substitution uit.
De verwerking loopt van de laatste naar de eerste glyph, ook bij een
extension lookup. Backtrack-dekking wordt vanaf de dichtstbijzijnde glyph
gecontroleerd; lookupflags en featureselectie blijven van toepassing.
Andere lookuptypes gebruiken de bestaande implementatie. Fontbytes,
fontkeuze en de bestaande CFF-/TrueType-subsetcorrecties blijven behouden.

Vite past de correctie toe in zowel de dependency-optimizer als de
productiebuild, voor de desktop/hosted-app en de web-unit. De SHA-256 van de
gekwalificeerde dependencybron wordt gecontroleerd; een andere dependency
moet opnieuw worden gekwalificeerd. `node_modules` wordt niet gewijzigd.

## Bewijs en herhalen

```sh
node --test scripts/fontkit-reverse-substitution.test.mjs
node scripts/test-fontkit-reverse-browser.mjs
OPDS_TEST_FONT_FACE=/pad/IosevkaSS03-Regular.ttf node scripts/test-fontkit-reverse-browser.mjs
```

De unitproeven reproduceren de oorspronkelijke fout en controleren context,
grensgevallen, feature uitgeschakeld, lege context, genegeerde marks,
reverse volgorde, extension lookup en gewone substitutie. De PDF-ronde
vergelijkt de contouren van de ingesloten glyphs en de Unicode-map.
De Chromiumproef gebruikt de echte systeemfontketen met geïnjecteerde
fontbestandslezing. Zowel de optimizer als een geminificeerde productiebundel
moet opslaan, heropenen en de oorspronkelijke tekst via PDF.js teruggeven.
De productieproef stubt de native platformmodule; een onverwachte native
oproep faalt. De synthetische fixture bevat uitsluitend eigen geometrie;
`generate-reverse.py` reproduceert die met fonttools 4.60.1.

Aanvullend getest bronbestand:
[Iosevka v34.9.1](https://github.com/be5invis/Iosevka/releases/tag/v34.9.1),
`PkgTTF-IosevkaSS03-34.9.1.zip`, bestand `IosevkaSS03-Regular.ttf`, SHA-256
`8c71d024d3c3cfc72b49970641a3b72d6ed50489e162deab93770190a0e171d4`.
Dit externe font wordt niet aan de repository toegevoegd.

De veldvolgorde en reverse verwerking volgen de
[OpenType GSUB-specificatie](https://learn.microsoft.com/en-us/typography/opentype/spec/gsub#lookup-type-8-reverse-chaining-contextual-single-substitution-subtable).
Ook upstream fontkit heeft inmiddels
[type-8-ondersteuning toegevoegd](https://github.com/foliojs/fontkit/commit/c08512de1cb5f63de0aa6a310ec8c6ecbf80cd45).
Deze lokale correctie blijft beperkt tot de gebruikte oudere pdf-lib-fork.

Lokaal geslaagd: zes gerichte regressies, beide Chromiumroutes met de
synthetische fixture en Iosevka SS03, TypeScript en de volledige
Vite-productiebuild (1m36s). Volledige suite: 8.497 tests, waarvan
8.463 geslaagd, 34 overgeslagen en nul mislukt. De bestaande ontbrekende declaratie
`Preferences.ocrLanguage` is toegevoegd zodat de typecontrole slaagt.

## Beperkingen

De exacte fontversie van de melder is onbekend. Native fontdetectie en
bestandsschrijven op macOS 27 zijn hier niet uitgevoerd; de browserproef
kwalificeert de gedeelde font-/PDF-keten. Installerbouw en een geïnstalleerde
macOS-proef blijven nodig. Geen nieuwe vertaalteksten of dependencies.
