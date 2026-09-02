# Voorstel: bouwkundige plattegronden tekenen

*Status: voorstel — nog geen code. Geschreven na een praktijkproef: een
begane grond van een woonhuis (10 x 8 m, 1:50) volledig getekend met wat de
applicatie vandaag biedt.*

---

## Wat de proef liet zien

De plattegrond kwam er. Buitenwanden in metselwerk, binnenwanden in
kalkzandsteen, drie ruimtes met naam, deuren met draaisymbool, ramen in de
gevels, maatvoering en een titel — alles met bestaande gereedschappen, in
één doorloop. De onderdelen zijn er dus.

Drie dingen kloppen bouwkundig niet, en ze hebben alle drie dezelfde
oorzaak: **de onderdelen weten niets van elkaar.**

1. **Deuren en ramen snijden geen gat in de wand.** Het kozijnsymbool wordt
   over de wand heen getekend; de arcering loopt er vrolijk achter door. Op
   1:50 zie je dat meteen. Bouwkundig hoort een sparing de wand te
   onderbreken.
2. **Een ruimte is een los kader.** Hij weet niet welke wanden hem omsluiten,
   dus hij toont geen oppervlakte en verandert niet mee als je een wand
   verplaatst. Het label staat waar je het neerzet, niet in het hart van de
   ruimte.
3. **Maatvoering is handwerk.** Je tekent hem los; hij hangt nergens aan
   vast en volgt de gevel niet als die verschuift.

Wat wél al goed werkt en het fundament vormt: wanden als objecten met
werkelijke dikte en materiaal, automatisch verstek op de hoeken (sinds
vandaag ook bij wanden die elkaar passeren), object-snapping, schaal en
schaalgebieden, en het parametrische symbolensysteem.

## Het idee in één zin

Geen nieuw tekenprogramma, maar **drie relaties toevoegen** tussen dingen
die er al zijn: een sparing hoort bij een wand, een ruimte hoort bij de
wanden eromheen, en een maatlijn hoort bij wat hij meet.

---

## Onderdeel 1 — Sparingen: kozijnen gaan ín de wand

**Wat de gebruiker doet:** deur- of raamgereedschap kiezen, over een wand
bewegen, klikken. Het kozijn springt in de wand, neemt de wanddikte over en
onderbreekt de arcering.

**Wat er technisch verandert:** een deur/raam krijgt een verwijzing naar de
wand (`wandId`) plus een positie *langs* die wand (afstand vanaf het
beginpunt) in plaats van vrije x/y. De wandrenderer kent al
`edgeCutouts()` — die opent nu al de rand waar een andere balk aansluit.
Datzelfde mechanisme krijgt er een tweede bron bij: sparingen.

Dat betekent ook: verschuif je de wand, dan schuift het kozijn mee. Maak je
de wand dikker, dan wordt het kozijn dieper. Verwijder je de wand, dan
verdwijnt het kozijn — met een waarschuwing.

**Waarom eerst:** dit is de fout die op elke tekening meteen opvalt, en het
sluit aan op machinerie die al bestaat.

## Onderdeel 2 — Ruimtes die zichzelf herkennen

**Wat de gebruiker doet:** binnen een gesloten wandcontour klikken. De ruimte
vult zich, krijgt een naam en toont zijn netto-oppervlakte.

**Wat er technisch verandert:** een vlakvulling over de wand-hartlijnen
(binnenzijden), die de omsluiting bepaalt. De ruimte bewaart geen vaste
contour maar de *zaadpositie*: bij elke hertekening wordt de omsluiting
opnieuw bepaald. Verplaats je een wand, dan verandert de oppervlakte mee —
dat is precies waar de meerwaarde zit.

Ruimtes leveren meteen hoeveelheden: de bestaande hoeveelhedenstaat kan ze
optellen per verdieping of per type. Dat is een tweede reden om dit te doen.

**Randgevallen die het ontwerp moet dekken:** een niet-gesloten contour (dan
melden, niet stilzwijgend een half vlak vullen), een deuropening zonder deur
(sparingen tellen niet als onderbreking van de omsluiting), en ruimtes die
via een vide in elkaar overlopen.

## Onderdeel 3 — Maatvoering die meebeweegt

**Wat de gebruiker doet:** een maatlijn langs een gevel trekken; de
eindpunten happen aan wandhoeken. Verschuift de gevel, dan verspringt de
maat en de tekst mee.

**Wat er technisch verandert:** de eindpunten van een maatlijn krijgen
optioneel een *anker* (objectId + welk punt). Zonder anker gedraagt de
maatlijn zich precies zoals nu — bestaande tekeningen veranderen niet.

Daarbovenop een **maatketting**: klik meerdere hoekpunten aan en krijg een
doorlopende maatlijn met tussenmaten en een totaalmaat, zoals op elke
bouwtekening.

---

## Wat het níét moet worden

- **Geen CAD-kloon.** Geen lagenbeheer, geen blokken-met-attributen, geen
  xrefs. De kracht is dat je op een PDF tekent en meteen kunt annoteren.
- **Geen 3D of IFC-export in deze stap.** De objecten dragen wel al
  IFC-categorieën, zodat dat later kán, maar het hoort niet in dit deel.
- **Geen verplichte modus.** Wie gewoon losse lijnen wil trekken, moet dat
  kunnen blijven doen. De relaties zijn een aanbod, geen dwang.

## Waar het gaat wringen

Eerlijk over de risico's:

- **Verwijzingen kunnen breken.** Een sparing wijst naar een wand die
  verdwijnt. Ontwerpregel: de verwijzing is een *hint*, nooit de enige bron
  van waarheid. Elk object moet zijn eigen geometrie kunnen tekenen als de
  verwijzing wegvalt — hetzelfde principe dat de balk-hoeken nu al volgen
  (de doelbalk wordt nooit gemuteerd).
- **Rondgang naar PDF en terug.** De relaties moeten het opslaan overleven.
  Dat betekent extra sleutels in de annotatie-dictionaries, zoals de app nu
  al doet met `OPS_Rotation` en `OPS_LinkedPath`. Een andere PDF-lezer ziet
  gewoon de getekende vorm.
- **Prestaties bij herberekening.** Een wand verplaatsen raakt sparingen,
  ruimtes en maten. Dat moet een lokale herberekening zijn, geen
  volledige hertekening van het blad.

## Voorgestelde volgorde

Elke stap levert op zichzelf iets bruikbaars op:

1. **Sparingen** — het zichtbaarste probleem, bouwt op bestaande
   randonderbrekingen.
2. **Ruimtes met oppervlakte** — grootste inhoudelijke winst, koppelt aan de
   hoeveelhedenstaat.
3. **Verankerde maatvoering en maatketting** — maakt wijzigen pijnloos.
4. **Tekenvolgorde-hulp** — een lichte begeleiding (stramien → dragende
   wanden → scheidingswanden → kozijnen → ruimtes → maatvoering), niet als
   wizard maar als volgorde in het palet.

## Wat ik nodig heb om te beginnen

Eén beslissing van jouw kant: **beginnen we bij de sparingen?** Dat is de
kleinste stap met het zichtbaarste resultaat, en hij dwingt ons meteen om de
verwijzings-vraag goed op te lossen — waarna de andere twee onderdelen
hetzelfde patroon kunnen volgen.

---

*Bijlage: de proeftekening staat als `Plattegrond-woonhuis-BG.pdf` op het
bureaublad. De drie geconstateerde tekortkomingen zijn daarin te zien bij de
ramen in de achtergevel (arcering loopt door), de ruimtelabels (geen
oppervlakte, links uitgelijnd) en de maatlijnen (los van de gevel).*
