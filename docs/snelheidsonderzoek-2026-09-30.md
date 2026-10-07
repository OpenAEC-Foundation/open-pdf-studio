# Snelheidsonderzoek — 30 september 2026

Onderzoek van huidige lokale broncode en de draaiende MCP-testapp op poort 9323. Geen applicatiecode gewijzigd. Testdocument: Tekst.pdf, pagina 1, vijf pagina’s. Oorspronkelijk zoomniveau na beide proeven hersteld. Geen koude app-start of grote CAD-PDF gemeten; geen algemene snelheidswinst bewezen.

## Bevindingen, op prioriteit

1. **Dubbele rasterrender na zoomen.** `js/pdf/bitmap-orchestrator.js` vraagt eerst `ensureBitmap` op een macht-van-twee-schaal, daarna `ensureExactBitmap` voor scherpte. Het bestaande openlog bevat 71 ms op schaal 1 en 116 ms op 0,664. De nieuwe proef bevat 231 ms op schaal 2 gevolgd door 172 ms op 1,6. Onderzoek: bestaande bitmap als onmiddellijke voorvertoning gebruiken en direct de exacte resolutie aanvragen als die nog ontbreekt. Beeldscherpte en snelle opeenvolgende zoomstappen moeten behouden blijven.
2. **4096-pixelgrens wordt door omhoog afronden overschreden.** `bitmap-orchestrator.js` begrenst de schaal vóór `computeZoomBucket`, maar die functie rondt omhoog. Voor een lange zijde van 841,89 pt wordt 4096/841,89 ≈ 4,865 vervolgens bucket 8: circa 6736 pixels. Dat zijn circa 2,70 maal zoveel pixels als bij de bedoelde schaal (beide assen meegerekend). Dit is een rekenkundig aangetoonde broncodefout, geen live hoogzoommeting. Begrens de uiteindelijke renderschaal en stem cachesleutel en tegelovergang daarop af.
3. **Caches begrenzen aantallen, geen bytes.** `page-bitmap-cache.js` bewaart twaalf bitmaps en verwijdert op invoegvolgorde; hits verversen de volgorde niet. De Rust `PixmapCache` in `pdfium_renderer.rs` bewaart veertig items, eveneens FIFO. De genoemde 600 MB in het commentaar is geen harde bovengrens. Voorstel: bytebudget met echte LRU, inclusief correct sluiten van ImageBitmaps. Vooral belangrijk bij grote tekeningen en meerdere documenten.
4. **Dubbele documentparser vóór eerste pagina gereed is.** `loader.js` start pdf-lib direct vóór `setViewMode`, naast PDF.js. Bestaand log: pdf-lib 231 ms, eerste render 441 ms. Deze tijden overlappen en mogen niet worden opgeteld. Onderzoek parserwerk uitstellen of naar een worker verplaatsen, met behoud van tijdig geladen annotaties/lagen en veilige opslag. Winst nog niet geïsoleerd gemeten.
5. **Bladwijzers worden serieel opgelost en afgewacht.** `bookmarks.js` wacht per bestemming op getDestination/getPageIndex; `loader.js` wacht op het hele resultaat. Bestaand log: fase 549 ms, inclusief mogelijke wachttijd op ander werk. Voorstel: bestemmingen dedupliceren en beperkt parallel oplossen; uit kritisch laadpad halen waar correctheid dat toelaat. Test met veel bladwijzers nodig.

## Nieuwe live proef

Zoomreeks 80%, 120%, 160%, tweemaal, met één seconde tussen verzoeken. Niet alle eerste renderaanvragen kregen een KLAAR-regel in de gefilterde buffer; die zijn geen betrouwbare duurmetingen. Ruwe data: `/tmp/opds-perf-2026-09-30.json` (tijdelijk).

Tweede reeks met 1,5 seconde rust en warme caches: MCP-antwoorden 3,6–4,9 ms; geen nieuwe whole-page-renderregels. Dit bevestigt cachehergebruik in deze proef, maar MCP-antwoordtijd is niet de tijd tot het definitieve beeld op het scherm.

## Aanbevolen vervolg

Eerst de pixelgrens herstellen en de keuze tussen bucket- en exacte render verbeteren. Vergelijk vóór/na op tekst-PDF, scan en grote CAD-tekening, bij koude en warme caches. Meet tijd tot eerste beeld, tijd tot scherp beeld, piekgeheugen en zoomankerfout. Daarna cachebudgetten en parserplanning aanpakken. Bestaande niet-gecommitte wijzigingen behouden.
