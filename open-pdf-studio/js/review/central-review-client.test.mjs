import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createCentralReviewClient } from './central-review-client.js';
const A = '1'.repeat(32), B = '2'.repeat(32);
const row = (id = A) => ({ id, title: '<script>drawing</script>', role: 'owner', revision: 0, hasPdf: true });
const page = (rows = [row()]) => ({ documents: rows, cursor: rows.at(-1)?.id || '', hasMore: false });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

test('native operations: handles stay private, credentials cleared, cursor and named sharing', async () => {
  const calls = []; let loginArgs;
  const client = createCentralReviewClient(async (cmd,args) => {
    calls.push([cmd, structuredClone(args)]);
    if (cmd === 'central_review_login') { loginArgs = args; return 'central-1'; }
    if (cmd === 'central_review_json') return { status: 200, body: args.operation.action === 'documents' ? page() : { ok: true, userId: B } };
  });
  assert.equal(await client.login('https://server.test', 'Alice', 'password secret'), undefined);
  assert.equal(loginArgs.password, '');
  assert.deepEqual(await client.documents(), page());
  await client.share(A, ' Bob ', 'reader');
  assert.deepEqual(calls[2], ['central_review_json', { session: 'central-1', operation: { action:'memberByName', document:A, name:' Bob ', role:'reader' } }]);
  await client.logout();
  await assert.rejects(client.documents(), /SESSION_CLOSED/);
});

test('close during login revokes the late session and never returns it', async () => {
  const wait = deferred(), started = deferred(), revoked = [];
  const client = createCentralReviewClient((cmd,args) => {
    if (cmd === 'central_review_login') { started.resolve(); return wait.promise; }
    revoked.push(args.session); return Promise.resolve();
  });
  const login = client.login('https://server.test', 'Alice', 'secret');
  await started.promise;
  await client.dispose();
  wait.resolve('central-9');
  await assert.rejects(login, /STALE/);
  assert.deepEqual(revoked, ['central-9']);
});

test('late document results and failures after logout cannot affect the next login', async () => {
  for (const rejected of [false,true]) {
    const wait = deferred(); let n = 0;
    const client = createCentralReviewClient(async (cmd) => {
      if (cmd === 'central_review_login') return `central-${++n}`;
      if (cmd === 'central_review_json') return wait.promise;
    });
    await client.login('https://server.test','Alice','secret');
    const request = client.documents();
    await client.logout();
    await client.login('https://server.test','Bob','different');
    if (rejected) wait.reject('NETWORK_ERROR'); else wait.resolve({status:200,body:page()});
    await assert.rejects(request, /STALE/);
    await client.dispose();
  }
});

test('replacement login revokes the old session and keeps the last login only', async () => {
  const wait = deferred(), started = deferred(), revoked = [];
  const client = createCentralReviewClient((cmd,args) => {
    if (cmd === 'central_review_login' && args.name === 'Alice') { started.resolve(); return wait.promise; }
    if (cmd === 'central_review_login') return Promise.resolve('central-2');
    if (cmd === 'central_review_logout') revoked.push(args.session);
    return Promise.resolve();
  });
  const first = client.login('https://server.test','Alice','secret'); await started.promise;
  await client.login('https://server.test','Bob','secret');
  wait.resolve('central-1'); await assert.rejects(first,/STALE/);
  await client.dispose(); assert.deepEqual(revoked,['central-1','central-2']);
});

test('logout failure warns without retaining the handle or leaking native details', async () => {
  let warnings = 0;
  const client = createCentralReviewClient(async cmd => {
    if (cmd === 'central_review_login') return 'central-1';
    throw 'sensitive internal detail';
  }, () => warnings++);
  await client.login('https://server.test','Alice','secret');
  await client.logout(); await assert.rejects(client.documents(),/SESSION_CLOSED/);
  await client.dispose(); assert.equal(warnings,1);
});

test('server errors are normalized and successful inventories are validated', async () => {
  let reply;
  const client = createCentralReviewClient(async cmd => cmd === 'central_review_login' ? 'central-1' : reply);
  await client.login('https://server.test','Alice','secret');
  for (const [status,code] of [[400,'INVALID_REQUEST'],[401,'SESSION_CLOSED'],[403,'ACCESS_DENIED'],[409,'CONFLICT'],[429,'RATE_LIMITED'],[500,'REQUEST_FAILED']]) {
    reply={status,body:{error:'internal secret',current:null}};
    await assert.rejects(client.documents(),new RegExp(code));
  }
  for (const body of [null, {...page(),hasMore:1}, {...page([]),hasMore:true}, {...page(),cursor:B},
    page([row(),row()]), page([row(B),row(A)]), page([{...row(),role:'admin'}]), page([{...row(),revision:NaN}]),
    page(Array.from({length:51},()=>row()))]) {
    reply={status:200,body}; await assert.rejects(client.documents(),/INVALID_RESPONSE/);
  }
  reply={status:200,body:page([row(B)])};
  assert.equal((await client.documents(A)).documents[0].id,B);
  reply={status:200,body:page()}; await assert.rejects(client.documents(A),/INVALID_RESPONSE/);
});

test('reject invalid UI operations before invoking the network', async () => {
  let calls = 0;
  const client = createCentralReviewClient(async () => calls++);
  await assert.rejects(client.documents('../x'),/INVALID_REQUEST/);
  await assert.rejects(client.share(A,'Bob','owner'),/INVALID_REQUEST/);
  await assert.rejects(client.share('bad','Bob',null),/INVALID_REQUEST/);
  assert.equal(calls,0);
});

test('all shipped languages have nonempty central manager labels and messages', () => {
  const root = new URL('../i18n/locales/', import.meta.url);
  const reference = JSON.parse(readFileSync(new URL('en/dialogs.json',root))).centralReview;
  assert.equal(Object.keys(reference).length,22);
  for (const folder of readdirSync(root,{withFileTypes:true}).filter(f=>f.isDirectory())) {
    const values = JSON.parse(readFileSync(new URL(`${folder.name}/dialogs.json`,root))).centralReview;
    assert.deepEqual(Object.keys(values).sort(),Object.keys(reference).sort(),folder.name);
    assert.ok(Object.values(values).every(v=>typeof v==='string' && v.trim()),folder.name);
  }
});

test('PDF downloads are bounded detached bytes and late downloads are discarded', async () => {
  let response = new TextEncoder().encode('%PDF-source'), waiting = false;
  const delay = deferred();
  const client = createCentralReviewClient(async cmd => cmd === 'central_review_login' ? 'central-1' :
    cmd === 'central_review_download' ? waiting ? delay.promise : response : undefined);
  await client.login('https://server.test','Alice','secret');
  const pdf = await client.download(A); pdf[0] = 0;
  assert.equal(response[0],37);
  response = response.buffer; assert.equal((await client.download(A))[0],37);
  response = new Uint8Array([1,2,3]); await assert.rejects(client.download(A),/INVALID_PDF/);
  response = '%PDF-string'; await assert.rejects(client.download(A),/INVALID_RESPONSE/);
  waiting = true; const request = client.download(A); await client.logout();
  delay.resolve(new TextEncoder().encode('%PDF-late')); await assert.rejects(request,/STALE/);
});

test('append preserves structured conflicts and rejects mismatched acknowledgement data', async () => {
  const request = {id:'e1',ann:'a1',op:'create',base:null,data:{id:'a1',type:'textbox',page:1}};
  let reply = {status:409,body:{current:'remote-event'}};
  const client = createCentralReviewClient(async cmd => cmd === 'central_review_login' ? 'central-1' : reply);
  await client.login('https://server.test','Alice','secret');
  await assert.rejects(client.append(A,request), error => error.message === 'CONFLICT' && error.current === 'remote-event');
  reply = {status:200,body:{...request,v:1,revision:1,seq:1,clock:1,uk:B,user:'Alice',at:'2026-11-13T00:00:00Z'}};
  assert.equal((await client.append(A,request)).id,'e1');
  reply.body.data = {...request.data,text:'wrong'};
  await assert.rejects(client.append(A,request),/INVALID_RESPONSE/);
  reply = {status:409,body:{current:'invalid / value'}};
  await assert.rejects(client.append(A,request),/INVALID_RESPONSE/);
});
