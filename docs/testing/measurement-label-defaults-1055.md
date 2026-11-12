# Meetlabels vóór plaatsing (#1055)

Het bestaande eigenschappenpaneel kon bij een actief meetgereedschap een
Onderwerp (Subject) of, voor een meetvlak, Naam (Name) tonen en wijzigen. Het
paneel bewaarde die invoer alleen op zijn tijdelijke voorbeeldannotatie. De
standaardstijl schrijft deze inhoudsvelden niet weg; bij de volgende meting
of gereedschapswissel waren ze dus verdwenen.

De fix bewaart deze velden direct als afzonderlijke voorkeuren per meetsoort.
Een nieuw getekende annotatie krijgt ze via de aanmaakroute voor gereedschappen.
Het algemene onderwerp geldt voor afstand, omtrek, oppervlakte en hoek; de
zichtbare vlaknaam geldt alleen voor oppervlakte. Het paneel leest dezelfde
voorkeuren terug. Leegmaken wist de standaard voor volgende metingen.

Labels zijn geen stijl: standaardstijl toepassen op een bestaande meting
hernoemt die niet. De algemene annotatiefactory, PDF-loader en kloonroute
blijven hetzelfde. Expliciet meegegeven labels winnen van de standaard.
Berekende maattekst, schaal, eenheid en meetwaarde worden niet aangepast.
Deze fix introduceert geen vrije vervanging van de berekende afstandstekst.

## Controleren

1. Open een PDF en kies Afstand meten.
2. Vul vóór het tekenen bij Algemeen → Onderwerp `Wall A` in.
3. Wissel naar Selecteren en terug. Het onderwerp blijft staan.
4. Plaats een maatlijn met drie klikken. De nieuwe maatlijn heeft `Wall A`
   als onderwerp; de maatwaarde blijft berekend.
5. Kies Oppervlakte meten en vul bij Meting → Naam `Kitchen` in.
6. Het volgende meetvlak krijgt die naam. Wissel van gereedschap en terug:
   de naam blijft staan. Wis de naam: volgende vlakken blijven naamloos.

## Testbewijs

Vanuit `open-pdf-studio`:

- `node scripts/test-measurement-label-browser.mjs`: echte Solid-invoervelden,
  PDF.js-document en maatlijn met drie muisklikken; gereedschapswissel,
  vlakaanmaak, opgeslagen voorkeuren en leegmaken.
- `node --test js/core/measurement-label-defaults.test.mjs`: zeven nieuwe
  gedragstests met de echte eigenschappenstore, voorkeuren en makers.
- Op oorspronkelijke upstream-code falen de vier onderwerptests (`''` in
  plaats van `Wall A`) en de vlaknaamtest (`undefined` in plaats van `Kitchen`).
  De overige twee nieuwe tests gebruiken de nieuw toegevoegde toolfactory.
- 36 gerichte regressietests geslaagd: labels, standaardstijlen, meetvlakken,
  gereedschapssets, maattekst, diepteberekeningen en PDF-maatobjecten.
- 59 projectcontroles voor versievelden, native runtime, releases, Linux en
  beelden geslaagd; TypeScript-controle geslaagd.
- Productie-Vite-bouw en de vereiste installerdispatch staan in de PR vermeld.

Versie 2026.46.27. Browsertest op Chromium; validatie in een geïnstalleerde
Tauri-WebView blijft onderdeel van de installerkwalificatie.
Chat-ID: 01a109f0-a849-7782-8641-0b091eb29747.
