# PDF-inhoud dimmen — issue 1295

Via Beeld → Zichtbaarheid elementen is de oorspronkelijke PDF-inhoud in de hoofdviewer afzonderlijk instelbaar. De hoofdschakelaar activeert desaturatie (0–100%), helderheid (25–200%) en dekking (0–100%). Dekking mengt de ondergrond met wit. Annotaties behouden hun eigen kleur en dekking. Uitschakelen bewaart de schuifwaarden; Resetten zet ook deze instellingen terug.

De instellingen horen bij het document en markeren het als gewijzigd. Opslaan schrijft versie 1 van `OPS_ContentView` in de PDF-catalogus. Open PDF Studio herstelt deze instellingen bij heropenen. Ongeldige of toekomstige versies worden genegeerd en blijven bij ongewijzigd opslaan behouden. Een late cataloguslezing overschrijft geen inmiddels aangepaste instellingen.

Dit is een schermweergave voor de hoofdviewer, zowel één pagina als doorlopend. De oorspronkelijke pagina-inhoud blijft behouden. Afdrukken, rasterexport, miniaturen, split-/vergelijkpanelen en andere PDF-lezers krijgen deze weergave niet. Formuliervelden in de hoofdviewer volgen de ondergrondfilter. De instellingen hebben een eigen reset maar nog geen undo-stap.

## Controle

- Vier unit-tests: grenzen en onbetrouwbare waarden, hoofdschakelaar, catalogus-rondgang en behoud van pagina-inhoud, ongeldige/toekomstige metadata.
- `node scripts/test-content-view-browser.mjs`: echte Solid-bediening en PDF.js-rendering. Pixelcontrole bewijst dat groene PDF-inhoud grijs wordt terwijl rode annotatiepixels gelijk blijven. Controle van schuiven, gewijzigd-status, volledige herstelmomentopname via de productiesaver en heropenen, doorlopende weergave en tabisolatie. Dit gebruikt de serializer van documentopslag; native bestandsdialogen en schijf-I/O zijn hiermee niet gekwalificeerd.
- Typecontrole, directe Vite-productiebouw, versiecontrole en runtime/release/Android-configuratietests.
- Nieuwe labels in alle 40 talen; browserregressie opgenomen in Linux-CI en unit-tests in de vaste testlijst.

De volledige testsuite blijft onderworpen aan de bestaande entry-bundelgrens van 4230 KiB. Upstream main overschrijdt die grens al; deze wijziging versoepelt de grens niet. De PR blijft concept totdat de vereiste controles, installerkwalificatie en beoordeling geslaagd zijn. De fork-installerworkflow was uitgeschakeld; er wordt geen release gepubliceerd.
