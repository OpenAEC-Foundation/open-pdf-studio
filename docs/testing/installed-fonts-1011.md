# Geïnstalleerde lettertypen (#1011)

De eigenschappenlijst controleerde alleen een vaste lijst met familienamen.
BIZ UDGothic stond daar niet in en bleef daardoor onzichtbaar, ook wanneer
Windows het lettertype al had geïnstalleerd. Alleen de namenlijst uitbreiden
zou hetzelfde probleem laten bestaan voor andere gebruikerslettertypen.

De desktop-app vraagt nu de OS-catalogus op via DirectWrite (`dwrote` 0.11.5) op Windows en font-kit 0.14.3
voor CoreText op macOS en Fontconfig op Linux. Windows vraagt expliciet een
actuele catalogus op (`get_system(true)`); de standaardaanroep met `false`
kan volgens Microsoft nog een oude fontcache teruggeven na installatie. De opdracht
`list_installed_font_families` draait buiten de UI-thread. Alleen familienamen
gaan naar de frontend; geen fontbestanden, willekeurige paden of fontbytes.
De frontend deelt één asynchrone aanvraag en bewaart tijdens die aanvraag
al gevonden documentfonts. OS-namen worden niet opnieuw met Latijnse tekst
gefilterd: die meting kan CJK-fonts of metrisch gelijke fonts missen.

In een browser, op mobiele platforms of bij een oudere/defecte native backend
blijft de bestaande canvasdetectie en haar terugval beschikbaar. Er wordt
geen browsertoestemming voor lokale fonts gevraagd.

## Reproduceren en controleren

Vanuit `open-pdf-studio`:

```sh
node --test js/utils/lettertypen-lijst.test.mjs
cargo build --locked --manifest-path scripts/font-native-tests/Cargo.toml
python3 scripts/font-native-tests/run.py scripts/font-native-tests/target/debug/font-catalogue-probe /tmp/fonts.json
OPDS_FONT_CATALOGUE_JSON=/tmp/fonts.json node scripts/test-installed-fonts-browser.mjs
```

De kleine native probe compileert dezelfde Rust-functie als de app. Een eigen
TTF en een TTC met twee families (waaronder een Japanse naam) bewijzen dat de
catalogus geen vaste namenlijst of alleen het eerste collectiegezicht gebruikt.
De fixtures bevatten uitsluitend synthetische rechthoekige glyphs; bron en
generator (`fonttools==4.60.1`) staan erbij. Linux gebruikt een tijdelijke,
geïsoleerde Fontconfig-configuratie. Windows en macOS registreren de fixtures
uitsluitend op een wegwerp-GitHub-runner, met opruimen in `finally`.

De Chromium-test voert de echte Solid-eigenschappenlijst en de echte
annotatiestore uit. De IPC-grens ontvangt de uitvoer van de native probe.
De test kiest alle drie families, controleert het annotatiemodel en heropenen,
controleert één gedeelde native aanvraag en behoud van een documentfont tijdens
een vertraagde aanvraag. Een oudere backend blijft bruikbaar.

De oorspronkelijke `fonts.js` kan zonder werkboomwijzigingen worden getest:

```sh
git show 270313292:open-pdf-studio/js/utils/fonts.js > /tmp/fonts-before.js
OPDS_FONT_BASELINE_SOURCE=/tmp/fonts-before.js OPDS_FONT_CATALOGUE_JSON=/tmp/fonts.json node scripts/test-installed-fonts-browser.mjs
```

Dit faalt omdat de oude code de native catalogus helemaal niet opvraagt.
De normale productieconfiguratie bevat deze testoverride niet.

## Afbakening

Installeer gewenste fonts via het besturingssysteem en herstart de app. Deze
wijziging implementeert **geen** eigen `Program Files/Open PDF Studio/fonts`
map of runtime-import. Issue #1011 blijft daarom open voor die resterende wens.
Fontinsluiting en overdraagbare weergave na PDF-export horen bij het afzonderlijk
opgepakte issue #1020; de bestaande melding over niet-ingesloten fonts blijft.
Er is geen handmatige test op een Japanse Windows-installatie met de oorspronkelijke
BIZ-UDGothicR.ttc of een verpakte desktopinstaller geclaimd. De native matrix
controleert de drie desktopcatalogi; de UI-test gebruikt Chromium met een IPC-stub.
