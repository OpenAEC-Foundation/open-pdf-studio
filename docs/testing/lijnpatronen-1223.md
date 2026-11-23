# Geometrische lijnpatronen (#1223)

Voor een lijn of polylijn staan in Eigenschappen → Randstijl en Opmaak →
Rand negen extra patronen: hekwerk met cirkels of vierkanten, gas, warm water,
zigzag, isolatie, dubbel, spoor en weg. Ook de standaardstijl van een nieuw
lijngereedschap en benoemde stijlpresets kunnen deze patronen bewaren.

De bewerkbare hartlijn blijft behouden, inclusief Béziersegmenten. Dezelfde
geometrie tekent op het scherm en in de vector-appearance van de PDF. Het
bestand bewaart daarnaast `OPS_LinePattern` om het patroon bewerkbaar te
heropenen. Een andere PDF-lezer ziet de vector-appearance; een lezer die een
nieuwe appearance uit uitsluitend standaard `/BS` maakt, kan de symbolen
niet reconstrueren. Terugschakelen naar een gewone lijn verwijdert de eigen
sleutel. Er zijn geen extra fonts nodig voor de vaste GAS/HW-markeringen.

Dit zijn vaste grafische patronen, geen maatvaste weg-, spoor- of
installatieobjecten. Patroonmaat en afstand groeien mee met de lijndikte,
met minimaal 1 pt als patrooneenheid; dunne-lijnenweergave verandert alleen
de pen. Op uitzonderlijk lange paden wordt de afstand vergroot om het
rekenwerk te begrenzen. Hoeken krijgen afgeschuinde aansluitingen; teksten
en hekwerksymbolen staan als star teken op de plaatselijke raaklijn.

De uitbreiding geldt voor lijnen en open polylijnen. Pijlen, gesloten
vormranden, meetlijnen en revisiewolken vallen buiten deze wijziging. Het
isolatiepatroon behandelt ook het batting-deel van #1218; de vraag naar een
revisiewolk als lijnstijl is daarmee niet afgehandeld.

## Verificatie

- `node --test js/annotations/geometric-line-styles.test.mjs js/pdf/geometric-line-styles-roundtrip.test.mjs`
- `node scripts/test-geometric-line-styles.mjs`
- `node scripts/draai-unit-tests.mjs`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/vite/bin/vite.js build`

De gerichte tests behandelen alle negen patronen, korte en ongeldige paden,
herhaalde knopen, bochten, begrensd rekenwerk, dunne-lijnenweergave, twee
opslaan/heropenen-cycli en terugschakelen naar een gewone lijn. MuPDF
controleert de zichtbare opgeslagen appearance. Een verschoven CropBox met
alle vier paginarotaties bewaart de Béziergeometrie en weergave. De browser
controleert de echte tekenaar, keuzelijsten, undo/redo, hit-test en uitsluiting
van ongeschikte selectie/vormtypen. De nieuwe browserworkflow voert deze
controles ook op een pull request uit.

Nog te kwalificeren: de geïnstalleerde native Tauri-app en installer. De
persoonlijke fork accepteerde bij eerdere runs geen workflow-dispatch
(HTTP 422: Actions disabled). De PR blijft concept totdat deze controles en
de vereiste upstream review zijn afgerond. Geen release wordt gepubliceerd.
