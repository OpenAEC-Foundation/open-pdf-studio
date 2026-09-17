import assert from 'node:assert/strict';
import test from 'node:test';

import { doorvalVoorSelectie, isTekstElement, staatBovenTekst } from './select-doorval.js';

// Minimale DOM-nabootsing: alleen wat isTekstElement gebruikt.
function el(classes = [], ouder = null) {
  const e = {
    parent: ouder,
    classList: { contains: (c) => classes.includes(c) },
    closest(sel) {
      const cls = sel.replace(/^\./, '');
      for (let n = this; n; n = n.parent) if (n.classList.contains(cls)) return n;
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
