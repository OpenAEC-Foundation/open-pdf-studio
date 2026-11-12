# Hoog contrast: symbolenpalet en feedback (#1045)

In het hoogcontrastthema stonden zwarte symboolvoorbeelden op een zwarte achtergrond en witte feedbackknopteksten op geel. De meegeleverde screenshots bevestigen beide problemen.

De CSS inverteert uitsluitend de voorbeeldweergave in het hoogcontrastpalet. Actieve tegels behouden donkere symbolen op geel. De oorspronkelijke SVG en de kleuren van geplaatste PDF-symbolen blijven intact. Actieve feedbackcategorieën en de verzendknop krijgen zwarte tekst op geel. Andere thema's blijven ongewijzigd.

## Validatie

- Browserregressie faalt met de oorspronkelijke CSS: witte knoptekst waar zwart vereist is.
- `node scripts/test-high-contrast-browser.mjs`: geslaagd in Chromium, met de echte applicatie en feedbackdialoog. Controleert knopkleuren, normale en actieve paletvoorbeelden, wisselen tussen licht/donker/hoog contrast en behoud van SVG-inhoud. De feedback wordt niet verzonden.
- Schermafbeeldingen van palet en dialoog visueel gecontroleerd: symbolen en knoptekst zijn leesbaar.
- `tsc --noEmit`: geslaagd.
- `vite build`: geslaagd.
- Versie-, runtime-, releaseconfiguratie- en square-image-controles: 38 geslaagd.

De browsercontrole draait ook in de Linux CI-job na installatie van Chromium. macOS/Safari en een geïnstalleerde desktopversie zijn niet handmatig getest. Installerstatus staat in de PR; er is geen release gepubliceerd.
