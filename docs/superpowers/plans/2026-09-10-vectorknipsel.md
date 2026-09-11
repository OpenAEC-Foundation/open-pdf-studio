# Vectorknipsel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een gebied uit een PDF knippen en in een andere PDF plakken met behoud van vectordata.

**Architecture:** De inbedbewerking (`embedPage` met een vak en verschuivingsmatrix) wordt uit `js/pdf/titleblock-compose.js` losgetrokken naar een pure, node-testbare module. Een store houdt de bronbytes vast en ontdubbelt per bronpagina. De saver schrijft een los knipsel als stempel-annotatie met een vectoriële appearance; vastzetten bakt hetzelfde XObject in de inhoudstroom van de pagina.

**Tech Stack:** pdf-lib (lezen/schrijven), pdfium-worker (voorvertoning), node:test.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-10-vector-knipsel-design.md`.
- Nederlandse code-commentaren en commit-boodschappen; geen verwijzing naar de assistent in commits.
- Nieuwe testbestanden toevoegen aan `test:unit` in `open-pdf-studio/package.json`.
- Aangepaste saver-logica valt onder het verplichte opslag-rondgang-protocol vóór een release.
- Paden hieronder zijn relatief aan `open-pdf-studio/`.

---

### Task 1: Pure inbed-helper

**Files:**
- Create: `js/pdf/vector-embed.js`
- Test: `js/pdf/vector-embed.test.mjs`
- Modify: `package.json` (test:unit)

**Interfaces:**
- Consumes: `zichtbaarVak` uit `js/pdf/titleblock-compose.js`.
- Produces:
  - `normaliseerVak(vak)` → `{left, bottom, right, top}` genormaliseerd, of `null` bij < 1 pt.
  - `async bedKnipselIn(doelDoc, bronBytes, srcBox)` → `PDFEmbeddedPage` (pdf-lib), ingebed met de verschuivingsmatrix.
  - `async knipselAlsMiniPdf(bronBytes, paginaIndex)` → `Uint8Array` (één-pagina-PDF).

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { normaliseerVak, bedKnipselIn, knipselAlsMiniPdf } from './vector-embed.js';

async function bronMetVak() {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  return d.save();
}

test('normaliseerVak draait omgekeerde hoeken om en weigert ontaarde vakken', () => {
  assert.deepEqual(normaliseerVak({ left: 200, bottom: 150, right: 100, top: 50 }),
    { left: 100, bottom: 50, right: 200, top: 150 });
  assert.equal(normaliseerVak({ left: 10, bottom: 10, right: 10.4, top: 40 }), null);
});

test('een knipsel wordt een Form XObject met het vak als BBox en een verschuivingsmatrix', async () => {
  const bron = await bronMetVak();
  const doel = await PDFDocument.create();
  const vak = { left: 100, bottom: 80, right: 220, top: 140 };
  const ingebed = await bedKnipselIn(doel, bron, vak);
  assert.equal(Math.round(ingebed.width), 120);
  assert.equal(Math.round(ingebed.height), 60);
  const form = doel.context.lookup(ingebed.ref);
  const m = form.dict.get(PDFName.of('Matrix')).asArray().map(n => n.asNumber());
  assert.ok(Math.abs(m[4] + 100) < 1e-6 && Math.abs(m[5] + 80) < 1e-6, `Matrix ${m}`);
});

test('knipselAlsMiniPdf levert een zelfstandige eenpagina-PDF', async () => {
  const bron = await bronMetVak();
  const mini = await knipselAlsMiniPdf(bron, 0);
  const d = await PDFDocument.load(mini);
  assert.equal(d.getPageCount(), 1);
  assert.deepEqual(d.getPage(0).getSize(), { width: 600, height: 400 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/pdf/vector-embed.test.mjs`
Expected: FAIL — module bestaat niet.

- [ ] **Step 3: Write the implementation**

```js
// Vectorknipsel — de pure inbedbewerking.
//
// Zelfde valkuil als in titleblock-compose.js: embedPage normaliseert de BBox
// naar de oorsprong maar verschuift de inhoud niet. Zonder expliciete
// verschuivingsmatrix valt alles buiten de BBox en wordt het weggeclipt.
export const MIN_VAK_PT = 1;

export function normaliseerVak(vak) {
  if (!vak) return null;
  const left = Math.min(vak.left, vak.right);
  const right = Math.max(vak.left, vak.right);
  const bottom = Math.min(vak.bottom, vak.top);
  const top = Math.max(vak.bottom, vak.top);
  if (right - left < MIN_VAK_PT || top - bottom < MIN_VAK_PT) return null;
  return { left, bottom, right, top };
}

export async function knipselAlsMiniPdf(bronBytes, paginaIndex = 0) {
  const { PDFDocument } = await import('pdf-lib');
  const bron = await PDFDocument.load(bronBytes);
  const mini = await PDFDocument.create();
  const [pagina] = await mini.copyPages(bron, [paginaIndex]);
  mini.addPage(pagina);
  return await mini.save();
}

export async function bedKnipselIn(doelDoc, bronBytes, srcBox, paginaIndex = 0) {
  const vak = normaliseerVak(srcBox);
  if (!vak) throw new Error('vak te klein of ontaard');
  const { PDFDocument } = await import('pdf-lib');
  const bron = await PDFDocument.load(bronBytes);
  const pagina = bron.getPage(paginaIndex);
  return await doelDoc.embedPage(pagina, vak, [1, 0, 0, 1, -vak.left, -vak.bottom]);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test js/pdf/vector-embed.test.mjs` → PASS.
Voeg het bestand toe aan `test:unit` en draai `npm run test:unit`.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/pdf/vector-embed.js open-pdf-studio/js/pdf/vector-embed.test.mjs open-pdf-studio/package.json
git commit -m "feat(knipsel): pure inbed-helper voor een vectorknipsel"
```

---

### Task 2: Knipsel-store met ontdubbeling

**Files:**
- Create: `js/annotations/vector-snippet-store.js`
- Test: `js/annotations/vector-snippet-store.test.mjs`
- Modify: `package.json` (test:unit)

**Interfaces:**
- Produces:
  - `sleutelVoor(bytes)` → `string` (16 hex-tekens, FNV-1a over de bytes).
  - `bewaar(bytes)` → `string` sleutel; tweede aanroep met dezelfde bytes hergebruikt de sleutel.
  - `bytesVan(sleutel)` → `Uint8Array | null`
  - `sleutels()` → `string[]`
  - `wisOngebruikt(gebruikteSleutels)` → `number` (aantal verwijderd)
  - `leegmaken()` — voor tests.

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { sleutelVoor, bewaar, bytesVan, sleutels, wisOngebruikt, leegmaken } from './vector-snippet-store.js';

const bytes = (s) => new TextEncoder().encode(s);

test('dezelfde bytes leveren dezelfde sleutel en worden maar één keer bewaard', () => {
  leegmaken();
  const a = bewaar(bytes('pdf-een'));
  const b = bewaar(bytes('pdf-een'));
  assert.equal(a, b);
  assert.equal(sleutels().length, 1);
  assert.notEqual(a, bewaar(bytes('pdf-twee')));
  assert.equal(sleutels().length, 2);
});

test('sleutelVoor is stabiel en hexadecimaal', () => {
  assert.equal(sleutelVoor(bytes('x')), sleutelVoor(bytes('x')));
  assert.match(sleutelVoor(bytes('x')), /^[0-9a-f]{16}$/);
});

test('bytes komen ongewijzigd terug; onbekende sleutel geeft null', () => {
  leegmaken();
  const k = bewaar(bytes('inhoud'));
  assert.equal(new TextDecoder().decode(bytesVan(k)), 'inhoud');
  assert.equal(bytesVan('deadbeefdeadbeef'), null);
});

test('wisOngebruikt houdt alleen de sleutels die nog in gebruik zijn', () => {
  leegmaken();
  const k1 = bewaar(bytes('een'));
  const k2 = bewaar(bytes('twee'));
  assert.equal(wisOngebruikt([k1]), 1);
  assert.deepEqual(sleutels(), [k1]);
  assert.equal(bytesVan(k2), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/annotations/vector-snippet-store.test.mjs` → FAIL.

- [ ] **Step 3: Write the implementation**

```js
// Bronbytes van vectorknipsels, ontdubbeld op inhoud.
//
// Tien knipsels uit hetzelfde blad delen één kopie: de annotatie draagt alleen
// een sleutel. De worker rendert vanaf een pad, dus wie een voorvertoning wil
// vraagt eerst padVan() aan — die schrijft de bytes één keer weg.
const _bytes = new Map();   // sleutel -> Uint8Array
const _paden = new Map();   // sleutel -> pad op schijf

export function sleutelVoor(bytes) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + bytes[i] + i, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

export function bewaar(bytes) {
  const k = sleutelVoor(bytes);
  if (!_bytes.has(k)) _bytes.set(k, bytes);
  return k;
}

export function bytesVan(sleutel) {
  return _bytes.get(sleutel) || null;
}

export function sleutels() {
  return [..._bytes.keys()];
}

export function wisOngebruikt(gebruikteSleutels) {
  const houden = new Set(gebruikteSleutels || []);
  let weg = 0;
  for (const k of [..._bytes.keys()]) {
    if (!houden.has(k)) { _bytes.delete(k); _paden.delete(k); weg++; }
  }
  return weg;
}

export function leegmaken() {
  _bytes.clear();
  _paden.clear();
}

/** Pad op schijf voor de worker; schrijft de bytes één keer weg. */
export async function padVan(sleutel, schrijf) {
  if (_paden.has(sleutel)) return _paden.get(sleutel);
  const b = bytesVan(sleutel);
  if (!b) return null;
  const pad = await schrijf(sleutel, b);
  if (pad) _paden.set(sleutel, pad);
  return pad;
}
```

- [ ] **Step 4: Run tests** → PASS; toevoegen aan `test:unit`; `npm run test:unit`.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/annotations/vector-snippet-store.js open-pdf-studio/js/annotations/vector-snippet-store.test.mjs open-pdf-studio/package.json
git commit -m "feat(knipsel): store voor bronbytes met ontdubbeling per bronpagina"
```

---

### Task 3: Schrijfpad — stempel met vectoriële appearance

**Files:**
- Create: `js/pdf/saver/vector-snippet.js`
- Modify: `js/pdf/saver.js` — `attachVectorAP` (regel ~50) accepteert XObject-resources; nieuwe `case 'vectorSnippet'`.

**Interfaces:**
- Consumes: `bedKnipselIn` (Task 1), `bytesVan` (Task 2).
- Produces: `async schrijfVectorknipsel({ pdfDocLib, context, page, ann, rect })` → `{ apOps, xobjects }` voor `attachVectorAP`, en registreert de bronstream in `OPS_VectorSnippets`.

- [ ] **Step 1:** Breid `attachVectorAP` uit zodat `built.xobjects` (een `{naam: ref}`-map) in `resources.XObject` belandt. Bestaande aanroepers geven het veld niet mee en veranderen niet.

```js
  if (built.xobjects) {
    resources.XObject = context.obj(built.xobjects);
  }
```

- [ ] **Step 2:** `js/pdf/saver/vector-snippet.js` — bouw de AP-ops. Het knipsel wordt op de annotatie-Rect geschaald:

```js
// De AP tekent het ingebedde knipsel schaalvullend in de annotatie-Rect.
// BBox/Matrix worden door attachVectorAP gezet (Rect + translatie naar 0,0),
// dus hier rekenen we in Rect-coördinaten.
export function knipselApOps({ rect, knipselB, knipselH, naam }) {
  const [x1, y1, x2, y2] = rect;
  const b = x2 - x1, h = y2 - y1;
  const sx = b / knipselB, sy = h / knipselH;
  return `q ${sx} 0 0 ${sy} ${x1} ${y1} cm /${naam} Do Q`;
}
```

- [ ] **Step 3:** Voeg in `saver.js` een `case 'vectorSnippet'` toe die de bytes uit de store haalt, `bedKnipselIn` aanroept, de ops bouwt en `attachVectorAP` met `xobjects` aanroept. Zet `OPS_SnippetKey` en `OPS_SrcBox` op het annotatiewoordenboek, en registreer de bronbytes één keer per sleutel in `OPS_VectorSnippets` op de catalogus.

- [ ] **Step 4:** Test met een rondgang-script: maak een document met één knipsel, sla op, herlaad met pdf-lib en controleer dat de pagina één Stamp-annotatie heeft met een `/AP /N` die een `/XObject` in zijn Resources heeft.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(knipsel): los knipsel wordt opgeslagen als stempel met vectoriele appearance"
```

---

### Task 4: Leespad

**Files:**
- Modify: `js/pdf/loader/annotation-converter.js` — herken Stamp met `OPS_SnippetKey`.

**Interfaces:**
- Consumes: `bewaar` (Task 2).
- Produces: een `vectorSnippet`-annotatie met `snippetKey`, `srcBox`, `srcLabel`.

- [x] **Step 1:** Lees `OPS_VectorSnippets` van de catalogus en zet elke stream met `bewaar()` in de store.
- [x] **Step 2:** Voor elke Stamp met `OPS_SnippetKey`: maak een `vectorSnippet` met de Rect als plaatsing en `OPS_SrcBox` als vak.
- [x] **Step 3:** Rondgang-test: plaatsen → opslaan → heropenen → nog steeds een verplaatsbaar knipsel op dezelfde plek.
- [x] **Step 4: Commit**

```bash
git commit -m "feat(knipsel): een opgeslagen knipsel wordt weer een verplaatsbaar object"
```

---

### Task 5: Gereedschap, voorvertoning en vastzetten

**Files:**
- Create: `js/tools/tools/vector-snippet-tool.js`
- Modify: `js/annotations/clipboard.js`, `js/annotations/rendering.js` (tekenen), `js/annotations/spatial-index.js` (omhullende), ribbon-tab.

- [ ] **Step 1:** Gereedschap dat een kader opspant en bij loslaten `knipselAlsMiniPdf` + `bewaar` aanroept en het resultaat op het klembord zet.
- [ ] **Step 2:** Plakken maakt de annotatie op ware grootte.
- [ ] **Step 3:** Tekenen: `padVan()` + `render_region` met het `srcBox`, gecachet per zoomniveau; tot de tegel er is een kader met de bestandsnaam.
- [ ] **Step 4:** `annotationBounds` kent `vectorSnippet` als gewone rechthoek (valt onder de bestaande rect-tak — controleren, geen code nodig).
- [ ] **Step 5:** Knop "Vastleggen" op de contextuele tab: schrijft het XObject in de inhoudstroom en verwijdert de annotatie, in één undo-stap.
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(knipsel): gereedschap, voorvertoning en vastleggen"
```

---

## Self-Review

**Spec-dekking:** kopiëren (T5), plakken (T5), weergave (T5), datamodel (T2), los opslaan (T3), terug inlezen (T4), ontdubbeling (T2+T3), vastzetten (T5), randgevallen ontaard vak (T1) en CropBox (T1 via `zichtbaarVak`). **Gat:** de geroteerde bronpagina uit het randgevallen-hoofdstuk heeft geen eigen stap — die hoort in T1 als extra test met een `/Rotate 90`-bronpagina; toegevoegd aan T1 stap 1 bij uitvoering.

**Typeconsistentie:** `srcBox` heet overal `{left, bottom, right, top}`; `snippetKey` overal een string; `bedKnipselIn(doelDoc, bronBytes, srcBox, paginaIndex)` in T1 en T3 gelijk.
