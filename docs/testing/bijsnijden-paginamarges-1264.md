# Bijsnijden van paginamarges — #1264

## Reproductie en oorzaak

Het feedbackissue noemt niet welke bijsnijdopdracht of welk platform bedoeld
wordt. Deze wijziging behandelt een reproduceerbare fout in **Organize →
Crop Margins**. Het afzonderlijke bijsnijden van afbeeldingen verandert niet.

Maak een PDF met MediaBox `[0,0,600,400]`, CropBox `[100,50,500,350]` en een
zwart vlak `[150,100,350,200]`. Kies paginamarges bijsnijden, nul extra marge.
Op de ongewijzigde basis werden de pixelgrenzen naar de MediaBox omgerekend,
terwijl PDF.js de bestaande CropBox afbeeldt. De eerste uitsnede werd circa
`[75,67.33,374.25,200]`; nogmaals bijsnijden vergrootte het zichtbare vlak.
Markeringen bleven bovendien op hun oude schermcoördinaten staan.

De nieuwe geometrie gebruikt dezelfde PDF.js-viewport als het gerenderde
beeld, inclusief bestaande CropBox, paginarotatie, gebruikersrotatie en
UserUnit. De laatste gevonden pixel telt volledig mee. Extra marge wordt
per grens tegen de MediaBox begrensd, in fysieke punten. Markeringen
verschuiven star met de nieuwe oorsprong; ook vergrendelde aanhaalvakken
behouden hun pijlpunt en knik. Undo bewaart een diepe kopie van de geometrie.

## Controles

```bash
cd open-pdf-studio
node --test js/pdf/crop-margins-geometrie.test.mjs
node scripts/test-crop-margins-browser.mjs
node scripts/draai-unit-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
node --test js/pdf/rondgang-alle-soorten.test.mjs
node scripts/meet-bundel.mjs
node --test scripts/bundel-grootte.test.mjs
```

De browsertest maakt zelf PDF-fixtures, start een geïsoleerde Vite-server
zonder HMR en sluit alleen de eigen browser en server. Hij controleert de
echte lintknop en dialoog, een verschoven MediaBox-oorsprong, alle vier
kwartslagen, UserUnit 2 en een extra gebruikersrotatie. Hij vergelijkt
CropBox en markeringposities vóór/na bijsnijden, undo/redo en herhalen.
Pijlpunt, knik en armoorsprong van een vergrendeld aanhaalvak worden daarbij
apart gecontroleerd; daarna doorloopt de rechthoek de echte PDF-opslag en
heropening. De geometrie-unit-tests dekken ook één pixel en begrensde marge.
De browsercontrole is toegevoegd aan Linux-CI.

## Grenzen en oplevering

De melding bevat nog geen voorbeeldbestand of bevestiging dat paginamarges
bedoeld zijn. Daarom verwijst de PR naar #1264 zonder het issue automatisch
te sluiten. Bestaande afbeelding-bijsnijdtests slagen (10 tests).

De reeds op upstream main falende entry-bundelgrens blijft apart gevolgd
in PR #1258; de grens wordt niet verruimd. Native installerkwalificatie en
de releasepoorten uit `docs/release-testprotocol.md` zijn niet vervangen
door de browsercontrole. De PR blijft concept zolang deze controles ontbreken.
Er wordt geen release gepubliceerd.
