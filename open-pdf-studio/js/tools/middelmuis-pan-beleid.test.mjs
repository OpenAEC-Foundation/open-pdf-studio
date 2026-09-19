import assert from 'node:assert/strict';
import test from 'node:test';

import { middelmuisActie, maakMiddelmuisHandlers } from './middelmuis-pan-beleid.js';

// Middelmuisknop ingedrukt, verder geen knoppen: een gewone pan-start.
const basis = { button: 1, buttons: 4, binnenWeergave: true, inVergelijking: false, alPannen: false };

test('middelknop in het weergavegebied start een pan, ongeacht waar de klik begint', () => {
  assert.equal(middelmuisActie(basis), 'pan');
  // buttons ontbreekt (bijv. een auxclick): nog steeds een pan-kandidaat.
  assert.equal(middelmuisActie({ ...basis, buttons: undefined }), 'pan');
});

test('andere knoppen worden niet aangeraakt', () => {
  assert.equal(middelmuisActie({ ...basis, button: 0, buttons: 1 }), 'negeer');
  assert.equal(middelmuisActie({ ...basis, button: 2, buttons: 2 }), 'negeer');
});

test('buiten het weergavegebied (tabbladen, lint, panelen) geen ingreep', () => {
  assert.equal(middelmuisActie({ ...basis, binnenWeergave: false }), 'negeer');
});

test('vergelijkingsweergave houdt haar eigen pan-afhandeling', () => {
  assert.equal(middelmuisActie({ ...basis, inVergelijking: true }), 'negeer');
});

test('tijdens een lopende bewerking met links of rechts: alleen autoscroll blokkeren', () => {
  assert.equal(middelmuisActie({ ...basis, buttons: 1 | 4 }), 'blokkeer');
  assert.equal(middelmuisActie({ ...basis, buttons: 2 | 4 }), 'blokkeer');
});

test('een pan die al loopt wordt niet opnieuw gestart', () => {
  assert.equal(middelmuisActie({ ...basis, alPannen: true }), 'blokkeer');
});

// ── Handlers (installatielaag met geïnjecteerde afhankelijkheden) ──

function nepDoel({ inWeergave = true, inVergelijking = false } = {}) {
  return { closest: (sel) => (sel === '#pdf-container' ? (inWeergave ? {} : null) : sel === '.compare-view' ? (inVergelijking ? {} : null) : null) };
}
function nepEvent(o = {}) {
  const e = { button: 1, buttons: 4, target: nepDoel(o), prevented: false, gestopt: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.gestopt = true; }, ...o.event };
  return e;
}
function maak({ modus = 'continuous', panning = false, viewportActief = false } = {}) {
  const log = [];
  const h = maakMiddelmuisHandlers({
    heeftDocument: () => true,
    weergaveModus: () => modus,
    isPanning: () => panning,
    rondBewerkingenAf: () => log.push('afronden'),
    sluitMenu: () => log.push('menu'),
    startScrollPan: () => log.push('scrollpan'),
    startViewportPan: () => { log.push('viewportpan?'); return viewportActief; },
  });
  return { h, log };
}

test('pan-start rondt eerst een lopende bewerking af en sluit het menu', () => {
  const { h, log } = maak();
  const e = nepEvent();
  h.onPointerDown(e);
  assert.deepEqual(log, ['afronden', 'menu', 'scrollpan']);
  assert.equal(e.prevented, true);
  assert.equal(e.gestopt, true);
});

test('enkele pagina: viewport-pan, met scroll-pan als terugval', () => {
  let m = maak({ modus: 'single', viewportActief: true });
  m.h.onPointerDown(nepEvent());
  assert.deepEqual(m.log, ['afronden', 'menu', 'viewportpan?']);
  m = maak({ modus: 'single', viewportActief: false });
  m.h.onPointerDown(nepEvent());
  assert.deepEqual(m.log, ['afronden', 'menu', 'viewportpan?', 'scrollpan']);
});

test('alleen blokkeren: geen afronding, geen pan, event loopt door', () => {
  const { h, log } = maak({ panning: true });
  const e = nepEvent();
  h.onPointerDown(e);
  assert.deepEqual(log, []);
  assert.equal(e.prevented, true);
  assert.equal(e.gestopt, false);
});

test('buiten de weergave of in de vergelijking: niets aanraken', () => {
  for (const o of [{ inWeergave: false }, { inVergelijking: true }, { event: { button: 0, buttons: 1 } }]) {
    const { h, log } = maak();
    const e = nepEvent(o);
    h.onPointerDown(e);
    h.onMouseDown(e);
    assert.deepEqual(log, []);
    assert.equal(e.prevented, false);
    assert.equal(e.gestopt, false);
  }
});

test('mousedown-vangnet bij akkoord met linkerknop: alleen preventDefault', () => {
  const { h, log } = maak();
  const e = nepEvent({ event: { buttons: 1 | 4 } });
  h.onMouseDown(e);
  assert.equal(e.prevented, true);
  assert.deepEqual(log, []);
});
