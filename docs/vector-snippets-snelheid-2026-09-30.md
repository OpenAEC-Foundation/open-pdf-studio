# Vectorsnippets: snelheidsonderzoek — 30 september 2026

## Resultaat

Hergebruik van bronparsing en ingebedde Form XObjects is de meest concrete optimalisatie. Geen applicatiecode gewijzigd. Gemeten met lokale Node/pdf-lib en echte bronbestanden, eerste pagina, vijf identieke uitsneden. Dit is één verkennende run per bestand, geen statistische benchmark of volledige UI-save. Baseline en hergebruik zijn in vaste volgorde getest; JIT/cache-effecten zijn niet uitgesloten.

| Bron | 5× apart inbedden + serialiseren | 1× inbedden, 5× tekenen + serialiseren | Uitvoer apart / gedeeld |
|---|---:|---:|---:|
| Tekst.pdf | 46.0 ms | 8.6 ms | 0.34 / 0.07 MB |
| Technische tekening.pdf | 114.1 ms | 25.1 ms | 1.60 / 0.32 MB |
| Zware vector PDF.pdf | 318.9 ms | 47.3 ms | 3.59 / 0.72 MB |

De proef gebruikt bedKnipselIn en tekent het resultaat vijfmaal in een nieuw document. De productie-opslaanroute maakt stempelappearances, bewaart bronstreams en ruimt ongebruikte objecten op; die stappen zijn niet opgenomen. De gemeten bestandsgroottes zijn daarom geen voorspelling van de volledige productie-save. De proef bewijst dat vectorresources gedeeld kunnen worden; visuele regressiecontrole is nog nodig.

## Prioriteiten en codebewijs

1. **Bron éénmaal parsen bij knippen.** `js/tools/tools/vector-snippet-tool.js:knipselVanVak` doet PDFDocument.load voor het CropBox; `js/pdf/vector-embed.js:knipselAlsMiniPdf` laadt dezelfde bytes opnieuw. Geef de reeds geladen bron door of maak één functie voor geometrie en mini-PDF. Op de zware bron kostte mini-PDF maken inclusief tweede parse 104 ms versus 13 ms met de eerder geladen bron. Cache vervolgens per bronrevisie, pagina en rotatie; invalidateer bij gewijzigde bronbytes/paginabewerkingen.

2. **Ingebedde vectorobjecten per save delen.** `js/pdf/saver/vector-snippet.js:bouwKnipselAppearance` roept voor ieder knipsel `bedKnipselIn` aan; die laadt/parset en embedt steeds opnieuw. De bronstream wordt al gedeeld via registreerBron, het appearance-XObject niet. Een cache per doel-PDF en broninhoud/pagina/exact srcBox/bronrotatie kan identieke knipsels hetzelfde XObject geven; positie, formaat, opacity en doelrotatie blijven per plaatsing apart. Verschillende uitsneden kunnen alvast dezelfde geparste bron delen. Bewaar nooit PDFRefs over verschillende doel-documenten heen.

3. **Previewresolutie afstemmen op schermgrootte.** `js/annotations/rendering.js` geeft alleen paginazoom aan bitmapVoor; de grootte van de plaatsing tegenover de bronuitsnede en devicePixelRatio worden niet meegenomen. Een bronvak van 1000 punten dat op 100 punten wordt geplaatst, krijgt daardoor bij 100% zoom onnodig een circa 1000-pixelpreview waar bij DPR 1 circa 100 pixels volstaan. Kies schaal op basis van doelmaat/bronmaat × zoom × DPR, met correcte rotatie/aspectratio. Dit voorkomt tegelijk onscherpte bij vergroting. Nog niet live gemeten.

4. **Cache op effectieve schaal, met geheugenbudget.** De previewcache heeft geen bytebudget. Niveaus 1/2/4/8/16 hebben aparte sleutels, ook wanneer de 4096-grens ze naar dezelfde effectieve schaal begrenst. Een vierkante preview van 4096² RGBA gebruikt 64 MiB aan onbewerkte pixels; vijf identieke begrensde niveaus vertegenwoordigen 320 MiB, exclusief overige kopieën. Deel die entry en voeg LRU op bytes toe. Gebruik bij uitzoomen ook een reeds beschikbare scherpere bitmap als tijdelijke fallback; nu wordt alleen naar grovere niveaus gezocht.

5. **Werk bundelen en dedupliceren.** `vector-snippet-store.js:padVan` cachet alleen het voltooide pad, geen lopende promise. Een proef met vijf parallelle aanvragen telde vijf writer-callbacks. Voeg in-flight deduplicatie toe. `vector-snippet-preview.js` roept na iedere voltooide bitmap direct de volledige redraw aan via `rendering.js:bijNieuweTegel`; bundel dit maximaal éénmaal per animation frame. Beperk renderconcurrency en geef zichtbare, actuele verzoeken prioriteit. Gebruik een generatiecontrole zodat een late render een geleegde cache niet opnieuw vult.

## Wat al goed is

De bronbytes worden op inhoud gedeeld, preview-aanvragen met exact dezelfde sleutel worden gededupliceerd, paginagebieden buiten beeld worden bij het tekenen overgeslagen en vastgezette snippets die al in de basis-PDF staan worden niet opnieuw ingebed. Deze mechanismen behouden.

## Verificatie vóór implementatie afronden

Vergelijk 1/10/50 kopieën, meerdere uitsneden van één blad, scans en grote CAD-bladen. Test bronrotaties en CropBox-offsets, gespiegelde/geschaalde plaatsingen waar ondersteund, meerdere doeldocumenten, herhaald opslaan/heropenen, vastzetten en undo. Controleer vectorbehoud en rendervergelijkingen. Meet daarnaast UI-respons, piekgeheugen en tijd tot scherpe preview. De huidige proef is geen visuele QA.

Ruwe metingen staan in `vector-snippets-metingen-2026-09-30.json`.
