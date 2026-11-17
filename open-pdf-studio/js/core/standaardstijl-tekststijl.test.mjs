// De teken- en alineastijl van een tekstvak of callout hoort bij de
// standaardstijl van het gereedschap (GitHub #1150).
//
// Met het tekstvak- of callout-gereedschap actief en niets geselecteerd toont
// het eigenschappenpaneel de standaardstijl van het gereedschap. Uitlijning
// (links/midden/rechts, boven/midden/onder), regelafstand en vet, cursief,
// onderstrepen en doorhalen stonden daar als actief, maar kwamen niet in de
// stijlvoorkeuren: de stijltabel kende ze niet, dus setAsDefaultStyle schreef
// ze niet weg en het gereedschap las ze niet. Het volgende vak begon weer
// links, boven en gewoon; lettertype, grootte, kleuren en rand bleven wel.
//
// De echte preferences.js, het echte eigenschappenpaneel (propertiesStore),
// de echte annotatiemakers en de echte factory draaien hier.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
// De echte preferences.js in plaats van de stub van app-test-hooks.
register(`data:text/javascript,${encodeURIComponent(`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/core/preferences.js')) {
    return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8') };
  }
  return nextLoad(url, context);
}`)}`);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { state } = await import('./state.ts');
const { DEFAULT_PREFERENCES } = await import('./constants.ts');
const { applyDefaultStyle, setAsDefaultStyle } = await import('./preferences.js');
const { voegSamenMetStandaarden } = await import('./preferences-merge.js');
const { tekststijlUitVoorkeur } = await import('./style-prefs.js');
const { createAnnotationFromTool, buildAnnotationProps } = await import('../tools/annotation-creators.js');
const props = await import('../solid/stores/propertiesStore.js');
const { hasMixedRuns } = await import('../annotations/rendering/textbox-layout.js');
const { prefsForStorage } = await import('../tools/tool-set-session.js');

const TYPES = ['textbox', 'callout'];
const SLEUTELS = ['FontBold', 'FontItalic', 'FontUnderline', 'FontStrikethrough', 'TextAlign', 'TextVAlign', 'LineSpacing'];

function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
}

const STANDAARD = JSON.parse(JSON.stringify(state.preferences));
function verseVoorkeuren() {
  for (const k of Object.keys(state.preferences)) delete state.preferences[k];
  Object.assign(state.preferences, JSON.parse(JSON.stringify(STANDAARD)));
}

// Wacht tot een voorwaarde klopt (de stijl wordt via een dynamische import
// weggeschreven); ruime grens, geen vaste korte wachttijd.
async function totDat(voorwaarde, grens = 5000) {
  const eind = Date.now() + grens;
  while (!voorwaarde()) {
    if (Date.now() > eind) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

// Een nieuw vak zoals het gereedschap het na een sleep aanmaakt.
const nieuw = (type) => createAnnotationFromTool(type, 40, 40, 240, 140, null);

for (const type of TYPES) {
  test(`${type}: zonder eigen stijl is een nieuw vak gewoon, links en boven`, () => {
    verseVoorkeuren(); openen();
    const vak = nieuw(type);
    assert.equal(vak.type, type);
    for (const veld of ['fontBold', 'fontItalic', 'fontUnderline', 'fontStrikethrough']) {
      assert.ok(!vak[veld], veld);
    }
    assert.equal(vak.textAlign || 'left', 'left');
    assert.equal(vak.textVAlign || 'top', 'top');
    assert.equal(vak.lineSpacing, undefined);
  });

  test(`${type}: elke eigenschap uit het paneel (niets geselecteerd) komt op het volgende vak`, async () => {
    verseVoorkeuren(); openen();
    assert.equal(await props.showToolDefaults(type), true);
    assert.equal(props.annotProps.textAlign, 'left');
    assert.equal(props.annotProps.textVAlign, 'top');

    const keuzes = [
      ['textAlign', 'center', 'TextAlign', 'center'],
      ['textVAlign', 'middle', 'TextVAlign', 'middle'],
      ['lineSpacing', '2', 'LineSpacing', 2],
      ['fontBold', true, 'FontBold', true],
      ['fontItalic', true, 'FontItalic', true],
      ['fontUnderline', true, 'FontUnderline', true],
      ['fontStrikethrough', true, 'FontStrikethrough', true],
    ];
    for (const [veld, waarde, sleutel, verwacht] of keuzes) {
      props.updateAnnotProp(veld, waarde);
      assert.ok(await totDat(() => state.preferences[type + sleutel] === verwacht),
        `${veld} staat in de voorkeuren (${type + sleutel})`);
    }

    const vak = nieuw(type);
    assert.equal(vak.textAlign, 'center');
    assert.equal(vak.textVAlign, 'middle');
    assert.equal(vak.lineSpacing, 2);
    assert.equal(vak.fontBold, true);
    assert.equal(vak.fontItalic, true);
    assert.equal(vak.fontUnderline, true);
    assert.equal(vak.fontStrikethrough, true);
    // Ook het voorbeeld tijdens het slepen en een vak via de brug.
    assert.equal(buildAnnotationProps(type, 40, 40, 240, 140).textAlign, 'center');

    // Het gereedschap opnieuw kiezen toont de gekozen stijl.
    await props.showToolDefaults(type === 'textbox' ? 'callout' : 'textbox');
    assert.equal(props.annotProps.textAlign, 'left', 'het andere gereedschap houdt zijn eigen stijl');
    await props.showToolDefaults(type);
    assert.equal(props.annotProps.textAlign, 'center');
    assert.equal(props.annotProps.textVAlign, 'middle');
    assert.equal(Number(props.annotProps.lineSpacing), 2);
    assert.equal(props.annotProps.fontBold, true);
    assert.equal(props.annotProps.fontItalic, true);
    assert.equal(props.annotProps.fontUnderline, true);
    assert.equal(props.annotProps.fontStrikethrough, true);

    // Terugzetten werkt ook: rechts/onder, niet meer vet.
    props.updateAnnotProp('textAlign', 'right');
    props.updateAnnotProp('textVAlign', 'bottom');
    props.updateAnnotProp('fontBold', false);
    assert.ok(await totDat(() => state.preferences[type + 'TextAlign'] === 'right'
      && state.preferences[type + 'TextVAlign'] === 'bottom'
      && state.preferences[type + 'FontBold'] === false));
    const tweede = nieuw(type);
    assert.equal(tweede.textAlign, 'right');
    assert.equal(tweede.textVAlign, 'bottom');
    assert.ok(!tweede.fontBold);
    assert.equal(tweede.fontItalic, true);
    props.updateAnnotProp('textVAlign', 'top');
    assert.ok(await totDat(() => state.preferences[type + 'TextVAlign'] === 'top'));
    assert.equal(nieuw(type).textVAlign, undefined, 'boven is de gewone waarde en geen veld');
    // Elke wijziging schrijft de stijl van het getoonde gereedschap via een
    // dynamische import weg. Sluit het paneel, zodat een schrijver die nog
    // onderweg is niets meer wegschrijft in de volgende test.
    assert.equal(props.hideToolDefaults(), true);
    assert.equal(props.getCurrentAnnotation(), null);
  });

  test(`${type}: de stijl overleeft een herstart`, () => {
    verseVoorkeuren(); openen();
    setAsDefaultStyle({
      type, opacity: 1, fontBold: true, fontStrikethrough: true,
      textAlign: 'right', textVAlign: 'bottom', lineSpacing: 1.5,
    });
    // Wat wordt opgeslagen, door JSON heen en weer samengevoegd met de standaarden.
    const opgeslagen = JSON.parse(JSON.stringify(prefsForStorage(state.preferences)));
    for (const s of SLEUTELS) assert.ok(type + s in opgeslagen, `${type + s} wordt opgeslagen`);
    verseVoorkeuren();
    Object.assign(state.preferences, voegSamenMetStandaarden(DEFAULT_PREFERENCES, opgeslagen));
    const vak = nieuw(type);
    assert.equal(vak.fontBold, true);
    assert.ok(!vak.fontItalic);
    assert.equal(vak.fontStrikethrough, true);
    assert.equal(vak.textAlign, 'right');
    assert.equal(vak.textVAlign, 'bottom');
    assert.equal(vak.lineSpacing, 1.5);
  });

  test(`${type}: "Als standaard instellen" en "Standaardstijl toepassen" nemen de hele stijl mee`, () => {
    verseVoorkeuren(); openen();
    setAsDefaultStyle({
      type, opacity: 1, fontBold: true, fontItalic: true, fontUnderline: true,
      textAlign: 'center', textVAlign: 'middle', lineSpacing: 2.5,
    });
    const bestaand = { type, text: 'abc', textAlign: 'right', fontStrikethrough: true, textVAlign: 'bottom' };
    applyDefaultStyle(bestaand);
    assert.equal(bestaand.fontBold, true);
    assert.equal(bestaand.fontItalic, true);
    assert.equal(bestaand.fontUnderline, true);
    assert.equal(bestaand.fontStrikethrough, false, 'de standaard is niet doorgehaald');
    assert.equal(bestaand.textAlign, 'center');
    assert.equal(bestaand.textVAlign, 'middle');
    assert.equal(bestaand.lineSpacing, 2.5);

    // Een vak zonder eigen velden is gewoon, links en boven: dat wordt de stijl.
    setAsDefaultStyle({ type, opacity: 1 });
    assert.equal(state.preferences[type + 'FontBold'], false);
    assert.equal(state.preferences[type + 'TextAlign'], 'left');
    assert.equal(state.preferences[type + 'TextVAlign'], 'top');
    assert.ok(!(type + 'LineSpacing' in state.preferences), 'geen eigen regelafstand');
    assert.deepEqual(tekststijlUitVoorkeur(state.preferences, type), {});
    applyDefaultStyle(bestaand);
    assert.equal(bestaand.fontBold, false);
    assert.equal(bestaand.textAlign, 'left');
    assert.equal(bestaand.textVAlign, undefined);

    // Deels vet: vlak-breed vet uit de standaardstijl neemt de runs mee.
    setAsDefaultStyle({ type, opacity: 1, fontBold: true });
    const metRuns = { type, text: 'ab', textRuns: [[{ text: 'a', bold: true, italic: false }, { text: 'b', bold: false, italic: false }]] };
    applyDefaultStyle(metRuns);
    assert.ok(metRuns.textRuns[0].every((r) => r.bold === true));

    // 'mixed' (meervoudige selectie) is geen waarde en laat de voorkeur staan.
    setAsDefaultStyle({ type, opacity: 1, fontBold: 'mixed', textAlign: 'mixed', textVAlign: 'mixed', lineSpacing: 'mixed' });
    assert.equal(state.preferences[type + 'FontBold'], true);
    assert.equal(state.preferences[type + 'TextAlign'], 'left');
  });

  test(`${type}: de inline editor zet de stijl van een nieuw vak niet terug`, () => {
    verseVoorkeuren(); openen();
    setAsDefaultStyle({
      type, opacity: 1, fontBold: true, fontItalic: true, fontUnderline: true, fontStrikethrough: true,
      textAlign: 'center', textVAlign: 'middle', lineSpacing: 2,
    });
    const vak = nieuw(type);
    // De editor bouwt de regels op uit de basisstijl van het vak
    // (TextEditOverlay: { bold: !!ann.fontBold, italic: !!ann.fontItalic });
    // getypte tekst in die stijl is geen afwijkende opmaak, dus het vak
    // blijft een gewoon vak in zijn eigen stijl.
    const runs = [[{ text: 'Getypte tekst', bold: !!vak.fontBold, italic: !!vak.fontItalic }]];
    assert.equal(hasMixedRuns({ ...vak, text: 'Getypte tekst', textRuns: runs }), false);
    assert.equal(vak.fontBold, true);
    assert.equal(vak.textAlign, 'center');
  });
}

test('de inline editor leest de stijl van het vak en schrijft hem niet terug', () => {
  const editor = readFileSync(new URL('../tools/text-editing.js', import.meta.url), 'utf8');
  // Lezen voor de weergave in de editor.
  assert.match(editor, /if \(annotation\.fontBold\) styleObj\['font-weight'\] = 'bold'/);
  assert.match(editor, /if \(annotation\.textAlign\) styleObj\['text-align'\] = annotation\.textAlign/);
  assert.match(editor, /annotation\.textVAlign === 'middle' \|\| annotation\.textVAlign === 'bottom'/);
  assert.match(editor, /const ls = annotation\.lineSpacing \|\| 1\.2/);
  // Nergens een toewijzing aan de stijlvelden van het vak.
  for (const veld of ['fontBold', 'fontItalic', 'fontUnderline', 'fontStrikethrough', 'textAlign', 'textVAlign', 'lineSpacing']) {
    assert.doesNotMatch(editor, new RegExp(`\\b(ann|annotation)\\.${veld}\\s*=[^=]`), `${veld} wordt niet overschreven`);
  }
  // De overlay bouwt de regels met de basisstijl van het vak.
  const overlay = readFileSync(new URL('../solid/components/TextEditOverlay.jsx', import.meta.url), 'utf8');
  assert.match(overlay, /const base = \{ bold: !!ann\?\.fontBold, italic: !!ann\?\.fontItalic \}/);
});
