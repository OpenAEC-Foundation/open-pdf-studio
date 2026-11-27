import test from 'node:test';
import assert from 'node:assert/strict';
import { bindBlurValidation } from './blur-validation.js';
function fixture() {
 const input = new EventTarget(), attrs = new Map(), reports = [];
 Object.assign(input, {value:'3',isConnected:true,disabled:false,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)});
 let allowed = true;
 bindBlurValidation(input, v => +v >= 10 ? null : 'Too small', e => reports.push(e), () => allowed);
 return {input,attrs,reports,blur:()=>input.dispatchEvent(new Event('blur')),edit:v=>{input.value=v;input.dispatchEvent(new Event('input'));},allow:v=>{allowed=v;}};
}
test('acknowledged invalid value does not repeatedly steal focus; edited value validates again',()=>{
 const f=fixture();f.blur();f.blur();assert.equal(f.reports.length,1);assert.equal(f.attrs.get('aria-invalid'),'true');assert.equal(f.input.value,'3');f.edit('4');f.blur();assert.equal(f.reports.length,2);f.edit('12');f.blur();assert.equal(f.attrs.has('aria-invalid'),false);assert.equal(f.reports.length,2);
});
test('disabled, detached and temporarily suppressed fields do not show dialogs',()=>{
 const f=fixture();f.input.disabled=true;f.blur();f.input.disabled=false;f.input.isConnected=false;f.blur();f.input.isConnected=true;f.allow(false);f.blur();assert.equal(f.reports.length,0);f.allow(true);f.blur();assert.equal(f.reports.length,1);
});
test('programmatic value changes are still validated without an input event',()=>{
 const f=fixture();f.blur();f.input.value='4';f.blur();assert.equal(f.reports.length,2);
});
