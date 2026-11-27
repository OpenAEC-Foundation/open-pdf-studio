# Afvlakken na vectorknipsel-opruiming (#1259)

## Probleem en oorzaak

De aangeleverde tekening bevat een blijvende `0.12 0 0 0.12 14 48 cm`
transformatie in de pagina-inhoud en 29 door de app geladen markeringen,
waaronder een vectorknipsel. Tijdens `bouwAnnotatieDocument` normaliseert
pdf-lib de tijdelijke bronpagina van dat knipsel met gedeelde `q`/`Q`-streams.
De knipselopruiming verwijderde deze streams als onbereikbare objecten, terwijl
pdf-lib hun verwijzingen in de context bewaart voor later gebruik.

Bij Flatten All werden die ontbrekende objecten vervolgens gebruikt om de
originele pagina-inhoud te isoleren. Zonder de grafische reset tekent een
tolerante PDF-lezer de appearances met de schaal en verplaatsing van de
tekening. Poppler meldt bij de gereproduceerde uitvoer een ongeldige xref en
lege pagina. De ontbrekende objecten zijn op actuele upstream main
`b2e0e51ca6cecc51c9cb4f2a9d724442347c90e6` vastgesteld.

## Aanpassing

De tussentijdse knipselopruiming behandelt de gedeelde grafische streams als
nog gebruikte objecten via de bestaande pdf-lib-contextmethoden. De definitieve
opruiming vóór het wegschrijven blijft onbereikbare objecten verwijderen.
De plaatsingsmatrix, annotatieserialisatie en de scope van PR #1257 veranderen
niet. De versievelden volgen de verplichte bump naar 2026.48.26.

## Regressie en bewijs

`js/pdf/saver/vector-snippet.test.mjs` bouwt twee pagina's met meerdere
inhoudsstromen en een blijvende CAD-transformatie, voegt een echt vectorknipsel
toe, ruimt op, vlakt af, ruimt definitief op en heropent de opgeslagen bytes.
De test controleert dat de omhullende `q`/`Q`-streams bestaan, dat de originele
inhoud behouden blijft en dat de appearances pas na de reset getekend worden.
Zonder fix faalt hij op de ontbrekende inhoudsstroom `19 0 R`.

De echte browserlader en saver verwerken daarnaast de aangeleverde PDF.
Met de fix worden alle 29 markeringen afgevlakt. Poppler rendert de uitvoer
zonder fouten; bij 1400 × 1001 pixels is deze exact gelijk aan de opgeslagen
PDF met annotaties: nul verschillende pixels. Het gebruikersbestand en de
gegenereerde PDF's worden niet aan de repository toegevoegd.

## Grenzen

Browser- en PDF-tests vervangen geen kwalificatie van de geïnstalleerde
Tauri-app. Native installerkwalificatie staat nog open. De bestaande
startupbundeloverschrijding op deze upstreambasis wordt afzonderlijk behandeld
in PR #1258; deze fix neemt die wijziging niet dubbel over. Deze PR blijft
concept zolang de benodigde controles of installerkwalificatie geblokkeerd zijn.
