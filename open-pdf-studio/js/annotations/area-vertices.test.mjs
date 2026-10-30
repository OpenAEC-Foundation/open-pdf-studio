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
