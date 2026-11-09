// Luie linttabbladen (#454): de lader, het voorladen na de start en de
// aansluiting in Ribbon.jsx (sneltoets wacht op een niet-geladen tabblad).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maakTabLader, naDeStart, laadLintTab, lintTabGeladen, zetTabLader } from './lint-tab-laden.js';

function luiComponent(log, naam, { faalt = false } = {}) {
  const c = () => null;
  c.preload = () => { log.push(naam); return faalt ? Promise.reject(new Error('weg')) : Promise.resolve({ default: c }); };
  return c;
}

test('een lui tabblad is pas na het laden geladen; niet-luie en onbekende tabbladen altijd', async () => {
  const log = [];
  const home = () => null;
  const lader = maakTabLader({ home, drawing: luiComponent(log, 'drawing'), comment: luiComponent(log, 'comment') });
  assert.equal(lader.isGeladen('home'), true);
  assert.equal(lader.isGeladen('ext-tab'), true, 'een extensietabblad laadt niet via hier');
  assert.equal(lader.isGeladen('drawing'), false);
  assert.equal(await lader.laad('drawing'), true);
  assert.equal(lader.isGeladen('drawing'), true);
  assert.equal(await lader.laad('drawing'), true);
  assert.deepEqual(log, ['drawing'], 'één keer laden');
});

test("'measure' is de oude naam van 'comment'", async () => {
  const log = [];
  const lader = maakTabLader({ comment: luiComponent(log, 'comment') });
  assert.equal(lader.isGeladen('measure'), false);
  await lader.laad('measure');
  assert.equal(lader.isGeladen('comment'), true);
  assert.deepEqual(log, ['comment']);
});

test('gelijktijdig laden deelt één belofte; een mislukte lading geeft false en mag opnieuw', async () => {
  const log = [];
  const lader = maakTabLader({ view: luiComponent(log, 'view') });
  const [a, b] = await Promise.all([lader.laad('view'), lader.laad('view')]);
  assert.deepEqual([a, b, log], [true, true, ['view']]);

  const fouten = [];
  const oud = console.warn;
  console.warn = (...x) => fouten.push(x.join(' '));
  try {
    const kapot = maakTabLader({ help: luiComponent(log, 'help', { faalt: true }) });
    assert.equal(await kapot.laad('help'), false);
    assert.equal(kapot.isGeladen('help'), false);
    assert.equal(await kapot.laad('help'), false);
  } finally {
    console.warn = oud;
  }
  assert.equal(fouten.length, 2);
});

test('laadAlles laadt de luie tabbladen na elkaar', async () => {
  const log = [];
  const lader = maakTabLader({ home: () => null, drawing: luiComponent(log, 'drawing'), view: luiComponent(log, 'view') });
  await lader.laadAlles();
  assert.deepEqual(log, ['drawing', 'view']);
  assert.equal(lader.isGeladen('view'), true);
});

test('zonder lint laadt laadLintTab niets en geldt alles als geladen', async () => {
  zetTabLader(null);
  assert.equal(await laadLintTab('drawing'), true);
  assert.equal(lintTabGeladen('drawing'), true);
  const log = [];
  zetTabLader(maakTabLader({ drawing: luiComponent(log, 'drawing') }));
  assert.equal(lintTabGeladen('drawing'), false);
  assert.equal(await laadLintTab('drawing'), true);
  assert.equal(lintTabGeladen('drawing'), true);
  zetTabLader(null);
});

test('naDeStart wacht, gebruikt requestIdleCallback als die er is, en is op te ruimen', () => {
  const klokken = [];
  const rust = [];
  const omgeving = {
    setTimeout: (fn, ms) => { klokken.push({ fn, ms }); return klokken.length; },
    clearTimeout: (id) => { klokken[id - 1].weg = true; },
    requestIdleCallback: (fn, opt) => { rust.push({ fn, opt }); return rust.length; },
    cancelIdleCallback: () => {},
  };
  let gedraaid = 0;
  naDeStart(() => { gedraaid++; }, { wacht: 1000, uiterlijk: 4000, omgeving });
  assert.equal(klokken[0].ms, 1000);
  assert.equal(gedraaid, 0);
  klokken[0].fn();
  assert.equal(rust[0].opt.timeout, 4000);
  rust[0].fn();
  rust[0].fn();
  assert.equal(gedraaid, 1, 'maar één keer');

  const zonderRust = { setTimeout: omgeving.setTimeout, clearTimeout: omgeving.clearTimeout };
  const stop = naDeStart(() => { gedraaid++; }, { omgeving: zonderRust });
  stop();
  klokken.at(-1).fn();
  assert.equal(gedraaid, 1, 'opgeruimd vóór het draaien');
});

test('Ribbon.jsx: alleen Start statisch, de rest lui; de sneltoets wacht op een niet-geladen tabblad', () => {
  const s = readFileSync(new URL('./Ribbon.jsx', import.meta.url), 'utf8');
  assert.match(s, /^import HomeTab from '\.\/HomeTab\.jsx';/m);
  for (const naam of ['DrawingTab', 'CommentTab', 'ViewTab', 'OrganizeTab', 'HelpTab', 'FormatTab', 'ArrangeTab', 'ImageTab']) {
    assert.doesNotMatch(s, new RegExp(`^import ${naam} `, 'm'), `${naam} niet statisch`);
    assert.match(s, new RegExp(`const ${naam} = lazy\\(\\(\\) => import\\('\\./${naam}\\.jsx'\\)\\);`), `${naam} lui`);
  }
  assert.match(s, /zetTabLader\(tabLader\);/);
  assert.match(s, /naDeStart\(\(\) => \{ tabLader\.laadAlles\(\); \}\)/);
  // Geladen (of knop al zichtbaar): synchroon klikken, zoals vóór #454.
  assert.match(s, /if \(!tab \|\| tabLader\.isGeladen\(tab\) \|\| document\.getElementById\(knopId\)\) return klikLintKnop\(knopId, tab\);/);
  assert.match(s, /return tabLader\.laad\(tab\)\.then\(\(ok\) => ok && klikLintKnop\(knopId, tab\)\);/);
  // Geen andere statische import van een tabbladmodule (anders blijft hij in de entry).
  const brug = readFileSync(new URL('../../../mcp-bridge.js', import.meta.url), 'utf8');
  assert.match(brug, /async function _activeerTab\(tab\) \{[\s\S]*?await _laadTab\(tab\);\s*knop\.click\(\);/);
});
