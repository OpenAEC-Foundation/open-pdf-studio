import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { PDFDocument } from 'pdf-lib';

// Test the real print-PDF builder with an offscreen-renderer boundary double:
// no OS printer is contacted and no browser app is launched.
const stubs = {
  '../i18n/config.js': 'export default {t:k=>k};',
  '../core/state.js': 'export const getActiveDocument=()=>globalThis.__printDoc; export const getPageRotation=()=>90;',
  '../core/platform.js': 'export const invoke=()=>{}, isNietInBrowser=()=>true, readBinaryFile=()=>{}, writeBinaryFile=()=>{}, opgeslagenPad=()=>{}, leesHostPad=()=>{}, leesHostNieuwPad=()=>{}, extractFileName=()=>{};',
  '../core/webfuncties.js': 'export const meldingTekst=()=>{};',
  './exporter.js': `export const renderPageOffscreen=async (...args)=>{globalThis.__renders.push(args);return {width:args[2].deel.breedte,height:args[2].deel.hoogte};}; export const renderMarkeringenOffscreen=()=>{}; export const canvasToBytes=async()=>Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDOsAAAAASUVORK5CYII=','base64'));`,
  './loader.js': 'export const getCachedPdfBytes=()=>{};',
  './print-vector.js': 'export const bouwVectorPrintPdf=()=>{}, maakTegelRaster=()=>{}, vakkenUitRaster=()=>{}, vakOpVel=()=>{};',
  '../solid/stores/print-instellingen.js': "export const markeringenVoorInhoud=i=>i!=='doc-only';",
  './print-meerperblad.js': 'export const maakMeerPerBlad=()=>{}, isMeerPerBlad=()=>{}, bronKeuzes=()=>{};',
  './print-poster.js': 'export const maakPoster=()=>{};',
  './print-boekje.js': 'export const maakBoekje=()=>{};',
  './print-kleur.js': "export const zetCanvasOm=c=>c, beeldFormaatVoor=()=> 'png', vectorMogelijk=()=>true;",
  '../solid/stores/printProgressStore.js': 'export const startPrintProgress=()=>{}, updatePrintProgress=()=>{}, finishPrintProgress=()=>{}, failPrintProgress=()=>{};',
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/print-job.js') && stubs[specifier]) return { url:'data:text/javascript,'+encodeURIComponent(stubs[specifier]),shortCircuit:true };
  return next(specifier,context);
}});
const { bouwPrintPdf } = await import('./print-job.js');
const doc = { id:'drawing', pdfDoc: { getPage: async()=>({rotate:0,getViewport:()=>({width:600,height:800})}) } };
globalThis.__printDoc=doc;
globalThis.document={createElement:()=>({getContext:()=>({setTransform(){},drawImage(){},translate(){},rotate(){}})})};

test('print-to-PDF uses only the visible region, carries markups and follows view rotation', async()=>{
  globalThis.__renders=[];
  const currentView={docId:doc.id,pageNum:2,rect:{x:100,y:200,width:120,height:80},rotation:90};
  const {pdf}=await bouwPrintPdf({doc,pages:[2],vel:'pagina',orientatie:'auto',currentView});
  const reloaded=await PDFDocument.load(await pdf.save());
  assert.equal(reloaded.getPageCount(),1);
  const size=reloaded.getPage(0).getSize();
  assert.ok(Math.abs(size.width-80)<0.01);
  assert.ok(Math.abs(size.height-120)<0.01);
  const [page,scale,options]=globalThis.__renders[0];
  assert.equal(page,2);assert.equal(options.markeringen,true);
  assert.equal(options.deel.x,100*scale);assert.equal(options.deel.y,200*scale);
  assert.ok(options.deel.breedte<600*scale);
  assert.ok(options.deel.hoogte<800*scale);
});
test('existing whole-page and document-only print choices retain their behavior', async()=>{
  globalThis.__renders=[];
  const {pdf}=await bouwPrintPdf({doc,pages:[1],vel:'pagina',inhoud:'doc-only'});
  assert.equal(pdf.getPage(0).getWidth(),600);
  assert.ok(Math.abs(pdf.getPage(0).getHeight()-800)<0.01);
  assert.equal(globalThis.__renders[0][2].markeringen,false);
});
test('a captured view cannot accidentally print another document or page', async()=>{
  const currentView={docId:'other',pageNum:1,rect:{x:0,y:0,width:10,height:20},rotation:0};
  await assert.rejects(bouwPrintPdf({doc,pages:[1],currentView}),/different document/);
  await assert.rejects(bouwPrintPdf({doc,pages:[2],currentView:{...currentView,docId:doc.id}}),/different document or page/);
});
