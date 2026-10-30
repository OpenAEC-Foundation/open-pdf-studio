import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkDropAt, createBookmarkPointerDrag } from './bookmark-pointer-drag.js';

function fixture() {
  const dom = new EventTarget(); const win = new EventTarget(); dom.defaultView = win;
  const list = new EventTarget(); list.ownerDocument = dom; list.scrollTop = 0; list.focus = () => {};
  const rows = new Map(['a', 'b', 'c'].map((id, i) => [id, { dataset: { bmId: id }, closest: () => rows.get(id), getBoundingClientRect: () => ({ top: i * 30, height: 30 }) }]));
  list.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 150 });
  list.contains = el => el === list || [...rows.values()].includes(el);
  list.closest = () => null;
  dom.elementFromPoint = (x, y) => y < 90 ? [...rows.values()][Math.floor(y / 30)] : list;
  let capture = null;
  list.setPointerCapture = id => { capture = id; }; list.hasPointerCapture = id => capture === id;
  list.releasePointerCapture = () => { capture = null; };
  let counter = 0; const frames = new Map(); const timers = new Map();
  win.requestAnimationFrame = fn => { frames.set(++counter, fn); return counter; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = fn => { timers.set(++counter, fn); return counter; }; win.clearTimeout = id => timers.delete(id);
  let doc = { bookmarks: ['a', 'b', 'c'].map((id, sortOrder) => ({ id, sortOrder, parentId: null, expanded: true })) };
  let editable = true; let selection = ['a', 'b']; let target; let dragging;
  const commits = []; const expands = [];
  const controller = createBookmarkPointerDrag(list, {
    getDocument: () => doc, getSelection: () => selection, canEdit: () => editable,
    setTarget: v => { target = v; }, setDragging: v => { dragging = v; },
    expand: (...v) => expands.push(v), commit: (...v) => commits.push(v),
  });
  const send = (type, props = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, button: 0, isPrimary: true, pointerType: 'mouse', clientX: 40, clientY: 15, ...props });
    if (type === 'pointerdown') Object.defineProperty(e, 'target', { value: { closest: selector => selector === '[data-bm-id]' ? rows.get(props.id || 'a') : null } });
    (['pointerdown', 'click', 'lostpointercapture'].includes(type) ? list : dom).dispatchEvent(e);
    return e;
  };
  return { list, dom, rows, send, controller, commits, expands, frames, timers,
    doc: () => doc, setDoc: v => { doc = v; }, editable: v => { editable = v; }, selection: v => { selection = v; },
    target: () => target, dragging: () => dragging, capture: () => capture,
    tick: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    hover: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
  };
}

test('screen hit testing distinguishes row thirds, blank end and outside list', () => {
  const f = fixture();
  for (const [y, positie] of [[61, 'before'], [75, 'inside'], [89, 'after']]) {
    assert.deepEqual(bookmarkDropAt(f.list, { clientX: 40, clientY: y }, f.doc().bookmarks, ['a']), { id: 'c', positie });
  }
  assert.deepEqual(bookmarkDropAt(f.list, { clientX: 40, clientY: 120 }, f.doc().bookmarks, ['a']), { id: null, positie: 'end' });
  assert.equal(bookmarkDropAt(f.list, { clientX: 101, clientY: 75 }, f.doc().bookmarks, ['a']), null);
  assert.equal(bookmarkDropAt(f.list, { clientX: 40, clientY: 15 }, f.doc().bookmarks, ['a']), null);
  f.doc().bookmarks[2].parentId = 'a';
  assert.equal(bookmarkDropAt(f.list, { clientX: 40, clientY: 75 }, f.doc().bookmarks, ['a']), null);
  f.controller.destroy();
});
test('one pointer gesture preserves a selected group, captures and commits once', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientY: 75 });
  assert.deepEqual(f.dragging(), ['a', 'b']); assert.equal(f.capture(), 1);
  f.send('pointerup', { clientY: 75 });
  assert.deepEqual(f.commits[0].slice(1), [['a', 'b'], 'c', 'inside']); assert.equal(f.commits.length, 1);
  assert.equal(f.send('click').defaultPrevented, true); assert.equal(f.target(), null);
  assert.equal(f.frames.size, 0); assert.equal(f.capture(), null); f.controller.destroy();
});
test('an unselected row moves alone; sub-threshold clicks keep their normal selection action', () => {
  const f = fixture(); f.selection(['b']); f.send('pointerdown'); f.send('pointermove', { clientY: 17 }); f.send('pointerup');
  assert.equal(f.send('click').defaultPrevented, false); assert.equal(f.commits.length, 0);
  f.send('pointerdown'); f.send('pointermove', { clientY: 75 }); f.send('pointerup', { clientY: 75 });
  assert.deepEqual(f.commits[0][1], ['a']); f.controller.destroy();
});
test('Escape, pointer cancellation and leaving the list never commit', () => {
  for (const ending of ['escape', 'pointercancel', 'outside']) {
    const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientY: 75 });
    if (ending === 'escape') assert.equal(f.send('keydown', { key: 'Escape' }).defaultPrevented, true);
    else if (ending === 'pointercancel') f.send('pointercancel');
    f.send('pointerup', { clientX: ending === 'outside' ? 200 : 40, clientY: 75 });
    assert.equal(f.commits.length, 0); assert.equal(f.target(), null); assert.equal(f.frames.size, 0); f.controller.destroy();
  }
});
test('read-only state and document switches invalidate even a pending press', () => {
  for (const change of ['readonly', 'document']) for (const active of [false, true]) {
    const f = fixture(); f.send('pointerdown');
    if (active) f.send('pointermove', { clientY: 75 });
    if (change === 'readonly') f.editable(false); else f.setDoc({ bookmarks: f.doc().bookmarks });
    f.send('pointermove', { clientY: 75 }); f.send('pointerup', { clientY: 75 });
    assert.equal(f.commits.length, 0); f.controller.destroy();
  }
});
test('stationary edge dragging scrolls on frames and cleanup stops it', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientY: 140 });
  f.tick(); f.tick(); assert.equal(f.list.scrollTop, 16);
  f.controller.cancel(); f.tick(); assert.equal(f.list.scrollTop, 16); f.controller.destroy();
});
test('collapsed parent expands only while still hovered in the original document', () => {
  const f = fixture(); f.doc().bookmarks[2].expanded = false;
  f.doc().bookmarks.push({ id: 'child', parentId: 'c' });
  f.send('pointerdown'); f.send('pointermove', { clientY: 75 }); f.hover();
  assert.equal(f.expands.length, 1); assert.equal(f.expands[0][1], 'c'); assert.equal(f.expands[0][2](), true);
  f.controller.cancel(); assert.ok(!f.expands[0][2]());
  f.send('pointerdown'); f.send('pointermove', { clientY: 75 }); f.send('pointermove', { clientX: 200, clientY: 75 });
  f.hover(); assert.equal(f.expands.length, 1); f.controller.destroy();
});
