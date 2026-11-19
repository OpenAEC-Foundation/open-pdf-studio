# Wielisolatie van de vergelijkingsweergave (#1180)

De vergelijking staat binnen de hoofdcontainer. De hoofdlistener sloot de
vergelijking alleen in de laatste scrolltak uit, waardoor zoom en gereedschappen
hetzelfde wiel-event ook afhandelden. De uitsluiting staat nu vóór alle routes.
De scrollgebieden van de vergelijking begrenzen bovendien native overscroll,
zodat Shift+wiel aan een rand de achterliggende hoofdcontainer niet verschuift.

## Regressie

- `node --test js/core/wheel-zoom.test.mjs`: vijf nieuwe gevallen voor Ctrl,
  Meta, voorkeurszoom, gewoon wiel en Shift. Alle vijf falen vóór de fix; alle
  vijftien gevallen slagen erna. Hoofdzoom werkt weer zodra het doel buiten de
  vergelijking ligt.
- `node scripts/test-compare-wheel-browser.mjs`: twee echte PDF.js-documenten,
  naast elkaar/overlay/split, zowel Ctrl als voorkeurszoom. Acht echte
  browserwielstappen moeten exact `1.1 ** 8` geven. De hoofd-PDF en de positie van
  de vergelijking blijven gelijk, cursorankers wijken maximaal vier pixels (afronding van scrollposities over acht stappen) af,
  alle papierranden blijven bereikbaar. Gewoon wiel en Shift op de paneelrand
  lekken niet door; sluiten herstelt hoofdzoom. Deze proef draait ook in Linux-CI.
- De oorspronkelijke browserproef faalt: hoofdzoom 150% → 350%, hoofdcontainer
  72 px horizontaal en 560 px verticaal verschoven na acht wielstappen.

De browserproef gebruikt Chromium met de echte applicatie en gegenereerde PDF's.
Zij kwalificeert geen geïnstalleerde Windows/Tauri/WebView2-versie. De vereiste
installerworkflow en geïnstalleerde-appcontrole blijven aparte oplevercontroles.
