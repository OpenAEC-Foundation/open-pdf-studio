// Plakken op de muis (#928): Ctrl+V zet de kopie waar de cursor staat, op de
// pagina onder de cursor. De echte clipboard.js wordt geladen met alleen de
// imports gestubd, zodat dit bestand de module zelf toetst.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shiftAnnotation } from '../pdf/shift-page-geometry.js';

// De echte annotationBounds uit spatial-index.js, met alleen de parametrische
// imports gestubd (zelfde patroon als annotatie-omhullende.test.mjs). Zo toetst
// dit bestand de arc-tak echt en niet een kopie van de veldentabel.
const spatialBron = readFileSync(new URL('./spatial-index.js', import.meta.url), 'utf8')
  .replace(/^import \{ buildStavenreeks \}.*$/m,
    'const buildStavenreeks = () => ({ aabb: { x: 0, y: 0, width: 10, height: 10 } });')
  .replace(/^import \{ stavenreeksPxPerMm \}.*$/m, 'const stavenreeksPxPerMm = () => 1;')
  .replace(/^import \{ betonbalkHalfWidthPx \}.*$/m, 'const betonbalkHalfWidthPx = () => 20;')
  .replace(/^import \{ rotatedRectAabb \}.*$/m, `
const rotatedRectAabb = (r) => {
  const rad = (r.rotation || 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const w = r.width * c + r.height * s;
  const h = r.width * s + r.height * c;
  return { x: r.x + r.width / 2 - w / 2, y: r.y + r.height / 2 - h / 2, width: w, height: h };
};`);
const { annotationBounds: echteAnnotationBounds } = await import(
  'data:text/javascript;base64,' + Buffer.from(spatialBron, 'utf8').toString('base64')
);

// De echte veldwandelaar uit transforms.js (zelfde patroon als
// shift-page-geometry.test.mjs); die module zelf is in Node niet importeerbaar.
function laadApplyMoveGeneric() {
  const bron = readFileSync(new URL('./transforms.js', import.meta.url), 'utf8');
  const start = bron.indexOf('const _MOVE_SCALAR_PAIRS');
  const end = bron.indexOf('// Apply move to annotation');
  assert.ok(start > 0 && end > start, 'transforms.js: markeringen rond applyMoveGeneric zijn verschoven');
  const blok = bron.slice(start, end).replace('export function applyMoveGeneric', 'function applyMoveGeneric');
  return new Function(`${blok}; return applyMoveGeneric;`)();
}

const staat = {
  clipboardAnnotation: null,
  clipboardAnnotations: null,
  _pasteSeq: 0,
  defaultAuthor: 'A',
  doc: null,
};

const luisteraars = {};
globalThis.__staat = staat;
globalThis.__cache = new Map();
globalThis.__elementen = [];
globalThis.__container = {
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800 }),
};
globalThis.document = {
  addEventListener: (type, fn) => { luisteraars[type] = fn; },
  elementsFromPoint: () => globalThis.__elementen,
};

// Elke import van clipboard.js is één regel; die regels vervangen we door
// stubs. clientNaarPagina is hier de identiteit en een pagina is 400×500 pt,
// zodat een punt op (700, 700) binnen het kijkvenster maar buiten de pagina valt.
const stubs = `
const state = globalThis.__staat;
const getActiveDocument = () => state.doc;
const imageCache = globalThis.__cache;
const relinkCopiedZones = () => {};
const relinkPastedCorrections = () => {};
const cloneAnnotation = (a) => structuredClone(a);
const cloneAnnotationsInPlace = (bronnen, page) =>
  bronnen.map((a) => ({ ...structuredClone(a), id: a.id + '-inplace', page }));
const generateImageId = () => 'img-' + (globalThis.__imgSeq = (globalThis.__imgSeq || 0) + 1);
const updateStatusMessage = () => {};
const showProperties = () => {};
const showMultiSelectionProperties = () => {};
const redrawAnnotations = () => {};
const redrawContinuous = () => {};
const annotationCanvas = null;
const pdfContainer = globalThis.__container;
const recordAdd = () => {};
const recordBulkAdd = () => {};
const getEffectiveScale = () => 1;
const plakVerschuivingPt = () => 7;
const paginaMaat = () => ({ breedte: 400, hoogte: 500 });
const paginaRectNaarClient = () => null;
const clientNaarPagina = (page, x, y) => ({ x, y });
const rechtopRotatie = () => 0;
const annotationBounds = globalThis.__annotationBounds;
const applyMoveGeneric = globalThis.__applyMoveGeneric;
const shiftAnnotation = globalThis.__shiftAnnotation;
`;

const bron = readFileSync(new URL('./clipboard.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '');

globalThis.__annotationBounds = echteAnnotationBounds;
globalThis.__applyMoveGeneric = laadApplyMoveGeneric();
globalThis.__shiftAnnotation = shiftAnnotation;

const clip = await import(
  'data:text/javascript;base64,' + Buffer.from(stubs + bron, 'utf8').toString('base64')
);

// De cascade staat in de stub op 7 pt; de oude plaatsing is dus bron + 7.
const CASCADE = 7;

function muis(x, y) { luisteraars.mousemove?.({ clientX: x, clientY: y }); }
function muisWeg() { luisteraars.mouseleave?.(); }

function openen(extra = {}) {
  const doc = {
    pdfDoc: { numPages: 3 }, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [], selectedAnnotation: null, selectedAnnotations: [],
    ...extra,
  };
  staat.doc = doc;
  staat.clipboardAnnotation = null;
  staat.clipboardAnnotations = null;
  staat._pasteSeq = 0;
  globalThis.__elementen = [];
  muisWeg();
  return doc;
}

const vak = (id, extra = {}) =>
  ({ id, type: 'box', page: 1, x: 0, y: 0, width: 100, height: 50, ...extra });

function stubAfbeelding() {
  globalThis.Image = class {
    constructor() { this.naturalWidth = 100; this.naturalHeight = 50; }
    set src(_) { queueMicrotask(() => this.onload?.()); }
  };
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:image/png;base64,x'; this.onloadend?.(); }
  };
  globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
}

test('enkelvoudige weergave: de kopie staat gecentreerd op de muis', () => {
  const doc = openen();
  staat.clipboardAnnotation = vak('a');
  muis(300, 250);
  clip.pasteAnnotation();

  const geplakt = doc.annotations[0];
  assert.equal(geplakt.page, 1);
  assert.equal(geplakt.x, 250, 'x = 300 - 100/2');
  assert.equal(geplakt.y, 225, 'y = 250 - 50/2');
});

test('doorlopende weergave: de pagina onder de muis, niet currentPage', () => {
  const doc = openen({ viewMode: 'continuous', currentPage: 1 });
  staat.clipboardAnnotation = vak('a');
  globalThis.__elementen = [
    { matches: (s) => s === '.page-wrapper[data-page]', dataset: { page: '2' } },
  ];
  muis(300, 250);
  clip.pasteAnnotation();

  const geplakt = doc.annotations[0];
  assert.equal(geplakt.page, 2);
  assert.equal(geplakt.x, 250);
  assert.equal(geplakt.y, 225);
});

test('doorlopende weergave: muis in de kier tussen pagina\'s houdt de oude plaatsing', () => {
  const doc = openen({ viewMode: 'continuous', currentPage: 2 });
  staat.clipboardAnnotation = vak('a', { x: 10, y: 20 });
  globalThis.__elementen = [];
  muis(300, 250);
  clip.pasteAnnotation();

  const geplakt = doc.annotations[0];
  assert.equal(geplakt.page, 2);
  assert.equal(geplakt.x, 10 + CASCADE);
  assert.equal(geplakt.y, 20 + CASCADE);
});

test('muis buiten het kijkvenster: de oude plaatsing blijft', () => {
  const doc = openen({ currentPage: 2 });
  staat.clipboardAnnotation = vak('a', { x: 10, y: 20 });
  muis(900, 900);
  clip.pasteAnnotation();

  const geplakt = doc.annotations[0];
  assert.equal(geplakt.page, 2);
  assert.equal(geplakt.x, 10 + CASCADE);
  assert.equal(geplakt.y, 20 + CASCADE);
});

test('muis binnen het kijkvenster maar naast de pagina: de oude plaatsing blijft', () => {
  const doc = openen({ currentPage: 2 });
  staat.clipboardAnnotation = vak('a', { x: 10, y: 20 });
  muis(700, 700);
  clip.pasteAnnotation();

  const geplakt = doc.annotations[0];
  assert.equal(geplakt.page, 2);
  assert.equal(geplakt.x, 10 + CASCADE);
  assert.equal(geplakt.y, 20 + CASCADE);
});

test('muis het venster uit: de bewaarde positie vervalt', () => {
  const doc = openen({ currentPage: 2 });
  staat.clipboardAnnotation = vak('a', { x: 10, y: 20 });
  muis(300, 250);
  muisWeg();
  clip.pasteAnnotation();

  const geplakt = doc.annotations[0];
  assert.equal(geplakt.x, 10 + CASCADE);
  assert.equal(geplakt.y, 20 + CASCADE);
});

test('groep: onderlinge afstand blijft, de omhullende staat op de muis', () => {
  const doc = openen();
  staat.clipboardAnnotations = [
    vak('a', { x: 0, y: 0 }),
    vak('b', { x: 200, y: 100 }),
  ];
  muis(300, 250);
  clip.pasteAnnotations();

  const [a, b] = doc.annotations;
  assert.equal(b.x - a.x, 200, 'relatieve x blijft');
  assert.equal(b.y - a.y, 100, 'relatieve y blijft');
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  assert.equal((minX + maxX) / 2, 300);
  assert.equal((minY + maxY) / 2, 250);
  assert.equal(a.page, 1);
  assert.equal(b.page, 1);
});

test('groep: een kopie zonder omhullende wordt niet op de oude pagina achtergelaten', () => {
  const doc = openen({ viewMode: 'continuous', currentPage: 1 });
  staat.clipboardAnnotations = [
    vak('a', { x: 0, y: 0 }),
    { id: 'los', type: 'onbekend', page: 1 },
  ];
  globalThis.__elementen = [
    { matches: (s) => s === '.page-wrapper[data-page]', dataset: { page: '3' } },
  ];
  muis(300, 250);
  clip.pasteAnnotations();

  const [a, los] = doc.annotations;
  assert.equal(a.page, 3);
  assert.equal(los.page, 3, 'ook zonder omhullende naar de muispagina');
  assert.equal(a.x, 250);
  assert.equal(a.y, 225);
});

test('groep: muis naast de pagina houdt voor elke kopie de cascade', () => {
  const doc = openen({ currentPage: 2 });
  staat.clipboardAnnotations = [
    vak('a', { x: 10, y: 20 }),
    vak('b', { x: 210, y: 120 }),
  ];
  muis(700, 700);
  clip.pasteAnnotations();

  const [a, b] = doc.annotations;
  assert.equal(a.page, 2);
  assert.equal(b.page, 2);
  assert.equal(a.x, 10 + CASCADE);
  assert.equal(a.y, 20 + CASCADE);
  assert.equal(b.x, 210 + CASCADE);
  assert.equal(b.y, 120 + CASCADE);
});

test('aanhaalvak: pijl, knie en armbasis schuiven star mee met het kader', () => {
  const doc = openen();
  staat.clipboardAnnotation = {
    id: 'c', type: 'callout', page: 1, x: 0, y: 0, width: 150, height: 50,
    arrowX: -60, arrowY: 50, kneeX: -30, kneeY: 25, armOriginX: 0, armOriginY: 25,
  };
  muis(300, 250);
  clip.pasteAnnotation();

  const c = doc.annotations[0];
  // Omhullende = het tekstvak (0,0,150,50); het midden (75,25) gaat naar
  // (300,250), dus +225/+225 voor alle punten.
  assert.deepEqual(
    [c.x, c.y, c.arrowX, c.arrowY, c.kneeX, c.kneeY, c.armOriginX, c.armOriginY],
    [225, 225, 165, 275, 195, 250, 225, 250],
    'de leider mag niet achterblijven',
  );
});

test('boog: het hart gaat naar de muis op de muispagina', () => {
  const doc = openen({ viewMode: 'continuous', currentPage: 1 });
  staat.clipboardAnnotation = {
    id: 'r', type: 'arc', page: 1, centerX: 100, centerY: 100, radius: 40,
    startAngle: 0, endAngle: Math.PI,
  };
  globalThis.__elementen = [
    { matches: (s) => s === '.page-wrapper[data-page]', dataset: { page: '3' } },
  ];
  muis(300, 250);
  clip.pasteAnnotation();

  const boog = doc.annotations[0];
  assert.equal(boog.page, 3);
  assert.equal(boog.centerX, 300, 'hart op de muis');
  assert.equal(boog.centerY, 250);
});

test('afbeelding: geplakt met de muis als middelpunt', async () => {
  const doc = openen();
  stubAfbeelding();
  muis(300, 250);
  await clip.pasteImageFromBlob({});

  const img = doc.annotations[0];
  assert.equal(img.type, 'image');
  assert.equal(img.page, 1);
  assert.equal(img.x, 250);
  assert.equal(img.y, 225);
});

test('afbeelding: muis naast de pagina houdt de oude plaatsing', async () => {
  const doc = openen({ currentPage: 2 });
  stubAfbeelding();
  muis(700, 700);
  await clip.pasteImageFromBlob({});

  const img = doc.annotations[0];
  assert.equal(img.page, 2);
  assert.equal(img.x, 10);
  assert.equal(img.y, 10);
});

test('plakken op plaats houdt de broncoördinaten, ook met de muis op de pagina', () => {
  const doc = openen({ currentPage: 2 });
  staat.clipboardAnnotation = vak('a', { page: 1, x: 123, y: 45 });
  muis(300, 250);
  clip.pasteAnnotationsInPlace();

  const geplakt = doc.annotations[0];
  assert.equal(geplakt.x, 123);
  assert.equal(geplakt.y, 45);
  assert.equal(geplakt.page, 2);
});
