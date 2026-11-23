// A rotated callout keeps its leader on the box, and rotating it turns box,
// knee and arrow together (#1240).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { draaiPunt, calloutLeider, zetCalloutLeider, zetCalloutRotatie } from './callout-draaien.js';

const bijna = (a, b, wat = '') => assert.ok(Math.abs(a - b) < 1e-6, `${wat} ${a} is not ${b}`);
const callout = (extra = {}) => ({ type: 'callout', x: 100, y: 100, width: 150, height: 50, arrowX: 20, arrowY: 125, ...extra });

/** Is the point on the edge of the box as it lies on the page? */
function opRand(ann, x, y) {
  const cx = ann.x + ann.width / 2;
  const cy = ann.y + ann.height / 2;
  const p = draaiPunt(x, y, cx, cy, -(ann.rotation || 0));
  const binnenX = p.x >= ann.x - 1e-6 && p.x <= ann.x + ann.width + 1e-6;
  const binnenY = p.y >= ann.y - 1e-6 && p.y <= ann.y + ann.height + 1e-6;
  const opX = Math.abs(p.x - ann.x) < 1e-6 || Math.abs(p.x - (ann.x + ann.width)) < 1e-6;
  const opY = Math.abs(p.y - ann.y) < 1e-6 || Math.abs(p.y - (ann.y + ann.height)) < 1e-6;
  return (opX && binnenY) || (opY && binnenX);
}

test('an unrotated callout keeps the leader it always had', () => {
  const links = calloutLeider(callout());
  assert.deepEqual([links.armOriginX, links.armOriginY], [100, 125], 'left edge, vertical centre');
  bijna(links.kneeX, 70); bijna(links.kneeY, 125);
  const onder = calloutLeider(callout({ arrowX: 175, arrowY: 300 }));
  assert.deepEqual([onder.armOriginX, onder.armOriginY], [175, 150], 'bottom edge, horizontal centre');
  assert.equal(onder.vertical, true);
});

test('the leader starts on the edge of the box at every angle', () => {
  for (const rotation of [0, 30, 45, 90, 135, 180, 270, -60]) {
    for (const [arrowX, arrowY] of [[20, 125], [400, 60], [175, 320], [150, -80]]) {
      const ann = zetCalloutLeider(callout({ rotation, arrowX, arrowY }));
      assert.ok(opRand(ann, ann.armOriginX, ann.armOriginY), `rotation ${rotation}, arrow ${arrowX},${arrowY}`);
      assert.ok(Number.isFinite(ann.kneeX) && Number.isFinite(ann.kneeY));
    }
  }
});

test('rotating the callout turns the arrow tip about the centre of the box', () => {
  const ann = zetCalloutLeider(callout());
  const afstand = Math.hypot(ann.arrowX - 175, ann.arrowY - 125);
  zetCalloutRotatie(ann, 90);
  assert.equal(ann.rotation, 90);
  // The tip was 155 left of the centre; a quarter turn puts it 155 above it.
  bijna(ann.arrowX, 175, 'x'); bijna(ann.arrowY, 125 - 155, 'y');
  bijna(Math.hypot(ann.arrowX - 175, ann.arrowY - 125), afstand, 'distance to the centre');
  assert.ok(opRand(ann, ann.armOriginX, ann.armOriginY), 'still attached');
});

test('box, knee and arrow keep their shape through the turn', () => {
  const ann = zetCalloutLeider(callout({ arrowX: 20, arrowY: 180 }));
  const voor = { arm: [ann.armOriginX, ann.armOriginY], knie: [ann.kneeX, ann.kneeY], tip: [ann.arrowX, ann.arrowY] };
  zetCalloutRotatie(ann, 45);
  for (const [naam, [x, y]] of Object.entries(voor)) {
    const verwacht = draaiPunt(x, y, 175, 125, 45);
    const na = naam === 'arm' ? [ann.armOriginX, ann.armOriginY] : naam === 'knie' ? [ann.kneeX, ann.kneeY] : [ann.arrowX, ann.arrowY];
    bijna(na[0], verwacht.x, `${naam} x`); bijna(na[1], verwacht.y, `${naam} y`);
  }
});

test('setting the rotation again later keeps the connection, and turning back returns the arrow', () => {
  const ann = zetCalloutLeider(callout());
  zetCalloutRotatie(ann, 45);
  zetCalloutRotatie(ann, 120);
  assert.ok(opRand(ann, ann.armOriginX, ann.armOriginY));
  zetCalloutRotatie(ann, 0);
  bijna(ann.arrowX, 20); bijna(ann.arrowY, 125);
  assert.deepEqual([Math.round(ann.armOriginX), Math.round(ann.armOriginY)], [100, 125]);
});

test('after rotating, dragging the arrow tip re-attaches the leader to the rotated box', () => {
  const ann = zetCalloutRotatie(zetCalloutLeider(callout()), 45);
  ann.arrowX = 400; ann.arrowY = 300; // the user drags the tip
  zetCalloutLeider(ann);
  assert.ok(opRand(ann, ann.armOriginX, ann.armOriginY));
  assert.deepEqual([ann.arrowX, ann.arrowY], [400, 300], 'the tip stays where it was dragged');
});

test('every way of rotating a callout goes through this rule', () => {
  const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(lees('./transforms.js'), /zetCalloutLeider\(annotation\)/);
  assert.match(lees('./z-order.js'), /zetCalloutRotatie\(annotation,/);
  const store = lees('../solid/stores/propertiesStore.js');
  assert.equal((store.match(/zetCalloutRotatie\(/g) || []).length, 2, 'single and multiple selection');
});
