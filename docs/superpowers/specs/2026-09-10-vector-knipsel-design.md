# Vectorknipsel: een gebied uit een PDF knippen en vectorieel plakken

Ontwerp, 10 september 2026.

## Aanleiding

Een detail uit de ene tekening in de andere krijgen kan nu alleen als raster: je
maakt een schermafdruk en plakt een plaatje. Zodra je daarop inzoomt is het
korrelig, de lijnen zijn niet meer scherp en er valt niets meer uit te meten.
Terwijl de bron gewoon vectordata is.

Doel: een gebied van een vector-PDF selecteren, kopiëren, en in een andere PDF
plakken zodat het vector blijft — scherp op elke zoom, en in elke PDF-lezer.

De kernbewerking bestaat al in deze codebase. `js/pdf/titleblock-compose.js`
zet onderhoeken vectorieel op een kader met `embedPage(pagina, vak, matrix)`
gevolgd door `drawPage()`. Dat is precies wat hier nodig is; het gaat om de
schil eromheen.

## Uitgangspunten

- **Eerst verplaatsbaar, dan vastzetten.** Een geplakt knipsel is een object dat
  je kunt verslepen, schalen en verwijderen. Een aparte actie bakt het
  definitief in de pagina.
- **Het knipsel draagt zijn eigen kopie.** Het werkt ook als de bron gesloten,
  verplaatst of gewijzigd is, en overleeft opslaan en heropenen.
- **Vector is niet onderhandelbaar.** Los of vastgezet, in het bestand is het
  altijd vectordata. Alleen de voorvertoning op het scherm is raster.

## Architectuur

### Kopiëren

Een nieuw gereedschap "Vectorknipsel" (`js/tools/tools/vector-snippet-tool.js`)
spant een kader over de pagina. Bij loslaten:

1. de bronpagina wordt met `copyPages` in een verse mini-PDF gezet;
2. het geselecteerde vak wordt omgerekend naar de gebruikersruimte van de
   bronpagina;
3. bytes en vak gaan naar het klembord van de app.

Let op: de **hele bronpagina** plus een vak, niet een bijgesneden pagina. Dat is
wat `embedPage(pagina, vak, matrix)` verwacht, en het is hoe
`titleblock-compose.js` het al doet.

### Plakken

Ctrl+V in een ander tabblad zet een `vectorSnippet`-annotatie neer op ware
grootte, direct geselecteerd en te verslepen en schalen zoals een afbeelding.

### Weergave

De pdfium-worker rendert vanaf een **pad**, niet vanuit bytes
(`render_region(&path, …)` in `pdfium-worker/src/main.rs`). De store schrijft
elke mini-PDF daarom één keer naar de cachemap van de app en bewaart dat pad bij
de sleutel. Daarna is het gewoon `render_region` met het `srcBox`, gecachet per
zoomniveau volgens dezelfde bucket-logica als de paginaweergave. Inzoomen levert
een scherpere tegel.

## Datamodel

Annotatietype `vectorSnippet`. Naast de gewone plaatsingsvelden
(`x`, `y`, `width`, `height`, `rotation`) drie eigen velden:

| veld | betekenis |
|---|---|
| `snippetKey` | hash van de mini-PDF; sleutel waaronder de bytes leven |
| `srcBox` | `{left, bottom, right, top}` in de gebruikersruimte van de bronpagina |
| `srcLabel` | "Barn - Elevations.pdf, blad 4" — alleen voor het eigenschappenpaneel |

De bytes staan **niet** op de annotatie. Ze leven in
`js/annotations/vector-snippet-store.js`, een `Map<snippetKey, {bytes, pad}>`.
Tien knipsels uit hetzelfde blad delen één kopie.

## In het bestand

Dit is waar "los" en "vastgezet" uit elkaar lopen. Het verschil zit in *waar*
het Form XObject terechtkomt, niet in of het vector is.

**Nog niet vastgezet** → een stempel-annotatie met een vectoriële appearance
stream. Dat is echte vectordata, zichtbaar in elke PDF-lezer, en de app leest
het bij heropenen terug als verplaatsbaar object. De app schrijft al
vector-appearances (`js/pdf/saver/appearance-vectors.js`).

**Vastgezet** → hetzelfde XObject wordt in de inhoudstroom van de pagina zelf
getekend en de annotatie verdwijnt. Daarna is het gewone pagina-inhoud.

### Ontdubbeling

Elke unieke mini-PDF komt één keer in het document als stream, verzameld in een
`OPS_VectorSnippets`-woordenboek op catalogusniveau (sleutel → stream). Elke
stempel verwijst ernaar met `OPS_SnippetKey`, plus `OPS_SrcBox`. Dat volgt de
`OPS_*`-conventie die saver en converter al gebruiken (`OPS_Subtype`,
`OPS_Holes`, `OPS_Hartlijn`), dus het inleespad bestaat als patroon.

Bij openen leest de converter dat woordenboek terug in de store en maakt van
elke stempel weer een `vectorSnippet`.

Waarom naast de appearance óók de bronpagina bewaren? De appearance is het
geknipte XObject: genoeg om te tónen, te weinig om mee te werken. Voor een
scherpere voorvertoning bij inzoomen heeft de worker een PDF-pagina nodig, en om
een knipsel later alsnog vast te zetten of te verschalen is de bron nodig. Dat
kost ruimte — de bronpagina staat dan één keer in het document naast de
XObjects die eruit geknipt zijn — maar het is wat een knipsel zelfstandig
maakt. Zodra een knipsel vastgezet is en er geen enkel los knipsel meer naar die
sleutel verwijst, valt de bronstream bij de eerstvolgende opslag weg.

### Wat het kost

De mini-PDF bevat de hele bronpagina, niet alleen het geknipte vak — dat heeft
`embedPage` nodig. Knip je een detail uit een A0-blad vol lettertypen en
afbeeldingen, dan reist dat hele blad mee; op zware CAD-bladen enkele MB.
`copyPages` neemt alleen de resources mee waar die pagina naar verwijst, en de
ontdubbeling maakt een tweede knipsel uit hetzelfde blad gratis. Maar het blijft
groter dan een rasterafdruk van hetzelfde vak. Dat is de prijs van vector
blijven, en de gebruiker hoort dat te weten: het eigenschappenpaneel toont de
omvang van het knipsel.

## Randgevallen

- **Geroteerde bronpagina.** Het vak staat in de gebruikersruimte van de
  bronpagina; de `/Rotate` van die pagina hoort in de inbedmatrix verwerkt te
  worden, niet in het vak.
- **Bron met CropBox.** Het zichtbare vak is de CropBox, anders de MediaBox —
  zelfde `zichtbaarVak()`-logica als `titleblock-compose.js`, die daarvoor
  herbruikt wordt in plaats van gekopieerd.
- **Leeg of ontaard vak.** Een selectie kleiner dan 1 pt levert geen knipsel op.
- **Bron is een rasterpagina.** Dan komt er een ingebed raster mee in plaats van
  lijnwerk. Dat is correct — een knipsel geeft door wat de bron heeft — maar de
  gebruiker die "vector" verwacht ziet het verschil pas bij inzoomen. Het
  gereedschap doet hier geen uitspraak over: inhoud herkennen zou een
  inhoudstroom-analyse vergen, en dat valt buiten dit ontwerp.
- **Knipsel uit hetzelfde document.** Werkt hetzelfde; bron en doel mogen
  dezelfde pagina zijn.
- **Bron gesloten na kopiëren.** Werkt, want de bytes zitten in de store.

## Modules

| module | verantwoordelijkheid |
|---|---|
| `js/pdf/vector-embed.js` | pure inbed-helper (pdf-lib), node-testbaar zonder app |
| `js/annotations/vector-snippet-store.js` | bytes, paden en ontdubbeling |
| `js/pdf/saver/vector-snippet.js` | het schrijfpad |
| `js/tools/tools/vector-snippet-tool.js` | het opspannen |

De saver krijgt er één `case` bij die doorverwijst. Hij is al 2.974 regels; daar
hoort geen nieuwe logica meer bij, wel een verwijzing naar een eigen module —
zoals `saver/watermarks.js` en `saver/text-edits.js` dat al doen.

## Testen

`js/pdf/vector-embed.test.mjs`, puur en zonder app, in de geest van de
bestaande `titleblock-compose`-tests:

- een knipsel uit een testpagina inbedden geeft een Form XObject met de juiste
  BBox en matrix;
- een vak dat niet op de oorsprong ligt wordt correct verschoven — precies de
  val die in `titleblock-compose.js` gedocumenteerd staat;
- twee knipsels uit dezelfde bron delen één XObject;
- een geroteerde bronpagina levert een knipsel in de juiste stand;
- een ontaard vak wordt geweigerd.

Daarnaast een rondgang plaatsen → opslaan → heropenen → nog steeds een
verplaatsbaar knipsel op dezelfde plek, en de verplichte opslag-rondgang uit het
vaste release-protocol, want dit raakt de saver.

## Wat er niet in zit

- Geen vectorieel tekenen op het canvas. De voorvertoning blijft raster (die
  wordt wel scherper bij inzoomen). Een tekenlaag die PDF-inhoudstromen kan
  uitvoeren is een eigen project.
- Geen bewerken van de inhoud van een knipsel. Het is een blok inhoud, geen
  verzameling losse objecten.
- Geen knipsels tussen verschillende toepassingen. Het klembord van de app,
  niet dat van het besturingssysteem.
