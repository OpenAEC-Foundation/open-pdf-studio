// Nieuwe markeringen landen op de huidige laag (#468). createAnnotation is het
// ene pad waar elke nieuwe annotatie doorheen gaat (gereedschappen, MCP,
// stempels, XFDF); de lader zet daarna zelf de laag uit het bestand.
//
// De echte factory draait hier, met alleen haar imports vervangen: state.js
// trekt SolidJS en de hele app mee.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as lagen from './annotatie-lagen.js';
import * as minimummaat from './minimummaat.js';
import { zetLaagUitBestand } from '../pdf/loader/annotatie-laag.js';

let _nr = 0;
async function laadMetStubs(relPad, stubs = {}) {
  const namen = new Set();
  const bron = readFileSync(new URL(relPad, import.meta.url), 'utf8')
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, (_, wat) => {
      for (const deel of wat.replace(/[{}]/g, ' ').split(',')) {
        const naam = deel.trim().split(/\s+as\s+/).pop().trim();
        if (naam) namen.add(naam);
      }
      return '';
    });
  const sleutel = `__opdsFactoryLaagStubs${_nr++}`;
  globalThis[sleutel] = stubs;
  const kop = [...namen].map((n) => `const ${n} = globalThis.${sleutel}.${n} ?? (() => undefined);`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(`${kop}\n${bron}`, 'utf8').toString('base64'));
}

const doc = { annotations: [] };
const state = { documents: [doc], activeDocumentIndex: 0, defaultAuthor: 'Tester' };
const factory = await laadMetStubs('./factory.js', { ...minimummaat, ...lagen, state });

test('zonder lagen krijgt een nieuwe annotatie geen layer-veld', () => {
  const ann = factory.createAnnotation({ type: 'line', startX: 0, startY: 0, endX: 10, endY: 10 });
  assert.equal('layer' in ann, false);
});

test('een nieuwe annotatie landt op de huidige laag', () => {
  const a = lagen.addLayer(doc, { name: 'Constructie' }).layer;
  lagen.setCurrentLayer(doc, a.id);
  const ann = factory.createAnnotation({ type: 'line', startX: 0, startY: 0, endX: 10, endY: 10 });
  assert.equal(ann.layer, a.id);
});

test('een meegegeven laag wint, ook de standaardlaag', () => {
  const b = lagen.addLayer(doc, { name: 'Ronde 2' }).layer;
  assert.equal(factory.createAnnotation({ type: 'box', x: 0, y: 0, width: 5, height: 5, layer: b.id }).layer, b.id);
  const expliciet = factory.createAnnotation({ type: 'box', x: 0, y: 0, width: 5, height: 5, layer: undefined });
  assert.equal('layer' in expliciet, false, 'expliciet geen laag = standaardlaag, zonder veld');
});

test('zonder open document geen laag', () => {
  const vorige = state.activeDocumentIndex;
  state.activeDocumentIndex = -1;
  try {
    assert.equal('layer' in factory.createAnnotation({ type: 'comment', x: 0, y: 0 }), false);
  } finally {
    state.activeDocumentIndex = vorige;
  }
});

// --- de lader ----------------------------------------------------------------

test('de lader zet de laag uit het bestand, of haalt de huidige laag weer weg', () => {
  const geladen = { type: 'box', layer: 'huidige-laag-van-een-ander-document' };
  zetLaagUitBestand(geladen, undefined);
  assert.equal('layer' in geladen, false, 'geladen zonder laag = standaardlaag');
  zetLaagUitBestand(geladen, 'uit-het-bestand');
  assert.equal(geladen.layer, 'uit-het-bestand');
});

test('ook de extra annotaties die de lader naast de hoofdannotatie maakt', () => {
  const extra = { type: 'betonbalk', layer: 'fout' };
  const hoofd = { type: 'betonbalk', __extraAnnotations: [extra] };
  zetLaagUitBestand(hoofd, 'l1');
  assert.equal(hoofd.layer, 'l1');
  assert.equal(extra.layer, 'l1');
  assert.equal(zetLaagUitBestand(null, 'l1'), null);
});

// Vier aanmaakpaden bouwen hun annotatie als los object, buiten
// createAnnotation om (notitie, twee schermafbeeldingen, afbeelding slepen).
// Die moeten dezelfde regel volgen.
test('ook notities, schermafbeeldingen en gesleepte afbeeldingen landen op de huidige laag', () => {
  for (const pad of ['../tools/text-editing.js', '../tools/screenshot-annotate.js', '../tools/screenshot.js', './image-drop.js']) {
    const bron = readFileSync(new URL(pad, import.meta.url), 'utf8');
    assert.match(bron, /layerForNewAnnotation\(/, `${pad} zet de huidige laag`);
  }
});
