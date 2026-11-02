// Plakken op de muis (#928): Ctrl+V zet de kopie waar de cursor staat, op de
// pagina onder de cursor. De echte clipboard.js wordt geladen met alleen de
// imports gestubd, zodat dit bestand de module zelf toetst.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const annotationBounds = (a) => (a.width > 0 && a.height > 0
  ? { x: a.x, y: a.y, width: a.width, height: a.height } : null);
const applyMoveGeneric = (a, dx, dy) => {
  if (typeof a.x === 'number') a.x += dx;
  if (typeof a.y === 'number') a.y += dy;
};
`;

const bron = readFileSync(new URL('./clipboard.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '');

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
