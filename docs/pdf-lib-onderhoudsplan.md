# Onderhoudsplan voor pdf-lib (#629)

Status: voorstel, november 2026. Hoort bij de Should-eis uit #629
"Replacement or maintenance plan for pdf-lib".

## Waar we staan

- De app gebruikt `pdf-lib` 1.17.1 (`open-pdf-studio/package.json`: `^1.17.1`;
  er bestaat geen nieuwere 1.x) en `@pdf-lib/fontkit` 1.1.1. Upstream wordt
  sinds medio 2024 niet meer onderhouden.
- 106 modules onder `open-pdf-studio/js` importeren `pdf-lib`; het zwaartepunt
  ligt bij het opslaan (`js/pdf/saver.js` en `js/pdf/saver/`, samen 31),
  verder de lader, PDF/A, zwartlakken en toegankelijkheid.
- Het meeste gebruik is de publieke objectlaag (`PDFDocument`, `PDFDict`,
  `PDFName.of`, `PDFRef`, `context.obj`). Dieper gaan 14 modules met
  `enumerateIndirectObjects`, 4 met `largestObjectNumber` en 1 met
  `PDFObjectParser`.
- Eigen reparaties rond pdf-lib die we al hebben, elk met tests:
  - begrensde intern-pools voor namen en referenties via een Vite-plugin
    (`scripts/pdf-lib-intern-pools.mjs`, #988, `docs/pdf-lib-intern-pools-988.md`);
  - een sneller schrijfpad voor grote sets (#581);
  - herstel van CFF-subsets en tekstcodering bij het schrijven
    (`js/pdf/saver/cff-subset-herstel.js`, `js/pdf/saver/pdf-text.js`);
  - een incrementeel opslagpad dat de bronbytes houdt (`docs/incrementeel-opslaan.md`).
- De Rust-kant gebruikt al `lopdf` 0.34 (renderer, app-crate, handtekeningen);
  het ondertekenen gebeurt helemaal in Rust (`open-pdf-signatures`), zonder pdf-lib.

## Risico's

1. Beveiligings- of parserfouten in pdf-lib worden upstream niet meer opgelost.
2. Elke eigen reparatie zit vast aan de interne opbouw van 1.17.1; een andere
   versie of fork kan de Vite-plugin of de diepere aanroepen breken.
3. Nieuwe PDF-onderdelen (bijvoorbeeld PDF 2.0-sleutels) moeten we zelf bouwen.

## Opties

| Optie | Wat | Voor | Tegen |
|---|---|---|---|
| A. Bevriezen en zelf onderhouden | Versie exact vastzetten, reparaties houden zoals nu (plugin, eigen modules). | Geen migratie; alles is al getest. | Wij dragen elke fout in pdf-lib zelf. |
| B. Overstappen op een actieve fork | Een van de drie actieve forks die in de reactie op #629 genoemd zijn (alle drie met fontkit 2). | Upstream-reparaties en modernere fontkit. | API-verschillen en andere internals; de intern-pool-plugin en de diepere aanroepen moeten opnieuw bewezen worden. |
| C. Schrijfpad naar Rust | Het opslaan stap voor stap naar `lopdf` in de app-crate, zoals het ondertekenen al doet. | Eén PDF-laag in Rust; sneller; geen JS-afhankelijkheid voor het schrijven. | Groot project; de saver telt tientallen modules. |

## Voorstel

1. **Nu (A):** `pdf-lib` exact op `1.17.1` en `@pdf-lib/fontkit` op `1.1.1`
   houden (geen ruimere range), en elke wijziging aan die versies alleen via
   de poort hieronder.
2. **Poort voor elke wissel:** de rondgangtests (34 `*rondgang*.test.mjs`),
   de annotatie-rondgang en het opslaan van een grote set uit
   `docs/release-testprotocol.md` (§1a en §4a), de intern-pool-tests
   (`scripts/pdf-lib-intern-pools.test.mjs`) en de handtekeningtests moeten
   ongewijzigd slagen.
3. **Volgende stap (B, proef):** de fork met de kleinste API-afwijking op een
   eigen tak inbouwen, de poort draaien en de verschillen vastleggen. Pas
   overstappen als de poort groen is zonder dat de reparaties hierboven
   verdwijnen of dubbel worden.
4. **Lange termijn (C):** nieuwe schrijfonderdelen eerst in Rust bouwen waar
   dat kan (zoals het ondertekenen), zodat het aandeel van pdf-lib krimpt.

Wat dit plan niet doet: de overstap zelf. Die is een eigen issue met de poort
hierboven als acceptatie.
