// De opname van de documentweergave (`app_screenshot_view`, scope 'document')
// toont de pagina met haar annotaties in de doorlopende weergave (de
// standaard) én in de enkelpagina-weergave. In de doorlopende weergave gaf de
// opname een leeg beeld, omdat alleen de canvassen van de enkele pagina
// werden samengevoegd.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-mcp-screenshot-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18352, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });

  const result = await page.evaluate(async () => {
    const { runAppEvent } = await import('/js/mcp-bridge.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    // Begin in de doorlopende weergave (de standaard is enkele pagina).
    (await import('/js/core/state.ts')).state.preferences.defaultViewMode = 'continuous';
    await (await import('/js/pdf/loader.js')).createBlankPDF(600, 400, 2);
    const doc = getActiveDocument();
    const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

    // Een dichte rode rechthoek midden op pagina 1.
    const gemaakt = await runAppEvent('mcp:create-annotation', {
      type: 'box', page: 1,
      props: { x: 200, y: 120, width: 200, height: 160, fillColor: '#ff0000', strokeColor: '#ff0000' },
    });
    if (!gemaakt.ok) throw new Error(JSON.stringify(gemaakt));

    /** Maak een opname en tel de rode en de niet-witte beeldpunten. */
    async function opname() {
      let antwoord;
      for (let i = 0; i < 40; i += 1) {
        antwoord = await runAppEvent('mcp:screenshot-view', { width: 600 });
        if (antwoord.ok) break;
        await wacht(250);
      }
      if (!antwoord.ok) return { ok: false, error: antwoord.error };
      const img = new Image();
      img.src = `data:image/png;base64,${antwoord.png_base64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let rood = 0; let nietWit = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k] > 200 && d[k + 1] < 80 && d[k + 2] < 80) rood += 1;
        if (!(d[k] > 245 && d[k + 1] > 245 && d[k + 2] > 245)) nietWit += 1;
      }
      const totaal = d.length / 4;
      return { ok: true, width: img.width, height: img.height, rood: rood / totaal, nietWit: nietWit / totaal, bounds: antwoord.bounds };
    }

    const uit = { begin: doc.viewMode };
    await wacht(1500);
    uit.doorlopend = await opname();
    const naarEnkel = await runAppEvent('mcp:set-view-mode', { mode: 'single' });
    uit.naarEnkel = naarEnkel.ok;
    await wacht(1500);
    uit.enkel = await opname();
    const terug = await runAppEvent('mcp:set-view-mode', { mode: 'continuous' });
    uit.terug = terug.ok;
    await wacht(1500);
    uit.weerDoorlopend = await opname();
    return uit;
  });

  assert.equal(result.begin, 'continuous', 'the document opens in the preferred (continuous) view');
  for (const naam of ['doorlopend', 'enkel', 'weerDoorlopend']) {
    const o = result[naam];
    assert.equal(o.ok, true, `${naam}: ${o.error || ''}`);
    // De pagina is 600 x 400 pt: geen 300 x 150 van een leeg canvas.
    assert.ok(o.width >= 500 && o.height >= 300, `${naam}: ${o.width} x ${o.height}`);
    assert.ok(Math.abs(o.width / o.height - 1.5) < 0.05, `${naam}: aspect ${o.width / o.height}`);
    // De rechthoek beslaat 200 x 160 van 600 x 400 = 13,3 % van de pagina.
    assert.ok(o.rood > 0.10 && o.rood < 0.17, `${naam}: red share ${o.rood}`);
    assert.ok(o.bounds && o.bounds.width > 100, `${naam}: bounds`);
  }
  console.log(JSON.stringify({ passed: true,
    doorlopend: [result.doorlopend.width, result.doorlopend.height, +result.doorlopend.rood.toFixed(3)],
    enkel: [result.enkel.width, result.enkel.height, +result.enkel.rood.toFixed(3)] }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
