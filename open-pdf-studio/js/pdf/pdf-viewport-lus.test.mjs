import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Render-lus van de enkelpagina-viewport op aanvraag. Vroeger vroeg tick()
// altijd een volgend animatieframe aan, ook zonder werk: een stilstaand
// venster tekende niets maar liet de webview en de GPU 240 keer per seconde
// wakker worden. Nu vraagt de lus alleen een frame bij werk: een dirty-
// schrijfactie (door elke bestaande schrijver), active die aangaat terwijl er
// werk wacht, of een lopende wieluitloop (#522).
//
// De echte pdf-viewport.js draait hier onder node met een nep-
// requestAnimationFrame, een nep-canvas en vervangen app-modules (zie
// pdf-viewport-test-hooks.mjs).

const wachtrij = new Map();
let volgendId = 1;
globalThis.requestAnimationFrame = (cb) => {
  const id = volgendId++;
  wachtrij.set(id, cb);
  return id;
};
globalThis.cancelAnimationFrame = (id) => { wachtrij.delete(id); };

// Nepklok voor de wieluitloop (op tijd, WIEL_DUUR_MS): de render-lus leest
// performance.now() bij elk frame. null = de echte klok.
let nepTijd = null;
const echteNu = performance.now.bind(performance);
performance.now = () => (nepTijd === null ? echteNu() : nepTijd);
const FRAME_MS = 1000 / 60;

// Draai alle nu wachtende frames; wat ze zelf aanvragen wacht op de volgende ronde.
function draaiFrames() {
  const nu = [...wachtrij.values()];
  wachtrij.clear();
  for (const cb of nu) cb(performance.now());
  return nu.length;
}
const wachtend = () => wachtrij.size;

const container = { clientWidth: 800, clientHeight: 600, querySelector: () => null };
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  getElementById: (id) => (id === 'pdf-container' ? container : null),
  querySelector: () => null,
};

let renders = 0;
globalThis.__vpTest = { impl: { renderVectorPage: () => { renders++; } } };

register('./pdf-viewport-test-hooks.mjs', import.meta.url);
const vp = await import('./pdf-viewport.js');
const { viewport } = vp;
const { WIEL_DUUR_MS } = await import('./wiel-scroll.js');

const nepCtx = new Proxy({}, {
  get: (doel, sleutel) => (sleutel in doel ? doel[sleutel] : () => {}),
  set: (doel, sleutel, waarde) => { doel[sleutel] = waarde; return true; },
});
const canvas = { width: 0, height: 0, style: {}, getContext: () => nepCtx };
let annotatieRedraws = 0;
const annotatieRedraw = () => { annotatieRedraws++; };

// Elke test met een pagina begint hier: lus aan, pagina actief, geen wachtend
// werk. Zo draait elke test ook los (--test-name-pattern).
function opzet() {
  nepTijd = null;
  vp.initViewport(canvas, annotatieRedraw);
  vp.setPage('a.pdf', 1, 600, 800, 0, 0, 0, 0);
  draaiFrames();
}

test('alleen laden vraagt geen frame', () => {
  assert.equal(wachtend(), 0);
});

test('initViewport zonder actieve pagina vraagt geen frame (leeg venster blijft stil)', () => {
  vp.initViewport(canvas, annotatieRedraw);
  assert.equal(canvas.width, 800, 'canvas op containermaat');
  assert.equal(viewport.active, false);
  assert.equal(wachtend(), 0);
});

test('setPage plant precies één frame; na het tekenen komt er geen volgend frame', () => {
  vp.initViewport(canvas, annotatieRedraw);
  const [r0, a0] = [renders, annotatieRedraws];
  vp.setPage('a.pdf', 1, 600, 800, 0, 0, 0, 0);
  assert.equal(viewport.active, true);
  assert.equal(wachtend(), 1);
  assert.equal(draaiFrames(), 1);
  assert.equal(renders, r0 + 1, 'de pagina is getekend');
  assert.equal(annotatieRedraws, a0 + 1);
  assert.equal(viewport.dirty, false);
  assert.equal(wachtend(), 0, 'geen werk meer: geen nieuw frame');
});

test('elke dirty-schrijfactie plant een frame, herhaald schrijven vóór het frame maar één', () => {
  opzet();
  const voor = renders;
  viewport.dirty = true;
  viewport.dirty = true;
  window.__pdfViewport.dirty = true;
  assert.equal(wachtend(), 1);
  draaiFrames();
  assert.equal(renders, voor + 1);
  assert.equal(wachtend(), 0);
  // Ook zonder schrijfacties blijft het stil.
  draaiFrames();
  assert.equal(renders, voor + 1);
});

test('dirty bij een inactieve viewport wacht; active=true plant dan het frame', () => {
  opzet();
  const voor = renders;
  viewport.active = false;
  viewport.dirty = true;
  assert.equal(wachtend(), 0, 'inactief: niets te tekenen');
  viewport.active = true;
  assert.equal(wachtend(), 1, 'active aan met wachtend werk');
  draaiFrames();
  assert.equal(renders, voor + 1);
  assert.equal(wachtend(), 0);
  viewport.active = true;
  assert.equal(wachtend(), 0, 'active zonder werk plant niets');
});

test('een wieluitloop pompt elk frame tot hij klaar is en stopt dan', (t) => {
  t.after(() => { nepTijd = null; });
  opzet();
  viewport.zoom = 3; // 1800 x 2400 px op een canvas van 800 x 600: verticaal te pannen
  viewport.offsetY = 0;
  viewport.dirty = true;
  draaiFrames();
  assert.equal(wachtend(), 0);
  nepTijd = 1000;
  const voor = renders;
  vp.wielPanViewport(0, 100, true);
  assert.equal(wachtend(), 1);
  let frames = 0;
  while (wachtend() > 0 && frames < 1000) {
    assert.equal(wachtend(), 1, 'nooit meer dan één frame tegelijk');
    nepTijd += FRAME_MS;
    draaiFrames();
    frames++;
  }
  // Elk frame tot het einde van de uitloop, en geen frame meer daarna.
  assert.equal(frames, Math.ceil(WIEL_DUUR_MS / FRAME_MS));
  assert.equal(wachtend(), 0, 'na de uitloop vraagt de lus geen frames meer');
  assert.ok(Math.abs(viewport.offsetY + 100) < 1e-6, `precies de wieldelta verschoven (${viewport.offsetY})`);
  assert.equal(renders - voor, frames, 'elk frame van de uitloop tekent');
});

test('viewport uit tijdens de uitloop: één frame laat de rest vallen, daarna niets', (t) => {
  t.after(() => { nepTijd = null; });
  opzet();
  viewport.zoom = 3; // verticaal te pannen, zie de vorige test
  nepTijd = 5000;
  viewport.offsetY = 0;
  vp.wielPanViewport(0, 100, true);
  nepTijd += FRAME_MS;
  draaiFrames();
  assert.equal(wachtend(), 1, 'uitloop loopt nog');
  const halverwege = viewport.offsetY;
  assert.ok(halverwege < 0 && halverwege > -100);
  viewport.active = false; // bijv. naar de doorlopende weergave
  assert.equal(wachtend(), 1, 'nog één frame om de uitloop te laten vallen');
  nepTijd += FRAME_MS;
  draaiFrames();
  assert.equal(wachtend(), 0);
  nepTijd += 1000;
  viewport.active = true;
  viewport.dirty = true;
  draaiFrames();
  assert.equal(viewport.offsetY, halverwege, 'geen sprong met het restant bij terugkomst');
  assert.equal(wachtend(), 0);
});

test('volgers horen elke render en elke wissel van active, tot ze stoppen', () => {
  opzet();
  let n = 0;
  const stopVolgen = vp.volgViewport(() => { n++; });
  viewport.dirty = true;
  draaiFrames();
  assert.equal(n, 1, 'na de render');
  viewport.active = false;
  assert.equal(n, 2, 'active uit');
  viewport.active = false;
  assert.equal(n, 2, 'geen wissel, geen melding');
  viewport.active = true;
  assert.equal(n, 3, 'active aan');
  stopVolgen();
  viewport.dirty = true;
  draaiFrames();
  assert.equal(n, 3);
});

test('ook als het tekenen faalt horen de volgers de nieuwe verschuiving', (t) => {
  opzet();
  viewport.zoom = 3; // 1800 x 2400 px op een canvas van 800 x 600: verticaal te pannen
  viewport.offsetY = 0;
  const echt = globalThis.__vpTest.impl.renderVectorPage;
  t.after(() => { globalThis.__vpTest.impl.renderVectorPage = echt; });
  globalThis.__vpTest.impl.renderVectorPage = () => { throw new Error('tekenen faalt'); };
  const gezien = [];
  t.after(vp.volgViewport(() => { gezien.push(viewport.offsetY); }));
  for (let i = 1; i <= 3; i++) {
    viewport.offsetY -= 100; // bijv. een sleep aan de duim of een klik in de baan
    viewport.dirty = true;
    assert.equal(wachtend(), 1);
    assert.throws(() => draaiFrames(), /tekenen faalt/);
    assert.equal(gezien.length, i, `volger na mislukte render ${i}`);
    assert.equal(gezien.at(-1), -100 * i);
    assert.equal(wachtend(), 0, 'geen foutlus per frame: pas de volgende schrijfactie plant weer');
  }
  // Tekent het weer, dan herstellen canvas en volgers bij de volgende schrijfactie.
  globalThis.__vpTest.impl.renderVectorPage = echt;
  const voor = renders;
  viewport.dirty = true;
  draaiFrames();
  assert.equal(renders, voor + 1);
  assert.equal(gezien.length, 4);
  assert.equal(wachtend(), 0);
});

test('dirty en active zijn accessors en blijven in JSON (app_get_viewport_state)', () => {
  opzet();
  for (const sleutel of ['dirty', 'active']) {
    const d = Object.getOwnPropertyDescriptor(viewport, sleutel);
    assert.equal(typeof d.get, 'function', sleutel);
    assert.equal(typeof d.set, 'function', sleutel);
    assert.equal(d.enumerable, true, sleutel);
    assert.equal(d.configurable, true, sleutel);
  }
  const kloon = JSON.parse(JSON.stringify(viewport));
  assert.equal(kloon.active, true);
  assert.equal(kloon.dirty, false);
  assert.equal(window.__pdfViewport, viewport);
});

test('opnieuw initViewport laat nooit twee frames staan', () => {
  opzet();
  viewport.dirty = true;
  assert.equal(wachtend(), 1);
  vp.initViewport(canvas, annotatieRedraw);
  assert.equal(wachtend(), 1);
  draaiFrames();
  assert.equal(wachtend(), 0);
});

test('een tweede module-instantie (HMR) behoudt de vlaggen en de lus blijft tekenen', async () => {
  opzet();
  viewport.active = true;
  viewport.dirty = false;
  const tweede = await import('./pdf-viewport.js?hmr=1');
  assert.equal(tweede.viewport, viewport, 'dezelfde singleton');
  assert.equal(viewport.active, true);
  assert.equal(viewport.dirty, false);
  assert.equal(wachtend(), 0);
  const voor = renders;
  viewport.dirty = true;
  assert.equal(wachtend(), 1);
  draaiFrames();
  assert.equal(renders, voor + 1, 'de lus die het canvas bezit tekent');
  assert.equal(wachtend(), 0);
});

test('na destroyViewport plant niets meer', () => {
  opzet();
  vp.destroyViewport();
  assert.equal(viewport.active, false);
  viewport.dirty = true;
  viewport.active = true;
  assert.equal(wachtend(), 0);
  viewport.active = false;
});
