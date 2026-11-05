import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAlignmentMoves } from './page-alignment.js';
import { rectNaarWeergave, weergaveMaat } from '../pdf/weergave-rotatie.js';
const entry = (x, y, width = 20, height = 30) => ({ ann: {}, bounds: { x, y, width, height } });
const near = (a, b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);
test('all six edges align a single box in each view rotation', () => {
  for (const r of [0,90,180,270]) for (const edge of ['left','center','right','top','middle','bottom']) {
    const e=entry(40,70), [m]=pageAlignmentMoves([e],400,600,r,edge);
    const b=rectNaarWeergave({...e.bounds,x:e.bounds.x+m.dx,y:e.bounds.y+m.dy},400,600,r);
    const s=weergaveMaat(400,600,r);
    near(({left:b.x,center:b.x+b.width/2,right:b.x+b.width,top:b.y,middle:b.y+b.height/2,bottom:b.y+b.height})[edge],({left:0,center:s.breedte/2,right:s.breedte,top:0,middle:s.hoogte/2,bottom:s.hoogte})[edge]);
  }
});
test('group displacement preserves spacing, including objects outside the page', () => {
  const e=[entry(-40,50),entry(100,120)];const m=pageAlignmentMoves(e,400,600,0,'left');
  assert.deepEqual(m.map(x=>[x.dx,x.dy]),[[40,0],[40,0]]);
});
test('individual mode aligns each member separately', () => {
  const m=pageAlignmentMoves([entry(40,50),entry(100,120)],400,600,0,'left',true);
  assert.deepEqual(m.map(x=>x.dx),[-40,-100]);
});
test('already aligned, empty and invalid inputs make no edits', () => {
  for (const args of [[[],400,600,0,'left'],[[entry(0,1)],400,600,0,'left'],[[entry(NaN,1)],400,600,0,'left'],[[entry(1,1)],0,600,0,'left'],[[entry(1,1)],400,600,0,'invalid']]) assert.deepEqual(pageAlignmentMoves(...args),[]);
});
