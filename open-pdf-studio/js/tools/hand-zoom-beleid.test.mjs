// Zoomen met het hand-gereedschap (#1161): het beleid en de bedrading.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  KLIK_MAX_PX, KLIK_MAX_MS, RECHTHOEK_MIN_PX,
  klikZoomRichting, rechthoekTussen, isZoomRechthoek,
  zoomVoorRechthoek, viewportStandVoorRechthoek, isHandZoomStart, maakHandZoomHandlers,
} from './hand-zoom-beleid.js';

const bron = (pad) => readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── Klik of sleep ─────────────────────────────────────────────────────────

test('een klik zoomt alleen met Ctrl of met de voorkeur aan', () => {
  const klik = { afstand: 0, duurMs: 80, ctrl: false, shift: false, klikZoomAan: false };
  assert.equal(klikZoomRichting(klik), 0, 'standaard doet een klik niets');
  assert.equal(klikZoomRichting({ ...klik, ctrl: true }), 1);
  assert.equal(klikZoomRichting({ ...klik, ctrl: true, shift: true }), -1);
  assert.equal(klikZoomRichting({ ...klik, klikZoomAan: true }), 1);
  assert.equal(klikZoomRichting({ ...klik, klikZoomAan: true, shift: true }), -1);
});

test('bewegen of lang vasthouden is geen klik; Alt blijft vrij', () => {
  const klik = { afstand: 0, duurMs: 80, ctrl: true, shift: false, klikZoomAan: true };
  assert.equal(klikZoomRichting({ ...klik, afstand: KLIK_MAX_PX }), 1);
  assert.equal(klikZoomRichting({ ...klik, afstand: KLIK_MAX_PX + 0.5 }), 0);
  assert.equal(klikZoomRichting({ ...klik, duurMs: KLIK_MAX_MS }), 1);
  assert.equal(klikZoomRichting({ ...klik, duurMs: KLIK_MAX_MS + 1 }), 0);
  assert.equal(klikZoomRichting({ ...klik, alt: true }), 0);
  assert.equal(klikZoomRichting({ ...klik, afstand: NaN }), 0);
});

// ── Zoomrechthoek ─────────────────────────────────────────────────────────

test('de rechthoek is genormaliseerd, in elke sleeprichting', () => {
  assert.deepEqual(rechthoekTussen({ x: 50, y: 80 }, { x: 10, y: 20 }), { x: 10, y: 20, w: 40, h: 60 });
  assert.deepEqual(rechthoekTussen({ x: 10, y: 20 }, { x: 50, y: 80 }), { x: 10, y: 20, w: 40, h: 60 });
  assert.equal(isZoomRechthoek({ x: 0, y: 0, w: RECHTHOEK_MIN_PX, h: RECHTHOEK_MIN_PX }), true);
  assert.equal(isZoomRechthoek({ x: 0, y: 0, w: RECHTHOEK_MIN_PX - 1, h: 200 }), false);
  assert.equal(isZoomRechthoek(null), false);
});

test('zoomrechthoek: de krapste as bepaalt de zoom, het midden komt in het midden', () => {
  // Beeld 800×600, rechthoek 200×100 linksboven: breedte laat ×4 toe, hoogte ×6.
  const z = zoomVoorRechthoek({ rechthoek: { x: 100, y: 50, w: 200, h: 100 }, beeldW: 800, beeldH: 600, zoom: 1.5, min: 0.05, max: 24 });
  assert.equal(z.factor, 4);
  assert.equal(z.zoom, 6);
  assert.deepEqual([z.ankerX, z.ankerY], [200, 100]);
  // Na de verankerde zoom staat het midden nog op (200,100); naar (400,300).
  assert.deepEqual([z.schuifX, z.schuifY], [-200, -200]);
});

test('zoomrechthoek respecteert de zoomgrenzen en weigert een te kleine rechthoek', () => {
  const basis = { rechthoek: { x: 0, y: 0, w: 10, h: 10 }, beeldW: 1000, beeldH: 1000, zoom: 8 };
  const z = zoomVoorRechthoek({ ...basis, min: 0.05, max: 24 });
  assert.equal(z.zoom, 24);
  assert.equal(z.factor, 3);
  assert.equal(zoomVoorRechthoek({ ...basis, rechthoek: { x: 0, y: 0, w: 3, h: 300 }, min: 0.05, max: 24 }), null);
  assert.equal(zoomVoorRechthoek({ ...basis, beeldW: 0, min: 0.05, max: 24 }), null);
});

test('viewport-stand: het paginapunt in het midden van de rechthoek komt in het midden van het canvas', () => {
  const voor = { zoom: 2, offsetX: 30, offsetY: -40 };
  const rechthoek = { x: 300, y: 200, w: 100, h: 50 };
  const na = viewportStandVoorRechthoek({ rechthoek, canvasW: 1000, canvasH: 800, ...voor, min: 0.0625, max: 64 });
  assert.equal(na.zoom, 20); // ×10 (breedte), hoogte zou ×16 toelaten
  // Paginapunt onder het midden van de rechthoek vóór de zoom …
  const px = (350 - voor.offsetX) / voor.zoom;
  const py = (225 - voor.offsetY) / voor.zoom;
  // … staat erna in het midden van het canvas.
  assert.ok(Math.abs(px * na.zoom + na.offsetX - 500) < 1e-9);
  assert.ok(Math.abs(py * na.zoom + na.offsetY - 400) < 1e-9);
  // De hele rechthoek past: zijn linkerrand ligt binnen het canvas.
  const links = ((300 - voor.offsetX) / voor.zoom) * na.zoom + na.offsetX;
  assert.ok(links >= 0 && links <= 1000);
});

test('viewport-stand bij de zoomgrens houdt het midden vast', () => {
  const na = viewportStandVoorRechthoek({ rechthoek: { x: 100, y: 100, w: 10, h: 10 }, canvasW: 1000, canvasH: 1000, zoom: 32, offsetX: 0, offsetY: 0, min: 0.0625, max: 64 });
  assert.equal(na.zoom, 64);
  assert.equal((105 / 32) * 64 + na.offsetX, 500);
});

// ── Waar het gebaar mag beginnen ──────────────────────────────────────────

function doel(treffers = ['#pdf-container'], extra = {}) {
  return { closest: (s) => (treffers.some((t) => s.split(',').map((x) => x.trim()).includes(t)) ? {} : null), ...extra };
}
const pagina = doel();

test('alleen de linkermuisknop van een muis, in de PDF-weergave', () => {
  assert.equal(isHandZoomStart({ button: 0, pointerType: 'mouse', target: pagina }), true);
  assert.equal(isHandZoomStart({ button: 0, target: pagina }), true, 'event zonder pointerType');
  assert.equal(isHandZoomStart({ button: 1, pointerType: 'mouse', target: pagina }), false, 'middelknop');
  assert.equal(isHandZoomStart({ button: 2, pointerType: 'mouse', target: pagina }), false, 'rechterknop');
  assert.equal(isHandZoomStart({ button: 0, pointerType: 'touch', target: pagina }), false, 'aanraking');
  assert.equal(isHandZoomStart({ button: 0, pointerType: 'pen', target: pagina }), false, 'pen');
  assert.equal(isHandZoomStart({ button: 0, pointerType: 'mouse', target: doel([]) }), false, 'buiten de weergave');
  assert.equal(isHandZoomStart({ button: 0, pointerType: 'mouse', target: null }), false);
});

test('links, formuliervelden, knoppen en de vergelijkweergave houden hun eigen klik', () => {
  for (const eigen of ['.linkLayer .pdf-link', '.formLayer', 'a[href]', 'button', 'select', 'input', 'textarea', '[contenteditable="true"]', '.compare-view']) {
    assert.equal(isHandZoomStart({ button: 0, pointerType: 'mouse', target: doel(['#pdf-container', eigen]) }), false, eigen);
  }
  assert.equal(isHandZoomStart({ button: 0, pointerType: 'mouse', target: doel(['#pdf-container'], { isContentEditable: true }) }), false);
});

// ── De toestandsmachine ───────────────────────────────────────────────────

function opstelling(over = {}) {
  const s = { actief: true, pan: false, klikZoom: false, stappen: [], rechthoeken: [], getoond: [], verborgen: 0, afgebroken: 0, ...over };
  const h = maakHandZoomHandlers({
    actief: () => s.actief,
    handPanLoopt: () => s.pan,
    breekPanAf: () => { s.afgebroken++; s.pan = false; },
    klikZoomAan: () => s.klikZoom,
    ctrl: (e) => !!e.ctrlKey,
    zoomStap: (x, y, richting) => s.stappen.push({ x, y, richting }),
    zoomRechthoek: (r) => s.rechthoeken.push(r),
    toonRechthoek: (r) => s.getoond.push(r),
    verbergRechthoek: () => { s.verborgen++; },
  });
  const ev = (x, y, t, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, timeStamp: t, target: pagina, ...extra });
  // Indrukken; de hand begint daarna (zoals in de app) zijn pan.
  const neer = (x, y, t, extra = {}, panStart = true) => { h.onPointerDown(ev(x, y, t, extra)); if (panStart) s.pan = true; };
  return { s, h, ev, neer };
}

test('slepen met de hand blijft pannen: geen zoom, de pan wordt niet afgebroken', () => {
  const { s, h, ev, neer } = opstelling({ klikZoom: true });
  neer(100, 100, 0);
  h.onPointerMove(ev(140, 130, 50));
  h.onPointerUp(ev(140, 130, 120, { buttons: 0 }));
  assert.deepEqual(s.stappen, []);
  assert.equal(s.afgebroken, 0);
  assert.deepEqual(s.getoond, []);
});

test('een klik zonder Ctrl doet standaard niets en zoomt met de voorkeur aan', () => {
  const uit = opstelling();
  uit.neer(100, 100, 0);
  uit.h.onPointerUp(uit.ev(101, 100, 90, { buttons: 0 }));
  assert.deepEqual(uit.s.stappen, []);

  const aan = opstelling({ klikZoom: true });
  aan.neer(100, 100, 0);
  aan.h.onPointerMove(aan.ev(102, 101, 40));
  aan.h.onPointerUp(aan.ev(102, 101, 90, { buttons: 0 }));
  assert.deepEqual(aan.s.stappen, [{ x: 100, y: 100, richting: 1 }], 'zoomt op het aangeklikte punt');
  assert.equal(aan.s.afgebroken, 1, 'de pan van de klik is opgeruimd vóór het zoomen');

  const terug = opstelling({ klikZoom: true });
  terug.neer(100, 100, 0, { shiftKey: true });
  terug.h.onPointerUp(terug.ev(100, 100, 90, { buttons: 0, shiftKey: true }));
  assert.deepEqual(terug.s.stappen, [{ x: 100, y: 100, richting: -1 }]);
});

test('heen en terug slepen of lang vasthouden is geen klik', () => {
  const heenTerug = opstelling({ klikZoom: true });
  heenTerug.neer(100, 100, 0);
  heenTerug.h.onPointerMove(heenTerug.ev(160, 100, 40));
  heenTerug.h.onPointerMove(heenTerug.ev(100, 100, 80));
  heenTerug.h.onPointerUp(heenTerug.ev(100, 100, 120, { buttons: 0 }));
  assert.deepEqual(heenTerug.s.stappen, []);

  const lang = opstelling({ klikZoom: true });
  lang.neer(100, 100, 0);
  lang.h.onPointerUp(lang.ev(100, 100, KLIK_MAX_MS + 200, { buttons: 0 }));
  assert.deepEqual(lang.s.stappen, []);
});

test('Ctrl + klik zoomt in, Ctrl + Shift + klik zoomt uit, ook met de voorkeur uit', () => {
  const a = opstelling();
  a.neer(200, 150, 0, { ctrlKey: true });
  a.h.onPointerUp(a.ev(200, 150, 60, { buttons: 0, ctrlKey: true }));
  assert.deepEqual(a.s.stappen, [{ x: 200, y: 150, richting: 1 }]);

  const b = opstelling();
  b.neer(200, 150, 0, { ctrlKey: true, shiftKey: true });
  b.h.onPointerUp(b.ev(200, 150, 60, { buttons: 0 }));
  assert.deepEqual(b.s.stappen, [{ x: 200, y: 150, richting: -1 }]);
});

test('een klik op een annotatie of link (de hand begint geen pan) zoomt niet', () => {
  const { s, h, ev, neer } = opstelling({ klikZoom: true });
  neer(100, 100, 0, { ctrlKey: true }, false);
  h.onPointerUp(ev(100, 100, 60, { buttons: 0 }));
  assert.deepEqual(s.stappen, []);
  // Ctrl + slepen op een annotatie wordt ook geen rechthoek.
  neer(100, 100, 100, { ctrlKey: true }, false);
  h.onPointerMove(ev(180, 180, 150));
  h.onPointerUp(ev(180, 180, 200, { buttons: 0 }));
  assert.deepEqual(s.getoond, []);
  assert.deepEqual(s.rechthoeken, []);
});

test('Ctrl + slepen neemt de pan over en zoomt naar de rechthoek', () => {
  const { s, h, ev, neer } = opstelling();
  neer(300, 200, 0, { ctrlKey: true });
  h.onPointerMove(ev(301, 200, 10));
  assert.equal(s.afgebroken, 1, 'de pan stopt bij de eerste beweging, vóór hij iets verschuift');
  assert.equal(h.rechthoekActief(), true);
  h.onPointerMove(ev(200, 120, 60));
  assert.deepEqual(s.getoond.at(-1), { x: 200, y: 120, w: 100, h: 80 });
  // Ctrl al losgelaten vóór de muisknop: de rechthoek geldt nog.
  h.onPointerUp(ev(200, 120, 90, { buttons: 0, ctrlKey: false }));
  assert.deepEqual(s.rechthoeken, [{ x: 200, y: 120, w: 100, h: 80 }]);
  assert.deepEqual(s.stappen, []);
  assert.equal(s.verborgen, 1);
  assert.equal(h.rechthoekActief(), false);
});

test('een Ctrl-sleep van een paar pixels telt als Ctrl + klik; een smalle strook doet niets', () => {
  const klein = opstelling();
  klein.neer(300, 200, 0, { ctrlKey: true });
  klein.h.onPointerMove(klein.ev(302, 201, 20));
  klein.h.onPointerUp(klein.ev(302, 201, 60, { buttons: 0 }));
  assert.deepEqual(klein.s.rechthoeken, []);
  assert.deepEqual(klein.s.stappen, [{ x: 300, y: 200, richting: 1 }]);

  const strook = opstelling();
  strook.neer(300, 200, 0, { ctrlKey: true });
  strook.h.onPointerMove(strook.ev(500, 203, 20));
  strook.h.onPointerUp(strook.ev(500, 203, 60, { buttons: 0 }));
  assert.deepEqual(strook.s.rechthoeken, []);
  assert.deepEqual(strook.s.stappen, []);
  assert.equal(strook.s.verborgen, 1);
});

test('Escape, een gemist loslaten, pointercancel en focusverlies breken de rechthoek af', () => {
  for (const afbreken of [
    (h) => h.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }),
    (h, ev) => h.onPointerMove(ev(260, 260, 70, { buttons: 0 })),
    (h, ev) => h.onPointerCancel(ev(260, 260, 70)),
    (h) => h.reset(),
  ]) {
    const { s, h, ev, neer } = opstelling();
    neer(100, 100, 0, { ctrlKey: true });
    h.onPointerMove(ev(250, 250, 50));
    afbreken(h, ev);
    assert.equal(h.rechthoekActief(), false);
    assert.equal(s.verborgen, 1);
    h.onPointerUp(ev(250, 250, 90, { buttons: 0 }));
    assert.deepEqual(s.rechthoeken, []);
    assert.deepEqual(s.stappen, []);
  }
});

test('Escape zonder rechthoek blijft van de rest van de app', () => {
  const { h, neer } = opstelling();
  neer(100, 100, 0);
  let gestopt = false;
  h.onKeyDown({ key: 'Escape', preventDefault() { gestopt = true; }, stopPropagation() { gestopt = true; } });
  assert.equal(gestopt, false);
});

test('niet actief (ander gereedschap, spatie-pan, presentatie, dialoog): geen gebaar', () => {
  const { s, h, ev, neer } = opstelling({ actief: false, klikZoom: true });
  neer(100, 100, 0, { ctrlKey: true });
  h.onPointerMove(ev(200, 200, 30));
  h.onPointerUp(ev(200, 200, 60, { buttons: 0 }));
  assert.deepEqual(s.stappen, []);
  assert.deepEqual(s.rechthoeken, []);
  assert.equal(s.afgebroken, 0, 'de pan van iemand anders blijft met rust');
});

test('een andere aanwijzer of een middelknop mengt zich niet in het gebaar', () => {
  const { s, h, ev, neer } = opstelling({ klikZoom: true });
  neer(100, 100, 0);
  h.onPointerUp(ev(100, 100, 50, { pointerId: 2, buttons: 0 }));
  assert.deepEqual(s.stappen, []);
  h.onPointerUp(ev(100, 100, 60, { buttons: 0 }));
  assert.equal(s.stappen.length, 1);
  // Middelknop: begint geen gebaar, ook al pant hij.
  h.onPointerDown(ev(100, 100, 100, { button: 1, buttons: 4 }));
  s.pan = true;
  h.onPointerUp(ev(100, 100, 150, { button: 1, buttons: 0 }));
  assert.equal(s.stappen.length, 1);
});

// ── Bedrading, voorkeur en vertalingen ────────────────────────────────────

test('voorkeur handClickZoom staat standaard uit, heeft een type en een vinkje', () => {
  assert.match(bron('core/constants.ts'), /handClickZoom: false,/);
  assert.match(bron('types/preferences.ts'), /handClickZoom: boolean;/);
  const tab = bron('solid/components/preferences/BehaviorTab.jsx');
  assert.match(tab, /p\.handClickZoom\[1\]\(e\.target\.checked\)/);
  assert.match(tab, /t\('behavior\.handClickZoom'\)/);
  assert.match(tab, /t\('behavior\.handClickZoomHint'\)/);
});

test('elke taal heeft een eigen vertaling van de voorkeur en de toelichting', () => {
  const LOCALES = new URL('../i18n/locales/', import.meta.url);
  const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, LOCALES), 'utf8'));
  const en = lees('en').behavior;
  for (const sleutel of ['handClickZoom', 'handClickZoomHint']) {
    assert.ok(en[sleutel]);
    for (const taal of readdirSync(LOCALES)) {
      const v = lees(taal).behavior?.[sleutel];
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${taal} mist ${sleutel}`);
      if (taal !== 'en') assert.notEqual(v, en[sleutel], `${taal}: ${sleutel} is niet vertaald`);
    }
  }
});

test('de bedrading luistert in de capture-fase en wordt bij het opstarten geïnstalleerd', () => {
  const s = bron('tools/hand-zoom.js');
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown']) {
    assert.match(s, new RegExp(`window\\.addEventListener\\('${type}', [^\\n]*capture: true`), type);
  }
  assert.match(s, /window\.addEventListener\('blur', h\.reset\)/);
  assert.match(s, /state\.currentTool === 'hand'/);
  assert.match(s, /handClickZoom === true/);
  assert.match(s, /!isPresentatie\(\)/);
  assert.match(s, /!interactionState\.spacePanHeld/);
  // De cursor blijft van js/ui/cursor.js.
  assert.doesNotMatch(s, /\.style\.cursor/);
  assert.match(bron('ui/setup.js'), /installeerHandZoom\(\);/);
  assert.match(bron('pdf/renderer.js'), /export async function zoomEnkelePaginaNaar\(/);
});

test('de zoomrechthoek gebruikt themakleuren en laat de muis door', () => {
  const css = readFileSync(new URL('../../styles/layout.css', import.meta.url), 'utf8');
  const blok = css.slice(css.indexOf('#hand-zoom-rechthoek {'));
  assert.ok(blok.length > 0);
  const regel = blok.slice(0, blok.indexOf('}'));
  assert.match(regel, /pointer-events: none/);
  assert.match(regel, /var\(--theme-accent/);
  assert.doesNotMatch(regel, /cursor|border-radius/);
});
