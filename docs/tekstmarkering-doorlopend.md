# Tekstmarkeringen in doorlopende weergave (#1119)

Tekstmarkeringen gebruiken standaard Multiply. Bij import wordt die inherente
mengmodus niet als een expliciete eigenschap opgeslagen. De enkele pagina
had daarvoor een aparte CSS-laag; doorlopende pagina's tekenden de vulling
op een transparante overlay zonder de onderliggende pagina mee te mengen.
Daardoor werd zwarte tekst geel en onleesbaar.

De renderer bepaalt nu de effectieve mengmodus zonder het annotatiemodel te
wijzigen. Tekstmarkeringen zonder override krijgen Multiply en gebruiken de
bestaande compositie tegen de pagina. Ook de scherpe annotatie-overlay na
zoomen herkent nu het paginacanvas eronder. Expliciete mengmodi blijven geldig.

`node scripts/test-highlight-blending-browser.mjs` laadt een gegenereerde PDF
met een geïmporteerde tekstmarkering en test de echte paginarenderer in Chromium:

- gewone en scherpe doorlopende overlays;
- rechthoeken en quads;
- DPR 1 en 2, met een verschoven en uitgesneden overlay;
- zwarte tekst blijft zwart, witte achtergrond wordt geel, buitengebied blijft wit;
- een expliciete Screen-override blijft werken;
- tekenen voegt geen blendMode-eigenschap aan het opgeslagen model toe.

De pixeltest faalt op upstream c8efddd6f en slaagt met de wijziging. De test
wordt ook in de Linux-CI uitgevoerd. Het meegeleverde bestand blijft lokaal;
er wordt geen document van de melder aan de repository toegevoegd. Beide
markeringen uit het voorbeeld werden zonder expliciete blendMode ingelezen.
Na het renderen in de echte doorlopende appweergave blijft de tekst in de
geel gemarkeerde tabel leesbaar (lokaal screenshot gecontroleerd).

De browsertest kwalificeert de frontend; geïnstalleerde Windows- en macOS-
WebViews en installers zijn hiermee niet getest. De concept-PR blijft open
voor die kwalificatie en de vereiste upstreamreview.
