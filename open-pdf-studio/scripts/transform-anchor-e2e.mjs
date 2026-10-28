// Draai tegen een eigen devserver: node scripts/transform-anchor-e2e.mjs http://127.0.0.1:3057
// Maakt alleen een nieuw leeg document in een tijdelijke browsercontext.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.goto(process.argv[2] || 'http://127.0.0.1:3057', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async type => {
    const { createBlankPDF } = await import('/js/pdf/loader.js');
    await createBlankPDF(612, 792, 1);
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const { redrawAnnotations } = await import('/js/annotations/rendering.js');
    const d = getActiveDocument();
    if (type === 'image') {
      const { plaatsAfbeeldingAnnotatie } = await import('/js/annotations/image-drop.js');
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#cceeff'; ctx.fillRect(0, 0, 200, 100);
      ctx.fillStyle = '#0066cc'; ctx.fillRect(20, 20, 20, 20);
      const url = canvas.toDataURL(), img = new Image(); img.src = url; await img.decode();
      plaatsAfbeeldingAnnotatie(img, url, { x: 120, y: 150, width: 200, height: 100, page: 1 });
      d.annotations.at(-1).id = 'anchor-e2e';
    } else d.annotations.push({ id: 'anchor-e2e', type: 'box', page: 1, x: 120, y: 150,
      width: 200, height: 100, rotation: 0, strokeColor: '#0066cc', fillColor: '#cceeff', lineWidth: 2, opacity: 1 });
    d.selectedAnnotations = [d.annotations.at(-1)]; d.selectedAnnotation = d.annotations.at(-1);
    const { setTool } = await import('/js/tools/manager.js');
    setTool('select');
    state.preferences.enableObjectSnap = false; state.preferences.enableGridSnap = false;
    redrawAnnotations();
  }, process.argv[3] || 'box');
  const read = () => page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { getTransformAnchor } = await import('/js/annotations/transform-anchor.js');
    const d = getActiveDocument(), a = d.annotations.find(a => a.id === 'anchor-e2e');
    return { a: JSON.parse(JSON.stringify(a)), pivot: getTransformAnchor(a), undo: d.undoStack.length };
  });
  const screen = p => page.evaluate(async p => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const d = getActiveDocument(), r = document.getElementById('annotation-canvas').getBoundingClientRect();
    return { x: r.left + p.x * d.scale, y: r.top + p.y * d.scale };
  }, p);
  const handle = type => page.evaluate(async type => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { getAnnotationHandles } = await import('/js/annotations/handles.js');
    const { HANDLE_SIZE } = await import('/js/core/constants.ts');
    const d = getActiveDocument(), a = d.annotations.find(a => a.id === 'anchor-e2e');
    const h = getAnnotationHandles(a, d.scale).find(h => h.type === type);
    if (!h) throw new Error(`Missing handle ${type}`);
    return { x: h.x + HANDLE_SIZE / d.scale / 2, y: h.y + HANDLE_SIZE / d.scale / 2 };
  }, type);
  async function drag(from, to) {
    const a = await screen(from), b = await screen(to);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(100);
  }
  const closePoint = (a, b) => {
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1.5, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  await page.waitForTimeout(1000);
  const before = await read();
  await drag(await handle('transform_anchor'), { x: 140, y: 170 });
  const placed = await read();
  assert.equal(placed.pivot.custom, true); closePoint(placed.pivot, { x: 140, y: 170 });
  assert.deepEqual(placed.a, before.a); assert.equal(placed.undo, before.undo);
  console.log('PASS pointer drag moves only session pivot, no undo or document edit');

  const r = await handle('rotate'), p = placed.pivot;
  await drag(r, { x: p.x - (r.y - p.y), y: p.y + (r.x - p.x) });
  const rotated = await read(); closePoint(rotated.pivot, p);
  assert.ok(Math.abs(rotated.a.rotation - 90) < 1.5); assert.ok(rotated.undo > placed.undo);
  console.log('PASS rotation handle orbits fixed pivot and records undo');

  const corner = await handle('br');
  await drag(corner, { x: corner.x - 30, y: corner.y + 40 });
  const resized = await read(); closePoint(resized.pivot, p);
  assert.notEqual(resized.a.width, rotated.a.width);
  console.log('PASS corner resize holds reference point');

  const currentHandle = await handle('transform_anchor'), a = await screen(currentHandle);
  const b = await screen({ x: currentHandle.x + 40, y: currentHandle.y + 40 });
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  closePoint((await read()).pivot, p);
  console.log('PASS Escape cancels pivot drag');

  const reset = await screen(await handle('transform_anchor'));
  await page.mouse.dblclick(reset.x, reset.y);
  assert.equal((await read()).pivot.custom, false);
  console.log('PASS double-click resets pivot');
} finally {
  await browser.close();
}
