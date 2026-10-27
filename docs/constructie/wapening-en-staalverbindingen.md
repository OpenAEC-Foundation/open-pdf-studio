# Constructieve tekengereedschappen: wapening en staalverbindingen (#312)

Dit document beschrijft de gereedschappen voor wapenings- en staaldetails
uit issue #312, hoe ze samenhangen met de hoeveelhedenstaat en welke
aannames erin zitten. De gereedschappen staan in het symbolenpalet onder
**NL IFC Bouw**. Het zijn parametrische symbolen: je stelt ze in via het
eigenschappenpaneel en de assistent kan ze plaatsen via `app_create_annotation`
met `type: "parametricSymbol"`.

## Overzicht per onderdeel van het issue

| Onderdeel | Gereedschap (`symbolId`) | Status vóór #312 | Na #312 |
|---|---|---|---|
| Schedule (staat) | standaardstaten **Buigstaat** (`buigstaat`) en **Wapeningsstaat** (`wapeningsstaat`) | deels: algemene staten, stavenreeks alleen als lengte | nieuwe categorie *Wapening* met staafnummer, Ø, buigvorm, lengte, aantal, totale lengte, gewicht en staalkwaliteit |
| Wapeningsdetails | `wapeningsdetail` | deels: alleen een rechte staaf met label (`wapeningsstaaf`) | buigvormschets 00/11/21/51 met maten, staafnummer en notatie |
| Wapeningsnet | `wapeningsnet` | deels: `netwapening` als lijn met label | net op ware maat in plattegrond, beide richtingen, boven/onder |
| Parametrisch: rechthoekige balk | `wapeningskorf` | bestond (doorsnede) | telt nu mee in de buigstaat (balklengte, staafnummers, staalkwaliteit) |
| Parametrisch: vloer met vorstrand | `vloer-vorstrand` | ontbrak | doorsnede met netten, vorstrandbeugel en langsstaven |
| Stavenreeks | eigen gereedschap `stavenreeks` | bestond | telt nu mee in de buigstaat |
| Staaf in plattegrond | `staaf-plattegrond` | deels: `wapeningsstaaf` zonder verdeling | staaf met verdeellijn, haken, aantal uit de verdeling |
| Kopplaat bij ligger | `kopplaat` | ontbrak | zij- en kopaanzicht op ware maat, met boutpatroon |
| Voetplaat bij staalprofiel | `voetplaat` | ontbrak | boven- en zijaanzicht op ware maat, met ankers |
| Bout in plattegrond/aanzicht | `bout` | bestond (aanzichten bout, doorsteekbout, plattegrond, moer, zeskant) | ongewijzigd; de boutmaten worden nu ook door kopplaat en voetplaat gebruikt |

## Notatie

De notatie volgt de gangbare Nederlandse schrijfwijze:

- `12Ø10-150`: 12 staven Ø10 hart-op-hart 150 mm;
- `4Ø12`: 4 staven Ø12;
- `Ø8-150`: staven Ø8 h.o.h. 150 (zonder aantal, zoals bij netten);
- `lg=2450`: de staaflengte (ontwikkelde lengte) in mm;
- het staafnummer staat in een cirkel;
- het diameterteken wordt als vector getekend (cirkel met steile streep en twee
  vlaggetjes), net als bij de stavenreeks en de wapeningskorf. Daardoor is het
  teken ook in andere PDF-lezers zichtbaar, onafhankelijk van het lettertype.

De rekenkern staat in `open-pdf-studio/js/quantities/wapening.js`. De
symbolen en de staat gebruiken dezelfde functies, zodat het getal op de
tekening en het getal in de staat altijd gelijk zijn.

## Buigvormen en staaflengte

De vormcodes volgen het nummerprincipe van NEN-EN ISO 3766: het eerste cijfer
is het aantal bochten. Het gereedschap kent de vormen die in de praktijk het
meest voorkomen:

| Code | Vorm | Maten |
|---|---|---|
| 00 | recht | a |
| 11 | haakstaaf (L, één bocht van 90°) | a, b |
| 21 | U-staaf (twee bochten van 90°) | a (been), b (basis), c (been) |
| 51 | gesloten beugel met twee haken van 135° | a (breedte), b (hoogte) |

Aannames voor de lengte:

- Alle maten zijn **buitenmaten**, zoals op een buigstaat.
- De **doorndiameter** volgt NEN-EN 1992-1-1 tabel 8.1N: 4Ø bij Ø ≤ 16 en 7Ø
  bij Ø > 16.
- De **aftrek per bocht van 90°** is `2(r + d) − π/2 · (r + d/2)`, met
  r = halve doorndiameter en d = staafdiameter (lengte over de hartlijn van de
  staaf).
- Een **gesloten beugel** (51) loopt rond de vier zijden, heeft drie hoeken van
  90° en twee haken van 135° in dezelfde hoek. De rechte verlenging van een
  haak is standaard 10Ø (instelbaar). Dat is ruimer dan het EC2-minimum van 5Ø
  en 50 mm, zoals gebruikelijk bij beugels.
- De staaflengte wordt naar boven afgerond op 5 mm.

## Gewicht

Massa per meter = `0,00617 · d²` kg/m (d in mm). Dat is de afgeronde waarde van
π/4 · 7850 kg/m³. Totale lengte = aantal × staaflengte; gewicht = totale lengte ×
massa per meter.

## Staalkwaliteit

Standaard **B500B** voor staven en beugels en **B500A** voor netten (koud
vervormd, gangbaar bij standaardnetten). B500A, B500B en B500C zijn te kiezen.

## Buigstaat en wapeningsstaat

De categorie *Wapening* in de hoeveelheden verzamelt staven uit:

- stavenreeksen (aantal, diameter, staaflengte; vorm 00);
- wapeningsstaven (`wapeningsstaaf`: aantal × lengte; vorm 00);
- de nieuwe symbolen en de wapeningskorf, via `rebarItems(params)` op het
  template.

Gelijke staven (zelfde staafnummer, Ø, vorm, lengte en kwaliteit) worden één
regel en hun aantallen tellen op, ook over meerdere pagina's. Een staaf zonder
staafnummer krijgt een automatisch nummer, aansluitend op het hoogste
handmatige nummer. Gelijke staven delen dat nummer. Krijgen twee verschillende
staven hetzelfde nummer, dan wordt die regel als conflict gemarkeerd
(`conflict: true` in `buigstaatRegels`).

- **Buigstaat** (`buigstaat`): één regel per staafnummer met Ø, vorm, lengte,
  aantal, totale lengte, gewicht en staalkwaliteit. Onderaan staan de
  totaal-lengte en het totaalgewicht.
- **Wapeningsstaat** (`wapeningsstaat`): gegroepeerd per Ø met de massa per
  meter en de subtotalen van aantal, lengte en gewicht.

De kolommen Ø, staaflengte en massa per meter worden niet opgeteld. De staten
zijn te kiezen in het staten-paneel, als CSV te exporteren en via MCP te
plaatsen (`app_place_schedule` met `templateId: "buigstaat"` of
`"wapeningsstaat"`). `app_get_takeoff` geeft de totalen terug.

Wat níet in de staat komt:

- de netten die in het detail *vloer met vorstrand* getekend zijn. Die tel je
  met het gereedschap *Wapeningsnet*, anders zouden ze dubbel meetellen;
- `netwapening` (de oudere lijnweergave): die heeft geen aantal;
- een wapeningskorf zonder balklengte (de standaard is 0, zodat bestaande
  tekeningen niet ineens in de staat verschijnen).

## Wapeningsnet

Het net wordt op ware maat (lengte × breedte) getekend met één diagonaal,
de Nederlandse tekenwijze. Rond het label is de diagonaal onderbroken. Een
bovennet wordt gestreept getekend, een ondernet doorgetrokken. Het label luidt
`Ø8-150/Ø8-150` (lengterichting/breedterichting), met daaronder de netmaat,
de laag en de kwaliteit.

Staafaantallen: in de lengterichting `breedte / h.o.h. + 1` staven van de
netlengte, in de breedterichting `lengte / h.o.h. + 1` staven van de
netbreedte, maal het aantal netten. Overstekende staafeinden en overlappen
worden niet apart gerekend.

## Staaf in plattegrond

Eén representatieve staaf op ware lengte, met een verdeellijn loodrecht erop
over de verdeelbreedte en schuine eindstreepjes. Omgezette einden worden als
kort been getekend. Het aantal is `verdeelbreedte / h.o.h. + 1`, tenzij je een
vast aantal opgeeft. De vorm volgt uit de haken: geen → 00, één → 11,
beide → 21.

## Vloer met vorstrand

Doorsnede over de vloerrand op ware maat: de vloer met breeklijn, de verdiepte
rand, het onder- en/of bovennet (lijn met de dwarsstaven als stippen), de
gesloten beugel en de langsstaven (verdeeld over boven en onder), staafnummers
met aanwijslijn, maatvoering en een legenda. Voor de staat geldt een
randlengte (standaard 10 m):

- langsstaven: lengte = randlengte − 2 × dekking;
- beugels: aantal = (randlengte − 2 × dekking) / h.o.h. + 1, buitenmaat =
  vorstranddoorsnede − 2 × dekking.

De standaarddekking is 40 mm: gestort op een voorbereide ondergrond, conform
NEN-EN 1992-1-1 4.4.1.3(4). Bij storten direct tegen de grond is 75 mm nodig;
pas de waarde dan aan.

## Kopplaat bij ligger

- Plaatbreedte = flensbreedte (of opgegeven), plaathoogte = profielhoogte +
  2 × overstek.
- Gatdiameter d0 = d + 2 mm (t/m M24).
- Automatische randafstand e2 = 1,5 · d0 (afgerond op 5 mm). Automatische
  e1 = midden van het overstek als daar een boutrij past (overstek ≥ 2,4 · d0),
  anders net onder de flens (overstek + tf + 1,5 · d0).
- De boutrijen worden gelijkmatig verdeeld; er zijn twee boutkolommen.
- `kopplaatGeometrie().controle` toetst e1, e2 ≥ 1,2 · d0; p1 ≥ 2,2 · d0 en
  p2 ≥ 2,4 · d0 (NEN-EN 1993-1-8 tabel 3.3). Het symbool tekent de verbinding
  ook als die toets faalt. Het is een tekenhulp, geen sterkteberekening.
- Zijaanzicht: liggereinde met breeklijn, kopplaat, hoeklassen aan de flenzen,
  bouten met moer en hartlijn. Kopaanzicht: plaat, profieldoorsnede en gaten
  met hartkruis.

## Voetplaat bij staalprofiel

- Automatische plaatmaat: profiel + 2 × max(3 · d0, 60 mm) in beide richtingen,
  afgerond op 10 mm. Automatische ankerrandafstand e = 1,5 · d0.
- 2 ankers (op de lijfas), 4 (hoeken) of 6 (hoeken + midden).
- Bovenaanzicht: plaat, kolomdoorsnede (massief), hartlijnen, ankergaten met
  ring en hartkruis. Zijaanzicht: kolom met breeklijn, voetplaat, ondersabeling
  (gestreept), bovenkant fundering met arcering, hoeklassen, ankers met moer en
  ring. De ankerlengte in de fundering is gestreept (verborgen).

## Opslaan en uitwisseling

Alle symbolen zijn `parametricSymbol`-annotaties. Ze worden opgeslagen als
/Square met `OPS_SymbolId`/`OPS_Params` en een appearance, en komen bij het
heropenen met dezelfde parameters terug. De test
`js/pdf/wapening-rondgang.test.mjs` controleert dat, en ook dat de buigstaat
van het heropende bestand gelijk is.

IFC-klassen: wapeningsdetails, staaf in plattegrond en vloer met vorstrand →
`IfcReinforcingBar`; wapeningsnet → `IfcReinforcingMesh`; kopplaat en
voetplaat → `IfcPlate`.

## Bekende beperkingen

- De buigvormen beperken zich tot 00, 11, 21 en 51. Kropstaven, spiralen en
  vormen met schuine bochten ontbreken nog.
- De teksten op de tekening (labels, legenda) zijn Nederlandse vaktermen
  (`lg=`, `bgls`, `net`, `onder`/`boven`, `kopplaat`, `voetplaat`). Dat is de
  bedoelde tekenwijze. De velden in het eigenschappenpaneel zijn tweetalig
  NL/EN, zoals bij de andere parametrische symbolen. De staat-kolommen zijn in
  alle talen vertaald.
- Overlappingslengtes, verankeringslengtes en de sterkte van verbindingen
  worden niet berekend.
