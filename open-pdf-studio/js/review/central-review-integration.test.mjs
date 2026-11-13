import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createCentralReviewClient } from './central-review-client.js';
import { createCentralReviewSync } from './central-review-sync.js';

test('two production JS clients against real SQLite: retry, reconnect, conflict, restore and revocation', {timeout:30000}, async () => {
  const child = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['-u', fileURLToPath(new URL('../../../collaboration-server/tests/client_transport_fixture.py', import.meta.url))],
    {stdio:['pipe','pipe','inherit']});
  const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
  try {
    const setup = await lines.next(); assert.equal(setup.done,false,'SQLite fixture started');
    const {document} = JSON.parse(setup.value);
    let tail = Promise.resolve();
    const invoke = (command,args) => {
      const work = tail.then(async () => {
        child.stdin.write(JSON.stringify({command,args})+'\n');
        const line = await lines.next(); assert.equal(line.done,false,'SQLite fixture response');
        return JSON.parse(line.value);
      });
      tail = work.catch(()=>{}); return work;
    };
    const alice = createCentralReviewClient(invoke), bob = createCentralReviewClient(invoke);
    await alice.login('http://127.0.0.1','Alice','test-password-alice');
    await bob.login('http://127.0.0.1','Bob','test-password-bob');
    let n = 0;
    const a = createCentralReviewSync(alice,document,()=>`alice-${++n}`);
    const b = createCentralReviewSync(bob,document,()=>`bob-${++n}`);
    await a.initialize(); await b.initialize();
    const annotation = text => ({id:'note',type:'textbox',page:1,text});
    a.stage('note',annotation('initial')); await a.flush(); await a.pull(); await b.pull();
    a.stage('note',annotation('Alice changed')); b.stage('note',annotation('Bob changed'));
    await a.flush(); await a.pull(); await assert.rejects(b.flush(),/CONFLICT/);
    assert.equal(b.view().pending[0].event.data.text,'Bob changed');
    await b.pull(); b.resolve('note','replace',annotation('chosen merge'));
    // Simulate a committed response lost in transit, then exact retry.
    const realAppend = bob.append; let lost = true;
    bob.append = async (...args) => { const result = await realAppend(...args); if (lost) { lost=false; throw new Error('NETWORK_ERROR'); } return result; };
    await assert.rejects(b.flush(),/NETWORK_ERROR/); await b.flush();
    await b.pull(); await a.pull();
    assert.equal(a.view().cursor,3); assert.deepEqual(a.view().annotations,b.view().annotations);
    assert.equal(a.view().annotations[0].data.text,'chosen merge');
    b.stage('note',null); await b.flush(); await b.pull(); await a.pull();
    assert.equal(a.view().annotations[0].data,null);
    const reconnected = createCentralReviewSync(alice,document,()=>`alice-${++n}`);
    await reconnected.initialize(); assert.equal(reconnected.view().cursor,4);
    reconnected.stage('note',annotation('restored')); await reconnected.flush(); await reconnected.pull();
    assert.equal(reconnected.view().cursor,5);
    await invoke('revoke-bob',{});
    b.stage('note',annotation('unsent')); await assert.rejects(b.flush(),/ACCESS_DENIED/);
    await assert.rejects(b.pull(),/ACCESS_DENIED/);
    assert.equal(b.view().pending.length,1); assert.equal(b.view().cursor,4);
    await alice.dispose(); await bob.dispose();
  } finally {
    const exited = child.exitCode !== null ? Promise.resolve() : once(child,'exit'); child.stdin.end();
    // A failed assertion cannot leave the isolated fixture running.
    const timeout = setTimeout(()=>child.kill(),1000);
    await exited; clearTimeout(timeout);
  }
});
