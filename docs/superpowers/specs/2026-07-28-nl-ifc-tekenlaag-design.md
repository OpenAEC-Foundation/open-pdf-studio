# NL IFC Bouw als 2D-tekenlaag — ontwerp

**Doel:** het NL IFC Bouw-toolpalette laten werken als een samenhangende
2D-tekenapplicatie: componenten tekenen eenduidig (lijndikte, arcering,
teksthoogte) volgens regels die per tekening gelden, in plaats van per
component los ingesteld te worden.

## Kernbegrippen

### Tekeningtype (regelset)

Een **tekeningtype** is een benoemde regelset, te beginnen met
"Constructieplattegrond". Een regelset bevat:

- **teksthoogtes per tekstsoort** (bijv. labels 2,5 mm; maatvoering 2,0 mm;
  titels 3,5 mm — papiermaat, dus schaalgebied-bewust);
- **lijndikte per IFC-categorie** (IfcBeam, IfcColumn, IfcWall, IfcSlab,
  IfcReinforcingBar, …) — de bestaande `ifcCategoryMap` is de sleutel;
- **arcering per IFC-categorie** (later invulbaar; het model reserveert de
  plek).

Regelsets zijn data (JSON in preferences/appdata), geen code. De
standaard-regelset "Constructieplattegrond 1:100" wordt meegeleverd.

### Koppeling aan het schaalgebied

Werkvolgorde van de gebruiker: (1) schaalgebied definiëren, (2) aan dat
gebied een tekeningtype toewijzen. Componenten die binnen het gebied
vallen **erven** de regels van dat tekeningtype: lijndikte uit hun
IFC-categorie, teksthoogte uit hun tekstsoort. Een expliciet op het
component gezette waarde wint altijd van de geërfde waarde.

**Buiten een schaalgebied** (of zonder toegewezen tekeningtype) geldt de
standaard-regelset — géén apart gedrag (besluit gebruiker 2026-07-28).

### Label als apart object

Nieuw annotatietype **`label`**:

- leest een **eigenschap van een gekoppeld component** uit (bijv.
  `typeNaam` van een betonbalk → "300x500"); wijzigt het component, dan
  volgt het label;
- koppeling via component-id; verwijderen van het component verwijdert de
  gekoppelde labels mee (met undo);
- vrij verplaatsbaar (eigen positie/offset), teksthoogte geërfd uit het
  tekeningtype, overschrijfbaar;
- ook los te plaatsen met vrije tekst (zonder koppeling) — zelfde object;
- opgeslagen als eigen annotatie (FreeText-achtig met OPS-sleutels voor de
  koppeling en de uitgelezen eigenschap), zichtbaar in andere
  PDF-programma's, en bij heropenen weer gekoppeld.

**Migratie:** de geïntegreerde tags van betonbalk, kolom en de
wapeningscomponenten worden gedragen door dit label-object. Het component
maakt bij plaatsing zijn label(s) aan (zoals nu), maar onderliggend is het
een apart, koppelbaar object. Bestaande opgeslagen tags laden als labels.

### Typen in plaats van losse maten

De betonbalk krijgt een **typelijst**: benoemde typen ("300x500" =
breedte 300, hoogte 500), uitbreidbaar door de gebruiker. `typeNaam` is de
eigenschap die het standaard-label toont. Zelfde patroon later voor
kolommen en andere maatvoerende componenten.

### Overspanningsrichting vloer

De bestaande overspanningspijl krijgt instelbare lengte-parameters en een
gekoppeld label (via het label-object).

## Instellingenpaneel

Eén paneel "Tekeninstellingen" (ingang bij het NL IFC Bouw-palet en/of de
ribbon): beheer van tekeningtypen (regelsets bewerken: teksthoogtes,
lijndikte per IFC-categorie), toewijzing tekeningtype ↔ schaalgebied, en
de standaard-regelset. Windows-stijl, compact, beweegbaar modal.

## Overgenomen ontwerpkeuzes uit Open 2D Studio 1.0

Uit onderzoek van de open-2d-studio-repo (Drawing Standards, Grids, Space,
Materials, IfcTypes, Wall Systems, Project) nemen we over:

1. **Eén `DrawingStandard`-preset als master, met per-schaal-tabellen.**
   Schaalafhankelijke waarden als `Record<schaalKey, waarde>` (bijv.
   `"0.01"` = 1:100) met nearest-scale-terugval — maar ditmaal volledig:
   lijndikte per IFC-categorie, teksthoogtes, arceringsschaal en
   labelgrootte allemaal ín de preset (in Open 2D stond dit half in layers
   en half in constants; dat gat repareren we hier vanaf dag één). Ons
   "tekeningtype" ís zo'n preset.
2. **Twee-lagen-overerving met expliciete inherit/override-status.**
   Categorie-default → per-item-override, met `getEffectiveSetting()`,
   "terug naar categorie" en een zichtbare "eigen instelling"-markering in
   de UI. Keyen op stabiele ID's, nooit op namen.
3. **Type ↔ instance ↔ IFC-klasse als drie lagen.** Een type is een record
   met echte velden (`{ id, name: "300x500", width: 300, height: 500,
   material }`); de instance draagt alleen `typeId` + minimale overrides;
   de IFC-klasse komt uit de bestaande categorie-registry. Labels lezen
   type-eigenschappen uit — nooit naam-parsen.
4. **Parameterschema per component** (`ParameterDefinition` met id, label,
   type, default, unit, min/max/step, options, group, order) en op termijn
   meerdere representaties per context (plattegrond/doorsnede/detail).
5. **Geversioneerde regelset-data met migratieketen** (`version` +
   migraties) vanaf de eerste opgeslagen preset, zodat latere
   uitbreidingen (arcering, Wall Systems-achtige opbouwen) oude
   instellingen nooit breken.

Bewust (nog) niet overgenomen: de dubbele wandopbouw-modellen en het
naast elkaar bestaan van platte typen en profielsjablonen — precies de
onafgemaakte dubbelingen uit Open 2D die we hier vermijden. Grids/Space/
Wall Systems zijn kandidaten voor latere fasen, niet voor dit ontwerp.

## Fasering

1. **Fundament:** datamodel regelsets + standaard-regelset; resolutie
   "welke regels gelden voor dit component op deze plek" (schaalgebied →
   tekeningtype → standaard); lijndikte per IFC-categorie toegepast in de
   templates/betonbalk; instellingenpaneel v1.
2. **Label-object:** nieuw type, koppeling, uitlezen eigenschap, migratie
   van de bestaande tags, save/reopen.
3. **Typen:** betonbalk-typelijst met typeNaam; overspanningspijl-
   parameters + label.

Elke fase: unittests, build, rig-verificatie, rooktest; geen release
zonder expliciete opdracht.
