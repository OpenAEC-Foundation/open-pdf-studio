import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleUiValue, uiScaleCss } from './ui-scale-css.mjs';
import { normalizeUiScale } from '../js/core/ui-scale.js';
import { readFileSync, readdirSync } from 'node:fs';
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
  for (const file of ['text-layer.css','form-layer.css','mobile.css','layout.css','context-menu.css','assistant.css']) assert.equal(run(file,'.pdf-page'),'100px');
  assert.match(run('ribbon.css','.ribbon-tab'),/--ui-scale/);
  assert.match(run('layout.css','.left-panel'),/--ui-scale/);
});
test('every interface language has the new preference label',()=>{
  const root=new URL('../js/i18n/locales/',import.meta.url);
  for(const lang of readdirSync(root)) assert.ok(JSON.parse(readFileSync(new URL(lang+'/preferences.json',root))).general.interfaceScale.trim(),lang);
});
