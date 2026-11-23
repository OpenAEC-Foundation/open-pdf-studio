// #1217: the architectural hatch survives the real save/load path and is
// visible, unchanged, when the saved appearance is rendered by another engine.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as mupdf from 'mupdf';
import { leegBlad, opslaan, laad } from '../rondgang.testhulp.mjs';
function pixels(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false, true);
  const data = pix.getPixels().slice(); pix.destroy(); page.destroy(); doc.destroy(); return data;
}
for (const pattern of ['brick-running', 'brick-stack', 'grond-blokjes']) {
  test(`${pattern}: save/reopen/save preserves rotated hatch appearance`, async () => {
    const ann = { id: pattern, type: 'filledArea', page: 1, opacity: 1, printable: true,
      points: [{x:100,y:100},{x:340,y:100},{x:340,y:250},{x:100,y:250}],
      x:100,y:100,width:240,height:150, color:'#000000',strokeColor:'#000000',fillColor:null,
      lineWidth:.4,borderStyle:'solid',hatchPattern:pattern,hatchColor:'#000000',hatchScale:130,hatchAngle:30 };
    const first = await opslaan(await leegBlad(), [ann]);
    const loaded = (await laad(first)).filter(a => a.type === 'filledArea');
    assert.equal(loaded.length, 1);
    for (const key of ['hatchPattern','hatchScale','hatchAngle']) assert.equal(loaded[0][key], ann[key]);
    const before = pixels(first);
    assert.ok(before.filter(c => c < 200).length > 2000, 'appearance contains hatch ink');
    const second = await opslaan(first, loaded);
    assert.deepEqual(pixels(second), before, 'second save preserves the rendered appearance');
  });
}
