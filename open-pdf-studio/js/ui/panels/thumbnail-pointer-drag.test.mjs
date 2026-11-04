import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailDropAt, createThumbnailPointerDrag } from './thumbnail-pointer-drag.js';

function fixture() {
  const dom = new EventTarget(); const win = new EventTarget(); dom.defaultView = win;
  const list = new EventTarget(); list.ownerDocument = dom; list.scrollTop = 0; list.focus = () => {};
  let columns = '100px'; win.getComputedStyle = () => ({ gridTemplateColumns: columns });
  const rows = [1, 2, 3].map((page, i) => ({ dataset: { page: String(page) },
    closest() { return this; }, getBoundingClientRect: () => ({ left: 0, width: 100, top: i * 40, height: 40 }) }));
  list.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 150 });
  list.contains = el => el === list || rows.includes(el);
  dom.elementFromPoint = (x, y) => rows[Math.floor(y / 40)] || null;
  let capture = null;
  list.setPointerCapture = id => { capture = id; }; list.hasPointerCapture = id => id === capture;
  list.releasePointerCapture = () => { capture = null; };
  let sequence = 0; const frames = new Map();
  win.requestAnimationFrame = fn => { frames.set(++sequence, fn); return sequence; };
  win.cancelAnimationFrame = id => frames.delete(id);
  let doc = { pdfDoc: { numPages: 3 } }; let editable = true; let selection = [1, 2];
  let target; let dragging; const commits = [];
  const controller = createThumbnailPointerDrag(list, {
    getDocument: () => doc, getSelection: () => selection, canEdit: () => editable,
    setDragging: v => { dragging = v; }, setTarget: v => { target = v; }, commit: (...v) => commits.push(v),
  });
  function send(type, props = {}) {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, button: 0, isPrimary: true, pointerType: 'mouse', clientX: 40, clientY: 15, ...props });
    if (type === 'pointerdown') Object.defineProperty(e, 'target', { value: {
      closest: selector => selector === '.thumbnail-item[data-page]' ? rows[0] : props.input ? {} : null,
    } });
    (['pointerdown', 'click', 'lostpointercapture'].includes(type) ? list : dom).dispatchEvent(e);
    return e;
  }
  return { list, dom, win, controller, send, commits, frames, doc: () => doc,
    setDoc: v => { doc = v; }, edit: v => { editable = v; }, select: v => { selection = v; },
    columns: v => { columns = v; }, target: () => target, dragging: () => dragging,
    tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
  };
}

test('hit testing uses vertical halves for a column, horizontal halves for a grid, and rejects outside/blank space', () => {
  const f = fixture();
  assert.deepEqual(thumbnailDropAt(f.list, { clientX: 20, clientY: 85 }), { page: 3, position: 'before', naast: false });
  assert.equal(thumbnailDropAt(f.list, { clientX: 20, clientY: 115 }).position, 'after');
  f.columns('50px 50px');
  assert.deepEqual(thumbnailDropAt(f.list, { clientX: 80, clientY: 85 }), { page: 3, position: 'after', naast: true });
  for (const [x, y] of [[-1, 85], [100, 85], [40, -1], [40, 150], [40, 130]]) {
    assert.equal(thumbnailDropAt(f.list, { clientX: x, clientY: y }), null);
  }
  f.controller.destroy();
});
test('drag snapshots the selected group, commits once and swallows the navigation click', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientY: 115 });
  assert.equal(f.dragging(), 1); f.select([3]);
  f.send('pointerup', { clientY: 115 });
  assert.deepEqual(f.commits, [[f.doc(), f.doc().pdfDoc, [1, 2], 3, false]]);
  assert.equal(f.send('click').defaultPrevented, true);
  assert.equal(f.target(), null); assert.equal(f.frames.size, 0); f.controller.destroy();
});
test('an unselected page moves alone; simple clicks, touch scrolling and label inputs stay native', () => {
  const f = fixture(); f.select([2]);
  f.send('pointerdown'); f.send('pointermove', { clientY: 17 }); f.send('pointerup');
  assert.equal(f.send('click').defaultPrevented, false);
  for (const props of [{ pointerType: 'touch' }, { input: true }]) {
    f.send('pointerdown', props); f.send('pointermove', { clientY: 115 }); f.send('pointerup', { clientY: 115 });
    assert.equal(f.commits.length, 0);
  }
  f.send('pointerdown'); f.send('pointermove', { clientY: 115 }); f.send('pointerup', { clientY: 115 });
  assert.deepEqual(f.commits[0][2], [1]); f.controller.destroy();
});
test('Escape, blur, pointer cancellation, outside drop and self/group drop never commit', () => {
  for (const ending of ['escape', 'blur', 'pointercancel', 'outside', 'group']) {
    const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientY: 115 });
    if (ending === 'escape') assert.equal(f.send('keydown', { key: 'Escape' }).defaultPrevented, true);
    if (ending === 'blur') f.win.dispatchEvent(new Event('blur'));
    if (ending === 'pointercancel') f.send('pointercancel');
    f.send('pointerup', { clientX: ending === 'outside' ? 200 : 40, clientY: ending === 'group' ? 65 : 115 });
    assert.equal(f.commits.length, 0); assert.equal(f.target(), null); assert.equal(f.frames.size, 0); f.controller.destroy();
  }
});
test('document switches, PDF reloads and edit restrictions invalidate active and pending gestures', () => {
  for (const change of ['doc', 'pdf', 'readonly']) for (const active of [false, true]) {
    const f = fixture(); f.send('pointerdown');
    if (active) f.send('pointermove', { clientY: 115 });
    if (change === 'doc') f.setDoc({ pdfDoc: f.doc().pdfDoc });
    if (change === 'pdf') f.doc().pdfDoc = { numPages: 3 };
    if (change === 'readonly') f.edit(false);
    f.send('pointermove', { clientY: 115 }); f.send('pointerup', { clientY: 115 });
    assert.equal(f.commits.length, 0); f.controller.destroy();
  }
});
test('edge scrolling continues on frames and stops on cancellation or destruction', () => {
  for (const cleanup of ['cancel', 'destroy']) {
    const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientY: 140 });
    f.tick(); f.tick(); assert.equal(f.list.scrollTop, 16);
    f.controller[cleanup](); f.tick(); assert.equal(f.list.scrollTop, 16);
    assert.equal(f.frames.size, 0); f.controller.destroy();
  }
});
