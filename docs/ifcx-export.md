# PDF naar IFCX (bèta): ontwerpvoorstel

Issue: #876. Status: **bèta**. De export staat onder *Bestand > Exporteren > Exporteren
naar IFCX (bèta)* en in het MCP-gereedschap `app_export_ifcx`.

Dit document is het voorstel waar het issue om vraagt: de IFCX-structuur die we
schrijven, hoe elk deel van een PDF daarop wordt afgebeeld, de afspraken over
coördinaten, wat er verloren gaat, en de vragen waarover de producteigenaar moet
beslissen voordat de export uit de bèta gaat. De code staat in `open-pdf-studio/js/pdf/`:

| Bestand | Rol |
|---------|-----|
| `ifcx-inhoud.js` | Leest één pagina: paden, tekstregels, plaatsingen van afbeeldingen, PDF-lagen (pdf-lib, puur) |
| `ifcx-afbeelding.js` | Afbeeldings-XObject naar JPEG / JPEG 2000 / PNG, of de reden waarom niet |
| `ifcx-document.js` | De IFCX-schrijver, de schema's van de eigen attributen en een structuurcontrole |
| `ifcx-export.js` | Koppeling met de app: bytecache, meetschaal, opslagvenster, wegschrijven |
| `ifcx-opdracht.js` | Argumenten en antwoord van het MCP-gereedschap |
| `IfcxExportDialog.jsx` | Het optievenster |

## Doelformaat en validatie

* **IFCX alpha** (`"ifcxVersion": "ifcx_alpha"`), de JSON-vorm van IFC5 zoals
  buildingSMART die publiceert in de ontwikkelrepository van IFC5. Het formaat is nog
  niet definitief; dat is de belangrijkste reden dat de export een bèta is.
* Twee schema-imports per URI:
  `https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx` (klassen,
  `bsi::ifc::class`, `bsi::ifc::presentation::diffuseColor`) en
  `https://ifcx.dev/@openusd.org/usd@v1.ifcx` (`usd::xformop`,
  `usd::usdgeom::basiscurves`, `usd::usdgeom::mesh`, `usd::usdgeom::visibility`).
  De app vraagt deze adressen nooit op; ze staan alleen in het bestand.
* Alles wat PDF-specifiek is gebruikt een eigen naamruimte `opds::pdf::*`, gedeclareerd
  in het `schemas`-blok van elk bestand, zodat een lezer het kan controleren zonder iets
  op te halen.
* Validatie in deze bèta: `valideerIfcx()` in `ifcx-document.js`, die de unit-tests op
  elk gegenereerd bestand draaien. Die controleert de kopvelden, de importlijst, unieke
  knooppaden, dat elk doel van `children` en `inherits` bestaat, dat er geen kringen
  zijn, en dat elk attribuut uit een geïmporteerde naamruimte komt of klopt met zijn
  gedeclareerde schema. Validatie tegen het officiële IFCX-JSON-schema en openen in de
  viewer van buildingSMART zijn open vraag 1.

### Samenhang met het bestaande `.ifcreport`

`ifc-export.js` (lintknop *IFC-report*) blijft ongewijzigd. Dat blijft een rapport
*naast* de PDF: de PDF als base64 plus één entiteit per annotatie. De IFCX-export is
een *omzetting* van de inhoud van de PDF. Beide delen de afbeelding van annotaties:
`ifc-entity.js` (`ifcEntityFor`) geeft de IFC-klasse, naam en eigenschappen van een
annotatie, zodat een wand in beide bestanden `IfcWall` is, een staalprofiel `IfcMember`
met zijn profielnaam, enzovoort. De kopvelden van het rapport (generator, aanmaakdatum,
bronbestand, eenheden) komen terug als `opds::pdf::document` op de wortelknoop.

## Documentstructuur

```json
{
  "header":  { "id": "opds-ifcx-<root path>", "ifcxVersion": "ifcx_alpha",
               "dataVersion": "0.1.0", "author": "Open PDF Studio", "timestamp": "<ISO 8601>" },
  "imports": [ { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" },
               { "uri": "https://ifcx.dev/@openusd.org/usd@v1.ifcx" } ],
  "schemas": { "opds::pdf::document": { "uri": "…", "value": { "dataType": "Object", … } }, … },
  "data":    [ { "path": "<uuid>", "children": { "<name>": "<uuid>" },
                 "inherits": { "<name>": "<uuid>" }, "attributes": { … } }, … ]
}
```

Knopenboom (de namen zijn de sleutels in `children`):

```
<wortel>                    IfcProject, opds::pdf::document
├── sheet-001               opds::pdf::sheet, usd::xformop (schaal + plaats), bladrand
│   ├── drawing             opds::pdf::layer kind=drawing
│   │   ├── pdf-layer-001   één groep per PDF-laag (alleen als de pagina lagen heeft)
│   │   │   ├── path-000001 usd::usdgeom::basiscurves  (erft een stijlknoop)
│   │   │   └── fill-000002 usd::usdgeom::mesh         (erft een stijlknoop)
│   ├── text                opds::pdf::layer kind=text
│   │   └── text-000001     opds::pdf::text, usd::xformop
│   ├── raster              opds::pdf::layer kind=raster
│   │   └── image-0001      opds::pdf::placement, vierhoek-mesh (erft de beeldknoop)
│   └── annotations         opds::pdf::layer kind=annotations
│       ├── layer-001       één groep per annotatielaag van de app (als er meer zijn)
│       │   └── annotation-00001   bsi::ifc::class, opds::pdf::annotation, geometrie
└── sheet-002 …
```

Knopen buiten de boom, waarnaar `inherits` verwijst:

* **stijlknopen**: één per verschillende lijn-/vulstijl (`bsi::ifc::class` IfcAnnotation,
  `bsi::ifc::presentation::diffuseColor`, `opds::pdf::style`). Een CAD-blad met 50 000
  lijnen in zes pennen schrijft zes stijlknopen, geen 50 000 kopieën.
* **beeldknopen**: één per afbeeldings-XObject (`opds::pdf::image` met de data). Een logo
  dat op elke pagina staat, wordt één keer opgeslagen.

Paden hebben de vorm van een UUID: een willekeurig voorvoegsel per export plus een
teller, zodat ze uniek zijn zonder per knoop een UUID te maken. De namen van kinderen
(`sheet-001`, `path-000001`) zijn stabiel en sorteerbaar; het echte paginalabel staat in
de attributen.

Een volledig klein voorbeeld (één pagina, schaal 1:100, één lijn, één tekst, één meting;
het `schemas`-blok ingekort):

```json
{
 "header": { "id": "opds-ifcx-3f2a9c1e-7b4d-40a5-8000-000000000001", "ifcxVersion": "ifcx_alpha",
             "dataVersion": "0.1.0", "author": "Open PDF Studio", "timestamp": "2026-10-31T12:00:00.000Z" },
 "imports": [ { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" },
              { "uri": "https://ifcx.dev/@openusd.org/usd@v1.ifcx" } ],
 "schemas": { "…": "de 8 opds::pdf::-schema's" },
 "data": [
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000002",
    "attributes": { "bsi::ifc::class": { "code": "IfcAnnotation", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcAnnotation" },
                    "opds::pdf::style": { "stroke": [1, 0, 0], "lineWidth": 0.000706, "dashed": false },
                    "bsi::ifc::presentation::diffuseColor": [1, 0, 0] } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000003",
    "inherits": { "style": "3f2a9c1e-7b4d-40a5-8000-000000000002" },
    "attributes": { "usd::usdgeom::basiscurves": { "points": [[0.003528, 0.007056, 0], [0.038806, 0.007056, 0]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000004",
    "children": { "path-000001": "3f2a9c1e-7b4d-40a5-8000-000000000003" },
    "attributes": { "opds::pdf::layer": { "kind": "drawing", "name": "Drawing", "source": "pdf-content" } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000005",
    "attributes": { "bsi::ifc::class": { "code": "IfcAnnotation", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcAnnotation" },
                    "bsi::ifc::presentation::diffuseColor": [0, 0, 0] } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000006",
    "inherits": { "style": "3f2a9c1e-7b4d-40a5-8000-000000000005" },
    "attributes": { "opds::pdf::text": { "value": "A-101", "fontSize": 0.004233, "font": "Helvetica", "rotation": 0 },
                    "usd::xformop": { "transform": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0.007056, 0.088194, 0, 1]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000007",
    "children": { "text-000001": "3f2a9c1e-7b4d-40a5-8000-000000000006" },
    "attributes": { "opds::pdf::layer": { "kind": "text", "name": "Text", "source": "pdf-content" } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000008",
    "attributes": { "bsi::ifc::class": { "code": "IfcAnnotation", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcAnnotation" },
                    "opds::pdf::annotation": { "id": "m1", "type": "measureDistance", "author": "Ann",
                                               "measure": { "value": 2540, "unit": "mm", "text": "2540 mm" },
                                               "properties": { "measureText": "2540 mm" } },
                    "usd::usdgeom::basiscurves": { "points": [[0.003528, 0.070556, 0], [0.028928, 0.070556, 0]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000009",
    "children": { "annotation-00001": "3f2a9c1e-7b4d-40a5-8000-000000000008" },
    "attributes": { "opds::pdf::layer": { "kind": "annotations", "name": "Annotations", "source": "app-annotations" } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-00000000000a",
    "children": { "drawing": "3f2a9c1e-7b4d-40a5-8000-000000000004",
                  "text": "3f2a9c1e-7b4d-40a5-8000-000000000007",
                  "annotations": "3f2a9c1e-7b4d-40a5-8000-000000000009" },
    "attributes": {
      "opds::pdf::sheet": { "pageNumber": 1, "label": "A-101", "widthPt": 400, "heightPt": 300, "rotation": 0,
                            "cropBox": [0, 0, 400, 300], "scaleDenominator": 100, "scale": "1:100", "origin": [0, 0, 0],
                            "counts": { "paths": 1, "texts": 1, "images": 0, "annotations": 1 },
                            "skipped": { "inlineImages": 0, "shadings": 0, "invisibleText": 0, "undecodableText": 0, "nestedForms": 0 } },
      "usd::xformop": { "transform": [[100, 0, 0, 0], [0, 100, 0, 0], [0, 0, 100, 0], [0, 0, 0, 1]] },
      "usd::usdgeom::basiscurves": { "points": [[0, 0, 0], [0.141111, 0, 0], [0.141111, 0.105833, 0], [0, 0.105833, 0], [0, 0, 0]] } } },
  { "path": "3f2a9c1e-7b4d-40a5-8000-000000000001",
    "children": { "sheet-001": "3f2a9c1e-7b4d-40a5-8000-00000000000a" },
    "attributes": { "bsi::ifc::class": { "code": "IfcProject", "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcProject" },
                    "opds::pdf::document": { "fileName": "plan.pdf", "pageCount": 1, "exportedPages": [1],
                                             "generator": "open-pdf-studio", "created": "2026-10-31T12:00:00.000Z",
                                             "units": "m", "beta": true } } }
 ]
}
```

### Eigen attributen

| Attribuut | Op | Velden |
|-----------|----|--------|
| `opds::pdf::document` | wortel | fileName, pageCount, exportedPages, generator, created, units (`m`), beta |
| `opds::pdf::sheet` | blad | pageNumber, label, widthPt, heightPt, rotation, cropBox, scaleDenominator, scale, origin, counts, truncated, skipped |
| `opds::pdf::layer` | laag / groep | kind (`drawing`, `text`, `raster`, `annotations`), name, source (`pdf-content`, `pdf-ocg`, `app-annotations`, `annotation-layer`) |
| `opds::pdf::style` | stijlknoop | stroke `[r,g,b]`, fill `[r,g,b]`, lineWidth (m papier), dashed, fillRule |
| `opds::pdf::text` | tekstregel | value, fontSize (m papier), font, rotation (graden) |
| `opds::pdf::image` | beeldknoop | mimeType, widthPx, heightPx, encoding, data, byteLength, omitted |
| `opds::pdf::placement` | plaatsing van een afbeelding | matrix `[a,b,c,d,e,f]`: het eenheidsvierkant van de afbeelding naar meters op het blad |
| `opds::pdf::annotation` | annotatie | id, type, name, subject, author, text, layer, createdAt, modifiedAt, color, lineWidth, measure, replies, properties |

## Vertaaltabel

| PDF / app | IFCX |
|-----------|------|
| Pagina | bladknoop: `opds::pdf::sheet`, rand als `basiscurves`, `usd::xformop` met de schaal |
| Paginalabel (`/PageLabels`) | `opds::pdf::sheet.label` |
| `/Rotate`, CropBox | toegepast op alle geometrie; vastgelegd als `rotation`, `cropBox` |
| Meetschaal van de app | `scaleDenominator`, `scale`, en de schaal in de bladtransformatie |
| Getrokken pad (`S`, `s`, `B`…) | één `basiscurves`-knoop per deelpad, bogen afgevlakt |
| Gevuld pad (`f`, `f*`, `B`…) | één `mesh`-knoop, één vlak per deelpad, vulregel in de stijl |
| Lijn-/vulkleur, lijndikte, streepjes | stijlknoop (`diffuseColor`, `opds::pdf::style`) |
| Tekstoperatoren (`Tj`, `TJ`, `'`, `"`) | één `opds::pdf::text`-knoop per regel, samengevoegd langs de basislijn |
| Afbeeldings-XObject | beeldknoop (data één keer) + plaatsingsknoop per gebruik |
| Form-XObject | gevolgd met zijn `/Matrix` (max. 12 niveaus) |
| Optionele inhoud (`/OC` marked content, `/OC` op een form of afbeelding) | groepsknoop per PDF-laag, `visibility: invisible` als die standaard uit staat |
| Annotatie van de app | `bsi::ifc::class` uit `ifcEntityFor`, `opds::pdf::annotation`, geometrie |
| Annotatielaag van de app | groepsknoop in de annotatielaag, met zijn zichtbaarheid |

### Bladen

Eén knoop per geëxporteerde pagina, in de `children` van de wortel onder `sheet-NNN`
(paginanummer). Het blad draagt zijn papiermaat in punten zoals getoond (na `/Rotate`),
de CropBox in de ongedraaide gebruikersruimte van de PDF, de draaiing, het paginalabel
en, als de app er een kent, de meetschaal (`meetschaalOp`, dezelfde opzoeking als de
DXF-export: schaalgebieden, schaalstokken, kalibratie). De bladrand wordt geschreven als
gesloten `basiscurves`, zodat een viewer de papierrand toont.

### Vectordata

Paden worden rechtstreeks uit de content streams gelezen met dezelfde tokenizer als de
teksteditor (`content-stream-text.js`; `iterContentTokens` geeft de tokens één voor één,
zodat een zware pagina nooit als één tokenlijst in het geheugen staat). De interpreter
volgt `q`/`Q`, `cm`, kleuroperatoren (grijs, RGB, CMYK omgezet naar RGB, patronen worden
"geen kleur"), `w`, `d`, de padoperatoren `m l c v y h re` en de verfoperatoren. Bogen
worden afgevlakt in bladruimte: één segment per 2 pt controlepolygoon, 2 tot 48
segmenten per boog. Punten worden geschreven in meters papier.

Waarom polylijnen en geen echte bogen: de alpha-`basiscurves` van het USD-schema heeft
geen overdraagbare manier om lijnen en Béziers in één curve te mengen, en elke
IFCX-lezer kan een polylijn tekenen. Echte boogdata is open vraag 4.

Vullingen worden `usd::usdgeom::mesh`-knopen met één n-hoek per gesloten deelpad; de
vulregel staat in `opds::pdf::style.fillRule`, zodat een lezer gaten kan herstellen.

### Tekst

Tekstregels komen uit dezelfde doorloop. Lettertypen worden gedecodeerd met de
bestaande fonttabellen (`buildFontInfos` in `saver/text-edit-inplace.js`: ToUnicode,
eenvoudige coderingen, Type0 Identity met ToUnicode), glyphbreedtes schuiven de positie
op, en opeenvolgende tekstoperatoren op één basislijn met hetzelfde lettertype, dezelfde
grootte en kleur worden samengevoegd tot één regel (met een spatie bij een gat). Een
regel is een knoop met `opds::pdf::text` (tekst, lettergrootte en lettertypenaam) en een
`usd::xformop` die de oorsprong op het begin van de basislijn zet en meedraait met de
tekst. Onzichtbare tekst (weergavemodus 3, OCR-lagen) en tekst zonder bruikbare codering
blijven weg en worden geteld in `skipped`.

### Raster

**Keuze: ingebed als base64**, niet als losse bestanden ernaast. Eén bestand is wat
gebruikers mailen en wat het bestaande `.ifcreport` al doet (dat bedt de PDF in als
base64); een IFCX zonder zijn afbeeldingen zou stil inhoud verliezen als het alleen
wordt gekopieerd. De prijs is de grootte (base64 voegt een derde toe); de limieten
hieronder houden die in de hand.

* JPEG (`DCTDecode`) en JPEG 2000 (`JPXDecode`) gaan ongewijzigd door.
* Met Flate/LZW/RunLength/ASCII gecodeerde samples in grijs, RGB, CMYK (omgezet) en
  geïndexeerde kleur met 1, 2, 4 of 8 bits worden PNG; PNG-predictors worden
  teruggedraaid. Een palet heeft hooguit 256 kleuren (een grotere `hival` in een
  beschadigd bestand wordt begrensd).
* CCITT, JBIG2, een TIFF-predictor, 16-bits samples, stencilmaskers en onbekende
  kleurruimten houden hun plaatsing, zonder `data` en met de reden in `omitted`.
* Een gescande pagina is gewoon een blad met één afbeelding die het hele blad bedekt.
* De afbeelding wordt één keer per XObject opgeslagen; elk gebruik is een
  plaatsingsknoop die haar erft, met `opds::pdf::placement.matrix` (de beeldmatrix van de
  PDF in meters op het blad) en een vierhoek-mesh van de hoeken, zodat een viewer laat
  zien waar ze staat.

Limieten: een afbeelding boven 40 megapixel wordt niet gedecodeerd; een gecodeerde
afbeelding boven 16 MB, of meer dan 96 MB aan afbeeldingen samen, houdt alleen haar
plaatsing (`imageTooLarge`, `rasterBudget`). Zachte maskers (transparantie) worden niet
toegepast.

### Annotaties

Alle annotaties van de app (markeringen, opmerkingen met hun antwoorden, metingen met
waarde, eenheid en tekst, stempels, tekenonderdelen) gaan naar de laag `annotations`
van het blad, nooit naar de tekening-, tekst- of rasterlaag, zodat een lezer ze als één
groep kan uitzetten. Elke annotatieknoop krijgt:

* `bsi::ifc::class` uit de bestaande afbeelding van het `.ifcreport` (`ifc-entity.js`):
  wanden `IfcWall`, vloersystemen `IfcSlab`, staalprofielen `IfcMember`, ruimten
  `IfcSpace`, stramienen `IfcGrid`, symbolen hun IFC-categorie, de rest `IfcAnnotation`;
* `opds::pdf::annotation` met id, type, auteur, tekst, antwoorden, meting en de
  eigenschappen van diezelfde afbeelding (wanddikte, sjabloon en parameters, profiel);
* geometrie op het blad: een polylijn voor punten/paden, een lijn voor begin/eind, een
  gesloten omtrek (meegedraaid met de annotatie) voor kaders en stempels, een ellips voor
  cirkels, of alleen een positie (`usd::xformop`) voor een opmerkingspictogram.

Heeft het document meer annotatielagen (#468), dan wordt elke laag een groepsknoop in de
annotatielaag, met de laagnaam en de zichtbaarheid.

## Coördinaten en eenheden

* Geometrie staat in **meters papier**: 1 pt = 0,0254 / 72 m, afgerond op 1e-6 m (één
  micrometer papier).
* Bladruimte: oorsprong linksonder op de pagina **zoals getoond** (CropBox, `/Rotate`
  toegepast), x naar rechts, y omhoog, z = 0. De interpreter begint met die
  weergavematrix, dus alle inhoud staat al op het blad.
* Annotaties van de app staan linksboven met y omlaag; ze worden gespiegeld met de
  getoonde paginahoogte.
* **Schaal**: de `usd::xformop` van het blad schaalt zijn inhoud met N bij schaal 1:N,
  zodat een lijn in het samengestelde model zijn echte lengte in meters heeft. Zonder
  bekende schaal is de factor 1 (papiermaat). Kinderen bevatten de schaal nooit zelf;
  een lezer die papiercoördinaten wil, leest de geometrie van de kinderen direct.
* Bladen liggen naast elkaar langs x (`opds::pdf::sheet.origin`), elk na de geschaalde
  breedte van het vorige blad plus 5 cm, zodat een viewer ze naast elkaar toont.
* `usd::xformop.transform` is een 4x4-matrix in rijvectorvorm met de verschuiving in de
  laatste rij, zoals in de voorbeelden van IFC5.

## Limieten en geheugen

* Pagina's worden **één voor één** gelezen en geschreven; de knopen van een pagina
  worden als JSON-tekst vastgelegd zodra de pagina klaar is. Het geheugengebruik op zijn
  hoogst is de uitvoertekst plus de geometrie van één pagina.
* Per pagina hooguit **50 000 paden** (getrokken deelpaden plus vullingen), 20 000
  tekstregels en 500 plaatsingen van afbeeldingen. Voorbij die grens telt de interpreter
  alleen nog. Het blad legt `truncated: { paths: <totaal> }` vast en het venster en het
  MCP-antwoord melden "pagina N: K van T paden geëxporteerd". Het MCP-gereedschap kan de
  grens verhogen (`maxPathsPerPage`).
* **Het hele bestand** heeft een grens van 320 M tekens JSON. De uitvoer is één tekst,
  en een JavaScript-tekst kan niet groter worden dan ongeveer 512 M tekens; zonder grens
  liep een zware tekeningenset na lange tijd vast op "Invalid string length". Een zware
  CAD-pagina met 50 000 paden geeft ongeveer 13 MB; acht zulke pagina's kostten bij een
  meting 11 s en 104 MB. Is de grens bereikt, dan blijven de volgende pagina's weg en
  melden het venster en het MCP-antwoord vanaf welke pagina.
* De export laat de interface tussen pagina's ademen en is af te breken door het venster
  te sluiten. Het MCP-gereedschap breekt zichzelf af net voor de brug na 300 s opgeeft,
  en schrijft dan niets.
* Een document dat met een wachtwoord is geopend, is alleen-lezen; de inhoud ervan gaat
  niet als kopie de app uit, dus ook niet als IFCX (menu, venster en MCP weigeren).

## Verlies

Wat de bèta niet meeneemt:

* **Knippaden** worden genegeerd: inhoud die een PDF wegknipt (bijvoorbeeld buiten een
  viewport) verschijnt volledig.
* Bogen worden polylijnen; streeppatronen worden teruggebracht tot `dashed: true/false`;
  lijnuiteinden, hoekverbindingen en verstekgrenzen vallen weg.
* Gaten volgens even-oneven of niet-nul worden niet in de vul-meshes gesneden (de regel
  blijft bewaard).
* Transparantie (`/CA`, `/ca`, zachte maskers), mengmodi, verlopen (`sh`), patronen en
  inline-afbeeldingen (`BI … EI`) blijven weg; verlopen en inline-afbeeldingen worden
  geteld.
* Tekst: glyphvormen, tekenafstand binnen een regel, en tekst in lettertypen zonder
  Unicode-koppeling. Tekst staat op het begin van zijn basislijn, niet uitgevuld.
* Afbeeldingen in CCITT/JBIG2/16 bits en stencilmaskers: alleen de plaatsing.
* De pagina-inhoud komt uit de **laatst opgeslagen** toestand van de PDF (de bytecache);
  niet-opgeslagen wijzigingen in de pagina-inhoud zitten niet in de export, annotaties
  altijd wel.
* Koppelingen, formuliervelden, bladwijzers en bijlagen worden niet geëxporteerd.

## Heen en terug

In de bèta alleen exporteren. Een IFCX later terug inlezen als laag over de PDF kan (het
blad, de lagen en de id's van annotaties staan er allemaal in), maar vraagt een besluit
over welke van de verliesgevende delen dan behouden moeten blijven (open vraag 6).

## Open vragen voor de producteigenaar

1. **Validatie**: waartegen testen we: het IFCX-JSON-schema van buildingSMART, de
   IFC5-viewer, of beide? Moet de CI het bestand openen in een referentie-implementatie?
2. **Klasse van een blad**: IFC5 kent nog geen blad. Houden we het blad als knoop zonder
   klasse met `opds::pdf::sheet`, of geven we het een klasse (bijvoorbeeld `IfcAnnotation`
   of een documentverwijzing)? Dezelfde vraag voor de wortel (nu `IfcProject`).
3. **Plaats van de bladen**: naast elkaar langs x (nu), allemaal in de oorsprong (de
   werkelijke coördinaten van verschillende verdiepingen overlappen), of op een
   georeferentie als de PDF die heeft (`/VP` met `/Measure /GEO`)?
4. **Bogen**: alleen polylijnen (nu), of ook echte Bézierdata in een eigen attribuut voor
   lezers die die kunnen gebruiken?
5. **Afbeeldingen**: base64 in het bestand (nu) of losse bestanden naast de `.ifcx`?
   Welke groottegrenzen zijn aanvaardbaar voor een zware set scans?
6. **Heen en terug**: moet Open PDF Studio IFCX terug inlezen, en welke delen moeten dan
   behouden blijven (alleen annotaties, of ook de tekening)?
7. **Eigen naamruimte**: is `opds::pdf::*` het juiste voorvoegsel, en waar moeten de
   schema-URI's naar wijzen (nu naar dit document)?
8. **Knippen**: knippaden toepassen (de geometrie afsnijden) of de volledige geometrie
   houden en het knipgebied als eigen knoop schrijven?
9. **Padgrens**: is 50 000 paden per pagina de juiste standaard, en moet een grens de
   geometrie vereenvoudigen (collineaire segmenten samenvoegen, piepkleine segmenten
   weglaten) in plaats van afkappen? En is 320 M tekens voor het hele bestand goed, of
   moet een zware set liever in meer bestanden worden gesplitst?
