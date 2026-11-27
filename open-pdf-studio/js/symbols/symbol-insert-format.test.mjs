// Opmaak tijdens het invoegen van symbolen (issue #587): instellingen die de
// gebruiker vóór het plaatsen kiest en die de hele invoegsessie meegaan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INSERT_FORMAT_KEYS,
  defaultInsertFormat,
  mergeInsertFormat,
  symbolInsertKind,
  nextInsertSession,
  supportedInsertOptions,
  insertFormatProps,
  formatSymbolSvg,
  naturalSymbolFormat,
  insertFormatDisplay,
  svgViewBoxAspect,
} from './symbol-insert-format.js';

const LIJN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
  + '<line x1="0" y1="0" x2="40" y2="40" stroke="#000" stroke-width="2"/>'
  + '<circle cx="20" cy="20" r="5" fill="#000"/></svg>';
const VLAK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40">'
  + '<rect x="0" y="0" width="80" height="40" fill="#d00"/></svg>';
const BEELD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
  + '<image href="https://example.org/a.png" width="10" height="10"/></svg>';

// --- standaardwaarden -------------------------------------------------------

test('de standaardopmaak laat het symbool zoals het ontworpen is', () => {
  const d = defaultInsertFormat();
  assert.deepEqual(Object.keys(d).sort(), [...INSERT_FORMAT_KEYS].sort());
  for (const k of INSERT_FORMAT_KEYS) assert.equal(d[k], null, k);
});

test('elke aanroep geeft een eigen object, zodat niemand de standaard kan muteren', () => {
  const a = defaultInsertFormat();
  a.strokeColor = '#ff0000';
  assert.equal(defaultInsertFormat().strokeColor, null);
});

// --- samenvoegen --------------------------------------------------------------

test('een wijziging raakt alleen de genoemde optie en muteert de invoer niet', () => {
  const start = defaultInsertFormat();
  const na = mergeInsertFormat(start, { strokeColor: '#FF0000' });
  assert.equal(na.strokeColor, '#ff0000');
  assert.equal(na.lineWidth, null);
  assert.equal(start.strokeColor, null);
  const verder = mergeInsertFormat(na, { lineWidth: 1.5, opacity: 0.5, blendMode: 'multiply' });
  assert.deepEqual(verder, { strokeColor: '#ff0000', lineWidth: 1.5, opacity: 0.5, blendMode: 'multiply' });
});

test('onbruikbare waarden worden genegeerd in plaats van de voorkeur te wissen', () => {
  const p = mergeInsertFormat(defaultInsertFormat(), {
    strokeColor: '#00ff00', lineWidth: 2, opacity: 0.4, blendMode: 'multiply',
  });
  const na = mergeInsertFormat(p, {
    strokeColor: '', lineWidth: -1, opacity: 3, blendMode: 'plasma', onbekend: 5,
  });
  assert.deepEqual(na, p);
  assert.equal('onbekend' in na, false);
  assert.deepEqual(mergeInsertFormat(p, { lineWidth: NaN, opacity: 'abc' }), p);
  assert.deepEqual(mergeInsertFormat(p, { lineWidth: 500 }), p);
  // Alle zestien mengmodi van het menu (#614), met de modelnamen.
  assert.equal(mergeInsertFormat(p, { blendMode: 'screen' }).blendMode, 'screen');
  assert.equal(mergeInsertFormat(p, { blendMode: 'colorDodge' }).blendMode, 'colorDodge');
  assert.equal(mergeInsertFormat(p, { blendMode: 'color-dodge' }).blendMode, 'multiply');
});

test('null zet één optie terug op de eigen opmaak van het symbool', () => {
  const p = mergeInsertFormat(defaultInsertFormat(), { strokeColor: '#00ff00', lineWidth: 2 });
  const na = mergeInsertFormat(p, { strokeColor: null });
  assert.equal(na.strokeColor, null);
  assert.equal(na.lineWidth, 2);
});

test('samenvoegen met een onbruikbare uitgangstoestand begint bij de standaard', () => {
  assert.deepEqual(mergeInsertFormat(null, { opacity: 0.5 }),
    { ...defaultInsertFormat(), opacity: 0.5 });
  assert.deepEqual(mergeInsertFormat(undefined, null), defaultInsertFormat());
});

// --- welk soort symbool wordt er ingevoegd ----------------------------------

test('een paletsymbool (stempel met markering) is een SVG-symbool', () => {
  assert.equal(symbolInsertKind('stamp', { stampSvg: LIJN_SVG, symbolInsert: true }), 'svg');
});

test('een stempel zonder paletmarkering (extensie, stempelkiezer) is geen symboolinvoeging', () => {
  assert.equal(symbolInsertKind('stamp', { stampSvg: LIJN_SVG }), null);
  assert.equal(symbolInsertKind('stamp', null), null);
  assert.equal(symbolInsertKind('stamp', { symbolInsert: true }), null);
});

test('parametrische symbolen en wanden uit het palet tellen mee', () => {
  assert.equal(symbolInsertKind('parametricSymbol', null), 'parametric');
  assert.equal(symbolInsertKind('wall', { wallPattern: 'x', symbolInsert: true }), 'wall');
  assert.equal(symbolInsertKind('wall', { wallPattern: 'x' }), null);
});

test('andere gereedschappen zijn geen symboolinvoeging', () => {
  for (const tool of ['select', 'hand', 'line', 'box', 'textbox', undefined]) {
    assert.equal(symbolInsertKind(tool, { symbolInsert: true, stampSvg: LIJN_SVG }), null, String(tool));
  }
});

// --- sessie -------------------------------------------------------------------

test('een nieuwe invoegsessie begint met de standaardopmaak', () => {
  const s = nextInsertSession(null, 'svg');
  assert.equal(s.active, true);
  assert.deepEqual(s.prefs, defaultInsertFormat());
});

test('hetzelfde of een ander symbool kiezen houdt de voorkeuren vast', () => {
  let s = nextInsertSession(null, 'svg');
  s = { ...s, prefs: mergeInsertFormat(s.prefs, { strokeColor: '#0000ff' }) };
  const zelfde = nextInsertSession(s, 'svg');
  assert.equal(zelfde.active, true);
  assert.equal(zelfde.prefs.strokeColor, '#0000ff');
  const ander = nextInsertSession(zelfde, 'parametric');
  assert.equal(ander.prefs.strokeColor, '#0000ff');
  const wand = nextInsertSession(ander, 'wall');
  assert.equal(wand.prefs.strokeColor, '#0000ff');
});

test('de invoegmodus verlaten zet alles terug; opnieuw beginnen geeft de standaard', () => {
  let s = nextInsertSession(null, 'svg');
  s = { ...s, prefs: mergeInsertFormat(s.prefs, { strokeColor: '#0000ff', opacity: 0.3 }) };
  const uit = nextInsertSession(s, null);
  assert.equal(uit.active, false);
  assert.deepEqual(uit.prefs, defaultInsertFormat());
  const weer = nextInsertSession(uit, 'svg');
  assert.equal(weer.active, true);
  assert.deepEqual(weer.prefs, defaultInsertFormat());
});

test('de sessiefunctie muteert de vorige sessie niet', () => {
  const s = { active: true, prefs: mergeInsertFormat(null, { lineWidth: 3 }) };
  nextInsertSession(s, null);
  assert.equal(s.active, true);
  assert.equal(s.prefs.lineWidth, 3);
});

// --- welke opties gelden voor welk symbool ----------------------------------

test('een SVG-symbool met lijnen ondersteunt kleur, lijndikte, dekking en mengmodus', () => {
  assert.deepEqual(supportedInsertOptions('svg', LIJN_SVG).sort(),
    ['blendMode', 'lineWidth', 'opacity', 'strokeColor']);
});

test('een puur gevuld SVG-symbool kent geen lijndikte', () => {
  const opties = supportedInsertOptions('svg', VLAK_SVG);
  assert.equal(opties.includes('lineWidth'), false);
  assert.equal(opties.includes('strokeColor'), true);
});

test('een symbool dat alleen uit een afbeelding bestaat is niet te herkleuren', () => {
  const opties = supportedInsertOptions('svg', BEELD_SVG);
  assert.equal(opties.includes('strokeColor'), false);
  assert.equal(opties.includes('opacity'), true);
});

test('parametrische symbolen ondersteunen alles; een wand rekent zijn lijndikte zelf', () => {
  assert.deepEqual(supportedInsertOptions('parametric').sort(),
    ['blendMode', 'lineWidth', 'opacity', 'strokeColor']);
  assert.deepEqual(supportedInsertOptions('wall').sort(), ['blendMode', 'opacity', 'strokeColor']);
  assert.deepEqual(supportedInsertOptions(null), []);
});

// --- toepassen op een nieuw symbool -----------------------------------------

test('zonder gekozen opmaak krijgt een symbool niets extra mee', () => {
  assert.deepEqual(insertFormatProps(defaultInsertFormat(), 'svg', LIJN_SVG), {});
  assert.deepEqual(insertFormatProps(null, 'parametric'), {});
});

test('lijnkleur gaat naar color én strokeColor, de rest één op één', () => {
  const p = mergeInsertFormat(null, { strokeColor: '#ff0000', lineWidth: 1.2, opacity: 0.5, blendMode: 'multiply' });
  assert.deepEqual(insertFormatProps(p, 'parametric'), {
    color: '#ff0000', strokeColor: '#ff0000', lineWidth: 1.2, opacity: 0.5, blendMode: 'multiply',
  });
});

test('een niet-ondersteunde optie wordt overgeslagen maar blijft in de voorkeuren staan', () => {
  const p = mergeInsertFormat(null, { strokeColor: '#ff0000', lineWidth: 1.2 });
  const props = insertFormatProps(p, 'svg', VLAK_SVG);
  assert.deepEqual(props, { color: '#ff0000', strokeColor: '#ff0000' });
  assert.equal(p.lineWidth, 1.2);
  // Het volgende symbool dat wél lijnen heeft, krijgt de dikte gewoon weer.
  assert.equal(insertFormatProps(p, 'svg', LIJN_SVG).lineWidth, 1.2);
  // Een wand krijgt de kleur, de dikte niet.
  assert.deepEqual(insertFormatProps(p, 'wall'), { color: '#ff0000', strokeColor: '#ff0000' });
});

test('zonder symboolsoort wordt er niets toegepast', () => {
  const p = mergeInsertFormat(null, { strokeColor: '#ff0000' });
  assert.deepEqual(insertFormatProps(p, null), {});
});

// --- de SVG-bron van een SVG-symbool ----------------------------------------

test('standaardopmaak laat de bron ongemoeid', () => {
  assert.equal(formatSymbolSvg(LIJN_SVG, defaultInsertFormat(), 400), LIJN_SVG);
  assert.equal(formatSymbolSvg(LIJN_SVG, null, 400), LIJN_SVG);
});

test('een gekozen kleur komt in de bron; wit en none blijven staan', () => {
  const svg = '<svg viewBox="0 0 10 10"><rect fill="#fff" stroke="#000" stroke-width="1"/>'
    + '<path fill="none" stroke="#d00" stroke-width="1"/></svg>';
  const uit = formatSymbolSvg(svg, mergeInsertFormat(null, { strokeColor: '#0000ff' }), 100);
  assert.match(uit, /fill="#fff"/);
  assert.match(uit, /fill="none"/);
  assert.equal((uit.match(/stroke="#0000ff"/g) || []).length, 2);
});

test('een gekozen lijndikte wordt omgerekend naar de viewBox van de plaatsing', () => {
  // viewBox 40 breed, geplaatst over 400 pagina-eenheden: 1 eenheid = 10.
  // Lijndikte 3 pagina-eenheden => 0,3 gebruikerseenheden.
  const uit = formatSymbolSvg(LIJN_SVG, mergeInsertFormat(null, { lineWidth: 3 }), 400);
  assert.match(uit, /stroke-width="0\.3"/);
});

test('zonder plaatsingsbreedte geen dikte, wel kleur', () => {
  const p = mergeInsertFormat(null, { lineWidth: 3, strokeColor: '#00ff00' });
  const uit = formatSymbolSvg(LIJN_SVG, p, undefined);
  assert.match(uit, /stroke-width="2"/);
  assert.match(uit, /stroke="#00ff00"/);
});

test('een puur gevuld symbool krijgt geen lijndikte in de bron', () => {
  const uit = formatSymbolSvg(VLAK_SVG, mergeInsertFormat(null, { lineWidth: 3 }), 400);
  assert.equal(uit, VLAK_SVG);
});

// --- weergave in de werkbalk ------------------------------------------------

test('de eigen opmaak van een SVG-symbool: dominante kleur en werkelijke lijndikte', () => {
  const n = naturalSymbolFormat('svg', LIJN_SVG, 400);
  assert.equal(n.strokeColor, '#000');
  assert.equal(n.lineWidth, 20);
  const vlak = naturalSymbolFormat('svg', VLAK_SVG, 400);
  assert.equal(vlak.strokeColor, '#d00');
  assert.equal(vlak.lineWidth, null);
});

test('parametrische symbolen en wanden zijn standaard zwart', () => {
  assert.equal(naturalSymbolFormat('parametric').strokeColor, '#000000');
  assert.equal(naturalSymbolFormat('wall').strokeColor, '#000000');
});

test('de werkbalk toont de keuze, anders de eigen opmaak, anders de vaste terugval', () => {
  const leeg = insertFormatDisplay(defaultInsertFormat(), {});
  assert.deepEqual(leeg, { strokeColor: '#000000', lineWidth: 1, opacity: 100, blendMode: 'normal' });
  const eigen = insertFormatDisplay(defaultInsertFormat(), { strokeColor: '#d00', lineWidth: 0.5 });
  assert.equal(eigen.strokeColor, '#d00');
  assert.equal(eigen.lineWidth, 0.5);
  const gekozen = insertFormatDisplay(
    mergeInsertFormat(null, { strokeColor: '#00ff00', lineWidth: 2, opacity: 0.35, blendMode: 'multiply' }),
    { strokeColor: '#d00', lineWidth: 0.5 },
  );
  assert.deepEqual(gekozen, { strokeColor: '#00ff00', lineWidth: 2, opacity: 35, blendMode: 'multiply' });
});

test('beeldverhouding uit de viewBox, met 1 als terugval', () => {
  assert.equal(svgViewBoxAspect(VLAK_SVG), 2);
  assert.equal(svgViewBoxAspect(LIJN_SVG), 1);
  assert.equal(svgViewBoxAspect('<svg></svg>'), 1);
  assert.equal(svgViewBoxAspect(null), 1);
});

// --- bedrading in de app (broncontrole; de UI draait niet onder node) -------

const HIER = dirname(fileURLToPath(import.meta.url));
const bron = (pad) => readFileSync(join(HIER, pad), 'utf8');

test('het palet markeert symbolen en wanden als symboolinvoeging', () => {
  const palet = bron('../solid/components/SymbolPalette.jsx');
  assert.equal((palet.match(/symbolInsert: true/g) || []).length, 2);
});

test('elke gereedschapswissel werkt de invoegsessie bij', () => {
  const manager = bron('../tools/manager.js');
  assert.match(manager, /syncSymbolInsertSession\(tool, state\.toolOverrides\)/);
});

test('plaatsing en voorbeeld gebruiken de sessie-opmaak', () => {
  assert.match(bron('../annotations/stamps.js'), /symbolInsertStampFormat\(overrides, stampWidth\)/);
  assert.match(bron('../tools/annotation-creators.js'), /props = withSymbolInsertFormat\(tool, props\)/);
  const preview = bron('../tools/shape-preview.js');
  assert.match(preview, /drawShapePreview\([^)]*tool = state\.currentTool\)/);
  assert.match(preview, /withSymbolInsertFormat\(tool, tempAnn\)/);
  assert.match(bron('../tools/tools/text-tool.js'), /symbolInsertPreviewStyle\(\)/);
});

test('de opmaakwerkbalk wijzigt tijdens het invoegen de sessie, niet de selectie', () => {
  const tab = bron('../solid/components/ribbon/FormatTab.jsx');
  // De doelkeuze staat sinds #668 in formatStore (ook het lint gebruikt haar):
  // tijdens het invoegen gaat elke optie naar de sessie.
  assert.match(bron('../solid/stores/formatStore.js'),
    /case 'symbool':\s*setSymbolInsertOption\(patch\);\s*return;/);
  assert.match(tab, /zetOpmaak, opmaakVoorNieuw, opmaakOndersteunt,\s*\} from '\.\.\/\.\.\/stores\/formatStore\.js';/);
  // Geen enkele directe applyToSelected meer voor lijnkleur, dikte, dekking of mengmodus.
  assert.doesNotMatch(tab, /applyToSelected\(ann => \{ ann\.strokeColor = color/);
  assert.doesNotMatch(tab, /applyToSelected\(ann => \{ zetRanddikte/);
  assert.doesNotMatch(tab, /applyToSelected\(ann => \{ ann\.opacity/);
  assert.doesNotMatch(tab, /applyToSelected\(ann => \{ ann\.blendMode/);
  const ui = bron('../annotations/rendering/ui-state.js');
  assert.match(ui, /const zichtbaar = hasSelection \|\| symbolInsert \|\| toolFormat;[\s\S]*setContextualTabsVisible\(zichtbaar\)/);
});
