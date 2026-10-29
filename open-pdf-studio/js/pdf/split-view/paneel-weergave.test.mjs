// Gesplitste weergave (#715): het tweede paneel tekent zijn annotaties met
// zijn eigen zoom en weergaverotatie zonder die op het document (een Solid-
// store) te zetten. Een tijdelijke wijziging van doc.scale/doc.viewRotation
// liet bij elke hertekening van het paneel alles opnieuw rekenen wat daarvan
// afhangt.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { metPaneelStand, schermSchaal, weergaveRotatieVan } = await import('./paneel-weergave.js');
const { weergaveRotatie } = await import('../weergave-ruimte.js');

const HIER = dirname(fileURLToPath(import.meta.url));
const lees = (rel) => readFileSync(join(HIER, rel), 'utf8');

test('tijdens de tekenbeurt van het paneel geldt zijn zoom en rotatie, daarna weer die van het document', () => {
  const doc = { scale: 1.5, viewRotation: 0 };
  const ander = { scale: 2, viewRotation: 90 };
  let binnen = null;
  metPaneelStand(doc, { schaal: 4, rotatie: 180 }, () => {
    binnen = {
      schaal: schermSchaal(doc), rotatie: weergaveRotatieVan(doc), ruimte: weergaveRotatie(doc),
      anderSchaal: schermSchaal(ander), anderRotatie: weergaveRotatieVan(ander),
    };
  });
  assert.deepEqual(binnen, { schaal: 4, rotatie: 180, ruimte: 180, anderSchaal: 2, anderRotatie: 90 });
  assert.equal(schermSchaal(doc), 1.5);
  assert.equal(weergaveRotatie(doc), 0);
  assert.deepEqual(doc, { scale: 1.5, viewRotation: 0 }, 'het document zelf is nooit gewijzigd');
});

test('ook na een fout staat de stand terug', () => {
  const doc = { scale: 1, viewRotation: 0 };
  assert.throws(() => metPaneelStand(doc, { schaal: 3, rotatie: 90 }, () => { throw new Error('x'); }));
  assert.equal(schermSchaal(doc), 1);
  assert.equal(weergaveRotatieVan(doc), 0);
});

test('het tweede paneel schrijft doc.scale en doc.viewRotation niet meer om te tekenen', () => {
  const bron = lees('split-view.js');
  const a = bron.indexOf('function metPaneelWeergave(');
  const b = bron.indexOf('\n}', a);
  const fn = bron.slice(a, b);
  assert.ok(a > 0);
  assert.doesNotMatch(fn, /doc\.scale\s*=|doc\.viewRotation\s*=/);
  assert.match(fn, /metPaneelStand\(/);
});

test('de annotatietekenaar leest schermschaal en rotatie via paneel-weergave.js', () => {
  const rendering = lees('../../annotations/rendering.js');
  const start = rendering.indexOf('function tekenPaginaLagen(');
  assert.match(rendering.slice(start, start + 600), /const scale = doc \? schermSchaal\(doc\) : 1;/);
  assert.doesNotMatch(rendering, /doc\?\.viewRotation/);
  assert.match(lees('../../annotations/rendering/hatch-patterns.js'), /schermSchaal\(doc\)/);
  assert.match(lees('../../annotations/rendering/selection.js'), /schermSchaal\(doc\)/);
});
