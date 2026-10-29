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
