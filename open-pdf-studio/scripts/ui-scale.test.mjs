import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleUiValue, uiScaleCss } from './ui-scale-css.mjs';
import { normalizeUiScale } from '../js/core/ui-scale.js';
import { readFileSync, readdirSync } from 'node:fs';
// Node has no window: give globalThis the event methods the app code uses.
if (typeof globalThis.addEventListener !== 'function') {
  const doel = new EventTarget();
  globalThis.addEventListener = doel.addEventListener.bind(doel);
  globalThis.removeEventListener = doel.removeEventListener.bind(doel);
  globalThis.dispatchEvent = doel.dispatchEvent.bind(doel);
}
test('only supported persisted UI sizes are accepted', () => {
  for (const n of [100,125,150,175,200]) assert.equal(normalizeUiScale(String(n)),n);
  for (const n of [0,99,Infinity,NaN,null,{},'large',201]) assert.equal(normalizeUiScale(n),100);
});
test('CSS dimensions scale together, leaving zero, percentages and non-dimensions alone', () => {
  assert.equal(scaleUiValue('padding','2px 0px 4px 5%'),'calc(2px * var(--ui-scale, 1)) 0px calc(4px * var(--ui-scale, 1)) 5%');
  assert.equal(scaleUiValue('margin-left','-1.5px'),'calc(-1.5px * var(--ui-scale, 1))');
  assert.equal(scaleUiValue('background','url("20px.png")'),'url("20px.png")');
  const once=scaleUiValue('height','20px');assert.equal(scaleUiValue('height',once),once);
});
test('the plugin excludes PDF geometry, text/form layers and mobile styles', () => {
  const plugin=uiScaleCss();
  const run=(file,selector)=>{const d={source:{input:{file:'/app/styles/'+file}},parent:{selector},prop:'width',value:'100px'};plugin.Declaration(d);return d.value;};
  for (const file of ['text-layer.css','form-layer.css','mobile.css','layout.css']) assert.equal(run(file,'.pdf-page'),'100px');
  assert.match(run('ribbon.css','.ribbon-tab'),/--ui-scale/);
  assert.match(run('layout.css','.left-panel'),/--ui-scale/);
});
test('every interface language has the new preference label',()=>{
  const root=new URL('../js/i18n/locales/',import.meta.url);
  for(const lang of readdirSync(root)) assert.ok(JSON.parse(readFileSync(new URL(lang+'/preferences.json',root))).general.interfaceScale.trim(),lang);
});

// Review #883: context menus scale with the rest of the chrome (their
// position is measured and clamped), RTL overrides scale like the rules they
// mirror, and the screen-calibration bar stays in real screen pixels.
test('context menus and RTL overrides scale, the calibration bar does not', () => {
  const plugin=uiScaleCss();
  const run=(file,selector,prop='width',value='100px')=>{const d={source:{input:{file:'C:\\app\\styles\\'+file}},parent:{selector},prop,value};plugin.Declaration(d);return d.value;};
  assert.match(run('context-menu.css','.context-menu','font-size','12px'),/--ui-scale/);
  assert.match(run('rtl.css','[dir="rtl"] .ribbon-group','margin-left','8px'),/--ui-scale/);
  assert.equal(run('dialogs.css','.screen-cal-tick','margin-left','-1px'),'-1px');
  assert.equal(run('dialogs.css','.screen-cal-ruler','height','28px'),'28px');
  assert.match(run('dialogs.css','.screen-cal-text','max-width','520px'),/--ui-scale/);
});

test('a submenu that would leave the window flips to the left and moves up', async () => {
  const { submenuPlaatsing } = await import('../js/solid/components/submenu-plaatsing.js');
  const item={left:600,right:800,top:100,bottom:124};
  // Fits on the right: lines up with the item, no scrollbar.
  assert.deepEqual(submenuPlaatsing({width:200,height:200},item,1200,800,{inzet:3}),{left:800,top:97,maxHoogte:null,naarLinks:false});
  // Past the right edge: flips.
  assert.deepEqual(submenuPlaatsing({width:300,height:200},item,1000,800),{left:300,top:100,maxHoogte:null,naarLinks:true});
  // No room on either side: the side with most room, clamped to the window.
  const smal=submenuPlaatsing({width:900,height:10},{left:150,right:350,top:0},1000,800);
  assert.equal(smal.naarLinks,false);assert.equal(smal.left,96);
  // 100 px too low: moves up exactly that far.
  assert.equal(submenuPlaatsing({width:10,height:296},{...item,top:600},1000,800).top,500);
  // Taller than the window: window height minus the margins, and it scrolls.
  assert.deepEqual(submenuPlaatsing({width:10,height:1170},{...item,top:30},1000,800),{left:800,top:4,maxHoogte:792,naarLinks:false});
});

test('a right-to-left submenu prefers the left and flips to the right', async () => {
  const { submenuPlaatsing } = await import('../js/solid/components/submenu-plaatsing.js');
  const item={left:600,right:800,top:100};
  assert.equal(submenuPlaatsing({width:200,height:10},item,1200,800,{voorkeurLinks:true}).naarLinks,true);
  const rechts=submenuPlaatsing({width:200,height:10},{...item,left:100,right:300},1200,800,{voorkeurLinks:true});
  assert.equal(rechts.naarLinks,false);assert.equal(rechts.left,300);
});

// Release gate 2026.44.6: at 200% the annotation menu was 1341 px tall in a
// window of 1100 px, so its bottom items could not be reached.
test('a menu taller than the window gets the window height and stays inside', async () => {
  const { menuPlaatsing } = await import('../js/solid/components/submenu-plaatsing.js');
  assert.deepEqual(menuPlaatsing({x:914,y:600,breedte:452,hoogte:1341},1800,1100),{left:914,top:4,maxHoogte:1092});
  for (const [x,y] of [[0,0],[1799,1099],[-20,-20],[1500,700]]) {
    const p=menuPlaatsing({x,y,breedte:452,hoogte:1341},1800,1100);
    assert.ok(p.left>=4&&p.left+452<=1796,'horizontal '+x);
    assert.ok(p.top>=4&&p.top+p.maxHoogte<=1096,'vertical '+y);
  }
});

test('a menu that fits keeps its spot, or shifts only as far as needed, without a scrollbar', async () => {
  const { menuPlaatsing } = await import('../js/solid/components/submenu-plaatsing.js');
  assert.deepEqual(menuPlaatsing({x:100,y:200,breedte:227,hoogte:671},1800,1100),{left:100,top:200,maxHoogte:null});
  assert.deepEqual(menuPlaatsing({x:1700,y:600,breedte:227,hoogte:671},1800,1100),{left:1569,top:425,maxHoogte:null});
  // Exactly the room there is: no scrollbar.
  assert.equal(menuPlaatsing({x:0,y:0,breedte:10,hoogte:1092},1800,1100).maxHoogte,null);
  // A window narrower than the menu: the start of the menu stays visible.
  assert.equal(menuPlaatsing({x:50,y:0,breedte:500,hoogte:10},300,300).left,4);
});

test('the stylesheet lets menus scroll, and fixes submenus so a scrolling menu does not clip them', () => {
  const css=readFileSync(new URL('../styles/context-menu.css',import.meta.url),'utf8');
  assert.match(css,/\.context-menu\.scrollt[\s\S]*?overflow-y:\s*auto/);
  const sub=css.match(/^\.context-menu-submenu-content \{[^}]*\}/m)[0];
  assert.match(sub,/position:\s*fixed/);
  assert.match(sub,/border-radius:\s*0/);
});

test('the scale is put on the document and announced once per change', async () => {
  const { pasUiSchaalToe, haalUiSchaalWeg, uiSchaalFactor, UI_SCHAAL_EVENT } = await import('../js/core/ui-scale.js');
  const props=new Map(), attrs=new Set();
  const root={style:{setProperty:(k,v)=>props.set(k,v),getPropertyValue:k=>props.get(k)??'',removeProperty:k=>props.delete(k)},
    toggleAttribute:(n,on)=>{on?attrs.add(n):attrs.delete(n);},removeAttribute:n=>attrs.delete(n)};
  let events=0;const tel=()=>events++;
  globalThis.addEventListener(UI_SCHAAL_EVENT,tel);
  try{
    assert.equal(uiSchaalFactor(root),1);
    pasUiSchaalToe(100,root);assert.equal(props.get('--ui-scale'),'1');assert.ok(!attrs.has('data-ui-scaled'));assert.equal(events,0);
    pasUiSchaalToe('175',root);assert.equal(uiSchaalFactor(root),1.75);assert.ok(attrs.has('data-ui-scaled'));assert.equal(events,1);
    pasUiSchaalToe(175,root);assert.equal(events,1,'same size: no event');
    pasUiSchaalToe(300,root);assert.equal(uiSchaalFactor(root),1,'unsupported value falls back to 100%');assert.equal(events,2);
    pasUiSchaalToe(200,root);haalUiSchaalWeg(root);assert.equal(uiSchaalFactor(root),1);assert.ok(!attrs.has('data-ui-scaled'));assert.equal(events,4);
  }finally{globalThis.removeEventListener(UI_SCHAAL_EVENT,tel);}
});

// Ribbon labels shrank from a fixed 10px: at 200% a long label fell back to
// 9.5px or less, smaller than at 100%, and a label shrunk at 100% kept that
// inline size after switching to 200%.
test('ribbon labels shrink relative to the interface size and are measured again', async () => {
  const props=new Map([['--ui-scale','1']]);
  const saved={document:globalThis.document,MutationObserver:globalThis.MutationObserver,raf:globalThis.requestAnimationFrame,gcs:globalThis.getComputedStyle,Node:globalThis.Node};
  globalThis.document={documentElement:{style:{getPropertyValue:k=>props.get(k)??''}}};
  globalThis.MutationObserver=class{observe(){}};
  globalThis.Node={TEXT_NODE:3};
  globalThis.requestAnimationFrame=cb=>{queueMicrotask(cb);return 1;};
  globalThis.getComputedStyle=()=>({lineHeight:'normal'});
  try{
    const { autoShrinkLabel } = await import('../js/solid/components/ribbon/autoShrinkLabel.js?schaal');
    const { UI_SCHAAL_EVENT } = await import('../js/core/ui-scale.js');
    // A word that never fits: the label goes down to the minimum size.
    const label={parentElement:{},isConnected:true,style:{fontSize:''},scrollHeight:0,clientWidth:10,scrollWidth:100};
    autoShrinkLabel(label);
    await new Promise(r=>setTimeout(r,0));
    assert.equal(label.style.fontSize,'7px');
    props.set('--ui-scale','2');
    globalThis.dispatchEvent(new Event(UI_SCHAAL_EVENT));
    await new Promise(r=>setTimeout(r,0));
    assert.equal(label.style.fontSize,'14px');
  }finally{
    for (const [k,v] of Object.entries({document:saved.document,MutationObserver:saved.MutationObserver,requestAnimationFrame:saved.raf,getComputedStyle:saved.gcs,Node:saved.Node})) {
      if (v===undefined) delete globalThis[k]; else globalThis[k]=v;
    }
  }
});

test('ribbon overflow and tool palette columns follow the interface size', () => {
  const lees=p=>readFileSync(new URL(p,import.meta.url),'utf8');
  const groups=lees('../js/solid/components/ribbon/AdaptiveGroups.jsx');
  assert.match(groups,/OVERFLOW_RESERVE_PX \* uiSchaalFactor\(\)/);
  assert.match(groups,/addEventListener\(UI_SCHAAL_EVENT, naSchaal\)/);
  assert.match(groups,/removeEventListener\(UI_SCHAAL_EVENT, naSchaal\)/);
  const palette=lees('../js/solid/components/ToolPalette.jsx');
  assert.match(palette,/SINGLE_COL_HEIGHT_SMALL\) \* schaal/);
  assert.match(palette,/addEventListener\(UI_SCHAAL_EVENT, updateColumns\)/);
});

test('the tab context menu (inline styles) follows the interface size too', () => {
  const tabs=readFileSync(new URL('../js/solid/components/DocumentTabs.jsx',import.meta.url),'utf8');
  assert.match(tabs,/'font-size': 'calc\(13px \* var\(--ui-scale, 1\)\)'/);
  assert.match(tabs,/'min-width': 'calc\(200px \* var\(--ui-scale, 1\)\)'/);
});
