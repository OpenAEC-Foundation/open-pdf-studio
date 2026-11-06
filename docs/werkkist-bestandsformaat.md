# Werkkist: het uitwisselbestand (`.opdstools`)

Een werkkist ("Tool Sets", #311) bewaart voorgeconfigureerde meet- en
markeergereedschappen: de stijl, het label en de meetinstellingen van een
geplaatste markering, zonder wat er getekend werd. Eén werkkist gaat als één
bestand de deur uit: **Exporteren** in het paneel Werkkist, en **Importeren**
leest zo'n bestand weer in. Dit document beschrijft dat bestand, zodat ook
andere programma's het kunnen lezen en schrijven. Het formaat is open en vrij
te gebruiken.

`js/annotations/tool-sets-formaat.test.mjs` houdt dit document gelijk met de
code: de lijst van soorten en eigenschappen hieronder moet precies zijn wat
de app bewaart, en het voorbeeld moet foutloos inlezen.

Delen kan op elke manier waarop je een bestand deelt: per mail, in een
gedeelde (netwerk)map waaruit collega's importeren, of in versiebeheer naast
de projectbestanden. Het is platte JSON met een vaste sleutelvolgorde, dus een
wijziging is in een diff goed te lezen.

## Het bestand

- Extensie `.opdstools`; `.json` wordt bij importeren ook geaccepteerd.
- UTF-8, een BOM aan het begin mag. Hooguit 4 MiB.
- Eén JSON-object:

| Sleutel | Waarde |
| --- | --- |
| `format` | altijd `"open-pdf-studio/tool-set"` |
| `version` | geheel getal ≥ 1; nu `1`. Een hogere versie dan de app kent, wordt geweigerd |
| `exportedAt` | moment van exporteren (ISO 8601), alleen ter informatie |
| `app` | het programma dat het bestand schreef, alleen ter informatie |
| `toolSet` | de werkkist: `{ "name": …, "items": [ … ] }` |

`toolSet.name` is de naam van de werkkist (hooguit 120 tekens, witruimte
samengevoegd). `toolSet.items` is een lijst van hooguit 500 gereedschappen.

## Een gereedschap (item)

| Sleutel | Waarde |
| --- | --- |
| `id` | tekst, hooguit 64 tekens; bij importeren krijgt elk item een nieuwe id |
| `name` | de naam in de lijst; leeg of ontbrekend wordt de soort |
| `type` | de soort markering, zie hieronder |
| `props` | de eigenschappen, zie hieronder; ontbrekend is `{}` |
| `layer` | `null` voor de standaardlaag, of `{ "name": …, "color": "#rrggbb" }`; bij gebruik wordt de laag op naam gezocht en zo nodig aangemaakt |
| `createdAt` | moment van bewaren (ISO 8601) |

Een item van een soort die de app niet kent, wordt bij importeren
overgeslagen en geteld; een item dat geen object is, een `type` zonder tekst,
of `props` die geen object zijn, maakt het hele bestand ongeldig.

## Soorten

| Soort | Gereedschap |
| --- | --- |
| `measureDistance` | afstand meten |
| `measureArea` | oppervlakte meten |
| `measurePerimeter` | omtrek meten |
| `measureAngle` | hoek meten |
| `line` | lijn |
| `arrow` | pijl |
| `polyline` | polylijn |
| `polygon` | veelhoek |
| `box` | rechthoek |
| `circle` | ellips |
| `cloud` | wolk |
| `filledArea` | gevuld vlak |
| `wall` | wand |

## Eigenschappen (`props`)

Elke waarde is een tekst (hooguit 20.000 tekens), een eindig getal, een
waarheidswaarde of `null`. Andere sleutels en andere waarden worden bij
importeren genegeerd: geometrie, meetuitkomsten, auteur, datums en relaties
reizen nooit mee. Kleuren zijn `#rrggbb`; lijndikte en lettergrootte staan in
punten op schaal 1 (onafhankelijk van de zoomstand).

| Groep | Sleutels |
| --- | --- |
| Uiterlijk | `color`, `strokeColor`, `fillColor`, `fillNone`, `fillOpacity`, `opacity`, `lineWidth`, `borderWidth`, `borderStyle`, `styleType`, `printable` |
| Lijnkoppen | `startHead`, `endHead`, `headSize`, `lineTail` |
| Arcering en vorm | `hatchPattern`, `hatchColor`, `hatchScale`, `hatchAngle`, `cloudIntensity`, `boxShape` |
| Tekst van het label | `fontSize`, `fontFamily`, `fontBold`, `fontItalic`, `fontUnderline`, `fontStrikethrough`, `textColor`, `textFontSize`, `textAlign`, `textVAlign`, `textPadding`, `labelColor` |
| Meten | `measureUnit`, `measurePrecision`, `measureDepth`, `measureName`, `measureShowLabel`, `measureShowEdgeLengths` |
| Maatvoering | `dimType`, `dimExtension`, `dimShowUnit`, `dimExtOvershootMm`, `dimExtGapMm`, `dimLineOvershootMm`, `dimOvershootEnds` |
| Omschrijving en classificatie | `subject`, `ifcCategory` |
| Wand | `dikteMm`, `isolatieType` |

Een eigenschap die ontbreekt, laat bij gebruik de standaard van het
gereedschap staan.

## Voorbeeld

```json
{
  "format": "open-pdf-studio/tool-set",
  "version": 1,
  "exportedAt": "2026-11-06T09:00:00.000Z",
  "app": "Open PDF Studio",
  "toolSet": {
    "name": "Ruwbouw meten",
    "items": [
      {
        "id": "tsi-voorbeeld-1",
        "name": "Vloeroppervlak beton",
        "type": "measureArea",
        "props": {
          "strokeColor": "#0066cc",
          "fillColor": "#99ccff",
          "fillOpacity": 0.3,
          "lineWidth": 1.5,
          "measureUnit": "m",
          "measurePrecision": 2,
          "measureDepth": 0.25,
          "measureName": "Vloer",
          "subject": "Betonvloer",
          "ifcCategory": "IfcSlab"
        },
        "layer": { "name": "Constructie", "color": "#cc0000" },
        "createdAt": "2026-11-06T08:55:00.000Z"
      },
      {
        "id": "tsi-voorbeeld-2",
        "name": "Wandlengte",
        "type": "measureDistance",
        "props": { "color": "#ff0000", "lineWidth": 1, "measureUnit": "m", "measurePrecision": 2 },
        "layer": null,
        "createdAt": "2026-11-06T08:56:00.000Z"
      }
    ]
  }
}
```

## Verenigbaarheid

- Een lezer slaat onbekende sleutels over, op elk niveau.
- Een nieuwe eigenschap of soort komt erbij zonder de versie op te hogen:
  oudere versies van de app negeren hem.
- `version` gaat alleen omhoog als een bestaande sleutel iets anders gaat
  betekenen; een oudere app weigert zo'n bestand dan met een melding in plaats
  van het verkeerd te lezen.
