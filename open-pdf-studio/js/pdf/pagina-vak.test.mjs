import test from 'node:test';
import assert from 'node:assert/strict';
import { isUitsnedeCanvas, paginaVakElement, paginaVakRect, paginaBitmapMaat } from './pagina-vak.js';

const container = (breedte, hoogte, metStijl = true) => ({
  style: metStijl ? { width: `${breedte}px`, height: `${hoogte}px` } : {},
  getBoundingClientRect: () => ({ left: 10, top: 20, width: breedte, height: hoogte }),
});
const canvas = ({ uitsnede, cc, width = 300, height = 200 }) => ({
  width,
  height,
  dataset: uitsnede ? { beeld: 'uitsnede' } : {},
  parentElement: cc,
  closest: (sel) => (sel === '.canvas-container-cont' ? cc : null),
  getBoundingClientRect: () => ({ left: 500, top: 600, width: width / 1.5, height: height / 1.5 }),
});

test('een gewoon paginacanvas is zelf het vak en de maat van de pagina', () => {
  const cc = container(3368, 2382);
  const c = canvas({ uitsnede: false, cc, width: 4096, height: 2896 });
  assert.equal(isUitsnedeCanvas(c), false);
  assert.equal(paginaVakElement(c), c);
  assert.equal(paginaVakRect(c).left, 500);
  assert.deepEqual(paginaBitmapMaat(c, 1.5), { width: 4096, height: 2896 });
});

test('een uitsnede: de paginacontainer is het vak, de maat is die van de hele pagina', () => {
  const cc = container(3368, 2382);
  const c = canvas({ uitsnede: true, cc, width: 3168, height: 2118 });
  assert.equal(isUitsnedeCanvas(c), true);
  assert.equal(paginaVakElement(c), cc);
  assert.deepEqual(paginaVakRect(c), { left: 10, top: 20, width: 3368, height: 2382 });
  assert.deepEqual(paginaBitmapMaat(c, 1.5), { width: 5052, height: 3573 });
});

test('zonder inline maat telt de gemeten rechthoek van de container', () => {
  const cc = container(1000, 500, false);
  assert.deepEqual(paginaBitmapMaat(canvas({ uitsnede: true, cc }), 2), { width: 2000, height: 1000 });
});

test('geen canvas: lege maat, geen fout', () => {
  assert.deepEqual(paginaBitmapMaat(null, 1), { width: 0, height: 0 });
  assert.equal(paginaVakRect(null), null);
  assert.equal(isUitsnedeCanvas(undefined), false);
});
