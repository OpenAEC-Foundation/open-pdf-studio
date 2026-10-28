# Release-testprotocol

Verplichte volgorde vóór elke release (tag/push/publicatie). Alle stappen
moeten GOED zijn; bij een MISLUKT eerst de oorzaak vaststellen en oplossen —
niet de test versoepelen.

Voorwaarden: de MCP-testrig draait (`--mcp-server`, MCP-poort 9223,
CDP-poort via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`;
de vergelijkings-sweep verwacht CDP op 9222). Vite-dev-server vers gestart
(een herstart van Vite breekt draaiende vensters — herstart die daarna ook).

Start elke testinstantie headless: `OPDS_HEADLESS=1` naast `OPDS_DETACHED=1`
(of `--mcp-server`). Het venster staat dan buiten elke monitor, heeft geen
taakbalkknop, pakt nooit de focus en native dialogen worden geweigerd met een
logregel (`[headless] … suppressed`); renderen, MCP en CDP-schermafdrukken
werken gewoon. `OPDS_HEADLESS_SIZE=BxH` (standaard `1200x800`) zet de
vaste binnenmaat. Een gewone start zonder `--mcp-server`/`OPDS_DETACHED=1`
negeert de variabele. Zie `open-pdf-studio/src-tauri/src/headless.rs`.

## 1. Unit-tests

```bash
cd open-pdf-studio && npm run test:unit
```

## 1a. Annotatie-rondgang (#629)

```bash
cd open-pdf-studio && node --test js/pdf/rondgang-alle-soorten.test.mjs
```

Zit ook in stap 1, maar wordt bij elke release apart nagekeken en in het
releaseverslag genoemd. Eén bestand met elke annotatiesoort die een
markeringswerkstroom in de bouw maakt (ook antwoorden, groepen,
statusgeschiedenis, lagen, eigen sleutels van andere programma's en tekst
met ( ) \ € ² ° ± Ø, emoji, CJK en rechts-naar-links), geladen en opgeslagen
met de echte lader en saver:

- zonder bewerking komt elk annotatiewoordenboek sleutel voor sleutel terug;
- verplaatsen, een andere auteur, een andere kleur of een andere reviewstatus
  verandert alleen die ene annotatie, en alleen wat bij die bewerking hoort;
- de soort (/Subtype) en de bedoeling (/IT) veranderen nooit;
- opslaan → heropenen → opslaan verandert niets meer.

Een overgeslagen geval in die test (`skip`) noemt waarom; zo'n geval hoort in
het releaseverslag. Daarnaast met de hand: open een paar echte
tekeningensets met markeringen uit andere programma's, sla op zonder te
bewerken en vergelijk het aantal annotaties en hun /NM, /Subj, /IRT en
/State voor en na (bijvoorbeeld met een pdf-lib-scriptje). Een verschil
blokkeert de release.

## 2. Functionele poorten (rig)

| Poort | Script | Dekt |
| --- | --- | --- |
| Tekstrotatie | `node scripts/verify-tekstrotatie.mjs` | referentie-fixture, extern aangemaakt bestand, eigen opslag-rondgang |
| Plaatsing onder cursor | `node scripts/verify-plaatsing-cursor.mjs` | maatlijn op zoom 1/2/3.52, afwijking ≤ 1,5 pt |
| Doorlopende weergave | `node scripts/verify-doorlopend-inkt.mjs` | zichtbaar beeld op zoom 75/100/150/250% |
| Snelzoom | `node scripts/verify-snelzoom.mjs` | anker houdt bij snelle zoomreeksen |
| Opslag-rondgang | `node scripts/verify-opslag-rondgang.mjs` | opslaan → heropenen zonder verlies |
| Opslag-duplicaten | `node scripts/verify-opslag-duplicaten.mjs` | geen verdubbeling bij opslaan of sluiten-met-opslaan |
| Zoeken | `node scripts/verify-zoeken.mjs` | markeringen liggen op het woord (≤ 2 px) in enkele pagina, doorlopend en vectormodus, op zoom 50/100/175 %, na zoom- en weergavewissels, bij /Rotate 90/180/270 en een MediaBox met oorsprong ≠ 0; "x van N", volgende/vorige, de bronvinkjes Tekst/Annotaties en de resultatenlijst per pagina |

## 3. Vergelijkings-sweep (bij render-/saver-/rotatie-wijzigingen verplicht)

```bash
node scripts/verify-mupdf-compare.mjs
```

Pagina-voor-pagina vergelijking van de rig-weergave met een onafhankelijke
referentie-render. Gevlagde pagina's handmatig beoordelen (echte bug /
meetartefact / bestandseigenaardigheid) en het oordeel noteren.

## 4. Prestatievergelijking met de vorige release

```bash
node scripts/verify-prestaties.mjs "<exe-vorige-release>" "vX.Y" "<exe-nieuwe-build>" "vX.Z"
```

Meet per bestandsklasse (licht / middel / annotatierijk / zwaar): app-start,
openen tot eerste inkt, zoomen naar 200% en volgende pagina; mediaan van 3
runs per meting, beide builds als échte release-build (installer of
uitgepakte bundel), op een verder rustige machine. Harde grens: een meting
die meer dan 2x zo traag is als de vorige release (én > 1 s langzamer) blokkeert
de release; kleinere verschuivingen in het releaseverslag vermelden.

## 5. Installer-verificatie

1. Bouw de installer (CI of lokaal met `CARGO_TARGET_DIR` buiten
   OneDrive-paden; exit-code 1 door alleen updater-signing is acceptabel,
   het NSIS-artefact telt).
2. Installeer stil (PowerShell: `Start-Process <setup.exe> -ArgumentList '/S'`).
3. Start de geïnstalleerde build en draai minimaal de poorten 2 (kolom
   tekstrotatie + doorlopende weergave) ertegen, of controleer visueel:
   annotaties zichtbaar en scherp, tekstrotaties intact, doorlopende modus
   zonder witte pagina's.

## 6. Visuele eindcontrole

Zelf kijken (screenshots van de rig of de geïnstalleerde build bekijken, niet
alleen pixels tellen): een zwaar A0-blad in beide weergavemodi, in- en
uitzoomen, moduswissel enkel↔doorlopend, annotaties op de juiste plek.

## Vastgelegde valkuilen

- Een Vite-herstart maakt draaiende vensters kapot (module-URL's verschuiven);
  herstart daarna álle app-instanties, en geef elk dev-venster een opgehoogd
  volgnummer (`dev-build-nr.json`).
- Zware achtergrondtaken (sweep, cargo-build) op `BelowNormal`-prioriteit
  draaien zodat interactief testen bruikbaar blijft; prestatiemetingen juist
  op een rustige machine.
- Sommige bestanden rastert de render-engine bewust wit (ook in de
  onafhankelijke referentie); die horen niet in de inkt-poortlijst.
