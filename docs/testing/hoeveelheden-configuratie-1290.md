# Hoeveelhedeninstellingen als bestand (#1290)

## Gebruik

Open Annotaties → Hoeveelheden → Eigenschappen. Met **Exporteren** wordt de huidige configuratie bewaard als `quantities.opds-quantities`. Op de desktop kan in de bestandsdialoog een andere naam worden gekozen; in de browser wordt het bestand gedownload. Bewaar verschillende bestanden voor verschillende berekeningen.

Met **Importeren** wordt een eerder geëxporteerd bestand gekozen. Het vervangt de configuratie van het hoeveelhedenvenster. Categorieën, veldvolgorde, filters, sorteren/groeperen, afzonderlijke regels, eindtotalen, kolomopmaak en weergave worden hersteld. De waarden worden opnieuw uit het huidige document berekend. Het bestand bevat geen PDF, annotaties, documentpaden, berekende rijen of tekst uit de PDF.

Dit biedt de in het issue gevraagde afzonderlijke bestanden. Het voegt geen automatische opslag per PDF toe. De bestaande benoemde staten in het zijpaneel blijven een afzonderlijke functie.

## Implementatie en controles

- Een versiegebonden JSON-formaat met type `open-pdf-studio/quantities`, versie 1. Import accepteert ook een UTF-8-BOM.
- De gehele definitie wordt gecontroleerd vóórdat live instellingen veranderen. Niet-ondersteunde versies, verkeerde velden/types/operators en te grote bestanden worden geweigerd. Geen gedeeltelijke import.
- Instellingen worden samen toegepast met een Solid-batch. Ingebouwde PDF-tekst wordt niet uit het bestand hersteld maar, indien geselecteerd, opnieuw opgevraagd.
- Knoppen gebruiken de bestaande platformbestandsdialogen en byte-I/O. Annuleren wijzigt niets; lees-/schrijffouten geven een melding. De twee nieuwe meldingen zijn toegevoegd in alle 40 talen.
- `node --test js/solid/stores/quantities-config-file.test.mjs js/solid/stores/quantitiesStore.test.mjs`: negen tests slagen. Deze controleren alle instellingen, dezelfde gefilterde/gegroepeerde uitkomst na import, ontbrekende gedeelde referenties, ongeldige invoer zonder wijzigingen en lege selecties.
- `node scripts/test-quantities-config-browser.mjs`: export via de echte knop/download, app herladen, import via de echte bestandskiezer en controle van het eenheidsveld. Ook een toekomstig bestandsformaat, geannuleerde desktopdialoog en schrijffout worden gecontroleerd. De desktop-I/O gebruikt gecontroleerde mocks; dit kwalificeert geen geïnstalleerde Tauri-app. De browsertest is opgenomen in Linux CI.

## Oplevering

Versie 2026.48.40 volgt de repository-instructies. De installerworkflow wordt na push geprobeerd; de fork heeft momenteel Actions uitgeschakeld. Geen release publiceren. Verplichte upstreamreview en installerkwalificatie blijven nodig voordat de concept-PR gereed is.

## Projectcontroles

Volledige unitset: 9129 geslaagd, 41 overgeslagen, één fout in de entry-bundelcontrole: 4244,5 KiB tegenover 4230 KiB. De hoofdtak zit al op 4241,1 KiB; deze functie voegt frontendcode toe. De grens is niet verhoogd. De expliciete budgettest na de build geeft dezelfde fout; afzonderlijk vervolgwerk staat in PR #1258.

TypeScript, 34 runtime/release/Android-configuratietests, versieconsistentie en whitespacecontrole slagen. Alle 40 taalbestanden hebben de nieuwe foutmeldingen. De productiefrontend via directe Vite-build slaagt; native prebuild en installers zijn hiermee niet getest.
