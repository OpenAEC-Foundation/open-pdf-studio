// Weergave draaien (#200): de knoppen op het tabblad Beeld draaien alleen het
// beeld. Het document verandert niet, er komt geen ongedaan-maakstap, en
// opslaan, afdrukken, exporteren en miniaturen blijven de eigen
// paginarotaties gebruiken.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zetWeergaveRotatie, draaiWeergave } from './weergave-draaien.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const bron = (pad) => readFileSync(join(HIER, pad), 'utf8');

function nepApp({ viewMode = 'single', viewportToont = true, viewRotation = 0, pdfDoc = {} } = {}) {
  const doc = { viewMode, viewRotation, pdfDoc, currentPage: 3, modified: false, pageRotations: { 3: 90 }, undoStack: [] };
  const volgorde = [];
  return {
    doc,
    volgorde,
    omgeving: {
      document: () => doc,
      viewportToontDocument: () => viewportToont,
      draaiViewport: (r) => volgorde.push(`viewport ${r}`),
      tekenEnkelePagina: async (p) => { volgorde.push(`pagina ${p}`); },
      tekenDoorlopend: async () => { volgorde.push('doorlopend'); },
      naWijziging: () => volgorde.push('status'),
    },
  };
}

test('rechtsom draaien in stappen van 90° en weer rond', async () => {
  const app = nepApp();
  for (const verwacht of [90, 180, 270, 0]) {
    assert.equal(await draaiWeergave(90, app.omgeving), true);
    assert.equal(app.doc.viewRotation, verwacht);
  }
  await draaiWeergave(-90, app.omgeving);
  assert.equal(app.doc.viewRotation, 270);
});

test('geen documentbewerking: niet gewijzigd, geen ongedaan-maakstap, paginarotaties onaangeroerd', async () => {
  const app = nepApp();
  await draaiWeergave(90, app.omgeving);
  assert.equal(app.doc.modified, false);
  assert.deepEqual(app.doc.undoStack, []);
  assert.deepEqual(app.doc.pageRotations, { 3: 90 });
});

test('enkele pagina via de viewport: alleen de viewport draait, niets wordt opnieuw gerenderd', async () => {
  const app = nepApp({ viewMode: 'single', viewportToont: true });
  await draaiWeergave(90, app.omgeving);
  assert.deepEqual(app.volgorde, ['viewport 90', 'status']);
});

test('enkele pagina zonder viewport (PDF.js tekent): de pagina wordt in de nieuwe stand getekend', async () => {
  const app = nepApp({ viewMode: 'single', viewportToont: false });
  await draaiWeergave(-90, app.omgeving);
  assert.deepEqual(app.volgorde, ['pagina 3', 'status']);
});

test('doorlopende weergave (ook boek en naast elkaar): opnieuw opbouwen in de nieuwe stand', async () => {
  const app = nepApp({ viewMode: 'continuous' });
  await draaiWeergave(90, app.omgeving);
  assert.deepEqual(app.volgorde, ['doorlopend', 'status']);
});

test('terugzetten op 0 en dezelfde stand opnieuw: alleen tekenen als er iets verandert', async () => {
  const app = nepApp({ viewRotation: 180 });
  assert.equal(await zetWeergaveRotatie(180, app.omgeving), false);
  assert.deepEqual(app.volgorde, []);
  assert.equal(await zetWeergaveRotatie(0, app.omgeving), true);
  assert.equal(app.doc.viewRotation, 0);
  assert.equal(await zetWeergaveRotatie(-360, app.omgeving), false);
});

test('zonder geopend document gebeurt er niets', async () => {
  const app = nepApp({ pdfDoc: null });
  assert.equal(await draaiWeergave(90, app.omgeving), false);
  assert.equal(app.doc.viewRotation, 0);
  assert.deepEqual(app.volgorde, []);
});

test('een nieuw document begint rechtop', () => {
  assert.match(bron('../core/stores/document-helpers.ts'), /viewRotation: 0,/);
});

test('de knoppen op Beeld draaien de weergave; Bewerken & combineren en de sneltoets draaien pagina\'s', () => {
  const beeld = bron('../solid/components/ribbon/ViewTab.jsx');
  assert.match(beeld, /draaiWeergave\(/);
  assert.doesNotMatch(beeld, /draaiVanafKnop\(|\brotatePage\(/);
  assert.match(beeld, /t\('view\.rotateViewLeft'\)/);
  assert.match(beeld, /t\('view\.rotateViewRight'\)/);
  // Geen bewerking: ook bij een alleen-lezen PDF/A-document beschikbaar.
  assert.doesNotMatch(beeld, /isPdfAReadOnly/);
  for (const pad of ['../solid/components/ribbon/OrganizeTab.jsx', '../tools/keyboard-handlers.js']) {
    assert.match(bron(pad), /draaiVanafKnop\(/, pad);
    assert.doesNotMatch(bron(pad), /draaiWeergave\(/, pad);
  }
});

test('opslaan, afdrukken, exporteren en miniaturen kennen de weergaverotatie niet', () => {
  for (const pad of ['./saver.js', './exporter.js', './print-job.js', '../ui/panels/left-panel.js', './compress.js']) {
    assert.doesNotMatch(bron(pad), /viewRotation|weergaveRotatie|weergave-ruimte|weergave-draaien/, pad);
  }
});

// ─── Teksten ────────────────────────────────────────────────────────────────

const LOCALES = join(HIER, '../i18n/locales');
const lees = (locale, ns) => JSON.parse(readFileSync(join(LOCALES, locale, `${ns}.json`), 'utf8'));
const LINT = ['rotateViewLeft', 'rotateViewRight', 'rotateViewLeftTitle', 'rotateViewRightTitle'];

test('alle 39 talen hebben de teksten voor weergave draaien', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 39);
  for (const locale of locales) {
    const view = lees(locale, 'ribbon').view || {};
    for (const key of LINT) {
      assert.equal(typeof view[key], 'string', `${locale} view.${key} ontbreekt`);
      assert.ok(view[key].trim(), `${locale} view.${key} leeg`);
    }
    const status = lees(locale, 'statusbar').viewRotatedTitle;
    assert.equal(typeof status, 'string', `${locale} viewRotatedTitle ontbreekt`);
    assert.match(status, /\{\{degrees\}\}/, `${locale} viewRotatedTitle zonder {{degrees}}`);
  }
});

test('geen taal valt terug op de Engelse zinnen', () => {
  const en = { ...lees('en', 'ribbon').view, viewRotatedTitle: lees('en', 'statusbar').viewRotatedTitle };
  for (const locale of readdirSync(LOCALES)) {
    if (locale === 'en') continue;
    const t = { ...lees(locale, 'ribbon').view, viewRotatedTitle: lees(locale, 'statusbar').viewRotatedTitle };
    for (const key of [...LINT, 'viewRotatedTitle']) {
      assert.notEqual(t[key], en[key], `${locale}: ${key} is de Engelse tekst`);
    }
  }
});

test('de uitleg zegt dat het document niet verandert (Engels en Nederlands)', () => {
  assert.match(lees('en', 'ribbon').view.rotateViewLeftTitle, /document itself does not change/);
  assert.match(lees('en', 'statusbar').viewRotatedTitle, /document is unchanged/);
  assert.match(lees('nl', 'ribbon').view.rotateViewRightTitle, /document zelf verandert niet/);
});
