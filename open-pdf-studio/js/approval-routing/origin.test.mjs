import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequest,appendEvent,recordReceipt,makeReceipt,verifyRequest,digest} from './model.js';
import {actorFor,checkAutomationRequest} from './origin.js';
const now='2026-10-21T10:00:00.000Z',later='2026-10-21T11:00:00.000Z',bytes=new TextEncoder().encode('exact document');
async function submitted(){const record=await createRequest({title:'Review',mode:'parallel',expiresAt:null,source:{name:'d.pdf',hash:await digest(bytes),pages:1,revision:'A'},recipients:[{id:'a',name:'Alice',email:'a@example.org'}],fields:[]},now);return appendEvent(record,'submit',{},actorFor('mcp'),now);}
test('audit events created through MCP name MCP as the actor',async()=>{
 assert.equal(actorFor('mcp'),'MCP');assert.equal(actorFor('plugin'),'Extension');assert.equal(actorFor(undefined),'Local operator');
 let record=await submitted();assert.equal(record.events[0].actor,'MCP');
 const receipt=await makeReceipt(record,bytes,'a','approved','',later);
 record=await recordReceipt(record,receipt,later,actorFor('mcp'));
 assert.equal(record.events.at(-1).actor,'MCP');assert.equal((await verifyRequest(record,later)).status,'completed');
 const other=await submitted(),local=await recordReceipt(other,await makeReceipt(other,bytes,'a','approved','',later),later);assert.equal(local.events.at(-1).actor,'Local operator (reported receipt)');
});
test('createReceipt through MCP or an extension needs confirmed: true, like the confirmation checkbox',()=>{
 assert.throws(()=>checkAutomationRequest({action:'createReceipt'},'mcp'),/CONFIRMATION_REQUIRED/);
 assert.throws(()=>checkAutomationRequest({action:'createReceipt',confirmed:'true'},'mcp'),/CONFIRMATION_REQUIRED/);
 assert.throws(()=>checkAutomationRequest({action:'createReceipt'},'plugin'),/CONFIRMATION_REQUIRED/);
 assert.doesNotThrow(()=>checkAutomationRequest({action:'createReceipt',confirmed:true},'mcp'));
 assert.doesNotThrow(()=>checkAutomationRequest({action:'createReceipt'},undefined));
 assert.doesNotThrow(()=>checkAutomationRequest({action:'list'},'mcp'));
 assert.throws(()=>checkAutomationRequest({action:'decision'},'plugin'),/CONFIRMATION_REQUIRED/);
 assert.doesNotThrow(()=>checkAutomationRequest({action:'decision',confirmed:true},'plugin'));
});
test('the MCP bridge and the extension API pass their origin to approval routing',()=>{
 const bridge=readFileSync(new URL('../mcp-bridge.js',import.meta.url),'utf8');
 assert.match(bridge,/'mcp:approval-routing'[\s\S]{0,200}approvalRequest\(p,\s*\{\s*origin:\s*'mcp'\s*\}\)/);
 const api=readFileSync(new URL('../plugins/plugin-api.js',import.meta.url),'utf8');
 assert.match(api,/approvalRequest\(request,\s*\{\s*origin:\s*'plugin'\s*\}\)/);
});
