// Tekenen op een pagina in de weergave naast elkaar (#506).
//
// Elke pagina in de doorlopende weergave (ook boek en naast elkaar) heeft een
// annotatiecanvas dat alleen het zichtbare deel van de pagina dekt, plus een
// marge. Dat canvas krijgt de muisinvoer van de tekengereedschappen; buiten
// de uitsnede valt een klik op de tekstlaag en tekent er niets. Na het
// scrollen moet de uitsnede dus mee. In de weergave naast elkaar stopte de
// scrollafhandeling meteen (de huidige pagina is daar het spread-anker), en
// bleef de uitsnede staan: een rechthoek getekend op een deel van de pagina
// dat pas na het scrollen in beeld kwam, landde niet op de aangeklikte plek.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { annotatieUitsnede, naScrollen, UITSNEDE_MARGE_PX } = await import('./annotatie-uitsnede.js');
const { weergaveNaarPagina, weergaveRotatie } = await import('./weergave-ruimte.js');

const HIER = dirname(fileURLToPath(import.meta.url));
const lees = (rel) => readFileSync(join(HIER, rel), 'utf8').replace(/\r\n/g, '\n');

// Een A4 op schaal 1,25 als rechterpagina van een spread: de linkerpagina
// staat ervoor, dus de paginacontainer begint ver rechts in het venster.
const SCHAAL = 1.25;
const PAGINA = { breedte: 595, hoogte: 842 };
const VENSTER = { left: 245, top: 180, right: 1345, bottom: 880 };

function paginaRect(links, boven, breedte = PAGINA.breedte * SCHAAL, hoogte = PAGINA.hoogte * SCHAAL) {
  return { left: links, top: boven, width: breedte, height: hoogte, right: links + breedte, bottom: boven + hoogte };
}

const binnen = (u, px, py) => px >= u.x && px <= u.x + u.breedte && py >= u.y && py <= u.y + u.hoogte;

test('een pagina die geheel in beeld staat, krijgt een uitsnede over de hele pagina', () => {
  const venster = { left: 0, top: 0, right: 3000, bottom: 3000 };
  const r = paginaRect(100, 100);
  assert.deepEqual(annotatieUitsnede(venster, r, r.width, r.height), { x: 0, y: 0, breedte: r.width, hoogte: r.height });
});

test('een pagina buiten beeld krijgt een minimaal canvas linksboven', () => {
  const r = paginaRect(5000, 100);
  assert.deepEqual(annotatieUitsnede(VENSTER, r, r.width, r.height), { x: 0, y: 0, breedte: 2, hoogte: 2 });
});

test('zonder bruikbare paginarechthoek de hele pagina', () => {
  assert.deepEqual(annotatieUitsnede(VENSTER, { left: 0, top: 0, width: 0, height: 0 }, 100, 200), { x: 0, y: 0, breedte: 100, hoogte: 200 });
});

test('de uitsnede is het zichtbare deel plus de marge, afgekapt op de pagina', () => {
  const r = paginaRect(1000, 180);
  const u = annotatieUitsnede(VENSTER, r, r.width, r.height);
  assert.equal(u.x, 0);
  assert.equal(u.y, 0);
  assert.equal(u.breedte, VENSTER.right - 1000 + UITSNEDE_MARGE_PX);
  assert.equal(u.hoogte, VENSTER.bottom - 180 + UITSNEDE_MARGE_PX);
});

test('na het scrollen dekt alleen een bijgewerkte uitsnede de plek waar de gebruiker klikt', () => {
  // Spread geopend: de rechterpagina staat met zijn bovenkant in beeld.
  const voor = paginaRect(1000, 180);
  const oud = annotatieUitsnede(VENSTER, voor, voor.width, voor.height);
  // Naar beneden en naar rechts gescrold: nu staat het onderste deel van de
  // pagina in beeld. Klik op paginapunt (300, 800).
  const na = paginaRect(400, -500);
  const klik = { x: na.left + 300 * SCHAAL, y: na.top + 800 * SCHAAL };
  assert.ok(klik.x > VENSTER.left && klik.x < VENSTER.right && klik.y > VENSTER.top && klik.y < VENSTER.bottom,
    'de klik ligt in het venster');
  const klikOpPagina = [klik.x - na.left, klik.y - na.top];
  assert.equal(binnen(oud, ...klikOpPagina), false, 'de oude uitsnede dekt de klik niet: hij viel op de tekstlaag');
  const nieuw = annotatieUitsnede(VENSTER, na, na.width, na.height);
  assert.equal(binnen(nieuw, ...klikOpPagina), true);
});

test('na het scrollen lopen de uitsnedes in elke doorlopende variant mee, ook naast elkaar', () => {
  assert.deepEqual(naScrollen({ viewMode: 'continuous' }), { paginaVolgen: true, uitsnedesBijwerken: true });
  assert.deepEqual(naScrollen({ viewMode: 'continuous', bookSpread: true }), { paginaVolgen: true, uitsnedesBijwerken: true });
  // Naast elkaar: de huidige pagina blijft het spread-anker.
  assert.deepEqual(naScrollen({ viewMode: 'continuous', facingSpread: true }), { paginaVolgen: false, uitsnedesBijwerken: true });
  assert.deepEqual(naScrollen({ viewMode: 'single' }), { paginaVolgen: false, uitsnedesBijwerken: false });
  assert.deepEqual(naScrollen(null), { paginaVolgen: false, uitsnedesBijwerken: false });
});

test('de renderer werkt de uitsnedes na het scrollen bij, ook in de weergave naast elkaar', () => {
  const bron = lees('renderer.js');
  const a = bron.indexOf('function _bindContinuousScrollSync(');
  const b = bron.indexOf('\n}', a);
  assert.ok(a > 0 && b > a);
  const fn = bron.slice(a, b);
  assert.doesNotMatch(fn, /facingSpread\)\s*return/, 'geen vroege return voor facing vóór het bijwerken');
  assert.match(fn, /naScrollen\(/);
  assert.match(fn, /uitsnedesBijwerken\)\s*reclipAllContinuousAnnotationCanvases\(\)/);
  assert.match(fn, /paginaVolgen\)\s*_syncCurrentPageFromScroll\(/);
  const c = bron.indexOf('function setupContinuousAnnotationCanvas(');
  assert.match(bron.slice(c, bron.indexOf('\n}', c)), /annotatieUitsnede\(/);
});

// ── Van scherm naar pagina op de rechterpagina van een spread ─────────────

let _nr = 0;
/** Laadt een bronbestand met elke statische import vervangen door een stub. */
async function laadMetStubs(relPad, stubs) {
  const namen = new Set();
  const bron = readFileSync(new URL(relPad, import.meta.url), 'utf8')
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, (_, wat) => {
      for (const deel of wat.replace(/[{}]/g, ' ').split(',')) {
        const naam = deel.trim().split(/\s+as\s+/).pop().trim();
        if (naam) namen.add(naam);
      }
      return '';
    })
    .replace(/^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/\bimport\((['"])[^'"]+\1\)/g, 'Promise.resolve({})');
  const sleutel = `__opdsUitsnedeStubs${_nr++}`;
  globalThis[sleutel] = stubs;
  const kop = [...namen].map((n) => `const ${n} = globalThis.${sleutel}.${n} ?? (() => undefined);`).join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(`${kop}\n${bron}`, 'utf8').toString('base64'));
}

/** Een paginacontainer met annotatiecanvas op de plek `rect` in het venster. */
function nepPagina(pageNum, rect) {
  const canvas = { dataset: { page: String(pageNum) }, getContext: () => ({}), getBoundingClientRect: () => rect };
  const cc = {
    dataset: { page: String(pageNum) },
    getBoundingClientRect: () => rect,
    querySelector: (s) => (s === '.annotation-canvas' ? canvas : null),
    closest: (s) => (s === '.canvas-container-cont' ? cc : null),
  };
  canvas.closest = (s) => (s === '.canvas-container-cont' ? cc : s === '.annotation-canvas' ? canvas : null);
  return { cc, canvas };
}

test('een klik op de rechterpagina van een spread landt in elke weergaverotatie op het bedoelde paginapunt', async () => {
  // Weergavepunt (500, 300) op de getoonde (eventueel gedraaide) pagina, en
  // waar dat in de paginaruimte hoort: rechtsom gedraaid staat de linker-
  // bovenhoek van het scherm op paginapunt (0, hoogte), enzovoort.
  const W = PAGINA.breedte, H = PAGINA.hoogte;
  const u = 500, v = 300;
  const verwacht = {
    0: { x: u, y: v },
    90: { x: v, y: H - u },
    180: { x: W - u, y: H - v },
    270: { x: W - v, y: u },
  };
  for (const rotatie of [0, 90, 180, 270]) {
    const doc = {
      viewMode: 'continuous', facingSpread: true, currentPage: 2, scale: SCHAAL, viewRotation: rotatie,
      pageDims: { 3: { widthPt: W, heightPt: H, offsetXPt: 0, offsetYPt: 0, rotation: 0 } },
    };
    const getActiveDocument = () => doc;
    const ctx = await laadMetStubs('../tools/tool-context.js', {
      getActiveDocument,
      weergaveNaarPagina: (p, a, b) => weergaveNaarPagina(p, a, b, doc),
      weergaveRotatie: () => weergaveRotatie(doc),
    });
    // Rechterpagina (3) van de spread 2-3, gescrold: de container begint
    // rechts van de linkerpagina en boven het venster.
    const kwart = rotatie % 180 !== 0;
    const rect = paginaRect(1010, -420, (kwart ? H : W) * SCHAAL, (kwart ? W : H) * SCHAAL);
    const { cc } = nepPagina(3, rect);
    const c = ctx.resolvePointerCoords({ clientX: rect.left + u * SCHAAL, clientY: rect.top + v * SCHAAL, target: cc });
    assert.equal(c.pageNum, 3, `pagina bij ${rotatie}°`);
    assert.ok(Math.abs(c.x - verwacht[rotatie].x) < 1e-9 && Math.abs(c.y - verwacht[rotatie].y) < 1e-9,
      `${rotatie}°: (${c.x}, ${c.y}) in plaats van (${verwacht[rotatie].x}, ${verwacht[rotatie].y})`);
  }
});
