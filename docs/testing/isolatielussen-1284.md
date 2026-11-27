# Isolatielijnpatroon — #1284

De bijlage bij #1284 toont een doorlopende draad met afwisselend afgeronde lobben: een strook van circa 160 beeldpunten breed en een steek van circa 64 beeldpunten. De oude generator tekende afzonderlijke afgeschuinde ellipsen. Dat veranderde zowel de helling als de aansluiting van de herhaalde vorm.

De gedeelde Canvas/PDF-generator tekent nu één doorlopend pad. De nominale steek is 0,4 maal de strookbreedte; teruglopende verbindingsbogen verbinden de tegenoverliggende lobben. Hele herhalingen passen tussen de bestaande eindmarges. De bestaande minimale patrooneenheid blijft behouden; maximaal 1000 herhalingen van 64 segmenten begrenzen de hoeveelheid werk. Polylijnen gebruiken dezelfde padlocatie en normale als de overige lijnpatronen. Korte lijnen behouden de gewone-lijnfallback.

## Verificatie

- `node --test js/annotations/geometric-line-styles.test.mjs js/pdf/geometric-line-styles-roundtrip.test.mjs`: 22 controles. De nieuwe continuïteitsregressie faalt op de oude generator. Rotatie, omkering, schaal, korte/ongeldige/lange paden en Canvas-geometrie worden gecontroleerd.
- De bestaande PDF-rondgangen bewaren alle negen patronen na tweemaal opslaan en heropenen. MuPDF-pixels blijven gelijk; het isolatiepatroon wordt ook als gebogen polylijn met verschoven CropBox en vier paginarotaties gecontroleerd.
- `node scripts/test-geometric-line-styles.mjs`: echte Chromium-renderer, eigenschappen/ribbon, undo/redo, selectie en defaults. Vier beeldankers controleren de afgeronde lobben op de referentiesteek. Met `OPDS_BATTING_ARTIFACT=/absoluut/pad/voorbeeld.png` wordt de referentiegrote Canvas-weergave opgeslagen voor visuele vergelijking.
- De bestaande workflow `geometric-line-styles.yml` draait de geometrie-, PDF- en browsercontroles bij deze wijziging.

De lijn blijft als `insulation` bewerkbaar; geen nieuwe PDF-metadatasleutel of voorkeur. Bestaande externe PDF-appearance streams worden pas bij opslaan opnieuw opgebouwd. Muurisolatie en de andere acht geometrische lijnpatronen veranderen niet.

## Openstaande kwalificatie

Controle in een geïnstalleerde Tauri-app en de installerprocedure blijven nodig. Er is geen release gepubliceerd. De visuele vergelijking gebruikt de aangeleverde afbeelding; er is geen oorspronkelijk CAD/PDF-bestand beschikbaar voor een exacte vergelijking van de broncurven.
