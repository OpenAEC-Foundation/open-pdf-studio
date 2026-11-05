// Schermafbeelding naar het klembord (#925): desktop schrijft via Rust, met de
// web-API als terugval; browser en mobiel blijven op de web-API.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { kopieerPngNaarKlembord } from './screenshot-klembord.js';

const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

class NepItem {
  constructor(data) { this.data = data; }
}

function nepKlembord({ weiger = false } = {}) {
  const geschreven = [];
  return {
    geschreven,
    async write(items) {
      if (weiger) throw new Error('NotAllowedError');
      geschreven.push(...items);
    },
  };
}

test('desktop schrijft de PNG-bytes via de Rust-opdracht, niet via de WebView', async () => {
  const aanroepen = [];
  const klembord = nepKlembord();
  const route = await kopieerPngNaarKlembord(png(), {
    desktop: true,
    invoke: async (cmd, args) => { aanroepen.push([cmd, args]); },
    clipboard: klembord,
    ClipboardItem: NepItem,
  });
  assert.equal(route, 'native');
  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0][0], 'write_clipboard_image_png');
  assert.ok(aanroepen[0][1] instanceof Uint8Array, 'rauwe body');
  assert.deepEqual([...aanroepen[0][1]], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(klembord.geschreven.length, 0);
});

test('faalt de Rust-opdracht, dan valt desktop terug op de web-API', async () => {
  const klembord = nepKlembord();
  const waarschuwingen = [];
  const route = await kopieerPngNaarKlembord(png(), {
    desktop: true,
    invoke: async () => { throw 'unknown command'; },
    clipboard: klembord,
    ClipboardItem: NepItem,
    waarschuw: (...a) => waarschuwingen.push(a),
  });
  assert.equal(route, 'web');
  assert.equal(klembord.geschreven.length, 1);
  assert.ok(klembord.geschreven[0].data['image/png'] instanceof Blob);
  assert.equal(waarschuwingen.length, 1);
});

test('falen beide routes, dan komt de Rust-fout als Error terug', async () => {
  await assert.rejects(
    kopieerPngNaarKlembord(png(), {
      desktop: true,
      invoke: async () => { throw 'clipboard write failed: no display'; },
      clipboard: nepKlembord({ weiger: true }),
      ClipboardItem: NepItem,
    }),
    (e) => e instanceof Error && /no display/.test(e.message),
  );
});

test('browser en mobiel gebruiken alleen de web-API', async () => {
  let aangeroepen = false;
  const klembord = nepKlembord();
  const route = await kopieerPngNaarKlembord(png(), {
    desktop: false,
    invoke: async () => { aangeroepen = true; },
    clipboard: klembord,
    ClipboardItem: NepItem,
  });
  assert.equal(route, 'web');
  assert.equal(aangeroepen, false);
  assert.equal(klembord.geschreven.length, 1);
  await assert.rejects(
    kopieerPngNaarKlembord(png(), { desktop: false, clipboard: nepKlembord({ weiger: true }), ClipboardItem: NepItem }),
    /NotAllowedError/,
  );
});

test('de Rust-opdracht is geregistreerd en de dialoog gebruikt de helper', () => {
  const lib = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /async fn write_clipboard_image_png\(/);
  assert.match(lib, /^\s+write_clipboard_image_png,\r?$/m);
  assert.match(lib, /\.write_image\(&tauri::image::Image::new\(/);
  const tool = readFileSync(new URL('./screenshot.js', import.meta.url), 'utf8');
  const kopie = tool.slice(tool.indexOf('export async function kopieerSchermafbeelding'));
  assert.match(kopie.slice(0, 600), /kopieerPngNaarKlembord\(blob, \{\s*desktop: isTauri\(\) && !isMobile\(\)/);
  assert.doesNotMatch(kopie.slice(0, 600), /navigator\.clipboard\.write\(/);
});
