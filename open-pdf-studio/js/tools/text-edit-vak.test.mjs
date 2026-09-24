import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorVakOpmaak } from './text-edit-vak.js';
import { textboxTekstBreedte } from '../annotations/rendering/textbox-layout.js';

// Wat de editor met `box-sizing: border-box` overhoudt voor tekst: de breedte
// min twee keer de rand en twee keer de opvulling, zoals de browser rekent.
function editorTekstBreedte(ann, scale, opmaak) {
  const px = (s) => (s && s !== 'none' ? parseFloat(s) : 0);
  const rand = opmaak.border && opmaak.border !== 'none' ? px(opmaak.border) : 0;
  return (ann.width || 150) * scale - 2 * rand - 2 * px(opmaak.padding);
}

const gevallen = [
  { naam: 'dikke rand, zoals een profiel-label', ann: { width: 60, lineWidth: 3 } },
  { naam: 'dunne rand', ann: { width: 120, lineWidth: 1 } },
  { naam: 'geen lijndikte opgegeven', ann: { width: 120 } },
  { naam: 'lijndikte 0', ann: { width: 120, lineWidth: 0 } },
  { naam: 'geen rand (none)', ann: { width: 80, lineWidth: 2, strokeColor: 'none' } },
];

for (const { naam, ann } of gevallen) {
  for (const scale of [1, 1.5, 2.37]) {
    test(`editor breekt af op de canvasbreedte: ${naam}, schaal ${scale}`, () => {
      const opmaak = editorVakOpmaak(ann, scale);
      assert.ok(Math.abs(editorTekstBreedte(ann, scale, opmaak) - textboxTekstBreedte(ann) * scale) < 1e-9,
        `editor ${editorTekstBreedte(ann, scale, opmaak)} ≠ canvas ${textboxTekstBreedte(ann) * scale}`);
    });
  }
}

test('de canvasbreedte is de vakbreedte min twee keer de lijndikte, zonder minimum', () => {
  assert.equal(textboxTekstBreedte({ width: 60, lineWidth: 3 }), 54);
  assert.equal(textboxTekstBreedte({ width: 60 }), 60);
  assert.equal(textboxTekstBreedte({}), 150);
});

test('een zichtbare rand blijft zichtbaar in de editor, "geen rand" niet', () => {
  const met = editorVakOpmaak({ width: 60, lineWidth: 3, strokeColor: '#112233' }, 2);
  assert.match(JSON.stringify(met), /#112233/);
  assert.match(JSON.stringify(met), /6px/);
  const zonder = editorVakOpmaak({ width: 60, lineWidth: 3, strokeColor: 'none' }, 2);
  assert.doesNotMatch(JSON.stringify(zonder), /#/);
});
