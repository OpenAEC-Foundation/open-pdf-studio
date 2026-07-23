# Parametrische wapening: voorinstellingen, bewerkbare tekst en vlaggen

**Doel:** een parametrisch element uit het symbolenpalet toont zijn
eigenschappen direct na de keuze, dus vóór plaatsing. De gebruiker kan de
waarden vooraf instellen en ziet na plaatsing dezelfde velden terug. Voor
wapeningscomponenten is de zichtbare tekst rechtstreeks aanklikbaar en
wijzigbaar. Een wapeningsstaaf ondersteunt daarnaast één tot en met vier
vlaggen, boven of onder de staaf.

## Uitgangspunten

- Er wordt vóór plaatsing geen onzichtbare annotatie in het document gemaakt.
- Het eigenschappenvenster gebruikt een tijdelijk ontwerpobject met dezelfde
  `symbolId` en `params` als een geplaatste `parametricSymbol`-annotatie.
- Parameters zijn de enige bron voor tekst en geometrie. Een vrije
  tekstoverschrijving wordt niet toegevoegd, omdat die bijvoorbeeld een
  andere diameter zou kunnen tonen dan de parameter waarmee gerekend wordt.
- Voorinstellingen worden per symbooltype bewaard. Een wijziging voor
  `wapeningsstaaf` wijzigt dus niet de voorinstellingen van `netwapening`.
- De bestaande plaatsingswijze blijft per sjabloon intact. De
  wapeningsstaaf blijft een tweepuntselement.

## Gebruikersverloop vóór plaatsing

1. De gebruiker kiest een parametrisch element in het symbolenpalet.
2. De applicatie zet eerst het gekozen `symbolId` en de laatst gebruikte
   parameters voor dat symbool in de tijdelijke plaatsingsstatus.
3. Daarna wordt het gereedschap `parametricSymbol` actief.
4. Het eigenschappenvenster opent meteen met:
   - de naam van het gekozen element;
   - alle parameters uit het bijbehorende sjabloon;
   - de per symbool bewaarde waarden, of anders de sjabloonstandaarden.
5. Wijzigingen in het eigenschappenvenster werken het tijdelijke
   plaatsingsobject direct bij en worden als nieuwe voorinstelling voor dat
   symbool bewaard.
6. De preview en de uiteindelijke annotatie gebruiken exact deze waarden.
7. Na plaatsing blijft het gereedschap actief en gelden de waarden ook voor
   volgende plaatsingen, totdat de gebruiker ze wijzigt of een ander symbool
   kiest.

Bij terugkeer naar Selecteren verdwijnt het tijdelijke ontwerpobject uit het
eigenschappenvenster. Het komt nooit in undo/redo, opslaan, export of
hoeveelheden terecht.

## Gegevensmodel en opslag

`parametricSymbolStore` wordt de eigenaar van de tijdelijke
plaatsingsparameters:

```text
pendingSymbolId
pendingParamsBySymbol[symbolId]
```

De effectieve parameters zijn:

```text
template defaults
  + opgeslagen voorinstellingen voor dit symbolId
  + wijzigingen uit het eigenschappenvenster
```

De opgeslagen voorkeuren krijgen één versieerbare map voor parametrische
symbolen. Alleen sleutels die nog in het actuele sjabloon bestaan en waarvan
het type geldig is, worden teruggelezen. Onbekende of verouderde sleutels
worden genegeerd. Ontbrekende waarden vallen terug op `defaultParams`.

`showToolDefaults` krijgt een sjabloonbewuste variant of optionele overrides,
zodat het tijdelijke object voor een parametrisch symbool minstens bevat:

```text
id: "__tool-defaults__"
type: "parametricSymbol"
symbolId
params
```

Bij een parameterwijziging op dit tijdelijke object schrijft
`propertiesStore` naar `parametricSymbolStore` en de voorkeurenopslag. De
generieke stijlvoorkeuren blijven voor bestaande tekengereedschappen
ongewijzigd.

`annotation-creators` gebruikt voortaan de effectieve tijdelijke parameters
voor:

- de preview;
- `realSizeMm`;
- plaatsing op werkelijke schaal;
- de definitief aangemaakte `params`.

Zo kan de preview niet afwijken van het geplaatste element.

## Wapeningsstaaf: één tot en met vier vlaggen

Het sjabloon `wapeningsstaaf` krijgt:

| Parameter | Type | Default | Waarden |
|---|---|---:|---|
| `markerAantal` | enum/getal | 1 | 1, 2, 3, 4 |
| `markerRichting` | enum | `boven` | `boven`, `onder` |
| `markerPositie` | getal | 25 | 0–100 procent |

`markerRichting` en `markerPositie` bestaan al en blijven compatibel met
bestaande documenten. Ontbrekend `markerAantal` betekent altijd `1`.

De vlaggen zijn gelijke, gevulde driehoeken:

- ze staan naast elkaar met een kleine vaste tussenruimte;
- de groep is gecentreerd rond `markerPositie`;
- de volledige groep wordt binnen de staaflengte begrensd;
- `boven` plaatst de punten boven de staaf, `onder` eronder;
- vlaggrootte schaalt mee met de bestaande symboolhoogte;
- één vlag blijft visueel gelijk aan het bestaande symbool.

De keuze is onafhankelijk van de parameter `aantal` in het wapeningslabel.

## Aanklikbare en wijzigbare wapeningsteksten

Wapeningstekst blijft samengesteld uit parameters. De renderer levert voor
ieder bewerkbaar label een hitgebied en een stabiele rol terug. Daardoor kan
een klik op tekst worden onderscheiden van een klik op de overige geometrie.

Gedrag:

- één klik selecteert het hele component en toont de juiste parameters;
- dubbelklik op een label opent een compacte inline-editor bij dat label;
- Enter bevestigt, Escape herstelt de oorspronkelijke waarden;
- Tab doorloopt de velden zonder het hele document te selecteren;
- één bevestiging vormt één undo-stap;
- na bevestiging worden tekst, geometrie, hoeveelheden en eigenschappenpaneel
  vanuit dezelfde parameters opnieuw opgebouwd.

Per component worden uitsluitend de parameters getoond die het aangeklikte
label vormen:

| Component/label | Bewerkbare parameters |
|---|---|
| Wapeningsstaaf | aantal, diameter, lengte |
| Netwapening | diameter, h.o.h.-afstand, lengte |
| Stavenreeks | bestaande editor voor aantal, diameter en overige labelvelden |
| Wapeningskorf – boven/onder/zij | bijbehorend aantal en diameter |
| Wapeningskorf – beugels | beugeldiameter en beugelafstand |
| Wapeningskorf – naam | naam |

Voor andere parametrische symbolen blijft een klik op het element voldoende;
hun velden zijn wel vóór plaatsing zichtbaar, maar krijgen niet automatisch
een inline teksteditor.

## Undo, redo en persistentie

- Wijzigingen vóór plaatsing zijn voorkeuren en geen documentbewerkingen; ze
  maken daarom geen undo-stap.
- Wijzigingen aan een geplaatst component gebruiken de bestaande
  `updateAnnotProp`-route en maken één snapshot per bevestigde inline-edit.
- PDF- en XFDF-opslag bewaren `markerAantal` als onderdeel van `params`.
- Bestaande bestanden zonder `markerAantal` openen met één vlag.
- Kopiëren, plakken, undo en redo behouden alle parameters.

## Foutafhandeling

- Een onbekend `symbolId` toont de bestaande melding voor een onbekend
  sjabloon en blokkeert plaatsing zonder crash.
- Ongeldige opgeslagen waarden worden per parameter vervangen door de
  sjabloonstandaard.
- `markerAantal` wordt bij inlezen en renderen begrensd op 1–4.
- Als een inline-editor zijn hitgebied niet meer kan vinden na zoom of
  paginawissel, wordt de editor veilig gesloten zonder wijziging.

## Toegankelijkheid

- De velden in het eigenschappenvenster behouden labels en
  toetsenbordbediening.
- De keuze voor het aantal vlaggen en de vlagzijde gebruikt normale
  formulierbesturingen en is volledig met toetsenbord te bedienen.
- De inline-editor krijgt focus bij openen en geeft focus na sluiten terug aan
  het document.
- Tekstselectie binnen de inline-editor mag niet doorlekken naar de PDF-pagina.

## Verificatie

1. Storetests: voorinstellingen zijn per `symbolId` gescheiden, worden
   gevalideerd en vallen correct terug op sjabloonstandaarden.
2. Palette-eigenschappentest: symboolkeuze toont vóór plaatsing het juiste
   `symbolId` en de juiste parameters; wisselen van symbool wisselt de velden.
3. Creator-/previewtest: aangepaste voorinstellingen worden zowel door
   `realSizeMm`, preview als definitieve annotatie gebruikt.
4. Geometrietest: 1, 2, 3 en 4 vlaggen renderen boven en onder, blijven binnen
   de staaf en één vlag blijft achterwaarts compatibel.
5. Interactietest: dubbelklik op elk wapeningstype opent de juiste velden;
   Enter maakt één undo-stap, Escape geen, redo herstelt de wijziging.
6. Round-triptest: PDF/XFDF en kopiëren/plakken behouden tekstparameters,
   `markerAantal` en `markerRichting`.
7. Regressietests voor de bestaande tweepuntsplaatsing, rotatie, snapping en
   verplaatsing van de wapeningsstaaf.
8. Productiebundel en relevante kwaliteitstests moeten groen zijn.
