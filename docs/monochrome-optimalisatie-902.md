# Voorbereiding van verliesloze monochroomcompressie (#902)

Dit is een **bouwsteen in concept**, geen nieuwe compressiemodus. De bestaande
Compress-dialoog en rasterpresets blijven actief. `monochrome-image.js` wordt
nog nergens door productiecode aangeroepen. Issue #902 blijft open.

## Wat al getest kan worden

`optimizeMonochromeImage()` neemt één reeds geparste `PDFRawStream` en geeft
óf een kleiner vervangend streamobject óf een vaste overslaanreden terug.
De invoer, het document en de indirecte objecten worden niet gewijzigd.
Een latere integratie moet de kandidaat onder dezelfde objectreferentie
plaatsen, zodat alle gedeelde toepassingen hetzelfde beeld behouden.

Ondersteund:

- Ongefilterde data en één Flate-filter, ook met indirecte Filter/DecodeParms-
  arrays en Predictor 1. De codering gebruikt de ingebouwde CompressionStream
  (zlib/Flate); geen nieuwe codecdependency of overgenomen externe code.
- Eén-bit grijswaarden, stencils, Indexed en éénkanaals ICCBased: samples en
  rijpadding blijven bytegelijk. Decode, masks en profielreferenties blijven
  behouden; alleen Filter, DecodeParms, Length en de gecodeerde data veranderen.
- Acht-bit DeviceGray met uitsluitend 0 en 255 wordt per rij naar één bit
  gepakt. Normale en omgekeerde Decode blijven equivalent. Maskers bij deze
  omzetting worden conservatief geweigerd. Een `/DL` (gedecodeerde lengte)
  vervalt dan, omdat die bij de acht-bit samples hoorde.
- Een kandidaat telt pas als kleiner wanneer het volledige streamobject,
  inclusief dictionary, minder bytes beslaat. Ongewijzigde masks/profielen
  behouden hun objecten en tellen dus aan beide kanten even zwaar.
- Defecte samplelengtes, corrupte Flate, te grote dimensies, uitvoerlimieten en
  annulering worden gecontroleerd. Overslaanredenen zijn machineleesbaar;
  de toekomstige UI moet ze begrijpelijk vertalen.

RGB-packing is bewust nog niet toegestaan. DeviceRGB kan via DefaultRGB,
DefaultGray of uitvoerprofielen anders geïnterpreteerd worden; de context van
**alle** gedeelde toepassingen is nodig voordat omzetting naar grijs bewezen
kan worden. CCITT, DCT, meervoudige filters, voorspellers, acht-bit Indexed en
profielafhankelijke omzettingen blijven onaangeroerd met een expliciete reden.
Dat is geen verklaring dat zulke bronbeelden defect zijn.

## Grenzen en nog openstaand werk

De standaardgrenzen zijn 32 MiB gedecodeerde samples per beeld, 32 MiB
gecodeerde invoer/uitvoer en 96 MiB voor de berekende buffers die deze functie
bewaart. Lagere grenzen kunnen worden meegegeven. De streamdecoder stopt
zodra de verwachte samplelengte wordt overschreden. Annulering is mogelijk
bij het streamen en op checkpoints tijdens het bitpakken.

Dit zijn **geen harde procesgeheugengrenzen**: de native codec, browser/Node,
PDF-objectgrafiek en parser hebben hun eigen allocaties. pdf-lib 1.17.1 pakt
bij het parsen van een objectstream reeds de complete decoded stream uit,
voordat deze helper ooit wordt aangeroepen (`PDFObjectStreamParser` /
`ByteStream.fromPDFRawStream`). De bestaande #747 lost alleen een deel van
#728 op en geeft hiervoor nog geen totaalbudget.

Vóór een gebruikersmodus zijn daarom nodig:

1. Een geïsoleerde parse-/optimalisatietaak met bewezen proces-, tijd-,
   cumulatieve decode- en uitvoergrenzen, afgestemd met #728. Een Worker alleen
   is geen harde RSS-grens; een kleine bronfile kan een grote objectstream zijn.
2. Een transactie voor alle kandidaten: annuleren of een eindbestand dat niet
   kleiner is moet de oorspronkelijke bytes behouden. Ook signed/encrypted,
   onopgeslagen wijzigingen en een gewijzigde brontab moeten expliciet worden
   behandeld, zonder caches opnieuw van schijf te laden.
3. De modus naast de rasterpresets, voortgang/annuleren, vertaalde resultaten
   en overslaanredenen, plus de bestaande atomische opslag naar een nieuw pad.
4. Echte CCITT-fixtures, rendering met relevante masks/profielen, PDFium en
   native WebView-controles. Deze conceptversie levert geen CCITT-encoder.

Er wordt dus nog geen nieuwe, ongekwalificeerde exportknop aangeboden.

## Verificatie

```sh
cd open-pdf-studio
node --test js/pdf/monochrome-image.test.mjs
```

De tests vergelijken samples met de onafhankelijke Node-zlib decoder en
renderen originele/vervangende PDF's met MuPDF. Een gedeelde scan op twee
pagina's houdt zichtbare tekst, onzichtbare OCR, vectorlijnen, formulierwidgets
met hun waarden en CropBox behouden. De pixels en tekstextractie moeten exact
hetzelfde blijven. Afwijzingen en annulering controleren ook dat de invoer
niet gewijzigd is. Een apart geval bewijst dat dictionary-overhead een kleine
winst in de payload ongedaan kan maken.

De synthetische fixture is oorspronkelijk circa 21 kB en wordt circa 5 kB;
looptijd, volledige bestandsgroottes, berekende buffers en `maxRSS` worden als
testdiagnostiek afgedrukt. `maxRSS` betreft het hele testproces en is een meting,
geen gegarandeerde bovengrens of voorspelling voor echte documenten.
