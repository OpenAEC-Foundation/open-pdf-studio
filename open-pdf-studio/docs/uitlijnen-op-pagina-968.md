# Uitlijnen op pagina (#968)

In Rangschikken → Uitlijnen op zijn twee keuzes toegevoegd:
**Uitlijnen op pagina** verplaatst de selectie als groep; **Elk object op pagina
uitlijnen** lijnt de afzonderlijke markeringen uit. De keuze blijft voor de
sessie behouden. Eén geselecteerde markering is voldoende. Selectie en Laatst
geselecteerd houden hun bestaande gedrag.

Links, Midden, Rechts, Boven, Verticaal midden en Onder gebruiken de zichtbare
pagina. De maat komt uit de CropBox via PDF.js, met de PDF-/Rotate en de extra
paginarotatie. /UserUnit wordt uit de viewportmaat gedeeld om in dezelfde
pagina-eenheden als de markeringen te werken. Ook weergaverotatie wordt
meegenomen. Bij een selectie over meerdere pagina’s wordt per pagina uitgelijnd;
alle verplaatsingen vormen samen één undo-stap. Onderdelen buiten de pagina
worden op dezelfde manier behandeld, zonder verkleinen of afsnijden.

De gedeelde annotatie-omhullende omvat ook gedraaide objecten en aanhaallijnen.
De generieke verplaatsing neemt punten, gaten, endpoints en leaders samen mee.
Een selectie met vergrendelde, verborgen of tekstgebonden proefleescorrecties
wordt niet deels verplaatst. Alleen-lezen documenten worden niet gewijzigd.
Een tabwissel, gewijzigde selectie/PDF/rotatie of bewerking tijdens het ophalen
van de paginamaat annuleert de actie. Een al uitgelijnde selectie voegt geen
lege undo-stap toe.

## Verificatie

- `node --test js/annotations/page-alignment.test.mjs`: alle zes richtingen,
  vier weergaverotaties, groepen, afzonderlijke objecten en ongeldige invoer.
- `node scripts/page-alignment-e2e.mjs http://127.0.0.1:32868`: echte PDF met
  CropBox-offset, /UserUnit 2 en /Rotate 0/90/180/270. Controleert linttoegang,
  96 groepsuitlijningen, undo, afzonderlijk uitlijnen, oude referentiemodi,
  meerdere pagina’s, extra paginarotatie en beveiliging tegen verouderde acties.
- Op de oude lintcomponent faalt de browserproef doordat de paginakeuze ontbreekt.

De nieuwe tekst staat in alle 40 talen. Verpakte native WebViews en installers
zijn niet lokaal gekwalificeerd; de browserproef gebruikt een eigen context
en gegenereerde PDF-bestanden, geen gebruikersdocumenten.
