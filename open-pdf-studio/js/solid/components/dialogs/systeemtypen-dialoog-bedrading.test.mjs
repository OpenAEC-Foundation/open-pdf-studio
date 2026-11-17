// Bedrading van de systeemtypen-editor en de plugin-API (#567), als
// broncontrole. Het GEDRAG van de editor (Toepassen, Annuleren, omzetten,
// focus, controle van de maten) staat in de sessie en wordt uitgevoerd in
// js/solid/stores/systeemtypenEditorSessie.test.mjs; hier alleen dat de
// dialoog die sessie gebruikt en zelf niets toepast of omzet. Verder: de
// plugin-API meldt de feature, ruimt op bij _cleanup en geeft preferences als
// kopie; de native tool neemt de IFC-categorie van het type over.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const APP = new URL('../../../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, APP), 'utf8');

const dialoog = lees('js/solid/components/dialogs/SysteemtypenDialog.jsx');
const sessie = lees('js/solid/stores/systeemtypenEditorSessie.js');

/** De body van een functie in de bron (vanaf de naam tot de bijpassende accolade). */
function functieBody(bron, kop) {
  const start = bron.indexOf(kop);
  assert.ok(start >= 0, `${kop} gevonden`);
  const open = bron.indexOf('{', start);
  let diepte = 0;
  for (let i = open; i < bron.length; i++) {
    if (bron[i] === '{') diepte++;
    if (bron[i] === '}') { diepte--; if (diepte === 0) return bron.slice(open, i + 1); }
  }
  throw new Error(`geen einde voor ${kop}`);
}

test('de dialoog maakt één sessie met de gevraagde type-id en volgt het focussignaal', () => {
  assert.match(dialoog, /export default function SysteemtypenDialog\(props\)/);
  assert.match(dialoog, /const sessie = maakEditorSessie\(\{[\s\S]*typeId: props\.data\?\.typeId,\s*\}\);/);
  assert.match(dialoog, /registry: \{ getSysteemTypenData, commitSysteemTypen \}/);
  assert.match(dialoog, /documenten: \(\) => state\.documents \|\| \[\]/);
  assert.match(dialoog, /systeemtypenFocus\(\)/);
  assert.match(dialoog, /untrack\(\(\) => sessie\.focus\(f\.typeId\)\)/);
  assert.match(dialoog, /sessie\.luister\(/);
  // De beginselectie en de focus zelf zitten in de sessie.
  assert.match(sessie, /beginSelectie\(werk, typeId\)/);
  assert.match(functieBody(sessie, 'focus(typeId)'), /focusOpType\(/);
});

test('Annuleren, Escape en de sluitknop gaan via de sessie en sluiten daarna', () => {
  assert.match(dialoog, /const annuleren = \(\) => \{ sessie\.annuleren\(\); closeDialog\('systeemtypen'\); \};/);
  const knop = dialoog.match(/id="st-btn-annuleren"\s*\n?\s*onClick=\{([^}]*)\}/);
  assert.ok(knop, 'Annuleren-knop gevonden');
  assert.equal(knop[1].trim(), 'annuleren');
  assert.equal(dialoog.match(/onClose=\{([^}]*)\}/)[1].trim(), 'annuleren');
  // Annuleren in de sessie raakt registry en documenten niet.
  const annuleren = functieBody(sessie, 'annuleren()');
  for (const verboden of ['commitSysteemTypen', 'reassignSysteemType', 'documenten', 'redraw']) {
    assert.equal(annuleren.includes(verboden), false, `annuleren gebruikt geen ${verboden}`);
  }
});

test('de dialoog past zelf niets toe en zet niets om; dat doet alleen de sessie bij Toepassen', () => {
  for (const verboden of ['planEditorToepassen(', 'commitSysteemTypen(', 'reassignSysteemType(', 'saveSysteemTypen(',
    'normalizeSysteemType(', 'removeSysteemTypeFrom(']) {
    assert.equal(dialoog.includes(verboden), false, `de dialoog roept ${verboden} niet zelf aan`);
  }
  assert.match(dialoog, /const toepassen = \(\) => sessie\.toepassen\(\);/);
  // OK = Toepassen en daarna sluiten.
  assert.match(dialoog, /id="st-btn-ok"\s*\n?\s*onClick=\{\(\) => \{ toepassen\(\); closeDialog\('systeemtypen'\); \}\}/);
  // In de sessie: omzetten en committen alleen in toepassen(); omzetten en
  // verwijderen zet alleen in de wachtrij.
  const toepassen = functieBody(sessie, 'toepassen()');
  assert.match(toepassen, /planEditorToepassen\(/);
  assert.match(toepassen, /commitSysteemTypen\(/);
  assert.match(toepassen, /reassignSysteemType\(/);
  const rest = sessie.replace(toepassen, '');
  assert.equal(/reassignSysteemType\(|commitSysteemTypen\(/.test(rest.replace(/^\/\/.*$/gm, '')), false);
  const omzetten = functieBody(sessie, 'bevestigOmzetten()');
  assert.match(omzetten, /wachtrij = \[\.\.\.wachtrij,/);
  assert.equal(/redraw\(/.test(omzetten), false);
});

test('weergave: bibliotheeklabel, eigenaarlabel, beheerd-door-regel, onbevestigde maten en de melding', () => {
  assert.match(dialoog, /Systeemtypen \(bibliotheek\)/);
  assert.equal(dialoog.includes('Typen in dit document'), false);
  assert.match(dialoog, /eigenaarLabel\(/);
  assert.match(dialoog, /beheerdDoorTekst\(/);
  assert.match(dialoog, /placeholder="onbevestigd"/);
  assert.match(dialoog, /id="st-melding"/);
  assert.match(sessie, /gebruikNaWachtrij\(/);
  assert.match(functieBody(sessie, 'muteer(patch)'), /controleerEditorInvoer\(patch\)/);
  // De maatvelden geven een geweigerde invoer terug aan het veld.
  for (const id of ['st-cel-x', 'st-cel-y', 'st-strook-b', 'st-strook-y', 'st-sparing-klein', 'st-sparing-raveel']) {
    const veld = dialoog.slice(dialoog.indexOf(`id="${id}"`));
    assert.match(veld.slice(0, veld.indexOf('/>')), /, e\.target, current\(\)/, id);
  }
});

test('de plugin-API: feature-vlag, methoden, dispose in _cleanup en preferences als kopie', () => {
  const api = lees('js/plugins/plugin-api.js');
  assert.match(api, /systemTypes: true,/);
  assert.match(api, /createSystemTypeApi\(pluginId,/);
  const opruimen = functieBody(api, '_cleanup()');
  assert.match(opruimen, /systemTypes\.dispose\(\)/);
  const prefs = functieBody(api, 'getPreferences()');
  assert.match(prefs, /JSON\.parse\(JSON\.stringify\(state\.preferences\)\)/);
  for (const naam of ['listSystemTypes', 'getSystemType', 'systemTypeId', 'registerSystemType', 'updateSystemType',
    'selectSystemTypeForTool', 'openSystemTypeEditor', 'onSystemTypesChanged']) {
    assert.match(lees('js/plugins/system-type-api.js'), new RegExp(`\\b${naam}\\(`), naam);
  }
});

test('de native tool: type uit de tool-selectie, en het type wint de IFC-categorie', () => {
  const tool = lees('js/tools/tools/systeemraster-tool.js');
  assert.match(tool, /kiesToolType\(getSysteemTypenData\(\), getToolSysteemTypeId\(\)\)/);
  assert.match(tool, /typeInstanceVelden\(/);
  const standaard = tool.indexOf("ifcCategory: ifcCategoryForAnnotationType('systeemraster')");
  const typeVelden = tool.indexOf('typeInstanceVelden(');
  assert.ok(standaard > 0 && typeVelden > standaard, 'de standaardcategorie staat vóór de typevelden');
  assert.equal(/plafond \? 600/.test(tool), false, 'geen vaste 600 meer');
});

test('de tool-keuze geldt per tool-sessie: de tool meldt activeren en deactiveren', () => {
  const tool = lees('js/tools/tools/systeemraster-tool.js');
  const maak = functieBody(tool, 'function _makeVariantTool(');
  assert.match(maak, /if \(variant === 'plafond'\)/);
  assert.match(maak, /tool\.onActivate = \(\) => toolSysteemGeactiveerd\(\);/);
  assert.match(maak, /toolSysteemGedeactiveerd\(\);\s*return basisDeactiveer\(\.\.\.args\);/);
  // setTool activeert de nieuwe tool, ook als het dezelfde is (opnieuw gekozen
  // in het lint of de bibliotheek), en ná de deactivering van de vorige.
  const manager = lees('js/tools/manager.js');
  const setTool = functieBody(manager, 'export function setTool(');
  const deactiveer = setTool.indexOf('currentToolObj.onDeactivate(ctx)');
  const gezet = setTool.indexOf('state.currentTool = tool;');
  const activeer = setTool.indexOf('newToolObj.onActivate(');
  assert.ok(deactiveer > 0 && gezet > deactiveer && activeer > gezet, 'deactiveren, zetten, activeren');
  const wisselTak = functieBody(setTool, 'if (state.currentTool !== tool) {');
  assert.equal(wisselTak.includes('onActivate'), false, 'activeren staat niet in de wissel-tak');
  // De plugin-API kiest via de registry, zodat er na een geblokkeerde
  // activering geen keuze blijft hangen, en ruimt haar keuze op bij dispose.
  const api = lees('js/plugins/system-type-api.js');
  assert.match(api, /host\.kiesToolSysteemType\(snapshot\.id, \(\) => host\.setTool\(SYSTEEM_TOOL\)\)/);
  assert.match(functieBody(api, '    dispose() {'), /host\.wisToolSysteemTypeVanExtensie\(pluginId\)/);
});

test('saver en loader: geen standaardmaat voor een instance met type', () => {
  const saver = lees('js/pdf/saver.js');
  assert.equal(/OPS_SgPlaatB: sgP\.plaatBreedteMm,/.test(saver), false);
  assert.match(saver, /if \(sgP\.plaatBreedteMm != null\) sgDict\.OPS_SgPlaatB = sgP\.plaatBreedteMm;/);
  assert.match(saver, /if \(sgP\.plaatHoogteMm != null\) sgDict\.OPS_SgPlaatH = sgP\.plaatHoogteMm;/);
  const loader = lees('js/pdf/loader/annotation-converter.js');
  assert.match(loader, /plaatBreedteMm: extraColors\.sgPlaatBreedteMm \?\? \(sgTypeId \? undefined : 2000\)/);
  assert.match(loader, /plaatHoogteMm: extraColors\.sgPlaatHoogteMm \?\? \(sgTypeId \? undefined : 2000\)/);
});

test('eigenschappenpaneel: randstukken van een onbevestigd type tonen "onbevestigd", geen volle plaat', () => {
  const sectie = lees('js/solid/components/properties-panel/SysteemrasterSection.jsx');
  assert.match(sectie, /return randstukkenVoorPaneel\(buildSysteemraster\(pseudo, systeemrasterBuildOpts\(pseudo\)\)\);/);
  assert.match(sectie, /const randMm = \(\) => randstukken\(\)\?\.randMm \|\| null;/);
  // De randmaten (met "volle plaat" voor 0) staan alleen in de tak met randMm;
  // de terugval zegt "onbevestigd".
  const tak = sectie.slice(sectie.indexOf('<Show when={randMm()}'));
  assert.match(tak, /fallback=\{[\s\S]*systeemraster\.edgeUnconfirmed[\s\S]*\}>/);
  assert.equal(/geom\.randMm/.test(sectie), false, 'nergens de ruwe randMm van een onbevestigde geometrie');
});

test('IFC-predefined type: de saver schrijft alleen een eigen waarde, de loader laat het type winnen', () => {
  // Dezelfde regels als de rondgang in js/pdf/loader/systeemraster-ifc-rondgang.test.mjs.
  const saver = lees('js/pdf/saver.js');
  assert.match(saver, /OPS_IfcCategory: pdfTextString\(ann\.ifcCategory \|\| ''\),/);
  assert.match(saver, /if \(ann\.ifcPredefinedType\) \{\s*sgDict\.OPS_IfcPredefined = pdfTextString\(ann\.ifcPredefinedType\);/);
  const loader = lees('js/pdf/loader/annotation-converter.js');
  assert.match(loader, /ifcPredefinedType: ifcPredefinedNaLaden\(\{\s*typeDef: sgResolvedType,\s*bewaard: extraColors\.opsIfcPredefined,\s*sysType: sgSystem\.type,\s*\}\),/);
  assert.equal(/sgSystem\.type === 'plafond' \? 'CEILING'/.test(loader), false, 'geen verzonnen CEILING meer');
});
