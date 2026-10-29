// Bijsnijden snijdt echt bij (#749): de overlay neemt een klik op een greep
// helemaal over, zodat het selectiegereedschap niet tegelijk de afbeelding
// schaalt, en hij luistert op het document, zodat ook de doorlopende
// weergave (een canvas per pagina) hem bereikt.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inDocumentWeergave, eisGebeurtenisOp, installeerCropInvoer } from './crop-invoer.js';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

// Het annotatiecanvas is zelf het doel van de klik. Daar houdt
// stopPropagation() de luisteraar van het selectiegereedschap op hetzelfde
// element niet tegen — de oude overlay deed precies dat.
test('op het doel zelf houdt alleen stopImmediatePropagation het selectiegereedschap tegen', () => {
  const canvas = new EventTarget();
  let gereedschap = 0;
  const oud = (e) => { e.preventDefault(); e.stopPropagation(); };
  canvas.addEventListener('pointerdown', oud, true);
  canvas.addEventListener('pointerdown', () => { gereedschap++; });
  canvas.dispatchEvent(new Event('pointerdown', { cancelable: true }));
  assert.equal(gereedschap, 1, 'met alleen stopPropagation krijgt het gereedschap de klik nog');

  // Volgorde zoals in de app: de overlay vóór het gereedschap.
  const nieuw = new EventTarget();
  nieuw.addEventListener('pointerdown', eisGebeurtenisOp, true);
  nieuw.addEventListener('pointerdown', () => { gereedschap++; });
  const e = new Event('pointerdown', { cancelable: true });
  nieuw.dispatchEvent(e);
  assert.equal(gereedschap, 1, 'de overlay houdt de klik volledig tegen');
  assert.equal(e.defaultPrevented, true);
});

test('de invoer hangt in de capture-fase aan het doel en gaat er weer af', () => {
  const doc = new EventTarget();
  const gezien = [];
  const handlers = {
    pointerdown: () => gezien.push('down'),
    pointermove: () => gezien.push('move'),
    pointerup: () => gezien.push('up'),
  };
  const echt = doc.addEventListener.bind(doc);
  const capture = [];
  doc.addEventListener = (soort, fn, opt) => { capture.push([soort, opt?.capture === true]); echt(soort, fn, opt); };
  const weg = installeerCropInvoer(doc, handlers);
  assert.deepEqual(capture, [['pointerdown', true], ['pointermove', true], ['pointerup', true]]);
  for (const s of ['pointerdown', 'pointermove', 'pointerup']) doc.dispatchEvent(new Event(s));
  assert.deepEqual(gezien, ['down', 'move', 'up']);
  weg();
  for (const s of ['pointerdown', 'pointermove', 'pointerup']) doc.dispatchEvent(new Event(s));
  assert.equal(gezien.length, 3);
});

test('alleen klikken in de documentweergave tellen', () => {
  const binnen = { closest: (sel) => (sel === '#pdf-container' ? {} : null) };
  const buiten = { closest: () => null };
  assert.equal(inDocumentWeergave(binnen), true);
  assert.equal(inDocumentWeergave(buiten), false);
  assert.equal(inDocumentWeergave(null), false);
  assert.equal(inDocumentWeergave(globalThis), false);
});

test('de overlay gebruikt deze invoer, niet meer luisteraars op het annotatiecanvas', () => {
  const bron = lees('./image-crop-overlay.js');
  assert.match(bron, /installeerCropInvoer\(document,/);
  assert.doesNotMatch(bron, /annotationCanvas\.addEventListener\('pointer/);
  for (const fn of ['onPointerDown', 'onPointerMove', 'onPointerUp']) {
    const deel = bron.slice(bron.indexOf(`function ${fn}(`), bron.indexOf('\n}\n', bron.indexOf(`function ${fn}(`)));
    assert.match(deel, /eisGebeurtenisOp\(e\)/, `${fn} neemt de gebeurtenis over`);
  }
  const down = bron.slice(bron.indexOf('function onPointerDown('), bron.indexOf('function onPointerMove('));
  assert.match(down, /inDocumentWeergave\(e\.target\)/);
});
