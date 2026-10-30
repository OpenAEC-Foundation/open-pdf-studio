import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPlacement, previewHit } from './watermark-preview.js';
import { watermarkTextPlacement } from './watermark-layout.js';
import { weergaveLagen } from '../annotations/rendering/uitvoer-lagen.js';

test('preview text uses the saved placement including rotated auto-fit and custom zero', () => {
  for (const extra of [{}, {autoFit:true,rotation:45}, {position:'custom',customX:0,customY:0}]) {
    const wm={type:'textWatermark',text:'Proof',fontFamily:'Helvetica',fontSize:32,position:'center',...extra};
    const {height,...placed}=previewPlacement(wm,600,800);
    assert.ok(height>0); assert.deepEqual(placed,watermarkTextPlacement(wm,600,800));
    assert.equal(previewHit(wm,600,800,placed.x,placed.y),true);
    assert.equal(previewHit(wm,600,800,placed.x+1000,placed.y+1000),false);
  }
});
test('image hit testing uses scale and inverse rotation, not an unrotated box', () => {
  const wm={type:'imageWatermark',width:100,height:20,scale:2,rotation:90,position:'center'};
  assert.equal(previewHit(wm,600,800,300,480),true);
  assert.equal(previewHit(wm,600,800,380,400),false);
  assert.equal(previewHit(wm,600,800,300,520),false);
});
test('preview can cache annotations separately without watermarks or editing handles', () => {
  const layers=weergaveLagen({uitvoer:true,watermerken:false});
  assert.equal(layers.watermerken,false); assert.equal(layers.markeringen,true);
  assert.equal(layers.tekstbewerkingen,true); assert.equal(layers.selectie,false);
  assert.equal(weergaveLagen({uitvoer:true}).watermerken,true);
});
