# Stifttekening deel 1 (stiften en legenda): implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Doel:** In Open PDF Studio constructieve stiften tekenen die naar definities in het document verwijzen, met een legenda per plattegrond die zichzelf bijwerkt, een vectorweergave in de PDF, en IFC-categorieën en hoeveelheden per definitie.

**Architectuur:**
- **Pure modules** onder `js/annotations/stift/`, onder `node --test` te testen:
  - `definities.js`: soorten, startset, validatie;
  - `tekenopdrachten.js`: één bouwer voor canvas én PDF;
  - `geometrie.js`: afbeelding op bestaande geometriesoorten;
  - `legenda.js`: regels, indeling, opdrachten;
  - `document.js`: definities per document.
- **Uitvoerders:** `stift-draw.js` voert de opdrachten uit op het canvas, `stift-ap.js` zet ze om naar een appearance stream.
- **Geometrie via bestaande vormen:** een stift gebruikt per tekenwijze de velden van een bestaande vorm:
  - lijn als `polyline`;
  - pijl als `line`;
  - kruis als `box`;
  - punt als een eigen `stiftPunt`.

  Raken, grepen, vervormen, omhullende, snappen en paginarotatie hergebruiken daardoor de bestaande code via `geometrieSoort(ann)`.

**Tech stack:** vanilla JS en SolidJS (JSX), pdf-lib (PDF schrijven en Helvetica-breedtes), pdf.js (inlezen), `node --test`, Tauri 2 en PDFium voor de app zelf.

**Spec:** `docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md`.

## Global Constraints

**Werkplek**
- Werk op branch `feat/stifttekening`. De app staat in de submap `open-pdf-studio/`; alle paden hieronder zijn relatief daaraan, tenzij ze met `docs/` beginnen of uitdrukkelijk in de repo-root staan (`scripts/verify-stift.mjs` in taak 15).

**Tests en controles**
- Nieuwe testbestanden gaan in het script `"test:unit"` van `open-pdf-studio/package.json`, nooit in `"test:web-unit"`.
- Voeg ze toe direct achter `js/tools/snap-extractie-beleid.test.mjs`:
  ```bash
  node -e "const fs=require('fs');const raw=fs.readFileSync('package.json','utf8');const pkg=JSON.parse(raw);const u=pkg.scripts['test:unit'];const a='js/tools/snap-extractie-beleid.test.mjs';const n=u.replace(a,a+' PAD');fs.writeFileSync('package.json',raw.replace(JSON.stringify(u).slice(1,-1),JSON.stringify(n).slice(1,-1)))"
  ```
  Vervang `PAD` door het testpad en controleer daarna dat het pad in `test:unit` staat.
- Na elke taak draaien `npm run test:unit`, `npx tsc --noEmit` en `npx vite build`. `node --check` is niet genoeg: dat leest `js/` als CommonJS en mist ES-fouten.

**Commits en teksten**
- Commits in het Engels, zonder Claude- of Anthropic-vermelding.
- Nergens namen van commerciële software.
- Commentaar in de code is Nederlands, zoals in de rest van `js/`.

**UI volgens `CLAUDE.md`**
- Standaardcursor buiten het PDF-gebied, Windows-Forms-stijl, geen afgeronde hoeken, geen animaties.
- Modale vensters zijn verplaatsbaar en sluiten niet bij een klik ernaast; het bestaande `Dialog`-component regelt dat.
- Elke nieuwe UI-tekst staat in alle 39 talen onder `js/i18n/locales/<taal>/`, echt vertaald, met in elke taal dezelfde terminologie als de omliggende teksten.

**Vaste waarden uit de spec**
- Legendagroen `#45B5A8`, tekst `#350E35`, 12 pt, Helvetica. Kop vet in hoofdletters.
- Streep 2 × de dikte, gat 1 × de dikte; witte onderlaag onder een gestreepte stift.
- Lettervak 10 × 15 pt. Legendavakken 15 pt hoog, 2 mm marge, 2 mm tussen regels.
- Dikte in mm op papier: `mm × 72 / 25,4` pt.

**Nooit**
- De app van de gebruiker aanraken (elke `open-pdf-studio.exe` zonder `--mcp-server`), poorten 3041, 3413 en 9223 gebruiken, of processen op naam stoppen.
- `%LOCALAPPDATA%\OpenPDFStudio\preferences.json` of `session.json` schrijven.
- Verificatiebestanden overschrijven.
- Scripts draaien die printers, printerpoorten of papierformaten toevoegen, wijzigen of verwijderen.

**Rotatieprotocol**
- Omdat rendering, saver en rotatie geraakt worden, volgt vóór de push het volledige rotatieprotocol: `verify-tekstrotatie`, `verify-plaatsing-cursor`, `verify-doorlopend-inkt` en de sweep over alle verificatie-PDF's (taak 15).

**Prestatie**
- Bij 1000 stiften op één pagina blijven tekenen, één stift wijzigen en hertekenen elk onder 100 ms.
- Geen doorgang over alle annotaties per element; dat is de les van #491.
- Berekeningen die de hele annotatielijst lezen, lopen alleen als hun paneel zichtbaar is.

**Volgorde**
- Het plan draait op `main` ná #503 (de fix van #491). Die levert `js/core/app-test-hooks.mjs`, de schaalindex per pagina en de snelle undo; taak 7, 8 en 14 bouwen daarop. Rebase `feat/stifttekening` op `origin/main` vóór taak 1.
- Staan #499 (paginarotatie) en #500 (batch laden) al op `main`, dan passen de ankers nog steeds: taak 7 haakt aan bij `modifyMeasureScale` en taak 12 bij `if (!converted) continue;`, die in beide versies gelijk zijn.
- Taak 14 heeft ook de teksten uit taak 10 nodig.

---

## Bestandsoverzicht

| Bestand | Nieuw/wijzig | Verantwoordelijkheid |
|---|---|---|
| `js/annotations/stift/definities.js` | nieuw | soorten, startset, validatie, versie |
| `js/annotations/stift/tekenopdrachten.js` | nieuw | gedeelde bouwer van tekenopdrachten, omhullende, Helvetica-breedte |
| `js/annotations/stift/geometrie.js` | nieuw | geometriesoort, midden, punt raken, vak bijwerken, haaks |
| `js/annotations/stift/legenda.js` | nieuw | regels, indeling, voorbeeldstift, opdrachten van het blok |
| `js/annotations/stift/document.js` | nieuw | definities per document, overnemen, gebruik, overzetten |
| `js/annotations/rendering/stift-draw.js` | nieuw | canvas-uitvoerder, stift en legenda tekenen |
| `js/pdf/saver/stift-ap.js` | nieuw | opdrachten naar PDF-operatoren |
| `js/pdf/saver/stift-meta.js` | nieuw | catalogus `OPS_StiftDefs`, geometrie naar en van PDF |
| `js/pdf/loader/stift-uit-pdf.js` | nieuw | sleutels lezen (`leesStiftMeta`), stift of legenda terug (`stiftUitPdf`) |
| `js/tools/tools/stift-tool.js` | nieuw | gereedschap Stift (lijn, pijl, punt, kruis) |
| `js/tools/tools/stift-legenda-tool.js` | nieuw | gereedschap Legenda (kader slepen, blok plaatsen) |
| `js/solid/components/left-panel/panels/StiftenPanel.jsx` | nieuw | paneel met definities |
| `js/solid/components/left-panel/panels/StiftVoorbeeld.jsx` | nieuw | klein voorbeeld van een definitie |
| `js/solid/components/dialogs/StiftDefinitieDialog.jsx` | nieuw | bewerkvenster |
| `js/solid/components/dialogs/StiftVerwijderenDialog.jsx` | nieuw | verwijderen met overzetten |
| `js/solid/components/properties-panel/StiftSection.jsx` | nieuw | eigenschappen van stift en legenda |
| `js/annotations/stift/klembord.js` | nieuw | definitie mee op het klembord |
| `js/annotations/stift/mcp.js` | nieuw | stift en legenda uit een MCP-opdracht |
| `js/pdf/saver/stift-dict.js` | nieuw | annotatiewoordenboek met appearance van stift en legenda |
| `js/annotations/stift/stift-i18n.test.mjs` | nieuw | alle 39 talen compleet |
| `js/annotations/stift/aanhaking.test.mjs`, `hoeveelheden.test.mjs` | nieuw | aanhaakpunten klembord/MCP/IFC, hoeveelheden |
| `scripts/bench/stift-node.mjs` | nieuw | prestatiemeting met 1000 stiften |
| `scripts/verify-stift.mjs` (repo-root) | nieuw | poorttest op de testinstantie: rondgang, /Rotate 90, muis |
| `js/types/annotation.ts`, `js/types/preferences.ts`, `js/types/document.ts`, `js/core/constants.ts`, `js/core/state.ts` | wijzig | typen, voorkeur, toestand |
| `js/core/undo-manager.js` | wijzig | opdracht `stiftDefinities` |
| `js/annotations/rendering.js`, `geometry.js`, `handles.js`, `transforms.js`, `spatial-index.js` | wijzig | tekenen, raken, grepen, vervormen, omhullende |
| `js/core/stores/selection-helpers.ts`, `js/tools/snap-engine.js`, `js/pdf/renderer.js` | wijzig | selectiekader, snappunten, paginarotatie |
| `js/tools/tools/index.js`, `js/solid/components/ribbon/DrawingTab.jsx` | wijzig | registratie, lintknoppen |
| `js/solid/components/left-panel/LeftPanel.jsx`, `js/solid/data/leftPanelIcons.js`, `js/solid/components/DialogHost.jsx` | wijzig | tabblad, pictogram, vensters |
| `js/solid/stores/propertiesStore.js`, `js/solid/components/properties-panel/PropertiesPanel.jsx` | wijzig | eigenschappen |
| `js/pdf/saver.js` | wijzig | opslaan van stift en legenda, vet lettertype, catalogus |
| `js/pdf/loader/color-extraction.js`, `annotation-converter.js`, `js/pdf/loader.js` | wijzig | inlezen |
| `js/pdf/loader/annotation-image-sources.mjs`, `image-extraction.js` | wijzig | een legenda niet als afbeelding uit de pagina knippen |
| `js/annotations/clipboard.js`, `js/mcp-bridge.js`, `js/solid/data/ifcCategoryMap.js`, `js/pdf/ifc-export.js` | wijzig | klembord, MCP, IFC-labels en -export |
| `src-tauri/src/mcp_server.rs` | wijzig | MCP-schema: `stift` en `stiftLegenda` |
| `js/quantities/categories.js`, `js/solid/stores/quantitiesStore.js`, `js/i18n/locales/*/properties.json` | wijzig | hoeveelheden (na #503) |
| `styles/panels.css` | wijzig | opmaak paneel |

---

## Taak 1: Definities (puur)

**Bestanden:**
- Nieuw: `js/annotations/stift/definities.js`
- Test: `js/annotations/stift/definities.test.mjs`

**Interfaces:**
- Produceert: `STIFT_VERSIE`, `SOORTEN` (elf `{id, naam, vorm, ifc, kleur, lijnsoort, dikteMm, puntvorm?, maatMm?}` in tabelvolgorde), `PUNTVORMEN`, `LIJNSOORTEN`, `soortInfo(soort)`, `vormVoorSoort(soort) → 'lijn'|'pijl'|'punt'|'kruis'`, `ifcVoorSoort(soort)`, `mmNaarPt(mm)`, `nieuweStiftId()`, `volgendeLetter(definities)`, `maakDefinitie(soort, {id?, omschrijving?, bestaande?})`, `standaardSet()`, `valideerDefinitie(ruw)`, `valideerLijst(lijst)`, `schrijfOpgeslagen(definities) → {versie, definities}`, `leesOpgeslagen(data) → definitie[]`.
- Een definitie: `{id, soort, omschrijving, kleur, lijnsoort, dikteMm, letter? (alleen vloer), puntvorm?, maatMm? (alleen tekenwijze punt)}`.

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/stift/definities.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOORTEN, soortInfo, vormVoorSoort, ifcVoorSoort, mmNaarPt, volgendeLetter,
  maakDefinitie, standaardSet, valideerDefinitie, valideerLijst, schrijfOpgeslagen, leesOpgeslagen,
} from './definities.js';

test('elf soorten in de volgorde van de spec, met tekenwijze en IFC', () => {
  assert.deepEqual(SOORTEN.map((s) => s.id), [
    'bestaandeWand', 'nieuweWand', 'stabiliteitswand', 'liggerStaal', 'liggerHout', 'latei',
    'vloer', 'kolom', 'fundering', 'paal', 'sparing',
  ]);
  assert.equal(vormVoorSoort('vloer'), 'pijl');
  assert.equal(vormVoorSoort('kolom'), 'punt');
  assert.equal(vormVoorSoort('sparing'), 'kruis');
  assert.equal(vormVoorSoort('latei'), 'lijn');
  assert.equal(vormVoorSoort('onbekend'), 'lijn');
  assert.equal(ifcVoorSoort('kolom'), 'IfcColumn');
  assert.equal(ifcVoorSoort('fundering'), 'IfcFooting');
  assert.equal(ifcVoorSoort('sparing'), 'IfcOpeningElement');
  assert.equal(ifcVoorSoort('paal'), 'IfcPile');
  assert.equal(soortInfo('xyz'), null);
});

test('millimeters op papier naar punten', () => {
  assert.equal(mmNaarPt(25.4), 72);
  assert.ok(Math.abs(mmNaarPt(1.4) - 3.9685) < 1e-3);
});

test('de startset: één definitie per soort, vaste id, standaardwaarden uit 3052', () => {
  const set = standaardSet();
  assert.equal(set.length, 11);
  assert.deepEqual(set[0], {
    id: 'sd-std-bestaandeWand', soort: 'bestaandeWand', omschrijving: 'Bestaande wand',
    kleur: '#000000', lijnsoort: 'gestreept', dikteMm: 1.4,
  });
  const vloer = set.find((d) => d.soort === 'vloer');
  assert.equal(vloer.letter, 'A');
  assert.equal(vloer.dikteMm, 0.35);
  const kolom = set.find((d) => d.soort === 'kolom');
  assert.equal(kolom.puntvorm, 'vierkant');
  assert.equal(kolom.maatMm, 4);
  assert.equal(set.find((d) => d.soort === 'paal').puntvorm, 'cirkel');
  assert.equal(set.find((d) => d.soort === 'sparing').dikteMm, 0.7);
  assert.deepEqual(standaardSet(), set, 'deterministisch');
});

test('een nieuwe vloerdefinitie krijgt de eerste vrije letter', () => {
  const a = maakDefinitie('vloer', { id: 'a' });
  const b = maakDefinitie('vloer', { id: 'b', bestaande: [a] });
  const c = maakDefinitie('vloer', { id: 'c', bestaande: [a, { soort: 'vloer', letter: 'C' }, b] });
  assert.deepEqual([a.letter, b.letter, c.letter], ['A', 'B', 'D']);
  const alle = Array.from({ length: 26 }, (_, i) => ({ soort: 'vloer', letter: String.fromCharCode(65 + i) }));
  assert.equal(volgendeLetter(alle), 'AA');
});

test('valideren vult aan met de waarden van de soort en klemt onzin', () => {
  assert.equal(valideerDefinitie(null), null);
  assert.equal(valideerDefinitie([1]), null);
  const d = valideerDefinitie({ id: ' x ', soort: 'kolom', omschrijving: '  HEA120  ', kleur: '#00ff00',
    dikteMm: -3, puntvorm: 'ster', maatMm: 7, extra: 'weg' });
  assert.deepEqual(d, { id: 'x', soort: 'kolom', omschrijving: 'HEA120', kleur: '#00FF00',
    lijnsoort: 'doorgetrokken', dikteMm: 0.35, puntvorm: 'vierkant', maatMm: 7 });
  const onbekend = valideerDefinitie({ id: 'y', soort: 'ruimteschip', kleur: 'rood', lijnsoort: 'golf' });
  assert.equal(onbekend.soort, 'nieuweWand');
  assert.equal(onbekend.omschrijving, 'Nieuwe wand');
  assert.equal(onbekend.kleur, '#FF0000');
  assert.equal(onbekend.lijnsoort, 'gestreept');
  assert.equal(valideerDefinitie({ id: 'v', soort: 'vloer', letter: 'b' }).letter, 'B');
  assert.equal(valideerDefinitie({ id: 'v', soort: 'vloer', letter: 'ABC' }).letter, 'A');
  assert.match(valideerDefinitie({ soort: 'latei' }).id, /^sd-/);
});

test('een lijst: dubbele id valt weg, rommel ook', () => {
  const lijst = valideerLijst([{ id: 'a', soort: 'latei' }, 'rommel', { id: 'a', soort: 'paal' }, { id: 'b', soort: 'paal' }]);
  assert.deepEqual(lijst.map((d) => [d.id, d.soort]), [['a', 'latei'], ['b', 'paal']]);
  assert.deepEqual(valideerLijst(null), []);
});

test('opgeslagen vorm: versie 1, en terug', () => {
  const set = standaardSet();
  const opgeslagen = schrijfOpgeslagen(set);
  assert.equal(opgeslagen.versie, 1);
  assert.deepEqual(leesOpgeslagen(JSON.parse(JSON.stringify(opgeslagen))), set);
  assert.deepEqual(leesOpgeslagen(set), set, 'een kale lijst telt als versie 1');
  assert.deepEqual(leesOpgeslagen('onzin'), []);
  assert.deepEqual(leesOpgeslagen({ versie: 1 }), []);
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/definities.test.mjs`
Verwacht: FAIL, `Cannot find module …/definities.js`.

- [ ] **Stap 3: Schrijf de module**

Bestand `js/annotations/stift/definities.js`:

```js
// Stiftdefinities: de soorten, de ingebouwde startset en de regels voor een
// geldige definitie. Puur (geen app-state), onder node te testen.
//
// Een stift is een getekend element dat verwijst naar een definitie in het
// document: soort, omschrijving, kleur, lijnsoort en dikte. De soort bepaalt
// de tekenwijze (lijn, pijl, punt of kruis) en de IFC-categorie en ligt vast
// na het aanmaken. Ontwerp:
// docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md

/** Versie van de opgeslagen definitielijst (`/OPS_StiftDefs`). */
export const STIFT_VERSIE = 1;

/**
 * De elf soorten, in de volgorde van het paneel en de legenda. De
 * standaardwaarden komen uit het voorbeeld 3052-CP-21: wanden en liggers
 * 4,03 pt (1,4 mm), vloerpijlen 1,0 pt, sparingkruisen 2,0 pt.
 */
export const SOORTEN = Object.freeze([
  { id: 'bestaandeWand', naam: 'Bestaande wand', vorm: 'lijn', ifc: 'IfcWall', kleur: '#000000', lijnsoort: 'gestreept', dikteMm: 1.4 },
  { id: 'nieuweWand', naam: 'Nieuwe wand', vorm: 'lijn', ifc: 'IfcWall', kleur: '#FF0000', lijnsoort: 'gestreept', dikteMm: 1.4 },
  { id: 'stabiliteitswand', naam: 'Stabiliteitswand', vorm: 'lijn', ifc: 'IfcWall', kleur: '#FF8C00', lijnsoort: 'gestreept', dikteMm: 1.4 },
  { id: 'liggerStaal', naam: 'Ligger staal', vorm: 'lijn', ifc: 'IfcBeam', kleur: '#7D9EBF', lijnsoort: 'doorgetrokken', dikteMm: 1.4 },
  { id: 'liggerHout', naam: 'Ligger hout', vorm: 'lijn', ifc: 'IfcBeam', kleur: '#FFFF00', lijnsoort: 'doorgetrokken', dikteMm: 1.4 },
  { id: 'latei', naam: 'Latei', vorm: 'lijn', ifc: 'IfcBeam', kleur: '#3BB370', lijnsoort: 'doorgetrokken', dikteMm: 1.4 },
  { id: 'vloer', naam: 'Balklaag of vloer', vorm: 'pijl', ifc: 'IfcSlab', kleur: '#FF0000', lijnsoort: 'doorgetrokken', dikteMm: 0.35 },
  { id: 'kolom', naam: 'Kolom', vorm: 'punt', ifc: 'IfcColumn', kleur: '#0000FF', lijnsoort: 'doorgetrokken', dikteMm: 0.35, puntvorm: 'vierkant', maatMm: 4 },
  { id: 'fundering', naam: 'Funderingsbalk of strook', vorm: 'lijn', ifc: 'IfcFooting', kleur: '#0000FF', lijnsoort: 'doorgetrokken', dikteMm: 1.0 },
  { id: 'paal', naam: 'Paal', vorm: 'punt', ifc: 'IfcPile', kleur: '#000000', lijnsoort: 'doorgetrokken', dikteMm: 0.35, puntvorm: 'cirkel', maatMm: 4 },
  { id: 'sparing', naam: 'Sparing', vorm: 'kruis', ifc: 'IfcOpeningElement', kleur: '#FF0000', lijnsoort: 'doorgetrokken', dikteMm: 0.7 },
].map((s) => Object.freeze(s)));

const PER_ID = new Map(SOORTEN.map((s) => [s.id, s]));
const KLEUR = /^#[0-9A-Fa-f]{6}$/;
const LETTER = /^[A-Za-z0-9]{1,2}$/;
export const PUNTVORMEN = Object.freeze(['vierkant', 'i-profiel', 'cirkel']);
export const LIJNSOORTEN = Object.freeze(['doorgetrokken', 'gestreept']);

/** De soort met dit id, of null. */
export function soortInfo(soort) {
  return PER_ID.get(soort) || null;
}

/** Tekenwijze van een soort: 'lijn' | 'pijl' | 'punt' | 'kruis'. */
export function vormVoorSoort(soort) {
  return soortInfo(soort)?.vorm || 'lijn';
}

/** IFC-categorie van een soort. */
export function ifcVoorSoort(soort) {
  return soortInfo(soort)?.ifc || 'IfcBuildingElementProxy';
}

/** Millimeters op papier naar PDF-punten. */
export function mmNaarPt(mm) {
  return (Number(mm) * 72) / 25.4;
}

/** Nieuw stabiel id voor een zelf aangemaakte definitie. */
export function nieuweStiftId() {
  return 'sd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** De eerste letter die nog geen vloerdefinitie in `definities` draagt. */
export function volgendeLetter(definities) {
  const bezet = new Set((definities || [])
    .filter((d) => d?.soort === 'vloer')
    .map((d) => String(d.letter || '').toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!bezet.has(letter)) return letter;
  }
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const letter = String.fromCharCode(65 + i, 65 + j);
      if (!bezet.has(letter)) return letter;
    }
  }
  return 'A';
}

/**
 * Een nieuwe definitie van `soort` met de standaardwaarden van die soort.
 * @param {string} soort
 * @param {{id?: string, omschrijving?: string, bestaande?: object[]}} [opties]
 */
export function maakDefinitie(soort, { id = nieuweStiftId(), omschrijving, bestaande = [] } = {}) {
  const s = soortInfo(soort) || soortInfo('nieuweWand');
  const def = {
    id,
    soort: s.id,
    omschrijving: omschrijving ?? s.naam,
    kleur: s.kleur,
    lijnsoort: s.lijnsoort,
    dikteMm: s.dikteMm,
  };
  if (s.vorm === 'punt') {
    def.puntvorm = s.puntvorm;
    def.maatMm = s.maatMm;
  }
  if (s.id === 'vloer') def.letter = volgendeLetter(bestaande);
  return def;
}

/** De ingebouwde startset: één definitie per soort, met vaste id's. */
export function standaardSet() {
  const lijst = [];
  for (const s of SOORTEN) lijst.push(maakDefinitie(s.id, { id: `sd-std-${s.id}`, bestaande: lijst }));
  return lijst;
}

function getal(waarde, min, max, terugval) {
  const n = Number(waarde);
  return Number.isFinite(n) && n > min && n <= max ? n : terugval;
}

/**
 * Een definitie zoals hij uit een bestand of de voorkeuren komt, aangevuld
 * met de standaardwaarden van zijn soort. Een onbekende soort wordt "Nieuwe
 * wand". Geeft null voor iets dat geen object is.
 */
export function valideerDefinitie(ruw) {
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return null;
  const s = soortInfo(ruw.soort) || soortInfo('nieuweWand');
  const omschrijving = typeof ruw.omschrijving === 'string' && ruw.omschrijving.trim()
    ? ruw.omschrijving.trim().slice(0, 200) : s.naam;
  const def = {
    id: typeof ruw.id === 'string' && ruw.id.trim() ? ruw.id.trim() : nieuweStiftId(),
    soort: s.id,
    omschrijving,
    kleur: typeof ruw.kleur === 'string' && KLEUR.test(ruw.kleur) ? ruw.kleur.toUpperCase() : s.kleur,
    lijnsoort: LIJNSOORTEN.includes(ruw.lijnsoort) ? ruw.lijnsoort : s.lijnsoort,
    dikteMm: getal(ruw.dikteMm, 0, 20, s.dikteMm),
  };
  if (s.vorm === 'punt') {
    def.puntvorm = PUNTVORMEN.includes(ruw.puntvorm) ? ruw.puntvorm : s.puntvorm;
    def.maatMm = getal(ruw.maatMm, 0, 50, s.maatMm);
  }
  if (s.id === 'vloer') {
    def.letter = typeof ruw.letter === 'string' && LETTER.test(ruw.letter) ? ruw.letter.toUpperCase() : 'A';
  }
  return def;
}

/** Een lijst geldige definities; bij een dubbel id wint de eerste. */
export function valideerLijst(lijst) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  const ids = new Set();
  for (const ruw of lijst) {
    const def = valideerDefinitie(ruw);
    if (!def || ids.has(def.id)) continue;
    ids.add(def.id);
    uit.push(def);
  }
  return uit;
}

/** Wat in `/OPS_StiftDefs` komt. */
export function schrijfOpgeslagen(definities) {
  return { versie: STIFT_VERSIE, definities: valideerLijst(definities) };
}

/**
 * Lees de opgeslagen vorm terug (versie 1 is de enige; een lijst zonder
 * versie telt als versie 1). Geeft altijd een lijst, desnoods leeg.
 */
export function leesOpgeslagen(data) {
  if (Array.isArray(data)) return valideerLijst(data);
  if (!data || typeof data !== 'object') return [];
  return valideerLijst(data.definities);
}
```

- [ ] **Stap 4: Draai de test opnieuw**

Run: `node --test js/annotations/stift/definities.test.mjs`
Verwacht: 7 tests, 7 pass.

- [ ] **Stap 5: Registreer de test in `test:unit` (zie Global Constraints) en commit**

```bash
git add open-pdf-studio/js/annotations/stift/definities.js open-pdf-studio/js/annotations/stift/definities.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): marker kinds, built-in start set and definition validation"
```

## Taak 2: Tekenopdrachten (puur)

**Bestanden:**
- Nieuw: `js/annotations/stift/tekenopdrachten.js`
- Test: `js/annotations/stift/tekenopdrachten.test.mjs`

**Interfaces:**
- Gebruikt: `mmNaarPt` uit taak 1; `toWinAnsiText` uit `js/pdf/saver/pdf-text.js`; `StandardFontEmbedder`, `StandardFonts` uit `pdf-lib`.
- Produceert:
  - de constanten `WIT`, `LEGENDA_GROEN`, `LEGENDA_TEKST`, `PIJLPUNT_MM`, `LETTERVAK`, `BASISLIJN`;
  - `helveticaBreedte(tekst, grootte, vet?)`;
  - `streepPatroon(diktePt) → [2d, d]`;
  - `pijlpunt(tip, van, lengte)`;
  - `stiftTekenopdrachten(stift, definitie|null, {meet?}) → Opdracht[]`;
  - `opdrachtenOmhullende(opdrachten) → {x, y, width, height}`;
  - `stiftOmhullende(stift, definitie, opties?)`.
- Opdrachtsoorten: `lijn {punten, kleur, dikte, streep}`, `vlak {punten, kleur}`, `cirkel {x, y, r, kleur}`, `rechthoek {x, y, b, h, vulling}`, `tekst {x, y (basislijn), tekst, grootte, vet, kleur, uitlijning 'links'|'midden', breedte}`.
- Een stift heeft `vorm` en per vorm: `points` (lijn), `startX/startY/endX/endY` (pijl), `x/y` en optioneel `rotation` 0 of 90 (punt), `x/y/width/height` (kruis).

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/stift/tekenopdrachten.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WIT, LEGENDA_GROEN, LEGENDA_TEKST, LETTERVAK, BASISLIJN, streepPatroon, pijlpunt, helveticaBreedte,
  stiftTekenopdrachten, opdrachtenOmhullende, stiftOmhullende,
} from './tekenopdrachten.js';
import { maakDefinitie, mmNaarPt } from './definities.js';

const bijna = (a, b, melding) => assert.ok(Math.abs(a - b) < 1e-6, `${melding}: ${a} ≠ ${b}`);
const meet = (tekst, grootte) => String(tekst).length * grootte * 0.5;

test('streep 2 × en gat 1 × de dikte', () => {
  assert.deepEqual(streepPatroon(4), [8, 4]);
});

test('Helvetica-breedte is die van pdf-lib, ook voor é en €', () => {
  assert.ok(Math.abs(helveticaBreedte('HSB-wand 38x184, hoh 610, C24', 12) - 178.584) < 0.01);
  assert.ok(helveticaBreedte('A', 12, true) > helveticaBreedte('A', 12, false) - 1e-9);
  assert.ok(helveticaBreedte('café €', 12) > 0);
});

test('gestreepte lijn: eerst een witte onderlaag, dan de strepen', () => {
  const def = maakDefinitie('nieuweWand', { id: 'w' });
  const stift = { type: 'stift', vorm: 'lijn', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] };
  const [onder, boven] = stiftTekenopdrachten(stift, def, { meet });
  const d = mmNaarPt(1.4);
  assert.deepEqual(onder, { soort: 'lijn', punten: [[10, 20], [110, 20]], kleur: WIT, dikte: d, streep: null });
  assert.deepEqual(boven, { soort: 'lijn', punten: [[10, 20], [110, 20]], kleur: '#FF0000', dikte: d, streep: [2 * d, d] });
});

test('doorgetrokken lijn: één opdracht', () => {
  const def = maakDefinitie('liggerStaal', { id: 'l' });
  const uit = stiftTekenopdrachten({ vorm: 'lijn', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, def, { meet });
  assert.equal(uit.length, 1);
  assert.equal(uit[0].streep, null);
  assert.equal(uit[0].kleur, '#7D9EBF');
});

test('pijlpunt: top op het uiteinde, basis één pijlpuntlengte terug', () => {
  const [top, links, rechts] = pijlpunt([100, 0], [0, 0], 10);
  assert.deepEqual(top, [100, 0]);
  bijna(links[0], 90, 'basis x'); bijna(rechts[0], 90, 'basis x');
  bijna(Math.abs(links[1] - rechts[1]), 6, 'basisbreedte');
});

test('vloerpijl: lijn tussen de pijlpunten, twee punten, een groen lettervak met de letter', () => {
  const def = { ...maakDefinitie('vloer', { id: 'v' }), letter: 'B' };
  const stift = { vorm: 'pijl', startX: 0, startY: 50, endX: 200, endY: 50 };
  const uit = stiftTekenopdrachten(stift, def, { meet });
  assert.deepEqual(uit.map((o) => o.soort), ['lijn', 'vlak', 'vlak', 'rechthoek', 'tekst']);
  const k = mmNaarPt(3);
  bijna(uit[0].punten[0][0], k, 'lijn begint na de pijlpunt');
  bijna(uit[0].punten[1][0], 200 - k, 'lijn stopt voor de pijlpunt');
  assert.deepEqual(uit[3], { soort: 'rechthoek', x: 95, y: 42.5, b: 10, h: 15, vulling: LEGENDA_GROEN });
  assert.deepEqual(uit[4], { soort: 'tekst', x: 100, y: 50 + 12 * BASISLIJN, tekst: 'B', grootte: LETTERVAK.grootte,
    vet: true, kleur: LEGENDA_TEKST, uitlijning: 'midden', breedte: 6 });
});

test('punten: vierkant, cirkel en I-profiel (ook een kwartslag gedraaid)', () => {
  const kolom = maakDefinitie('kolom', { id: 'k' });
  const h = mmNaarPt(4) / 2;
  const [vierkant] = stiftTekenopdrachten({ vorm: 'punt', x: 10, y: 10 }, kolom, { meet });
  assert.deepEqual(vierkant.punten, [[10 - h, 10 - h], [10 + h, 10 - h], [10 + h, 10 + h], [10 - h, 10 + h]]);
  const [cirkel] = stiftTekenopdrachten({ vorm: 'punt', x: 5, y: 6 }, maakDefinitie('paal', { id: 'p' }), { meet });
  assert.deepEqual(cirkel, { soort: 'cirkel', x: 5, y: 6, r: h, kleur: '#000000' });
  const iprof = { ...kolom, puntvorm: 'i-profiel' };
  const recht = stiftTekenopdrachten({ vorm: 'punt', x: 0, y: 0 }, iprof, { meet });
  const kwart = stiftTekenopdrachten({ vorm: 'punt', x: 0, y: 0, rotation: 90 }, iprof, { meet });
  assert.equal(recht.length, 3);
  // Bovenflens: recht is hij horizontaal (hoogte = maat/5), gedraaid verticaal.
  const bboxVan = (vlak) => opdrachtenOmhullende([vlak]);
  bijna(bboxVan(recht[0]).height, mmNaarPt(4) / 5, 'flens recht');
  bijna(bboxVan(kwart[0]).width, mmNaarPt(4) / 5, 'flens gedraaid');
});

test('sparing: de twee diagonalen van de rechthoek, geen rand', () => {
  const def = maakDefinitie('sparing', { id: 's' });
  const uit = stiftTekenopdrachten({ vorm: 'kruis', x: 10, y: 20, width: 30, height: 40 }, def, { meet });
  assert.deepEqual(uit.map((o) => o.punten), [[[10, 20], [40, 60]], [[40, 20], [10, 60]]]);
});

test('zonder definitie: grijs gestreept met een vraagteken', () => {
  const uit = stiftTekenopdrachten({ vorm: 'lijn', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, null, { meet });
  assert.equal(uit[1].kleur, '#999999');
  assert.ok(uit[1].streep);
  assert.equal(uit.at(-1).tekst, '?');
});

test('omhullende: lijn met halve dikte, pijl met lettervak', () => {
  const def = maakDefinitie('liggerHout', { id: 'h' });
  const d = mmNaarPt(1.4);
  const o = stiftOmhullende({ vorm: 'lijn', points: [{ x: 10, y: 10 }, { x: 110, y: 10 }] }, def, { meet });
  bijna(o.x, 10 - d / 2, 'x'); bijna(o.width, 100 + d, 'breedte'); bijna(o.height, d, 'hoogte');
  const vloer = maakDefinitie('vloer', { id: 'v' });
  const p = stiftOmhullende({ vorm: 'pijl', startX: 0, startY: 0, endX: 0, endY: 100 }, vloer, { meet });
  assert.ok(p.width >= LETTERVAK.breedte, 'het lettervak telt mee');
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/tekenopdrachten.test.mjs`
Verwacht: FAIL, module niet gevonden.

- [ ] **Stap 3: Schrijf de module**

Bestand `js/annotations/stift/tekenopdrachten.js`:

```js
// Tekenopdrachten van een stift: één pure bouwer voor het canvas én de
// appearance stream in de PDF, zodat scherm en opgeslagen bestand gelijk zijn.
//
// Een opdracht is een gewoon object in paginacoördinaten (punten, y omlaag):
//   { soort: 'lijn', punten: [[x, y], …], kleur, dikte, streep: null | [streep, gat] }
//   { soort: 'vlak', punten: [[x, y], …], kleur }            gevulde veelhoek
//   { soort: 'cirkel', x, y, r, kleur }                      gevulde cirkel
//   { soort: 'rechthoek', x, y, b, h, vulling }             gevuld vak
//   { soort: 'tekst', x, y, tekst, grootte, vet, kleur, uitlijning, breedte }
// Bij tekst is y de basislijn en x het begin ('links') of het midden
// ('midden'); `breedte` is de Helvetica-breedte, nodig om in de PDF te
// centreren.

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';
import { toWinAnsiText } from '../../pdf/saver/pdf-text.js';
import { mmNaarPt } from './definities.js';

export const WIT = '#FFFFFF';
/** Legendagroen en tekstkleur uit 3052-CP-21. */
export const LEGENDA_GROEN = '#45B5A8';
export const LEGENDA_TEKST = '#350E35';
/** Lengte van een pijlpunt op papier. */
export const PIJLPUNT_MM = 3;
/** Het lettervak op een vloerpijl, in punten (10 × 15 pt, zoals in 3052). */
export const LETTERVAK = Object.freeze({ breedte: 10, hoogte: 15, grootte: 12 });
/** Basislijn ten opzichte van het midden van een tekstvak, als deel van de lettergrootte. */
export const BASISLIJN = 0.35;

const ONBEKEND = Object.freeze({
  kleur: '#999999', lijnsoort: 'gestreept', dikteMm: 0.5, letter: '?', puntvorm: 'vierkant', maatMm: 4,
});

let _helv = null;
let _helvBold = null;

/** Breedte van `tekst` in Helvetica (of Helvetica-Bold) op `grootte` punt. */
export function helveticaBreedte(tekst, grootte, vet = false) {
  if (vet) _helvBold ||= StandardFontEmbedder.for(StandardFonts.HelveticaBold);
  else _helv ||= StandardFontEmbedder.for(StandardFonts.Helvetica);
  return (vet ? _helvBold : _helv).widthOfTextAtSize(toWinAnsiText(String(tekst ?? '')), grootte);
}

/** Streep 2 × de dikte, gat 1 × de dikte (3052: [8,1 4,0] bij 4,03 pt). */
export function streepPatroon(diktePt) {
  return [2 * diktePt, diktePt];
}

/** Gesloten pijlpunt met de top op `tip`, wijzend weg van `van`. */
export function pijlpunt(tip, van, lengte) {
  const dx = tip[0] - van[0];
  const dy = tip[1] - van[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const half = lengte * 0.3;
  const bx = tip[0] - ux * lengte;
  const by = tip[1] - uy * lengte;
  return [[tip[0], tip[1]], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]];
}

function lijnOpdrachten(punten, def) {
  const dikte = mmNaarPt(def.dikteMm);
  if (def.lijnsoort === 'gestreept') {
    // Witte onderlaag: de gaten tonen wit, niet de grijze wand eronder.
    return [
      { soort: 'lijn', punten, kleur: WIT, dikte, streep: null },
      { soort: 'lijn', punten, kleur: def.kleur, dikte, streep: streepPatroon(dikte) },
    ];
  }
  return [{ soort: 'lijn', punten, kleur: def.kleur, dikte, streep: null }];
}

function tekstOpdracht(x, midden, tekst, grootte, vet, kleur, uitlijning, meet) {
  return {
    soort: 'tekst', x, y: midden + grootte * BASISLIJN, tekst, grootte, vet, kleur, uitlijning,
    breedte: meet(tekst, grootte, vet),
  };
}

function pijlOpdrachten(stift, def, meet) {
  const a = [stift.startX, stift.startY];
  const b = [stift.endX, stift.endY];
  const lengte = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const kop = Math.min(mmNaarPt(PIJLPUNT_MM), lengte / 2);
  const opdrachten = [];
  if (lengte > 2 * kop) {
    const ux = (b[0] - a[0]) / lengte;
    const uy = (b[1] - a[1]) / lengte;
    // De lijn stopt bij de basis van de pijlpunten, anders steekt hij erdoor.
    opdrachten.push({
      soort: 'lijn',
      punten: [[a[0] + ux * kop, a[1] + uy * kop], [b[0] - ux * kop, b[1] - uy * kop]],
      kleur: def.kleur, dikte: mmNaarPt(def.dikteMm), streep: null,
    });
  }
  if (lengte > 0) {
    opdrachten.push({ soort: 'vlak', punten: pijlpunt(a, b, kop), kleur: def.kleur });
    opdrachten.push({ soort: 'vlak', punten: pijlpunt(b, a, kop), kleur: def.kleur });
  }
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  opdrachten.push({
    soort: 'rechthoek', x: mx - LETTERVAK.breedte / 2, y: my - LETTERVAK.hoogte / 2,
    b: LETTERVAK.breedte, h: LETTERVAK.hoogte, vulling: LEGENDA_GROEN,
  });
  opdrachten.push(tekstOpdracht(mx, my, def.letter || '', LETTERVAK.grootte, true, LEGENDA_TEKST, 'midden', meet));
  return opdrachten;
}

function puntOpdrachten(stift, def) {
  const maat = mmNaarPt(def.maatMm);
  const h = maat / 2;
  const { x, y } = stift;
  if (def.puntvorm === 'cirkel') return [{ soort: 'cirkel', x, y, r: h, kleur: def.kleur }];
  if (def.puntvorm === 'i-profiel') {
    const flens = maat / 5;
    const lijf = maat / 6;
    const vlakken = [
      [[-h, -h], [h, -h], [h, -h + flens], [-h, -h + flens]],
      [[-h, h - flens], [h, h - flens], [h, h], [-h, h]],
      [[-lijf / 2, -h + flens], [lijf / 2, -h + flens], [lijf / 2, h - flens], [-lijf / 2, h - flens]],
    ];
    // Stand 90: het profiel een kwartslag gedraaid (flenzen verticaal).
    const kwart = ((((stift.rotation || 0) % 180) + 180) % 180) === 90;
    return vlakken.map((vlak) => ({
      soort: 'vlak', kleur: def.kleur,
      punten: vlak.map(([px, py]) => (kwart ? [x - py, y + px] : [x + px, y + py])),
    }));
  }
  return [{ soort: 'vlak', kleur: def.kleur, punten: [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]] }];
}

function kruisOpdrachten(stift, def) {
  const dikte = mmNaarPt(def.dikteMm);
  const { x, y, width: b, height: h } = stift;
  return [
    { soort: 'lijn', punten: [[x, y], [x + b, y + h]], kleur: def.kleur, dikte, streep: null },
    { soort: 'lijn', punten: [[x + b, y], [x, y + h]], kleur: def.kleur, dikte, streep: null },
  ];
}

function eerstePunt(stift) {
  switch (stift.vorm) {
    case 'pijl': return [stift.startX, stift.startY];
    case 'punt':
    case 'kruis': return [stift.x, stift.y];
    default: return stift.points?.length ? [stift.points[0].x, stift.points[0].y] : [0, 0];
  }
}

/**
 * De opdrachten van één stift. Zonder bruikbare definitie: grijs gestreept
 * met een vraagteken, en de stift behoudt al zijn gegevens.
 * @param {object} stift  annotatie van type 'stift' (met `vorm`)
 * @param {object|null} definitie
 * @param {{meet?: (tekst: string, grootte: number, vet: boolean) => number}} [opties]
 */
export function stiftTekenopdrachten(stift, definitie, { meet = helveticaBreedte } = {}) {
  const def = definitie || ONBEKEND;
  let opdrachten;
  switch (stift.vorm) {
    case 'pijl': opdrachten = pijlOpdrachten(stift, def, meet); break;
    case 'punt': opdrachten = puntOpdrachten(stift, def); break;
    case 'kruis': opdrachten = kruisOpdrachten(stift, def); break;
    default: opdrachten = lijnOpdrachten((stift.points || []).map((p) => [p.x, p.y]), def);
  }
  if (!definitie && stift.vorm !== 'pijl') {
    const [px, py] = eerstePunt(stift);
    opdrachten.push(tekstOpdracht(px, py, '?', 12, true, ONBEKEND.kleur, 'midden', meet));
  }
  return opdrachten;
}

/** Omhullende van een reeks opdrachten, inclusief halve lijndikte. */
export function opdrachtenOmhullende(opdrachten) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const neem = (x, y, marge = 0) => {
    x1 = Math.min(x1, x - marge); y1 = Math.min(y1, y - marge);
    x2 = Math.max(x2, x + marge); y2 = Math.max(y2, y + marge);
  };
  for (const o of opdrachten) {
    switch (o.soort) {
      case 'lijn': for (const [x, y] of o.punten) neem(x, y, o.dikte / 2); break;
      case 'vlak': for (const [x, y] of o.punten) neem(x, y); break;
      case 'cirkel': neem(o.x, o.y, o.r); break;
      case 'rechthoek': neem(o.x, o.y); neem(o.x + o.b, o.y + o.h); break;
      case 'tekst': {
        const begin = o.uitlijning === 'midden' ? o.x - o.breedte / 2 : o.x;
        neem(begin, o.y - o.grootte); neem(begin + o.breedte, o.y + o.grootte * 0.25);
        break;
      }
      default: break;
    }
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Omhullende van een getekende stift. */
export function stiftOmhullende(stift, definitie, opties) {
  return opdrachtenOmhullende(stiftTekenopdrachten(stift, definitie, opties));
}
```

- [ ] **Stap 4: Draai de test opnieuw**

Run: `node --test js/annotations/stift/tekenopdrachten.test.mjs`
Verwacht: 10 tests, 10 pass.

- [ ] **Stap 5: Registreer de test en commit**

```bash
git add open-pdf-studio/js/annotations/stift/tekenopdrachten.js open-pdf-studio/js/annotations/stift/tekenopdrachten.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): shared drawing commands for canvas and PDF appearance"
```

## Taak 3: Geometrie (puur)

**Bestanden:**
- Nieuw: `js/annotations/stift/geometrie.js`
- Test: `js/annotations/stift/geometrie.test.mjs`

**Interfaces:**
- Produceert:
  - `geometrieSoort(ann)`: voor een stift `'polyline'`, `'line'`, `'box'` of `'stiftPunt'`, anders `ann.type`;
  - `stiftMidden(stift) → [x, y]`;
  - `raaktStiftPunt(stift, x, y, tol, maatPt)`;
  - `stiftPuntVak(stift, maatPt)`;
  - `synchroniseerVak(stift)` (muteert en geeft terug);
  - `haaksPunt(vorige, x, y)`.

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/stift/geometrie.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { geometrieSoort, stiftMidden, raaktStiftPunt, stiftPuntVak, synchroniseerVak, haaksPunt } from './geometrie.js';

test('een stift leent de geometriesoort van zijn tekenwijze', () => {
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'lijn' }), 'polyline');
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'pijl' }), 'line');
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'kruis' }), 'box');
  assert.equal(geometrieSoort({ type: 'stift', vorm: 'punt' }), 'stiftPunt');
  assert.equal(geometrieSoort({ type: 'stift' }), 'polyline');
  assert.equal(geometrieSoort({ type: 'box' }), 'box');
  assert.equal(geometrieSoort({ type: 'stiftLegenda' }), 'stiftLegenda');
  assert.equal(geometrieSoort(null), undefined);
});

test('midden per tekenwijze', () => {
  assert.deepEqual(stiftMidden({ vorm: 'lijn', points: [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 2, y: 8 }] }), [5, 4]);
  assert.deepEqual(stiftMidden({ vorm: 'pijl', startX: 0, startY: 0, endX: 10, endY: 20 }), [5, 10]);
  assert.deepEqual(stiftMidden({ vorm: 'punt', x: 3, y: 4 }), [3, 4]);
  assert.deepEqual(stiftMidden({ vorm: 'kruis', x: 10, y: 20, width: 30, height: 40 }), [25, 40]);
  assert.deepEqual(stiftMidden({ vorm: 'lijn', points: [] }), [0, 0]);
});

test('een punt raak je binnen de halve maat plus de tolerantie', () => {
  const p = { x: 100, y: 100 };
  assert.equal(raaktStiftPunt(p, 105, 100, 1, 12), true);
  assert.equal(raaktStiftPunt(p, 108, 100, 1, 12), false);
  assert.deepEqual(stiftPuntVak(p, 12), { x: 94, y: 94, width: 12, height: 12 });
});

test('het vak volgt de geometrie; een omgekeerd kruis wordt rechtgezet', () => {
  assert.deepEqual(
    synchroniseerVak({ vorm: 'lijn', points: [{ x: 5, y: 9 }, { x: 1, y: 3 }] }),
    { vorm: 'lijn', points: [{ x: 5, y: 9 }, { x: 1, y: 3 }], x: 1, y: 3, width: 4, height: 6 },
  );
  const pijl = synchroniseerVak({ vorm: 'pijl', startX: 10, startY: 0, endX: 0, endY: 5 });
  assert.deepEqual([pijl.x, pijl.y, pijl.width, pijl.height], [0, 0, 10, 5]);
  const kruis = synchroniseerVak({ vorm: 'kruis', x: 50, y: 50, width: -20, height: -10 });
  assert.deepEqual([kruis.x, kruis.y, kruis.width, kruis.height], [30, 40, 20, 10]);
  assert.deepEqual(synchroniseerVak({ vorm: 'punt', x: 1, y: 2 }), { vorm: 'punt', x: 1, y: 2 });
});

test('haaks: de grootste richting wint', () => {
  assert.deepEqual(haaksPunt({ x: 0, y: 0 }, 10, 3), { x: 10, y: 0 });
  assert.deepEqual(haaksPunt({ x: 0, y: 0 }, 2, -9), { x: 0, y: -9 });
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/geometrie.test.mjs`
Verwacht: FAIL, module niet gevonden.

- [ ] **Stap 3: Schrijf de module**

Bestand `js/annotations/stift/geometrie.js`:

```js
// Geometrie van stiften, zonder app-state.
//
// Een stift gebruikt per tekenwijze dezelfde velden als een bestaande vorm:
// een lijn `points` (zoals een polyline), een pijl `startX/startY/endX/endY`
// (zoals een lijn), een kruis `x/y/width/height` (zoals een rechthoek) en een
// punt `x/y` (het midden). Raken, grepen, vervormen, omhullende, snappen en
// paginarotatie hergebruiken daardoor de bestaande code: op die plekken zet
// `geometrieSoort(ann)` een stift om naar de soort waarvan hij de velden
// deelt. Alleen het punt heeft een eigen, kleine behandeling ('stiftPunt').

const NAAR_SOORT = Object.freeze({ lijn: 'polyline', pijl: 'line', kruis: 'box', punt: 'stiftPunt' });

/** De geometriesoort waarmee raken, grepen en vervormen een annotatie behandelen. */
export function geometrieSoort(ann) {
  if (ann?.type !== 'stift') return ann?.type;
  return NAAR_SOORT[ann.vorm] || 'polyline';
}

/** Midden van de omhullende van de geometrie (zonder lijndikte). */
export function stiftMidden(stift) {
  switch (stift.vorm) {
    case 'pijl': return [(stift.startX + stift.endX) / 2, (stift.startY + stift.endY) / 2];
    case 'punt': return [stift.x, stift.y];
    case 'kruis': return [stift.x + stift.width / 2, stift.y + stift.height / 2];
    default: {
      const pts = stift.points || [];
      if (!pts.length) return [0, 0];
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const p of pts) {
        x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
        x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
      }
      return [(x1 + x2) / 2, (y1 + y2) / 2];
    }
  }
}

/** Raakt (x, y) een punt-stift met symboolmaat `maatPt`? */
export function raaktStiftPunt(stift, x, y, tol, maatPt) {
  return Math.hypot(x - stift.x, y - stift.y) <= maatPt / 2 + tol;
}

/** Het vak van een punt-stift met symboolmaat `maatPt`. */
export function stiftPuntVak(stift, maatPt) {
  return { x: stift.x - maatPt / 2, y: stift.y - maatPt / 2, width: maatPt, height: maatPt };
}

/**
 * Houd `x/y/width/height` gelijk aan de geometrie, zoals bij een polyline en
 * een lijn: selectiekader, ruimtelijke index en klembord rekenen daarmee.
 * Een kruis met een negatieve maat (van rechtsonder naar linksboven
 * gesleept) wordt rechtgezet. Een punt heeft geen vak.
 */
export function synchroniseerVak(stift) {
  if (stift.vorm === 'lijn' && stift.points?.length) {
    const xs = stift.points.map((p) => p.x);
    const ys = stift.points.map((p) => p.y);
    stift.x = Math.min(...xs); stift.y = Math.min(...ys);
    stift.width = Math.max(...xs) - stift.x; stift.height = Math.max(...ys) - stift.y;
  } else if (stift.vorm === 'pijl') {
    stift.x = Math.min(stift.startX, stift.endX); stift.y = Math.min(stift.startY, stift.endY);
    stift.width = Math.abs(stift.endX - stift.startX); stift.height = Math.abs(stift.endY - stift.startY);
  } else if (stift.vorm === 'kruis') {
    if (stift.width < 0) { stift.x += stift.width; stift.width = -stift.width; }
    if (stift.height < 0) { stift.y += stift.height; stift.height = -stift.height; }
  }
  return stift;
}

/** Het punt `(x, y)` haaks gezet ten opzichte van `vorige` (Shift). */
export function haaksPunt(vorige, x, y) {
  return Math.abs(x - vorige.x) >= Math.abs(y - vorige.y) ? { x, y: vorige.y } : { x: vorige.x, y };
}
```

- [ ] **Stap 4: Draai de test opnieuw**

Run: `node --test js/annotations/stift/geometrie.test.mjs`
Verwacht: 5 tests, 5 pass.

- [ ] **Stap 5: Registreer de test en commit**

```bash
git add open-pdf-studio/js/annotations/stift/geometrie.js open-pdf-studio/js/annotations/stift/geometrie.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): map markers onto existing geometry kinds"
```

## Taak 4: Legenda (puur)

**Bestanden:**
- Nieuw: `js/annotations/stift/legenda.js`
- Test: `js/annotations/stift/legenda.test.mjs`

**Interfaces:**
- Gebruikt: `SOORTEN` en `mmNaarPt` (taak 1); `stiftMidden` (taak 3); `stiftTekenopdrachten`, `helveticaBreedte`, `LEGENDA_GROEN`, `LEGENDA_TEKST` en `BASISLIJN` (taak 2).
- Produceert:
  - `LEGENDA_MAAT`;
  - `legendaRegels(legenda, annotaties, definities) → {definitie, tekst}[]`;
  - `legendaIndeling(legenda, regels, meet?) → {x, y, breedte, hoogte, kolommen, kop: {x, y, b, h, tekst}, rijen: [{definitie, tekst, voorbeeldVak, tekstVak}]}`;
  - `voorbeeldStift(definitie, vak)`;
  - `legendaTekenopdrachten(indeling, meet?)`.
- Een legenda-annotatie: `{type: 'stiftLegenda', page, x, y, kop, kolommen: 1|2, kader: {x, y, width, height}|null, width, height}`.

> Afwijking van de spec: het voorbeeldkruis is 8 mm breed en zo hoog als de regel (15 pt). Een kruis van 8 × 8 mm past niet in een regel van 5,3 mm. Deze taak werkt de spec bij in dezelfde commit.

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/stift/legenda.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGENDA_MAAT, legendaRegels, legendaIndeling, voorbeeldStift, legendaTekenopdrachten } from './legenda.js';
import { LEGENDA_GROEN, LEGENDA_TEKST } from './tekenopdrachten.js';
import { maakDefinitie } from './definities.js';

const meet = (tekst, grootte, vet) => String(tekst).length * grootte * (vet ? 0.6 : 0.5);

const defs = [
  maakDefinitie('liggerHout', { id: 'hout' }),
  { ...maakDefinitie('vloer', { id: 'vloerB' }), letter: 'B', omschrijving: 'Balklaag 45x145' },
  maakDefinitie('nieuweWand', { id: 'wand', omschrijving: 'HSB-wand 38x184' }),
  maakDefinitie('bestaandeWand', { id: 'bestaand' }),
  maakDefinitie('liggerStaal', { id: 'staal' }),
];
const lijn = (id, x, y, page = 1) => ({ type: 'stift', vorm: 'lijn', page, stiftDefId: id, points: [{ x, y }, { x: x + 10, y }] });

test('regels: gebruikte definities in de volgorde van de soorten, vloer met letter vooraan', () => {
  const annotaties = [
    lijn('hout', 10, 10), lijn('wand', 20, 20), lijn('wand', 30, 30), lijn('bestaand', 40, 40),
    { type: 'stift', vorm: 'pijl', page: 1, stiftDefId: 'vloerB', startX: 0, startY: 50, endX: 100, endY: 50 },
    { type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5 },
  ];
  const regels = legendaRegels({ page: 1, kader: null }, annotaties, defs);
  assert.deepEqual(regels.map((r) => r.definitie.id), ['bestaand', 'wand', 'hout', 'vloerB']);
  assert.equal(regels[3].tekst, 'B  Balklaag 45x145');
  assert.equal(regels[1].tekst, 'HSB-wand 38x184');
});

test('regels: alleen binnen het kader, op dezelfde pagina, met een bekende definitie', () => {
  const annotaties = [lijn('wand', 10, 10), lijn('hout', 500, 500), lijn('staal', 10, 10, 2), lijn('weg', 10, 10)];
  const regels = legendaRegels({ page: 1, kader: { x: 0, y: 0, width: 100, height: 100 } }, annotaties, defs);
  assert.deepEqual(regels.map((r) => r.definitie.id), ['wand']);
});

test('indeling met één kolom: kop, regels onder elkaar, breedte uit de langste tekst', () => {
  const M = LEGENDA_MAAT;
  const regels = [{ definitie: defs[3], tekst: 'Bestaande wand' }, { definitie: defs[2], tekst: 'HSB-wand 38x184' }];
  const ind = legendaIndeling({ x: 100, y: 200, kop: 'Constructie 1e verdieping', kolommen: 1 }, regels, meet);
  assert.equal(ind.kop.tekst, 'CONSTRUCTIE 1E VERDIEPING');
  assert.equal(ind.kolommen, 1);
  assert.equal(ind.rijen.length, 2);
  const tekstVak = 15 * 12 * 0.5 + 2 * M.marge;
  assert.ok(Math.abs(ind.rijen[0].tekstVak.b - tekstVak) < 1e-9);
  assert.equal(ind.rijen[0].voorbeeldVak.x, 100);
  assert.ok(Math.abs(ind.rijen[1].voorbeeldVak.y - (200 + M.rij + M.tussen + M.rij + M.tussen)) < 1e-9);
  const kopBreedte = 25 * 12 * 0.6 + 2 * M.marge;
  assert.ok(Math.abs(ind.breedte - Math.max(kopBreedte, M.voorbeeld + M.tussen + tekstVak)) < 1e-9);
  assert.ok(Math.abs(ind.hoogte - (M.rij + M.tussen + 2 * M.rij + M.tussen)) < 1e-9);
});

test('twee kolommen: de eerste krijgt er één meer bij een oneven aantal', () => {
  const regels = defs.map((d) => ({ definitie: d, tekst: d.omschrijving }));
  const ind = legendaIndeling({ x: 0, y: 0, kolommen: 2 }, regels, meet);
  assert.equal(ind.kolommen, 2);
  const xs = [...new Set(ind.rijen.map((r) => r.voorbeeldVak.x))];
  assert.equal(xs.length, 2);
  assert.equal(ind.rijen.filter((r) => r.voorbeeldVak.x === xs[0]).length, 3);
  assert.equal(ind.rijen.filter((r) => r.voorbeeldVak.x === xs[1]).length, 2);
  assert.equal(legendaIndeling({ x: 0, y: 0, kolommen: 2 }, regels.slice(0, 1), meet).kolommen, 1);
});

test('zonder regels: alleen de kop', () => {
  const ind = legendaIndeling({ x: 0, y: 0 }, [], meet);
  assert.equal(ind.kop.tekst, 'CONSTRUCTIE');
  assert.equal(ind.hoogte, LEGENDA_MAAT.rij);
  assert.deepEqual(ind.rijen, []);
});

test('voorbeeldstiften passen in het vak van een regel', () => {
  const vak = { x: 0, y: 0, b: LEGENDA_MAAT.voorbeeld, h: LEGENDA_MAAT.rij };
  assert.equal(voorbeeldStift(defs[0], vak).vorm, 'lijn');
  const pijl = voorbeeldStift(defs[1], vak);
  assert.equal(pijl.startY, 7.5);
  const kruis = voorbeeldStift(maakDefinitie('sparing', { id: 's' }), vak);
  assert.ok(kruis.height <= vak.h && kruis.width <= vak.b);
  const punt = voorbeeldStift(maakDefinitie('paal', { id: 'p' }), vak);
  assert.deepEqual([punt.x, punt.y], [vak.b / 2, 7.5]);
});

test('tekenopdrachten: groene kop met vette tekst, per regel voorbeeld, groen vak en tekst', () => {
  const regels = [{ definitie: defs[2], tekst: 'HSB-wand 38x184' }];
  const ind = legendaIndeling({ x: 0, y: 0, kop: 'Dak' }, regels, meet);
  const opdrachten = legendaTekenopdrachten(ind, meet);
  assert.equal(opdrachten[0].soort, 'rechthoek');
  assert.equal(opdrachten[0].vulling, LEGENDA_GROEN);
  assert.equal(opdrachten[1].tekst, 'DAK');
  assert.equal(opdrachten[1].vet, true);
  assert.equal(opdrachten[1].kleur, LEGENDA_TEKST);
  const laatste = opdrachten.at(-1);
  assert.equal(laatste.tekst, 'HSB-wand 38x184');
  assert.equal(laatste.vet, false);
  assert.equal(opdrachten.at(-2).vulling, LEGENDA_GROEN);
  assert.ok(opdrachten.some((o) => o.soort === 'lijn' && o.kleur === '#FF0000'), 'het voorbeeld is de stift zelf');
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/legenda.test.mjs`
Verwacht: FAIL, module niet gevonden.

- [ ] **Stap 3: Schrijf de module**

Bestand `js/annotations/stift/legenda.js`:

```js
// De legenda van een plattegrond: welke regels, in welke volgorde, hoe het
// blok is ingedeeld en hoe het getekend wordt. Puur; dezelfde opdrachten
// gaan naar het canvas en naar de appearance stream.
//
// Opmaak zoals 3052-CP-21: een kop met groene vulling en vetgedrukte
// hoofdletters, daaronder per regel een voorbeeld van de stift en een groen
// vak met de omschrijving. Elk vak is 15 pt hoog, 2 mm marge links en rechts
// van de tekst, 2 mm tussen de regels.

import { SOORTEN, mmNaarPt } from './definities.js';
import { stiftMidden } from './geometrie.js';
import {
  stiftTekenopdrachten, helveticaBreedte, LEGENDA_GROEN, LEGENDA_TEKST, BASISLIJN,
} from './tekenopdrachten.js';

export const LEGENDA_MAAT = Object.freeze({
  rij: 15,
  marge: mmNaarPt(2),
  tussen: mmNaarPt(2),
  voorbeeld: mmNaarPt(25),
  kruisBreedte: mmNaarPt(8),
  grootte: 12,
});

const SOORT_VOLGORDE = new Map(SOORTEN.map((s, i) => [s.id, i]));

/**
 * De regels van een legenda: de definities die binnen het kader gebruikt
 * worden (op dezelfde pagina), in de volgorde van de soorten en daarbinnen
 * die van het paneel. Een stift telt mee als het midden van zijn geometrie
 * binnen het kader ligt; zonder kader telt de hele pagina.
 * @returns {{definitie: object, tekst: string}[]}
 */
export function legendaRegels(legenda, annotaties, definities) {
  const perId = new Map((definities || []).map((d, i) => [d.id, { d, i }]));
  const k = legenda.kader;
  const gebruikt = new Set();
  for (const a of annotaties || []) {
    if (a?.type !== 'stift' || a.page !== legenda.page || !perId.has(a.stiftDefId)) continue;
    if (k) {
      const [mx, my] = stiftMidden(a);
      if (mx < k.x || mx > k.x + k.width || my < k.y || my > k.y + k.height) continue;
    }
    gebruikt.add(a.stiftDefId);
  }
  return [...gebruikt]
    .map((id) => perId.get(id))
    .sort((a, b) => ((SOORT_VOLGORDE.get(a.d.soort) ?? 99) - (SOORT_VOLGORDE.get(b.d.soort) ?? 99)) || (a.i - b.i))
    .map(({ d }) => ({
      definitie: d,
      tekst: d.soort === 'vloer' && d.letter ? `${d.letter}  ${d.omschrijving}` : d.omschrijving,
    }));
}

/**
 * Indeling van het blok vanaf de linkerbovenhoek (legenda.x, legenda.y).
 * @param {(tekst: string, grootte: number, vet: boolean) => number} [meet]
 */
export function legendaIndeling(legenda, regels, meet = helveticaBreedte) {
  const M = LEGENDA_MAAT;
  const kopTekst = String(legenda.kop || 'CONSTRUCTIE').toUpperCase();
  const kolommen = legenda.kolommen === 2 && regels.length > 1 ? 2 : 1;
  const splits = Math.ceil(regels.length / kolommen);
  const perKolom = kolommen === 2 ? [regels.slice(0, splits), regels.slice(splits)] : [regels];
  const tekstVakken = perKolom.map((kol) => Math.max(0, ...kol.map((r) => meet(r.tekst, M.grootte, false))) + 2 * M.marge);
  const kolomBreedtes = tekstVakken.map((b) => M.voorbeeld + M.tussen + b);
  const inhoud = kolomBreedtes.reduce((s, b) => s + b, 0) + (kolommen - 1) * 2 * M.tussen;
  const breedte = Math.max(inhoud, meet(kopTekst, M.grootte, true) + 2 * M.marge);
  const rijen = [];
  let kx = legenda.x;
  perKolom.forEach((kol, k) => {
    kol.forEach((regel, i) => {
      const y = legenda.y + M.rij + M.tussen + i * (M.rij + M.tussen);
      rijen.push({
        ...regel,
        voorbeeldVak: { x: kx, y, b: M.voorbeeld, h: M.rij },
        tekstVak: { x: kx + M.voorbeeld + M.tussen, y, b: tekstVakken[k], h: M.rij },
      });
    });
    kx += kolomBreedtes[k] + 2 * M.tussen;
  });
  const aantal = perKolom[0].length;
  const hoogte = M.rij + (aantal ? M.tussen + aantal * M.rij + (aantal - 1) * M.tussen : 0);
  return {
    x: legenda.x, y: legenda.y, breedte, hoogte, kolommen,
    kop: { x: legenda.x, y: legenda.y, b: breedte, h: M.rij, tekst: kopTekst },
    rijen,
  };
}

/** Een voorbeeldstift die in het voorbeeldvak van een regel past. */
export function voorbeeldStift(definitie, vak) {
  const soort = SOORTEN.find((s) => s.id === definitie.soort);
  const cy = vak.y + vak.h / 2;
  const marge = mmNaarPt(1);
  switch (soort?.vorm) {
    case 'pijl':
      return { type: 'stift', vorm: 'pijl', startX: vak.x + marge, startY: cy, endX: vak.x + vak.b - marge, endY: cy };
    case 'punt':
      return { type: 'stift', vorm: 'punt', x: vak.x + vak.b / 2, y: cy };
    case 'kruis': {
      const b = LEGENDA_MAAT.kruisBreedte;
      return { type: 'stift', vorm: 'kruis', x: vak.x + (vak.b - b) / 2, y: vak.y + 1, width: b, height: vak.h - 2 };
    }
    default:
      return { type: 'stift', vorm: 'lijn', points: [{ x: vak.x + marge, y: cy }, { x: vak.x + vak.b - marge, y: cy }] };
  }
}

/** Tekenopdrachten van het hele blok. */
export function legendaTekenopdrachten(indeling, meet = helveticaBreedte) {
  const M = LEGENDA_MAAT;
  const tekst = (x, vak, inhoud, vet) => ({
    soort: 'tekst', x, y: vak.y + vak.h / 2 + M.grootte * BASISLIJN, tekst: inhoud, grootte: M.grootte,
    vet, kleur: LEGENDA_TEKST, uitlijning: 'links', breedte: meet(inhoud, M.grootte, vet),
  });
  const kop = indeling.kop;
  const opdrachten = [
    { soort: 'rechthoek', x: kop.x, y: kop.y, b: kop.b, h: kop.h, vulling: LEGENDA_GROEN },
    tekst(kop.x + M.marge, kop, kop.tekst, true),
  ];
  for (const r of indeling.rijen) {
    opdrachten.push(...stiftTekenopdrachten(voorbeeldStift(r.definitie, r.voorbeeldVak), r.definitie, { meet }));
    const t = r.tekstVak;
    opdrachten.push({ soort: 'rechthoek', x: t.x, y: t.y, b: t.b, h: t.h, vulling: LEGENDA_GROEN });
    opdrachten.push(tekst(t.x + M.marge, t, r.tekst, false));
  }
  return opdrachten;
}
```

- [ ] **Stap 4: Draai de test opnieuw**

Run: `node --test js/annotations/stift/legenda.test.mjs`
Verwacht: 7 tests, 7 pass.

- [ ] **Stap 5: Werk de spec bij**

Vervang in `docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md` in de alinea **Regel** de tekst "of een kruis van 8 × 8 mm" door "of een kruis van 8 mm breed en zo hoog als de regel".

- [ ] **Stap 6: Registreer de test en commit**

```bash
git add open-pdf-studio/js/annotations/stift/legenda.js open-pdf-studio/js/annotations/stift/legenda.test.mjs open-pdf-studio/package.json docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md
git commit -m "feat(stift): legend rows, layout and drawing commands"
```

## Taak 5: Definities per document (puur)

**Bestanden:**
- Nieuw: `js/annotations/stift/document.js`
- Test: `js/annotations/stift/document.test.mjs`

**Interfaces:**
- Gebruikt: `valideerLijst`, `valideerDefinitie` en `standaardSet` (taak 1).
- Produceert:
  - opzoeken: `definitiesVan(doc)`, `definitieVan(doc, stiftOfId)`, `startsetUitVoorkeuren(prefs)`;
  - aanvullen: `zorgVoorDefinities(doc, prefs)`, `neemDefinitieOver(doc, definitie) → boolean`, `pasCatalogusToe(doc, catalogus)`;
  - gebruik: `gebruik(doc) → Map<id, aantal>`, `zetStiftenOver(doc, vanId, naarId) → {annotationId, van, naar}[]`;
  - legenda: `zichtbareStiften(doc)`, de stiften die niet op een verborgen markeringslaag staan (`isLayerHidden` uit `js/annotations/annotatie-lagen.js`, een pure module);
  - undo: `kopieDefinities(doc)`.
- Voorkeur: `prefs.stiftStartset` (lijst of `null`).

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/stift/document.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  definitiesVan, definitieVan, startsetUitVoorkeuren, zorgVoorDefinities, neemDefinitieOver,
  pasCatalogusToe, gebruik, zetStiftenOver, kopieDefinities, zichtbareStiften,
} from './document.js';
import { standaardSet, maakDefinitie } from './definities.js';

test('een document zonder stiften heeft geen definities, en opzoeken faalt netjes', () => {
  const doc = { annotations: [] };
  assert.deepEqual(definitiesVan(doc), []);
  assert.equal(definitieVan(doc, 'x'), null);
  assert.equal(definitieVan(null, { stiftDefId: 'x' }), null);
});

test('startset: eigen set uit de voorkeuren, anders de ingebouwde', () => {
  assert.deepEqual(startsetUitVoorkeuren({}), standaardSet());
  assert.deepEqual(startsetUitVoorkeuren({ stiftStartset: [] }), standaardSet());
  const eigen = [maakDefinitie('latei', { id: 'eigen' })];
  assert.deepEqual(startsetUitVoorkeuren({ stiftStartset: eigen }).map((d) => d.id), ['eigen']);
});

test('de eerste stift geeft het document de startset, daarna blijft die staan', () => {
  const doc = {};
  const lijst = zorgVoorDefinities(doc, {});
  assert.equal(lijst.length, 11);
  lijst[0].omschrijving = 'aangepast';
  assert.equal(zorgVoorDefinities(doc, {})[0].omschrijving, 'aangepast');
  assert.equal(definitieVan(doc, { stiftDefId: 'sd-std-latei' }).soort, 'latei');
  // De kopie deelt niets met de ingebouwde set.
  assert.equal(standaardSet()[0].omschrijving, 'Bestaande wand');
});

test('overnemen: een onbekende definitie komt erbij, een bekende id niet', () => {
  const doc = {};
  assert.equal(neemDefinitieOver(doc, { id: 'a', soort: 'paal', omschrijving: 'Buispaal' }), true);
  assert.equal(neemDefinitieOver(doc, { id: 'a', soort: 'paal', omschrijving: 'Andere' }), false);
  assert.equal(neemDefinitieOver(doc, 'rommel'), false);
  assert.deepEqual(definitiesVan(doc).map((d) => d.omschrijving), ['Buispaal']);
});

test('de catalogus gaat voor op momentopnamen, alleen-momentopname blijft', () => {
  const doc = {};
  neemDefinitieOver(doc, { id: 'a', soort: 'paal', omschrijving: 'uit momentopname' });
  neemDefinitieOver(doc, { id: 'b', soort: 'latei', omschrijving: 'alleen momentopname' });
  pasCatalogusToe(doc, [{ id: 'a', soort: 'paal', omschrijving: 'uit catalogus' }]);
  assert.deepEqual(definitiesVan(doc).map((d) => [d.id, d.omschrijving]),
    [['a', 'uit catalogus'], ['b', 'alleen momentopname']]);
  pasCatalogusToe(doc, null);
  assert.equal(definitiesVan(doc).length, 2);
});

test('gebruik tellen en stiften overzetten', () => {
  const doc = { annotations: [
    { id: '1', type: 'stift', stiftDefId: 'a' }, { id: '2', type: 'stift', stiftDefId: 'a' },
    { id: '3', type: 'stift', stiftDefId: 'b' }, { id: '4', type: 'box' },
  ] };
  assert.deepEqual([...gebruik(doc)], [['a', 2], ['b', 1]]);
  const over = zetStiftenOver(doc, 'a', 'b');
  assert.deepEqual(over, [{ annotationId: '1', van: 'a', naar: 'b' }, { annotationId: '2', van: 'a', naar: 'b' }]);
  assert.deepEqual([...gebruik(doc)], [['b', 3]]);
});

test('kopie voor undo deelt niets met het document', () => {
  const doc = { stiftDefinities: [maakDefinitie('latei', { id: 'l' })] };
  const kopie = kopieDefinities(doc);
  kopie[0].omschrijving = 'x';
  assert.equal(doc.stiftDefinities[0].omschrijving, 'Latei');
});

test('een stift op een verborgen markeringslaag telt niet mee in de legenda', () => {
  const doc = {
    annotationLayers: [{ id: 'default', visible: true }, { id: 'oud', name: 'Oud', visible: false }],
    annotations: [
      { id: '1', type: 'stift', stiftDefId: 'a' },
      { id: '2', type: 'stift', stiftDefId: 'b', layer: 'oud' },
      { id: '3', type: 'box' },
    ],
  };
  assert.deepEqual(zichtbareStiften(doc).map((a) => a.id), ['1']);
  assert.deepEqual(zichtbareStiften({ annotations: doc.annotations }).map((a) => a.id), ['1', '2']);
  assert.deepEqual(zichtbareStiften(null), []);
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/document.test.mjs`
Verwacht: FAIL, module niet gevonden.

- [ ] **Stap 3: Schrijf de module**

Bestand `js/annotations/stift/document.js`:

```js
// De stiftdefinities van één document: opzoeken, aanvullen, overnemen en
// overzetten. Werkt op een document-object (`doc.stiftDefinities`,
// `doc.annotations`), zonder app-state te importeren.
//
// `doc.stiftDefinities` is undefined zolang het document geen stiften kent;
// het krijgt pas een lijst bij de eerste stift, zodat een document zonder
// stiften niets extra's in de PDF schrijft.
//
// Let op (document-kopieert-bij-toewijzen): de documenten staan in een
// reactieve store. Lees na een toewijzing `doc.stiftDefinities` opnieuw uit
// in plaats van een eerder bewaarde verwijzing te muteren.

import { valideerLijst, valideerDefinitie, standaardSet } from './definities.js';
import { isLayerHidden } from '../annotatie-lagen.js';

const kloon = (waarde) => JSON.parse(JSON.stringify(waarde));

/** De definities van het document (een lege lijst als het er geen heeft). */
export function definitiesVan(doc) {
  return Array.isArray(doc?.stiftDefinities) ? doc.stiftDefinities : [];
}

/** De definitie van een stift (of van een id), of null. */
export function definitieVan(doc, stiftOfId) {
  const id = typeof stiftOfId === 'string' ? stiftOfId : stiftOfId?.stiftDefId;
  return definitiesVan(doc).find((d) => d.id === id) || null;
}

/** De startset: de eigen set uit de voorkeuren, anders de ingebouwde. */
export function startsetUitVoorkeuren(prefs) {
  const eigen = valideerLijst(prefs?.stiftStartset);
  return eigen.length ? eigen : standaardSet();
}

/** Zorg dat het document definities heeft (de startset); geeft de lijst. */
export function zorgVoorDefinities(doc, prefs) {
  if (!Array.isArray(doc.stiftDefinities)) doc.stiftDefinities = kloon(startsetUitVoorkeuren(prefs));
  return doc.stiftDefinities;
}

/**
 * Neem een meegebrachte definitie over (uit een momentopname of het
 * klembord). Kent het document dit id al, dan geldt de eigen definitie.
 * @returns {boolean} of de definitie is toegevoegd
 */
export function neemDefinitieOver(doc, definitie) {
  const def = valideerDefinitie(definitie);
  if (!def) return false;
  if (!Array.isArray(doc.stiftDefinities)) doc.stiftDefinities = [];
  if (doc.stiftDefinities.some((d) => d.id === def.id)) return false;
  doc.stiftDefinities.push(def);
  return true;
}

/**
 * Zet de definities uit de PDF-catalogus: die gaan voor op wat de
 * momentopnamen al hadden toegevoegd; definities die alleen uit een
 * momentopname komen, blijven staan.
 */
export function pasCatalogusToe(doc, catalogus) {
  const lijst = valideerLijst(catalogus);
  if (!lijst.length) return;
  const ids = new Set(lijst.map((d) => d.id));
  const alleenMomentopname = definitiesVan(doc).filter((d) => !ids.has(d.id));
  doc.stiftDefinities = kloon([...lijst, ...alleenMomentopname]);
}

/** Hoe vaak elke definitie gebruikt wordt: Map id → aantal stiften. */
export function gebruik(doc) {
  const telling = new Map();
  for (const a of doc?.annotations || []) {
    if (a?.type === 'stift') telling.set(a.stiftDefId, (telling.get(a.stiftDefId) || 0) + 1);
  }
  return telling;
}

/**
 * Zet alle stiften van definitie `vanId` over naar `naarId`.
 * @returns {{annotationId: string, van: string, naar: string}[]} wat er veranderde (voor undo)
 */
export function zetStiftenOver(doc, vanId, naarId) {
  const gewijzigd = [];
  for (const a of doc?.annotations || []) {
    if (a?.type !== 'stift' || a.stiftDefId !== vanId) continue;
    a.stiftDefId = naarId;
    gewijzigd.push({ annotationId: a.id, van: vanId, naar: naarId });
  }
  return gewijzigd;
}

/**
 * De stiften die in een legenda meetellen: alle stiften van het document,
 * behalve die op een verborgen markeringslaag (die ziet de gebruiker ook niet).
 */
export function zichtbareStiften(doc) {
  return (doc?.annotations || []).filter((a) => a?.type === 'stift' && !isLayerHidden(doc, a));
}

/** Een kopie van de lijst, voor de ongedaan-maakstap. */
export function kopieDefinities(doc) {
  return kloon(definitiesVan(doc));
}
```

- [ ] **Stap 4: Draai de test opnieuw**

Run: `node --test js/annotations/stift/document.test.mjs`
Verwacht: 8 tests, 8 pass.

- [ ] **Stap 5: Registreer de test en commit**

```bash
git add open-pdf-studio/js/annotations/stift/document.js open-pdf-studio/js/annotations/stift/document.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): per-document marker definitions"
```

## Taak 6: Canvas-uitvoerder

**Bestanden:**
- Nieuw: `js/annotations/rendering/stift-draw.js`
- Test: `js/annotations/rendering/stift-draw.test.mjs`

**Interfaces:**
- Gebruikt: `stiftTekenopdrachten` (taak 2); `legendaRegels`, `legendaIndeling` en `legendaTekenopdrachten` (taak 4); `definitieVan`, `definitiesVan` en `zichtbareStiften` (taak 5).
- Produceert:
  - `voerOpdrachtenUit(ctx, opdrachten)`;
  - `tekenStift(ctx, stift, doc)`;
  - `tekenStiftLegenda(ctx, legenda, doc)`. Die zet `legenda.width` en `legenda.height`, maar alleen als ze veranderen.

> Afwijking van de spec: de spec noemt voor de legendaregels een cache per documentversie. Die komt er niet. Het bepalen is één doorgang over de annotaties en kost bij 1000 stiften minder dan 1 ms (meting `legenda` in taak 15); een cache zou alleen extra invalidatie vragen. Taak 15 werkt de spec bij.

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/rendering/stift-draw.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { voerOpdrachtenUit, tekenStift, tekenStiftLegenda } from './stift-draw.js';
import { standaardSet } from '../stift/definities.js';

// Een 2D-context die elke aanroep en elke toewijzing vastlegt.
function nepContext() {
  const log = [];
  const ctx = new Proxy({}, {
    get(_, naam) { return (...args) => log.push([naam, ...args]); },
    set(_, naam, waarde) { log.push([`=${String(naam)}`, waarde]); return true; },
  });
  return { ctx, log };
}

test('een gestreepte lijn: witte onderlaag, dan de strepen in de kleur', () => {
  const { ctx, log } = nepContext();
  voerOpdrachtenUit(ctx, [
    { soort: 'lijn', punten: [[0, 0], [10, 0]], kleur: '#FFFFFF', dikte: 4, streep: null },
    { soort: 'lijn', punten: [[0, 0], [10, 0]], kleur: '#FF0000', dikte: 4, streep: [8, 4] },
  ]);
  const kleuren = log.filter(([n]) => n === '=strokeStyle').map(([, v]) => v);
  assert.deepEqual(kleuren, ['#FFFFFF', '#FF0000']);
  const strepen = log.filter(([n]) => n === 'setLineDash').map(([, v]) => v);
  assert.deepEqual(strepen, [[], [8, 4]]);
  assert.equal(log.filter(([n]) => n === 'stroke').length, 2);
  assert.equal(log.filter(([n]) => n === 'save').length, log.filter(([n]) => n === 'restore').length);
});

test('vlak, cirkel, rechthoek en tekst', () => {
  const { ctx, log } = nepContext();
  voerOpdrachtenUit(ctx, [
    { soort: 'vlak', punten: [[0, 0], [5, 0], [5, 5]], kleur: '#0000FF' },
    { soort: 'cirkel', x: 1, y: 2, r: 3, kleur: '#000000' },
    { soort: 'rechthoek', x: 0, y: 0, b: 10, h: 15, vulling: '#45B5A8' },
    { soort: 'tekst', x: 5, y: 7, tekst: 'A', grootte: 12, vet: true, kleur: '#350E35', uitlijning: 'midden', breedte: 8 },
  ]);
  assert.ok(log.some(([n]) => n === 'closePath'));
  assert.ok(log.some(([n, x, y, r]) => n === 'arc' && x === 1 && y === 2 && r === 3));
  assert.ok(log.some(([n, ...a]) => n === 'fillRect' && a.join() === '0,0,10,15'));
  assert.ok(log.some(([n, v]) => n === '=font' && v.startsWith('bold 12px')));
  assert.ok(log.some(([n, v]) => n === '=textAlign' && v === 'center'));
  assert.ok(log.some(([n, t, x, y]) => n === 'fillText' && t === 'A' && x === 5 && y === 7));
});

test('een stift tekent met zijn definitie uit het document', () => {
  const doc = { stiftDefinities: standaardSet(), annotations: [] };
  const { ctx, log } = nepContext();
  tekenStift(ctx, { type: 'stift', vorm: 'lijn', stiftDefId: 'sd-std-liggerStaal', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }] }, doc);
  assert.ok(log.some(([n, v]) => n === '=strokeStyle' && v === '#7D9EBF'));
});

test('een legenda zet haar maat op de annotatie, alleen als die verandert', () => {
  const doc = { stiftDefinities: standaardSet(), annotations: [
    { type: 'stift', vorm: 'lijn', page: 1, stiftDefId: 'sd-std-nieuweWand', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }] },
  ] };
  const schrijven = [];
  const legenda = new Proxy({ type: 'stiftLegenda', page: 1, x: 100, y: 100, kop: 'Dak', kolommen: 1, kader: null }, {
    set(doel, naam, waarde) { schrijven.push(naam); doel[naam] = waarde; return true; },
  });
  tekenStiftLegenda(nepContext().ctx, legenda, doc);
  assert.ok(legenda.width > 0 && legenda.height > 0);
  assert.deepEqual(schrijven.sort(), ['height', 'width']);
  schrijven.length = 0;
  tekenStiftLegenda(nepContext().ctx, legenda, doc);
  assert.deepEqual(schrijven, [], 'tweede keer niets te schrijven');
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/rendering/stift-draw.test.mjs`
Verwacht: FAIL, module niet gevonden.

- [ ] **Stap 3: Schrijf de module**

Bestand `js/annotations/rendering/stift-draw.js`:

```js
// Stiften en legenda's op het canvas: dezelfde tekenopdrachten als de
// appearance stream (annotations/stift/tekenopdrachten.js en legenda.js),
// hier uitgevoerd op een 2D-context in paginacoördinaten.

import { stiftTekenopdrachten } from '../stift/tekenopdrachten.js';
import { legendaRegels, legendaIndeling, legendaTekenopdrachten } from '../stift/legenda.js';
import { definitieVan, definitiesVan, zichtbareStiften } from '../stift/document.js';

function pad(ctx, punten) {
  ctx.beginPath();
  punten.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

/** Voer tekenopdrachten uit op een canvas-context. */
export function voerOpdrachtenUit(ctx, opdrachten) {
  for (const o of opdrachten) {
    ctx.save();
    switch (o.soort) {
      case 'lijn':
        if (o.punten.length < 2) break;
        ctx.strokeStyle = o.kleur;
        ctx.lineWidth = o.dikte;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.setLineDash(o.streep || []);
        pad(ctx, o.punten);
        ctx.stroke();
        break;
      case 'vlak':
        ctx.fillStyle = o.kleur;
        pad(ctx, o.punten);
        ctx.closePath();
        ctx.fill();
        break;
      case 'cirkel':
        ctx.fillStyle = o.kleur;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'rechthoek':
        ctx.fillStyle = o.vulling;
        ctx.fillRect(o.x, o.y, o.b, o.h);
        break;
      case 'tekst':
        ctx.fillStyle = o.kleur;
        ctx.font = `${o.vet ? 'bold ' : ''}${o.grootte}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = o.uitlijning === 'midden' ? 'center' : 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(o.tekst, o.x, o.y);
        break;
      default:
        break;
    }
    ctx.restore();
  }
}

/** Teken één stift met de definitie uit het document. */
export function tekenStift(ctx, stift, doc) {
  voerOpdrachtenUit(ctx, stiftTekenopdrachten(stift, definitieVan(doc, stift)));
}

/**
 * Teken een legenda. De regels worden bij elke weergave opnieuw bepaald,
 * uit de stiften die niet op een verborgen laag staan;
 * breedte en hoogte van het blok komen op de annotatie, zodat raken en het
 * selectiekader ermee rekenen (alleen schrijven als ze veranderen: de
 * annotatie leeft in een reactieve store).
 */
export function tekenStiftLegenda(ctx, legenda, doc) {
  const regels = legendaRegels(legenda, zichtbareStiften(doc), definitiesVan(doc));
  const indeling = legendaIndeling(legenda, regels);
  if (legenda.width !== indeling.breedte) legenda.width = indeling.breedte;
  if (legenda.height !== indeling.hoogte) legenda.height = indeling.hoogte;
  voerOpdrachtenUit(ctx, legendaTekenopdrachten(indeling));
}
```

- [ ] **Stap 4: Draai de test opnieuw**

Run: `node --test js/annotations/rendering/stift-draw.test.mjs`
Verwacht: 4 tests, 4 pass.

- [ ] **Stap 5: Registreer de test en commit**

```bash
git add open-pdf-studio/js/annotations/rendering/stift-draw.js open-pdf-studio/js/annotations/rendering/stift-draw.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): draw markers and legends on the canvas"
```


## Taak 7: Model, voorkeur en ongedaan maken

**Bestanden:**
- Wijzig:
  - `js/types/annotation.ts`: soorten en velden;
  - `js/types/preferences.ts` en `js/core/constants.ts`: voorkeur `stiftStartset`;
  - `js/core/state.ts`: toestand;
  - `js/types/document.ts`: de definitielijst van een document;
  - `js/core/undo-manager.js`: opdracht `stiftDefinities`.
- Test: `js/annotations/stift/undo-definities.test.mjs`. Die gebruikt `js/core/app-test-hooks.mjs` uit #491 (#503): voer deze taak dus uit op `main` ná #503.

**Interfaces:**
- Produceert: `recordStiftDefinities(oud, nieuw, hernoemd = [])` in `undo-manager.js`; `hernoemd` is `{annotationId, van, naar}[]` uit `zetStiftenOver` (taak 5).
- Toestand: `state.actieveStiftDefId: string|null`, `state._herkaderLegendaId: string|null`. Document: `doc.stiftDefinities?: object[]`.

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/stift/undo-definities.test.mjs`:

```js
// Ongedaan maken van wijzigingen aan de stiftdefinities: één stap per
// wijziging, en bij verwijderen met overzetten ook de verwijzingen van de
// stiften. Echte state-store en undo-manager (zie core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const { standaardSet, maakDefinitie } = await import('./definities.js');
const { zetStiftenOver, kopieDefinities } = await import('./document.js');

function openen(annotations, stiftDefinities) {
  state.documents = [{
    id: 'doc-stift', filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations, stiftDefinities,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('een gewijzigde definitie gaat met één undo terug en met redo weer vooruit', async () => {
  const doc = openen([], standaardSet());
  const oud = kopieDefinities(doc);
  doc.stiftDefinities[1].omschrijving = 'HSB-wand 38x184';
  undo.recordStiftDefinities(oud, kopieDefinities(doc));
  assert.equal(state.documents[0].undoStack.length, 1);
  await undo.undo();
  assert.equal(state.documents[0].stiftDefinities[1].omschrijving, 'Nieuwe wand');
  await undo.redo();
  assert.equal(state.documents[0].stiftDefinities[1].omschrijving, 'HSB-wand 38x184');
});

test('verwijderen met overzetten: undo zet de definitie en de verwijzingen terug', async () => {
  const hsb = maakDefinitie('nieuweWand', { id: 'hsb', omschrijving: 'HSB' });
  const doc = openen([
    { id: 's1', type: 'stift', vorm: 'lijn', page: 1, stiftDefId: 'hsb', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
    { id: 's2', type: 'stift', vorm: 'lijn', page: 1, stiftDefId: 'sd-std-latei', points: [{ x: 0, y: 5 }, { x: 5, y: 5 }] },
  ], [...standaardSet(), hsb]);
  const oud = kopieDefinities(doc);
  const hernoemd = zetStiftenOver(doc, 'hsb', 'sd-std-nieuweWand');
  doc.stiftDefinities = doc.stiftDefinities.filter((d) => d.id !== 'hsb');
  undo.recordStiftDefinities(oud, kopieDefinities(state.documents[0]), hernoemd);
  assert.equal(state.documents[0].annotations[0].stiftDefId, 'sd-std-nieuweWand');

  await undo.undo();
  let d = state.documents[0];
  assert.ok(d.stiftDefinities.some((x) => x.id === 'hsb'));
  assert.equal(d.annotations[0].stiftDefId, 'hsb');
  assert.equal(d.annotations[1].stiftDefId, 'sd-std-latei');

  await undo.redo();
  d = state.documents[0];
  assert.equal(d.annotations[0].stiftDefId, 'sd-std-nieuweWand');
  assert.ok(!d.stiftDefinities.some((x) => x.id === 'hsb'));
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/undo-definities.test.mjs`
Verwacht: FAIL, `undo.recordStiftDefinities is not a function`.

- [ ] **Stap 3: Undo-opdracht in `js/core/undo-manager.js`**

In `applyUndo`, direct na het blok `case 'modifyMeasureScale': { doc.measureScale = clonePlainValue(cmd.oldState); break; }` (dat blok verandert niet met #499, het `rotatePage`-blok wel):

```js
    case 'stiftDefinities': {
      doc.stiftDefinities = clonePlainValue(cmd.oud);
      zetStiftVerwijzingen(doc, cmd.hernoemd, 'van');
      break;
    }
```

In `applyRedo`, direct na `case 'modifyMeasureScale': { doc.measureScale = clonePlainValue(cmd.newState); break; }`:

```js
    case 'stiftDefinities': {
      doc.stiftDefinities = clonePlainValue(cmd.nieuw);
      zetStiftVerwijzingen(doc, cmd.hernoemd, 'naar');
      break;
    }
```

In `commandPreservesSelection`: breid de eerste voorwaarde uit.

```js
  if (cmd.type === 'modifyAnnotation' || cmd.type === 'bulkModify' ||
      cmd.type === 'reorderAnnotations' || cmd.type === 'modifyMeasureScale' ||
      cmd.type === 'stiftDefinities') {
```

Direct vóór `export function recordMeasureScale(`:

```js
// Definitielijst van de stifttekening (annotations/stift/document.js):
// toevoegen, wijzigen, verwijderen en overzetten zijn elk één stap.
// `hernoemd`: de stiften die bij het overzetten een andere definitie kregen.
export function recordStiftDefinities(oud, nieuw, hernoemd = []) {
  execute({
    type: 'stiftDefinities',
    oud: clonePlainValue(oud),
    nieuw: clonePlainValue(nieuw),
    hernoemd: hernoemd.map((h) => ({ ...h })),
  });
}

// Zet de definitieverwijzing van overgezette stiften terug ('van') of weer
// vooruit ('naar'), met één doorgang over de annotaties.
function zetStiftVerwijzingen(doc, hernoemd, kant) {
  if (!hernoemd?.length) return;
  const perId = new Map(doc.annotations.map((a) => [a.id, a]));
  for (const h of hernoemd) {
    const a = perId.get(h.annotationId);
    if (a) a.stiftDefId = h[kant];
  }
}
```

- [ ] **Stap 4: Typen, voorkeur en toestand**

`js/types/annotation.ts`: breid de unie `AnnotationType` uit, zodat het einde luidt:

```ts
  | 'systeemraster'
  | 'stift'
  | 'stiftLegenda';
```

Voeg in dezelfde interface direct na de regel `ifcCategory?: string;        // IFC-categorie (mapping-laag → hoeveelheden)` toe:

```ts
  // Stifttekening (annotations/stift/): de definitie en de tekenwijze; bij
  // een legenda de kop, het aantal kolommen en het kader.
  stiftDefId?: string;
  vorm?: 'lijn' | 'pijl' | 'punt' | 'kruis';
  kop?: string;
  kolommen?: 1 | 2;
  kader?: { x: number; y: number; width: number; height: number } | null;
```

`js/types/preferences.ts`: voeg in de interface `Preferences` direct na `theme: string;` toe:

```ts
  /** Eigen startset stiftdefinities ("Maak standaard"); null = de ingebouwde set. */
  stiftStartset: object[] | null;
```

`js/core/constants.ts`: voeg in `DEFAULT_PREFERENCES` direct na `theme: 'default',` toe:

```ts
  // Stifttekening: eigen startset van definities; null = de ingebouwde set.
  stiftStartset: null,
```

`js/core/state.ts`: in de interface `AppState` direct na `documents: DocumentState[];`, en in de beginwaarde van `createMutable<AppState>({ … })` direct na `documents: [],`:

```ts
  // Stifttekening: de definitie waarmee het gereedschap Stift tekent, en de
  // legenda waarvan het kader opnieuw gesleept wordt.
  actieveStiftDefId: string | null;
  _herkaderLegendaId: string | null;
```

```ts
  actieveStiftDefId: null,
  _herkaderLegendaId: null,
```

`js/types/document.ts`: voeg in de interface `DocumentState` direct na `stylePresets: StylePreset[];` toe:

```ts
  /** Stiftdefinities van de stifttekening (catalog /OPS_StiftDefs); ontbreekt zolang er geen stiften zijn. */
  stiftDefinities?: object[];
```

- [ ] **Stap 5: Draai de test en de controles**

Run: `node --test js/annotations/stift/undo-definities.test.mjs`
Verwacht: 2 tests, 2 pass.

Run: `npx tsc --noEmit`
Verwacht: geen uitvoer.

- [ ] **Stap 6: Registreer de test en commit**

```bash
git add open-pdf-studio/js/core/undo-manager.js open-pdf-studio/js/types/annotation.ts open-pdf-studio/js/types/preferences.ts open-pdf-studio/js/core/constants.ts open-pdf-studio/js/core/state.ts open-pdf-studio/js/types/document.ts open-pdf-studio/js/annotations/stift/undo-definities.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): model types, start-set preference and undo for definitions"
```

## Taak 8: Tekenen, raken, grepen en paginarotatie in de app

**Bestanden:**
- Wijzig:
  - tekenen en omhullende: `js/annotations/rendering.js`, `js/annotations/spatial-index.js`;
  - raken, grepen en vervormen: `js/annotations/geometry.js`, `js/annotations/handles.js`, `js/annotations/transforms.js`;
  - selectie en snappen: `js/core/stores/selection-helpers.ts`, `js/tools/snap-engine.js`;
  - paginarotatie: `js/pdf/renderer.js`.
- Test: `js/annotations/stift/koppeling.test.mjs`.

**Interfaces:**
- Gebruikt:
  - `geometrieSoort`, `raaktStiftPunt`, `stiftPuntVak` en `synchroniseerVak` (taak 3);
  - `definitieVan` (taak 5);
  - `mmNaarPt` (taak 1);
  - `stiftOmhullende` (taak 2);
  - `tekenStift` en `tekenStiftLegenda` (taak 6).
- Een stift gebruikt dus overal de bestaande geometriecode. Een punt raak je binnen de halve symboolmaat; een sparingkruis op zijn diagonalen; een legenda binnen haar blok.

- [ ] **Stap 1: Schrijf de test**

```js
// Stiften doen mee in de bestaande geometrie van de app: omhullende,
// selectiekader, raken, grepen, snappen en paginarotatie. De omhullende en
// het selectiekader worden echt uitgerekend (app-test-hooks laadt de modules
// onder node); de rest controleert dat de aanhaakpunten er staan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const { annotationBounds } = await import('../spatial-index.js');
const { getAnnotationBounds } = await import('../../core/stores/selection-helpers.ts');
const { standaardSet, mmNaarPt } = await import('./definities.js');

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').split('\r\n').join('\n');

function openen(annotations) {
  state.documents = [{
    id: 'doc-koppeling', filePath: null, pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1,
    viewMode: 'single', annotations, stiftDefinities: standaardSet(),
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
}

test('omhullende van een stift volgt de definitie; in de goedkope tekenlus geen antwoord', () => {
  const lijn = { type: 'stift', vorm: 'lijn', page: 1, stiftDefId: 'sd-std-liggerStaal',
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  openen([lijn]);
  const b = annotationBounds(lijn);
  const d = mmNaarPt(1.4);
  assert.ok(Math.abs(b.height - d) < 1e-6 && Math.abs(b.width - (100 + d)) < 1e-6);
  assert.equal(annotationBounds(lijn, { goedkoop: true }), null);
});

test('selectiekader van een punt: de symboolmaat rond het midden', () => {
  const punt = { type: 'stift', vorm: 'punt', page: 1, stiftDefId: 'sd-std-kolom', x: 50, y: 60 };
  openen([punt]);
  const m = mmNaarPt(4);
  assert.deepEqual(getAnnotationBounds(punt), { x: 50 - m / 2, y: 60 - m / 2, width: m, height: m });
  const leg = { type: 'stiftLegenda', page: 1, x: 5, y: 6, width: 70, height: 30 };
  assert.deepEqual(getAnnotationBounds(leg), { x: 5, y: 6, width: 70, height: 30 });
});

test('de aanhaakpunten staan in raken, grepen, vervormen, snappen, tekenen en paginarotatie', () => {
  const geometry = bron('../geometry.js');
  assert.match(geometry, /switch \(geometrieSoort\(ann\)\) \{/);
  assert.match(geometry, /case 'stiftPunt': \{/);
  assert.match(geometry, /ann\.type === 'stift' && ann\.vorm === 'kruis'/);
  assert.match(bron('../handles.js'), /switch \(geometrieSoort\(annotation\)\) \{/);
  assert.match(bron('../transforms.js'), /switch \(geometrieSoort\(annotation\)\) \{/);
  assert.match(bron('../transforms.js'), /if \(annotation\.type === 'stift'\) synchroniseerVak\(annotation\);/);
  assert.match(bron('../../tools/snap-engine.js'), /switch \(geometrieSoort\(ann\)\) \{/);
  const rendering = bron('../rendering.js');
  assert.match(rendering, /case 'stift': \{\n\s*tekenStift\(ctx, annotation,/);
  assert.match(rendering, /case 'stiftLegenda': \{\n\s*tekenStiftLegenda\(ctx, annotation,/);
  const renderer = bron('../../pdf/renderer.js');
  assert.match(renderer, /ann\.type === 'stift' && ann\.vorm === 'punt'/);
  assert.match(renderer, /ann\.type === 'stiftLegenda' && ann\.kader/);
});
```

Sla dit op als `js/annotations/stift/koppeling.test.mjs`.

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/koppeling.test.mjs`
Verwacht: FAIL. De omhullende-test krijgt een verkeerd antwoord (de stift valt in de generieke tak) en de aanhaakpunten ontbreken.

- [ ] **Stap 3: Omhullende in `js/annotations/spatial-index.js`**

Voeg bovenaan de imports toe:

```js
import { getActiveDocument } from '../core/state.js';
import { stiftOmhullende } from './stift/tekenopdrachten.js';
import { definitieVan } from './stift/document.js';
```

In `annotationBounds`, direct na `const type = annotation.type;`:

```js
    // Stift (stifttekening): de omhullende volgt uit de tekenopdrachten, met
    // pijlpunten, lettervak en symboolmaat. In de goedkope tekenlus geen
    // antwoord (gewoon tekenen), net als bij wand en betonbalk. Een legenda
    // draagt haar blokmaat zelf (stift-draw.js).
    if (type === 'stift' || type === 'stiftLegenda') {
      if (goedkoop) return null;
      if (type === 'stiftLegenda') {
        return { x: annotation.x, y: annotation.y, width: annotation.width || 0, height: annotation.height || 0 };
      }
      return stiftOmhullende(annotation, definitieVan(getActiveDocument(), annotation));
    }
```

- [ ] **Stap 4: Selectiekader in `js/core/stores/selection-helpers.ts`**

Voeg de imports toe:

```ts
import { geometrieSoort, stiftPuntVak } from '../../annotations/stift/geometrie.js';
import { definitieVan } from '../../annotations/stift/document.js';
import { mmNaarPt } from '../../annotations/stift/definities.js';
```

Vervang in `getAnnotationBounds` de regel `switch (ann.type) {` door `switch (geometrieSoort(ann)) {`. Voeg direct daaronder toe:

```ts
    case 'stiftPunt': {
      const def = definitieVan(getActiveDocument(), ann) as { maatMm?: number } | null;
      return stiftPuntVak(ann, mmNaarPt(def?.maatMm ?? 4));
    }
    case 'stiftLegenda':
      return { x: ann.x!, y: ann.y!, width: ann.width || 0, height: ann.height || 0 };
```

- [ ] **Stap 5: Raken in `js/annotations/geometry.js`**

Voeg de imports toe:

```js
import { geometrieSoort, raaktStiftPunt } from './stift/geometrie.js';
import { definitieVan } from './stift/document.js';
import { mmNaarPt } from './stift/definities.js';
```

In `findAnnotationAt`, vervang `    switch (ann.type) {` (in de lus, direct na de `raakbaarBijKlik`-regel) door:

```js
    // Stift (stifttekening): een sparingkruis raak je op zijn diagonalen,
    // niet op de onzichtbare rand van zijn rechthoek.
    if (ann.type === 'stift' && ann.vorm === 'kruis') {
      if (distanceToLine(x, y, ann.x, ann.y, ann.x + ann.width, ann.y + ann.height) < tol
        || distanceToLine(x, y, ann.x + ann.width, ann.y, ann.x, ann.y + ann.height) < tol) return ann;
      continue;
    }

    // Een stift gebruikt de geometrie van een lijn of polyline (stift/geometrie.js).
    switch (geometrieSoort(ann)) {
      case 'stiftPunt': {
        const def = definitieVan(doc, ann);
        if (raaktStiftPunt(ann, x, y, tol, mmNaarPt(def?.maatMm ?? 4))) return ann;
        break;
      }
      case 'stiftLegenda':
        if (x >= ann.x - tol && x <= ann.x + (ann.width || 0) + tol
          && y >= ann.y - tol && y <= ann.y + (ann.height || 0) + tol) return ann;
        break;
```

`case 'draw':` volgt daarna ongewijzigd.

In `isPointInsideAnnotation`: vervang `  switch (annotation.type) {` door `  switch (geometrieSoort(annotation)) {` en voeg direct daaronder toe:

```js
    case 'stiftPunt':
      return Math.hypot(x - annotation.x, y - annotation.y)
        <= mmNaarPt(definitieVan(getActiveDocument(), annotation)?.maatMm ?? 4) / 2;
    case 'stiftLegenda':
      return x >= annotation.x && x <= annotation.x + (annotation.width || 0)
        && y >= annotation.y && y <= annotation.y + (annotation.height || 0);
```

- [ ] **Stap 6: Grepen en vervormen**

`js/annotations/handles.js`: importeer `geometrieSoort` uit `./stift/geometrie.js`. Vervang in `getAnnotationHandles` de regel `  switch (annotation.type) {` door `  switch (geometrieSoort(annotation)) {` en voeg direct daaronder toe:

```js
    // Een stiftpunt en een legenda hebben geen grepen: verslepen doet de body.
    case 'stiftPunt':
    case 'stiftLegenda':
      break;
```

`js/annotations/transforms.js`: importeer `geometrieSoort` en `synchroniseerVak` uit `./stift/geometrie.js`. Vervang in `applyResize` de regel `  switch (annotation.type) {` door `  switch (geometrieSoort(annotation)) {`.

Zet direct vóór de laatste regel van `applyResize`, `  annotation.modifiedAt = new Date().toISOString();` na de afsluitende `}` van de `switch`, de regel:

```js
  if (annotation.type === 'stift') synchroniseerVak(annotation);
```

De middengreep loopt via `applyMove`. Zet daar, direct vóór `annotation.modifiedAt = new Date().toISOString();`, dezelfde regel.

- [ ] **Stap 7: Snappunten in `js/tools/snap-engine.js`**

Importeer `geometrieSoort` uit `../annotations/stift/geometrie.js`. Vervang in `extractSnapPoints` en in `getEdgeSegments` de regel `  switch (ann.type) {` door `  switch (geometrieSoort(ann)) {`. Voeg in `extractSnapPoints` direct onder die regel toe:

```js
    case 'stiftPunt':
      if (doCenters) points.push({ x: ann.x, y: ann.y, type: 'center', annotation: ann });
      break;
```

- [ ] **Stap 8: Tekenen in `js/annotations/rendering.js`**

Voeg de imports toe:

```js
import { tekenStift, tekenStiftLegenda } from './rendering/stift-draw.js';
```

`isSelected` komt uit `../core/state.js`. Staat het nog niet in de import van die module, voeg het daar toe.

In `drawAnnotation`, direct vóór `    case 'betonbalk': {`:

```js
    case 'stift': {
      tekenStift(ctx, annotation, state.documents[state.activeDocumentIndex]);
      break;
    }

    case 'stiftLegenda': {
      tekenStiftLegenda(ctx, annotation, state.documents[state.activeDocumentIndex]);
      // Het kader alleen als stippellijn zolang de legenda geselecteerd is;
      // het komt niet in de PDF.
      if (annotation.kader && isSelected(annotation)) {
        const k = annotation.kader;
        const px = 1 / Math.max(ctx.getTransform().a, 1e-6);
        ctx.save();
        ctx.strokeStyle = '#1D90E0';
        ctx.lineWidth = px;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeRect(k.x, k.y, k.width, k.height);
        ctx.restore();
      }
      break;
    }
```

- [ ] **Stap 9: Paginarotatie in `js/pdf/renderer.js`**

Aan het eind van de functie `rotateAnnotation(ann, normDelta, oldW, oldH)`, direct vóór de afsluitende `}`:

```js
  // Stifttekening: de stand van een I-profiel draait mee (0 ↔ 90), en het
  // kader van een legenda draait als rechthoek mee. De inhoud van de legenda
  // blijft rechtop; haar blok zelf ging hierboven al mee als rechthoek.
  if (ann.type === 'stift' && ann.vorm === 'punt' && (normDelta === 90 || normDelta === 270)) {
    ann.rotation = ((ann.rotation || 0) + 90) % 180;
  }
  if (ann.type === 'stiftLegenda' && ann.kader) {
    ann.kader = rotateRect(ann.kader.x, ann.kader.y, ann.kader.width, ann.kader.height, normDelta, oldW, oldH);
  }
```

- [ ] **Stap 10: Draai de test en de controles**

Run: `node --test js/annotations/stift/koppeling.test.mjs`
Verwacht: 3 tests, 3 pass.

Run: `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
Verwacht: alles groen.

- [ ] **Stap 11: Registreer de test en commit**

```bash
git add open-pdf-studio/js/annotations/rendering.js open-pdf-studio/js/annotations/spatial-index.js open-pdf-studio/js/annotations/geometry.js open-pdf-studio/js/annotations/handles.js open-pdf-studio/js/annotations/transforms.js open-pdf-studio/js/core/stores/selection-helpers.ts open-pdf-studio/js/tools/snap-engine.js open-pdf-studio/js/pdf/renderer.js open-pdf-studio/js/annotations/stift/koppeling.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): draw, hit, grips, snapping and page rotation for markers"
```


## Taak 9: Gereedschappen Stift en Legenda

**Bestanden:**
- Nieuw: `js/tools/tools/stift-tool.js`, `js/tools/tools/stift-legenda-tool.js`
- Wijzig:
  - `js/tools/tools/index.js`: registratie;
  - `js/solid/components/ribbon/DrawingTab.jsx`: groep Stiften;
  - `js/i18n/locales/*/ribbon.json`: blok `stiften`.
- Test: `js/annotations/stift/gereedschap.test.mjs`

**Interfaces:**
- Gebruikt: `zorgVoorDefinities` (taak 5), `vormVoorSoort` en `ifcVoorSoort` (taak 1), `stiftTekenopdrachten` (taak 2), `synchroniseerVak` en `haaksPunt` (taak 3), `voerOpdrachtenUit` (taak 6), en `state.actieveStiftDefId` en `state._herkaderLegendaId` (taak 7).
- Produceert:
  - `stiftTool` en `stiftLegendaTool`, geregistreerd als `'stift'` en `'stiftLegenda'`;
  - `actieveDefinitie(state)` uit `stift-tool.js`.
- Een nieuwe stift: `{type: 'stift', page, stiftDefId, vorm, ifcCategory, …geometrie}`. Een nieuwe legenda: `{type: 'stiftLegenda', page, x, y, width: 0, height: 0, kop: 'CONSTRUCTIE', kolommen: 1, kader}`.

- [ ] **Stap 1: Schrijf de test**

```js
// De gereedschappen Stift en Legenda: geregistreerd, en ze maken de juiste
// annotaties. De toolbestanden worden als bron gecontroleerd; het gedrag met
// muis en toetsen komt in taak 15 op de testinstantie.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').split('\r\n').join('\n');

test('beide gereedschappen zijn geregistreerd', () => {
  const index = bron('../../tools/tools/index.js');
  assert.match(index, /registerTool\('stift', stiftTool\);/);
  assert.match(index, /registerTool\('stiftLegenda', stiftLegendaTool\);/);
});

test('de stift-tool maakt een stift met definitie, tekenwijze en IFC, als één undo-stap', () => {
  const tool = bron('../../tools/tools/stift-tool.js');
  assert.match(tool, /type: 'stift', page: pagina, stiftDefId: def\.id,/);
  assert.match(tool, /vorm: vormVoorSoort\(def\.soort\), ifcCategory: ifcVoorSoort\(def\.soort\),/);
  assert.match(tool, /recordAdd\(stift\);/);
  assert.match(tool, /e\.key === 'Enter'/);
  assert.match(tool, /e\.key === 'Backspace'/);
});

test('de legenda-tool: kader slepen, blok plaatsen, of alleen een nieuw kader', () => {
  const tool = bron('../../tools/tools/stift-legenda-tool.js');
  assert.match(tool, /type: 'stiftLegenda'/);
  assert.match(tool, /kop: 'CONSTRUCTIE', kolommen: 1/);
  assert.match(tool, /_herkaderLegendaId/);
  assert.match(tool, /recordModify\(legenda\.id, oud, legenda\);/);
});

test('het lint heeft een groep Stiften met twee knoppen', () => {
  const lint = bron('../../solid/components/ribbon/DrawingTab.jsx');
  assert.match(lint, /id="stift-tool"/);
  assert.match(lint, /id="stift-legenda-tool"/);
});
```

Sla dit op als `js/annotations/stift/gereedschap.test.mjs`.

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/gereedschap.test.mjs`
Verwacht: FAIL, `ENOENT … stift-tool.js`.

- [ ] **Stap 3: Schrijf `js/tools/tools/stift-tool.js`**

```js
// Gereedschap Stift: tekent met de actieve stiftdefinitie. De tekenwijze
// volgt uit de soort van die definitie:
//   lijn   klik per punt; dubbelklik, rechtermuisklik of Enter rondt af,
//          Backspace haalt het laatste punt weg, Escape breekt af
//   pijl   twee klikken, begin en eind
//   punt   één klik
//   kruis  een rechthoek slepen over de opening
// Shift houdt lijn en pijl haaks; de snap-engine werkt zoals bij andere lijnen.

import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { zorgVoorDefinities } from '../../annotations/stift/document.js';
import { vormVoorSoort, ifcVoorSoort } from '../../annotations/stift/definities.js';
import { stiftTekenopdrachten } from '../../annotations/stift/tekenopdrachten.js';
import { synchroniseerVak, haaksPunt } from '../../annotations/stift/geometrie.js';
import { voerOpdrachtenUit } from '../../annotations/rendering/stift-draw.js';

// Wat er nu getekend wordt; één stift tegelijk.
const bezig = { punten: [], start: null, pagina: null };

function leeg() {
  bezig.punten = [];
  bezig.start = null;
  bezig.pagina = null;
}

function hertekenen() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/** De definitie waarmee getekend wordt; het document krijgt zo nodig de startset. */
export function actieveDefinitie(state) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const lijst = zorgVoorDefinities(doc, state.preferences);
  return lijst.find((d) => d.id === state.actieveStiftDefId) || lijst[0] || null;
}

function plaats(def, pagina, geometrie) {
  const doc = getActiveDocument();
  if (!doc || !def) return null;
  const stift = createAnnotation({
    type: 'stift', page: pagina, stiftDefId: def.id,
    vorm: vormVoorSoort(def.soort), ifcCategory: ifcVoorSoort(def.soort),
    ...geometrie,
  });
  synchroniseerVak(stift);
  doc.annotations.push(stift);
  recordAdd(stift);
  hertekenen();
  return stift;
}

function punt(ctx, e, vorige) {
  const snap = ctx.snap(ctx.x, ctx.y, null, bezig.punten);
  const p = snap.snapped ? { x: snap.x, y: snap.y } : { x: ctx.x, y: ctx.y };
  return e?.shiftKey && vorige ? haaksPunt(vorige, p.x, p.y) : p;
}

function voorbeeld(ctx, def, stift) {
  ctx.redraw();
  const c = ctx.canvasCtx;
  if (!c) return;
  c.save();
  applyToolTransform(c);
  voerOpdrachtenUit(c, stiftTekenopdrachten(stift, def));
  c.restore();
}

function rondLijnAf(state) {
  if (bezig.punten.length >= 2) {
    plaats(actieveDefinitie(state), bezig.pagina, { points: bezig.punten.map((p) => ({ x: p.x, y: p.y })) });
  }
  leeg();
  hertekenen();
}

function kruisVak(a, b) {
  return synchroniseerVak({ vorm: 'kruis', x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
}

export const stiftTool = {
  name: 'stift',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const def = actieveDefinitie(ctx.state);
    if (!def) return;
    switch (vormVoorSoort(def.soort)) {
      case 'lijn':
        if (e.button === 2 || e.detail === 2) {
          if (e.button === 2) ctx.state._suppressNextContextmenu = true;
          rondLijnAf(ctx.state);
          return;
        }
        if (bezig.pagina !== null && bezig.pagina !== ctx.pageNum) bezig.punten = [];
        bezig.pagina = ctx.pageNum;
        bezig.punten.push(punt(ctx, e, bezig.punten.at(-1)));
        return;
      case 'punt': {
        const p = punt(ctx, e, null);
        plaats(def, ctx.pageNum, { x: p.x, y: p.y, rotation: 0 });
        return;
      }
      case 'pijl': {
        if (!bezig.start) {
          bezig.start = punt(ctx, e, null);
          bezig.pagina = ctx.pageNum;
          return;
        }
        const b = punt(ctx, e, bezig.start);
        plaats(def, bezig.pagina, { startX: bezig.start.x, startY: bezig.start.y, endX: b.x, endY: b.y });
        leeg();
        return;
      }
      default:
        bezig.start = punt(ctx, e, null);
        bezig.pagina = ctx.pageNum;
    }
  },

  onPointerMove(ctx, e) {
    const def = actieveDefinitie(ctx.state);
    if (!def) return;
    const vorm = vormVoorSoort(def.soort);
    if (vorm === 'lijn' && bezig.punten.length) {
      voorbeeld(ctx, def, { vorm, points: [...bezig.punten, punt(ctx, e, bezig.punten.at(-1))] });
    } else if (vorm === 'pijl' && bezig.start) {
      const b = punt(ctx, e, bezig.start);
      voorbeeld(ctx, def, { vorm, startX: bezig.start.x, startY: bezig.start.y, endX: b.x, endY: b.y });
    } else if (vorm === 'kruis' && bezig.start) {
      voorbeeld(ctx, def, kruisVak(bezig.start, punt(ctx, e, null)));
    }
  },

  onPointerUp(ctx, e) {
    const def = actieveDefinitie(ctx.state);
    if (!def || vormVoorSoort(def.soort) !== 'kruis' || !bezig.start) return;
    const vak = kruisVak(bezig.start, punt(ctx, e, null));
    // Een klik zonder slepen maakt geen sparing.
    if (vak.width > 2 && vak.height > 2) {
      plaats(def, bezig.pagina, { x: vak.x, y: vak.y, width: vak.width, height: vak.height });
    }
    leeg();
    hertekenen();
  },

  onKeyDown(ctx, e) {
    if (!bezig.punten.length) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      rondLijnAf(ctx.state);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      bezig.punten.pop();
      if (!bezig.punten.length) leeg();
      hertekenen();
    }
  },

  onEscape() {
    const wasBezig = bezig.punten.length > 0 || !!bezig.start;
    leeg();
    hertekenen();
    return wasBezig;
  },

  onDeactivate(ctx) {
    leeg();
    ctx.redraw();
  },
};
```

- [ ] **Stap 4: Schrijf `js/tools/tools/stift-legenda-tool.js`**

```js
// Gereedschap Legenda (stifttekening): sleep eerst een kader om de
// plattegrond (een klik zonder slepen: de hele pagina telt), klik daarna waar
// het legendablok komt. Staat state._herkaderLegendaId, dan krijgt die
// legenda alleen een nieuw kader (eigenschappenpaneel, "Kader opnieuw slepen").

import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { createAnnotation, cloneAnnotation } from '../../annotations/factory.js';
import { recordAdd, recordModify } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { zorgVoorDefinities } from '../../annotations/stift/document.js';

const fase = { stap: 'kader', start: null, kader: null, pagina: null };

function opnieuw() {
  fase.stap = 'kader';
  fase.start = null;
  fase.kader = null;
  fase.pagina = null;
}

function hertekenen() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function naarSelectie() {
  import('../manager.js').then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function rechthoek(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function tekenKader(ctx, kader) {
  ctx.redraw();
  const c = ctx.canvasCtx;
  if (!c || !kader) return;
  const px = 1 / (ctx.scale || 1);
  c.save();
  applyToolTransform(c);
  c.strokeStyle = '#1D90E0';
  c.lineWidth = px;
  c.setLineDash([6 * px, 4 * px]);
  c.strokeRect(kader.x, kader.y, kader.width, kader.height);
  c.restore();
}

export const stiftLegendaTool = {
  name: 'stiftLegenda',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    if (fase.stap === 'kader') {
      fase.start = { x: ctx.x, y: ctx.y };
      fase.pagina = ctx.pageNum;
      return;
    }
    const doc = getActiveDocument();
    if (!doc) return;
    zorgVoorDefinities(doc, ctx.state.preferences);
    const legenda = createAnnotation({
      type: 'stiftLegenda', page: fase.pagina ?? ctx.pageNum, x: ctx.x, y: ctx.y, width: 0, height: 0,
      kop: 'CONSTRUCTIE', kolommen: 1, kader: fase.kader,
    });
    doc.annotations.push(legenda);
    recordAdd(legenda);
    opnieuw();
    hertekenen();
    naarSelectie();
  },

  onPointerMove(ctx, e) {
    if (fase.stap === 'kader' && fase.start && (e.buttons & 1)) {
      tekenKader(ctx, rechthoek(fase.start, { x: ctx.x, y: ctx.y }));
    } else if (fase.stap === 'plaats') {
      tekenKader(ctx, fase.kader);
    }
  },

  onPointerUp(ctx) {
    if (fase.stap !== 'kader' || !fase.start) return;
    const r = rechthoek(fase.start, { x: ctx.x, y: ctx.y });
    const scale = ctx.scale || 1;
    const kader = r.width * scale > 5 && r.height * scale > 5 ? r : null;
    const herId = ctx.state._herkaderLegendaId;
    if (herId) {
      const legenda = getActiveDocument()?.annotations.find((a) => a.id === herId);
      if (legenda) {
        const oud = cloneAnnotation(legenda);
        legenda.kader = kader;
        legenda.modifiedAt = new Date().toISOString();
        recordModify(legenda.id, oud, legenda);
      }
      ctx.state._herkaderLegendaId = null;
      opnieuw();
      hertekenen();
      naarSelectie();
      return;
    }
    fase.kader = kader;
    fase.stap = 'plaats';
    fase.start = null;
    tekenKader(ctx, kader);
  },

  onEscape(ctx) {
    const wasBezig = fase.stap !== 'kader' || !!fase.start;
    opnieuw();
    ctx.state._herkaderLegendaId = null;
    hertekenen();
    return wasBezig;
  },

  onDeactivate(ctx) {
    opnieuw();
    ctx.state._herkaderLegendaId = null;
    ctx.redraw();
  },
};
```

- [ ] **Stap 5: Registreer en zet de knoppen op het lint**

`js/tools/tools/index.js`: importeer bovenaan `import { stiftTool } from './stift-tool.js';` en `import { stiftLegendaTool } from './stift-legenda-tool.js';`. Voeg in `registerAllTools()`, direct na `registerTool('count', shapeTool);`, toe:

```js
  // Stifttekening (annotations/stift/): stiften en de legenda per plattegrond.
  registerTool('stift', stiftTool);
  registerTool('stiftLegenda', stiftLegendaTool);
```

`js/solid/components/ribbon/DrawingTab.jsx`:
- importeer `switchToLeftPanelTab` uit `../../stores/leftPanelStore.js`;
- zet naast de andere lokale icoon-constanten:

```jsx
const stiftIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="4 2"><path d="M3 20L21 4"/></svg>`;
const legendaIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="4"/><path d="M4 11h5M4 16h5" stroke-width="2.5"/><rect x="11" y="9.5" width="10" height="3"/><rect x="11" y="14.5" width="10" height="3"/></svg>`;
```

Zet de groep direct vóór `<RibbonGroup label={t('comment.line') || 'Lijn'}>`:

```jsx
        <RibbonGroup label={t('stiften.groep')}>
          <RibbonButton id="stift-tool" title={t('stiften.stiftTitel')} icon={stiftIcon} label={t('stiften.stift')}
            disabled={ro()} active={state.currentTool === 'stift'}
            onClick={() => { switchToLeftPanelTab('stiften'); setTool('stift'); }} />
          <RibbonButton id="stift-legenda-tool" title={t('stiften.legendaTitel')} icon={legendaIcon} label={t('stiften.legenda')}
            disabled={ro()} active={state.currentTool === 'stiftLegenda'} onClick={() => setTool('stiftLegenda')} />
        </RibbonGroup>
```

Voeg in elke `js/i18n/locales/<taal>/ribbon.json` een blok `"stiften"` toe, met dezelfde sleutels in alle 39 talen. Engels en Nederlands:

```json
"stiften": {
  "groep": "Markers",
  "stift": "Marker",
  "stiftTitel": "Draw with the active marker definition",
  "legenda": "Legend",
  "legendaTitel": "Place a legend: drag a frame around the floor plan, then click where the block goes"
}
```

```json
"stiften": {
  "groep": "Stiften",
  "stift": "Stift",
  "stiftTitel": "Tekenen met de actieve stiftdefinitie",
  "legenda": "Legenda",
  "legendaTitel": "Legenda plaatsen: sleep een kader om de plattegrond en klik waar het blok komt"
}
```

De andere 37 talen krijgen een echte vertaling, met het woord dat die taal al voor "legenda" en "tekenen" gebruikt. Taak 10 controleert alle talen.

- [ ] **Stap 6: Draai de test en de controles**

Run: `node --test js/annotations/stift/gereedschap.test.mjs`
Verwacht: 4 tests, 4 pass.

Run: `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
Verwacht: groen.

- [ ] **Stap 7: Registreer de test en commit**

```bash
git add open-pdf-studio/js/tools/tools/stift-tool.js open-pdf-studio/js/tools/tools/stift-legenda-tool.js open-pdf-studio/js/tools/tools/index.js open-pdf-studio/js/solid/components/ribbon/DrawingTab.jsx open-pdf-studio/js/i18n/locales open-pdf-studio/js/annotations/stift/gereedschap.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): marker and legend tools with ribbon buttons"
```

## Taak 10: Paneel Stiften, vensters en eigenschappen

**Bestanden:**
- Nieuw:
  - `js/solid/components/left-panel/panels/StiftenPanel.jsx` en `StiftVoorbeeld.jsx`;
  - `js/solid/components/dialogs/StiftDefinitieDialog.jsx` en `StiftVerwijderenDialog.jsx`;
  - `js/solid/components/properties-panel/StiftSection.jsx`.
- Wijzig:
  - `js/solid/components/left-panel/LeftPanel.jsx`, `js/solid/data/leftPanelIcons.js`;
  - `js/solid/components/DialogHost.jsx`, `js/solid/components/properties-panel/PropertiesPanel.jsx`;
  - `js/solid/stores/propertiesStore.js`, `styles/panels.css`;
  - `js/i18n/locales/*/properties.json` (blok `stiften`) en `js/i18n/locales/*/dialogs.json` (blokken `stiftDefinitie`, `stiftVerwijderen`).
- Test: `js/annotations/stift/stift-i18n.test.mjs`

**Interfaces:**
- Gebruikt:
  - taak 1: `SOORTEN`, `maakDefinitie`, `vormVoorSoort`, `valideerDefinitie`, `PUNTVORMEN`, `LIJNSOORTEN`;
  - taak 5: `definitiesVan`, `definitieVan`, `startsetUitVoorkeuren`, `zorgVoorDefinities`, `gebruik`, `zetStiftenOver`, `kopieDefinities`;
  - taak 7: `recordStiftDefinities`;
  - taak 4: `LEGENDA_MAAT`, `voorbeeldStift`;
  - taak 2 en 6: `stiftTekenopdrachten`, `voerOpdrachtenUit`;
  - de app: `openDialog(name, data)`, `setTool`, `savePreferences`, `updateAnnotProp`.
- Vensters: `'stift-definitie'` met `{id}` en `'stift-verwijderen'` met `{id}`. Tabblad: `'stiften'`.

- [ ] **Stap 1: Schrijf de taaltest**

```js
// Alle 39 talen hebben de teksten van de stifttekening, echt vertaald: zelfde
// sleutels als het Engels, niet leeg, zelfde plaatshouders, en per taal
// hooguit een paar teksten die gelijk zijn aan het Engels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const TALEN = join(HIER, '../../i18n/locales');
const lees = (taal, bestand) => JSON.parse(readFileSync(join(TALEN, taal, bestand), 'utf8'));
const blokken = (taal) => ({
  ribbon: lees(taal, 'ribbon.json').stiften,
  properties: lees(taal, 'properties.json').stiften,
  definitie: lees(taal, 'dialogs.json').stiftDefinitie,
  verwijderen: lees(taal, 'dialogs.json').stiftVerwijderen,
});
const plat = (obj, pre = '') => Object.entries(obj || {}).flatMap(([k, v]) =>
  (v && typeof v === 'object' ? plat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
const plaatshouders = (s) => (String(s).match(/\{\{\w+\}\}/g) || []).sort();

test('alle 39 talen hebben dezelfde stiftteksten als het Engels, niet leeg', () => {
  const talen = readdirSync(TALEN);
  assert.equal(talen.length, 39);
  const en = Object.fromEntries(Object.entries(blokken('en')).map(([k, v]) => [k, Object.fromEntries(plat(v))]));
  assert.ok(Object.keys(en.properties).length >= 30, 'het paneel heeft zijn teksten');
  for (const taal of talen) {
    const b = blokken(taal);
    for (const [naam, engels] of Object.entries(en)) {
      const hier = Object.fromEntries(plat(b[naam]));
      assert.deepEqual(Object.keys(hier).sort(), Object.keys(engels).sort(), `${taal} ${naam}`);
      for (const [sleutel, tekst] of Object.entries(hier)) {
        assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} ${naam}.${sleutel} is leeg`);
        assert.deepEqual(plaatshouders(tekst), plaatshouders(engels[sleutel]), `${taal} ${naam}.${sleutel}`);
      }
    }
  }
});

test('elke taal behalve het Engels is echt vertaald', () => {
  const en = Object.values(blokken('en')).flatMap((b) => plat(b)).map(([, v]) => v);
  for (const taal of readdirSync(TALEN).filter((t) => t !== 'en')) {
    const hier = Object.values(blokken(taal)).flatMap((b) => plat(b)).map(([, v]) => v);
    const gelijk = hier.filter((t, i) => t === en[i]).length;
    assert.ok(gelijk <= 4, `${taal}: ${gelijk} teksten gelijk aan het Engels`);
  }
});
```

Sla dit op als `js/annotations/stift/stift-i18n.test.mjs`.

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/stift-i18n.test.mjs`
Verwacht: FAIL. `properties.stiften` ontbreekt nog; het lint-blok uit taak 9 is er al.

- [ ] **Stap 3: Teksten in alle 39 talen**

`properties.json`, blok `"stiften"`, Engels:

```json
"stiften": {
  "titel": "Markers",
  "soortKiezen": "Kind for a new definition",
  "nieuw": "New",
  "leeg": "No marker definitions",
  "bewerken": "Edit definition",
  "verwijderen": "Delete definition",
  "legendaPlaatsen": "Place legend",
  "maakStandaard": "Make default",
  "maakStandaardTitel": "Use these definitions as the start set for new documents",
  "standaardHerstellen": "Restore default",
  "standaardHerstellenTitel": "Use the built-in start set again for new documents",
  "stiftSectie": "Marker",
  "definitie": "Definition",
  "bewerkDefinitie": "Edit definition…",
  "legendaSectie": "Legend",
  "kop": "Heading",
  "kolommen": "Columns",
  "kaderOpnieuw": "Drag frame again",
  "kaderWissen": "Remove frame",
  "soort": {
    "bestaandeWand": "Existing wall",
    "nieuweWand": "New wall",
    "stabiliteitswand": "Stability wall",
    "liggerStaal": "Steel beam",
    "liggerHout": "Timber beam",
    "latei": "Lintel",
    "vloer": "Joists or floor",
    "kolom": "Column",
    "fundering": "Foundation beam or strip",
    "paal": "Pile",
    "sparing": "Opening"
  }
}
```

Nederlands:

```json
"stiften": {
  "titel": "Stiften",
  "soortKiezen": "Soort voor een nieuwe definitie",
  "nieuw": "Nieuw",
  "leeg": "Geen stiftdefinities",
  "bewerken": "Definitie bewerken",
  "verwijderen": "Definitie verwijderen",
  "legendaPlaatsen": "Legenda plaatsen",
  "maakStandaard": "Maak standaard",
  "maakStandaardTitel": "Gebruik deze definities als startset voor nieuwe documenten",
  "standaardHerstellen": "Standaard herstellen",
  "standaardHerstellenTitel": "Gebruik weer de ingebouwde startset voor nieuwe documenten",
  "stiftSectie": "Stift",
  "definitie": "Definitie",
  "bewerkDefinitie": "Definitie bewerken…",
  "legendaSectie": "Legenda",
  "kop": "Kop",
  "kolommen": "Kolommen",
  "kaderOpnieuw": "Kader opnieuw slepen",
  "kaderWissen": "Kader wissen",
  "soort": {
    "bestaandeWand": "Bestaande wand",
    "nieuweWand": "Nieuwe wand",
    "stabiliteitswand": "Stabiliteitswand",
    "liggerStaal": "Ligger staal",
    "liggerHout": "Ligger hout",
    "latei": "Latei",
    "vloer": "Balklaag of vloer",
    "kolom": "Kolom",
    "fundering": "Funderingsbalk of strook",
    "paal": "Paal",
    "sparing": "Sparing"
  }
}
```

`dialogs.json`, blokken `"stiftDefinitie"` en `"stiftVerwijderen"`, Engels:

```json
"stiftDefinitie": {
  "titel": "Marker definition",
  "omschrijving": "Description",
  "kleur": "Colour",
  "lijnsoort": "Line style",
  "doorgetrokken": "Solid",
  "gestreept": "Dashed",
  "dikte": "Thickness (mm)",
  "letter": "Letter",
  "letterDubbel": "Another floor definition already uses this letter",
  "puntvorm": "Symbol",
  "vierkant": "Square",
  "iProfiel": "I-section",
  "cirkel": "Circle",
  "maat": "Size (mm)"
},
"stiftVerwijderen": {
  "titel": "Delete marker definition",
  "inGebruik": "{{count}} markers use “{{naam}}”.",
  "overzettenNaar": "Move them to",
  "geenAlternatief": "There is no other definition of this kind to move them to."
}
```

Nederlands:

```json
"stiftDefinitie": {
  "titel": "Stiftdefinitie",
  "omschrijving": "Omschrijving",
  "kleur": "Kleur",
  "lijnsoort": "Lijnsoort",
  "doorgetrokken": "Doorgetrokken",
  "gestreept": "Gestreept",
  "dikte": "Dikte (mm)",
  "letter": "Letter",
  "letterDubbel": "Een andere vloerdefinitie gebruikt deze letter al",
  "puntvorm": "Symbool",
  "vierkant": "Vierkant",
  "iProfiel": "I-profiel",
  "cirkel": "Cirkel",
  "maat": "Maat (mm)"
},
"stiftVerwijderen": {
  "titel": "Stiftdefinitie verwijderen",
  "inGebruik": "{{count}} stiften gebruiken “{{naam}}”.",
  "overzettenNaar": "Zet ze over naar",
  "geenAlternatief": "Er is geen andere definitie van deze soort om ze naar over te zetten."
}
```

De andere 37 talen krijgen een echte vertaling met de terminologie van die taal. Houd de volgorde van de sleutels gelijk aan het Engels; de taaltest vergelijkt per positie.

- [ ] **Stap 4: `StiftVoorbeeld.jsx`**

```jsx
// Klein voorbeeld van een stiftdefinitie: dezelfde voorbeeldstift als in de
// legenda (annotations/stift/legenda.js), op een canvas van 80 × 20 px.
import { createEffect } from 'solid-js';
import { LEGENDA_MAAT, voorbeeldStift } from '../../../../annotations/stift/legenda.js';
import { stiftTekenopdrachten } from '../../../../annotations/stift/tekenopdrachten.js';
import { voerOpdrachtenUit } from '../../../../annotations/rendering/stift-draw.js';

const BREEDTE = 80;
const HOOGTE = 20;

export default function StiftVoorbeeld(props) {
  let canvas;
  createEffect(() => {
    // Alle velden lezen: het voorbeeld loopt mee met een gewijzigde definitie.
    const def = props.definitie ? { ...props.definitie } : null;
    if (!canvas || !def) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(BREEDTE * dpr);
    canvas.height = Math.round(HOOGTE * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, BREEDTE, HOOGTE);
    const vak = { x: 0, y: 0, b: LEGENDA_MAAT.voorbeeld, h: LEGENDA_MAAT.rij };
    const schaal = Math.min(BREEDTE / vak.b, HOOGTE / vak.h);
    ctx.scale(schaal, schaal);
    voerOpdrachtenUit(ctx, stiftTekenopdrachten(voorbeeldStift(def, vak), def));
  });
  return <canvas ref={canvas} class="stift-voorbeeld" style={{ width: `${BREEDTE}px`, height: `${HOOGTE}px` }} />;
}
```

- [ ] **Stap 5: `StiftenPanel.jsx`**

```jsx
// Paneel Stiften (stifttekening): de definities van het document, gegroepeerd
// per soort, met een voorbeeld en het aantal stiften per definitie. Een klik
// tekent met die definitie. Heeft het document nog geen definities, dan toont
// het paneel de startset; die komt in het document zodra je er iets mee doet.
import { For, Show, createMemo, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { state, getActiveDocument } from '../../../../core/state.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { SOORTEN, maakDefinitie } from '../../../../annotations/stift/definities.js';
import {
  definitiesVan, startsetUitVoorkeuren, zorgVoorDefinities, gebruik, kopieDefinities,
} from '../../../../annotations/stift/document.js';
import { recordStiftDefinities } from '../../../../core/undo-manager.js';
import { savePreferences } from '../../../../core/preferences.js';
import { setTool } from '../../../../tools/manager.js';
import { openDialog } from '../../../stores/dialogStore.js';
import StiftVoorbeeld from './StiftVoorbeeld.jsx';

export default function StiftenPanel() {
  const { t } = useTranslation('properties');
  const zichtbaar = () => activeTab() === 'stiften';
  const doc = () => getActiveDocument();
  // Alleen rekenen als het paneel te zien is (les van #491).
  const telling = createMemo(() => (zichtbaar() ? gebruik(doc()) : new Map()));
  const groepen = createMemo(() => {
    if (!zichtbaar()) return [];
    const eigen = definitiesVan(doc());
    const lijst = eigen.length ? eigen : startsetUitVoorkeuren(state.preferences);
    return SOORTEN.map((s) => ({ soort: s, definities: lijst.filter((d) => d.soort === s.id) }))
      .filter((g) => g.definities.length > 0);
  });
  const [nieuweSoort, setNieuweSoort] = createSignal('nieuweWand');

  // Vóór elke handeling: het document krijgt zo nodig de startset.
  const metDefinities = (fn) => {
    const d = doc();
    if (!d) return;
    zorgVoorDefinities(d, state.preferences);
    fn(d);
  };

  const kies = (def) => metDefinities(() => {
    state.actieveStiftDefId = def.id;
    setTool('stift');
  });

  const bewerk = (def) => metDefinities(() => openDialog('stift-definitie', { id: def.id }));

  const voegToe = () => metDefinities((d) => {
    const oud = kopieDefinities(d);
    const def = maakDefinitie(nieuweSoort(), { bestaande: definitiesVan(d) });
    d.stiftDefinities.push(def);
    recordStiftDefinities(oud, kopieDefinities(d));
    openDialog('stift-definitie', { id: def.id });
  });

  const verwijder = (def) => metDefinities((d) => {
    if ((gebruik(d).get(def.id) || 0) > 0) {
      openDialog('stift-verwijderen', { id: def.id });
      return;
    }
    const oud = kopieDefinities(d);
    d.stiftDefinities = definitiesVan(d).filter((x) => x.id !== def.id);
    recordStiftDefinities(oud, kopieDefinities(d));
  });

  const maakStandaard = () => metDefinities((d) => {
    state.preferences.stiftStartset = kopieDefinities(d);
    savePreferences();
  });

  const herstelStandaard = () => {
    state.preferences.stiftStartset = null;
    savePreferences();
  };

  const naam = (def) => (def.soort === 'vloer' && def.letter ? `${def.letter}  ${def.omschrijving}` : def.omschrijving);

  return (
    <div class={`left-panel-content${zichtbaar() ? ' active' : ''}`} id="stiften-panel">
      <div class="left-panel-header"><span>{t('stiften.titel')}</span></div>
      <div class="stiften-werkbalk">
        <select value={nieuweSoort()} title={t('stiften.soortKiezen')} onChange={(e) => setNieuweSoort(e.target.value)}>
          <For each={SOORTEN}>{(s) => <option value={s.id}>{t(`stiften.soort.${s.id}`)}</option>}</For>
        </select>
        <button class="pref-btn pref-btn-secondary" disabled={!doc()} onClick={voegToe}>{t('stiften.nieuw')}</button>
      </div>
      <div class="stiften-lijst">
        <Show when={groepen().length > 0} fallback={<div class="layers-empty">{t('stiften.leeg')}</div>}>
          <For each={groepen()}>{(g) => (
            <div class="stift-groep">
              <div class="stift-groep-kop">{t(`stiften.soort.${g.soort.id}`)}</div>
              <For each={g.definities}>{(def) => (
                <div
                  class={`stift-rij${state.actieveStiftDefId === def.id && state.currentTool === 'stift' ? ' actief' : ''}`}
                  onClick={() => kies(def)}
                  onDblClick={() => bewerk(def)}
                >
                  <StiftVoorbeeld definitie={def} />
                  <span class="stift-naam">{naam(def)}</span>
                  <span class="stift-aantal">{telling().get(def.id) || 0}</span>
                  <button class="stift-knop" title={t('stiften.bewerken')}
                    onClick={(e) => { e.stopPropagation(); bewerk(def); }}>…</button>
                  <button class="stift-knop" title={t('stiften.verwijderen')}
                    onClick={(e) => { e.stopPropagation(); verwijder(def); }}>×</button>
                </div>
              )}</For>
            </div>
          )}</For>
        </Show>
      </div>
      <div class="stiften-voet">
        <button class="pref-btn pref-btn-secondary" disabled={!doc()} onClick={() => setTool('stiftLegenda')}>{t('stiften.legendaPlaatsen')}</button>
        <button class="pref-btn pref-btn-secondary" disabled={!doc()} title={t('stiften.maakStandaardTitel')} onClick={maakStandaard}>{t('stiften.maakStandaard')}</button>
        <button class="pref-btn pref-btn-secondary" title={t('stiften.standaardHerstellenTitel')} onClick={herstelStandaard}>{t('stiften.standaardHerstellen')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Stap 6: `StiftDefinitieDialog.jsx`**

```jsx
// Bewerkvenster van een stiftdefinitie. OK past de definitie aan als één
// ongedaan-maakstap; alle stiften en legenda's met deze definitie volgen.
import { createSignal, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { definitiesVan, definitieVan, kopieDefinities } from '../../../annotations/stift/document.js';
import { vormVoorSoort, valideerDefinitie, PUNTVORMEN, LIJNSOORTEN } from '../../../annotations/stift/definities.js';
import { recordStiftDefinities } from '../../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

const PUNTVORM_TEKST = { vierkant: 'vierkant', 'i-profiel': 'iProfiel', cirkel: 'cirkel' };

export default function StiftDefinitieDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const doc = getActiveDocument();
  const origineel = definitieVan(doc, props.data?.id);
  const close = () => closeDialog('stift-definitie');
  if (!origineel) {
    queueMicrotask(close);
    return null;
  }
  const vorm = vormVoorSoort(origineel.soort);
  const [omschrijving, setOmschrijving] = createSignal(origineel.omschrijving);
  const [kleur, setKleur] = createSignal(origineel.kleur);
  const [lijnsoort, setLijnsoort] = createSignal(origineel.lijnsoort);
  const [dikte, setDikte] = createSignal(origineel.dikteMm);
  const [letter, setLetter] = createSignal(origineel.letter || '');
  const [puntvorm, setPuntvorm] = createSignal(origineel.puntvorm || 'vierkant');
  const [maat, setMaat] = createSignal(origineel.maatMm || 4);

  const letterDubbel = () => origineel.soort === 'vloer' && definitiesVan(doc).some((d) =>
    d.id !== origineel.id && d.soort === 'vloer' && String(d.letter || '').toUpperCase() === letter().toUpperCase());

  const opslaan = () => {
    const oud = kopieDefinities(doc);
    const nieuw = valideerDefinitie({
      ...origineel, omschrijving: omschrijving(), kleur: kleur(), lijnsoort: lijnsoort(),
      dikteMm: Number(dikte()), letter: letter(), puntvorm: puntvorm(), maatMm: Number(maat()),
    });
    doc.stiftDefinities = definitiesVan(doc).map((d) => (d.id === origineel.id ? nieuw : d));
    recordStiftDefinities(oud, kopieDefinities(doc));
    if (doc.viewMode === 'continuous') redrawContinuous(); else redrawAnnotations();
    close();
  };

  const footer = (
    <>
      <div></div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={opslaan}>{tCommon('ok')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('stiftDefinitie.titel')}
      overlayClass="extract-pages-overlay"
      dialogClass="extract-pages-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={close}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row">
          <label class="extract-pages-label">{t('stiftDefinitie.omschrijving')}</label>
          <input type="text" class="extract-pages-input-wide" value={omschrijving()} onInput={(e) => setOmschrijving(e.target.value)} />
        </div>
        <div class="extract-pages-row">
          <label class="extract-pages-label">{t('stiftDefinitie.kleur')}</label>
          <input type="color" value={kleur()} onInput={(e) => setKleur(e.target.value)} />
        </div>
        <Show when={vorm === 'lijn'}>
          <div class="extract-pages-row">
            <label class="extract-pages-label">{t('stiftDefinitie.lijnsoort')}</label>
            <select value={lijnsoort()} onChange={(e) => setLijnsoort(e.target.value)}>
              <For each={LIJNSOORTEN}>{(l) => <option value={l}>{t(`stiftDefinitie.${l}`)}</option>}</For>
            </select>
          </div>
        </Show>
        <Show when={vorm !== 'punt'}>
          <div class="extract-pages-row">
            <label class="extract-pages-label">{t('stiftDefinitie.dikte')}</label>
            <input type="number" min="0.05" max="20" step="0.05" value={dikte()} onInput={(e) => setDikte(e.target.value)} />
          </div>
        </Show>
        <Show when={origineel.soort === 'vloer'}>
          <div class="extract-pages-row">
            <label class="extract-pages-label">{t('stiftDefinitie.letter')}</label>
            <input type="text" maxLength="2" value={letter()} onInput={(e) => setLetter(e.target.value.toUpperCase())} />
          </div>
          <Show when={letterDubbel()}>
            <div class="extract-pages-row extract-pages-info">{t('stiftDefinitie.letterDubbel')}</div>
          </Show>
        </Show>
        <Show when={vorm === 'punt'}>
          <div class="extract-pages-row">
            <label class="extract-pages-label">{t('stiftDefinitie.puntvorm')}</label>
            <select value={puntvorm()} onChange={(e) => setPuntvorm(e.target.value)}>
              <For each={PUNTVORMEN}>{(p) => <option value={p}>{t(`stiftDefinitie.${PUNTVORM_TEKST[p]}`)}</option>}</For>
            </select>
          </div>
          <div class="extract-pages-row">
            <label class="extract-pages-label">{t('stiftDefinitie.maat')}</label>
            <input type="number" min="0.5" max="50" step="0.5" value={maat()} onInput={(e) => setMaat(e.target.value)} />
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
```

- [ ] **Stap 7: `StiftVerwijderenDialog.jsx`**

```jsx
// Een definitie verwijderen die nog gebruikt wordt: kies naar welke definitie
// van dezelfde soort de stiften overgaan. Eén ongedaan-maakstap, inclusief de
// verwijzingen van de stiften.
import { createSignal, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import {
  definitiesVan, definitieVan, gebruik, zetStiftenOver, kopieDefinities,
} from '../../../annotations/stift/document.js';
import { recordStiftDefinities } from '../../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

export default function StiftVerwijderenDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const doc = getActiveDocument();
  const def = definitieVan(doc, props.data?.id);
  const close = () => closeDialog('stift-verwijderen');
  if (!def) {
    queueMicrotask(close);
    return null;
  }
  const aantal = gebruik(doc).get(def.id) || 0;
  const alternatieven = definitiesVan(doc).filter((d) => d.soort === def.soort && d.id !== def.id);
  const [naar, setNaar] = createSignal(alternatieven[0]?.id || '');

  const verwijder = () => {
    if (!naar()) return;
    const oud = kopieDefinities(doc);
    const hernoemd = zetStiftenOver(doc, def.id, naar());
    doc.stiftDefinities = definitiesVan(doc).filter((d) => d.id !== def.id);
    recordStiftDefinities(oud, kopieDefinities(doc), hernoemd);
    if (doc.viewMode === 'continuous') redrawContinuous(); else redrawAnnotations();
    close();
  };

  const footer = (
    <>
      <div></div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" disabled={!naar()} onClick={verwijder}>{tCommon('delete')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('stiftVerwijderen.titel')}
      overlayClass="extract-pages-overlay"
      dialogClass="extract-pages-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={close}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row extract-pages-info">{t('stiftVerwijderen.inGebruik', { count: aantal, naam: def.omschrijving })}</div>
        <Show when={alternatieven.length > 0} fallback={<div class="extract-pages-row">{t('stiftVerwijderen.geenAlternatief')}</div>}>
          <div class="extract-pages-row">
            <label class="extract-pages-label">{t('stiftVerwijderen.overzettenNaar')}</label>
            <select value={naar()} onChange={(e) => setNaar(e.target.value)}>
              <For each={alternatieven}>{(d) => <option value={d.id}>{d.omschrijving}</option>}</For>
            </select>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
```

- [ ] **Stap 8: `StiftSection.jsx` en het eigenschappenpaneel**

```jsx
// Eigenschappen van een stift (zijn definitie) en van een legenda (kop,
// kolommen, kader). Schrijft via updateAnnotProp, dus ongedaan maken loopt
// zoals bij elke andere eigenschap.
import { Show, For, createMemo } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { definitiesVan, definitieVan } from '../../../annotations/stift/document.js';
import { openDialog } from '../../stores/dialogStore.js';
import { setTool } from '../../../tools/manager.js';

export default function StiftSection() {
  const { t } = useTranslation('properties');
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const def = createMemo(() => (annotProps.annotationType === 'stift'
    ? definitieVan(getActiveDocument(), annotProps.stiftDefId) : null));
  const zelfdeSoort = createMemo(() => {
    const d = def();
    return d ? definitiesVan(getActiveDocument()).filter((x) => x.soort === d.soort) : [];
  });

  return (
    <>
      <Show when={annotProps.annotationType === 'stift'}>
        <CollapsibleSection title={t('stiften.stiftSectie')} name="stift" id="prop-stift-section">
          <div class="property-group">
            <label>{t('stiften.definitie')}</label>
            <select id="prop-stift-definitie" value={annotProps.stiftDefId || ''} disabled={locked()}
              onChange={(e) => updateAnnotProp('stiftDefId', e.target.value)}>
              <For each={zelfdeSoort()}>{(d) => <option value={d.id}>{d.omschrijving}</option>}</For>
            </select>
          </div>
          <div class="property-group">
            <button class="pref-btn pref-btn-secondary" disabled={!def()}
              onClick={() => openDialog('stift-definitie', { id: annotProps.stiftDefId })}>{t('stiften.bewerkDefinitie')}</button>
          </div>
        </CollapsibleSection>
      </Show>
      <Show when={annotProps.annotationType === 'stiftLegenda'}>
        <CollapsibleSection title={t('stiften.legendaSectie')} name="stiftLegenda" id="prop-stift-legenda-section">
          <div class="property-group">
            <label>{t('stiften.kop')}</label>
            <input type="text" id="prop-legenda-kop" value={annotProps.kop || ''} disabled={locked()}
              onChange={(e) => updateAnnotProp('kop', e.target.value)} />
          </div>
          <div class="property-group">
            <label>{t('stiften.kolommen')}</label>
            <select id="prop-legenda-kolommen" value={String(annotProps.kolommen || 1)} disabled={locked()}
              onChange={(e) => updateAnnotProp('kolommen', Number(e.target.value))}>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </div>
          <div class="property-group">
            <button class="pref-btn pref-btn-secondary" disabled={locked()}
              onClick={() => { state._herkaderLegendaId = annotProps.id; setTool('stiftLegenda'); }}>{t('stiften.kaderOpnieuw')}</button>
            <button class="pref-btn pref-btn-secondary" disabled={locked() || !annotProps.kader}
              onClick={() => updateAnnotProp('kader', null)}>{t('stiften.kaderWissen')}</button>
          </div>
        </CollapsibleSection>
      </Show>
    </>
  );
}
```

`js/solid/components/properties-panel/PropertiesPanel.jsx`: importeer `StiftSection` en zet `<StiftSection />` direct na `<BetonbalkSection />`.

`js/solid/stores/propertiesStore.js`:
- In `storeShowProperties`, voeg aan het object van `setAnnotProps({ … })` toe:

  ```js
      // Stifttekening
      stiftDefId: annotation.stiftDefId ?? null,
      kop: annotation.kop ?? '',
      kolommen: annotation.kolommen ?? 1,
      kader: annotation.kader ?? null,
  ```

- In `computeSectionVisibility`: voeg `const isStift = type === 'stift' || type === 'stiftLegenda';` toe, en vervang `appearance: !isScaleBar,` door `appearance: !isScaleBar && !isStift,`. Kleur en dikte komen uit de definitie, niet uit de annotatie.

- [ ] **Stap 9: Tabblad, pictogram, vensters en opmaak**

`js/solid/data/leftPanelIcons.js`, onder `layersIcon`:

```js
export const stiftenIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 6l3 3"/></svg>`;
```

`js/solid/components/left-panel/LeftPanel.jsx`:
- importeer `stiftenIcon` en `StiftenPanel`;
- voeg aan `TABS` direct na de regel met `panelId: 'layers'` toe:

  ```jsx
      { panelId: 'stiften', title: () => t('stiften.titel'), label: () => t('stiften.titel'), icon: stiftenIcon },
  ```

- zet `<StiftenPanel />` direct na `<LayersPanel />`.

`js/solid/components/DialogHost.jsx`:
- importeer `StiftDefinitieDialog` en `StiftVerwijderenDialog`;
- voeg aan de naam-component-tabel direct na `'delete-pages': DeletePagesDialog,` toe:

  ```jsx
    'stift-definitie': StiftDefinitieDialog,
    'stift-verwijderen': StiftVerwijderenDialog,
  ```

`styles/panels.css`, aan het eind. Geen afgeronde hoeken, geen animaties, standaardcursor:

```css
/* Paneel Stiften (stifttekening) */
.stiften-werkbalk { display: flex; gap: 4px; padding: 4px 6px; }
.stiften-werkbalk select { flex: 1; min-width: 0; }
.stiften-lijst { flex: 1; overflow-y: auto; padding: 0 6px; }
.stift-groep-kop { font-size: 11px; font-weight: 600; margin: 6px 0 2px; color: var(--theme-panel-header-text); }
.stift-rij { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border: 1px solid transparent; }
.stift-rij:hover { background: var(--theme-thumbnail-hover); }
.stift-rij.actief { border-color: var(--theme-panel-accent, #2563eb); }
.stift-voorbeeld { flex-shrink: 0; background: #ffffff; border: 1px solid var(--theme-panel-border); }
.stift-naam { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--theme-panel-header-text); }
.stift-aantal { font-size: 11px; min-width: 16px; text-align: right; color: var(--theme-panel-tab-text); }
.stift-knop { width: 18px; height: 18px; padding: 0; font-size: 11px; line-height: 16px; border: 1px solid var(--theme-panel-border); background: var(--theme-thumbnail-bg); }
.stiften-voet { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px; border-top: 1px solid var(--theme-panel-border); }
```

- [ ] **Stap 10: Draai de tests en de controles**

Run: `node --test js/annotations/stift/stift-i18n.test.mjs`
Verwacht: 2 tests, 2 pass.

Run: `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
Verwacht: groen.

- [ ] **Stap 11: Registreer de test en commit**

```bash
git add open-pdf-studio/js/solid open-pdf-studio/js/i18n/locales open-pdf-studio/styles/panels.css open-pdf-studio/js/annotations/stift/stift-i18n.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): markers panel, definition dialogs and properties"
```


## Taak 11: Opslaan

**Bestanden:**
- Nieuw:
  - `js/pdf/saver/stift-ap.js`: tekenopdrachten naar PDF-operatoren;
  - `js/pdf/saver/stift-meta.js`: de definitielijst in de catalogus, geometrie naar en van PDF-ruimte;
  - `js/pdf/saver/stift-dict.js`: het annotatiewoordenboek met appearance van een stift of legenda.
- Wijzig: `js/pdf/saver.js`.
- Tests: `js/pdf/saver/stift-ap.test.mjs`, `js/pdf/saver/stift-meta.test.mjs`, `js/pdf/saver/stift-dict.test.mjs`.

**Interfaces:**
- Gebruikt:
  - taak 1: `mmNaarPt`, `schrijfOpgeslagen`, `leesOpgeslagen`;
  - taak 2: `stiftTekenopdrachten`, `opdrachtenOmhullende`, `streepPatroon`;
  - taak 4: `legendaIndeling`, `legendaTekenopdrachten`, `legendaRegels`;
  - taak 5: `definitieVan`, `definitiesVan`, `zichtbareStiften`;
  - de app: `winAnsiLiteral`, `pdfTextString` en `decodePdfTextObject` uit `js/pdf/saver/pdf-text.js`, `hexToColorArray` uit `js/utils/colors.js`.
- Produceert:
  - `stift-ap.js`: `HELV_BOLD_FONT_NAME` (`'HeBo'`), `opdrachtenNaarPdf(opdrachten, naarPdf) → {content, needsFont, needsBoldFont}`;
  - `stift-meta.js`: `STIFT_DEFS_SLEUTEL`, `schrijfStiftDefinities(pdfDocLib, definities)`, `leesStiftDefinities(pdfDocLib) → definitie[]`, `stiftGeomNaarPdf(stift, naarPdf) → number[]`, `stiftGeomUitPdf(vorm, reeks, naarApp, verschuiving?) → velden|null`, `legendaNaarPdf(legenda, naarPdf) → {pos, kader}`, `legendaUitPdf(pos, kader, naarApp, verschuiving?) → {x, y, kader}|null`;
  - `stift-dict.js`: `rectUitOmhullende(o, naarPdf, marge = 1)`, `stiftAnnotDict(context, stift, definitie, naarPdf, basis?) → PDFDict`, `legendaAnnotDict(context, legenda, regels, naarPdf, basis?) → PDFDict`.
- `naarPdf(x, y) → [X, Y]` beeldt de weergaveruimte af op PDF-ruimte; `naarApp(X, Y) → [x, y]` doet het omgekeerde.
- Sleutels in de PDF:
  - catalogus: `/OPS_StiftDefs`, een hexstring met JSON `{versie, definities}`;
  - stift: `/OPS_Subtype (stift)`, `/OPS_StiftDefId`, `/OPS_StiftVorm`, `/OPS_StiftGeom`, `/OPS_StiftRect`, `/OPS_StiftDef` (hex-JSON, de momentopname), `/OPS_StiftStand` (alleen bij een gedraaid I-profiel) en `/OPS_IfcCategory`;
  - legenda: `/OPS_Subtype (stiftLegenda)`, `/OPS_LegKop`, `/OPS_LegKolommen`, `/OPS_LegPos`, `/OPS_LegKader` (alleen met kader) en `/OPS_LegRect`.

- [ ] **Stap 1: Schrijf de tests**

Bestand `js/pdf/saver/stift-ap.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { opdrachtenNaarPdf, HELV_BOLD_FONT_NAME } from './stift-ap.js';

// Een blad van 200 × 100 pt zonder /Rotate: y klapt om.
const recht = (x, y) => [x, 100 - y];
// /Rotate 90 zoals de saver het doet: eerst (x, y) → (y, ch − x) naar het
// ongedraaide blad (ch = 200), dan de CropBox-omrekening Y = 200 − y.
const kwart = (x, y) => { const m = { x: y, y: 200 - x }; return [m.x, 200 - m.y]; };

test('lijn: kleur, dikte, streep en het pad in PDF-ruimte', () => {
  const { content, needsFont } = opdrachtenNaarPdf([
    { soort: 'lijn', punten: [[10, 20], [110, 20]], kleur: '#FF0000', dikte: 4, streep: [8, 4] },
  ], recht);
  assert.equal(content, 'q 1 0 0 RG 4 w 0 J 0 j [8 4] 0 d\n10 80 m\n110 80 l\nS Q\n');
  assert.equal(needsFont, false);
});

test('doorgetrokken lijn zet het streeppatroon terug', () => {
  const { content } = opdrachtenNaarPdf([{ soort: 'lijn', punten: [[0, 0], [1, 1]], kleur: '#000000', dikte: 1, streep: null }], recht);
  assert.match(content, /\[\] 0 d/);
});

test('vlak en rechthoek worden gevuld', () => {
  const { content } = opdrachtenNaarPdf([
    { soort: 'vlak', punten: [[0, 0], [10, 0], [5, 5]], kleur: '#0000FF' },
    { soort: 'rechthoek', x: 0, y: 0, b: 10, h: 15, vulling: '#45B5A8' },
  ], recht);
  assert.match(content, /^q 0 0 1 rg\n0 100 m\n10 100 l\n5 95 l\nh f Q\n/);
  assert.match(content, /q 0\.271 0\.71 0\.659 rg\n0 100 m\n10 100 l\n10 85 l\n0 85 l\nh f Q\n$/);
});

test('cirkel: vier Bézierbogen rond het afgebeelde midden', () => {
  const { content } = opdrachtenNaarPdf([{ soort: 'cirkel', x: 50, y: 50, r: 5, kleur: '#000000' }], recht);
  assert.equal((content.match(/ c\n/g) || []).length, 4);
  assert.match(content, /^q 0 0 0 rg\n55 50 m\n/);
});

test('tekst: rechtop op een gewoon blad, midden-uitlijning via de breedte', () => {
  const { content, needsFont, needsBoldFont } = opdrachtenNaarPdf([
    { soort: 'tekst', x: 100, y: 50, tekst: 'A', grootte: 12, vet: false, kleur: '#350E35', uitlijning: 'midden', breedte: 8 },
  ], recht);
  assert.equal(needsFont, true);
  assert.equal(needsBoldFont, false);
  assert.match(content, /BT \/Helv 12 Tf/);
  assert.match(content, /\n1 0 0 1 96 50 Tm\n\(A\) Tj ET Q\n$/);
});

test('vette tekst gebruikt het tweede lettertype', () => {
  const { content, needsBoldFont } = opdrachtenNaarPdf([
    { soort: 'tekst', x: 0, y: 0, tekst: 'KOP', grootte: 12, vet: true, kleur: '#000000', uitlijning: 'links', breedte: 20 },
  ], recht);
  assert.equal(needsBoldFont, true);
  assert.match(content, new RegExp(`/${HELV_BOLD_FONT_NAME} 12 Tf`));
});

test('op een /Rotate-90-blad draait de tekstmatrix mee, zodat de tekst in beeld rechtop staat', () => {
  const { content } = opdrachtenNaarPdf([
    { soort: 'tekst', x: 10, y: 20, tekst: 'B', grootte: 12, vet: true, kleur: '#000000', uitlijning: 'links', breedte: 8 },
  ], kwart);
  // Basislijn langs +Y, letters omhoog langs −X: na de kwartslag van de
  // lezer (met de klok mee) loopt de tekst van links naar rechts, rechtop.
  assert.match(content, /\n0 1 -1 0 20 10 Tm\n/);
});

test('WinAnsi: een euroteken wordt een octale code, haakjes worden ontsnapt', () => {
  const { content } = opdrachtenNaarPdf([
    { soort: 'tekst', x: 0, y: 0, tekst: 'Kosten (€)', grootte: 10, vet: false, kleur: '#000000', uitlijning: 'links', breedte: 40 },
  ], recht);
  assert.match(content, /\(Kosten \\\(\\200\\\)\) Tj/);
});
```

Bestand `js/pdf/saver/stift-meta.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  STIFT_DEFS_SLEUTEL, schrijfStiftDefinities, leesStiftDefinities,
  stiftGeomNaarPdf, stiftGeomUitPdf, legendaNaarPdf, legendaUitPdf,
} from './stift-meta.js';
import { standaardSet, maakDefinitie } from '../../annotations/stift/definities.js';

// Een blad zonder /Rotate: y klapt om rond een CropBox-top van 842.
const naarPdf = (x, y) => [x + 5, 842 - y];
const naarApp = (X, Y) => [X - 5, 842 - Y];
// /Rotate 90 (ch = 595): heen via (y, ch − x) plus de omklap, terug andersom.
const naarPdfKwart = (x, y) => [y, 595 - (595 - x)];
const naarAppKwart = (X, Y) => [Y, X];

test('de definities gaan via de catalogus heen en terug, ook na opslaan', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const set = [...standaardSet(), { ...maakDefinitie('vloer', { id: 'eigen' }), omschrijving: 'Balklaag (€ 12,-)' }];
  schrijfStiftDefinities(pdf, set);
  const heropend = await PDFDocument.load(await pdf.save());
  assert.deepEqual(leesStiftDefinities(heropend), set);
});

test('een lege lijst haalt de sleutel weg; stuk of ontbrekend geeft een lege lijst', async () => {
  const pdf = await PDFDocument.create();
  schrijfStiftDefinities(pdf, standaardSet());
  schrijfStiftDefinities(pdf, []);
  assert.equal(pdf.catalog.get(PDFName.of(STIFT_DEFS_SLEUTEL)), undefined);
  assert.deepEqual(leesStiftDefinities(pdf), []);
  pdf.catalog.set(PDFName.of(STIFT_DEFS_SLEUTEL), PDFName.of('Onzin'));
  assert.deepEqual(leesStiftDefinities(pdf), []);
});

test('geometrie heen en terug, per tekenwijze', () => {
  const lijn = { vorm: 'lijn', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 90 }] };
  assert.deepEqual(stiftGeomNaarPdf(lijn, naarPdf), [15, 822, 115, 822, 115, 752]);
  assert.deepEqual(stiftGeomUitPdf('lijn', stiftGeomNaarPdf(lijn, naarPdf), naarApp), { points: lijn.points });
  const pijl = { vorm: 'pijl', startX: 1, startY: 2, endX: 3, endY: 4 };
  assert.deepEqual(stiftGeomUitPdf('pijl', stiftGeomNaarPdf(pijl, naarPdf), naarApp), { startX: 1, startY: 2, endX: 3, endY: 4 });
  const punt = { vorm: 'punt', x: 7, y: 8 };
  assert.deepEqual(stiftGeomUitPdf('punt', stiftGeomNaarPdf(punt, naarPdf), naarApp), { x: 7, y: 8 });
  const kruis = { vorm: 'kruis', x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(stiftGeomUitPdf('kruis', stiftGeomNaarPdf(kruis, naarPdf), naarApp), { x: 10, y: 20, width: 30, height: 40 });
});

test('op een gedraaid blad komt een kruis als rechte rechthoek terug', () => {
  const kruis = { vorm: 'kruis', x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(stiftGeomUitPdf('kruis', stiftGeomNaarPdf(kruis, naarPdfKwart), naarAppKwart), { x: 10, y: 20, width: 30, height: 40 });
});

test('verplaatst door een ander programma: de geometrie schuift mee', () => {
  const reeks = stiftGeomNaarPdf({ vorm: 'punt', x: 100, y: 100 }, naarPdf);
  assert.deepEqual(stiftGeomUitPdf('punt', reeks, naarApp, [20, -10]), { x: 120, y: 110 });
});

test('te weinig getallen geeft geen geometrie', () => {
  assert.equal(stiftGeomUitPdf('lijn', [1, 2], naarApp), null);
  assert.equal(stiftGeomUitPdf('pijl', [1, 2, 3], naarApp), null);
  assert.equal(stiftGeomUitPdf('kruis', null, naarApp), null);
});

test('legenda: positie en kader heen en terug', () => {
  const legenda = { x: 50, y: 60, kader: { x: 10, y: 20, width: 300, height: 200 } };
  const { pos, kader } = legendaNaarPdf(legenda, naarPdf);
  assert.deepEqual(legendaUitPdf(pos, kader, naarApp), legenda);
  const zonder = legendaNaarPdf({ x: 1, y: 2, kader: null }, naarPdf);
  assert.equal(zonder.kader, null);
  assert.deepEqual(legendaUitPdf(zonder.pos, zonder.kader, naarApp), { x: 1, y: 2, kader: null });
  assert.equal(legendaUitPdf(null, null, naarApp), null);
});
```

Bestand `js/pdf/saver/stift-dict.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { stiftAnnotDict, legendaAnnotDict, rectUitOmhullende } from './stift-dict.js';
import { standaardSet, mmNaarPt } from '../../annotations/stift/definities.js';
import { legendaRegels } from '../../annotations/stift/legenda.js';

// Een A4-blad zonder /Rotate: y klapt om.
const naarPdf = (x, y) => [x, 842 - y];
const def = (soort) => standaardSet().find((d) => d.soort === soort);

async function nieuwBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc;
}

const naam = (dict, sleutel) => dict.get(PDFName.of(sleutel))?.toString();
const getallen = (dict, sleutel) => dict.lookup(PDFName.of(sleutel)).asArray().map((n) => n.asNumber());
const apInhoud = (context, dict) => {
  const n = context.lookup(dict.lookup(PDFName.of('AP')).get(PDFName.of('N')));
  return { stroom: n, tekst: Buffer.from(n.getContents()).toString('latin1') };
};

test('rect uit een omhullende: vier hoeken afgebeeld, met marge', () => {
  assert.deepEqual(rectUitOmhullende({ x: 10, y: 20, width: 100, height: 50 }, naarPdf), [9, 771, 111, 823]);
});

test('lijnstift: /PolyLine met Vertices, streep in /BS, sleutels en appearance', async () => {
  const doc = await nieuwBlad();
  const stift = { type: 'stift', vorm: 'lijn', stiftDefId: 'sd-std-nieuweWand', ifcCategory: 'IfcWall',
    points: [{ x: 100, y: 100 }, { x: 300, y: 100 }] };
  const dict = stiftAnnotDict(doc.context, stift, def('nieuweWand'), naarPdf, { F: 4 });
  assert.equal(naam(dict, 'Subtype'), '/PolyLine');
  assert.deepEqual(getallen(dict, 'Vertices'), [100, 742, 300, 742]);
  assert.deepEqual(getallen(dict, 'OPS_StiftGeom'), [100, 742, 300, 742]);
  const d = mmNaarPt(1.4);
  const bs = dict.lookup(PDFName.of('BS'));
  assert.equal(bs.get(PDFName.of('S')).toString(), '/D');
  assert.deepEqual(bs.lookup(PDFName.of('D')).asArray().map((n) => n.asNumber()), [Math.round(2 * d * 1000) / 1000, Math.round(d * 1000) / 1000]);
  assert.equal(dict.get(PDFName.of('OPS_Subtype')).decodeText(), 'stift');
  assert.equal(dict.get(PDFName.of('F')).asNumber(), 4);
  // De /Rect omvat de lijn met de halve dikte en de marge.
  const [x1, y1, x2, y2] = getallen(dict, 'Rect');
  assert.ok(x1 <= 100 - d / 2 && x2 >= 300 + d / 2 && y1 <= 742 - d / 2 && y2 >= 742 + d / 2);
  assert.deepEqual(getallen(dict, 'OPS_StiftRect'), [x1, y1, x2, y2]);
  // Momentopname van de definitie als JSON.
  assert.equal(JSON.parse(dict.get(PDFName.of('OPS_StiftDef')).decodeText()).id, 'sd-std-nieuweWand');
  const { stroom, tekst } = apInhoud(doc.context, dict);
  assert.match(tekst, /1 1 1 RG/, 'witte onderlaag');
  const r = (n) => Math.round(n * 1000) / 1000;
  assert.ok(tekst.includes(`[${r(2 * d)} ${r(d)}] 0 d`), 'streep 2:1 van de dikte');
  assert.deepEqual(stroom.dict.lookup(PDFName.of('BBox')).asArray().map((n) => n.asNumber()), [x1, y1, x2, y2]);
});

test('pijl: /Line met /L en gesloten pijlpunten; vloerletter in Helvetica-Bold', async () => {
  const doc = await nieuwBlad();
  const stift = { type: 'stift', vorm: 'pijl', stiftDefId: 'sd-std-vloer', startX: 100, startY: 400, endX: 100, endY: 200 };
  const dict = stiftAnnotDict(doc.context, stift, def('vloer'), naarPdf);
  assert.equal(naam(dict, 'Subtype'), '/Line');
  assert.deepEqual(getallen(dict, 'L'), [100, 442, 100, 642]);
  assert.deepEqual(dict.lookup(PDFName.of('LE')).asArray().map(String), ['/ClosedArrow', '/ClosedArrow']);
  const { stroom, tekst } = apInhoud(doc.context, dict);
  assert.match(tekst, /\/HeBo 12 Tf/);
  const fonts = stroom.dict.lookup(PDFName.of('Resources')).lookup(PDFName.of('Font'));
  assert.equal(fonts.lookup(PDFName.of('HeBo')).get(PDFName.of('BaseFont')).toString(), '/Helvetica-Bold');
});

test('punt: /Circle voor een paal, /Square met stand voor een I-profiel', async () => {
  const doc = await nieuwBlad();
  const paal = stiftAnnotDict(doc.context, { type: 'stift', vorm: 'punt', stiftDefId: 'sd-std-paal', x: 50, y: 50 }, def('paal'), naarPdf);
  assert.equal(naam(paal, 'Subtype'), '/Circle');
  const iDef = { ...def('kolom'), puntvorm: 'i-profiel' };
  const kolom = stiftAnnotDict(doc.context, { type: 'stift', vorm: 'punt', stiftDefId: iDef.id, x: 50, y: 50, rotation: 90 }, iDef, naarPdf);
  assert.equal(naam(kolom, 'Subtype'), '/Square');
  assert.equal(kolom.get(PDFName.of('OPS_StiftStand')).asNumber(), 90);
  assert.equal(paal.get(PDFName.of('OPS_StiftStand')), undefined);
});

test('zonder definitie: grijs met vraagteken, geen momentopname', async () => {
  const doc = await nieuwBlad();
  const dict = stiftAnnotDict(doc.context, { type: 'stift', vorm: 'kruis', stiftDefId: 'weg', x: 10, y: 10, width: 40, height: 20 }, null, naarPdf);
  assert.equal(naam(dict, 'Subtype'), '/Square');
  assert.equal(dict.get(PDFName.of('OPS_StiftDef')), undefined);
  assert.match(apInhoud(doc.context, dict).tekst, /\(\?\) Tj/);
});

test('legenda: /Stamp met kop, kolommen, positie, kader en de regels in de appearance', async () => {
  const doc = await nieuwBlad();
  const definities = standaardSet();
  const annotaties = [
    { type: 'stift', vorm: 'lijn', page: 1, stiftDefId: 'sd-std-nieuweWand', points: [{ x: 60, y: 60 }, { x: 160, y: 60 }] },
    { type: 'stift', vorm: 'punt', page: 1, stiftDefId: 'sd-std-kolom', x: 80, y: 90 },
  ];
  const legenda = { type: 'stiftLegenda', page: 1, x: 300, y: 500, kop: 'Begane grond', kolommen: 1,
    kader: { x: 0, y: 0, width: 400, height: 400 } };
  const dict = legendaAnnotDict(doc.context, legenda, legendaRegels(legenda, annotaties, definities), naarPdf, { F: 4 });
  assert.equal(naam(dict, 'Subtype'), '/Stamp');
  assert.equal(dict.get(PDFName.of('OPS_Subtype')).decodeText(), 'stiftLegenda');
  assert.equal(dict.get(PDFName.of('OPS_LegKop')).decodeText(), 'Begane grond');
  assert.equal(dict.get(PDFName.of('OPS_LegKolommen')).asNumber(), 1);
  assert.deepEqual(getallen(dict, 'OPS_LegPos'), [300, 342]);
  assert.deepEqual(getallen(dict, 'OPS_LegKader'), [0, 842, 400, 442]);
  const [x1, , , y2] = getallen(dict, 'Rect');
  assert.ok(x1 <= 300 && y2 >= 342);
  const { tekst } = apInhoud(doc.context, dict);
  assert.match(tekst, /\(BEGANE GROND\) Tj/);
  assert.match(tekst, /\(Nieuwe wand\) Tj/);
  assert.match(tekst, /\(Kolom\) Tj/);
  assert.ok(dict.get(PDFName.of('OPS_Subtype')) instanceof PDFString);
});
```

- [ ] **Stap 2: Draai de tests, ze moeten falen**

Run: `node --test js/pdf/saver/stift-ap.test.mjs js/pdf/saver/stift-meta.test.mjs js/pdf/saver/stift-dict.test.mjs`
Verwacht: FAIL, modules niet gevonden.

- [ ] **Stap 3: Schrijf de modules**

Bestand `js/pdf/saver/stift-ap.js`:

```js
// Appearance stream van stiften en legenda's: de tekenopdrachten uit
// annotations/stift/tekenopdrachten.js en legenda.js omgezet naar
// PDF-operatoren. Dezelfde opdrachten tekenen het canvas, dus scherm en PDF
// zijn gelijk.
//
// `naarPdf(x, y)` beeldt een punt uit de weergaveruimte af op PDF-ruimte:
// eerst de /Rotate-compensatie van de saver, dan de CropBox-omrekening. Dat
// is een verschuiving, draaiing en spiegeling, dus lengtes (lijndikte,
// streeppatroon, straal) blijven gelijk. Tekst krijgt een tekstmatrix uit de
// afgebeelde eenheidsvectoren: op een /Rotate-blad staat hij in de weergave
// dan toch rechtop.

import { winAnsiLiteral } from './pdf-text.js';

/** Naam van het Helvetica-Bold-resource naast /Helv. */
export const HELV_BOLD_FONT_NAME = 'HeBo';

const KAPPA = 0.5522847498;

const f = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function rgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function pad(punten, naarPdf) {
  return punten.map(([x, y], i) => {
    const [px, py] = naarPdf(x, y);
    return `${f(px)} ${f(py)} ${i ? 'l' : 'm'}\n`;
  }).join('');
}

/**
 * @param {object[]} opdrachten
 * @param {(x: number, y: number) => [number, number]} naarPdf
 * @returns {{content: string, needsFont: boolean, needsBoldFont: boolean}}
 */
export function opdrachtenNaarPdf(opdrachten, naarPdf) {
  let s = '';
  let needsFont = false;
  let needsBoldFont = false;
  for (const o of opdrachten) {
    switch (o.soort) {
      case 'lijn': {
        if (!o.punten || o.punten.length < 2) break;
        const [r, g, b] = rgb(o.kleur);
        const streep = o.streep ? `[${o.streep.map(f).join(' ')}] 0 d` : '[] 0 d';
        s += `q ${f(r)} ${f(g)} ${f(b)} RG ${f(o.dikte)} w 0 J 0 j ${streep}\n${pad(o.punten, naarPdf)}S Q\n`;
        break;
      }
      case 'vlak': {
        if (!o.punten || o.punten.length < 3) break;
        const [r, g, b] = rgb(o.kleur);
        s += `q ${f(r)} ${f(g)} ${f(b)} rg\n${pad(o.punten, naarPdf)}h f Q\n`;
        break;
      }
      case 'rechthoek': {
        const [r, g, b] = rgb(o.vulling);
        const hoeken = [[o.x, o.y], [o.x + o.b, o.y], [o.x + o.b, o.y + o.h], [o.x, o.y + o.h]];
        s += `q ${f(r)} ${f(g)} ${f(b)} rg\n${pad(hoeken, naarPdf)}h f Q\n`;
        break;
      }
      case 'cirkel': {
        const [r, g, b] = rgb(o.kleur);
        const [cx, cy] = naarPdf(o.x, o.y);
        const k = o.r * KAPPA;
        const R = o.r;
        s += `q ${f(r)} ${f(g)} ${f(b)} rg\n`
          + `${f(cx + R)} ${f(cy)} m\n`
          + `${f(cx + R)} ${f(cy + k)} ${f(cx + k)} ${f(cy + R)} ${f(cx)} ${f(cy + R)} c\n`
          + `${f(cx - k)} ${f(cy + R)} ${f(cx - R)} ${f(cy + k)} ${f(cx - R)} ${f(cy)} c\n`
          + `${f(cx - R)} ${f(cy - k)} ${f(cx - k)} ${f(cy - R)} ${f(cx)} ${f(cy - R)} c\n`
          + `${f(cx + k)} ${f(cy - R)} ${f(cx + R)} ${f(cy - k)} ${f(cx + R)} ${f(cy)} c\nf Q\n`;
        break;
      }
      case 'tekst': {
        if (!o.tekst) break;
        const vet = !!o.vet;
        if (vet) needsBoldFont = true; else needsFont = true;
        const begin = o.uitlijning === 'midden' ? o.x - o.breedte / 2 : o.x;
        const [ox, oy] = naarPdf(begin, o.y);
        const [ax, ay] = naarPdf(begin + 1, o.y);
        // In de weergave loopt y omlaag: "omhoog" voor de letters is -y.
        const [bx, by] = naarPdf(begin, o.y - 1);
        const [r, g, b] = rgb(o.kleur);
        s += `q BT /${vet ? HELV_BOLD_FONT_NAME : 'Helv'} ${f(o.grootte)} Tf ${f(r)} ${f(g)} ${f(b)} rg\n`
          + `${f(ax - ox)} ${f(ay - oy)} ${f(bx - ox)} ${f(by - oy)} ${f(ox)} ${f(oy)} Tm\n`
          + `(${winAnsiLiteral(o.tekst)}) Tj ET Q\n`;
        break;
      }
      default:
        break;
    }
  }
  return { content: s, needsFont, needsBoldFont };
}
```

Bestand `js/pdf/saver/stift-meta.js`:

```js
// Stiften in de PDF: de definitielijst in de catalogus en de geometrie van
// stiften en legenda's als getallenreeksen in PDF-ruimte.
//
//   /Root /OPS_StiftDefs  hexstring met JSON { versie, definities }
//                         (zelfde patroon als OPS_StylePresets)
//   per stift             OPS_Subtype (stift), OPS_StiftDefId, OPS_StiftVorm,
//                         OPS_StiftDef (JSON-momentopname), OPS_StiftGeom,
//                         OPS_StiftRect (de /Rect zoals wij hem schreven)
//   per legenda           OPS_Subtype (stiftLegenda), OPS_LegKop,
//                         OPS_LegKolommen, OPS_LegPos, OPS_LegKader, OPS_LegRect
//
// Wijkt de /Rect bij het openen af van de opgeslagen OPS_…Rect, dan heeft een
// ander programma het object verplaatst; de loader schuift de geometrie dan
// mee (zelfde regel als bij de betonbalk).

import { PDFName, PDFHexString } from 'pdf-lib';
import { schrijfOpgeslagen, leesOpgeslagen } from '../../annotations/stift/definities.js';
import { decodePdfTextObject } from './pdf-text.js';

export const STIFT_DEFS_SLEUTEL = 'OPS_StiftDefs';

function catalogus(pdfDocLib) {
  const context = pdfDocLib.context;
  return context.lookup(context.trailerInfo.Root);
}

/** Schrijf de definities in de catalogus; een lege lijst haalt de sleutel weg. */
export function schrijfStiftDefinities(pdfDocLib, definities) {
  const cat = catalogus(pdfDocLib);
  if (!cat) return;
  if (!Array.isArray(definities) || definities.length === 0) {
    cat.delete(PDFName.of(STIFT_DEFS_SLEUTEL));
    return;
  }
  cat.set(PDFName.of(STIFT_DEFS_SLEUTEL), PDFHexString.fromText(JSON.stringify(schrijfOpgeslagen(definities))));
}

/** De definities uit de catalogus; een lege lijst als ze ontbreken of stuk zijn. */
export function leesStiftDefinities(pdfDocLib) {
  try {
    const cat = catalogus(pdfDocLib);
    const tekst = cat ? decodePdfTextObject(cat.lookup(PDFName.of(STIFT_DEFS_SLEUTEL))) : null;
    return tekst ? leesOpgeslagen(JSON.parse(tekst)) : [];
  } catch {
    return [];
  }
}

/** Geometrie van een stift als [x, y, …] in PDF-ruimte. */
export function stiftGeomNaarPdf(stift, naarPdf) {
  switch (stift.vorm) {
    case 'pijl': return [...naarPdf(stift.startX, stift.startY), ...naarPdf(stift.endX, stift.endY)];
    case 'punt': return [...naarPdf(stift.x, stift.y)];
    case 'kruis': return [...naarPdf(stift.x, stift.y), ...naarPdf(stift.x + stift.width, stift.y + stift.height)];
    default: return (stift.points || []).flatMap((p) => naarPdf(p.x, p.y));
  }
}

function punten(reeks, naarApp, [dx, dy]) {
  const uit = [];
  if (!Array.isArray(reeks)) return uit;
  for (let i = 0; i + 1 < reeks.length; i += 2) {
    const [x, y] = naarApp(reeks[i] + dx, reeks[i + 1] + dy);
    uit.push({ x, y });
  }
  return uit;
}

/**
 * Van de PDF-reeks terug naar de geometrievelden van een stift.
 * @param {string} vorm
 * @param {number[]} reeks
 * @param {(X: number, Y: number) => [number, number]} naarApp  de omrekening van de loader
 * @param {[number, number]} [verschuiving]  in PDF-ruimte, als een ander programma het object verplaatste
 * @returns {object|null}
 */
export function stiftGeomUitPdf(vorm, reeks, naarApp, verschuiving = [0, 0]) {
  const pts = punten(reeks, naarApp, verschuiving);
  switch (vorm) {
    case 'pijl':
      return pts.length >= 2 ? { startX: pts[0].x, startY: pts[0].y, endX: pts[1].x, endY: pts[1].y } : null;
    case 'punt':
      return pts.length >= 1 ? { x: pts[0].x, y: pts[0].y } : null;
    case 'kruis': {
      if (pts.length < 2) return null;
      const x = Math.min(pts[0].x, pts[1].x);
      const y = Math.min(pts[0].y, pts[1].y);
      return { x, y, width: Math.abs(pts[1].x - pts[0].x), height: Math.abs(pts[1].y - pts[0].y) };
    }
    default:
      return pts.length >= 2 ? { points: pts } : null;
  }
}

/** Positie en kader van een legenda in PDF-ruimte. */
export function legendaNaarPdf(legenda, naarPdf) {
  const k = legenda.kader;
  return {
    pos: naarPdf(legenda.x, legenda.y),
    kader: k ? [...naarPdf(k.x, k.y), ...naarPdf(k.x + k.width, k.y + k.height)] : null,
  };
}

/** Terug: linkerbovenhoek en kader in weergaveruimte. */
export function legendaUitPdf(pos, kader, naarApp, verschuiving = [0, 0]) {
  const [p] = punten(pos, naarApp, verschuiving);
  if (!p) return null;
  const hoeken = punten(kader, naarApp, verschuiving);
  const k = hoeken.length >= 2 ? {
    x: Math.min(hoeken[0].x, hoeken[1].x),
    y: Math.min(hoeken[0].y, hoeken[1].y),
    width: Math.abs(hoeken[1].x - hoeken[0].x),
    height: Math.abs(hoeken[1].y - hoeken[0].y),
  } : null;
  return { x: p.x, y: p.y, kader: k };
}
```

Bestand `js/pdf/saver/stift-dict.js`:

```js
// Het annotatiewoordenboek van een stift of legenda, met appearance stream.
// De saver roept dit per annotatie aan; los van saver.js onder node te testen
// (zie stift-dict.test.mjs en loader/stift-uit-pdf.test.mjs).
//
// Standaard-subtype per tekenwijze, zodat andere lezers er iets zinnigs van
// maken (spec: Opslaan en openen):
//   lijn   /PolyLine met /Vertices
//   pijl   /Line met /L en /LE [/ClosedArrow /ClosedArrow]
//   punt   /Square (vierkant, I-profiel) of /Circle (cirkel)
//   kruis  /Square
//   legenda /Stamp
// De eigen sleutels staan in stift-meta.js beschreven. De appearance komt uit
// dezelfde tekenopdrachten als het canvas.
//
// `naarPdf(x, y)` beeldt een punt uit de weergaveruimte af op PDF-ruimte
// (eerst de /Rotate-compensatie van de saver, dan de CropBox-omrekening).

import { PDFName, PDFString, PDFHexString } from 'pdf-lib';
import { mmNaarPt } from '../../annotations/stift/definities.js';
import {
  stiftTekenopdrachten, opdrachtenOmhullende, streepPatroon,
} from '../../annotations/stift/tekenopdrachten.js';
import { legendaIndeling, legendaTekenopdrachten } from '../../annotations/stift/legenda.js';
import { opdrachtenNaarPdf, HELV_BOLD_FONT_NAME } from './stift-ap.js';
import { stiftGeomNaarPdf, legendaNaarPdf } from './stift-meta.js';
import { pdfTextString } from './pdf-text.js';
import { hexToColorArray } from '../../utils/colors.js';

const r3 = (n) => Math.round(n * 1000) / 1000;

/** /Rect uit een omhullende in weergaveruimte: de vier hoeken afgebeeld, plus marge. */
export function rectUitOmhullende(o, naarPdf, marge = 1) {
  const hoeken = [
    naarPdf(o.x, o.y), naarPdf(o.x + o.width, o.y),
    naarPdf(o.x, o.y + o.height), naarPdf(o.x + o.width, o.y + o.height),
  ];
  const xs = hoeken.map((p) => p[0]);
  const ys = hoeken.map((p) => p[1]);
  return [
    r3(Math.min(...xs) - marge), r3(Math.min(...ys) - marge),
    r3(Math.max(...xs) + marge), r3(Math.max(...ys) + marge),
  ];
}

// Appearance als Form XObject met absolute PDF-coördinaten: BBox = /Rect,
// Matrix een zuivere verschuiving (zelfde conventie als attachVectorAP in
// saver.js), met Helvetica en zo nodig Helvetica-Bold als resource.
function zetAppearance(context, dict, gebouwd, rect) {
  if (!gebouwd.content) return;
  const [x1, y1, x2, y2] = rect;
  const fonts = {};
  if (gebouwd.needsFont) {
    fonts.Helv = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  }
  if (gebouwd.needsBoldFont) {
    fonts[HELV_BOLD_FONT_NAME] = context.obj({
      Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Bold', Encoding: 'WinAnsiEncoding',
    });
  }
  const resources = Object.keys(fonts).length ? { Font: context.obj(fonts) } : {};
  const stream = context.stream(gebouwd.content, {
    Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2],
    Matrix: [1, 0, 0, 1, -x1, -y1], Resources: context.obj(resources),
  });
  dict.set(PDFName.of('AP'), context.obj({ N: context.register(stream) }));
}

function subtypeVoor(stift, definitie) {
  switch (stift.vorm) {
    case 'pijl': return 'Line';
    case 'punt': return definitie?.puntvorm === 'cirkel' ? 'Circle' : 'Square';
    case 'kruis': return 'Square';
    default: return 'PolyLine';
  }
}

/**
 * @param {object} context  pdf-lib context
 * @param {object} stift  de stift in weergaveruimte
 * @param {object|null} definitie  de definitie uit het document (null: grijs met vraagteken)
 * @param {(x: number, y: number) => [number, number]} naarPdf
 * @param {object} [basis]  gemeenschappelijke sleutels van de saver (T, M, F, CA, Contents)
 * @returns {import('pdf-lib').PDFDict}
 */
export function stiftAnnotDict(context, stift, definitie, naarPdf, basis = {}) {
  const opdrachten = stiftTekenopdrachten(stift, definitie);
  const rect = rectUitOmhullende(opdrachtenOmhullende(opdrachten), naarPdf);
  const geom = stiftGeomNaarPdf(stift, naarPdf);
  const dikte = mmNaarPt(definitie?.dikteMm ?? 0.35);
  const gestreept = definitie?.lijnsoort === 'gestreept';
  const kleur = hexToColorArray(definitie?.kleur || '#808080');
  const waarden = {
    Type: 'Annot',
    Subtype: subtypeVoor(stift, definitie),
    Rect: rect,
    C: kleur,
    BS: { Type: 'Border', W: r3(dikte), S: gestreept ? 'D' : 'S', ...(gestreept ? { D: streepPatroon(dikte).map(r3) } : {}) },
    ...basis,
    OPS_Subtype: PDFString.of('stift'),
    OPS_StiftDefId: pdfTextString(stift.stiftDefId || ''),
    OPS_StiftVorm: PDFString.of(stift.vorm || 'lijn'),
    OPS_StiftGeom: geom,
    OPS_StiftRect: rect,
  };
  if (stift.vorm === 'lijn') waarden.Vertices = geom;
  if (stift.vorm === 'pijl') {
    waarden.L = geom;
    waarden.LE = ['ClosedArrow', 'ClosedArrow'];
    waarden.IC = kleur;
  }
  if (stift.vorm === 'punt' && stift.rotation) waarden.OPS_StiftStand = stift.rotation % 180;
  if (stift.ifcCategory) waarden.OPS_IfcCategory = pdfTextString(stift.ifcCategory);
  // De definitie reist mee als momentopname: een PDF waarvan een ander
  // programma de catalogus-sleutel weggooide, komt er zo toch heel uit.
  if (definitie) waarden.OPS_StiftDef = PDFHexString.fromText(JSON.stringify(definitie));
  const dict = context.obj(waarden);
  zetAppearance(context, dict, opdrachtenNaarPdf(opdrachten, naarPdf), rect);
  return dict;
}

/**
 * @param {object} context  pdf-lib context
 * @param {object} legenda  de legenda in weergaveruimte
 * @param {{definitie: object, tekst: string}[]} regels  uit legendaRegels
 * @param {(x: number, y: number) => [number, number]} naarPdf
 * @param {object} [basis]  gemeenschappelijke sleutels van de saver
 * @returns {import('pdf-lib').PDFDict}
 */
export function legendaAnnotDict(context, legenda, regels, naarPdf, basis = {}) {
  const indeling = legendaIndeling(legenda, regels);
  const rect = rectUitOmhullende(
    { x: indeling.x, y: indeling.y, width: indeling.breedte, height: indeling.hoogte }, naarPdf);
  const { pos, kader } = legendaNaarPdf(legenda, naarPdf);
  const waarden = {
    Type: 'Annot',
    Subtype: 'Stamp',
    Rect: rect,
    ...basis,
    OPS_Subtype: PDFString.of('stiftLegenda'),
    OPS_LegKop: pdfTextString(legenda.kop || ''),
    OPS_LegKolommen: legenda.kolommen === 2 ? 2 : 1,
    OPS_LegPos: pos,
    OPS_LegRect: rect,
  };
  if (kader) waarden.OPS_LegKader = kader;
  const dict = context.obj(waarden);
  zetAppearance(context, dict, opdrachtenNaarPdf(legendaTekenopdrachten(indeling), naarPdf), rect);
  return dict;
}
```

- [ ] **Stap 4: Draai de tests opnieuw**

Run: `node --test js/pdf/saver/stift-ap.test.mjs js/pdf/saver/stift-meta.test.mjs js/pdf/saver/stift-dict.test.mjs`
Verwacht: 21 tests, 21 pass (stift-ap 8, stift-meta 7, stift-dict 6).

- [ ] **Stap 5: Koppel de saver in `js/pdf/saver.js`**

Direct na `import { saveStylePresetsToCatalog } from './saver/style-presets.js';`:

```js
import { stiftAnnotDict, legendaAnnotDict } from './saver/stift-dict.js';
import { schrijfStiftDefinities } from './saver/stift-meta.js';
import { definitieVan, definitiesVan, zichtbareStiften } from '../annotations/stift/document.js';
import { legendaRegels } from '../annotations/stift/legenda.js';
```

Per pagina, direct na `      const convertY = (canvasY) => viewTop - canvasY;`:

```js
      // Stifttekening: stiften en legenda's bouwen hun appearance in
      // weergaveruimte en beelden elk punt zelf af: eerst de /Rotate-
      // compensatie, dan de CropBox-omrekening (saver/stift-dict.js).
      const stiftDraai = pageRot ? _rotVisualMapper(pageRot, cropBox.width, cropBox.height) : null;
      const naarPdfPagina = (x, y) => {
        const p = stiftDraai ? stiftDraai(x, y) : { x, y };
        return [convertX(p.x), convertY(p.y)];
      };
```

In de `switch (ann.type)` van de annotatielus, direct vóór `          case 'betonbalk': {`:

```js
          case 'stift':
          case 'stiftLegenda': {
            // Stifttekening: annRaw (weergaveruimte), want stift-dict.js past
            // de /Rotate-compensatie per punt zelf toe via naarPdfPagina.
            const stiftBasis = {
              T: pdfTextString(annRaw.author || 'User'),
              Contents: pdfTextString(annRaw.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(annRaw),
              CA: opacity,
            };
            annotDict = annRaw.type === 'stift'
              ? stiftAnnotDict(context, annRaw, definitieVan(doc, annRaw), naarPdfPagina, stiftBasis)
              : legendaAnnotDict(context, annRaw,
                legendaRegels(annRaw, zichtbareStiften(doc), definitiesVan(doc)), naarPdfPagina, stiftBasis);
            break;
          }

```

`/Stamp`, `/Square`, `/Line`, `/PolyLine` en `/Circle` staan al in `handledSubtypes`: de vorige versie van een stift of legenda wordt bij opslaan dus vervangen, niet verdubbeld. `/OC`, `/OPS_FillOpacity` en de review-status komen uit het gemeenschappelijke blok na de `switch`.

Direct na `    saveStylePresetsToCatalog(pdfDocLib);`:

```js

    // Stiftdefinities in de catalogus (/OPS_StiftDefs); zonder definities
    // verdwijnt de sleutel (saver/stift-meta.js).
    schrijfStiftDefinities(pdfDocLib, definitiesVan(doc));
```

`doc` is de `const doc = getActiveDocument();` die eerder in dezelfde `try` staat.

- [ ] **Stap 6: Controles**

Run: `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
Verwacht: alles groen.

- [ ] **Stap 7: Registreer de drie tests en commit**

```bash
git add open-pdf-studio/js/pdf/saver/stift-ap.js open-pdf-studio/js/pdf/saver/stift-ap.test.mjs open-pdf-studio/js/pdf/saver/stift-meta.js open-pdf-studio/js/pdf/saver/stift-meta.test.mjs open-pdf-studio/js/pdf/saver/stift-dict.js open-pdf-studio/js/pdf/saver/stift-dict.test.mjs open-pdf-studio/js/pdf/saver.js open-pdf-studio/package.json
git commit -m "feat(stift): save markers and legends with vector appearances and catalog definitions"
```

## Taak 12: Inlezen

**Bestanden:**
- Nieuw: `js/pdf/loader/stift-uit-pdf.js`.
- Wijzig:
  - `js/pdf/loader/color-extraction.js`: de stift- en legendasleutels lezen;
  - `js/pdf/loader/annotation-image-sources.mjs` en `js/pdf/loader/image-extraction.js`: een legenda niet als afbeelding uit de pagina knippen;
  - `js/pdf/loader/annotation-converter.js`: een stift of legenda komt terug als bewerkbaar object;
  - `js/pdf/loader.js`: momentopnamen en de catalogus in de definitielijst.
- Test: `js/pdf/loader/stift-uit-pdf.test.mjs`.

**Interfaces:**
- Gebruikt:
  - taak 11: `stiftGeomUitPdf`, `legendaUitPdf` en `leesStiftDefinities`, en in de rondgangtest `stiftAnnotDict`, `legendaAnnotDict` en `schrijfStiftDefinities`;
  - taak 1: `valideerDefinitie`, `vormVoorSoort`, `ifcVoorSoort`;
  - taak 3: `synchroniseerVak`;
  - taak 5: `neemDefinitieOver`, `pasCatalogusToe`;
  - de app: `pdfNum` uit `js/pdf/loader/pdf-helpers.js`, `decodePdfTextObject`.
- Produceert:
  - `leesStiftMeta(annotDict, context) → {stiftDefId?, stiftVorm?, stiftDef?, stiftGeom?, stiftRect?, stiftStand?, legKop?, legKolommen?, legPos?, legKader?, legRect?}`;
  - `stiftUitPdf(extra, rect, naarApp, basis) → velden|null`; een stift draagt `_stiftDefMomentopname` als de PDF een momentopname had;
  - `eigenVectorStempelIds(pageNum, pdfDoc) → Set<string>` in `annotation-image-sources.mjs`, met ids zoals PDF.js ze geeft (`"131R"`).

Waarom het uitknippen overslaan: de loader knipt elke `/Stamp` zonder ingebedde afbeelding uit via een volledige PDF.js-render van de pagina. Een legenda staat op een plattegrond, en daar kost die render seconden. De converter bouwt de legenda zelf op uit de sleutels, dus die afbeelding is nergens voor nodig.

- [ ] **Stap 1: Schrijf de test**

Bestand `js/pdf/loader/stift-uit-pdf.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { stiftUitPdf } from './stift-uit-pdf.js';
import { stiftGeomNaarPdf, legendaNaarPdf } from '../saver/stift-meta.js';
import { maakDefinitie } from '../../annotations/stift/definities.js';

const naarPdf = (x, y) => [x, 842 - y];
const naarApp = (X, Y) => [X, 842 - Y];
const basis = { page: 2, author: 'MV' };

test('een lijnstift komt terug met definitie-id, tekenwijze, geometrie en vak', () => {
  const def = maakDefinitie('nieuweWand', { id: 'hsb', omschrijving: 'HSB-wand' });
  const origineel = { vorm: 'lijn', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] };
  const extra = {
    opsSubtype: 'stift', stiftDefId: 'hsb', stiftVorm: 'lijn', stiftDef: JSON.stringify(def),
    stiftGeom: stiftGeomNaarPdf(origineel, naarPdf), stiftRect: [0, 800, 120, 830],
  };
  const stift = stiftUitPdf(extra, [0, 800, 120, 830], naarApp, basis);
  assert.equal(stift.type, 'stift');
  assert.equal(stift.page, 2);
  assert.equal(stift.stiftDefId, 'hsb');
  assert.equal(stift.vorm, 'lijn');
  assert.deepEqual(stift.points, origineel.points);
  assert.deepEqual([stift.x, stift.y, stift.width, stift.height], [10, 20, 100, 0]);
  assert.equal(stift.ifcCategory, 'IfcWall');
  assert.deepEqual(stift._stiftDefMomentopname, def);
});

test('verplaatst door een ander programma: de geometrie schuift mee met de /Rect', () => {
  const extra = {
    opsSubtype: 'stift', stiftDefId: 'k', stiftVorm: 'punt',
    stiftGeom: stiftGeomNaarPdf({ vorm: 'punt', x: 50, y: 50 }, naarPdf), stiftRect: [40, 780, 60, 800],
  };
  const stift = stiftUitPdf(extra, [50, 770, 70, 790], naarApp, basis);
  assert.deepEqual([stift.x, stift.y], [60, 60]);
});

test('I-profiel: de stand komt terug; een kapotte momentopname wordt genegeerd', () => {
  const extra = {
    opsSubtype: 'stift', stiftDefId: 'k', stiftVorm: 'punt', stiftStand: 90, stiftDef: '{kapot',
    stiftGeom: [1, 841],
  };
  const stift = stiftUitPdf(extra, null, naarApp, basis);
  assert.equal(stift.rotation, 90);
  assert.equal(stift._stiftDefMomentopname, undefined);
});

test('zonder geometrie geen stift; een onbekend subtype ook niet', () => {
  assert.equal(stiftUitPdf({ opsSubtype: 'stift', stiftVorm: 'lijn', stiftGeom: [1, 2] }, null, naarApp, basis), null);
  assert.equal(stiftUitPdf({ opsSubtype: 'betonbalk' }, null, naarApp, basis), null);
  assert.equal(stiftUitPdf(null, null, naarApp, basis), null);
});

test('een legenda komt terug met positie, kader, kop en kolommen', () => {
  const legenda = { x: 30, y: 40, kader: { x: 0, y: 0, width: 400, height: 300 } };
  const { pos, kader } = legendaNaarPdf(legenda, naarPdf);
  const extra = { opsSubtype: 'stiftLegenda', legPos: pos, legKader: kader, legKop: 'Dak', legKolommen: 2, legRect: [30, 700, 200, 802] };
  const uit = stiftUitPdf(extra, [30, 700, 200, 802], naarApp, basis);
  assert.deepEqual(uit, {
    page: 2, author: 'MV', type: 'stiftLegenda', x: 30, y: 40, width: 0, height: 0,
    kop: 'Dak', kolommen: 2, kader: { x: 0, y: 0, width: 400, height: 300 },
  });
  assert.equal(stiftUitPdf({ opsSubtype: 'stiftLegenda' }, null, naarApp, basis), null);
});

test('rondgang: opslaan met stift-dict, heropenen, sleutels lezen en terug naar stiften', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const { stiftAnnotDict, legendaAnnotDict } = await import('../saver/stift-dict.js');
  const { schrijfStiftDefinities, leesStiftDefinities } = await import('../saver/stift-meta.js');
  const { extractAnnotationColors } = await import('./color-extraction.js');
  const { standaardSet } = await import('../../annotations/stift/definities.js');
  const { legendaRegels } = await import('../../annotations/stift/legenda.js');

  const definities = standaardSet();
  const defVan = (id) => definities.find((d) => d.id === id);
  const stiften = [
    { type: 'stift', page: 1, vorm: 'lijn', stiftDefId: 'sd-std-nieuweWand', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }] },
    { type: 'stift', page: 1, vorm: 'pijl', stiftDefId: 'sd-std-vloer', startX: 150, startY: 400, endX: 150, endY: 200 },
    { type: 'stift', page: 1, vorm: 'punt', stiftDefId: 'sd-std-kolom', x: 50, y: 60, rotation: 90 },
    { type: 'stift', page: 1, vorm: 'kruis', stiftDefId: 'sd-std-sparing', x: 200, y: 300, width: 40, height: 20 },
  ];
  const legenda = { type: 'stiftLegenda', page: 1, x: 350, y: 500, kop: 'Dak', kolommen: 2, kader: { x: 0, y: 0, width: 420, height: 420 } };

  const doc = await PDFDocument.create();
  const blad = doc.addPage([595, 842]);
  const dicts = [
    ...stiften.map((s) => stiftAnnotDict(doc.context, s, defVan(s.stiftDefId), naarPdf, { F: 4 })),
    legendaAnnotDict(doc.context, legenda, legendaRegels(legenda, stiften, definities), naarPdf, { F: 4 }),
  ];
  blad.node.set((await import('pdf-lib')).PDFName.of('Annots'), doc.context.obj(dicts.map((d) => doc.context.register(d))));
  schrijfStiftDefinities(doc, definities);

  const heropend = await PDFDocument.load(await doc.save());
  assert.deepEqual(leesStiftDefinities(heropend), definities);
  const extras = [...(await extractAnnotationColors(1, heropend)).values()];
  const terug = extras
    .map((e) => stiftUitPdf(e, e.stiftRect || e.legRect, naarApp, { page: 1 }))
    .filter(Boolean);
  const perVorm = Object.fromEntries(terug.filter((a) => a.type === 'stift').map((a) => [a.vorm, a]));
  const dicht = (a, b) => Math.abs(a - b) < 1e-9;

  assert.deepEqual(perVorm.lijn.points.map((p) => [p.x, p.y]), [[100, 100], [300, 100], [300, 250]]);
  assert.ok(dicht(perVorm.pijl.startY, 400) && dicht(perVorm.pijl.endY, 200));
  assert.ok(dicht(perVorm.punt.x, 50) && dicht(perVorm.punt.y, 60));
  assert.equal(perVorm.punt.rotation, 90);
  assert.deepEqual([perVorm.kruis.x, perVorm.kruis.y, perVorm.kruis.width, perVorm.kruis.height].map(Math.round), [200, 300, 40, 20]);
  for (const s of stiften) {
    const t = perVorm[s.vorm];
    assert.equal(t.stiftDefId, s.stiftDefId);
    assert.deepEqual(t._stiftDefMomentopname, defVan(s.stiftDefId));
  }
  const leg = terug.find((a) => a.type === 'stiftLegenda');
  assert.deepEqual([leg.x, leg.y, leg.kop, leg.kolommen], [350, 500, 'Dak', 2]);
  assert.deepEqual(leg.kader, { x: 0, y: 0, width: 420, height: 420 });
});

test('een legenda wordt niet via een paginarender als afbeelding uitgeknipt', async () => {
  const { PDFDocument, PDFName, PDFString } = await import('pdf-lib');
  const { legendaAnnotDict } = await import('../saver/stift-dict.js');
  const { eigenVectorStempelIds } = await import('./annotation-image-sources.mjs');
  const doc = await PDFDocument.create();
  const blad = doc.addPage([595, 842]);
  const legenda = legendaAnnotDict(doc.context, { type: 'stiftLegenda', page: 1, x: 10, y: 10, kop: 'K', kolommen: 1, kader: null }, [], naarPdf);
  const gewoon = doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10], OPS_Subtype: PDFString.of('stavenreeks') });
  const refs = [doc.context.register(legenda), doc.context.register(gewoon)];
  blad.node.set(PDFName.of('Annots'), doc.context.obj(refs));
  const heropend = await PDFDocument.load(await doc.save());
  assert.deepEqual([...eigenVectorStempelIds(1, heropend)], [`${refs[0].objectNumber}R`]);
  assert.deepEqual([...eigenVectorStempelIds(2, heropend)], []);
  const bron = readFileSync(new URL('./image-extraction.js', import.meta.url), 'utf8');
  assert.match(bron, /if \(s\.id && eigen\.has\(s\.id\)\) return false;/);
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/pdf/loader/stift-uit-pdf.test.mjs`
Verwacht: FAIL, `Cannot find module …/stift-uit-pdf.js`.

- [ ] **Stap 3: Schrijf de module**

Bestand `js/pdf/loader/stift-uit-pdf.js`:

```js
// Een stift of legenda uit de sleutels die color-extraction.js las (zie
// saver/stift-meta.js voor wat de saver schrijft). Geeft de velden voor
// createAnnotation, of null als de geometrie ontbreekt: dan laadt de
// annotatie verderop als de gewone vorm (nooit crashen).
//
// De momentopname van de definitie komt mee als `_stiftDefMomentopname`; de
// loader neemt haar in het document op als dat id er nog niet is.

import { PDFName, PDFArray } from 'pdf-lib';
import { stiftGeomUitPdf, legendaUitPdf } from '../saver/stift-meta.js';
import { decodePdfTextObject } from '../saver/pdf-text.js';
import { pdfNum } from './pdf-helpers.js';
import { valideerDefinitie, vormVoorSoort, ifcVoorSoort } from '../../annotations/stift/definities.js';
import { synchroniseerVak } from '../../annotations/stift/geometrie.js';

const VORMEN = ['lijn', 'pijl', 'punt', 'kruis'];

// Welke eigen sleutel in welk veld komt, en als wat.
const TEKSTEN = [['OPS_StiftDefId', 'stiftDefId'], ['OPS_StiftVorm', 'stiftVorm'], ['OPS_StiftDef', 'stiftDef'], ['OPS_LegKop', 'legKop']];
const GETALLEN = [['OPS_StiftStand', 'stiftStand'], ['OPS_LegKolommen', 'legKolommen']];
const REEKSEN = [['OPS_StiftGeom', 'stiftGeom'], ['OPS_StiftRect', 'stiftRect'], ['OPS_LegPos', 'legPos'], ['OPS_LegKader', 'legKader'], ['OPS_LegRect', 'legRect']];

/**
 * De stift- en legendasleutels uit een annotatiewoordenboek, voor
 * color-extraction.js (zelfde patroon als leesPlattegrondMeta). Alleen de
 * sleutels die er zijn en leesbaar zijn, komen in de uitkomst.
 */
export function leesStiftMeta(annotDict, context) {
  const uit = {};
  if (!annotDict || typeof annotDict.get !== 'function') return uit;
  const waarde = (sleutel) => {
    const raw = annotDict.get(PDFName.of(sleutel));
    return raw ? (context.lookup(raw) || raw) : null;
  };
  for (const [sleutel, veld] of TEKSTEN) {
    const v = waarde(sleutel);
    const tekst = v ? decodePdfTextObject(v) : undefined;
    if (typeof tekst === 'string' && tekst) uit[veld] = tekst;
  }
  for (const [sleutel, veld] of GETALLEN) {
    const v = waarde(sleutel);
    const n = v ? pdfNum(v) : null;
    if (n !== null) uit[veld] = n;
  }
  for (const [sleutel, veld] of REEKSEN) {
    const v = waarde(sleutel);
    if (!(v instanceof PDFArray)) continue;
    const reeks = [];
    for (let i = 0; i < v.size(); i++) reeks.push(pdfNum(context.lookup(v.get(i)) || v.get(i)));
    if (reeks.every((n) => n !== null)) uit[veld] = reeks;
  }
  return uit;
}

// Verschil tussen de actuele /Rect en die wij schreven: een ander programma
// heeft het object dan verplaatst.
function verschuiving(opgeslagen, rect) {
  if (!Array.isArray(opgeslagen) || opgeslagen.length !== 4 || !Array.isArray(rect) || rect.length < 4) return [0, 0];
  return [rect[0] - opgeslagen[0], rect[1] - opgeslagen[1]];
}

/**
 * @param {object} extra  de sleutels uit color-extraction.js (`opsSubtype`, `stift…`, `leg…`)
 * @param {number[]} rect  de actuele /Rect van de annotatie
 * @param {(X: number, Y: number) => [number, number]} naarApp  PDF-ruimte naar weergaveruimte
 * @param {object} basis  de gemeenschappelijke velden van de converter (pagina, auteur, datums, …)
 * @returns {object|null}
 */
export function stiftUitPdf(extra, rect, naarApp, basis) {
  if (extra?.opsSubtype === 'stiftLegenda') {
    const pos = legendaUitPdf(extra.legPos, extra.legKader, naarApp, verschuiving(extra.legRect, rect));
    if (!pos) return null;
    return {
      ...basis, type: 'stiftLegenda', x: pos.x, y: pos.y, width: 0, height: 0,
      kop: extra.legKop || 'CONSTRUCTIE', kolommen: extra.legKolommen === 2 ? 2 : 1, kader: pos.kader,
    };
  }
  if (extra?.opsSubtype !== 'stift') return null;
  let momentopname = null;
  try {
    momentopname = extra.stiftDef ? valideerDefinitie(JSON.parse(extra.stiftDef)) : null;
  } catch {
    momentopname = null;
  }
  const vorm = VORMEN.includes(extra.stiftVorm) ? extra.stiftVorm
    : (momentopname ? vormVoorSoort(momentopname.soort) : 'lijn');
  const geometrie = stiftGeomUitPdf(vorm, extra.stiftGeom, naarApp, verschuiving(extra.stiftRect, rect));
  if (!geometrie) return null;
  const stift = synchroniseerVak({
    ...basis, type: 'stift', vorm, stiftDefId: extra.stiftDefId || momentopname?.id || '', ...geometrie,
  });
  if (momentopname) {
    stift.ifcCategory = ifcVoorSoort(momentopname.soort);
    stift._stiftDefMomentopname = momentopname;
  }
  if (vorm === 'punt' && extra.stiftStand) stift.rotation = extra.stiftStand % 180;
  return stift;
}
```

- [ ] **Stap 4: Sleutels lezen en de legenda niet uitknippen**

`js/pdf/loader/color-extraction.js`: direct na `import { leesPlattegrondMeta } from './plattegrond-meta.js';`:

```js
import { leesStiftMeta } from './stift-uit-pdf.js';
```

En direct na `      Object.assign(colors, leesPlattegrondMeta(annotDict, context));`:

```js

      // Stifttekening: definitie, tekenwijze en geometrie van een stift, of
      // kop, kolommen, positie en kader van een legenda (zie
      // loader/stift-uit-pdf.js en saver/stift-meta.js).
      if (colors.opsSubtype === 'stift' || colors.opsSubtype === 'stiftLegenda') {
        Object.assign(colors, leesStiftMeta(annotDict, context));
      }
```

`js/pdf/loader/annotation-image-sources.mjs`: direct vóór `export function findImageForAnnotation(`:

```js
// Eigen vectorstempels die de converter zelf opbouwt (de legenda van de
// stifttekening, loader/stift-uit-pdf.js): daarvoor hoeft geen afbeelding
// uit de pagina geknipt te worden. Dat knippen rendert via PDF.js de hele
// pagina, en dat kost op een zware plattegrond seconden.
const EIGEN_VECTORSTEMPELS = new Set(['stiftLegenda']);

/** De ids (zoals PDF.js ze geeft, bv. "131R") van de eigen vectorstempels op een pagina. */
export function eigenVectorStempelIds(pageNum, pdfDoc) {
  const ids = new Set();
  const page = pdfDoc?.getPages?.()[pageNum - 1];
  if (!page) return ids;
  const context = pdfDoc.context;
  const annotsRaw = page.node.get(PDFName.of('Annots'));
  const annotations = annotsRaw && context.lookup(annotsRaw);
  if (!annotations || typeof annotations.size !== 'function') return ids;
  for (let index = 0; index < annotations.size(); index += 1) {
    const annotationRaw = annotations.get(index);
    const annotation = context.lookup(annotationRaw);
    if (!annotation || typeof annotation.get !== 'function') continue;
    if (nameOf(annotation.get(PDFName.of('Subtype'))) !== '/Stamp') continue;
    const raw = annotation.get(PDFName.of('OPS_Subtype'));
    const sub = raw && (context.lookup(raw) || raw);
    const soort = typeof sub?.decodeText === 'function' ? sub.decodeText() : null;
    const id = annotationIdOf(annotationRaw);
    if (id && EIGEN_VECTORSTEMPELS.has(soort)) ids.add(id);
  }
  return ids;
}

```

`js/pdf/loader/image-extraction.js`: vervang de import van `./annotation-image-sources.mjs` door:

```js
import { findImageAnnotationSources, findImageForAnnotation, eigenVectorStempelIds } from './annotation-image-sources.mjs';
```

Vervang in `extractStampImagesHybrid` het blok:

```js
  // Identify stamps the pdf-lib path couldn't handle (key = rect string)
  const missing = stampAnnots.filter(s => {
    const rect = s.rect;
    if (!rect) return false;
    return !findImageForAnnotation(imageMap, s, 'stamp');
  });
```

door:

```js
  // Identify stamps the pdf-lib path couldn't handle (key = rect string).
  // Eigen vectorstempels (de stiftlegenda) bouwt de converter zelf op: die
  // niet via een paginarender uitknippen.
  const eigen = pdfLibDoc ? eigenVectorStempelIds(pageNum, pdfLibDoc) : new Set();
  const missing = stampAnnots.filter(s => {
    const rect = s.rect;
    if (!rect) return false;
    if (s.id && eigen.has(s.id)) return false;
    return !findImageForAnnotation(imageMap, s, 'stamp');
  });
```

- [ ] **Stap 5: Draai de test opnieuw**

Run: `node --test js/pdf/loader/stift-uit-pdf.test.mjs`
Verwacht: 7 tests, 7 pass. De rondgangtest slaat vier stiften en een legenda echt op met pdf-lib, leest ze met `extractAnnotationColors` en krijgt dezelfde geometrie, definities, kop, kolommen en kader terug.

- [ ] **Stap 6: Converter en loader**

`js/pdf/loader/annotation-converter.js`: direct na `import { plattegrondUitExtra } from './plattegrond-meta.js';`:

```js
import { stiftUitPdf } from './stift-uit-pdf.js';
```

In `converteerPdfAnnotatie`, direct vóór `  switch (annot.subtype) {` (na het blok `const baseProps = { … };`):

```js
  // Stifttekening: een stift of legenda met onze eigen sleutels komt terug
  // als bewerkbare stift (loader/stift-uit-pdf.js). Zonder bruikbare
  // geometrie laadt hij verderop als de gewone vorm.
  if (extraColors.opsSubtype === 'stift' || extraColors.opsSubtype === 'stiftLegenda') {
    const velden = stiftUitPdf(extraColors, annot.rect, (X, Y) => convertPoint(X, Y), baseProps);
    if (velden) {
      if (velden.type === 'stift' && !velden.ifcCategory && extraColors.opsIfcCategory) {
        velden.ifcCategory = extraColors.opsIfcCategory;
      }
      return createAnnotation(velden);
    }
  }

```

De laag (`/OC`) en de opmerking volgen daarna vanzelf via `convertPdfAnnotation`.

`js/pdf/loader.js`: direct na `import { leesAnnotatieLagen, pasGelezenLagenToe } from './saver/annotatie-lagen.js';`:

```js
import { neemDefinitieOver } from '../annotations/stift/document.js';
```

In `_convertAndPushAnnotations`, direct na `    if (!converted) continue;`:

```js
    // Stifttekening: de meegebrachte definitie (momentopname) komt in het
    // document als dat id er nog niet is (annotations/stift/document.js).
    if (converted._stiftDefMomentopname) {
      neemDefinitieOver(doc, converted._stiftDefMomentopname);
      delete converted._stiftDefMomentopname;
    }
```

Direct na het blok van de stijl-presets, dat eindigt op `      }).catch(() => { /* presets zijn optioneel — negeer leesfouten */ });` en `    }`:

```js

    // Stiftdefinities uit de catalogus (/OPS_StiftDefs): die gaan voor op de
    // momentopnamen van de stiften zelf. Niet-blokkerend, net als de
    // stijl-presets hierboven.
    getSharedPdfLibDoc(doc).then(async (pdfLibDoc) => {
      if (isClosed() || !pdfLibDoc) return;
      const { leesStiftDefinities } = await import('./saver/stift-meta.js');
      const { pasCatalogusToe } = await import('../annotations/stift/document.js');
      if (isClosed()) return;
      pasCatalogusToe(doc, leesStiftDefinities(pdfLibDoc));
    }).catch(() => { /* definities zijn optioneel */ });
```

De volgorde maakt niet uit: `pasCatalogusToe` laat de catalogus voorgaan en behoudt definities die alleen uit een momentopname kwamen.

- [ ] **Stap 7: Controles**

Run: `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
Verwacht: alles groen.

- [ ] **Stap 8: Registreer de test en commit**

```bash
git add open-pdf-studio/js/pdf/loader/stift-uit-pdf.js open-pdf-studio/js/pdf/loader/stift-uit-pdf.test.mjs open-pdf-studio/js/pdf/loader/color-extraction.js open-pdf-studio/js/pdf/loader/annotation-image-sources.mjs open-pdf-studio/js/pdf/loader/image-extraction.js open-pdf-studio/js/pdf/loader/annotation-converter.js open-pdf-studio/js/pdf/loader.js open-pdf-studio/package.json
git commit -m "feat(stift): load markers, legends and definitions back from the PDF"
```

## Taak 13: Klembord, MCP en IFC

**Bestanden:**
- Nieuw: `js/annotations/stift/klembord.js`, `js/annotations/stift/mcp.js`.
- Wijzig: `js/annotations/clipboard.js`, `js/mcp-bridge.js`, `js/solid/data/ifcCategoryMap.js`, `js/pdf/ifc-export.js`, `src-tauri/src/mcp_server.rs`.
- Tests: `js/annotations/stift/klembord.test.mjs`, `js/annotations/stift/mcp.test.mjs`, `js/annotations/stift/aanhaking.test.mjs`, en in `mcp_server.rs` de Rust-test `app_create_annotation_kent_stiften`.

**Interfaces:**
- Gebruikt:
  - taak 1: `SOORTEN`, `maakDefinitie`, `vormVoorSoort`, `ifcVoorSoort`;
  - taak 3: `synchroniseerVak`;
  - taak 5: `definitieVan`, `definitiesVan`, `neemDefinitieOver`, `zorgVoorDefinities`, `startsetUitVoorkeuren`, `kopieDefinities`;
  - taak 7: `recordStiftDefinities`;
  - de app: `beginUndoTransaction` en `endUndoTransaction` uit `js/core/undo-manager.js`.
- Produceert:
  - `metStiftDefinitie(kopie, doc)` en `neemStiftDefinitieMee(stift, doc, prefs, stap = 0)`;
  - `stiftUitOpdracht(props, doc, startset) → {velden, nieuweDefinitie}|{fout}` en `legendaUitOpdracht(props) → {velden}|{fout}`;
  - MCP: `app_create_annotation` met `type: 'stift'` (`stiftDefId`, of `soort` met `omschrijving`, plus de geometrie van de tekenwijze) of `type: 'stiftLegenda'` (`x`, `y`, en optioneel `kop`, `kolommen`, `kader`); `app_list_annotations` geeft `stiftDefId` en `vorm`, of `kop` en `kolommen`.
- Keuze: een definitie die bij plakken binnenkomt, hoort niet bij de ongedaan-maakstap van het plakken (net als de startset bij de eerste stift). Via MCP wel: daar vraag je een nieuwe definitie uitdrukkelijk, dus definitie en stift zijn samen één stap.

- [ ] **Stap 1: Schrijf de tests van de pure modules**

Bestand `js/annotations/stift/klembord.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { metStiftDefinitie, neemStiftDefinitieMee } from './klembord.js';
import { standaardSet, maakDefinitie } from './definities.js';

const kloon = (w) => JSON.parse(JSON.stringify(w));

test('kopiëren hangt een kopie van de definitie aan een stift, niet aan andere annotaties', () => {
  const eigen = maakDefinitie('latei', { id: 'eigen-latei', omschrijving: 'Stalen latei L100' });
  const bron = { stiftDefinities: [eigen] };
  const stift = metStiftDefinitie({ type: 'stift', vorm: 'lijn', stiftDefId: 'eigen-latei' }, bron);
  assert.deepEqual(stift._stiftDefKopie, eigen);
  stift._stiftDefKopie.omschrijving = 'x';
  assert.equal(eigen.omschrijving, 'Stalen latei L100');
  const vak = { type: 'box' };
  assert.equal(metStiftDefinitie(vak, bron), vak);
  assert.equal('_stiftDefKopie' in vak, false);
});

test('plakken in een leeg document: startset plus de meegebrachte definitie', () => {
  const eigen = maakDefinitie('latei', { id: 'eigen-latei', omschrijving: 'Stalen latei L100' });
  const doel = { annotations: [] };
  const stift = neemStiftDefinitieMee(
    { type: 'stift', vorm: 'lijn', stiftDefId: 'eigen-latei', _stiftDefKopie: kloon(eigen),
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }] }, doel, {}, 20);
  assert.equal(doel.stiftDefinities.length, standaardSet().length + 1);
  assert.equal(doel.stiftDefinities.at(-1).omschrijving, 'Stalen latei L100');
  assert.deepEqual(stift.points, [{ x: 30, y: 30 }, { x: 70, y: 30 }]);
  assert.deepEqual([stift.x, stift.y, stift.width, stift.height], [30, 30, 40, 0]);
  assert.equal('_stiftDefKopie' in stift, false);
});

test('kent het doeldocument het id al, dan geldt de eigen definitie', () => {
  const doel = { stiftDefinities: standaardSet() };
  doel.stiftDefinities[1].omschrijving = 'HSB-wand';
  const vreemd = { ...standaardSet()[1], omschrijving: 'Kalkzandsteen' };
  neemStiftDefinitieMee({ type: 'stift', vorm: 'lijn', stiftDefId: vreemd.id, _stiftDefKopie: vreemd,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, doel, {});
  assert.equal(doel.stiftDefinities.length, standaardSet().length);
  assert.equal(doel.stiftDefinities[1].omschrijving, 'HSB-wand');
});

test('plakken op plaats verschuift niets; een punt houdt zijn plek', () => {
  const doel = { stiftDefinities: standaardSet() };
  const lijn = neemStiftDefinitieMee({ type: 'stift', vorm: 'lijn', stiftDefId: 'sd-std-latei',
    points: [{ x: 5, y: 6 }, { x: 9, y: 6 }] }, doel, {});
  assert.deepEqual(lijn.points, [{ x: 5, y: 6 }, { x: 9, y: 6 }]);
  const punt = neemStiftDefinitieMee({ type: 'stift', vorm: 'punt', stiftDefId: 'sd-std-kolom', x: 40, y: 50 }, doel, {}, 20);
  assert.deepEqual([punt.x, punt.y], [40, 50]);
  const vak = { type: 'box', x: 1 };
  assert.equal(neemStiftDefinitieMee(vak, doel, {}, 20), vak);
});
```

Bestand `js/annotations/stift/mcp.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { stiftUitOpdracht, legendaUitOpdracht } from './mcp.js';
import { standaardSet } from './definities.js';

test('op definitie-id: velden met tekenwijze, IFC en vak; geen nieuwe definitie', () => {
  const doc = { stiftDefinities: standaardSet() };
  const r = stiftUitOpdracht({ stiftDefId: 'sd-std-liggerStaal', points: [{ x: 100, y: 200 }, { x: 400, y: 200 }] }, doc, []);
  assert.equal(r.nieuweDefinitie, null);
  assert.deepEqual(r.velden, {
    type: 'stift', stiftDefId: 'sd-std-liggerStaal', vorm: 'lijn', ifcCategory: 'IfcBeam',
    points: [{ x: 100, y: 200 }, { x: 400, y: 200 }], x: 100, y: 200, width: 300, height: 0,
  });
  assert.match(stiftUitOpdracht({ stiftDefId: 'bestaat-niet', points: [] }, doc, []).fout, /unknown stiftDefId/);
});

test('op soort en omschrijving: bestaande gebruiken, anders een nieuwe maken', () => {
  const doc = { stiftDefinities: standaardSet() };
  const bestaand = stiftUitOpdracht({ soort: 'kolom', omschrijving: 'Kolom', x: 10, y: 20 }, doc, []);
  assert.equal(bestaand.velden.stiftDefId, 'sd-std-kolom');
  assert.equal(bestaand.nieuweDefinitie, null);
  const nieuw = stiftUitOpdracht({ soort: 'kolom', omschrijving: 'HEA 160', x: 10, y: 20 }, doc, []);
  assert.equal(nieuw.nieuweDefinitie.omschrijving, 'HEA 160');
  assert.equal(nieuw.nieuweDefinitie.soort, 'kolom');
  assert.equal(nieuw.velden.stiftDefId, nieuw.nieuweDefinitie.id);
  // Alleen de soort: de eerste definitie van die soort.
  assert.equal(stiftUitOpdracht({ soort: 'sparing', x: 1, y: 2, width: 3, height: 4 }, doc, []).velden.stiftDefId, 'sd-std-sparing');
});

test('een document zonder lijst zoekt in de startset', () => {
  const r = stiftUitOpdracht({ soort: 'vloer', startX: 0, startY: 0, endX: 0, endY: 100 }, { annotations: [] }, standaardSet());
  assert.equal(r.velden.stiftDefId, 'sd-std-vloer');
  assert.equal(r.velden.vorm, 'pijl');
  assert.equal(r.nieuweDefinitie, null);
});

test('de geometrie moet bij de tekenwijze passen', () => {
  const doc = { stiftDefinities: standaardSet() };
  assert.match(stiftUitOpdracht({ soort: 'latei', x: 1, y: 2 }, doc, []).fout, /drawn as a line/);
  assert.match(stiftUitOpdracht({ soort: 'vloer', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, doc, []).fout, /drawn as an arrow/);
  assert.match(stiftUitOpdracht({ soort: 'paal' }, doc, []).fout, /drawn as a point/);
  assert.match(stiftUitOpdracht({ soort: 'sparing', x: 1, y: 2, width: 0, height: 4 }, doc, []).fout, /drawn as a cross/);
  assert.match(stiftUitOpdracht({ soort: 'onbekend' }, doc, []).fout, /one of bestaandeWand/);
  assert.equal(stiftUitOpdracht({ soort: 'kolom', x: 1, y: 2, rotation: 90 }, doc, []).velden.rotation, 90);
});

test('legenda: positie verplicht, kop en kolommen met standaard, kader optioneel', () => {
  assert.deepEqual(legendaUitOpdracht({ x: 30, y: 40 }).velden, {
    type: 'stiftLegenda', x: 30, y: 40, width: 0, height: 0, kop: 'CONSTRUCTIE', kolommen: 1, kader: null,
  });
  const r = legendaUitOpdracht({ x: 1, y: 2, kop: ' Dak ', kolommen: 2, kader: { x: 0, y: 0, width: 400, height: 300 } });
  assert.equal(r.velden.kop, 'Dak');
  assert.equal(r.velden.kolommen, 2);
  assert.deepEqual(r.velden.kader, { x: 0, y: 0, width: 400, height: 300 });
  assert.match(legendaUitOpdracht({ y: 2 }).fout, /requires props\.x, y/);
  assert.match(legendaUitOpdracht({ x: 1, y: 2, kader: { x: 0 } }).fout, /props\.kader/);
});
```

- [ ] **Stap 2: Draai de tests, ze moeten falen**

Run: `node --test js/annotations/stift/klembord.test.mjs js/annotations/stift/mcp.test.mjs`
Verwacht: FAIL, modules niet gevonden.

- [ ] **Stap 3: Schrijf de modules**

Bestand `js/annotations/stift/klembord.js`:

```js
// Stiften op het klembord (spec: Kopiëren en plakken tussen documenten).
// Bij kopiëren reist een kopie van de definitie mee; bij plakken komt die in
// het doeldocument als het dat id nog niet kent, anders geldt de eigen
// definitie. Puur: clipboard.js roept dit aan met het actieve document.
//
// Definities die zo binnenkomen, horen niet bij de ongedaan-maakstap van het
// plakken; net als bij het gereedschap (de startset bij de eerste stift) en
// bij het openen van een PDF blijven ze in de lijst staan.

import { definitieVan, neemDefinitieOver, zorgVoorDefinities } from './document.js';
import { synchroniseerVak } from './geometrie.js';

/** Hang bij het kopiëren een kopie van de definitie aan een (gekloonde) stift. */
export function metStiftDefinitie(kopie, doc) {
  if (kopie?.type !== 'stift') return kopie;
  const def = definitieVan(doc, kopie);
  if (def) kopie._stiftDefKopie = JSON.parse(JSON.stringify(def));
  return kopie;
}

/**
 * Bij het plakken van een stift: het document krijgt zo nodig de startset,
 * de meegebrachte definitie komt erbij als het id onbekend is, de punten van
 * een lijnstift schuiven mee met de plakstap en het vak wordt bijgewerkt.
 * Muteert en geeft de stift terug; andere annotaties blijven ongemoeid.
 * @param {object} stift  de gekloonde stift
 * @param {object} doc  het doeldocument
 * @param {object} prefs  de voorkeuren (voor de startset)
 * @param {number} [stap]  de plakverschuiving in pt (0 bij plakken op plaats)
 */
export function neemStiftDefinitieMee(stift, doc, prefs, stap = 0) {
  if (stift?.type !== 'stift') return stift;
  zorgVoorDefinities(doc, prefs);
  if (stift._stiftDefKopie) neemDefinitieOver(doc, stift._stiftDefKopie);
  delete stift._stiftDefKopie;
  if (stap && Array.isArray(stift.points)) {
    stift.points = stift.points.map((p) => ({ x: p.x + stap, y: p.y + stap }));
  }
  return synchroniseerVak(stift);
}
```

Bestand `js/annotations/stift/mcp.js`:

```js
// Stiften en legenda's via de MCP-opdracht app_create_annotation (spec:
// AI-koppeling). Puur: bepaalt de velden van de nieuwe annotatie en, als de
// gevraagde definitie nog niet bestond, de definitie die erbij moet. De
// foutteksten zijn Engels, net als de rest van de MCP-brug.

import { SOORTEN, maakDefinitie, vormVoorSoort, ifcVoorSoort } from './definities.js';
import { synchroniseerVak } from './geometrie.js';

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const punten = (lijst, min) => Array.isArray(lijst) && lijst.length >= min
  && lijst.every((p) => p && isGetal(p.x) && isGetal(p.y));
const SOORT_IDS = SOORTEN.map((s) => s.id);

// De definitie op id, of op soort (en omschrijving); anders een nieuwe.
function zoekDefinitie(p, lijst) {
  if (typeof p.stiftDefId === 'string' && p.stiftDefId) {
    const def = lijst.find((d) => d.id === p.stiftDefId);
    return def ? { def, nieuw: null } : { fout: `unknown stiftDefId '${p.stiftDefId}'` };
  }
  if (!SOORT_IDS.includes(p.soort)) {
    return { fout: `type 'stift' requires props.stiftDefId, or props.soort (one of ${SOORT_IDS.join(', ')}) with an optional props.omschrijving` };
  }
  const omschrijving = typeof p.omschrijving === 'string' && p.omschrijving.trim() ? p.omschrijving.trim() : null;
  const def = lijst.find((d) => d.soort === p.soort && (!omschrijving || d.omschrijving === omschrijving));
  if (def) return { def, nieuw: null };
  const nieuw = maakDefinitie(p.soort, { omschrijving: omschrijving ?? undefined, bestaande: lijst });
  return { def: nieuw, nieuw };
}

// De geometrie die bij de tekenwijze hoort, of een fout.
function geometrie(vorm, p, soort) {
  switch (vorm) {
    case 'lijn':
      return punten(p.points, 2)
        ? { points: p.points.map((q) => ({ x: q.x, y: q.y })) }
        : { fout: `marker kind '${soort}' is drawn as a line: props.points [{x,y}, ...] (>= 2)` };
    case 'pijl':
      return [p.startX, p.startY, p.endX, p.endY].every(isGetal)
        ? { startX: p.startX, startY: p.startY, endX: p.endX, endY: p.endY }
        : { fout: `marker kind '${soort}' is drawn as an arrow: props.startX, startY, endX, endY` };
    case 'punt':
      return isGetal(p.x) && isGetal(p.y)
        ? { x: p.x, y: p.y, ...(p.rotation === 90 ? { rotation: 90 } : {}) }
        : { fout: `marker kind '${soort}' is drawn as a point: props.x, y` };
    default:
      return [p.x, p.y, p.width, p.height].every(isGetal) && p.width > 0 && p.height > 0
        ? { x: p.x, y: p.y, width: p.width, height: p.height }
        : { fout: `marker kind '${soort}' is drawn as a cross: props.x, y, width > 0, height > 0` };
  }
}

/**
 * @param {object} props  de props van de opdracht
 * @param {object} doc  het actieve document
 * @param {object[]} startset  de definities die een document zonder lijst krijgt
 * @returns {{velden: object, nieuweDefinitie: object|null} | {fout: string}}
 */
export function stiftUitOpdracht(props, doc, startset) {
  const p = props || {};
  const lijst = Array.isArray(doc?.stiftDefinities) ? doc.stiftDefinities : (startset || []);
  const gezocht = zoekDefinitie(p, lijst);
  if (gezocht.fout) return { fout: gezocht.fout };
  const { def, nieuw } = gezocht;
  const vorm = vormVoorSoort(def.soort);
  const geo = geometrie(vorm, p, def.soort);
  if (geo.fout) return { fout: geo.fout };
  const velden = synchroniseerVak({
    type: 'stift', stiftDefId: def.id, vorm, ifcCategory: ifcVoorSoort(def.soort), ...geo,
  });
  return { velden, nieuweDefinitie: nieuw };
}

/**
 * @param {object} props  x, y (linkerbovenhoek), optioneel kop, kolommen (1|2) en kader {x, y, width, height}
 * @returns {{velden: object} | {fout: string}}
 */
export function legendaUitOpdracht(props) {
  const p = props || {};
  if (!isGetal(p.x) || !isGetal(p.y)) return { fout: "type 'stiftLegenda' requires props.x, y (top-left corner)" };
  const k = p.kader;
  if (k != null && !([k.x, k.y, k.width, k.height].every(isGetal) && k.width > 0 && k.height > 0)) {
    return { fout: "props.kader must be {x, y, width > 0, height > 0} or left out (whole page)" };
  }
  return {
    velden: {
      type: 'stiftLegenda', x: p.x, y: p.y, width: 0, height: 0,
      kop: typeof p.kop === 'string' && p.kop.trim() ? p.kop.trim() : 'CONSTRUCTIE',
      kolommen: p.kolommen === 2 ? 2 : 1,
      kader: k ? { x: k.x, y: k.y, width: k.width, height: k.height } : null,
    },
  };
}
```

- [ ] **Stap 4: Draai de tests opnieuw**

Run: `node --test js/annotations/stift/klembord.test.mjs js/annotations/stift/mcp.test.mjs`
Verwacht: 9 tests, 9 pass (klembord 4, mcp 5).

- [ ] **Stap 5: Schrijf de aanhaaktest**

Bestand `js/annotations/stift/aanhaking.test.mjs`:

```js
// De aanhaakpunten van taak 13: klembord, MCP-brug, IFC-labels en de
// IFC-export. Het gedrag zelf zit in de pure modules (klembord.js, mcp.js,
// met eigen tests); hier staat dat de app ze ook aanroept.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { IFC_LABELS, ifcCategoryForAnnotation } from '../../solid/data/ifcCategoryMap.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').split('\r\n').join('\n');
const aantal = (tekst, patroon) => (tekst.match(patroon) || []).length;

test('klembord: kopiëren hangt de definitie aan, alle drie de plakpaden nemen haar mee', () => {
  const kb = bron('../clipboard.js');
  assert.match(kb, /state\.clipboardAnnotation = metStiftDefinitie\(cloneAnnotation\(annotation\), getActiveDocument\(\)\);/);
  assert.match(kb, /annotations\.map\(a => metStiftDefinitie\(cloneAnnotation\(a\), bronDoc\)\)/);
  assert.equal(aantal(kb, /neemStiftDefinitieMee\(/g), 3);
});

test('MCP: stift en legenda maken, definitie en stift als één undo-stap, samenvatting met definitie', () => {
  const mcp = bron('../../mcp-bridge.js');
  assert.match(mcp, /case 'stift': \{\n\s*const \{ stiftUitOpdracht \}/);
  assert.match(mcp, /case 'stiftLegenda': \{\n\s*const \{ legendaUitOpdracht \}/);
  assert.match(mcp, /undoMod\.beginUndoTransaction\(\);[\s\S]*undoMod\.recordStiftDefinities\(oud, stiftDoc\.kopieDefinities\(doc\)\);[\s\S]*undoMod\.endUndoTransaction\(\);/);
  assert.match(mcp, /if \(a\.type === 'stift'\) \{ s\.stiftDefId = a\.stiftDefId; s\.vorm = a\.vorm; \}/);
  const rs = bron('../../../src-tauri/src/mcp_server.rs');
  assert.match(rs, /"count", "stift", "stiftLegenda"\]/);
});

test('IFC: de nieuwe categorieën hebben een label; een expliciete categorie wint', () => {
  assert.equal(IFC_LABELS.IfcColumn, 'Kolom');
  assert.equal(IFC_LABELS.IfcFooting, 'Fundering (balk/strook)');
  assert.equal(IFC_LABELS.IfcOpeningElement, 'Sparing');
  assert.equal(ifcCategoryForAnnotation({ type: 'stift', ifcCategory: 'IfcColumn' }), 'IfcColumn');
  const exp = bron('../../pdf/ifc-export.js');
  assert.match(exp, /props\.stiftDefId = ann\.stiftDefId;/);
  assert.match(exp, /stiftDef\?\.omschrijving/);
});
```

Run: `node --test js/annotations/stift/aanhaking.test.mjs`
Verwacht: FAIL, de aanhaakpunten ontbreken nog.

- [ ] **Stap 6: Klembord in `js/annotations/clipboard.js`**

Direct na `import { plakVerschuivingPt } from './minimummaat.js';`:

```js
import { metStiftDefinitie, neemStiftDefinitieMee } from './stift/klembord.js';
```

In `copyAnnotation`: vervang

```js
  state.clipboardAnnotation = cloneAnnotation(annotation);
  state.clipboardAnnotations = null;
```

door

```js
  state.clipboardAnnotation = metStiftDefinitie(cloneAnnotation(annotation), getActiveDocument());
  state.clipboardAnnotations = null;
```

In `copyAnnotations`: vervang `  state.clipboardAnnotations = annotations.map(a => cloneAnnotation(a));` door:

```js
  const bronDoc = getActiveDocument();
  state.clipboardAnnotations = annotations.map(a => metStiftDefinitie(cloneAnnotation(a), bronDoc));
```

In `pasteAnnotation`, direct vóór `  // Update page, id, and timestamps`:

```js
  // Stift: de definitie reist mee, de punten van een lijn schuiven mee.
  neemStiftDefinitieMee(newAnnotation, getActiveDocument(), state.preferences, off);

```

In `pasteAnnotations`, in de lus direct vóór `    newAnn.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);`:

```js
    neemStiftDefinitieMee(newAnn, getActiveDocument(), state.preferences, off);
```

In `pasteAnnotationsInPlace`, in de lus direct vóór `    doc.annotations.push(newAnn);`:

```js
    neemStiftDefinitieMee(newAnn, doc, state.preferences);
```

- [ ] **Stap 7: MCP in `js/mcp-bridge.js`**

In `_summarizeAnnotation`, direct vóór `  if (a.locked) s.locked = true;`:

```js
  // Stifttekening: definitie en tekenwijze; bij een legenda kop en kolommen.
  if (a.type === 'stift') { s.stiftDefId = a.stiftDefId; s.vorm = a.vorm; }
  if (a.type === 'stiftLegenda') { s.kop = a.kop; s.kolommen = a.kolommen; }
```

In `_buildCreateProps`, direct vóór `    case 'polyline': {`:

```js
    // Stifttekening (annotations/stift/mcp.js): de definitie op id, of op
    // soort en omschrijving (zo nodig nieuw); de geometrie volgt de tekenwijze.
    case 'stift': {
      const { stiftUitOpdracht } = await import('./annotations/stift/mcp.js');
      const { startsetUitVoorkeuren } = await import('./annotations/stift/document.js');
      const r = stiftUitOpdracht(p, stateMod.getActiveDocument(), startsetUitVoorkeuren(prefs));
      if (r.fout) return { error: r.fout };
      return { base: { ...r.velden, page }, stiftDefinitie: r.nieuweDefinitie };
    }

    case 'stiftLegenda': {
      const { legendaUitOpdracht } = await import('./annotations/stift/mcp.js');
      const r = legendaUitOpdracht(p);
      if (r.fout) return { error: r.fout };
      return { base: { ...r.velden, page } };
    }

```

In `handleCreateAnnotation`, direct na het blok dat eindigt op `    delete merged.anchor;` en `  }`:

```js
  // Stift en legenda: definitie, tekenwijze, IFC, geometrie en vak komen uit
  // de bouwer; `soort` en `omschrijving` waren alleen invoer.
  if (type === 'stift' || type === 'stiftLegenda') {
    delete merged.soort;
    delete merged.omschrijving;
    Object.assign(merged, built.base);
  }
```

Vervang in dezelfde functie:

```js
  doc.annotations.push(ann);
  const undoMod = await import('./core/undo-manager.js');
  undoMod.recordAdd(ann);
```

door:

```js
  const undoMod = await import('./core/undo-manager.js');
  if (type === 'stift') {
    // Het document krijgt zo nodig de startset, zoals bij het gereedschap; een
    // nieuw gevraagde definitie en de stift zijn samen één undo-stap.
    const stiftDoc = await import('./annotations/stift/document.js');
    stiftDoc.zorgVoorDefinities(doc, stateMod.state.preferences);
    undoMod.beginUndoTransaction();
    try {
      if (built.stiftDefinitie) {
        const oud = stiftDoc.kopieDefinities(doc);
        stiftDoc.neemDefinitieOver(doc, built.stiftDefinitie);
        undoMod.recordStiftDefinities(oud, stiftDoc.kopieDefinities(doc));
      }
      doc.annotations.push(ann);
      undoMod.recordAdd(ann);
    } finally {
      undoMod.endUndoTransaction();
    }
  } else {
    doc.annotations.push(ann);
    undoMod.recordAdd(ann);
  }
```

- [ ] **Stap 8: IFC**

`js/solid/data/ifcCategoryMap.js`: in `IFC_LABELS` direct na `  IfcBeam: 'Balk / ligger',`:

```js
  IfcColumn: 'Kolom',
  IfcFooting: 'Fundering (balk/strook)',
  IfcOpeningElement: 'Sparing',
```

De lijst in het eigenschappenpaneel (`GeneralSection.jsx`) leest `IFC_LABELS`, dus de drie categorieën zijn daar meteen te kiezen.

`js/pdf/ifc-export.js`: direct na `import { ifcCategoryForAnnotation } from '../solid/data/ifcCategoryMap.js';`:

```js
import { definitiesVan } from '../annotations/stift/document.js';
```

Vervang de kop van `_entityFor`:

```js
function _entityFor(ann) {
  const cls = _ifcClassFor(ann);
  const props = {};
```

door:

```js
function _entityFor(ann, stiftDefs) {
  const cls = _ifcClassFor(ann);
  const props = {};
  // Stift (stifttekening): naam, soort en kleur komen uit de definitie.
  const stiftDef = ann.type === 'stift' ? stiftDefs?.get(ann.stiftDefId) : null;
  if (ann.type === 'stift') {
    props.stiftDefId = ann.stiftDefId;
    props.vorm = ann.vorm;
    if (stiftDef) {
      props.soort = stiftDef.soort;
      props.omschrijving = stiftDef.omschrijving;
    }
  }
```

Vervang in het teruggegeven object `    name: ann.params?.naam || ann.measureName || ann.subject || null,` door:

```js
    name: ann.params?.naam || ann.measureName || stiftDef?.omschrijving || ann.subject || null,
```

en `      color: ann.strokeColor || ann.color || null,` door:

```js
      color: ann.strokeColor || ann.color || stiftDef?.kleur || null,
```

Vervang in `exportIfcReport` de regel `  const entities = (doc.annotations || []).map(_entityFor);` door:

```js
  const stiftDefs = new Map(definitiesVan(doc).map((d) => [d.id, d]));
  const entities = (doc.annotations || []).map((ann) => _entityFor(ann, stiftDefs));
```

- [ ] **Stap 9: Het MCP-schema in `src-tauri/src/mcp_server.rs`**

In de beschrijving van `app_create_annotation`: vervang het slot `measure* annotations get measureText computed from the document scale automatically. Returns the new annotation id.",` door:

```text
measure* annotations get measureText computed from the document scale automatically. stift (structural marker) needs stiftDefId, or soort (bestaandeWand, nieuweWand, stabiliteitswand, liggerStaal, liggerHout, latei, vloer, kolom, fundering, paal, sparing) with an optional omschrijving, plus the geometry of its kind: walls, beams, lintels and foundations points:[{x,y},...]; vloer startX/startY/endX/endY; kolom and paal x/y (rotation 90 for an I-section); sparing x/y/width/height. A missing definition is created with the defaults of its kind. stiftLegenda needs x/y (top-left) and optionally kop, kolommen (1 or 2) and kader {x,y,width,height}. Returns the new annotation id.",
```

Vervang in de `enum` van `type` het slot `"measureArea", "measurePerimeter", "scaleRegion", "count"]` door:

```text
"measureArea", "measurePerimeter", "scaleRegion", "count", "stift", "stiftLegenda"]
```

Voeg in `mod tests`, direct vóór `    fn app_import_cad_beschrijft_de_import_zonder_venster() {` en zijn `#[test]`, toe:

```rust
    #[test]
    fn app_create_annotation_kent_stiften() {
        let v = handle_tools_list();
        let maak = v["tools"].as_array().unwrap().iter()
            .find(|t| t["name"] == "app_create_annotation")
            .expect("app_create_annotation staat in de lijst")
            .clone();
        let soorten = maak["inputSchema"]["properties"]["type"]["enum"].as_array().unwrap();
        for soort in ["stift", "stiftLegenda"] {
            assert!(soorten.iter().any(|s| s == soort), "{soort} staat in de enum");
        }
        let uitleg = maak["description"].as_str().unwrap();
        assert!(uitleg.contains("stiftDefId") && uitleg.contains("kader"), "de beschrijving legt stiften uit");
    }

```

- [ ] **Stap 10: Draai de tests en de controles**

Run: `node --test js/annotations/stift/aanhaking.test.mjs`
Verwacht: 3 tests, 3 pass.

Run, in `open-pdf-studio/src-tauri`, met een eigen doelmap buiten OneDrive:

```bash
RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc RUSTFLAGS='-C target-feature=-crt-static' CARGO_TARGET_DIR=C:/Users/rickd/AppData/Local/Temp/opds-build-stift cargo test --no-run
```

Verwacht: `Finished`. Het uitvoeren van de lib-tests stopt op deze machine met `STATUS_ENTRYPOINT_NOT_FOUND`. Dat komt door de omgeving: het gebeurt ook op `main`, en CI draait geen Rust-tests. De schemacontrole zit daarom ook in `aanhaking.test.mjs` en, live, in `verify-stift.mjs` (taak 15).

Run: `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
Verwacht: alles groen.

- [ ] **Stap 11: Registreer de drie tests en commit**

```bash
git add open-pdf-studio/js/annotations/stift/klembord.js open-pdf-studio/js/annotations/stift/klembord.test.mjs open-pdf-studio/js/annotations/stift/mcp.js open-pdf-studio/js/annotations/stift/mcp.test.mjs open-pdf-studio/js/annotations/stift/aanhaking.test.mjs open-pdf-studio/js/annotations/clipboard.js open-pdf-studio/js/mcp-bridge.js open-pdf-studio/js/solid/data/ifcCategoryMap.js open-pdf-studio/js/pdf/ifc-export.js open-pdf-studio/src-tauri/src/mcp_server.rs open-pdf-studio/package.json
git commit -m "feat(stift): clipboard, MCP creation and IFC categories for markers"
```

## Taak 14: Hoeveelheden

**Voorwaarde:** #503 (de fix van #491) staat op `main` en de branch is daarop gerebased. Taak 10 is klaar: de teksten `stiften.stiftSectie` en `stiften.legendaSectie` bestaan in alle talen.

**Bestanden:**
- Wijzig:
  - `js/quantities/categories.js`: categorie, typenaam en lengte van een stift;
  - `js/solid/stores/quantitiesStore.js`: label, kleur en schaal uit de definitie;
  - `js/i18n/locales/*/properties.json`: `quantities.type.stift` en `quantities.type.stiftLegenda`.
- Test: `js/annotations/stift/hoeveelheden.test.mjs`.

**Interfaces:**
- Gebruikt: `definitiesVan` (taak 5); uit de app `withScale` en `metSchaalBronnen` (#503), `categoryOf`, `TYPE_NAMES`.
- Produceert:
  - een lijnstift valt in `line-based`, met de lengte in de eenheid van de schaal op zijn plek;
  - pijl, punt en kruis vallen in `count`;
  - label en telcategorie zijn de omschrijving, de kleur is die van de definitie.

- [ ] **Stap 1: Schrijf de test**

Bestand `js/annotations/stift/hoeveelheden.test.mjs`:

```js
// Hoeveelheden van stiften: een lijn telt zijn lengte (met de schaal op de
// plek van de stift), pijl, punt en kruis tellen als aantal. Label en kleur
// komen uit de definitie. Echte state-store en hoeveelhedenstaat; Solid
// draait reactief zoals in de app (zie ../../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const q = await import('../../solid/stores/quantitiesStore.js');
const { categoryOf, TYPE_NAMES } = await import('../../quantities/categories.js');
const { standaardSet } = await import('./definities.js');

// Schaal 1:100 in meters: 1 m = 10 mm op papier = 72 × 10 / 25,4 pt.
const PT_PER_M = (72 * 10) / 25.4;

function openen(annotations) {
  state.documents = [{
    id: 'doc-hoeveelheden', filePath: null, fileName: 'h.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations, stiftDefinities: standaardSet(),
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: { pixelsPerUnit: PT_PER_M, unit: 'm' }, pdfViewports: {},
  }];
  state.activeDocumentIndex = 0;
}

let volgnummer = 0;
const stift = (props) => ({ id: `s${++volgnummer}`, type: 'stift', page: 1, ...props });

test('categorie: lijnstift bij de lengtes, de andere tekenwijzen bij de aantallen', () => {
  assert.equal(categoryOf({ type: 'stift', vorm: 'lijn' }), 'line-based');
  for (const vorm of ['pijl', 'punt', 'kruis']) assert.equal(categoryOf({ type: 'stift', vorm }), 'count');
  assert.equal(TYPE_NAMES.stift, 'Marker');
  assert.equal(TYPE_NAMES.stiftLegenda, 'Legend');
});

test('de staat telt stiften per definitie: lengte in meters, aantallen, label en kleur', () => {
  openen([
    stift({ vorm: 'lijn', stiftDefId: 'sd-std-liggerStaal', ifcCategory: 'IfcBeam', x: 0, y: 0, width: 10 * PT_PER_M, height: 5 * PT_PER_M,
      points: [{ x: 0, y: 0 }, { x: 10 * PT_PER_M, y: 0 }, { x: 10 * PT_PER_M, y: 5 * PT_PER_M }] }),
    stift({ vorm: 'pijl', stiftDefId: 'sd-std-vloer', ifcCategory: 'IfcSlab', startX: 50, startY: 400, endX: 50, endY: 200 }),
    stift({ vorm: 'punt', stiftDefId: 'sd-std-kolom', ifcCategory: 'IfcColumn', x: 80, y: 90 }),
    stift({ vorm: 'kruis', stiftDefId: 'sd-std-sparing', ifcCategory: 'IfcOpeningElement', x: 10, y: 10, width: 40, height: 20 }),
  ]);
  q.setSelectedCategories(['line-based', 'count']);
  q.setScheduledFields(['label', 'color', 'ifcCategory', 'length', 'countCat', 'count']);
  q.setItemize(true);
  const rijen = q.scheduleResult().groups.flatMap((g) => g.rows.map((r) => r.vals));
  const per = Object.fromEntries(rijen.map((r) => [r.label, r]));
  assert.ok(Math.abs(per['Ligger staal'].length - 15) < 1e-9, `lengte ${per['Ligger staal'].length}`);
  assert.equal(per['Ligger staal'].color, '#7D9EBF');
  assert.equal(per['Ligger staal'].ifcCategory, 'IfcBeam');
  for (const label of ['Balklaag of vloer', 'Kolom', 'Sparing']) {
    assert.equal(per[label].length, null, `${label} heeft geen lengte`);
    assert.equal(per[label].countCat, label);
    assert.equal(per[label].count, 1);
  }
});

test('alle 39 talen: de typenamen gelijk aan de termen van het stiftenpaneel', () => {
  const TALEN = new URL('../../i18n/locales/', import.meta.url);
  const talen = readdirSync(TALEN);
  assert.equal(talen.length, 39);
  for (const taal of talen) {
    const p = JSON.parse(readFileSync(new URL(`${taal}/properties.json`, TALEN), 'utf8'));
    assert.ok(p.stiften?.stiftSectie && p.stiften?.legendaSectie, `${taal}: blok stiften uit taak 10`);
    assert.equal(p.quantities.type.stift, p.stiften.stiftSectie, `${taal} quantities.type.stift`);
    assert.equal(p.quantities.type.stiftLegenda, p.stiften.legendaSectie, `${taal} quantities.type.stiftLegenda`);
  }
});
```

- [ ] **Stap 2: Draai de test, hij moet falen**

Run: `node --test js/annotations/stift/hoeveelheden.test.mjs`
Verwacht: FAIL. Een stift valt in `other`, `TYPE_NAMES.stift` bestaat niet en de talen missen de typenamen.

- [ ] **Stap 3: `js/quantities/categories.js`**

Vervang `categoryOf`:

```js
/** Categorie-key van een element (pseudo-elementen kunnen __category forceren). */
export function categoryOf(el) {
  return el.__category || TYPE_TO_CATEGORY[el.type] || 'other';
}
```

door:

```js
/** Categorie-key van een element (pseudo-elementen kunnen __category forceren). */
export function categoryOf(el) {
  if (el.__category) return el.__category;
  // Stift (stifttekening): een lijn telt als lengte; pijl, punt en kruis
  // tellen als aantal.
  if (el.type === 'stift') return el.vorm === 'lijn' ? 'line-based' : 'count';
  return TYPE_TO_CATEGORY[el.type] || 'other';
}
```

Voeg in `TYPE_NAMES` direct na `  betonbalk: 'Concrete beam',` toe:

```js
  stift: 'Marker', stiftLegenda: 'Legend',
```

Voeg in `lengthMeting` als eerste regels van de functie toe:

```js
  // Een pijl-, punt- of kruisstift heeft wel coördinaten, maar geen lengte
  // die je wilt optellen: die tellen als aantal.
  if (el.type === 'stift' && el.vorm !== 'lijn') return null;
```

- [ ] **Stap 4: `js/solid/stores/quantitiesStore.js`**

Direct na `import { metSchaalBronnen } from '../../annotations/schaal-bronnen.js';`:

```js
import { definitiesVan } from '../../annotations/stift/document.js';
```

Direct vóór `// --- Config signals ---`:

```js
// Stift (stifttekening): label en kleur uit de definitie. Een lijnstift krijgt
// de schaal op zijn plek voor de LENGTE-kolom; pijl, punt en kruis tellen als
// aantal, met de omschrijving als telcategorie.
function stiftVoorStaat(a, def) {
  const verrijkt = { ...a, label: def?.omschrijving || '', color: def?.kleur || '' };
  if (a.vorm === 'lijn') return withScale(verrijkt);
  return { ...verrijkt, __countCatName: def?.omschrijving || '' };
}

```

Vervang in `collectElements`:

```js
  const anns = metSchaalBronnen(() => (doc?.annotations || []).map(a => {
    if (a.type === 'count') return { ...a, __countCatName: countCatName(a.categoryId) };
```

door:

```js
  // De stiftdefinities één keer per berekening opzoeken, niet per stift.
  const stiftDefs = new Map(definitiesVan(doc).map((d) => [d.id, d]));
  const anns = metSchaalBronnen(() => (doc?.annotations || []).map(a => {
    if (a.type === 'stift') return stiftVoorStaat(a, stiftDefs.get(a.stiftDefId));
    if (a.type === 'count') return { ...a, __countCatName: countCatName(a.categoryId) };
```

`withScale` loopt binnen `metSchaalBronnen`, dus met de schaalindex per pagina uit #503; er komt geen doorgang over alle annotaties per stift bij.

- [ ] **Stap 5: De typenamen in alle 39 talen**

Dezelfde termen als het paneel (taak 10), zodat staat en paneel hetzelfde woord gebruiken. De localebestanden zijn opgemaakt als `JSON.stringify(…, null, 2)`, dus herschrijven verandert verder niets. Run in `open-pdf-studio`:

```bash
node -e "const fs=require('fs');const d='js/i18n/locales';for(const t of fs.readdirSync(d)){const p=d+'/'+t+'/properties.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.quantities.type.stift=j.stiften.stiftSectie;j.quantities.type.stiftLegenda=j.stiften.legendaSectie;fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');}"
```

Controleer met `git diff --stat js/i18n/locales` dat per taal alleen `properties.json` verandert, met twee regels erbij.

- [ ] **Stap 6: Draai de test en de controles**

Run: `node --test js/annotations/stift/hoeveelheden.test.mjs`
Verwacht: 3 tests, 3 pass. De lijnstift van 10 m + 5 m telt 15 m; pijl, punt en kruis tellen elk 1 zonder lengte.

Run: `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
Verwacht: alles groen.

- [ ] **Stap 7: Registreer de test en commit**

```bash
git add open-pdf-studio/js/quantities/categories.js open-pdf-studio/js/solid/stores/quantitiesStore.js open-pdf-studio/js/i18n/locales open-pdf-studio/js/annotations/stift/hoeveelheden.test.mjs open-pdf-studio/package.json
git commit -m "feat(stift): count markers per definition in the quantities schedule"
```

## Taak 15: Verificatie en pull request

**Bestanden:**
- Nieuw:
  - `scripts/bench/stift-node.mjs` (in `open-pdf-studio/`): de prestatiemeting;
  - `scripts/verify-stift.mjs` in de repo-root, naast `verify-tekstrotatie.mjs`: de poorttest op de testinstantie (rondgang A4, rondgang /Rotate 90, muis, 1000 stiften openen).

Delen A, B en D van `verify-stift.mjs` zijn bij het schrijven van dit plan al gedraaid tegen een testinstantie met taak 7 en 11 tot en met 14. De opgeslagen PDF's toonden in MuPDF en PDFium hetzelfde als de bedoelde weergave, ook op het /Rotate-90-blad.

**Interfaces:**
- Gebruikt: alles uit taak 1 tot en met 14; de bestaande poortscripts in de repo-root `scripts/`.

**Regels voor de testinstantie:**
- Eigen poorten en eigen mappen. Nooit 3041, 3413, 9223 of 9345, nooit de app van de gebruiker.
- Stoppen alleen op de eigen `--mcp-port`, nooit op procesnaam.
- Poortscripts met een vaste poort of een vast playwright-pad (`verify-rotation-sweep.mjs`, `verify-mupdf-compare.mjs`) draai je als kopie in de kladmap, met de poort en het pad vervangen. Het origineel blijft ongewijzigd.

- [ ] **Stap 1: Prestatiemeting**

Bestand `scripts/bench/stift-node.mjs`:

```js
// Benchmark stifttekening: 1000 stiften op één pagina, tegen de ECHTE
// state-store, undo-manager en hoeveelhedenstaat (Solid reactief, zoals in de
// app; zie js/core/app-test-hooks.mjs). Alleen het canvas is een lege context.
//
//   node scripts/bench/stift-node.mjs [aantal=1000] [--reps=5] [--json]
//
// Gemeten per stap (mediaan van --reps runs, ms):
//   teken      alle stiften tekenen (wat de tekenlus per frame voor stiften doet)
//   legenda    regels en indeling van één legenda over alle stiften
//   wijzig     één stift verplaatsen + recordModify (einde van een sleep)
//   undo       undo() van die verplaatsing
//   definitie  de kleur van een definitie wijzigen als één undo-stap
//   staat      de hoeveelhedenstaat met het paneel open
// Exit 1 als een stap boven de grens van 100 ms uitkomt (spec: Randgevallen).

import { register } from 'node:module';

register('../../js/core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../js/core/app-test-hooks.mjs');
installeerBrowserStubs();

const args = process.argv.slice(2);
const AANTAL = Number(args.find((a) => /^\d+$/.test(a)) || 1000);
const REPS = Number((args.find((a) => a.startsWith('--reps=')) || '--reps=5').slice(7));
const alsJson = args.includes('--json');
const GRENS_MS = 100;

const js = (p) => new URL(`../../js/${p}`, import.meta.url).href;
const solid = await import('solid-js');
const { state } = await import(js('core/state.ts'));
const { createAnnotation } = await import(js('annotations/factory.js'));
const undo = await import(js('core/undo-manager.js'));
const hoeveelheden = await import(js('solid/stores/quantitiesStore.js'));
const { standaardSet } = await import(js('annotations/stift/definities.js'));
const { kopieDefinities, zichtbareStiften, definitiesVan } = await import(js('annotations/stift/document.js'));
const { legendaRegels, legendaIndeling } = await import(js('annotations/stift/legenda.js'));
const { tekenStift } = await import(js('annotations/rendering/stift-draw.js'));

// Een 2D-context die niets doet: we meten het opbouwen van de opdrachten en
// de aanroepen, niet de pixels.
const leegCtx = new Proxy({}, { get: () => () => {}, set: () => true });

const SOORTEN = ['sd-std-nieuweWand', 'sd-std-liggerStaal', 'sd-std-vloer', 'sd-std-kolom', 'sd-std-sparing'];
function maakStift(i) {
  const x = 20 + (i % 40) * 14;
  const y = 20 + Math.floor(i / 40) * 30;
  const stiftDefId = SOORTEN[i % SOORTEN.length];
  const basis = { type: 'stift', page: 1, stiftDefId };
  switch (stiftDefId) {
    case 'sd-std-vloer': return createAnnotation({ ...basis, vorm: 'pijl', startX: x, startY: y, endX: x, endY: y + 20, x, y, width: 0, height: 20 });
    case 'sd-std-kolom': return createAnnotation({ ...basis, vorm: 'punt', x, y });
    case 'sd-std-sparing': return createAnnotation({ ...basis, vorm: 'kruis', x, y, width: 10, height: 8 });
    default: return createAnnotation({ ...basis, vorm: 'lijn', points: [{ x, y }, { x: x + 12, y }], x, y, width: 12, height: 0 });
  }
}

function maakDocument(n) {
  return {
    id: `bench-stift-${n}-${Math.random().toString(36).slice(2, 8)}`,
    filePath: null, fileName: 'stiften.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single',
    annotations: Array.from({ length: n }, (_, i) => maakStift(i)),
    stiftDefinities: standaardSet(),
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
    measureScale: null, pdfViewports: {},
  };
}

const nu = () => performance.now();
const mediaan = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function eenRun(n) {
  const r = {};
  state.documents = [];
  state.activeDocumentIndex = -1;
  state.documents = [maakDocument(n)];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];

  let t = nu();
  for (const a of doc.annotations) tekenStift(leegCtx, a, doc);
  r.teken = nu() - t;

  const legenda = { type: 'stiftLegenda', page: 1, x: 600, y: 20, kop: 'CONSTRUCTIE', kolommen: 1, kader: null };
  t = nu();
  legendaIndeling(legenda, legendaRegels(legenda, zichtbareStiften(doc), definitiesVan(doc)));
  r.legenda = nu() - t;

  const doel = doc.annotations[Math.floor(n / 2)];
  const voor = JSON.parse(JSON.stringify(doel));
  t = nu();
  if (doel.points) doel.points = doel.points.map((p) => ({ x: p.x + 5, y: p.y + 5 }));
  doel.x += 5;
  doel.y += 5;
  undo.recordModify(doel.id, voor, doel);
  r.wijzig = nu() - t;
  t = nu();
  await undo.undo();
  r.undo = nu() - t;

  t = nu();
  const oud = kopieDefinities(doc);
  const nieuw = oud.map((d) => (d.id === 'sd-std-liggerStaal' ? { ...d, kleur: '#123456' } : d));
  doc.stiftDefinities = nieuw;
  undo.recordStiftDefinities(oud, kopieDefinities(doc));
  for (const a of doc.annotations) tekenStift(leegCtx, a, doc);
  r.definitie = nu() - t;

  // De memo rekent al bij het openen van het paneel: de klok loopt vanaf daar.
  let stop = () => {};
  t = nu();
  hoeveelheden.setScheduleVisible(true);
  solid.createRoot((d) => { stop = d; solid.createComputed(() => { hoeveelheden.scheduleResult(); }); });
  r.staat = nu() - t;
  stop();
  hoeveelheden.setScheduleVisible(false);
  return r;
}

const runs = [];
for (let i = 0; i < REPS; i++) runs.push(await eenRun(AANTAL));
const uitkomst = { aantal: AANTAL };
for (const k of Object.keys(runs[0])) uitkomst[k] = +mediaan(runs.map((x) => x[k])).toFixed(1);
const te = Object.entries(uitkomst).filter(([k, v]) => k !== 'aantal' && v > GRENS_MS);
console.log(alsJson ? JSON.stringify(uitkomst) : uitkomst);
if (te.length) {
  console.error(`boven ${GRENS_MS} ms: ${te.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  process.exit(1);
}
```

Run: `node scripts/bench/stift-node.mjs 1000`
Verwacht: exit 0, elke stap onder 100 ms. Ter referentie, op deze machine met de validatiecode: teken 7, legenda 1, wijzig 0,1, undo 2, definitie 5, staat 41 (ms, bij 1000 stiften).

Werk de spec bij: vervang in `docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md`, alinea **Welke regels**, de zin "Dat bepalen is één doorgang over de stiften van de pagina, met een cache per documentversie: bij duizend stiften mag een hertekening er niet merkbaar trager van worden." door "Dat bepalen is één doorgang over de stiften van de pagina, zonder cache: bij duizend stiften kost het minder dan een milliseconde (`scripts/bench/stift-node.mjs`)."

```bash
git add open-pdf-studio/scripts/bench/stift-node.mjs docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md
git commit -m "test(bench): measure drawing, editing and scheduling 1000 markers"
```

- [ ] **Stap 2: Het poortscript**

Bestand `scripts/verify-stift.mjs (repo-root)`:

```js
// Poorttest stifttekening, deel 1 (stiften en legenda). Tegen een testrig:
//   A. blanco A4: één stift per soort via app_create_annotation, een nieuwe
//      definitie op soort en omschrijving, en een legenda; opslaan, de tab
//      sluiten, heropenen: definities en geometrie gelijk.
//   B. een kopie van een blad met /Rotate 90 (-CP-21 Constructieoverzicht):
//      stiften en een legenda, zelfde rondgang.
//   C. met de muis: een lijnstift van drie punten met het gereedschap Stift.
//   D. 1000 stiften: opslaan, heropenen en de tijd meten tot ze er allemaal zijn.
// Schermafdrukken (vóór opslaan en na heropenen) gaan naar de uitvoermap;
// bekijk ze zelf. Daarna vergelijkt verify-mupdf-compare.mjs de opgeslagen
// PDF's met MuPDF.
//
// Voorwaarden: testrig met --mcp-server en CDP (WEBVIEW2_ADDITIONAL_BROWSER_
// ARGUMENTS=--remote-debugging-port=...). Nooit de poorten van je eigen app.
// Gebruik:
//   MCP_PORT=<poort> CDP_PORT=<poort> node scripts/verify-stift.mjs <uitvoermap>
// Exit 0 = GOED, 1 = MISLUKT, 2 = verkeerd aangeroepen.

import fs from 'node:fs';
import path from 'node:path';

if (!process.env.MCP_PORT || !process.env.CDP_PORT || !process.argv[2]) {
  console.error('gebruik: MCP_PORT=<poort> CDP_PORT=<poort> node scripts/verify-stift.mjs <uitvoermap>');
  process.exit(2);
}
const MCP = `http://127.0.0.1:${process.env.MCP_PORT}/mcp`;
const CDP = process.env.CDP_PORT;
const UIT = path.resolve(process.argv[2]);
fs.mkdirSync(UIT, { recursive: true });
const BRON_ROTATIE = 'C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden/-CP-21 Constructieoverzicht.pdf';
const TOL = 0.05; // pt

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mcpId = 0;
async function mcp(naam, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: naam, arguments: args } }),
  });
  const j = JSON.parse(await res.text());
  if (j.error) throw new Error(naam + ': ' + (j.error.message || JSON.stringify(j.error)));
  const c = j?.result?.content?.[0];
  if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
  return j.result;
}

let ws = null, cdpId = 0;
const wachters = new Map();
async function cdpVerbind() {
  const lijst = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const page = lijst.find((t) => t.type === 'page');
  if (!page) throw new Error('geen CDP-pagina — start de rig met --remote-debugging-port');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && wachters.has(m.id)) { wachters.get(m.id)(m); wachters.delete(m.id); }
  });
}
const cdp = (method, params = {}) => new Promise((res) => { const i = ++cdpId; wachters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

const fouten = [];
const fout = (tekst) => { fouten.push(tekst); console.log('FOUT —', tekst); };

async function maak(type, props) {
  const r = await mcp('app_create_annotation', { page: 1, type, props });
  if (!r?.ok) fout(`${type} ${JSON.stringify(props).slice(0, 80)}: ${r?.error || JSON.stringify(r)}`);
  return r?.id;
}

async function volledig() {
  const lijst = (await mcp('app_list_annotations', {}))?.annotations || [];
  const uit = [];
  for (const a of lijst) {
    if (a.type !== 'stift' && a.type !== 'stiftLegenda') continue;
    const g = await mcp('app_get_annotation', { id: a.id });
    uit.push(g?.annotation || g);
  }
  return uit;
}

async function schermafdruk(naam) {
  const r = await mcp('app_screenshot_view', { width: 2000 });
  if (r?.png_base64) fs.writeFileSync(path.join(UIT, naam), Buffer.from(r.png_base64, 'base64'));
}

// Vergelijkbare vorm van een stift of legenda: sleutel en geometrie.
function vorm(a) {
  if (a.type === 'stiftLegenda') {
    return { sleutel: `legenda:${a.kop}`, getallen: [a.x, a.y, ...(a.kader ? [a.kader.x, a.kader.y, a.kader.width, a.kader.height] : [])], kolommen: a.kolommen };
  }
  const g = a.vorm === 'lijn' ? a.points.flatMap((p) => [p.x, p.y])
    : a.vorm === 'pijl' ? [a.startX, a.startY, a.endX, a.endY]
      : a.vorm === 'punt' ? [a.x, a.y, a.rotation || 0]
        : [a.x, a.y, a.width, a.height];
  return { sleutel: `${a.stiftDefId}:${a.vorm}`, getallen: g };
}

function vergelijk(label, voor, na) {
  const perSleutel = new Map(na.map((a) => [vorm(a).sleutel, vorm(a)]));
  if (na.length !== voor.length) fout(`${label}: ${voor.length} objecten vóór, ${na.length} na heropenen`);
  for (const a of voor) {
    const v = vorm(a);
    const n = perSleutel.get(v.sleutel);
    if (!n) { fout(`${label}: ${v.sleutel} ontbreekt na heropenen`); continue; }
    const afw = Math.max(0, ...v.getallen.map((x, i) => Math.abs(x - n.getallen[i])));
    if (n.getallen.length !== v.getallen.length || afw > TOL) {
      fout(`${label}: ${v.sleutel} geometrie ${JSON.stringify(n.getallen)} (was ${JSON.stringify(v.getallen)})`);
    }
    if (v.kolommen !== n.kolommen) fout(`${label}: ${v.sleutel} kolommen ${n.kolommen} (was ${v.kolommen})`);
  }
}

async function rondgang(label, bestand) {
  const voor = await volledig();
  await schermafdruk(`${label}-voor.png`);
  const opgeslagen = await mcp('app_save_pdf', { path: bestand });
  if (!opgeslagen?.ok) fout(`${label}: opslaan mislukt: ${opgeslagen?.error}`);
  await sleep(1500);
  const tabs = await mcp('app_list_tabs', {});
  await mcp('app_close_tab', { index: tabs.activeIndex, force: true });
  await sleep(800);
  await mcp('app_open_pdf', { path: bestand });
  await sleep(4000);
  await mcp('app_fit_page', {});
  await sleep(2500);
  const na = await volledig();
  await schermafdruk(`${label}-na.png`);
  vergelijk(label, voor, na);
  console.log(`${label}: ${voor.length} objecten vóór, ${na.length} na heropenen`);
  return na;
}

// De stiften van één blad: elke soort één keer, rond (ox, oy).
async function tekenAlleSoorten(ox, oy) {
  const lijn = (soort, dy) => maak('stift', { soort, points: [{ x: ox, y: oy + dy }, { x: ox + 160, y: oy + dy }, { x: ox + 160, y: oy + dy + 40 }] });
  await lijn('bestaandeWand', 0);
  await lijn('nieuweWand', 60);
  await lijn('stabiliteitswand', 120);
  await lijn('liggerStaal', 180);
  await lijn('liggerHout', 240);
  await lijn('latei', 300);
  await lijn('fundering', 360);
  await maak('stift', { soort: 'vloer', startX: ox + 260, startY: oy + 200, endX: ox + 260, endY: oy + 40 });
  await maak('stift', { soort: 'kolom', x: ox + 320, y: oy + 60 });
  await maak('stift', { soort: 'kolom', omschrijving: 'HEA 160', x: ox + 320, y: oy + 120, rotation: 90 });
  await maak('stift', { soort: 'paal', x: ox + 320, y: oy + 180 });
  await maak('stift', { soort: 'sparing', x: ox + 300, y: oy + 240, width: 60, height: 40 });
  await maak('stiftLegenda', { x: ox, y: oy + 460, kop: 'Begane grond', kader: { x: ox - 20, y: oy - 20, width: 420, height: 460 } });
}

await cdpVerbind();

// ── Schema: app_create_annotation kent stift en stiftLegenda ─────────────────
{
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/list', params: {} }),
  });
  const tools = JSON.parse(await res.text())?.result?.tools || [];
  const soorten = tools.find((t) => t.name === 'app_create_annotation')?.inputSchema?.properties?.type?.enum || [];
  for (const soort of ['stift', 'stiftLegenda']) {
    if (!soorten.includes(soort)) fout(`schema: app_create_annotation kent '${soort}' niet`);
  }
}

// ── A: blanco A4 ─────────────────────────────────────────────────────────────
console.log('A: blanco A4');
await mcp('app_new_blank_pdf', { pages: 1, widthPt: 595, heightPt: 842 });
await sleep(1500);
await tekenAlleSoorten(60, 60);
const nieuwe = (await volledig()).find((a) => a.type === 'stift' && a.vorm === 'punt' && a.rotation === 90);
if (!nieuwe || nieuwe.stiftDefId.startsWith('sd-std-')) fout('A: "kolom" met omschrijving "HEA 160" kreeg geen eigen nieuwe definitie');
await rondgang('A', path.join(UIT, 'stift-a4.pdf').replace(/\\/g, '/'));

// ── B: blad met /Rotate 90 ─────────────────────────────────────────────────────
console.log('B: blad met /Rotate 90');
const kopie = path.join(UIT, 'stift-rotate90.pdf').replace(/\\/g, '/');
fs.copyFileSync(BRON_ROTATIE, kopie);
await mcp('app_open_pdf', { path: kopie });
await sleep(4000);
await mcp('app_fit_page', {});
await sleep(1500);
await tekenAlleSoorten(80, 80);
await rondgang('B', kopie);

// ── C: met de muis ─────────────────────────────────────────────────────────────
console.log('C: lijnstift met de muis');
await mcp('app_new_blank_pdf', { pages: 1, widthPt: 595, heightPt: 842 });
await sleep(1500);
await evalJs(`(() => { const b = [...document.querySelectorAll('button,[role=button]')].find(x => /(enkele pagina|single page)/i.test(x.title || '')); if (b) b.click(); return true; })()`);
await mcp('app_set_zoom', { scale: 1.5 });
await sleep(1800);
const mi = JSON.parse(await evalJs(`(() => {
  const c = document.getElementById('annotation-canvas');
  const r = c.getBoundingClientRect();
  const vp = window.__pdfViewport;
  return JSON.stringify({ left: r.left, top: r.top, actief: !!(vp && vp.active), zoom: vp && vp.zoom, ox: vp && vp.offsetX, oy: vp && vp.offsetY });
})()`));
if (!mi.actief) {
  fout('C: vector-viewport niet actief — muisplaatsing niet toetsbaar');
} else {
  const naarScherm = (p) => ({ x: Math.round(mi.left + p.x * mi.zoom + mi.ox), y: Math.round(mi.top + p.y * mi.zoom + mi.oy) });
  const doel = [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 200 }];
  await mcp('app_set_tool', { tool: 'stift' });
  await sleep(500);
  for (const p of doel.map(naarScherm)) {
    await mcp('app_mouse_move', { x: p.x, y: p.y }); await sleep(150);
    await mcp('app_mouse_click', { x: p.x, y: p.y }); await sleep(400);
  }
  await mcp('app_key', { key: 'Enter' });
  await sleep(600);
  const lijn = (await volledig()).find((a) => a.type === 'stift' && a.vorm === 'lijn');
  if (!lijn) {
    fout('C: geen lijnstift gemaakt met drie kliks en Enter');
  } else {
    const afw = Math.max(...doel.map((d, i) => Math.hypot(lijn.points[i].x - d.x, lijn.points[i].y - d.y)));
    console.log(`C: ${lijn.points.length} punten, grootste afwijking ${afw.toFixed(2)} pt`);
    if (lijn.points.length !== 3 || afw > 1.5) fout(`C: lijnstift ${JSON.stringify(lijn.points)} (doel ${JSON.stringify(doel)})`);
  }
  await schermafdruk('C-muis.png');
}

// ── D: 1000 stiften openen ────────────────────────────────────────────────────
// Zoals bij #500: een blad met duizend stiften moet snel openen. Aanmaken via
// MCP (elke aanroep tekent opnieuw), opslaan, de tab sluiten en de tijd meten
// tot alle stiften weer in het document staan.
console.log('D: 1000 stiften openen');
await mcp('app_new_blank_pdf', { pages: 1, widthPt: 1191, heightPt: 842 });
await sleep(1500);
const SOORTEN_D = ['nieuweWand', 'liggerStaal', 'vloer', 'kolom', 'sparing'];
const tAanmaak = Date.now();
for (let i = 0; i < 1000; i++) {
  const x = 30 + (i % 40) * 28;
  const y = 30 + Math.floor(i / 40) * 30;
  const soort = SOORTEN_D[i % SOORTEN_D.length];
  const props = soort === 'vloer' ? { soort, startX: x, startY: y, endX: x, endY: y + 22 }
    : soort === 'kolom' ? { soort, x: x + 8, y: y + 8 }
      : soort === 'sparing' ? { soort, x, y, width: 16, height: 12 }
        : { soort, points: [{ x, y }, { x: x + 22, y }] };
  const r = await mcp('app_create_annotation', { page: 1, type: 'stift', props });
  if (!r?.ok) { fout(`D: stift ${i}: ${r?.error}`); break; }
}
console.log(`D: 1000 stiften aangemaakt in ${((Date.now() - tAanmaak) / 1000).toFixed(1)} s (via MCP, informatief)`);
const bestandD = path.join(UIT, 'stift-1000.pdf').replace(/\\/g, '/');
await mcp('app_save_pdf', { path: bestandD });
await sleep(1500);
{
  const tabs = await mcp('app_list_tabs', {});
  await mcp('app_close_tab', { index: tabs.activeIndex, force: true });
  await sleep(800);
}
const tOpen = Date.now();
await mcp('app_open_pdf', { path: bestandD });
let aantal = 0;
while (Date.now() - tOpen < 60000) {
  const tabs = await mcp('app_list_tabs', {});
  aantal = tabs.tabs?.[tabs.activeIndex]?.annotationCount || 0;
  if (aantal >= 1000) break;
  await sleep(100);
}
const openMs = Date.now() - tOpen;
console.log(`D: openen tot alle ${aantal} stiften binnen zijn: ${openMs} ms`);
if (aantal < 1000) fout(`D: na 60 s pas ${aantal} van de 1000 stiften geladen`);
else if (openMs > 5000) fout(`D: openen met 1000 stiften duurde ${openMs} ms (grens 5000 ms)`);
await schermafdruk('D-1000.png');

if (fouten.length) {
  console.log(`MISLUKT: ${fouten.length} afwijkingen`);
  process.exit(1);
}
console.log(`GOED — rondgang A4, rondgang /Rotate 90, muisplaatsing en 1000 stiften openen; bekijk de schermafdrukken in ${UIT}`);
process.exit(0);
```

```bash
git add scripts/verify-stift.mjs
git commit -m "test(stift): gate script for the marker save round trip and mouse drawing"
```

- [ ] **Stap 3: Bouw de testinstantie**

In `open-pdf-studio`, met een eigen doelmap buiten OneDrive:

```bash
export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc RUSTFLAGS='-C target-feature=-crt-static' CARGO_TARGET_DIR=C:/Users/rickd/AppData/Local/Temp/opds-build-stift
cargo build -p pdfium-worker && npm run tauri build -- --debug --no-bundle
```

Verwacht: `C:/Users/rickd/AppData/Local/Temp/opds-build-stift/debug/open-pdf-studio.exe` en `pdfium-worker.exe` naast elkaar. Exit 1 alleen door het ondertekenen van de updater is geen fout.

- [ ] **Stap 4: Start de testinstantie**

Kies twee vrije poorten, hier MCP 9261 en CDP 9361, en controleer dat niets erop luistert: `Get-NetTCPConnection -LocalPort 9261,9361 -ErrorAction SilentlyContinue` geeft niets. PowerShell:

```powershell
$base = 'C:\Users\rickd\AppData\Local\Temp\opds-stift-rig'
New-Item -ItemType Directory -Force -Path "$base\data", "$base\webview" | Out-Null
$env:OPDS_DETACHED = '1'; $env:OPS_ENABLE_MCP = '1'; $env:OPDS_DATA_DIR = "$base\data"
$env:WEBVIEW2_USER_DATA_FOLDER = "$base\webview"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9361'
Start-Process -FilePath 'C:\Users\rickd\AppData\Local\Temp\opds-build-stift\debug\open-pdf-studio.exe' `
  -ArgumentList '--mcp-server', '--mcp-port', '9261' `
  -RedirectStandardOutput "$base\stdout.log" -RedirectStandardError "$base\stderr.log"
```

De instantie is pas klaar als een `tools/call` slaagt. De Rust-kant antwoordt eerder dan de JS-kant, dus herhaal `app_list_tabs` tot die een antwoord geeft.

- [ ] **Stap 5: Draai de poorttest en bekijk de schermafdrukken**

In de repo-root:

```bash
MCP_PORT=9261 CDP_PORT=9361 node scripts/verify-stift.mjs C:/Users/rickd/AppData/Local/Temp/opds-stift-verify
```

Verwacht: `GOED`, exit 0. Het script meldt onder meer:
- A en B: `13 objecten vóór, 13 na heropenen` (twaalf stiften en een legenda);
- C: `3 punten`, afwijking onder 1,5 pt;
- D: de tijd tot alle 1000 stiften na heropenen binnen zijn. De grens is 5000 ms; bij de validatie van dit plan was het 1720 ms.

Bekijk daarna zelf de zes schermafdrukken in de uitvoermap (`A-voor.png`, `A-na.png`, `B-voor.png`, `B-na.png`, `C-muis.png`, `D-1000.png`):
- wanden gestreept met witte onderlaag;
- liggers, latei en fundering doorgetrokken in hun kleur;
- vloerpijl met twee pijlpunten en de letter in een groen vak;
- kolom, I-profiel (gedraaid) en paal;
- sparingkruis;
- legenda met kop en regels in de soortvolgorde;
- op het /Rotate-90-blad (B) staan legenda en letter rechtop;
- vóór en na heropenen gelijk.

- [ ] **Stap 6: Vergelijk met MuPDF**

Maak een kopie van het vergelijkingsscript met de eigen poort en het eigen playwright-pad, en draai hem op de uitvoermap met de twee opgeslagen PDF's. In de repo-root:

```bash
K=C:/Users/rickd/AppData/Local/Temp/opds-stift-klad; mkdir -p $K
sed -e "s#127.0.0.1:9223#127.0.0.1:9261#" -e "s#C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright#$(pwd)/open-pdf-studio/node_modules/playwright#" scripts/verify-mupdf-compare.mjs > $K/mupdf-compare-stift.mjs
CDP_PORT=9361 node $K/mupdf-compare-stift.mjs $K/mupdf C:/Users/rickd/AppData/Local/Temp/opds-stift-verify
```

Verwacht: geen pagina met `occ_miss` (inhoud die in de app ontbreekt). Beoordeel elke gevlagde pagina met het oog, naast de PNG's van app en MuPDF: gelijke kleuren, strepen, pijlpunten, letters en legenda.

- [ ] **Stap 7: Het rotatieprotocol en de opslagrondgang**

In de repo-root, tegen dezelfde testinstantie:

```bash
K=C:/Users/rickd/AppData/Local/Temp/opds-stift-klad
MCP_PORT=9261 node scripts/verify-tekstrotatie.mjs
MCP_PORT=9261 CDP_PORT=9361 node scripts/verify-plaatsing-cursor.mjs
MCP_PORT=9261 CDP_PORT=9361 node scripts/verify-doorlopend-inkt.mjs
sed -e "s#127.0.0.1:9223#127.0.0.1:9261#" -e "s#C:/Users/rickd/Documents/GitHub/open-pdf-studio/open-pdf-studio/node_modules/playwright#$(pwd)/open-pdf-studio/node_modules/playwright#" scripts/verify-rotation-sweep.mjs > $K/rotation-sweep-stift.mjs
CDP_PORT=9361 node $K/rotation-sweep-stift.mjs $K/sweep
MCP_URL=http://127.0.0.1:9261/mcp CDP_PORT=9361 node scripts/verify-opslag-rondgang.mjs C:/Users/rickd/Documents/GitHub/verification-files/PDF-bestanden $K/rondgang
python scripts/verify-opslag-rondgang.py $K/rondgang
```

Verwacht:
- de drie poortscripts `GOED`;
- de sweep levert per bestand een PNG. Bekijk ze allemaal en in elk geval Technische tekening, 3200-CP-21 (Bijlage B), MV-03, Zware vector PDF p18, NKD1a en de boekjes. NKD1a doorlopend wit is een bekend bestandskenmerk;
- de opslagrondgang zonder nieuwe schade. Bekende valse meldingen: contractvoorstel 74,3 % en 70,8 %, Barn Relocation 48,8 %, The.Map 79,6 %.

De originele verificatiebestanden blijven ongewijzigd: de scripts werken op kopieën.

- [ ] **Stap 8: Stop de testinstantie**

PowerShell, alleen op de eigen poort:

```powershell
Get-CimInstance Win32_Process -Filter "Name='open-pdf-studio.exe'" |
  Where-Object { $_.CommandLine -match '--mcp-port 9261' } |
  ForEach-Object { taskkill /PID $_.ProcessId /T /F }
```

- [ ] **Stap 9: Push en pull request (Engels)**

```bash
git push -u origin feat/stifttekening
gh pr create -R OpenAEC-Foundation/open-pdf-studio --base main --head feat/stifttekening --title "feat(stift): structural marker drawing, part 1 (markers and legend)" --body-file C:/Users/rickd/AppData/Local/Temp/opds-stift-klad/pr-body.md
```

`C:/Users/rickd/AppData/Local/Temp/opds-stift-klad/pr-body.md`, in het Engels. Vul bij de benchmark de gemeten waarden in (op de plek van `…`):

```markdown
## Summary

Structural marker drawing ("stifttekening"), part 1: draw coloured markers over an architect's floor plan to mark the load-bearing structure, with a legend per floor plan that updates itself.

- Eleven marker kinds (existing/new/stability walls, steel/timber beams, lintels, floors with span arrow and letter, columns, foundation beams, piles, openings). Each marker refers to a definition in the document; editing a definition updates every marker and legend.
- Tools: Marker (line, arrow, point, cross) and Legend (drag a frame, place the block). Markers panel with the definitions, edit and delete dialogs, and a start set that can be made the default.
- Saved as standard annotations (/PolyLine, /Line, /Square, /Circle, /Stamp) with vector appearance streams from the same drawing commands as the canvas, so other readers show the same drawing. Definitions travel in /OPS_StiftDefs and as a snapshot per marker.
- Clipboard carries definitions between documents; MCP `app_create_annotation` accepts `stift` and `stiftLegenda`; IFC categories IfcColumn, IfcFooting and IfcOpeningElement; the quantities schedule counts markers per definition.

Design: `docs/superpowers/specs/2026-09-28-stifttekening-deel1-design.md`. Plan: `docs/superpowers/plans/2026-09-28-stifttekening-deel1.md`.

## Test plan

- [x] `npm run test:unit`, `npx tsc --noEmit`, `npx vite build`
- [x] `node scripts/bench/stift-node.mjs 1000`: every step under 100 ms (…)
- [x] `scripts/verify-stift.mjs` on a test instance: A4 and /Rotate 90 save round trip, mouse drawing, opening 1000 markers (… ms), screenshots checked
- [x] MuPDF comparison of the saved pages
- [x] Rotation protocol: text rotation, cursor placement, continuous ink, full sweep; save round trip

Refs #312
```

Na het aanmaken: CI volgen via de PR-status en de mergeopdracht aan de gebruiker geven. Mergen doet de gebruiker.
