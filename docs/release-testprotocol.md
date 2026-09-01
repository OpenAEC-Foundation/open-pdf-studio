# Release-testprotocol

Verplichte volgorde vóór elke release (tag/push/publicatie). Alle stappen
moeten GOED zijn; bij een MISLUKT eerst de oorzaak vaststellen en oplossen —
niet de test versoepelen.

Voorwaarden: de MCP-testrig draait (`--mcp-server`, MCP-poort 9223,
CDP-poort via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`;
de vergelijkings-sweep verwacht CDP op 9222). Vite-dev-server vers gestart
(een herstart van Vite breekt draaiende vensters — herstart die daarna ook).

## 1. Unit-tests

```bash
cd open-pdf-studio && npm run test:unit
```

## 2. Functionele poorten (rig)

| Poort | Script | Dekt |
| --- | --- | --- |
| Tekstrotatie | `node scripts/verify-tekstrotatie.mjs` | referentie-fixture, extern aangemaakt bestand, eigen opslag-rondgang |
| Plaatsing onder cursor | `node scripts/verify-plaatsing-cursor.mjs` | maatlijn op zoom 1/2/3.52, afwijking ≤ 1,5 pt |
| Doorlopende weergave | `node scripts/verify-doorlopend-inkt.mjs` | zichtbaar beeld op zoom 75/100/150/250% |
| Snelzoom | `node scripts/verify-snelzoom.mjs` | anker houdt bij snelle zoomreeksen |
| Opslag-rondgang | `node scripts/verify-opslag-rondgang.mjs` | opslaan → heropenen zonder verlies |
| Opslag-duplicaten | `node scripts/verify-opslag-duplicaten.mjs` | geen verdubbeling bij opslaan of sluiten-met-opslaan |

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
