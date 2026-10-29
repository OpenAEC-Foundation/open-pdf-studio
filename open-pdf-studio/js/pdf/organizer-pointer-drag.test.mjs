import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrganizerPointerDrag } from './organizer-pointer-drag.js';

function fixture() {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  const element = new EventTarget();
  element.ownerDocument = doc;
  let captured = null;
  element.setPointerCapture = id => { captured = id; };
  element.hasPointerCapture = id => captured === id;
  element.releasePointerCapture = () => { captured = null; };
  const calls = [];
  const controller = createOrganizerPointerDrag(element, {
    keyAt: () => 'p2', start: key => calls.push(['start', key]),
    move: e => calls.push(['move', e.clientX]), finish: e => calls.push(['finish', e.cancelled]),
  });
  const send = (type, props = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, clientX: 0, clientY: 0, button: 0, pointerType: 'mouse', isPrimary: true, ...props });
    (['pointerdown', 'click', 'lostpointercapture'].includes(type) ? element : doc).dispatchEvent(e);
    return e;
  };
  return { controller, calls, send, blur: () => doc.defaultView.dispatchEvent(new Event('blur')), captured: () => captured };
}

test('click and sub-threshold jitter preserve normal selection', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientX: 3 }); f.send('pointerup');
  assert.deepEqual(f.calls, []); assert.equal(f.send('click').defaultPrevented, false); f.controller.destroy();
});
test('pointer move completes without any HTML5 drag event and consumes its click', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientX: 8 });
  assert.equal(f.captured(), 1); f.send('pointerup', { clientX: 90 });
  assert.deepEqual(f.calls, [['start', 'p2'], ['move', 8], ['finish', false]]);
  assert.equal(f.captured(), null); assert.equal(f.send('click').defaultPrevented, true);
  assert.equal(f.send('click').defaultPrevented, false); f.controller.destroy();
});
for (const type of ['pointercancel', 'lostpointercapture']) {
  test(`${type} cancels instead of committing`, () => {
    const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientX: 8 }); f.send(type);
    assert.deepEqual(f.calls.at(-1), ['finish', true]); assert.equal(f.controller.isDragging(), false);
    f.send('pointerup'); assert.equal(f.calls.length, 3); f.controller.destroy();
  });
}
test('explicit cancellation and cleanup release capture and document listeners', () => {
  for (const method of ['cancel', 'destroy']) {
    const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientX: 8 }); f.controller[method]();
    f.send('pointermove', { clientX: 20 }); f.send('pointerup');
    assert.deepEqual(f.calls, [['start', 'p2'], ['move', 8], ['finish', true]]);
    assert.equal(f.captured(), null); f.controller.destroy();
  }
});
test('right button, secondary pointer and touch scrolling do not begin page moves', () => {
  for (const props of [{ button: 2 }, { isPrimary: false }, { pointerType: 'touch' }]) {
    const f = fixture(); f.send('pointerdown', props); f.send('pointermove', { clientX: 20 }); f.send('pointerup');
    assert.deepEqual(f.calls, []); f.controller.destroy();
  }
});
test('other pointer IDs cannot move or finish the active gesture', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { pointerId: 2, clientX: 20 });
  f.send('pointerup', { pointerId: 2 }); assert.deepEqual(f.calls, []);
  f.send('pointermove', { clientX: 8 }); f.send('pointerup');
  assert.deepEqual(f.calls.at(-1), ['finish', false]); f.controller.destroy();
});

test('losing window focus cancels an unfinished drag', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientX: 8 }); f.blur();
  assert.deepEqual(f.calls.at(-1), ['finish', true]); assert.equal(f.captured(), null);
  f.send('pointerup'); assert.equal(f.calls.length, 3); f.controller.destroy();
});

test('a press whose release never arrived does not linger into the next press', () => {
  const f = fixture(); f.send('pointerdown'); f.send('pointermove', { clientX: 2 });
  // The pointerup of that press got lost (released outside the page before the threshold).
  // The next press is a plain click elsewhere: it must not turn into a drag from the old origin.
  f.send('pointerdown', { clientX: 100 }); f.send('pointermove', { clientX: 102 }); f.send('pointerup', { clientX: 102 });
  assert.deepEqual(f.calls, []); assert.equal(f.send('click').defaultPrevented, false);
  // And a real drag from the new press still works.
  f.send('pointerdown', { clientX: 100 }); f.send('pointermove', { clientX: 110 }); f.send('pointerup', { clientX: 110 });
  assert.deepEqual(f.calls, [['start', 'p2'], ['move', 110], ['finish', false]]); f.controller.destroy();
});

test('every gesture ending removes its document and window listeners', () => {
  const counts = new Map();
  const track = (target, name) => {
    const add = target.addEventListener.bind(target); const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, fn, opts) => { counts.set(name, (counts.get(name) || 0) + 1); add(type, fn, opts); };
    target.removeEventListener = (type, fn, opts) => { counts.set(name, (counts.get(name) || 0) - 1); remove(type, fn, opts); };
  };
  const doc = new EventTarget(); doc.defaultView = new EventTarget();
  const element = new EventTarget(); element.ownerDocument = doc;
  element.setPointerCapture = () => {}; element.hasPointerCapture = () => false; element.releasePointerCapture = () => {};
  track(doc, 'doc'); track(doc.defaultView, 'win'); track(element, 'element');
  const controller = createOrganizerPointerDrag(element, { keyAt: () => 'p1', start() {}, move() {}, finish() {} });
  const send = (target, type, props = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { pointerId: 1, clientX: 0, clientY: 0, button: 0, pointerType: 'mouse', isPrimary: true, ...props });
    target.dispatchEvent(e);
  };
  const endings = [
    () => send(doc, 'pointerup'), () => send(doc, 'pointercancel'), () => send(element, 'lostpointercapture'),
    () => doc.defaultView.dispatchEvent(new Event('blur')), () => controller.cancel(),
  ];
  for (const active of [false, true]) {
    for (const ending of endings) {
      send(element, 'pointerdown'); if (active) send(doc, 'pointermove', { clientX: 9 }); ending();
      assert.equal(counts.get('doc') || 0, 0); assert.equal(counts.get('win') || 0, 0);
    }
  }
  send(element, 'pointerdown'); send(doc, 'pointermove', { clientX: 9 }); controller.destroy();
  assert.equal(counts.get('doc') || 0, 0); assert.equal(counts.get('win') || 0, 0); assert.equal(counts.get('element') || 0, 0);
});
