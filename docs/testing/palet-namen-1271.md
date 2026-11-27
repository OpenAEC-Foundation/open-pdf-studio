# Verkeerde paletnamen — #1271

## Reproductie en oorzaak

Op upstream `7168c6d64d995c683b1722569b30214642e3364b` heet `Tr01.png` (wit EHBO-kruis op groen) “RWA-installatie”. `Tv017.png` (rood verbodsteken over een lift) heet “Ventilatiesysteem”. Dezelfde verwisseling zit in de namen van de Tr-, Tv-, Tn- en Tw-groepen: bijvoorbeeld `Tn06` (verzamelplaats) heet “Anti-paniekverlichting” en `Tw02` (bliksemwaarschuwing) “Sprinklerkop (hangend)”. De rasterbestanden laden goed. De fout zit in de namen/categorieën, niet in de afbeeldingselectie.

De meegeleverde beelden zijn visueel gecontroleerd. De 48 betrokken namen beschrijven nu die beelden. Vier categorieën heten Eerste hulp en redding, Verbodstekens, Vluchtwegen en Waarschuwingen; alle 40 talen zijn bijgewerkt. Dit is een correctie van beschrijvende catalogusmetadata, geen verklaring dat de oude meegeleverde set volledig aan de huidige norm voldoet. NEN beschrijft de context van de norm op https://www.nen.nl/nen-1414-1-2019-nl-259011; er zijn geen normbeelden of andere externe assets toegevoegd.

## Compatibiliteit

Alle symbool- en categorie-id’s, PNG-bytes en SVG-opbouw blijven gelijk. Daarmee blijven opgeslagen stempels en de SVG-sleutels voor aangepaste symbooltypen behouden. Bestaande PDF’s worden niet herschreven.

De IFC-mapping nam dezelfde verkeerde namen over en classificeerde bijvoorbeeld het EHBO-pictogram als ventilator. De vier gecorrigeerde pictogramgroepen krijgen daarom `IfcAnnotation`, zonder verzonnen toesteltype. Oude namen blijven herkenbare aliassen voor PDF’s met alleen een stempelnaam. Een expliciet in het document opgeslagen IFC-type blijft voorgaan zoals voorheen. De technische Tb/Tbk/Td-groepen vallen buiten deze gerichte correctie.

## Tests

Vanuit `open-pdf-studio`:

```sh
node --test js/solid/data/nen1414-metadata.test.mjs scripts/test-nen-ifc-map.mjs
node scripts/nen1414-labels-e2e.mjs
```

De metadata-tests koppelen de gecontroleerde namen aan SHA256-hashes van de 48 beelden en bewaken de volledige bestandslijst, vertalingen en IFC-compatibiliteit. De browserproef start een eigen Vite-server zonder HMR en Chromium, opent een PDF en test de zichtbare groepen, gedecodeerde rasterafbeeldingen, tooltip/selectienaam en nieuwe stempelmetadata voor EHBO, liftverbod, verzamelplaats en elektrische spanning. Ook zoeken en de Engelse categorienamen worden getest. De proef draait mee in Dialog regression CI.

Geïnstalleerde Tauri-kwalificatie en de overige releasepoorten blijven vereist vóór een release. De PR blijft concept zolang het bestaande startbundelbudget en de installer-/native-controles geblokkeerd zijn. Er wordt geen release gepubliceerd.
