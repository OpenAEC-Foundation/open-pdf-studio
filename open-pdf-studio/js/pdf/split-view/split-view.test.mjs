// Gesplitste weergave (#715): twee panelen op hetzelfde document. Eén model
// (annotaties, selectie, ongedaan maken, opslaan), per paneel een eigen
// weergavestand. Hier de pure logica: standen per paneel, wisselen van
// actief paneel, aan/uit, routering van klikken, het opnieuw tekenen van het
// andere paneel, synchroon scrollen/zoomen en paginabewerkingen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as S from './split-staat.js';
import { op, meld, heeftLuisteraars, paneelVoorDoel, routeerGebeurtenis } from './split-haken.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const JS = join(HIER, '../..');
const lees = (rel) => readFileSync(join(JS, rel), 'utf8');

const vpStand = (extra = {}) => ({
  modus: 'single',
  page: 3,
  scale: 1.2,
  viewRotation: 0,
  scrollLeft: 0,
  scrollTop: 0,
  cssW: 800,
  cssH: 600,
  vp: {
    zoom: 1.2, offsetX: 40, offsetY: -100, pageNum: 3, pageW: 842, pageH: 595,
    originX: 0, originY: 0, rotation: 0, viewRotation: 0, pageType: 'raster',
    verankerd: true, strikt: false, tile: null, tileMeta: null,
  },
  layout: null,
  bevroren: null,
  ...extra,
});

const kolom = (n, { w = 600, h = 800, pad = 20, gat = 40, x = 100 } = {}) => ({
  rects: Array.from({ length: n }, (_, i) => ({ page: i + 1, x, y: pad + i * (h + gat), w, h })),
  scale: 1,
  viewRotation: 0,
  breedte: w + 2 * x,
  hoogte: pad + n * h + (n - 1) * gat + 20,
  onder: 20,
  pad,
  gemeten: true,
});

const layoutStand = (extra = {}) => ({
  modus: 'continuous', page: 1, scale: 1, viewRotation: 0, scrollLeft: 0, scrollTop: 0,
  cssW: 800, cssH: 600, vp: null, layout: kolom(40), bevroren: null, ...extra,
});

// ── Standen per paneel ───────────────────────────────────────────────────

test('splitsen: het tweede paneel begint op de pagina en zoom van de viewer, paneel 0 blijft actief', () => {
  const live = vpStand();
  const st = S.maakSplitStaat('vertical', live);
  assert.equal(st.actief, 0);
  assert.equal(st.richting, 'vertical');
  assert.equal(st.verhouding, 0.5);
  assert.equal(st.sync, false, 'Sync staat standaard uit');
  assert.equal(st.stand.page, 3);
  assert.equal(st.stand.vp.zoom, 1.2);
  assert.equal(S.maakSplitStaat('onzin', live).richting, 'vertical');
  assert.equal(S.maakSplitStaat('horizontal', live).richting, 'horizontal');
});

test('elk paneel houdt zijn eigen pagina, zoom, scroll en weergaverotatie', () => {
  const live = vpStand();
  const st = S.maakSplitStaat('vertical', live);
  // De viewer bladert naar pagina 40 en zoomt in: het andere paneel blijft.
  live.page = 40;
  live.vp.zoom = 4;
  live.vp.offsetX = -2000;
  live.viewRotation = 90;
  assert.equal(st.stand.page, 3);
  assert.equal(st.stand.vp.zoom, 1.2);
  assert.equal(st.stand.vp.offsetX, 40);
  assert.equal(st.stand.viewRotation, 0);
  assert.equal(S.standVanPaneel(st, 0, live).page, 40);
  assert.equal(S.standVanPaneel(st, 1, live).page, 3);
});

test('dezelfde pagina in beide panelen: passend in het ene, 400% in het andere', () => {
  const live = vpStand({ page: 7 });
  live.vp.pageNum = 7;
  const st = S.maakSplitStaat('vertical', live);
  const passend = S.passendInPaneel(842, 595, 800, 600);
  st.stand.vp = { ...st.stand.vp, ...passend };
  live.vp = S.zoomViewportRond(live.vp, 4 / live.vp.zoom, 400, 300);
  assert.equal(S.standVanPaneel(st, 0, live).page, S.standVanPaneel(st, 1, live).page);
  assert.ok(Math.abs(live.vp.zoom - 4) < 1e-9);
  assert.ok(Math.abs(st.stand.vp.zoom - passend.zoom) < 1e-9);
});

test('kopieerStand is diep genoeg: aanpassen van de kopie raakt het origineel niet', () => {
  const a = layoutStand();
  const b = S.kopieerStand(a);
  b.layout.rects[0].y = 999;
  b.vp = { zoom: 2 };
  assert.equal(a.layout.rects[0].y, 20);
  assert.equal(a.vp, null);
  assert.equal(S.kopieerStand(null), null);
});

// ── Wisselen van actief paneel ───────────────────────────────────────────

test('klik in het andere paneel: de standen wisselen en de viewer neemt die van het andere paneel aan', () => {
  const links = vpStand({ page: 3 });
  const st = S.maakSplitStaat('vertical', links);
  st.stand = vpStand({ page: 40 });
  st.stand.vp.zoom = 0.4;
  const { staat, aankomst } = S.wisselActiefPaneel(st, links);
  assert.equal(staat.actief, 1);
  assert.equal(aankomst.page, 40, 'de viewer gaat naar de pagina van het aangeklikte paneel');
  assert.equal(aankomst.vp.zoom, 0.4);
  assert.equal(staat.stand.page, 3, 'het verlaten paneel bewaart zijn eigen stand');
  // En terug: alles weer zoals het was.
  const terug = S.wisselActiefPaneel(staat, aankomst);
  assert.equal(terug.staat.actief, 0);
  assert.equal(terug.aankomst.page, 3);
  assert.equal(terug.staat.stand.page, 40);
  assert.equal(terug.staat.richting, 'vertical');
});

test('opheffen houdt de pagina en zoom van het actieve paneel; opnieuw splitsen begint daar', () => {
  const live = vpStand({ page: 12 });
  live.vp.zoom = 2.5;
  const st = S.maakSplitStaat('horizontal', live);
  st.stand = vpStand({ page: 99 });
  const blijft = S.hefSplitsingOp(st, live);
  assert.equal(blijft, live);
  assert.equal(blijft.page, 12);
  const opnieuw = S.maakSplitStaat('vertical', blijft);
  assert.equal(opnieuw.stand.page, 12);
  assert.equal(opnieuw.stand.vp.zoom, 2.5);
  assert.equal(opnieuw.actief, 0);
});

test('verhouding van de scheidingslijn: geklemd, standaard 50/50', () => {
  assert.equal(S.klemVerhouding(0.5), 0.5);
  assert.equal(S.klemVerhouding(0.01), S.MIN_VERHOUDING);
  assert.equal(S.klemVerhouding(2), S.MAX_VERHOUDING);
  assert.equal(S.klemVerhouding('x'), 0.5);
});

// ── Routering: een klik in het tweede paneel bereikt geen gereedschap ────

const el = (pad) => ({ closest: (sel) => (pad.includes(sel) ? {} : null) });

test('paneelVoorDoel herkent tweede paneel, scheidingslijn en viewer', () => {
  assert.equal(paneelVoorDoel(el(['#split-pane'])), 'spiegel');
  assert.equal(paneelVoorDoel(el(['#split-divider'])), 'scheiding');
  assert.equal(paneelVoorDoel(el(['#pdf-container'])), 'live');
  assert.equal(paneelVoorDoel(el([])), null);
  assert.equal(paneelVoorDoel(null), null);
});

test('pointerdown in het tweede paneel: tegenhouden en dat paneel actief maken', () => {
  const r = routeerGebeurtenis('pointerdown', 'spiegel', false);
  assert.deepEqual(r, { tegenhouden: true, activeren: true, drukInSpiegel: true });
  const m = routeerGebeurtenis('mousedown', 'spiegel', true);
  assert.equal(m.tegenhouden, true);
  assert.equal(m.activeren, false, 'één activering per druk');
  for (const t of ['pointerup', 'mouseup', 'dblclick', 'contextmenu']) {
    assert.equal(routeerGebeurtenis(t, 'spiegel', true).tegenhouden, true, t);
  }
  // Een gewone klik mag door: menu's en pop-ups sluiten bij een klik ernaast.
  assert.equal(routeerGebeurtenis('click', 'spiegel', true).tegenhouden, false);
});

test('in de viewer gaat alles gewoon door naar de gereedschappen', () => {
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointermove']) {
    const r = routeerGebeurtenis(t, 'live', false);
    assert.equal(r.tegenhouden, false, t);
    assert.equal(r.activeren, false, t);
  }
  assert.equal(routeerGebeurtenis('pointerdown', 'scheiding', false).tegenhouden, false, 'scheidingslijn sleept zelf');
});

test('een sleep die in de viewer begint en boven het andere paneel eindigt, eindigt gewoon', () => {
  const neer = routeerGebeurtenis('pointerdown', 'live', false);
  assert.equal(neer.drukInSpiegel, false);
  assert.equal(routeerGebeurtenis('pointerup', 'spiegel', neer.drukInSpiegel).tegenhouden, false);
  assert.equal(routeerGebeurtenis('mouseup', 'spiegel', neer.drukInSpiegel).tegenhouden, false);
  // Bewegen boven het andere paneel blijft doorgaan (voorbeeldlijn van een gereedschap).
  assert.equal(routeerGebeurtenis('pointermove', 'spiegel', false).tegenhouden, false);
});

// ── Het andere paneel tekent mee ──────────────────────────────────────────

test('meldpunt: zonder luisteraar doet een melding niets; met luisteraar komt ze aan; een fout breekt niets', () => {
  assert.equal(heeftLuisteraars('testGebeurtenis'), false);
  meld('testGebeurtenis', 1); // geen fout
  const ontvangen = [];
  const stop1 = op('testGebeurtenis', () => { throw new Error('kapot'); });
  const stop2 = op('testGebeurtenis', (g) => ontvangen.push(g));
  const waarschuw = console.warn;
  console.warn = () => {};
  try { meld('testGebeurtenis', 42); } finally { console.warn = waarschuw; }
  assert.deepEqual(ontvangen, [42]);
  stop1(); stop2();
  assert.equal(heeftLuisteraars('testGebeurtenis'), false);
});

test('opnieuw tekenen bij een annotatiewijziging, niet bij elke frame van pannen in de viewer', () => {
  const basis = { beeld: 'p3|1.2|40|-100', inhoud: '5|0||2|0|0' };
  assert.equal(S.moetSpiegelHertekenen(null, basis), true, 'eerste melding');
  // Pannen/zoomen in de viewer: beeld anders, inhoud gelijk → niet.
  assert.equal(S.moetSpiegelHertekenen(basis, { ...basis, beeld: 'p3|1.2|10|-100' }), false);
  // Een sleep (verplaatsen/vergroten): beeld gelijk → wel.
  assert.equal(S.moetSpiegelHertekenen(basis, { ...basis }), true);
  // Tekenen of verwijderen: aantal annotaties anders → wel, ook tijdens pannen.
  assert.equal(S.moetSpiegelHertekenen(basis, { beeld: 'x', inhoud: '6|0||3|0|0' }), true);
  // Ctrl+Z: de ongedaan-maken-stapel verandert → wel.
  assert.equal(S.moetSpiegelHertekenen(basis, { beeld: 'x', inhoud: '5|0||1|1|0' }), true);
  // Selectie in het ene paneel is ook die van het andere.
  assert.equal(S.moetSpiegelHertekenen(basis, { beeld: 'x', inhoud: '5|1|a7|2|0|0' }), true);
});

test('de viewer meldt elke hertekening van annotaties aan het meldpunt', () => {
  const src = lees('annotations/rendering.js');
  assert.match(src, /import \{ meld as meldSplit \} from '\.\.\/pdf\/split-view\/split-haken\.js';/);
  const redraw = src.slice(src.indexOf('export function redrawAnnotations('), src.indexOf('// Render annotations for a specific page (continuous mode)'));
  assert.match(redraw, /meldSplit\('annotatiesHertekend'\);\s*\}\s*$/);
  const cont = src.slice(src.indexOf('export function redrawContinuous('));
  assert.match(cont, /meldSplit\('annotatiesHertekend'\);/);
  const renderer = lees('pdf/renderer.js');
  assert.match(renderer, /meldSplit\('weergaveGerenderd'\)/);
  assert.match(lees('pdf/page-manager.js'), /meldSplit\('paginaStructuur', \{ doc, pageMapping/);
  const tabs = lees('ui/chrome/tabs.js');
  assert.match(tabs, /meldSplit\('actiefDocument'/);
  assert.match(tabs, /meldSplit\('documentGesloten', doc\)/);
});

test('bevroren beeld van een paneel geldt alleen zolang de stand er precies bij past', () => {
  const s = vpStand();
  const k = S.beeldSleutel(s, { filePath: 'a.pdf', cssW: 800, cssH: 600 });
  assert.equal(S.beeldSleutel(S.kopieerStand(s), { filePath: 'a.pdf', cssW: 800, cssH: 600 }), k);
  assert.notEqual(S.beeldSleutel({ ...s, vp: S.verschuifViewport(s.vp, 0, 10) }, { filePath: 'a.pdf', cssW: 800, cssH: 600 }), k);
  assert.notEqual(S.beeldSleutel(s, { filePath: 'a.pdf', cssW: 801, cssH: 600 }), k);
  assert.notEqual(S.beeldSleutel(s, { filePath: 'b.pdf', cssW: 800, cssH: 600 }), k, 'na een paginabewerking (nieuw werkbestand)');
  const l = layoutStand();
  const kl = S.beeldSleutel(l, { filePath: 'a.pdf', cssW: 800, cssH: 600 });
  assert.notEqual(S.beeldSleutel({ ...l, scrollTop: 50 }, { filePath: 'a.pdf', cssW: 800, cssH: 600 }), kl);
});

// ── Paginabewerkingen ─────────────────────────────────────────────────────

test('na verwijderen gaat het paneel naar de dichtstbijzijnde overgebleven pagina', () => {
  // Pagina's 4 en 5 van 10 verwijderd: oud → nieuw.
  const toewijzing = { 1: 1, 2: 2, 3: 3, 4: null, 5: null, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8 };
  assert.equal(S.paginaNaStructuur(7, toewijzing, 8), 5, 'een andere pagina schuift mee');
  assert.equal(S.paginaNaStructuur(4, toewijzing, 8), 3, 'verwijderd: de vorige');
  assert.equal(S.paginaNaStructuur(5, toewijzing, 8), 4, 'verwijderd: de volgende ligt dichter');
  // Laatste pagina verwijderd.
  assert.equal(S.paginaNaStructuur(3, { 1: 1, 2: 2, 3: null }, 2), 2);
  // Eerste pagina verwijderd.
  assert.equal(S.paginaNaStructuur(1, { 1: null, 2: 1, 3: 2 }, 2), 1);
  // Verplaatsen: pagina 2 naar het eind.
  assert.equal(S.paginaNaStructuur(2, { 1: 1, 2: 3, 3: 2 }, 3), 3);
  // Zonder toewijzing (ongedaan maken, bijsnijden): binnen het bereik.
  assert.equal(S.paginaNaStructuur(12, null, 8), 8);
  assert.equal(S.klemPagina(0, 5), 1);
});

test('facingweergave: de spread rond een pagina', () => {
  assert.deepEqual(S.spreadPaginas(1, 10), [1]);
  assert.deepEqual(S.spreadPaginas(2, 10), [2, 3]);
  assert.deepEqual(S.spreadPaginas(3, 10), [2, 3]);
  assert.deepEqual(S.spreadPaginas(10, 10), [10]);
  assert.deepEqual(S.spreadPaginas(1, 1), [1], 'een document van één pagina kan gesplitst worden');
});

// ── Paneelmaat ────────────────────────────────────────────────────────────

test('een passend paneel blijft passend bij een andere paneelmaat; zelf gezoomd houdt zijn middelpunt', () => {
  const scherm = { w: 842, h: 595 };
  const passend = { ...vpStand().vp, ...S.passendInPaneel(842, 595, 1600, 600), verankerd: false };
  const half = S.pasViewportAanMaat(passend, { cssW: 1600, cssH: 600 }, { cssW: 800, cssH: 600 }, scherm);
  assert.ok(Math.abs(half.zoom - Math.min(800 / 842, 600 / 595)) < 1e-9);
  const zelf = vpStand().vp;
  const mid = { x: (800 / 2 - zelf.offsetX) / zelf.zoom, y: (600 / 2 - zelf.offsetY) / zelf.zoom };
  const smal = S.pasViewportAanMaat(zelf, { cssW: 800, cssH: 600 }, { cssW: 400, cssH: 600 }, scherm);
  assert.equal(smal.zoom, zelf.zoom);
  assert.ok(Math.abs((200 - smal.offsetX) / smal.zoom - mid.x) < 1e-9);
  assert.ok(Math.abs((300 - smal.offsetY) / smal.zoom - mid.y) < 1e-9);
  assert.equal(S.pasViewportAanMaat(zelf, { cssW: 800, cssH: 600 }, { cssW: 800, cssH: 600 }, scherm), zelf);
});

test('zoomen rond de cursor in een paneel: het punt onder de cursor blijft staan', () => {
  const vp = vpStand().vp;
  const px = 250, py = 120;
  const voor = { x: (px - vp.offsetX) / vp.zoom, y: (py - vp.offsetY) / vp.zoom };
  const na = S.zoomViewportRond(vp, 2, px, py);
  assert.equal(na.zoom, 2.4);
  assert.ok(Math.abs((px - na.offsetX) / na.zoom - voor.x) < 1e-9);
  assert.ok(Math.abs((py - na.offsetY) / na.zoom - voor.y) < 1e-9);
});

// ── Doorlopende weergave ──────────────────────────────────────────────────

test('herschikken van een kolom: pagina\'s schalen, tussenruimtes niet, gecentreerd in het paneel', () => {
  const l = kolom(3);
  const r = S.herschikLayout(l, { schaal: 2, breedte: 500 });
  assert.equal(r.rects[0].y, 20, 'ruimte boven blijft');
  assert.equal(r.rects[0].h, 1600);
  assert.equal(r.rects[1].y, 20 + 1600 + 40, 'gat tussen de pagina\'s blijft 40 px');
  assert.equal(r.rects[0].x, 0, 'breder dan het paneel: vanaf links');
  const s = S.herschikLayout(l, { schaal: 0.5, breedte: 1000 });
  assert.equal(s.rects[0].w, 300);
  assert.equal(s.rects[0].x, 350, 'smaller: gecentreerd');
  // Ongewijzigde schaal en breedte: precies hetzelfde (bevroren beeld en annotaties vallen samen).
  const z = S.herschikLayout(l, { schaal: 1, breedte: l.breedte });
  assert.deepEqual(z.rects, l.rects);
});

test('boekweergave: rijen van twee blijven naast elkaar', () => {
  const l = {
    rects: [
      { page: 1, x: 420, y: 20, w: 300, h: 400 },
      { page: 2, x: 100, y: 460, w: 300, h: 400 },
      { page: 3, x: 420, y: 460, w: 300, h: 400 },
    ],
    scale: 1, breedte: 820, onder: 20,
  };
  const r = S.herschikLayout(l, { schaal: 1, breedte: 820 });
  const p2 = r.rects.find((x) => x.page === 2);
  const p3 = r.rects.find((x) => x.page === 3);
  assert.equal(p2.y, p3.y);
  assert.equal(p3.x - (p2.x + p2.w), 20, 'kolomafstand blijft');
});

test('zoomen in een doorlopend paneel houdt de pagina onder de cursor op zijn plek', () => {
  const s = layoutStand({ scrollTop: 30 * 840 + 20 }); // pagina 31 bovenaan
  const px = 400, py = 300;
  const docY = s.scrollTop + py;
  const raak = s.layout.rects.find((r) => docY >= r.y && docY <= r.y + r.h);
  const fy = (docY - raak.y) / raak.h;
  const z = S.zoomLayoutStand(s, 2, px, py);
  assert.equal(z.scale, 2);
  const nr = z.layout.rects.find((r) => r.page === raak.page);
  assert.ok(Math.abs((z.scrollTop + py - nr.y) / nr.h - fy) < 1e-9);
  assert.equal(s.scale, 1, 'origineel ongemoeid');
});

test('pagina 3 in het ene paneel, pagina 40 in het andere: ieder scrolt zelf', () => {
  const links = layoutStand();
  const rechts = S.scrollNaarPagina(layoutStand(), 40);
  assert.equal(S.paginaInBeeld(links.layout, links.scrollLeft, links.scrollTop, 800, 600), 1);
  assert.equal(S.paginaInBeeld(rechts.layout, rechts.scrollLeft, rechts.scrollTop, 800, 600), 40);
  const zicht = S.zichtbarePaginas(rechts.layout, 0, rechts.scrollTop, 800, 600);
  assert.equal(zicht[0].page, 40);
  assert.equal(zicht[0].y, 0);
});

test('kolom van nul af na paginabewerkingen', () => {
  const l = S.bouwKolomLayout([{ page: 1, w: 300, h: 400 }, { page: 2, w: 500, h: 400 }], { schaal: 1, breedte: 400, pad: 20, gat: 40, onder: 20 });
  assert.equal(l.breedte, 500);
  assert.equal(l.rects[0].x, 100);
  assert.equal(l.rects[1].y, 460);
  assert.equal(l.hoogte, 20 + 400 + 40 + 400 + 20);
  assert.deepEqual(S.meetRuimtes(kolom(4).rects), { pad: 20, gat: 40 });
});

test('zichtbaar vak van een pagina in een paneel', () => {
  assert.deepEqual(S.zichtbaarVak(-50, 10, 200, 100, 800, 600), { x: 0, y: 10, w: 150, h: 100 });
  assert.equal(S.zichtbaarVak(900, 0, 100, 100, 800, 600), null);
});

// ── Sync ──────────────────────────────────────────────────────────────────

test('Sync: pannen en zoomen in de viewer beweegt het andere paneel mee, bladeren niet', () => {
  const a = { soort: 'viewport', pagina: 3, zoom: 1, x: 0, y: 0 };
  assert.deepEqual(S.syncDelta(a, { ...a, y: -50 }), { factor: 1, dx: 0, dy: 50 });
  assert.deepEqual(S.syncDelta(a, { ...a, zoom: 2, x: -100 }), { factor: 2, dx: 0, dy: 0 });
  assert.equal(S.syncDelta(a, { ...a, pagina: 4, y: -800 }), null, 'een paginawissel is geen scroll');
  assert.equal(S.syncDelta(a, { ...a }), null);
  assert.equal(S.syncDelta(null, a), null);
  const l = { soort: 'layout', pagina: 0, zoom: 1, x: 0, y: 100 };
  assert.deepEqual(S.syncDelta(l, { ...l, y: 160 }), { factor: 1, dx: 0, dy: 60 });

  const ander = vpStand();
  const geschoven = S.pasSyncToe(ander, { factor: 1, dx: 0, dy: 50 }, { cssW: 800, cssH: 600 });
  assert.equal(geschoven.vp.offsetY, ander.vp.offsetY - 50);
  const gezoomd = S.pasSyncToe(ander, { factor: 2, dx: 0, dy: 0 }, { cssW: 800, cssH: 600 });
  assert.equal(gezoomd.vp.zoom, 2.4);
  assert.equal(gezoomd.scale, 2.4);
  const doorlopend = S.pasSyncToe(layoutStand({ scrollTop: 100 }), { factor: 1, dx: 0, dy: 60 }, { cssW: 800, cssH: 600 });
  assert.equal(doorlopend.scrollTop, 160);
  assert.equal(ander.vp.zoom, 1.2, 'origineel ongemoeid');
});

// ── De enkelvoudige weergave blijft zoals hij was ─────────────────────────

test('zonder splitsing: #pdf-container met dezelfde ids, #split-host is display: contents', () => {
  const app = lees('solid/App.jsx');
  for (const id of ['pdf-container', 'canvas-wrapper', 'canvas-container', 'pdf-canvas', 'text-highlight-canvas', 'annotation-canvas', 'continuous-container']) {
    assert.equal((app.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.match(app, /<div id="split-host" class="split-host">\s*<div id="pdf-container">/);
  const css = readFileSync(join(JS, '../styles/layout.css'), 'utf8');
  assert.match(css, /\.split-host \{\s*display: contents;\s*\}/);
  assert.doesNotMatch(css, /\.main-view > #pdf-container/, 'kindselectors zouden in #split-host niet meer raken');
  assert.match(css, /\.main-view #pdf-container\.visible,\s*\n\.main-view > #placeholder \{\s*flex: 1;/);
  // Het tweede paneel, de scheidingslijn en het kader zijn alleen zichtbaar met splitsing.
  assert.match(css, /\.split-host > \.split-divider,\s*\n\.split-host > \.split-pane,\s*\n\.split-host > \.split-active-frame \{\s*display: none;/);
});

test('de klikrouteerder staat vroeg in main.js, na de twee modules die per se eerst moeten', () => {
  const main = lees('main.js');
  const imports = [...main.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports.slice(0, 3), ['./pdf/pdf-lib-snelheid.js', './core/oude-webview-start.js', './pdf/split-view/split-haken.js']);
});

// ── Vertalingen ──────────────────────────────────────────────────────────

const SLEUTELS = ['splitGroup', 'split', 'splitTitle', 'splitOptions', 'splitVertical', 'splitHorizontal', 'unsplit', 'splitSync', 'splitSyncTitle', 'splitDividerTitle'];

test('alle 40 talen hebben de teksten van de gesplitste weergave, echt vertaald', () => {
  const LOCALES = join(JS, 'i18n/locales');
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = JSON.parse(readFileSync(join(LOCALES, 'en', 'ribbon.json'), 'utf8')).view;
  const gekopieerd = [];
  for (const taal of talen) {
    const view = JSON.parse(readFileSync(join(LOCALES, taal, 'ribbon.json'), 'utf8')).view || {};
    for (const k of SLEUTELS) {
      assert.ok(typeof view[k] === 'string' && view[k].trim(), `${taal} view.${k}`);
      if (taal !== 'en' && view[k] === en[k]) gekopieerd.push(`${taal} view.${k}`);
    }
  }
  assert.deepEqual(gekopieerd, []);
});
