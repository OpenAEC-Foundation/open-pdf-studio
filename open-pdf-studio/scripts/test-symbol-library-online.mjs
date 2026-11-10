// Test voor de online-symboolbibliotheek parse/convert-laag.
//
// Draait ZONDER netwerk tegen een lokale checkout van de content-repo
// (open-pdf-studio-library). Gebruik:
//   node scripts/test-symbol-library-online.mjs [pad-naar-library-checkout]
//
// Het projectpackage is CJS (geen "type":"module"), dus de ESM-bronnen
// worden naar een tempmap gekopieerd als .mjs en daarvandaan geïmporteerd.

import { readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const libDir = process.argv[2] || join(appRoot, '..', '..', '..', '..', 'open-pdf-studio-library');

if (!existsSync(join(libDir, 'index.json'))) {
  console.error(`Bibliotheek-checkout niet gevonden op: ${libDir}`);
  console.error('Geef het pad mee: node scripts/test-symbol-library-online.mjs <pad>');
  process.exit(2);
}

// --- ESM-bronnen importeren via temp-.mjs (package is CJS) ---
// De mappenstructuur blijft behouden en relatieve .js-imports worden naar
// .mjs herschreven, zodat modules met onderlinge imports (steel-catalog.js
// → templates/staalprofiel.js) ook werken.
const tmp = mkdtempSync(join(tmpdir(), 'opds-symlib-'));
function stageMjs(relPath) {
  const src = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/(from\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2.mjs$3');
  const target = join(tmp, relPath).replace(/\.js$/, '.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, src);
  return target;
}
function importAsMjs(relPath) {
  return import(pathToFileURL(stageMjs(relPath)).href);
}

stageMjs('js/symbols/templates/staalprofiel.js');
stageMjs('js/core/svg-veilig.js');
stageMjs('js/symbols/koker-notatie.js');
stageMjs('js/core/getal-invoer.js');
const online = await importAsMjs('js/solid/data/symbolLibraryOnline.js');
const locales = await importAsMjs('js/solid/data/symbolLocales.js');
const steel = await importAsMjs('js/symbols/steel-catalog.js');

let failures = 0;
let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FOUT: ${msg}`);
  }
}

// --- 1. Index parsen ---
console.log('1. parseLibraryIndex op lokale index.json');
const rawIndex = JSON.parse(readFileSync(join(libDir, 'index.json'), 'utf8'));
const idx = online.parseLibraryIndex(rawIndex);
assert(idx.countries.length >= 40, `verwacht >= 40 landen, kreeg ${idx.countries.length}`);
for (const sec of ['aec', 'electrical', 'process', 'mep']) {
  assert(idx.sectors.includes(sec), `sector '${sec}' ontbreekt in ${idx.sectors}`);
}
for (const c of idx.countries) {
  assert(c.id && c.names.en, `land ${c.id} mist en-naam`);
  assert(c.flag, `land ${c.id} mist vlag`);
  for (const [sec, ids] of Object.entries(c.sectors)) {
    for (const id of ids) {
      assert(idx.collections[id], `land ${c.id}/${sec} verwijst naar onbekende collectie '${id}'`);
    }
  }
}
const nl = idx.countries.find(c => c.id === 'nl');
assert(nl, "land 'nl' ontbreekt");
assert(nl && nl.sectors.aec && nl.sectors.aec.length > 0, 'nl heeft geen aec-collecties');
assert(online.parseLibraryIndex.length === 1, 'signatuur parseLibraryIndex');
let threw = false;
try { online.parseLibraryIndex({ formatVersion: 99 }); } catch { threw = true; }
assert(threw, 'onbekend formatVersion moet een fout geven');

// --- 2. Lokalisatie-helpers ---
console.log('2. pickLocalized / sectorLabel / titleFromFileName');
assert(online.pickLocalized({ en: 'Belgium', nl: 'België' }, 'nl') === 'België', 'nl-naam');
assert(online.pickLocalized({ en: 'Belgium', nl: 'België' }, 'nl-NL') === 'België', 'nl-NL → nl');
assert(online.pickLocalized({ en: 'Belgium' }, 'de') === 'Belgium', 'fallback en');
assert(online.pickLocalized({ bg: 'България' }, 'nl') === 'България', 'fallback eerste waarde');
assert(online.pickLocalized('plain', 'nl') === 'plain', 'string passthrough');
assert(online.sectorLabel('aec').length > 3, 'aec-label');
assert(online.sectorLabel('onbekend-x') === 'onbekend-x', 'onbekende sector = id');
assert(online.titleFromFileName('anti-paniekverlichting.svg') === 'Anti paniekverlichting', 'titel uit bestandsnaam');

// --- 3. SVG-veiligheidscheck tegen ALLE lokale symbolen ---
console.log('3. isSafeSymbolSvg accepteert alle bibliotheek-SVG\'s, weigert onveilige');
const collectionsDir = join(libDir, 'collections');
let svgCount = 0;
for (const dir of readdirSync(collectionsDir)) {
  const symDir = join(collectionsDir, dir, 'symbols');
  if (!existsSync(symDir)) continue;
  for (const f of readdirSync(symDir).filter(f => f.endsWith('.svg'))) {
    const svg = readFileSync(join(symDir, f), 'utf8');
    if (!online.isSafeSymbolSvg(svg)) {
      assert(false, `bibliotheek-SVG afgekeurd: ${dir}/${f}`);
    }
    svgCount++;
  }
}
console.log(`   ${svgCount} SVG's gecontroleerd`);
assert(svgCount > 100, `verwacht > 100 SVG's, kreeg ${svgCount}`);
assert(!online.isSafeSymbolSvg('<svg><script>alert(1)</script></svg>'), 'script geweigerd');
assert(!online.isSafeSymbolSvg('<svg onload="x()"></svg>'), 'event-handler geweigerd');
assert(!online.isSafeSymbolSvg('<svg><use href="https://evil/x.svg#a"/></svg>'), 'externe href geweigerd');
assert(!online.isSafeSymbolSvg('<svg><image href="data:x"/></svg>'), 'raster image geweigerd');
assert(!online.isSafeSymbolSvg('geen svg'), 'niet-svg geweigerd');

// --- 4. Collectie → palette-groep (symbols-type: nen1414-fire) ---
console.log('4. collectionToGroup: nen1414-fire (symbols)');
const fireMeta = JSON.parse(readFileSync(join(collectionsDir, 'nen1414-fire', 'collection.json'), 'utf8'));
const fireDir = join(collectionsDir, 'nen1414-fire', 'symbols');
const fireFiles = readdirSync(fireDir).filter(f => f.endsWith('.svg'))
  .map(name => ({ name, svg: readFileSync(join(fireDir, name), 'utf8') }));
const fireGroup = online.collectionToGroup('nen1414-fire', fireMeta, { svgFiles: fireFiles }, 'nl');
assert(fireGroup.id === 'lib-nen1414-fire', `groep-id: ${fireGroup.id}`);
assert(fireGroup.online === true, 'online-vlag');
assert(fireGroup.collectionId === 'nen1414-fire', 'collectionId');
assert(fireGroup.name === fireMeta.name.nl, `NL-naam: ${fireGroup.name}`);
assert(fireGroup.symbols.length === fireFiles.length, `symbolen: ${fireGroup.symbols.length}/${fireFiles.length}`);
const expectCount = idx.collections['nen1414-fire'].symbolCount;
assert(fireGroup.symbols.length === expectCount, `symbolCount uit index (${expectCount}) klopt met groep (${fireGroup.symbols.length})`);
for (const s of fireGroup.symbols) {
  assert(s.id.startsWith('lib-nen1414-fire-'), `symbool-id-prefix: ${s.id}`);
  assert(s.name && s.svg.includes('<svg'), `symbool ${s.id} heeft naam+svg`);
}
const enGroup = online.collectionToGroup('nen1414-fire', fireMeta, { svgFiles: fireFiles }, 'de');
assert(enGroup.name === fireMeta.name.en, 'fallback en-naam bij onbekende taal');

// --- 5. Collectie → palette-groep (stamps-type: nl-stamps) ---
console.log('5. collectionToGroup: nl-stamps (stamps)');
const stampsMeta = JSON.parse(readFileSync(join(collectionsDir, 'nl-stamps', 'collection.json'), 'utf8'));
const stampsJson = JSON.parse(readFileSync(join(collectionsDir, 'nl-stamps', 'stamps.json'), 'utf8'));
const stampsGroup = online.collectionToGroup('nl-stamps', stampsMeta, { stamps: stampsJson.stamps }, 'nl');
assert(stampsGroup.symbols.length === stampsJson.stamps.length, `stempels: ${stampsGroup.symbols.length}/${stampsJson.stamps.length}`);
for (const [i, s] of stampsGroup.symbols.entries()) {
  const src = stampsJson.stamps[i];
  assert(s.svg.includes(src.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')), `stempel-svg bevat tekst '${src.text}'`);
  assert(s.svg.includes(src.color), `stempel-svg bevat kleur ${src.color}`);
  assert(online.isSafeSymbolSvg(s.svg), 'gegenereerde stempel-svg is veilig');
}

// --- 6. matchesLocale met array-tags (gedownloade groepen) ---
console.log('6. matchesLocale: string- en array-tags');
const m = locales.matchesLocale;
assert(m({}, 'aec', 'nl') === true, 'geen tags → altijd tonen');
assert(m({ industry: 'aec', country: 'nl' }, 'aec', 'nl') === true, 'string-tags matchen');
assert(m({ industry: 'aec', country: 'nl' }, 'aec', 'be') === false, 'string-land mismatch');
assert(m({ industry: ['aec', 'electrical'], country: ['nl', 'be'] }, 'electrical', 'be') === true, 'array-tags matchen');
assert(m({ industry: ['aec'], country: ['nl', 'be'] }, 'aec', 'de') === false, 'array-land mismatch');
assert(m({ industry: [], country: [] }, 'aec', 'nl') === true, 'lege arrays = geen tags');

// --- 7. URL-opbouw ---
console.log('7. URL-helpers');
assert(online.LIBRARY_INDEX_URL === 'https://raw.githubusercontent.com/OpenAEC-Foundation/open-pdf-studio-library/main/index.json', 'index-URL');
assert(online.collectionJsonUrl('nen1414-fire').endsWith('/collections/nen1414-fire/collection.json'), 'collection.json-URL');
assert(online.symbolRawUrl('x', 'a b.svg').includes('a%20b.svg'), 'bestandsnaam ge-encodeerd');
assert(online.symbolsListApiUrl('x').startsWith('https://api.github.com/repos/OpenAEC-Foundation/open-pdf-studio-library/contents/collections/x/symbols'), 'contents-API-URL');

// --- 8. Parametrische staalcatalogi (steel-sections) ---
console.log('8. steel-sections: parametric.json → catalogus → palette-groep');
assert(online.parametricJsonUrl('x').endsWith('/collections/x/parametric.json'), 'parametric.json-URL');
const steelIds = Object.keys(idx.collections)
  .filter(id => (idx.collections[id].types || []).includes('parametric')
    && idx.collections[id].status === 'available');
assert(steelIds.length >= 10, `verwacht >= 10 parametrische collecties in de index, kreeg ${steelIds.length}`);
let famCount = 0;
for (const id of steelIds) {
  const metaS = JSON.parse(readFileSync(join(collectionsDir, id, 'collection.json'), 'utf8'));
  const rawS = JSON.parse(readFileSync(join(collectionsDir, id, 'parametric.json'), 'utf8'));
  const cat = steel.parseSteelSectionCatalog(rawS);
  assert(cat && cat.families.length > 0, `${id}: catalogus parsebaar`);
  const group = steel.steelCatalogToGroup(id, metaS, cat, 'nl');
  assert(group.id === `lib-${id}`, `${id}: groep-id`);
  assert(group.online === true && group.steelCatalog === true, `${id}: online+steelCatalog-vlaggen`);
  assert(group.collectionId === id, `${id}: collectionId`);
  assert(group.symbols.length === cat.families.length, `${id}: één palette-entry per familie`);
  for (const sym of group.symbols) {
    assert(sym.parametricId && sym.parametricId.startsWith(`steel-${id}-`), `${id}: parametricId-prefix (${sym.parametricId})`);
    assert(online.isSafeSymbolSvg(sym.svg), `${id}: preview-svg veilig (${sym.id})`);
  }
  famCount += cat.families.length;
}
console.log(`   ${steelIds.length} catalogi, ${famCount} families gecontroleerd`);
assert(steel.parseSteelSectionCatalog({ format: 'anders' }) === null, 'onbekend parametrisch formaat → null (SVG-fallback)');
let steelThrew = false;
try { steel.parseSteelSectionCatalog({ format: 'steel-sections', formatVersion: 99 }); } catch { steelThrew = true; }
assert(steelThrew, 'kapotte steel-sections-catalogus moet een fout geven');

console.log(`\n${checks} checks, ${failures} fouten`);
process.exit(failures ? 1 : 0);
