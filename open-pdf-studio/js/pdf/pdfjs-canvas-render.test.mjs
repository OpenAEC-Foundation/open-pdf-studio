import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPdfJsCanvas } from './pdfjs-canvas-render.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const events = [], tasks = [];
  const context = {setTransform(){},fillRect(){}};
  const canvas = {style:{},getContext:()=>context,set width(v){events.push(['width',v]);},set height(v){events.push(['height',v]);}};
  let active = false;
  const page = {render(options){
    assert.equal(active,false,'PDF.js canvas ownership cannot overlap');active=true;
    const done=deferred();const task={options,promise:done.promise,finish(){active=false;done.resolve();},cancel(){events.push(['cancel']);},settleCancellation(){active=false;done.reject(Object.assign(new Error('cancelled'),{name:'RenderingCancelledException'}));},fail(error){active=false;done.reject(error);}};
    tasks.push(task);events.push(['render',options.viewport.width]);return task;
  }};
  const draw=(width,extra={})=>renderPdfJsCanvas({page,canvas,viewport:{width,height:80},dpr:2,renderOptions:async()=>({}),...extra});
  return {canvas,tasks,events,draw,page};
}
test('new zoom waits for cancellation before clearing/resizing the shared canvas',async()=>{
 const f=fixture();const first=f.draw(100);await tick();const second=f.draw(200);await tick();
 assert.deepEqual(f.events,[['width',200],['height',160],['render',100],['cancel']]);
 f.tasks[0].settleCancellation();assert.equal(await first,false);await tick();assert.equal(f.tasks.length,2);
 f.tasks[1].finish();assert.equal(await second,true);assert.equal(f.canvas.style.width,'200px');
});
test('a burst drops an intermediate zoom and waits for the original owner',async()=>{
 const f=fixture();const a=f.draw(100);await tick();const b=f.draw(200);const c=f.draw(300);await tick();assert.equal(f.tasks.length,1);
 f.tasks[0].settleCancellation();assert.equal(await a,false);assert.equal(await b,false);await tick();assert.deepEqual(f.tasks.map(t=>t.options.viewport.width),[100,300]);f.tasks[1].finish();assert.equal(await c,true);
});
test('superseded async layer options never start an old render or resize',async()=>{
 const f=fixture(),options=deferred();const a=f.draw(100,{renderOptions:()=>options.promise});const b=f.draw(200);await tick();assert.deepEqual(f.events,[]);
 options.resolve({});assert.equal(await a,false);await tick();assert.equal(f.tasks.length,1);assert.equal(f.tasks[0].options.viewport.width,200);f.tasks[0].finish();assert.equal(await b,true);
});
test('independent canvases render concurrently and preserve options/resize anchor',async()=>{
 const a=fixture(),b=fixture();let resized=false;const x=a.draw(100,{onResize:()=>{resized=true;},renderOptions:async()=>({optionalContentConfigPromise:'layers'})});const y=b.draw(200);await tick();assert.equal(resized,true);assert.equal(a.tasks[0].options.optionalContentConfigPromise,'layers');a.tasks[0].finish();b.tasks[0].finish();assert.equal(await x,true);assert.equal(await y,true);
});
test('real render failures propagate and the next render can recover',async()=>{
 const f=fixture();const a=f.draw(100);const check=assert.rejects(a,/broken/);await tick();f.tasks[0].fail(new Error('broken'));await check;
 const b=f.draw(200);await tick();f.tasks[1].finish();assert.equal(await b,true);
});

test('large zoom keeps the CSS viewport and limits the physical canvas area and axes', async () => {
  const f = fixture();
  const draw = f.draw(24000, { viewport: { width: 24000, height: 12000 } });
  await tick();
  const width = f.events.find(([key]) => key === 'width')[1];
  const height = f.events.find(([key]) => key === 'height')[1];
  assert.ok(width <= 16384 && width * height <= 16777216);
  assert.equal(f.canvas.style.width, '24000px');
  assert.equal(f.canvas.style.height, '12000px');
  const [sx, , , sy] = f.tasks[0].options.transform;
  assert.equal(sx, width / 24000);
  assert.equal(sy, height / 12000);
  f.tasks[0].finish();
  assert.equal(await draw, true);
});
