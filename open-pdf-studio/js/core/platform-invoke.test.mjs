// Het contract van invoke() buiten Tauri.
//
// Tot #456 gaf invoke() in de browser stil `null` terug. De aanroeper kon
// "hier niet beschikbaar" niet onderscheiden van "mislukt" of van een echte
// null-uitkomst van de Rust-kant, dus elke knop achter een Rust-opdracht deed
// niets zonder een woord. Het contract is nu: buiten Tauri wordt de belofte
// afgewezen met een NietInBrowserError, herkenbaar aan `code`.

import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window = {};

const {
  invoke,
  isNietInBrowser,
  NietInBrowserError,
  NIET_IN_BROWSER,
  isTauri,
} = await import('./platform.js');

function zetTauri(core) {
  if (core === null) delete globalThis.window.__TAURI__;
  else globalThis.window.__TAURI__ = { core };
}

test('browser: invoke wijst af met een herkenbare fout in plaats van null', async () => {
  zetTauri(null);
  assert.equal(isTauri(), false);
  await assert.rejects(() => invoke('render_pdf_page', { path: 'a.pdf' }), (fout) => {
    assert.ok(fout instanceof NietInBrowserError);
    assert.equal(fout.code, NIET_IN_BROWSER);
    assert.equal(fout.command, 'render_pdf_page');
    assert.ok(/render_pdf_page/.test(fout.message));
    return true;
  });
});

test('browser: de fout is te herkennen zonder de klasse te importeren', async () => {
  zetTauri(null);
  const fout = await invoke('ocr_page').catch((e) => e);
  assert.equal(isNietInBrowser(fout), true);
  // Een gewone fout van de Rust-kant mag NIET als "niet in de browser" tellen.
  assert.equal(isNietInBrowser(new Error('bestand niet gevonden')), false);
  assert.equal(isNietInBrowser(null), false);
  assert.equal(isNietInBrowser(undefined), false);
  assert.equal(isNietInBrowser('NIET_IN_BROWSER'), false);
});

test('bureaublad: invoke geeft de uitkomst van de Rust-kant door, ook null', async () => {
  const aanroepen = [];
  zetTauri({
    invoke: async (cmd, args) => { aanroepen.push([cmd, args]); return cmd === 'leeg' ? null : 42; },
  });
  assert.equal(isTauri(), true);
  assert.equal(await invoke('page_count', { path: 'a.pdf' }), 42);
  assert.equal(await invoke('leeg'), null, 'een echte null uit Rust blijft null');
  assert.deepEqual(aanroepen, [['page_count', { path: 'a.pdf' }], ['leeg', {}]]);
});

test('bureaublad: een fout van de Rust-kant komt ongewijzigd door', async () => {
  zetTauri({ invoke: async () => { throw new Error('bestand niet gevonden'); } });
  const fout = await invoke('open_pdf').catch((e) => e);
  assert.equal(fout.message, 'bestand niet gevonden');
  assert.equal(isNietInBrowser(fout), false);
});

test('Tauri aanwezig maar zonder core-brug telt als niet beschikbaar', async () => {
  globalThis.window.__TAURI__ = {};
  await assert.rejects(() => invoke('mcp_status'), (fout) => isNietInBrowser(fout));
});

test('bureaublad: opties (koppen bij een rauwe body) gaan mee naar Tauri', async () => {
  const aanroepen = [];
  zetTauri({ invoke: async (...a) => { aanroepen.push(a); return 'ok'; } });
  const body = new Uint8Array([1, 2, 3]);
  const opties = { headers: { 'x-profile-path': 'a%20b.icc' } };
  assert.equal(await invoke('pdfx_convert_to_cmyk', body, opties), 'ok');
  assert.equal(aanroepen[0][1], body, 'de bytes zelf, geen kopie');
  assert.deepEqual(aanroepen[0][2], opties);
  // Zonder opties blijft de aanroep zoals hij altijd was: twee argumenten.
  await invoke('page_count', { path: 'a.pdf' });
  assert.equal(aanroepen[1].length, 2);
});
