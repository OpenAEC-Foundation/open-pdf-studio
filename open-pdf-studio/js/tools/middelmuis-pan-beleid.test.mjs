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

// ── Dubbelklik met de middelknop = zoom alles (issue #767) ──

import { maakMiddelmuisDubbelklik } from './middelmuis-dubbelklik.js';

function maakMetDubbelklik({ modus = 'continuous', aan = true, panning = false } = {}) {
  let t = 0;
  const log = [];
  // Pseudo-gereedschap met een lopende tekenbewerking: de handlers krijgen
  // er geen toegang toe, dus het gebaar kan hem niet beëindigen.
  const tekenen = { tool: 'polyline', punten: [[1, 1], [5, 5]], actief: true };
  const h = maakMiddelmuisHandlers({
    heeftDocument: () => true,
    weergaveModus: () => modus,
    isPanning: () => panning,
    rondBewerkingenAf: () => log.push('afronden'),
    sluitMenu: () => log.push('menu'),
    startScrollPan: () => log.push('scrollpan'),
    startViewportPan: () => { log.push('viewportpan'); return true; },
    dubbelklik: maakMiddelmuisDubbelklik({ nu: () => t }),
    dubbelklikAan: () => aan,
    zoomAlles: () => log.push('zoomAlles'),
    plan: (fn) => { log.push('gepland'); fn(); },
  });
  const ev = (_type, o = {}) => nepEvent({ event: { clientX: 10, clientY: 10, ...o } });
  return { h, log, tekenen, op: (ms) => { t = ms; }, ev };
}

function middelklik(m, t0, { x = 10, y = 10 } = {}) {
  m.op(t0); m.h.onPointerDown(m.ev('down', { clientX: x, clientY: y }));
  m.op(t0 + 40); m.h.onPointerUp(m.ev('up', { clientX: x, clientY: y, buttons: 0 }));
}

test('dubbelklik met de middelknop: elke druk pant gewoon, daarna één keer zoom alles', () => {
  const m = maakMetDubbelklik({ modus: 'single' });
  middelklik(m, 0);
  middelklik(m, 150);
  assert.deepEqual(m.log, [
    'afronden', 'menu', 'viewportpan',
    'afronden', 'menu', 'viewportpan',
    'gepland', 'zoomAlles',
  ]);
});

test('middelsleep pant en zoomt nooit, ook niet direct na een snelle klik', () => {
  const m = maakMetDubbelklik();
  middelklik(m, 0);
  m.op(100); m.h.onPointerDown(m.ev('down'));
  m.op(120); m.h.onPointerMove(m.ev('move', { button: -1, clientX: 40, clientY: 30 }));
  m.op(200); m.h.onPointerUp(m.ev('up', { clientX: 40, clientY: 30, buttons: 0 }));
  assert.ok(!m.log.includes('zoomAlles'));
  assert.equal(m.log.filter((x) => x === 'scrollpan').length, 2);
});

test('andere knoppen tellen niet mee voor de dubbelklik', () => {
  const m = maakMetDubbelklik();
  for (const t0 of [0, 100]) {
    m.op(t0); m.h.onPointerDown(m.ev('down', { button: 0, buttons: 1 }));
    m.op(t0 + 30); m.h.onPointerUp(m.ev('up', { button: 0, buttons: 0 }));
  }
  assert.deepEqual(m.log, []);
});

test('voorkeur uit: middelklikken pannen nog, maar zoomen niet', () => {
  const m = maakMetDubbelklik({ aan: false });
  middelklik(m, 0);
  middelklik(m, 100);
  assert.ok(!m.log.includes('zoomAlles'));
  assert.equal(m.log.filter((x) => x === 'scrollpan').length, 2);
});

test('buiten de weergave telt een middelklik niet mee', () => {
  const m = maakMetDubbelklik();
  m.op(0); m.h.onPointerDown(nepEvent({ inWeergave: false, event: { clientX: 10, clientY: 10 } }));
  m.op(40); m.h.onPointerUp(m.ev('up', { buttons: 0 }));
  m.op(100); m.h.onPointerDown(nepEvent({ inWeergave: false, event: { clientX: 10, clientY: 10 } }));
  m.op(140); m.h.onPointerUp(m.ev('up', { buttons: 0 }));
  assert.deepEqual(m.log, []);
});

test('tijdens een tekenbewerking met ingedrukte linkerknop (akkoord): zoomt, zonder pan of afronding', () => {
  const m = maakMetDubbelklik();
  const voor = JSON.stringify(m.tekenen);
  // Akkoord: de middelknop-wissels komen als pointermove met button === 1.
  for (const t0 of [0, 120]) {
    m.op(t0); m.h.onPointerMove(m.ev('move', { button: 1, buttons: 1 | 4 }));
    m.op(t0 + 40); m.h.onPointerMove(m.ev('move', { button: 1, buttons: 1 }));
  }
  assert.deepEqual(m.log, ['gepland', 'zoomAlles']);
  assert.equal(JSON.stringify(m.tekenen), voor);
});

test('tijdens een klik-voor-klik-tekenbewerking blijft de bewerking ongemoeid', () => {
  const m = maakMetDubbelklik({ modus: 'single' });
  const voor = JSON.stringify(m.tekenen);
  middelklik(m, 0);
  middelklik(m, 150);
  assert.ok(m.log.includes('zoomAlles'));
  assert.equal(JSON.stringify(m.tekenen), voor);
});

test('pointercancel breekt een half afgemaakte dubbelklik af', () => {
  const m = maakMetDubbelklik();
  middelklik(m, 0);
  m.h.onPointerCancel();
  middelklik(m, 100);
  assert.ok(!m.log.includes('zoomAlles'));
});

test('zonder detector werken de nieuwe handlers als no-op (bestaande pan ongewijzigd)', () => {
  const { h, log } = maak();
  h.onPointerDown(nepEvent());
  h.onPointerMove(nepEvent({ event: { button: -1 } }));
  h.onPointerUp(nepEvent({ event: { buttons: 0 } }));
  h.onPointerCancel();
  assert.deepEqual(log, ['afronden', 'menu', 'scrollpan']);
});
