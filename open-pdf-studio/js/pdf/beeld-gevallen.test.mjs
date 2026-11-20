// De vaste gevallen waarop `cargo test -p open-pdf-image` de Rust-route
// toetst (PNG naar XObject) moeten beschrijven wat de JS-route vandaag doet.
// Wijkt dit af, dan is de JS-route of de lijst met gevallen veranderd:
// schrijf het bestand opnieuw (node scripts/bench-rust/beeld-golden.mjs) en
// draai de cargo-test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bouwGevallen, pngInvoer, pngKanalenJs } from './beeld-gevallen.testhulp.mjs';

const BESTAND = new URL('../../../open-pdf-image/tests/fixtures/gevallen.bin', import.meta.url);

test('gevallen.bin is wat de JS-route nu maakt', async () => {
  const nu = await bouwGevallen();
  const bestand = new Uint8Array(readFileSync(BESTAND));
  assert.equal(bestand.length, nu.length, 'lengte van gevallen.bin');
  assert.ok(Buffer.from(bestand).equals(Buffer.from(nu)), 'inhoud van gevallen.bin');
});

test('de gevallen dekken wat de Rust-route aanneemt', async () => {
  const png = pngInvoer();
  // Elk kleurtype en elke bitdiepte die Rust neemt, en elk soort dat teruggaat.
  for (const soort of ['t0-d1', 't0-d2', 't0-d4', 't0-d8', 't2-d8', 't3-d1', 't3-d2', 't3-d4', 't3-d8', 't4-d8', 't6-d8']) {
    assert.ok(png.some((p) => !p.skip && p.naam.endsWith(soort)), soort);
  }
  assert.equal(png.filter((p) => p.skip).length, 8);
  // Met en zonder alfastream.
  const alfa = await Promise.all(png.filter((p) => !p.skip).map(async (p) => (await pngKanalenJs(p.png)).alpha !== null));
  assert.ok(alfa.includes(true) && alfa.includes(false));
});
