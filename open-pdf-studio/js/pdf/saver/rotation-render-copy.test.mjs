import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees, PDFName } from 'pdf-lib';
import { rotationRenderCopy } from './rotation-render-copy.js';

for (const base of [0, 90, 180, 270]) {
  test(`render copy retains intrinsic ${base} and leaves saved PDF unchanged`, async () => {
    const doc = await PDFDocument.create();
    const applied = { 1: 180, 2: 90, 3: 270 };
    for (const delta of Object.values(applied)) {
      const p = doc.addPage([300, 400]);
      p.setRotation(degrees((base + delta) % 360));
      p.node.set(PDFName.of('Annots'), doc.context.obj([{ Type: 'Annot', Subtype: 'Text', Rect: [10, 20, 30, 40] }]));
    }
    const saved = await doc.save(), original = saved.slice();
    const view = await PDFDocument.load(await rotationRenderCopy(saved, applied));
    assert.deepEqual(saved, original, 'must not modify saved bytes');
    assert.deepEqual(view.getPages().map(p => p.getRotation().angle), [base, base, base]);
    assert.equal(view.getPage(0).node.Annots().size(), 1, 'annotations survive normalization');
    const output = await PDFDocument.load(saved);
    assert.deepEqual(output.getPages().map(p => p.getRotation().angle), Object.values(applied).map(d => (base + d) % 360));
  });
}
test('no rotation keeps bytes untouched', async () => {
  const bytes = new Uint8Array([1, 2]);
  assert.equal(await rotationRenderCopy(bytes, { 1: 0 }), bytes);
});
