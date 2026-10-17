// De echte PDF.js-legacy-build in een omgeving zonder de API's die
// Chromium 91 mist (#596): met de polyfills van de app opent een PDF, met
// tekst, operatorlijst en (als @napi-rs/canvas er is) een render met inkt.
// Zonder de polyfills faalt dezelfde proef: zo meet hij echt iets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const proef = fileURLToPath(new URL('./oude-webview-pdfjs-proef.mjs', import.meta.url));
const pdf = fileURLToPath(new URL('../../test pdf-bestanden/Originele bestanden/Tekst.pdf', import.meta.url));

function draai(...extra) {
  const r = spawnSync(process.execPath, [proef, pdf, ...extra],
    { encoding: 'utf8', timeout: 120000 });
  const regel = r.stdout.trim().split(/\r?\n/).pop() || '{}';
  return { status: r.status, uit: JSON.parse(regel), stderr: r.stderr };
}

test('PDF.js opent, leest en rendert met alleen de polyfills van de app', () => {
  const { status, uit, stderr } = draai();
  assert.equal(status, 0, `proef faalde: ${uit.fout || stderr}`);
  assert.equal(uit.ok, true);
  assert.equal(uit.paginas, 5);
  assert.ok(uit.tekst.length > 100, 'tekstinhoud via for await over een ReadableStream');
  assert.ok(uit.operatoren > 100, 'operatorlijst uit de worker');
  if (uit.inkt !== undefined) assert.ok(uit.inkt > 1000, `render heeft inkt (${uit.inkt})`);
  for (const naam of ['Promise.withResolvers', 'ArrayBuffer.prototype.transferToFixedLength',
    'ReadableStream.prototype[Symbol.asyncIterator]']) {
    assert.ok(uit.aangevuld.includes(naam), `${naam} aangevuld`);
  }
});

test('zonder de polyfills faalt de proef', () => {
  const { status, uit } = draai('--zonder-polyfills');
  assert.notEqual(status, 0);
  assert.equal(uit.ok, false);
});
