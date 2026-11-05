# Volgorde van eigenschappensecties (#967)

De ingebouwde annotatiesecties kunnen via hun kop worden versleept. Na zes
pixels beweging verschijnt een invoegmarkering; een gewone klik blijft
inklappen. Alt+↑/↓ verplaatst de gefocuste kop langs de secties die de huidige
selectie daadwerkelijk toont. Enter en spatie klappen de sectie in of uit.
De DOM-volgorde verandert mee, zodat de tabvolgorde overeenkomt met het beeld.
Bij slepen langs de boven- of onderrand schuift het paneel automatisch.

De voorkeur `propertySectionOrder` bewaart stabiele sectie-ID's via de bestaande
voorkeurenopslag. De volledige lijst blijft bestaan bij annotatietypen die een
sectie niet tonen. Niet-verplaatste secties houden hun onderlinge volgorde.
Ongeldige of dubbele opgeslagen ID's worden genegeerd; ontbrekende ID's worden
in standaardvolgorde toegevoegd. **Sectievolgorde herstellen** herstelt alleen
de volgorde, niet de afzonderlijke voorkeur `collapsedPropSections`.

Solid behoudt de sectiecomponenten bij verplaatsen. Vergrendeling van een
annotatie blokkeert de bestaande veldbewerkingen, maar niet deze persoonlijke
paneelvoorkeur. Escape, pointercancel, verlies van pointercapture, wisselen van
selectie en loslaten buiten het paneel breken de sleepactie af. Escape wordt
hier afgehandeld zodat de algemene deselectieactie niet tegelijk afgaat.

Het documentinformatiepaneel, de vastgezette maatlijntypekeuze, de actieknoppen
en door extensies geleverde panelen behouden hun bestaande positie. Dit voegt
geen verbergen, docken, veldvolgorde of annotatiebewerking toe.

## Validatie

- `node --test js/solid/stores/property-section-order.test.mjs`: vier tests voor
  beschadigde/oudere voorkeuren, verplaatsen, verdwenen secties en reset.
- `node scripts/draai-unit-tests.mjs`: 6.772 geslaagd, 28 overgeslagen, nul fouten.
- `node scripts/property-section-order-e2e.mjs http://127.0.0.1:32867`:
  echte muisbewegingen in Chromium met een gegenereerde PDF, inklapstatus,
  vergrendelde lijn en schaalgebied, wisselen van selectie, Alt+pijlen met
  focusbehoud, klikken/spatie, Escape, buiten het paneel loslaten, selectiewissel
  tijdens slepen, herladen en reset. Dezelfde sleepcontrole faalt met het
  oorspronkelijke paneel uit upstream main: Appearance blijft onder Location.
- TypeScript, Vite-productiebouw, 24 runtime/release/vormcontroles,
  versiecontrole en `git diff --check` geslaagd.

De browsertest gebruikt een eigen Vite-server met HMR uitgeschakeld. De native
Windows-WebView en de installer zijn niet lokaal getest; de installerworkflow
van de fork is momenteel geblokkeerd. De PR blijft daarom een concept.
