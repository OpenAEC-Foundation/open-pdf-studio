import test from 'node:test';
import assert from 'node:assert/strict';
import { areaVertexHit, editAreaVertex } from './area-vertices.js';
const square = () => ({ id: 'a', type: 'measureArea', points: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}] });
test('right-click splits at the projected cursor; double-click uses midpoint', () => {
  const a=square(), hit=areaVertexHit(a,27,2,4);
  assert.equal(hit.kind,'areaEdge');
  assert.deepEqual(editAreaVertex(a,hit).points[1],{x:27,y:0});
  assert.deepEqual(editAreaVertex(a,hit,true).points[1],{x:50,y:0});
  assert.equal(a.points.length,4);
});
test('closing edge and holes are editable without changing other rings', () => {
  const a=square(); a.holes=[[{x:20,y:20},{x:40,y:20},{x:40,y:40},{x:20,y:40}]];
  assert.equal(editAreaVertex(a,areaVertexHit(a,0,50,4)).points.length,5);
  const h=areaVertexHit(a,20,30,4); assert.equal(h.holeIndex,0);
  assert.equal(editAreaVertex(a,h).holes[0].length,5);
  assert.equal(a.holes[0].length,4);
});
test('vertex wins over nearby edges and contours retain at least three vertices', () => {
  let a=square(); const hit=areaVertexHit(a,1,1,4);
  assert.equal(hit.kind,'areaVertex');
  a={...a,...editAreaVertex(a,hit)};
  assert.equal(a.points.length,3);
  assert.equal(editAreaVertex(a,areaVertexHit(a,100,0,4)),null);
});
test('locked, foreign, invalid, degenerate and curved edits are rejected', () => {
  const a=square(), h=areaVertexHit(a,50,0,4);
  assert.equal(editAreaVertex({...a,locked:true},h),null);
  assert.equal(editAreaVertex(a,{...h,annotationId:'other'}),null);
  assert.equal(editAreaVertex(a,{...h,edgeIndex:9}),null);
  assert.equal(editAreaVertex(a,{...h,point:{x:0,y:0}}),null);
  assert.equal(areaVertexHit({...a,type:'polygon'},50,0,4),null);
  assert.equal(areaVertexHit(a,50,50,4),null);
  a.points[1].arc=true;
  assert.equal(areaVertexHit(a,50,0,4),null);
  assert.equal(editAreaVertex(a,h),null);
  assert.equal(editAreaVertex(a,areaVertexHit(a,0,0,4)),null);
});
test('removing a corner refreshes the cached box that places the rotate grip', () => {
  const a = { ...square(), x: 0, y: 0, width: 100, height: 100 };
  const change = editAreaVertex(a, areaVertexHit(a, 100, 100, 4));
  assert.deepEqual(change.points, [{x:0,y:0},{x:100,y:0},{x:0,y:100}]);
  assert.deepEqual([change.x, change.y, change.width, change.height], [0, 0, 100, 100]);
  const b = { ...square(), x: 0, y: 0, width: 100, height: 100, points: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:50,y:150},{x:0,y:100}] };
  const c = editAreaVertex(b, areaVertexHit(b, 50, 150, 4));
  assert.equal(c.height, 100, 'the box shrinks with the removed tip');
  // An area without a cached box keeps none; a hole edit leaves the box alone.
  assert.equal('x' in editAreaVertex(square(), areaVertexHit(square(), 50, 0, 4)), false);
  const h = { ...square(), x: 0, y: 0, width: 100, height: 100, holes: [[{x:20,y:20},{x:40,y:20},{x:40,y:40},{x:20,y:40}]] };
  assert.equal('x' in editAreaVertex(h, areaVertexHit(h, 30, 20, 4)), false);
});
test('the hit reach is the same in screen pixels at every zoom', async () => {
  const { AREA_VERTEX_HIT_PX } = await import('./area-vertices.js');
  for (const zoom of [0.25, 1, 4]) {
    const reach = AREA_VERTEX_HIT_PX / zoom;
    assert.equal(areaVertexHit(square(), 50, reach * 0.9, reach)?.kind, 'areaEdge', `binnen bij zoom ${zoom}`);
    assert.equal(areaVertexHit(square(), 50, reach * 1.1, reach), null, `buiten bij zoom ${zoom}`);
  }
});
