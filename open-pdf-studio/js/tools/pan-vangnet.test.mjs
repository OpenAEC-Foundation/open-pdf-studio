import assert from 'node:assert/strict';
import test from 'node:test';

import { geenPanKnopMeer, installeerPanVangnet } from './pan-vangnet.js';

test('beweging zonder linker- of middelknop = loslaten gemist', () => {
  assert.equal(geenPanKnopMeer({ buttons: 0 }), true);
  assert.equal(geenPanKnopMeer({ buttons: 2 }), true); // alleen rechts
  assert.equal(geenPanKnopMeer({ buttons: 1 }), false);
  assert.equal(geenPanKnopMeer({ buttons: 4 }), false);
  assert.equal(geenPanKnopMeer({ buttons: 5 }), false);
  // Zonder buttons-informatie niet afbreken.
  assert.equal(geenPanKnopMeer({}), false);
  assert.equal(geenPanKnopMeer(null), false);
});

// Nabootsing van de pan-status zoals pan-handler.js en pdf-viewport.js die
// bijhouden: een pan begint op pointerdown en eindigt alleen op pointerup.
function maakPan() {
  const s = { isPanning: false, isMiddleButtonPanning: false, gereedschap: 'hand' };
  return {
    s,
    druk(middel = false) { s.isPanning = true; s.isMiddleButtonPanning = middel; },
    los() { s.isPanning = false; s.isMiddleButtonPanning = false; },
    breekAf() { if (s.isPanning) { s.isPanning = false; s.isMiddleButtonPanning = false; } },
  };
}

test('#1013: vensterwissel tijdens een pan laat de pan niet hangen', () => {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const pan = maakPan();
  const weg = installeerPanVangnet({ win, doc, breekAf: () => pan.breekAf() });

  pan.druk();
  // De pointerup gaat naar het andere venster; hier komt alleen de blur.
  win.dispatchEvent(new Event('blur'));
  assert.equal(pan.s.isPanning, false);
  assert.equal(pan.s.isMiddleButtonPanning, false);
  // Het gekozen gereedschap blijft staan.
  assert.equal(pan.s.gereedschap, 'hand');

  // Ook een middelknop-pan.
  pan.druk(true);
  win.dispatchEvent(new Event('blur'));
  assert.equal(pan.s.isPanning, false);
  assert.equal(pan.s.isMiddleButtonPanning, false);

  weg();
  pan.druk();
  win.dispatchEvent(new Event('blur'));
  assert.equal(pan.s.isPanning, true, 'na weghalen geen luisteraar meer');
});

test('verborgen pagina breekt de pan af, weer zichtbaar niet', () => {
  const win = new EventTarget();
  const doc = new EventTarget();
  const pan = maakPan();
  installeerPanVangnet({ win, doc, breekAf: () => pan.breekAf() });

  pan.druk();
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pan.s.isPanning, true);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pan.s.isPanning, false);
});
