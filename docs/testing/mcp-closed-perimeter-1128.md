# Gesloten omtrek via MCP (#1128)

`app_create_annotation` ondersteunt voor `measurePerimeter` de aanmaakoptie
`props.closed: true`. De bouwer voegt een kopie van het eerste punt achteraan
toe wanneer dat punt nog niet het laatste punt is. Daardoor gebruiken de
bestaande meetberekening, renderer en PDF-saver dezelfde gesloten geometrie.
Het model bewaart de puntenreeks, niet een aparte `closed`-vlag.

Zonder de optie, of met `closed: false`, blijft de aangeleverde puntenreeks
ongewijzigd. Een al herhaald beginpunt sluit dus nog steeds de reeks.
`closed` moet een boolean zijn; `true` vereist minstens drie punten.
Ongeldige invoer maakt geen annotatie of undo-stap. Dit is een optie voor
**aanmaken**; wijzigingen achteraf gebruiken de expliciete `points`-reeks.
Generieke validatie van onbekende eigenschappen van alle annotatietypen valt
buiten deze fix.

Voorbeeld bij 18 pixels per voet:

```json
{"type":"measurePerimeter","page":1,"props":{"points":[{"x":150,"y":112},{"x":1050,"y":112},{"x":1050,"y":652},{"x":150,"y":652}],"closed":true}}
```

Deze rechthoek van 50 × 30 ft meet 160 ft. Zonder sluitoptie meet dezelfde
open reeks 130 ft. De native en meegeleverde stdio-toolbeschrijving leggen
dit beide uit.

## Controle

`node scripts/test-mcp-perimeter-browser.mjs` start een geïsoleerde browser,
maakt een leeg document en gebruikt de echte MCP-handler en meetkalibratie.
De test controleert open/gesloten en reeds gesloten invoer, onveranderde
invoer, undo-stappen en ongeldige waarden. De echte app-saver schrijft de
annotatie; na heropenen van de PDF zijn er vijf vertices, inclusief het
sluitpunt, en het meetlabel is 160 ft. De test draait ook in Linux-CI.

Het reproduceerbare voorbeeld gaf vóór de fix 130 ft. Er zijn geen
gebruikersdocumenten gewijzigd; een geïnstalleerde Windows-app is niet
onderdeel van deze browsertest.
