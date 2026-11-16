import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpacePanHandlers } from './space-pan-policy.js';

const pdf = { closest: s => s === '#pdf-container' ? {} : null };
const body = { closest: () => null };
function event(extra = {}) {
  return { key: ' ', code: 'Space', target: body, button: 0, buttons: 1, pointerId: 7,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...extra };
}
function harness() {
  const s = { doc: {}, blocked: false, panning: false, held: false, starts: 0, stops: 0, tool: 'line' };
  const h = createSpacePanHandlers({ getDocument: () => s.doc, blocked: () => s.blocked,
    isPanning: () => s.panning, setHeld: v => { s.held = v; },
    startPan: () => { s.starts++; s.panning = true; return () => { s.stops++; s.panning = false; }; },
  });
  return { h, s, down: () => h.onPointerDown(event({ target: pdf })) };
}
test('Space + left drag pans repeatedly without changing the chosen tool', () => {
  const {h,s,down} = harness(); const key = event(); h.onKeyDown(key);
  assert.equal(key.defaultPrevented, true); assert.equal(s.held, true);
  down(); assert.equal(s.starts, 1);
  h.onPointerUp(event()); assert.equal(s.panning, false); assert.equal(s.held, true);
  const click = event({target: pdf}); h.onClick(click); assert.equal(click.defaultPrevented, true);
  down(); h.onKeyUp(event()); assert.equal(s.panning, false); assert.equal(s.held, false);
  assert.equal(s.starts, 2); assert.equal(s.stops, 2); assert.equal(s.tool, 'line');
  const up = event(); h.onPointerUp(up); assert.equal(up.stopped, true);
});
test('Space remains available to input, contenteditable, buttons, links and IME', () => {
  for (const target of [{tagName:'INPUT'}, {tagName:'TEXTAREA'}, {isContentEditable:true},
    {closest:s => s.includes('button') ? {} : null}]) {
    const {h,s,down} = harness(); const e = event({target}); h.onKeyDown(e); down();
    assert.equal(s.starts,0); assert.equal(e.defaultPrevented,undefined);
  }
  for (const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{isComposing:true},{repeat:true},{defaultPrevented:true}]) {
    const {h,s,down} = harness(); h.onKeyDown(event(extra)); down(); assert.equal(s.starts,0);
  }
});
test('no document, modal, edit or existing interaction does not arm a pan', () => {
  for (const setup of [s=>s.doc=null,s=>s.blocked=true,s=>s.panning=true]) {
    const {h,s,down}=harness(); setup(s); h.onKeyDown(event()); down(); assert.equal(s.starts,0);
  }
});
test('only a left mouse/pen drag inside the document starts panning', () => {
  for (const extra of [{target:body},{button:1,buttons:4},{buttons:3},{pointerType:'touch'},
    {target:{closest:s=>s==='#pdf-container'||s==='.compare-view'?{}:null}}]) {
    const {h,s}=harness(); h.onKeyDown(event()); h.onPointerDown(event({target:pdf,...extra})); assert.equal(s.starts,0);
  }
});
test('release, cancel, focus loss and a missed release stop only the owned gesture', () => {
  for (const cancel of [h=>h.onKeyUp(event()),h=>h.reset(),h=>h.onPointerCancel(event()),
    h=>h.onPointerMove(event({buttons:0}))]) {
    const {h,s,down}=harness(); h.onKeyDown(event()); down(); cancel(h);
    assert.equal(s.panning,false); assert.equal(s.stops,1); h.reset(); assert.equal(s.stops,1);
  }
  const {h,s}=harness(); s.panning=true; h.reset(); assert.equal(s.panning,true);
});
test('tab switch or modal opened while held cancels before the next movement', () => {
  for (const change of [s=>s.doc={},s=>s.blocked=true]) {
    const {h,s,down}=harness(); h.onKeyDown(event()); down(); change(s);
    h.onPointerMove(event()); assert.equal(s.panning,false); assert.equal(s.held,false);
  }
});
test('unrelated pointer release does not end the pan; repeated Space does not restart it', () => {
  const {h,s,down}=harness(); h.onKeyDown(event()); down(); h.onKeyDown(event({repeat:true}));
  h.onPointerUp(event({pointerId:8})); assert.equal(s.panning,true); assert.equal(s.starts,1);
});

test('Space release consumes the remaining drag and a lost capture cancels ownership', () => {
  const {h,s,down}=harness(); h.onKeyDown(event()); down(); h.onKeyUp(event());
  const move=event(); h.onPointerMove(move); assert.equal(move.stopped,true);
  const up=event(); h.onPointerUp(up); assert.equal(up.stopped,true);
  h.onKeyDown(event()); down(); h.onLostPointerCapture(event());
  assert.equal(s.panning,false); assert.equal(s.held,false);
});
test('links can be panned over without navigation; outside keyboard clicks remain available', () => {
  const {h,s}=harness(); h.onKeyDown(event());
  const link={closest:s=>s==='#pdf-container'||s.includes('a,')?{}:null};
  h.onPointerDown(event({target:link})); assert.equal(s.starts,1); h.onPointerUp(event());
  const outside=event(); h.onClick(outside); assert.equal(outside.defaultPrevented,undefined);
  const click=event({target:link}); h.onClick(click); assert.equal(click.defaultPrevented,true);
});

test('Space stays with any focused keyboard control outside the page view', () => {
  // A properties-panel section header: a div with tabindex and no role.
  const header = { tagName: 'DIV', closest: s => (s.includes('[tabindex]') ? {} : null) };
  const inPage = { tagName: 'DIV', closest: s => (s.includes('[tabindex]') || s === '#pdf-container' ? {} : null) };
  for (const [target, arms] of [[header, false], [inPage, true]]) {
    let held = false, consumed = false;
    const h = createSpacePanHandlers({
      getDocument: () => ({}), blocked: () => false, isPanning: () => false,
      setHeld: v => { held = v; }, start: () => () => {},
    });
    h.onKeyDown({ code: 'Space', key: ' ', target, preventDefault() { consumed = true; }, stopPropagation() {} });
    assert.equal(held, arms);
    assert.equal(consumed, arms);
  }
});
