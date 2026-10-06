import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  leesWielDelta,
  maakWielHerkenning,
  maakWielScroller,
  maakElementVerschuiver,
  stopAlleWielScrollers,
} from './wiel-scroll.js';

// Issue #522: één wielklik liet de enkelpagina-weergave ruim 2 s doorglijden
// (uitloop per FRAME; op een zware pagina zakt het tempo naar ~20 fps). Deze
// tests leggen het gewenste gedrag vast met een nepklok: kort uitlopen op
// TIJD, klikken tellen exact op, touchpad 1-op-1.

const EPS = 1e-6;

// Speelt een scroller af in pomp-modus (zoals de render-lus van de viewport):
// een frame om de frameMs, wielevents op hun eigen tijdstip daartussen.
function speelAf({ frameMs = 1000 / 60, events, totMs = 3000, frameTijden = null }) {
  let t = 0;
  const pos = { x: 0, y: 0 };
  const log = [];
  const s = maakWielScroller({
    nu: () => t,
    verschuif: (dx, dy) => {
      pos.x += dx;
      pos.y += dy;
      log.push({ t, dx, dy, x: pos.x, y: pos.y });
    },
  });
  const tijdlijn = [];
  const frames = frameTijden || [];
  if (!frameTijden) for (let f = frameMs; f <= totMs + EPS; f += frameMs) frames.push(f);
  for (const f of frames) tijdlijn.push({ t: f, soort: 'frame' });
  for (const ev of events) tijdlijn.push({ t: ev.t, soort: 'wiel', ev });
  // Bij gelijke tijd eerst het wielevent, dan het frame (zoals in de browser).
  tijdlijn.sort((a, b) => a.t - b.t || (a.soort === 'wiel' ? -1 : 1));
  let som = 0;
  const achterstandVoorKlik = [];
  const posBijEvent = [];
  for (const item of tijdlijn) {
    t = item.t;
    if (item.soort === 'wiel') {
      const { dx = 0, dy = 0, stap = true } = item.ev;
      achterstandVoorKlik.push(som - pos.y);
      posBijEvent.push(pos.y);
      som += dy;
      s.wiel(dx, dy, stap);
    } else {
      s.pomp(t);
    }
  }
  const bewegingen = log.filter(l => Math.abs(l.dx) > EPS || Math.abs(l.dy) > EPS);
  const stilNa = bewegingen.length ? bewegingen[bewegingen.length - 1].t : 0;
  return { pos, log, bewegingen, stilNa, actief: s.actief, achterstandVoorKlik, posBijEvent, scroller: s };
}

const KLIK = [{ t: 0, dy: 100 }];

test('één wielklik staat binnen 250 ms stil, ook als de frames traag komen', () => {
  for (const fps of [144, 60, 30, 20, 10]) {
    const r = speelAf({ frameMs: 1000 / fps, events: KLIK });
    assert.ok(r.stilNa <= 250, `${fps} fps: beweegt nog op ${Math.round(r.stilNa)} ms`);
    assert.equal(r.actief, false, `${fps} fps: uitloop loopt nog`);
  }
});

test('één wielklik schuift precies zijn delta op', () => {
  for (const fps of [144, 60, 20]) {
    const r = speelAf({ frameMs: 1000 / fps, events: KLIK });
    assert.ok(Math.abs(r.pos.y - 100) < EPS, `${fps} fps: totaal ${r.pos.y} i.p.v. 100`);
    assert.ok(Math.abs(r.pos.x) < EPS);
  }
});

test('een wielklik loopt zacht uit: geen sprong, wel snel op weg', () => {
  const r = speelAf({ frameMs: 1000 / 60, events: KLIK });
  const eerste = r.bewegingen[0];
  assert.ok(eerste.dy > 0 && eerste.dy < 50, `eerste frame ${eerste.dy} px: hoort een deel van de klik te zijn`);
  // Ease-out: elke stap is hooguit zo groot als de vorige.
  for (let i = 1; i < r.bewegingen.length; i++) {
    assert.ok(r.bewegingen[i].dy <= r.bewegingen[i - 1].dy + EPS, `stap ${i} groter dan de vorige`);
  }
  // Na 100 ms is het grootste deel al afgelegd (vlot), maar niet alles (zacht).
  const op100 = r.log.filter(l => l.t <= 100).reduce((s, l) => s + l.dy, 0);
  assert.ok(op100 >= 80, `na 100 ms pas ${op100.toFixed(1)} px`);
});

test('de voortgang hangt af van de tijd, niet van het aantal frames', () => {
  const fijn = speelAf({ events: KLIK, frameTijden: [10, 20, 30, 40, 50, 60, 70, 80, 90] });
  const grof = speelAf({ events: KLIK, frameTijden: [45, 90] });
  const enkel = speelAf({ events: KLIK, frameTijden: [90] });
  assert.ok(Math.abs(fijn.pos.y - grof.pos.y) < EPS, `${fijn.pos.y} vs ${grof.pos.y}`);
  assert.ok(Math.abs(fijn.pos.y - enkel.pos.y) < EPS, `${fijn.pos.y} vs ${enkel.pos.y}`);
});

test('snelle opeenvolgende klikken tellen exact op, zonder naijlen of doorschieten', () => {
  const events = [0, 50, 100, 150, 200].map(t => ({ t, dy: 100 }));
  const r = speelAf({ frameMs: 1000 / 60, events });
  assert.ok(Math.abs(r.pos.y - 500) < EPS, `totaal ${r.pos.y} i.p.v. 500`);
  // Nooit voorbij het doel en nooit terug: monotoon.
  for (const l of r.log) {
    assert.ok(l.y <= 500 + EPS, `doorgeschoten tot ${l.y}`);
    assert.ok(l.dy >= -EPS, 'beweegt terug');
  }
  // Geen oplopende achterstand: vlak voor elke klik minder dan één klik te gaan.
  for (const a of r.achterstandVoorKlik) assert.ok(a < 100, `achterstand ${a.toFixed(1)} px`);
  // Stil binnen 250 ms na de laatste klik.
  assert.ok(r.stilNa - 200 <= 250, `nog ${Math.round(r.stilNa - 200)} ms na de laatste klik in beweging`);
});

test('een klik terug keert meteen om en landt exact op de som', () => {
  const r = speelAf({ frameMs: 1000 / 60, events: [{ t: 0, dy: 100 }, { t: 60, dy: -100 }] });
  for (const l of r.log.filter(l => l.t > 60)) {
    assert.ok(l.dy <= EPS, `na het omkeren nog ${l.dy} px de oude kant op`);
  }
  assert.ok(Math.abs(r.pos.y) < EPS, `eindigt op ${r.pos.y} i.p.v. 0`);
  assert.ok(r.stilNa <= 60 + 250);
});

test('horizontaal (Shift+wiel, kantelwiel) gedraagt zich hetzelfde', () => {
  const r = speelAf({ frameMs: 1000 / 60, events: [{ t: 0, dx: 100, dy: 0 }] });
  assert.ok(Math.abs(r.pos.x - 100) < EPS);
  assert.ok(Math.abs(r.pos.y) < EPS);
  assert.ok(r.stilNa <= 250);
});

test('touchpad en fijne wieldelta\'s gaan direct en 1-op-1 door', () => {
  let t = 0;
  const log = [];
  const s = maakWielScroller({ nu: () => t, verschuif: (dx, dy) => log.push({ t, dx, dy }) });
  const deltas = [1.5, 4, 7.25, 12, 9.5, 3];
  for (const d of deltas) {
    t += 8;
    const voor = log.length;
    s.wiel(0, d, false);
    // Meteen toegepast, binnen het event zelf, met precies de delta.
    assert.equal(log.length, voor + 1);
    assert.equal(log[log.length - 1].dy, d);
    assert.equal(log[log.length - 1].t, t);
  }
  // Geen eigen uitloop erachteraan: de traagheid komt van het besturingssysteem.
  assert.equal(s.actief, false);
  const voor = log.length;
  for (let f = 0; f < 30; f++) { t += 16; s.pomp(t); }
  assert.equal(log.length, voor);
});

test('stop() breekt een lopende uitloop af', () => {
  let t = 0;
  let y = 0;
  const s = maakWielScroller({ nu: () => t, verschuif: (dx, dy) => { y += dy; } });
  s.wiel(0, 100, true);
  t = 30; s.pomp(t);
  const tussen = y;
  s.stop();
  for (t = 46; t < 1000; t += 16) s.pomp(t);
  assert.equal(y, tussen);
  assert.equal(s.actief, false);
});

test('met animatieframes: één frame tegelijk, en geen eindeloze lus na afloop', () => {
  let t = 0;
  let y = 0;
  const wachtrij = [];
  const s = maakWielScroller({
    nu: () => t,
    verschuif: (dx, dy) => { y += dy; },
    vraagFrame: (f) => { wachtrij.push(f); },
  });
  s.wiel(0, 100, true);
  s.wiel(0, 100, true);
  assert.equal(wachtrij.length, 1, 'twee klikken in hetzelfde frame vragen één frame aan');
  let frames = 0;
  while (wachtrij.length && frames < 1000) {
    const f = wachtrij.shift();
    t += 1000 / 60;
    f();
    frames++;
    assert.ok(wachtrij.length <= 1);
  }
  assert.ok(Math.abs(y - 200) < EPS, `totaal ${y}`);
  assert.ok(t <= 250, `pas stil na ${Math.round(t)} ms`);
  assert.equal(wachtrij.length, 0);
});

// ── Invoer lezen en herkennen ──

test('leesWielDelta: pixels, regels en pagina\'s naar CSS-pixels', () => {
  assert.deepEqual(leesWielDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 }), { dx: 0, dy: 100 });
  // Drie regels = één klik van 100 px, zoals Chromium een klik meldt.
  const regels = leesWielDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 });
  assert.ok(Math.abs(regels.dy - 100) < EPS);
  // Een pagina = 87,5 % van het zichtbare gebied (zoals de browser bladert).
  const pagina = leesWielDelta({ deltaX: 0, deltaY: -1, deltaMode: 2 }, 800);
  assert.ok(Math.abs(pagina.dy + 700) < EPS);
});

test('leesWielDelta: Shift+wiel is horizontaal, ook als de webview dat niet zelf omzet', () => {
  assert.deepEqual(leesWielDelta({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true }), { dx: 100, dy: 0 });
  // Chromium zet het al om: niet nog eens draaien.
  assert.deepEqual(leesWielDelta({ deltaX: 100, deltaY: 0, deltaMode: 0, shiftKey: true }), { dx: 100, dy: 0 });
});

test('herkenning: muiswielklik krijgt de uitloop, touchpad en fijn wiel niet', () => {
  const h = maakWielHerkenning();
  // Losse klik van een gewoon muiswiel (100 px, of 33 px bij één regel per klik).
  assert.equal(h.isStap({ deltaMode: 0 }, 0, 100, 1000), true);
  assert.equal(h.isStap({ deltaMode: 0 }, 0, -100 / 3, 2000), true);
  // Regels of pagina's komen alleen van een muiswiel.
  assert.equal(h.isStap({ deltaMode: 1 }, 0, 100, 3000), true);
  // Kleine delta's: touchpad of hoge-resolutiewiel.
  assert.equal(h.isStap({ deltaMode: 0 }, 0, 4, 4000), false);
  assert.equal(h.isStap({ deltaMode: 0 }, 0, 12.5, 4010), false);
  // Grote delta midden in een touchpadveeg (snelle veeg / OS-traagheid) hoort
  // bij hetzelfde gebaar.
  assert.equal(h.isStap({ deltaMode: 0 }, 0, 60, 4050), false);
  assert.equal(h.isStap({ deltaMode: 0 }, 0, 90, 4150), false);
  // Ruim na het gebaar is een grote delta weer een muiswielklik.
  assert.equal(h.isStap({ deltaMode: 0 }, 0, 100, 4600), true);
  // Niets te doen.
  assert.equal(h.isStap({ deltaMode: 0 }, 0, 0, 5000), false);
});

// ── Scrollend element (#pdf-container) ──

// Scrollend element dat scrollTop/scrollLeft afrondt en klemt op [0, max].
// Met `maten` meldt het ook zijn scrollbereik (scrollHeight/clientHeight),
// zoals #pdf-container; zonder die maten weet alleen de klem waar de rand ligt.
function nepElement({ max = 100000, afronden = Math.round, maten = true } = {}) {
  let top = 0;
  let left = 0;
  const el = {
    get scrollTop() { return top; },
    set scrollTop(v) { top = Math.max(0, Math.min(max, afronden(v))); },
    get scrollLeft() { return left; },
    set scrollLeft(v) { left = Math.max(0, Math.min(max, afronden(v))); },
  };
  if (maten) {
    const zicht = 600;
    Object.assign(el, { clientHeight: zicht, scrollHeight: max + zicht, clientWidth: zicht, scrollWidth: max + zicht });
  }
  return el;
}

function speelElementAf(el, events, { frameMs = 1000 / 60, totMs = 1000, tussendoor = null } = {}) {
  let t = 0;
  const wachtrij = [];
  const verschuif = maakElementVerschuiver(() => el);
  const s = maakWielScroller({
    nu: () => t,
    verschuif,
    ruimte: verschuif.ruimte,
    vraagFrame: (f) => { wachtrij.push(f); },
  });
  const evs = events.slice();
  while (t <= totMs) {
    while (evs.length && evs[0].t <= t) { const e = evs.shift(); s.wiel(e.dx || 0, e.dy || 0, e.stap !== false); }
    if (tussendoor) tussendoor(t, el);
    const f = wachtrij.shift();
    if (f) f();
    t += frameMs;
  }
  return s;
}

test('element: een klik levert precies zijn delta op, ook met afgeronde scrollTop', () => {
  for (const afronden of [Math.round, Math.floor, Math.ceil]) {
    const el = nepElement({ afronden });
    el.scrollTop = 300;
    speelElementAf(el, [{ t: 0, dy: 100 }]);
    assert.equal(el.scrollTop, 400, `${afronden.name}: ${el.scrollTop}`);
    speelElementAf(el, [{ t: 0, dy: -100 / 3 }, { t: 20, dy: -100 / 3 }, { t: 40, dy: -100 / 3 }]);
    assert.equal(el.scrollTop, 300, `${afronden.name}: ${el.scrollTop}`);
  }
});

test('element: aan de rand stopt het gewoon', () => {
  const el = nepElement({ max: 350 });
  el.scrollTop = 300;
  speelElementAf(el, [{ t: 0, dy: 100 }]);
  assert.equal(el.scrollTop, 350);
});

// Tegen de rand: wat niet meer past, mag een klik terug niet opeten. Vroeger
// (webview zelf) klemde het doel op het scrollbereik; een klik terug reageerde
// meteen. Beide routes: met scrollbereik (doel klemmen, zoals Chromium) en
// zonder (de uitloop laat vallen zodra het element afkapt).
const RANDGEVALLEN = [
  { naam: 'klik naar de rand en meteen terug', start: 30, max: 5000,
    events: [{ t: 0, dy: -100 }, { t: 67, dy: 100 }], eind: 100 },
  { naam: 'vijf klikken tegen de rand en één terug', start: 150, max: 5000,
    events: [0, 40, 80, 120, 160].map(t => ({ t, dy: -100 })).concat([{ t: 200, dy: 100 }]), eind: 100 },
  { naam: 'doorgedraaid tegen de onderrand en één terug', start: 950, max: 1000,
    events: [0, 36, 72, 108].map(t => ({ t, dy: 100 })).concat([{ t: 144, dy: -100 }]), eind: 900 },
];

test('element: een klik terug na het raken van de rand keert meteen en volledig om', () => {
  for (const maten of [true, false]) {
    for (const g of RANDGEVALLEN) {
      const el = nepElement({ max: g.max, maten });
      el.scrollTop = g.start;
      const s = speelElementAf(el, g.events);
      assert.equal(el.scrollTop, g.eind, `${g.naam}${maten ? '' : ' (zonder scrollbereik)'}: eindigt op ${el.scrollTop}`);
      assert.equal(s.actief, false);
    }
  }
});

test('element: een klik die over de rand zou gaan, telt maar tot de rand mee', () => {
  // 50 px ruimte, een klik van 100 omlaag en na 48 ms één terug: de klik
  // terug vertrekt vanaf de rand, niet vanaf een doel voorbij de rand.
  const el = nepElement({ max: 1000 });
  el.scrollTop = 950;
  speelElementAf(el, [{ t: 0, dy: 100 }, { t: 48, dy: -100 }]);
  assert.equal(el.scrollTop, 900);
  // Midden in het document verandert er niets: vijf klikken = 500 px.
  const midden = nepElement({ max: 100000 });
  midden.scrollTop = 5000;
  speelElementAf(midden, [0, 30, 60, 90, 120].map(t => ({ t, dy: 100 })));
  assert.equal(midden.scrollTop, 5500);
});

test('element: tegen de rand stopt de uitloop alleen op die as', () => {
  // Schuin wielen (beide assen) met de linkerrand vlakbij: horizontaal loopt
  // vast, verticaal komt de hele klik aan.
  const el = nepElement({ max: 5000, maten: false });
  el.scrollLeft = 20;
  el.scrollTop = 1000;
  speelElementAf(el, [{ t: 0, dx: -100, dy: 100 }, { t: 100, dx: 100, dy: 0 }]);
  assert.equal(el.scrollLeft, 100);
  assert.equal(el.scrollTop, 1100);
});

test('element: scrolt iets anders tussendoor (schuifbalk, sprong naar pagina), dan stopt de uitloop', () => {
  const el = nepElement();
  let gesprongen = false;
  const s = speelElementAf(el, [{ t: 0, dy: 100 }], {
    tussendoor: (t, e) => { if (!gesprongen && t >= 50) { gesprongen = true; e.scrollTop = 5000; } },
  });
  assert.equal(el.scrollTop, 5000);
  assert.equal(s.actief, false);
});

// Een vloeiende sprong (goToPage in doorlopend, zoektreffer, annotatielijst)
// beweegt in het eerste frame nog niet; de volgende stap van de wieluitloop
// zou scrollTop schrijven en de sprong in de webview afbreken. Daarom stopt
// zo'n sprong eerst ALLE lopende uitlopen.
test('stopAlleWielScrollers() stopt elke lopende uitloop, ook die van een ander exemplaar', () => {
  let t = 0;
  const el = nepElement();
  el.scrollTop = 2000;
  // Telt elke schrijfactie: na het stoppen mag de uitloop niets meer zetten.
  let schrijven = 0;
  const bewaakt = {
    get scrollTop() { return el.scrollTop; },
    set scrollTop(v) { schrijven++; el.scrollTop = v; },
    get scrollLeft() { return el.scrollLeft; },
    set scrollLeft(v) { schrijven++; el.scrollLeft = v; },
  };
  const wachtrij = [];
  const container = maakWielScroller({
    nu: () => t,
    verschuif: maakElementVerschuiver(() => bewaakt),
    vraagFrame: (f) => { wachtrij.push(f); },
  });
  let gepompt = 0;
  const viewport = maakWielScroller({ nu: () => t, verschuif: () => { gepompt++; } });
  container.wiel(0, 100, true);
  viewport.wiel(0, 100, true);
  assert.equal(container.actief, true);
  assert.equal(viewport.actief, true);

  stopAlleWielScrollers();
  assert.equal(container.actief, false);
  assert.equal(viewport.actief, false);

  // De vloeiende sprong begint; de webview zet scrollTop pas in latere
  // frames. Het al aangevraagde frame en de render-lus doen niets meer.
  for (let f = 0; f < 30; f++) {
    t += 1000 / 60;
    const frame = wachtrij.shift();
    if (frame) frame();
    container.pomp(t);
    viewport.pomp(t);
  }
  assert.equal(schrijven, 0, `nog ${schrijven} keer scrollTop/scrollLeft geschreven`);
  assert.equal(el.scrollTop, 2000);
  assert.equal(gepompt, 0);
  // Een nieuwe klik werkt daarna gewoon weer.
  container.wiel(0, 100, true);
  for (let f = 0; f < 30; f++) { t += 1000 / 60; const frame = wachtrij.shift(); if (frame) frame(); }
  assert.equal(el.scrollTop, 2100);
});

test('elke vloeiende sprong in het documentgebied stopt eerst de wieluitloop', () => {
  for (const pad of ['./renderer.js', '../search/find-bar.js', '../ui/panels/annotations-list.js']) {
    const regels = readFileSync(new URL(pad, import.meta.url), 'utf8').split(/\r?\n/);
    let gevonden = 0;
    regels.forEach((regel, i) => {
      if (!/behavior:\s*'smooth'/.test(regel) || /^\s*(\/\/|\*)/.test(regel)) return;
      gevonden++;
      const ervoor = regels.slice(Math.max(0, i - 3), i).join('\n');
      assert.match(ervoor, /stopAlleWielScrollers\(\)/, `${pad}:${i + 1} scrolt vloeiend zonder eerst stopAlleWielScrollers()`);
    });
    assert.ok(gevonden > 0, `${pad}: geen vloeiende sprong gevonden (test bijwerken)`);
  }
});

test('element: touchpad-delta\'s komen 1-op-1 aan, met de breukdelen bewaard', () => {
  const el = nepElement();
  el.scrollTop = 1000;
  speelElementAf(el, [0.4, 0.4, 0.4, 2.3, 7.5].map((dy, i) => ({ t: i * 8, dy, stap: false })), { totMs: 100 });
  assert.equal(el.scrollTop, 1011);
});
