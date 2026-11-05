# Verliesloze monochroomcompressie (#902)

De dialoog PDF comprimeren heeft naast de rasterpresets de modus
**Verliesloos (monochroom)**. Die vervangt alleen bestaande beeld-XObjects die
zwart-wit zijn, elk onder dezelfde objectreferentie; inhoudsstreams, fonts,
tekst, de OCR-laag, annotaties, formulieren en paginageometrie gaan
bytegelijk mee.

- `monochrome-image.js`: één beeld, zie hieronder.
- `monochrome-document.js`: het hele document. Weigert versleutelde en
  ondertekende documenten, telt een cumulatief decodebudget, rapporteert per
  beeld de grootte voor/na of een overslaanreden en geeft alleen bytes terug als
  het complete nieuwe bestand kleiner is dan het bronbestand.
- `monochrome-rapport.js`: de vertaalde melding (maximaal 15 beelden, daarna
  een telling).
- `compress.js` (`compressPDFLossless`): optimaliseert eerst met voortgang en
  Annuleren, vraagt pas bij winst om een nieuw pad en schrijft atomisch
  (`writeBinaryFileAtomic`). Het geopende bestand wordt nooit overschreven.

Codering: Flate op één-bit gepakte data. Er zit geen CCITT G4- of verliesloze
JBIG2-encoder in de afhankelijkheden; bestaande CCITT/JBIG2-beelden blijven
zoals ze zijn.

## Eén beeld (`optimizeMonochromeImage`)

`optimizeMonochromeImage()` neemt één reeds geparste `PDFRawStream` en geeft
óf een kleiner vervangend streamobject óf een vaste overslaanreden terug.
De invoer, het document en de indirecte objecten worden niet gewijzigd.
`monochrome-document.js` plaatst de kandidaat onder dezelfde objectreferentie,
zodat alle gedeelde toepassingen hetzelfde beeld behouden.

Ondersteund:

- Ongefilterde data en één Flate-filter, ook met indirecte Filter/DecodeParms-
  arrays en Predictor 1. De codering gebruikt de ingebouwde CompressionStream
  (zlib/Flate); geen nieuwe codecdependency of overgenomen externe code.
- Eén-bit grijswaarden, stencils, Indexed en éénkanaals ICCBased: samples en
  rijpadding blijven bytegelijk. Decode, masks en profielreferenties blijven
  behouden; alleen Filter, DecodeParms, Length en de gecodeerde data veranderen.
- Acht-bit DeviceGray met uitsluitend 0 en 255 wordt per rij naar één bit
  gepakt. Normale en omgekeerde Decode blijven equivalent. Een `/DL` (gedecodeerde lengte)
  vervalt dan, omdat die bij de acht-bit samples hoorde.
- Een kandidaat telt pas als kleiner wanneer het volledige streamobject,
  inclusief dictionary, minder bytes beslaat. Ongewijzigde masks/profielen
  behouden hun objecten en tellen dus aan beide kanten even zwaar.
- Defecte samplelengtes, corrupte Flate, te grote dimensies, uitvoerlimieten en
  annulering worden gecontroleerd. Overslaanredenen zijn machineleesbaar;
  de melding vertaalt ze (`compress.reason.*`).
- Acht-bit DeviceRGB met per pixel r=g=b en uitsluitend 0/255 wordt alleen
  gepakt met `allowRgb`. Het document zet dat alleen aan als er geen
  uitvoerprofiel, geen DefaultRGB/DefaultGray en geen transparantiegroep met
  een andere mengruimte dan DeviceRGB/DeviceGray is; anders krijgt het beeld
  die reden.
- Een /SMask of stencil-/Mask (eigen beeldstream) blijft onder zijn referentie
  staan; een kleursleutelmasker (/Mask-array) of een /Matte bij RGB wordt
  geweigerd, omdat die bij de acht-bit samples of drie componenten horen.

CCITT, DCT, meervoudige filters, voorspellers, acht-bit Indexed en
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

Nog open:

1. Een geïsoleerde parse-/optimalisatietaak met bewezen proces-, tijd-,
   cumulatieve decode- en uitvoergrenzen, afgestemd met #728. Een Worker alleen
   is geen harde RSS-grens; een kleine bronfile kan een grote objectstream zijn.
2. Een transactie voor alle kandidaten: annuleren of een eindbestand dat niet
   kleiner is moet de oorspronkelijke bytes behouden. Ook signed/encrypted,
   onopgeslagen wijzigingen en een gewijzigde brontab moeten expliciet worden
   behandeld, zonder caches opnieuw van schijf te laden.
3. Echte CCITT-fixtures, rendering met relevante masks/profielen, PDFium en
   native WebView-controles; een CCITT G4-encoder voor betere winst.

## Verificatie

```sh
cd open-pdf-studio
node --test js/pdf/monochrome-image.test.mjs js/pdf/monochrome-document.test.mjs
```

`monochrome-document.test.mjs` bouwt een gemengde PDF (tekst, onzichtbare
OCR-tekst, vectoren, formulier, een gedeeld één-bit beeld, een grijsbeeld met
tussentinten en een zwart-wit RGB-beeld met /SMask) en controleert:
tekst via pdf.js `getTextContent` gelijk, inhoudsstreams bytegelijk, het
grijsbeeld onaangeroerd, de één-bit samples identiek en de MuPDF-weergave
pixelgelijk op beide pagina's.

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
