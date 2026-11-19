# PDF.js-canvas bij snel zoomen (#1183)

Een nieuw zoomverzoek kon een canvas wissen en opnieuw aan PDF.js aanbieden
terwijl de vorige render het nog gebruikte. PDF.js weigert dan de tweede
render met `Cannot use the same canvas during multiple render() operations`.
Dit is met de Archicad-bijlage van #1183 in de browser gereproduceerd bij
zoomen in doorlopende weergave.

De renderhulp bewaart per canvas de actieve taak. Een nieuwe aanvraag annuleert
de vorige taak, wacht op vrijgave en controleert daarna of zij nog de nieuwste
is. Tussenliggende aanvragen tekenen niet. Alleen de nieuwste geslaagde render
mag de vervolgwerkzaamheden voor lagen uitvoeren. Onafhankelijke canvassen
blijven gelijktijdig renderen; echte renderfouten blijven zichtbaar.

## Controle

- `node --test js/pdf/pdfjs-canvas-render.test.mjs` (vanuit de appmap): wachten
  op annulering, drie overlappende aanvragen, vertraagde laaginstellingen,
  onafhankelijke canvassen en herstel na een renderfout.
- `node scripts/test-pdfjs-zoom-browser.mjs`: de echte PDF.js-render pauzeren
  tussen tekenstappen, snel van 200% naar 300% en 325% zoomen, annulering en
  zichtbare PDF-inkt controleren in enkele en doorlopende weergave op DPR 2.
- Dezelfde browserregressie zonder de fix moet falen; deze draait ook in Linux-CI.

## Afbakening

Dit lost een aangetoonde renderbotsing op, niet noodzakelijk alle drie klachten
van #1183. In het aangeleverde Archicad-bestand vond de PDF.js-route 75.992
snap-punten en 37.662 segmenten; `performSnap` vond een echt PDF-eindpunt.
macOS/PDFium, Safari en de voorkeuren van de melder zijn daarmee niet getest.
De recente upstreamwijzigingen voor scherpe doorlopende rendering zijn al
onderdeel van de basis. Geheugen- en canvaslimieten bij zeer groot zoomen zijn
niet gewijzigd; dit is geen algemene oplossing voor alle witte beelden.
