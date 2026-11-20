// De standaard van de Rust-route voor PNG insluiten en haar schakelaar
// (rust-routes.js). De standaard volgt uit de meting in de echte app
// (docs/rust-stappen.md): wie hem omzet, zet ook die tekst en de tests van de
// route om.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RUST_STANDAARD, RUST_SCHAKELAAR, rustRoute } from './rust-routes.js';

const lees = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('de standaard: het insluiten van een PNG staat aan', () => {
  assert.deepEqual({ ...RUST_STANDAARD }, { png: true });
  assert.deepEqual({ ...RUST_SCHAKELAAR }, { png: '__opdsRustPng' });
  assert.ok(Object.isFrozen(RUST_STANDAARD));
});

test('de schakelaar gaat voor de standaard, en wordt bij elke aanroep gelezen', () => {
  for (const [naam, sleutel] of Object.entries(RUST_SCHAKELAAR)) {
    try {
      delete globalThis[sleutel];
      assert.equal(rustRoute(naam), RUST_STANDAARD[naam], naam);
      for (const waarde of [true, false, 'altijd']) {
        globalThis[sleutel] = waarde;
        assert.equal(rustRoute(naam), waarde, `${naam} = ${waarde}`);
      }
      // Alles wat geen geldige waarde is, telt als niet gezet.
      for (const waarde of [null, 0, 1, 'true', 'aan', {}]) {
        globalThis[sleutel] = waarde;
        assert.equal(rustRoute(naam), RUST_STANDAARD[naam], `${naam} = ${JSON.stringify(waarde)}`);
      }
    } finally {
      delete globalThis[sleutel];
    }
  }
});

test('de route leest haar keuze uit rust-routes.js, en de omgevingsvlag blijft JavaScript afdwingen', () => {
  const bron = lees('./embed-png-rust.js');
  assert.ok(bron.includes("rustRoute('png')"), 'embed-png-rust.js leest de keuze voor png');
  assert.ok(!/globalThis\.__opdsRust|window\.__opdsRust\w+ (?:!==|===)/.test(bron), 'embed-png-rust.js leest de schakelaar niet zelf');
  // De backend zegt of de route er is; `=0` zet haar uit, wat de schakelaar ook zegt.
  const beeld = lees('../../src-tauri/src/beeld.rs');
  assert.match(beeld, /aan\("OPDS_RUST_PNG_EMBED"\) as u8/);
  assert.match(beeld, /std::env::var\(naam\)\.map\(\|v\| v\.trim\(\) != "0"\)\.unwrap_or\(true\)/);
  // Een route die de backend niet aanbiedt, wordt niet aangeroepen.
  assert.match(lees('./beeld-rust.js'), /png: \(bits & 1\) !== 0/);
  assert.match(bron, /return rust\.png \? \(png\) => rust\.invoke\('png_naar_xobject', png\) : null;/);
});
