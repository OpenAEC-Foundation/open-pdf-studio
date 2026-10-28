// De lijst met lettertypen in het eigenschappenpaneel (GitHub #765).
//
// - Een lettertype dat precies de standaard-monospace van de browser is
//   (Courier New of Consolas op Windows) mat tegen die ene basisletter even
//   breed en viel uit de lijst.
// - Werd de meting nooit klaar (een hoofdthread die nooit stil is: geen
//   timeout op requestIdleCallback) of faalde ze, dan bleef de lijst leeg en
//   stond alleen het lettertype van de selectie erin, meestal Arial.
// - Bij een meervoudige selectie met verschillende lettertypen kwam 'mixed'
//   als lettertype in de lijst.
//
// bridge.ts wordt hier een stub met de echte lettertypenlijst (fontStore.js).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const FONTS = new URL('../solid/stores/fontStore.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/bridge.ts')) {
    return { format: 'module', shortCircuit: true,
      source: "export { systemFontList, setSystemFontList } from '${FONTS}';" };
  }
  return nextLoad(url, context);
}`)}`);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const fonts = await import('./fonts.js');
const { systemFontList, setSystemFontList } = await import('../solid/stores/fontStore.js');

// Een canvas waarop alleen de lettertypen in `aanwezig` bestaan. De browser
// tekent 'monospace' als Courier New: dat lettertype meet dus precies even
// breed als de basisletter monospace.
function nepContext(aanwezig) {
  const breedte = { monospace: 100, 'sans-serif': 80, serif: 75, 'Courier New': 100, Georgia: 77, Calibri: 72 };
  let huidig = 'sans-serif';
  return {
    set font(css) {
      const m = String(css).match(/^\S+\s+(?:'((?:[^'\\]|\\.)*)',\s*)?(.+)$/);
      const naam = m[1]?.replace(/\\'/g, "'");
      huidig = naam && aanwezig.includes(naam) ? naam : m[2].trim();
    },
    get font() { return huidig; },
    measureText() { return { width: breedte[huidig] ?? 90 }; },
  };
}
const directIdle = (cb) => cb({ didTimeout: false, timeRemaining: () => 50 });

test('een lettertype gelijk aan de standaard-monospace blijft in de lijst', async () => {
  const gevonden = await fonts.detectAvailableFonts(['Courier New', 'Georgia', 'Wingdings', 'Calibri'], {
    maakContext: () => nepContext(['Courier New', 'Georgia', 'Calibri']),
    idle: directIdle,
  });
  assert.deepEqual(gevonden, ['Courier New', 'Georgia', 'Calibri']);
});

test('de meting loopt door als de hoofdthread nooit stil is', async () => {
  const lijst = Array.from({ length: 30 }, (_, i) => (i % 2 ? 'Georgia' : 'Onbekend'));
  // Alleen timeouts: geen vrije tijd, wel steeds een stukje.
  const gevonden = await fonts.detectAvailableFonts(lijst, {
    maakContext: () => nepContext(['Georgia']),
    idle: (cb) => setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 0),
  });
  assert.equal(gevonden.length, 15);
});

test('zonder canvas valt de lijst terug op alle bekende lettertypen', async () => {
  await assert.rejects(fonts.detectAvailableFonts(['Arial'], { maakContext: () => null, idle: directIdle }));
  // Hier is er geen document.createElement: de meting faalt.
  setSystemFontList([]);
  await fonts.initFontDropdowns();
  const lijst = systemFontList();
  assert.ok(lijst.length > 100, `${lijst.length} lettertypen`);
  for (const naam of ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana']) assert.ok(lijst.includes(naam), naam);
});

test("'mixed' van een meervoudige selectie komt niet als lettertype in de lijst", () => {
  setSystemFontList(['Arial', 'Georgia']);
  fonts.ensureFontInStore('mixed');
  assert.deepEqual(systemFontList(), ['Arial', 'Georgia']);
  fonts.ensureFontInStore('Calibri');
  assert.deepEqual(systemFontList(), ['Arial', 'Calibri', 'Georgia']);
});
