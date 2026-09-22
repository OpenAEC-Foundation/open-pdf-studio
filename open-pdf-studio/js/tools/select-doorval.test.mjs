import assert from 'node:assert/strict';
import test from 'node:test';

import {
  doorvalVoorSelectie, isTekstElement, staatBovenTekst,
  klikDoelSoort, heftKlikSelectieOp,
} from './select-doorval.js';

// Minimale DOM-nabootsing: alleen wat isTekstElement gebruikt.
function el(classes = [], ouder = null, id = '') {
  const e = {
    parent: ouder,
    id,
    classList: { contains: (c) => classes.includes(c) },
    closest(sel) {
      const past = (n) => (sel.startsWith('#') ? n.id === sel.slice(1) : n.classList.contains(sel.replace(/^\./, '')));
      for (let n = this; n; n = n.parent) if (past(n)) return n;
      return null;
    },
  };
  return e;
}

const pagina = el(['canvas-container']);
const tekstlaag = el(['textLayer'], pagina);
const span = el([], tekstlaag);
const gemarkeerd = el(['markedContent'], tekstlaag);
const spanInGemarkeerd = el([], gemarkeerd);
const eindeInhoud = el(['endOfContent'], tekstlaag);
const annotatieCanvas = el(['annotation-canvas'], pagina);

test('leeg paginavlak (geen annotatie, geen tekst) houdt het annotatiecanvas klikbaar', () => {
  // Kern van de fout: hier ging pointer-events naar 'none', waardoor een
  // selectierechthoek in het lege vlak in de tekstlaag belandde en nooit
  // bij het selectiegereedschap aankwam.
  const r = doorvalVoorSelectie({ overAnnotatie: false, overTekst: false, knopIngedrukt: false });
  assert.equal(r.canvas, 'auto');
});

test('boven PDF-tekst valt de aanwijzer door naar de tekstlaag (tekstselectie)', () => {
  const r = doorvalVoorSelectie({ overAnnotatie: false, overTekst: true, knopIngedrukt: false });
  assert.deepEqual(r, { canvas: 'none', tekstlaag: 'auto', spanCursor: 'text' });
});

test('boven een annotatie wint het annotatiecanvas, ook als er tekst onder ligt', () => {
  const r = doorvalVoorSelectie({ overAnnotatie: true, overTekst: true, knopIngedrukt: false });
  assert.deepEqual(r, { canvas: 'auto', tekstlaag: 'none', spanCursor: '' });
});

test('in het lege vlak blijven de tekstspans raakbaar zodat tekst gedetecteerd kan worden', () => {
  const r = doorvalVoorSelectie({ overAnnotatie: false, overTekst: false, knopIngedrukt: false });
  assert.equal(r.tekstlaag, 'auto');
});

test('met ingedrukte muisknop (lopende tekstselectie) niets omschakelen', () => {
  assert.equal(doorvalVoorSelectie({ overAnnotatie: false, overTekst: false, knopIngedrukt: true }), null);
  assert.equal(doorvalVoorSelectie({ overAnnotatie: true, overTekst: false, knopIngedrukt: true }), null);
});

test('isTekstElement: alleen inhoud van een tekstlaag telt als tekst', () => {
  assert.equal(isTekstElement(span), true);
  assert.equal(isTekstElement(spanInGemarkeerd), true);
  assert.equal(isTekstElement(tekstlaag), false, 'de tekstlaag zelf is leeg vlak');
  assert.equal(isTekstElement(eindeInhoud), false, 'endOfContent is geen tekst');
  assert.equal(isTekstElement(annotatieCanvas), false);
  assert.equal(isTekstElement(null), false);
  assert.equal(isTekstElement({}), false);
});

test('staatBovenTekst: kijkt door de elementstapel onder de aanwijzer heen', () => {
  assert.equal(staatBovenTekst([annotatieCanvas, span, tekstlaag, pagina]), true);
  assert.equal(staatBovenTekst([annotatieCanvas, tekstlaag, pagina]), false);
  assert.equal(staatBovenTekst([]), false);
  assert.equal(staatBovenTekst(null), false);
});

// ── Klik naast een geselecteerd element ─────────────────────────────────────
// Een pointerdown die niet op het annotatiecanvas landt, komt nooit bij het
// selectiegereedschap aan. Het gereedschap hief de selectie alleen zelf op
// (start van een selectierechthoek); een klik op PDF-tekst of buiten de
// pagina liet de selectie dus staan.

const hoofdweergave = el(['main-view']);
const pdfContainer = el([], hoofdweergave, 'pdf-container');
const canvasWrapper = el([], pdfContainer, 'canvas-wrapper');
const doorlopend = el(['continuous-container'], canvasWrapper, 'continuous-container');
const paginaWrapper = el(['page-wrapper'], doorlopend);
const paginaCont = el(['canvas-container-cont'], paginaWrapper);
const tekstlaagCont = el(['textLayer'], paginaCont);
const spanCont = el([], tekstlaagCont);
const pdfCanvasCont = el(['pdf-canvas'], paginaCont);
const annotatieCanvasCont = el(['annotation-canvas'], paginaCont);
const linklaag = el(['linkLayer'], paginaCont);
const link = el(['pdf-link'], linklaag);
const formulierlaag = el(['formLayer'], paginaCont);
const formulierveld = el([], formulierlaag);
const enkelCont = el(['single-page-container'], canvasWrapper, 'canvas-container');
const enkelCanvas = el([], enkelCont, 'annotation-canvas');
const schuifbalk = el(['canvas-scrollbar'], pdfContainer);
const eigenschappen = el(['properties-panel']);
const tekstEditor = el(['inline-text-editor'], paginaCont);

test('klikDoelSoort: PDF-tekst en de tekstlaag zelf', () => {
  assert.equal(klikDoelSoort(spanCont), 'tekst');
  assert.equal(klikDoelSoort(tekstlaagCont), 'tekst');
  assert.equal(klikDoelSoort(span), 'tekst');
});

test('klikDoelSoort: link- en formulierlaag horen bij de pagina-inhoud', () => {
  assert.equal(klikDoelSoort(link), 'pagina-inhoud');
  assert.equal(klikDoelSoort(formulierveld), 'pagina-inhoud');
});

test("klikDoelSoort: achtergrond rond en tussen de pagina's", () => {
  assert.equal(klikDoelSoort(pdfContainer), 'achtergrond');
  assert.equal(klikDoelSoort(canvasWrapper), 'achtergrond');
  assert.equal(klikDoelSoort(doorlopend), 'achtergrond');
  assert.equal(klikDoelSoort(paginaWrapper), 'achtergrond');
  assert.equal(klikDoelSoort(enkelCont), 'achtergrond');
});

test('klikDoelSoort: het canvas is van het selectiegereedschap zelf', () => {
  assert.equal(klikDoelSoort(annotatieCanvasCont), 'canvas');
  assert.equal(klikDoelSoort(pdfCanvasCont), 'canvas');
  assert.equal(klikDoelSoort(paginaCont), 'canvas');
  assert.equal(klikDoelSoort(enkelCanvas), 'canvas');
});

test('klikDoelSoort: bediening buiten de weergave en editors tellen niet mee', () => {
  assert.equal(klikDoelSoort(eigenschappen), 'anders');
  assert.equal(klikDoelSoort(schuifbalk), 'anders', 'eigen schuifbalk in de container');
  assert.equal(klikDoelSoort(tekstEditor), 'anders', 'de tekst-editor van een tekstvak');
  assert.equal(klikDoelSoort(hoofdweergave), 'anders');
  assert.equal(klikDoelSoort(null), 'anders');
  assert.equal(klikDoelSoort({}), 'anders');
});

const klik = (over = {}) => ({
  gereedschap: 'select', knop: 0, shift: false, ctrl: false,
  soort: 'tekst', heeftSelectie: true, opSchuifbalk: false, modusBezig: false, ...over,
});

test('klik op PDF-tekst naast het element heft de selectie op', () => {
  assert.equal(heftKlikSelectieOp(klik({ soort: 'tekst' })), true);
});

test("klik buiten de pagina (achtergrond, tussen pagina's) heft de selectie op", () => {
  assert.equal(heftKlikSelectieOp(klik({ soort: 'achtergrond' })), true);
});

test('klik op een link of formulierveld heft de selectie op', () => {
  assert.equal(heftKlikSelectieOp(klik({ soort: 'pagina-inhoud' })), true);
});

test('het canvas beslist zelf: grepen, kader en selectierechthoek blijven bij het gereedschap', () => {
  assert.equal(heftKlikSelectieOp(klik({ soort: 'canvas' })), false);
});

test('klik in een paneel, de ribbon of een editor laat de selectie staan', () => {
  assert.equal(heftKlikSelectieOp(klik({ soort: 'anders' })), false);
});

test('Shift of Ctrl houdt de selectie vast (toevoegen), net als bij de selectierechthoek', () => {
  assert.equal(heftKlikSelectieOp(klik({ shift: true })), false);
  assert.equal(heftKlikSelectieOp(klik({ ctrl: true })), false);
});

test('alleen de linkerknop en alleen het selectiegereedschap', () => {
  assert.equal(heftKlikSelectieOp(klik({ knop: 2 })), false, 'rechts: contextmenu');
  assert.equal(heftKlikSelectieOp(klik({ knop: 1 })), false, 'midden: pannen');
  assert.equal(heftKlikSelectieOp(klik({ gereedschap: 'hand' })), false);
  assert.equal(heftKlikSelectieOp(klik({ gereedschap: 'box' })), false);
});

test('zonder selectie valt er niets op te heffen', () => {
  assert.equal(heftKlikSelectieOp(klik({ heeftSelectie: false })), false);
});

test('schuifbalk van de weergave laat de selectie staan', () => {
  assert.equal(heftKlikSelectieOp(klik({ soort: 'achtergrond', opSchuifbalk: true })), false);
});

test('een modus die de klik zelf opeist (verplaatsen, roteren, bijsnijden) houdt zijn selectie', () => {
  assert.equal(heftKlikSelectieOp(klik({ modusBezig: true })), false);
  assert.equal(heftKlikSelectieOp(klik({ soort: 'achtergrond', modusBezig: true })), false);
});
