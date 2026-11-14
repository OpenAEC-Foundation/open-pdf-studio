import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-central-ui-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser, page;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('opds:pdfEditorPreferences', JSON.stringify({ language: 'en', theme: 'light' })));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => {
    const { changeLanguage } = await import('/js/i18n/useTranslation.js');
    (await import('/js/core/state.ts')).state.preferences.language = 'en';
    await changeLanguage('en');
    window.reviewTest = { calls: [], pending: null, delay: '', failure: '', session: 0 };
    const fixture = window.reviewTest;
    window.__TAURI__ = { core: { invoke: async (cmd, args) => {
      if (!cmd.startsWith('central_review_')) return null;
      // Do not capture credential arguments in test artifacts either.
      fixture.calls.push([cmd, cmd === 'central_review_login' ? { server: args.server, name: args.name } : args]);
      if (fixture.delay === cmd) { fixture.delay = ''; return new Promise(resolve => { fixture.pending = resolve; }); }
      if (fixture.failure === cmd) throw 'NETWORK_ERROR';
      if (cmd === 'central_review_login') return `central-${++fixture.session}`;
      if (cmd === 'central_review_logout') return;
      const a = '1'.repeat(32), b = '2'.repeat(32);
      if (cmd === 'central_review_upload') {
        const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(args.bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');
        return {status:200,body:{sha256,size:args.bytes.length}};
      }
      if (args.operation.action === 'createDocument') return {status:201,body:{id:'3'.repeat(32)}};
      if (args.operation.action === 'memberByName') return { status: 200, body: { ok: true, userId: b } };
      const next = !!args.operation.after;
      return { status:200, body:{ documents:[{ id:next ? b : a, title:next ? 'Reader document' : '<img src=x onerror=alert(1)> Drawing',
        role:next ? 'reader' : 'owner', revision:0, hasPdf:true }], cursor:next ? b : a, hasMore:!next } };
    } } };
    fixture.fileMode='cancel';
    window.__TAURI__.dialog={open:async()=>fixture.fileMode==='cancel'?null:'/chosen.pdf'};
    window.__TAURI__.fs={stat:async()=>({isFile:true,size:fixture.fileMode==='oversize'?33554433:9}),readFile:async()=>new TextEncoder().encode('%PDF-test')};
    (await import('/js/solid/stores/appMenuStore.js')).openAppMenu();
  });
  await page.getByRole('button',{name:'Central documents',exact:true}).click();
  const dialog = page.getByRole('dialog', { name:'Central documents', exact:true });
  await dialog.waitFor();
  const signIn = async () => {
    await dialog.getByLabel('Server', { exact:true }).fill('https://server.test');
    await dialog.getByLabel('Account name', { exact:true }).fill('Alice');
    await dialog.getByLabel('Password', { exact:true }).fill('secret test password');
    await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  };
  await signIn();
  await dialog.getByText('<img src=x onerror=alert(1)> Drawing', { exact:true }).waitFor();
  assert.equal(await dialog.locator('img').count(),0,'server text must not become HTML');
  assert.equal(await dialog.locator('input[type=password]').count(),0);
  await dialog.getByLabel('Document title',{exact:true}).fill('New central drawing');
  await dialog.getByRole('button',{name:'Create document',exact:true}).click();
  await dialog.getByText('New central drawing',{exact:true}).waitFor();
  const uploadButton=dialog.getByRole('button',{name:'Upload PDF',exact:true});
  assert.equal(await dialog.getByRole('button',{name:'Open snapshot',exact:true}).isDisabled(),true);
  await uploadButton.click(); // picker cancellation leaves the empty document available
  await page.waitForFunction(()=>!document.querySelector('.central-review-dialog fieldset').disabled);
  assert.equal(await page.evaluate(()=>window.reviewTest.calls.filter(([c])=>c==='central_review_upload').length),0);
  await page.evaluate(()=>window.reviewTest.fileMode='oversize');
  await uploadButton.click();await dialog.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.reviewTest.calls.filter(([c])=>c==='central_review_upload').length),0);
  await page.evaluate(()=>window.reviewTest.fileMode='valid');
  await uploadButton.click();await uploadButton.waitFor({state:'detached'});
  assert.equal(await dialog.getByRole('button',{name:'Open snapshot',exact:true}).isEnabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.reviewTest.calls.find(([c])=>c==='central_review_upload')[1].bytes),[37,80,68,70,45,116,101,115,116]);
  await dialog.getByRole('button',{name:'Refresh',exact:true}).click();
  await dialog.getByText('<img src=x onerror=alert(1)> Drawing',{exact:true}).waitFor();
  await dialog.locator('input[type=radio]').check();
  await dialog.getByLabel('Account name',{exact:true}).fill('Bob');
  await dialog.getByLabel('Access',{exact:true}).selectOption('editor');
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await dialog.getByRole('status').waitFor();
  assert.equal(await dialog.getByRole('status').innerText(),'Access updated.');
  assert.equal(await page.evaluate(() => window.reviewTest.calls.at(-1)[1].operation.role),'editor');
  await dialog.getByLabel('Access',{exact:true}).selectOption('revoke');
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await page.waitForFunction(() => window.reviewTest.calls.at(-1)[1]?.operation?.role === null);
  await dialog.getByRole('button',{name:'Next page',exact:true}).click();
  await dialog.getByText('Reader document',{exact:true}).waitFor();
  await dialog.locator('input[type=radio]').check();
  assert.equal(await dialog.getByRole('button',{name:'Apply',exact:true}).count(),0,'reader cannot share');
  assert.equal(await dialog.getByRole('button',{name:'Upload PDF',exact:true}).count(),0,'reader cannot upload');
  assert.equal(await dialog.getByRole('button',{name:'Next page',exact:true}).isDisabled(),true);
  await dialog.getByRole('button',{name:'Refresh',exact:true}).click();
  await dialog.getByText('<img src=x onerror=alert(1)> Drawing',{exact:true}).waitFor();
  await dialog.locator('input[type=radio]').check();
  if (process.env.OPDS_REVIEW_SCREENSHOT) await page.screenshot({ path:process.env.OPDS_REVIEW_SCREENSHOT });
  // Logout while a list request is pending; its eventual answer must not restore rows.
  await page.evaluate(() => { window.reviewTest.delay='central_review_json'; });
  await dialog.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.waitForFunction(() => !!window.reviewTest.pending);
  await dialog.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.evaluate(() => { window.reviewTest.pending({status:200,body:{documents:[],cursor:'',hasMore:false}}); window.reviewTest.pending=null; });
  await dialog.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  assert.equal(await dialog.locator('input[type=radio]').count(),0);
  // Closing during login cleans up the session that arrives later.
  await page.evaluate(() => { window.reviewTest.delay='central_review_login'; });
  await signIn();
  await page.waitForFunction(() => !!window.reviewTest.pending);
  assert.equal(await dialog.locator('input[type=password]').inputValue(),'');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(() => { window.reviewTest.pending('central-999'); window.reviewTest.pending=null; });
  await page.waitForFunction(() => window.reviewTest.calls.some(([cmd,args])=>cmd==='central_review_logout' && args.session==='central-999'));
  assert.equal(await page.locator('.central-review-dialog').count(),0);
  // A failed remote logout is visible, even when the manager has already closed.
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('central-review'));
  await signIn(); await dialog.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  await dialog.getByText('<img src=x onerror=alert(1)> Drawing',{exact:true}).waitFor();
  await dialog.locator('input[type=radio]').check();
  assert.equal(await dialog.getByRole('button',{name:'Open snapshot',exact:true}).isEnabled(),true);
  await page.evaluate(() => { window.reviewTest.delay='central_review_download'; });
  await dialog.getByRole('button',{name:'Open snapshot',exact:true}).click();
  await page.waitForFunction(() => !!window.reviewTest.pending);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(() => { window.reviewTest.pending(new TextEncoder().encode('%PDF-late')); window.reviewTest.pending=null; });
  await page.waitForFunction(() => window.reviewTest.calls.at(-1)[0]==='central_review_logout');
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).state.documents.length),0);
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('central-review'));
  await signIn(); await dialog.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  await page.evaluate(() => { window.reviewTest.failure='central_review_logout'; });
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByText('Signed out locally; server sign-out could not be confirmed.',{exact:true}).waitFor();
  const storage = await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
  assert.ok(!storage.includes('secret test password') && !storage.includes('central-999'));
  assert.deepEqual(errors,[]);
  console.log('PASS: central manager login, escaped titles, paging, roles, share/revoke, logout races, late-login cleanup and visible logout failure');
} catch (error) {
  if (page) {
    console.error(await page.locator('.central-review-dialog').innerText().catch(() => 'dialog closed'));
    console.error(await page.evaluate(() => window.reviewTest?.calls));
    if (process.env.OPDS_REVIEW_SCREENSHOT) await page.screenshot({ path:process.env.OPDS_REVIEW_SCREENSHOT + '.failure.png' });
  }
  throw error;
} finally {
  await browser?.close(); await server.close(); await rm(cache,{recursive:true,force:true});
}
