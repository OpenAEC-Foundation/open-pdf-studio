import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state, getActiveDocument } = await import('../../core/state.js');
const { tekenDocument } = await import('./document-context.js');
const { metPaneelStand } = await import('../../pdf/split-view/paneel-weergave.js');
const { getMeasureScale } = await import('../measurement.js');
const { paginaMaat, weergaveRotatie } = await import('../../pdf/weergave-ruimte.js');
const { isAnnotationHiddenInView, isAnnotationHiddenInOutput } = await import('../view-filters.js');

test('elk paneel gebruikt eigen schaal, paginamaten en lagen zonder het actieve document te wijzigen', () => {
  state.documents = [
    { id:'A', annotations:[], measureScale:{pixelsPerUnit:2,unit:'mm'}, pageDims:{1:{widthPt:100,heightPt:200}}, annotationLayers:[] },
    { id:'B', annotations:[], measureScale:{pixelsPerUnit:4,unit:'m'}, pageDims:{1:{widthPt:300,heightPt:400}}, annotationLayers:[] },
  ];
  state.activeDocumentIndex = 0;
  const [a,b] = state.documents;
  a.annotationLayers=[{id:'notes',visible:false,printable:true}];
  b.annotationLayers=[{id:'notes',visible:true,printable:false}];
  assert.equal(tekenDocument(),a);
  assert.equal(getMeasureScale(1,10,10).pixelsPerUnit,2);
  metPaneelStand(b,{schaal:3,rotatie:90},()=>{
    assert.equal(tekenDocument(),b);
    assert.equal(isAnnotationHiddenInView({type:'box',layer:'notes'}),false);
    assert.equal(isAnnotationHiddenInOutput({type:'box',layer:'notes'}),true);
    assert.equal(getActiveDocument(),a,'opslaan en undo blijven op A');
    assert.deepEqual(getMeasureScale(1,10,10),{pixelsPerUnit:4,unit:'m',method:'document'});
    assert.equal(paginaMaat(1).breedte,300);
    assert.equal(weergaveRotatie(),90);
    assert.throws(()=>metPaneelStand(a,{schaal:1,rotatie:0},()=>{
      assert.equal(tekenDocument(),a);
      assert.equal(getMeasureScale(1,10,10).pixelsPerUnit,2);
      throw new Error('paint failed');
    }),/paint failed/);
    assert.equal(tekenDocument(),b,'geneste fout herstelt het buitenste paneel');
  });
  assert.equal(tekenDocument(),a);
  assert.equal(state.activeDocumentIndex,0);
  assert.equal(isAnnotationHiddenInView({type:'box',layer:'notes'}),true);
  assert.equal(getMeasureScale(1,10,10).pixelsPerUnit,2);
});

test('een tekencontext lekt niet door naar een async vervolg', async()=>{
  const [a,b]=state.documents;
  await metPaneelStand(b,{schaal:1,rotatie:0},async()=>{
    assert.equal(tekenDocument(),b);
    await Promise.resolve();
    assert.equal(tekenDocument(),a);
  });
});
