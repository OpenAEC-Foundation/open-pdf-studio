import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
// De echte preferences.js in plaats van de stub van app-test-hooks.
register(`data:text/javascript,${encodeURIComponent(`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/core/preferences.js')) {
    return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8') };
  }
  return nextLoad(url, context);
}`)}`);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { state } = await import('./state.ts');
const { applyDefaultStyle, setAsDefaultStyle } = await import('./preferences.js');
const creators = await import('../tools/annotation-creators.js');
const { createAnnotation } = await import('../annotations/factory.js');
const props = await import('../solid/stores/propertiesStore.js');

function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
}

const STANDAARD = JSON.parse(JSON.stringify(state.preferences));
function verseVoorkeuren() {
  for (const k of Object.keys(state.preferences)) delete state.preferences[k];
  Object.assign(state.preferences, JSON.parse(JSON.stringify(STANDAARD)));
}

for (const type of ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']) {
  test(`${type}: a subject entered before placement survives tool changes and new measurements`, async () => {
    verseVoorkeuren(); openen();
    await props.showToolDefaults(type);
    props.updateAnnotProp('subject', 'Wall A');
    await props.showToolDefaults('line');
    await props.showToolDefaults(type);
    assert.equal(props.annotProps.subject, 'Wall A');
    const ann = creators.createToolAnnotation({type, page:1, measureText:'123 mm'});
    assert.equal(ann.subject, 'Wall A');
    assert.equal(ann.measureText, '123 mm', 'calculated dimension value is unchanged');
    assert.equal(state.documents[0].annotations.length, 0);
    assert.equal(state.documents[0].undoStack.length, 0);
    props.updateAnnotProp('subject', '');
    assert.equal(creators.createToolAnnotation({type}).subject, '', 'clearing is immediate');
    await props.showToolDefaults(type);
    assert.equal(props.annotProps.subject, '');
  });
}

test('area name reaches the real polygon creator without leaking to perimeter or distance', async () => {
  verseVoorkeuren(); openen();
  await props.showToolDefaults('measureArea');
  props.updateAnnotProp('measureName', 'Kitchen');
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:100}];
  const area=creators.createMeasureAreaAnnotation(points);
  assert.equal(area.measureName, 'Kitchen');
  assert.equal(creators.createMeasurePerimeterAnnotation(points).measureName, undefined);
  assert.equal(creators.createAnnotationFromTool('measureDistance',0,0,100,0,{}).measureName, undefined);
  await props.showToolDefaults('measureDistance'); await props.showToolDefaults('measureArea');
  assert.equal(props.annotProps.measureName, 'Kitchen');
  props.updateAnnotProp('measureName', '');
  assert.equal(creators.createMeasureAreaAnnotation(points).measureName, '');
});

test('saved labels do not rename loaded annotations, explicit tool content or existing styles', async () => {
  verseVoorkeuren(); openen();
  await props.showToolDefaults('measureArea');
  props.updateAnnotProp('subject','New subject'); props.updateAnnotProp('measureName','New room');
  const existing=createAnnotation({type:'measureArea',subject:'Existing',measureName:'Office'});
  applyDefaultStyle(existing);
  assert.equal(existing.subject,'Existing'); assert.equal(existing.measureName,'Office');
  const loaded=createAnnotation({type:'measureArea'});
  assert.equal(loaded.subject,''); assert.equal(loaded.measureName,undefined);
  const explicit=creators.createToolAnnotation({type:'measureArea',subject:'',measureName:'Explicit'});
  assert.equal(explicit.subject,''); assert.equal(explicit.measureName,'Explicit');
  assert.equal(creators.createToolAnnotation({type:'line'}).subject,'');
  setAsDefaultStyle(existing);
  assert.equal(creators.createToolAnnotation({type:'measureArea'}).measureName,'New room');
});

test('editing an existing measurement label does not change the pre-placement default', async () => {
  verseVoorkeuren(); openen();
  await props.showToolDefaults('measureArea'); props.updateAnnotProp('measureName','Default');
  const existing=creators.createToolAnnotation({type:'measureArea',page:1,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]});
  state.documents[0].annotations.push(existing);
  props.storeShowProperties(existing); props.updateAnnotProp('measureName','Existing only');
  assert.equal(existing.measureName,'Existing only');
  assert.equal(creators.createMeasureAreaAnnotation(existing.points).measureName,'Default');
});
