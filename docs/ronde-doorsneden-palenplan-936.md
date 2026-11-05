# Ronde doorsneden, paalposities en overspanningsrichting (#936)

De bibliotheek **NL IFC Bouw** bevat vijf extra parametrische symbolen:

- **CHS (ronde buis)**: diameter en wanddikte uit de maatkeuze; doorsnede,
  boven- en zijaanzicht, schaalfactor en hartlijnen. Wisselen van/naar de
  bestaande staalprofielen behoudt positie en stijl en kiest de dichtstbijzijnde
  profielhoogte. De bestaande catalogusrenderer tekent de holle doorsnede.
- **Beton rond** en **Hout rond**: instelbare diameter in millimeters, schaalfactor,
  materiaalvulling en optioneel maatlabel. Hout gebruikt de bestaande houtsoorten.
- **Paalpositie (palenplan)**: vrij schaalbaar cirkel/kruis met bewerkbaar
  paalnummer. Het middelpunt is het plaatsings- en aangrijppunt. Nummer en
  marker blijven binnen het kader voor de opgeslagen PDF-weergave.
- **Overspanningsrichting vloer (⥋)**: linkerpunt omlaag en rechterpunt omhoog,
  opgebouwd uit lijnen. Het bestaande dubbele pijlsymbool blijft beschikbaar.

De doorsneden volgen de bestaande tekenschaal. Het paalpositiesymbool is een
schematische markering, geen fysieke paaldiameter. Ronde doorsneden vallen onder
IfcMember; de gebruiker kan de IFC-categorie aanpassen, bijvoorbeeld naar
IfcPile voor een funderingspaal. De paalpositie heeft standaard IfcPile.
De maatkeuzes zijn tekengeometrie, geen draagkrachtberekening of normcertificaat.

Het houten balkaanzicht uit dezelfde wens staat afzonderlijk in PR #940. Deze
wijziging raakt die implementatie niet en sluit #936 daarom niet zelfstandig.
De nieuwe labels volgen het bestaande tweetalige NL/EN-sjabloonformaat; er zijn
geen nieuwe i18next-sleutels.

## Controle

- `node --test js/symbols/templates/ronde-doorsneden.test.mjs js/symbols/profieltype.test.mjs`
  controleert bibliotheekkoppeling, geometrie, holte/wanddikte, materiaalkleur,
  schaal, aangrijppunten, IFC-categorie, profielwisseling en echte PDF-opslag/heropening.
  Zonder de nieuwe registraties falen de zeven nieuwe sjabloontests.
- De bestaande pictogramtest verwacht nu 58 in plaats van 53 symbolen; de
  controles op unieke pictogrammen en geldige SVG-stijl blijven actief.
- `node scripts/round-sections-e2e.mjs http://127.0.0.1:32836 /tmp/opds-936-round-browser`
  draait tegen een afzonderlijke Vite-server met HMR uit. Klikt alle vijf
  bibliotheekknoppen aan, controleert echte canvaspixels (ook de holle CHS-kern),
  roteert hout en slaat een PDF met vijf daadwerkelijke appearances op.
- Volledige unit-tests, TypeScript, productiebuild, versieconsistentie en
  projectcontroles horen bij de PR-validatie. De browsertest gebruikt Chromium;
  een handmatige Tauri-desktoptest en installerkwalificatie zijn afzonderlijke stappen.

Installers worden via de voorgeschreven forkworkflow aangevraagd. Bij uitgeschakelde
Actions blijft de PR concept; de bijbehorende release blijft ongepubliceerd concept.
