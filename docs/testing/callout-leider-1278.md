# Callout-aanhaallijn bij inzoomen — #1278

Op upstream `7168c6d64` berekent `annotationBounds` voor een callout alleen het tekstvak en eventuele `leaders[]`. Een gewone callout bewaart de punt, knie en aansluiting rechtstreeks op de annotatie. Daardoor verwerpen de beide viewport-tekenpaden de hele annotatie zodra het tekstvak buiten de ruime zichtbare uitsnede valt, terwijl de aanhaallijn nog in beeld staat. Dit raakt ook de spatial index en de uitsnede voor mengmodi.

De omhullende omvat nu de expliciete of standaard calloutpunten in paginacoördinaten, zonder ze met de tekstvakrotatie mee te draaien. Voor een gebogen lijn wordt de convexe omhulling van de Bézier-controlepunten meegenomen; een conservatieve marge omvat lijnkoppen en lijndikte. Er wordt niets aan de opgeslagen annotatie of de tekengeometrie gewijzigd. Niet-callouttypen behouden hun bestaande omhullende.

## Bewijs

- Vier nieuwe regressies falen vóór de correctie en slagen erna; de hele omhullende-suite telt 16 geslaagde tests. Gedekt: zichtbare lijn met tekstvak buiten beeld, spatial query, rotatie/vergrendelde aansluiting, standaard-/nulcoördinaten, gebogen lijnen en grote koppen.
- `node scripts/callout-culling-e2e.mjs` laadt de echte app en een PDF in Chromium en vergelijkt de rode pixels uit de echte paginarendering met rechtstreeks tekenen. Alle zes combinaties van zoom 1/4/16 en tekstvakrotatie 0/90 graden leveren exact dezelfde zichtbare lijnpixels.
- Met `BASELINE_BOUNDS=1` herstelt dezelfde browserproef uitsluitend de oude omhullende en faalt: 0 zichtbare rode pixels tegenover 484 verwacht.
- De melding noemt een GIF, maar bevat geen bijlage-URL. Reproductie gebruikt daarom de beschreven geometrie op huidige main; geïnstalleerde Tauri-kwalificatie blijft apart vereist.

## Uitvoeren

Vanuit `open-pdf-studio`:

```sh
node --test js/annotations/annotatie-omhullende.test.mjs
node scripts/callout-culling-e2e.mjs
```

Voor native kwalificatie: plaats een callout met lange aanhaallijn, zoom rond de lijn in tot het tekstvak buiten beeld ligt en wissel tussen enkelvoudige en doorlopende weergave. Controleer ook gedraaide tekstvakken en gebogen lijnen. Publiceer geen release zolang installer- en releaseprotocolcontroles ontbreken.
