// Kleur en breedte in het lint, en de opmaakwerkbalk, tijdens het tekenen
// (GitHub #668).
//
// Kleur en Breedte onder Eigenschappen op het tabblad Annotatie schreven
// alleen twee lintsignalen. Elk gereedschap las eerst zijn eigen voorkeur
// (lineStrokeColor, rectBorderWidth, ...) en gebruikte de lintwaarde alleen
// als terugval, dus een nieuwe annotatie kreeg ze nooit. Alleen de vrije hand
// deed het omgekeerd: daar won de lintwaarde van de eigen voorkeur van het
// gereedschap, die het eigenschappenpaneel bij een actief gereedschap juist
// instelt. De opmaakwerkbalk verscheen alleen bij een selectie.
//
// Nu werken lint en werkbalk op hetzelfde doel: de selectie, anders het
// volgende object van het actieve tekengereedschap (zijn stijlvoorkeuren,
// die blijven staan voor het volgende object), of de invoegsessie van
// symbolen.
//
// De echte annotatiemakers, het opmaakarchief, de lintstatus en de state
// draaien hier onder node (zie ../core/app-test-hooks.mjs). bridge.ts wordt
// hier een stub met de ECHTE lint- en opmaakexports, zoals in de app.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);

const LINT = new URL('../solid/stores/ribbonStore.js', import.meta.url).href;
const OPMAAK = new URL('../solid/stores/formatStore.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(String.raw`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ECHT = {
  switchRibbonTab: ['${LINT}', 'switchToTab'],
  ribbonActiveTab: ['${LINT}', 'activeTab'],
  setRibbonActiveTab: ['${LINT}', 'setActiveTab'],
  contextualTabsVisible: ['${LINT}', 'contextualTabsVisible'],
  setContextualTabsVisible: ['${LINT}', 'setContextualTabsVisible'],
  getColorPickerValue: ['${LINT}', 'getColorPickerValue'],
  setColorPickerValue: ['${LINT}', 'setColorPickerValue'],
  getLineWidthValue: ['${LINT}', 'getLineWidthValue'],
  setLineWidthValue: ['${LINT}', 'setLineWidthValue'],
  syncFormatStore: ['${OPMAAK}', 'syncFormatStore'],
  applyToSelected: ['${OPMAAK}', 'applyToSelected'],
};
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/bridge.ts')) {
    const bron = readFileSync(fileURLToPath(url), 'utf8');
    const namen = new Set();
    for (const m of bron.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const deel of m[1].split(',')) {
        const naam = deel.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(naam)) namen.add(naam);
      }
    }
    const regels = [];
    for (const naam of namen) {
      if (ECHT[naam]) regels.push('export { ' + ECHT[naam][1] + ' as ' + naam + " } from '" + ECHT[naam][0] + "';");
      else regels.push('export function ' + naam + '() {}');
    }
    return { format: 'module', shortCircuit: true, source: regels.join('\n') };
  }
  return nextLoad(url, context);
}`)}`);

const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { getStyleMapping } = await import('../core/stijl-mapping.js');
const go = await import('./gereedschap-opmaak.js');
const {
  createAnnotationFromTool, createMeasureAreaAnnotation, createMeasurePerimeterAnnotation,
} = await import('./annotation-creators.js');
const lint = await import('../solid/stores/ribbonStore.js');
const opmaak = await import('../solid/stores/formatStore.js');
const { updateContextualTabs } = await import('../annotations/rendering/ui-state.js');
// De werkbalk volgt de voorkeuren via een effect dat na het laden start.
await new Promise((r) => setTimeout(r, 0));

const bron = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

// Een verse set voorkeuren per test: de standaarden uit state.ts.
const STANDAARD = JSON.parse(JSON.stringify(state.preferences));
function verseVoorkeuren() {
  for (const k of Object.keys(state.preferences)) delete state.preferences[k];
  Object.assign(state.preferences, JSON.parse(JSON.stringify(STANDAARD)));
}

function kies(tool) {
  state.currentTool = tool;
  state.toolOverrides = null;
}

// ── De pure regels ──────────────────────────────────────────────────────────

test('welke opties een gereedschap krijgt', () => {
  assert.deepEqual(go.gereedschapOpmaakOpties('line'), ['strokeColor', 'lineWidth', 'opacity', 'borderStyle']);
  assert.deepEqual(go.gereedschapOpmaakOpties('arrow'),
    ['strokeColor', 'lineWidth', 'opacity', 'borderStyle', 'startHead', 'endHead']);
  assert.deepEqual(go.gereedschapOpmaakOpties('box'),
    ['strokeColor', 'lineWidth', 'opacity', 'borderStyle', 'fillColor', 'fillOpacity']);
  // Aparte vul-dekking (#685) niet bij de ellips (halve dekking) en de wolk
  // (tekent zonder vulling).
  assert.ok(!go.gereedschapOndersteunt('ellipse', 'fillOpacity'));
  assert.ok(!go.gereedschapOndersteunt('cloud', 'fillOpacity'));
  assert.ok(!go.gereedschapOndersteunt('line', 'fillOpacity'));
  // Markeren en notitie hebben alleen een kleur.
  assert.deepEqual(go.gereedschapOpmaakOpties('highlight'), ['strokeColor']);
  assert.deepEqual(go.gereedschapOpmaakOpties('comment'), ['strokeColor']);
  // De ellips leest de cirkelvoorkeuren.
  assert.equal(go.stijlTypeVanGereedschap('ellipse'), 'circle');
  assert.ok(go.gereedschapOndersteunt('ellipse', 'fillColor'));
  // Gereedschappen zonder instelbare stijl: geen doel voor de werkbalk.
  for (const tool of ['select', 'hand', 'stamp', 'parametricSymbol', 'redaction', 'eraser', '', null]) {
    assert.deepEqual(go.gereedschapOpmaakOpties(tool), [], String(tool));
    assert.equal(go.gereedschapMetOpmaak(tool), null, String(tool));
  }
});

test('een selectie gaat voor het gereedschap', () => {
  assert.equal(go.gereedschapMetOpmaak('line', 0), 'line');
  assert.equal(go.gereedschapMetOpmaak('line', 1), null);
});

test('schrijven en lezen gaan via de stijlvoorkeuren van het gereedschap', () => {
  const prefs = { rectStrokeColor: '#FF0000', rectBorderWidth: 1, rectOpacity: 100, rectBorderStyle: 'solid',
    rectFillColor: '#FFFBEB', rectFillNone: true };
  assert.equal(go.zetGereedschapOpmaak(prefs, 'box', {
    strokeColor: '#00aa00', lineWidth: 4.5, opacity: 0.25, borderStyle: 'dashed', fillColor: '#abcdef',
  }), true);
  // De vulling houdt haar dekking (100) als alleen de lijn verandert (#685).
  assert.deepEqual(prefs, { rectStrokeColor: '#00aa00', rectBorderWidth: 4.5, rectOpacity: 25,
    rectBorderStyle: 'dashed', rectFillColor: '#abcdef', rectFillNone: false, rectFillOpacity: 100 });
  assert.deepEqual(go.leesGereedschapOpmaak(prefs, 'box'), {
    textColor: '#000000',
    strokeColor: '#00aa00', lineWidth: 4.5, opacity: 25, fillOpacity: 100, borderStyle: 'dashed',
    fillColor: '#abcdef', startHead: 'none', endHead: 'none',
  });
  go.zetGereedschapOpmaak(prefs, 'box', { fillOpacity: 0.3 });
  assert.equal(prefs.rectFillOpacity, 30);
  assert.equal(go.leesGereedschapOpmaak(prefs, 'box').fillOpacity, 30);
  // Zonder eigen voorkeur toont de werkbalk de dekking.
  assert.equal(go.leesGereedschapOpmaak({ circleOpacity: 60 }, 'circle').fillOpacity, 60);
  // Geen vulling: de kleur blijft bewaard voor later.
  go.zetGereedschapOpmaak(prefs, 'box', { fillColor: null });
  assert.equal(prefs.rectFillNone, true);
  assert.equal(prefs.rectFillColor, '#abcdef');
  assert.equal(go.leesGereedschapOpmaak(prefs, 'box').fillColor, null);
  // Onbruikbare waarden en opties die het gereedschap niet kent: niets.
  const voor = { ...prefs };
  assert.equal(go.zetGereedschapOpmaak(prefs, 'box', {
    lineWidth: 0, opacity: 3, strokeColor: '', borderStyle: '', blendMode: 'multiply', startHead: 'open',
  }), false);
  assert.deepEqual(prefs, voor);
  assert.equal(go.zetGereedschapOpmaak(prefs, 'select', { strokeColor: '#000000' }), false);
});

// ── Elke aangeboden optie komt op de nieuwe annotatie ───────────────────────

const WAARDE = {
  textColor: '#123456',
  strokeColor: '#12ab34', lineWidth: 7.5, opacity: 0.4, borderStyle: 'dashed',
  fillColor: '#abcdef', fillOpacity: 0.25, startHead: 'diamond', endHead: 'square',
};
const KLOPT = {
  textColor: (a) => a.textColor === WAARDE.textColor,
  strokeColor: (a) => a.color === WAARDE.strokeColor && (a.strokeColor ?? a.color) === WAARDE.strokeColor,
  lineWidth: (a) => a.lineWidth === WAARDE.lineWidth,
  opacity: (a) => Math.abs(a.opacity - WAARDE.opacity) < 1e-9,
  borderStyle: (a) => a.borderStyle === WAARDE.borderStyle,
  fillColor: (a) => a.fillColor === WAARDE.fillColor,
  fillOpacity: (a) => Math.abs(a.fillOpacity - WAARDE.fillOpacity) < 1e-9,
  startHead: (a) => a.startHead === WAARDE.startHead,
  endHead: (a) => a.endHead === WAARDE.endHead,
};
const PUNTEN = [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 70 }, { x: 10, y: 70 }];
const MAKEN = {
  draw: () => {
    state.currentPath = [{ x: 10, y: 10 }, { x: 60, y: 40 }, { x: 90, y: 20 }];
    return createAnnotationFromTool('draw', 10, 10, 90, 20, null);
  },
  highlight: () => createAnnotationFromTool('highlight', 10, 10, 160, 40, null),
  measureArea: () => createMeasureAreaAnnotation(PUNTEN),
  measurePerimeter: () => createMeasurePerimeterAnnotation(PUNTEN),
};
for (const tool of ['line', 'arrow', 'box', 'circle', 'ellipse', 'polygon', 'cloud', 'textbox', 'callout']) {
  MAKEN[tool] = () => createAnnotationFromTool(tool, 10, 10, 160, 110, null);
}
// Gereedschappen die hun annotatie in hun eigen module maken: daar moet elke
// voorkeur die de werkbalk schrijft ook gelezen worden.
const BRONNEN = {
  comment: './text-editing.js',
  polyline: './tools/polyline-tool.js',
  filledArea: './tools/filled-area-tool.js',
  measureDistance: './tools/measurement-tool.js',
};

test('elk gereedschap met opmaak is hier gedekt', () => {
  const kandidaten = ['draw', 'highlight', 'line', 'arrow', 'box', 'rect', 'rectangle', 'circle', 'ellipse',
    'polygon', 'cloud', 'textbox', 'callout', 'comment', 'polyline', 'filledArea', 'redaction',
    'measureDistance', 'measureArea', 'measurePerimeter', 'spline', 'splineArrow', 'arc', 'lshape'];
  for (const tool of kandidaten) {
    if (!go.gereedschapOpmaakOpties(tool).length) continue;
    if (tool === 'rect' || tool === 'rectangle') continue; // = box
    assert.ok(MAKEN[tool] || BRONNEN[tool], `${tool} heeft opmaak maar geen test`);
  }
});

for (const [tool, maak] of Object.entries(MAKEN)) {
  test(`${tool}: elke optie van de werkbalk komt op de nieuwe annotatie`, () => {
    openen();
    verseVoorkeuren();
    kies(tool);
    const opties = go.gereedschapOpmaakOpties(tool);
    assert.ok(opties.length > 0);
    const patch = Object.fromEntries(opties.map((k) => [k, WAARDE[k]]));
    assert.equal(go.zetGereedschapOpmaak(state.preferences, tool, patch), true);
    const ann = maak();
    for (const k of opties) {
      assert.ok(KLOPT[k](ann), `${tool}.${k}: ${JSON.stringify({ strokeColor: ann.strokeColor, color: ann.color,
        lineWidth: ann.lineWidth, opacity: ann.opacity, fillOpacity: ann.fillOpacity,
        borderStyle: ann.borderStyle, fillColor: ann.fillColor,
        startHead: ann.startHead, endHead: ann.endHead })}`);
    }
    if (opties.includes('fillColor')) {
      go.zetGereedschapOpmaak(state.preferences, tool, { fillColor: null });
      const zonder = maak();
      assert.ok(zonder.fillColor == null || zonder.fillColor === 'none', `${tool} zonder vulling: ${zonder.fillColor}`);
    }
  });
}

for (const [tool, pad] of Object.entries(BRONNEN)) {
  test(`${tool}: de module van het gereedschap leest elke voorkeur die de werkbalk schrijft`, () => {
    const tekst = bron(pad);
    const m = getStyleMapping(go.stijlTypeVanGereedschap(tool));
    const achtervoegsel = {
      strokeColor: m.stroke || m.color, lineWidth: m.width, opacity: m.opacity, borderStyle: m.borderStyle,
      fillColor: m.fill, fillOpacity: m.fillOpacity, startHead: m.startHead, endHead: m.endHead,
    };
    for (const k of go.gereedschapOpmaakOpties(tool)) {
      const sleutel = m.prefix + achtervoegsel[k];
      const gelezen = tekst.includes(sleutel)
        || (k === 'strokeColor' && tekst.includes(`randkleurenUitVoorkeur(prefs, '${m.prefix}'`));
      assert.ok(gelezen, `${pad} leest ${sleutel} niet`);
    }
  });
}

test('vrije hand: de eigen voorkeur van het gereedschap gaat voor de lintwaarde', () => {
  openen();
  verseVoorkeuren();
  kies('draw');
  lint.setColorPickerValue('#999999');
  lint.setLineWidthValue(9);
  state.preferences.drawStrokeColor = '#0000ff';
  state.preferences.drawLineWidth = 4;
  const ann = MAKEN.draw();
  assert.equal(ann.strokeColor, '#0000ff');
  assert.equal(ann.lineWidth, 4);
  // Het voorbeeld tijdens het slepen volgt dezelfde volgorde.
  assert.match(bron('./tools/draw-tool.js'), /strokeStyle = prefs\.drawStrokeColor \|\| ctx\.getColorPickerValue\(\)/);
});

// ── Het verloop uit het issue ───────────────────────────────────────────────

test('kleur en breedte met een actief gereedschap: het volgende object en het object daarna', async () => {
  const doc = openen();
  verseVoorkeuren();
  kies('line');
  assert.equal(opmaak.opmaakDoel(), 'gereedschap');
  assert.equal(opmaak.opmaakOndersteunt('strokeColor'), true);
  assert.equal(opmaak.opmaakOndersteunt('fillColor'), false);
  const bewaardVoor = globalThis.__stubCalls?.savePreferences || 0;

  // Wat Kleur en Breedte in het lint doen (CommentTab.jsx).
  opmaak.zetOpmaak({ strokeColor: '#00aa00' }, () => assert.fail('geen selectie'));
  opmaak.zetOpmaak({ lineWidth: 6 }, () => assert.fail('geen selectie'));
  assert.equal(state.preferences.lineStrokeColor, '#00aa00');
  assert.equal(state.preferences.lineLineWidth, 6);
  // De werkbalk en het lint tonen de opmaak voor het volgende object.
  assert.equal(opmaak.strokeColor(), '#00aa00');
  assert.equal(opmaak.fmtLineWidth(), 6);

  const eerste = createAnnotationFromTool('line', 10, 10, 200, 10, null);
  const tweede = createAnnotationFromTool('line', 10, 50, 200, 50, null);
  for (const a of [eerste, tweede]) {
    assert.equal(a.strokeColor, '#00aa00');
    assert.equal(a.color, '#00aa00');
    assert.equal(a.lineWidth, 6);
  }
  doc.annotations.push(eerste, tweede);

  // Een ander gereedschap houdt zijn eigen opmaak; terug bij de lijn is de
  // gekozen opmaak er nog.
  kies('arrow');
  assert.equal(opmaak.strokeColor(), STANDAARD.arrowStrokeColor);
  assert.equal(createAnnotationFromTool('arrow', 0, 0, 50, 50, null).strokeColor, STANDAARD.arrowStrokeColor);
  kies('line');
  assert.equal(opmaak.strokeColor(), '#00aa00');

  // Met een selectie wijzigt dezelfde invoer die annotatie, niet de standaard.
  doc.selectedAnnotations = [eerste];
  doc.selectedAnnotation = eerste;
  assert.equal(opmaak.opmaakDoel(), 'selectie');
  opmaak.zetOpmaak({ strokeColor: '#0000ff' }, (ann) => { ann.strokeColor = '#0000ff'; ann.color = '#0000ff'; });
  assert.equal(eerste.strokeColor, '#0000ff');
  assert.equal(tweede.strokeColor, '#00aa00');
  assert.equal(state.preferences.lineStrokeColor, '#00aa00');

  // De voorkeuren worden bewaard, één keer voor de hele reeks wijzigingen.
  const bewaard = () => (globalThis.__stubCalls?.savePreferences || 0) - bewaardVoor;
  for (let i = 0; i < 100 && bewaard() === 0; i++) await wacht(50);
  await wacht(400);
  assert.equal(bewaard(), 1);
});

test('de werkbalk volgt een wijziging van de voorkeur buiten de werkbalk om', async () => {
  openen();
  verseVoorkeuren();
  kies('box');
  await wacht(0);
  state.preferences.rectStrokeColor = '#123456'; // bv. via het eigenschappenpaneel
  await wacht(0);
  assert.equal(opmaak.strokeColor(), '#123456');
});

test('zonder doel (selecteren, geen selectie) staan kleur en breedte uit', () => {
  openen();
  kies('select');
  assert.equal(opmaak.opmaakDoel(), null);
  assert.equal(opmaak.opmaakOndersteunt('strokeColor'), false);
  assert.equal(opmaak.opmaakOndersteunt('lineWidth'), false);
  kies('highlight');
  assert.equal(opmaak.opmaakOndersteunt('strokeColor'), true);
  assert.equal(opmaak.opmaakOndersteunt('lineWidth'), false);
});

// ── Het Opmaak-tabblad tijdens het tekenen ──────────────────────────────────

test('het Opmaak-tabblad verschijnt tijdens het tekenen zonder het lint te verspringen', () => {
  const doc = openen();
  kies('select');
  updateContextualTabs();
  lint.setActiveTab('drawing');
  updateContextualTabs();
  assert.equal(lint.contextualTabsVisible(), false);

  kies('line');
  updateContextualTabs();
  assert.equal(lint.contextualTabsVisible(), true);
  assert.equal(lint.activeTab(), 'drawing', 'het lint blijft op het tabblad met de gereedschappen');
  assert.equal(opmaak.opmaakVoorNieuw(), true, 'Schikken blijft verborgen');

  // Een gereedschap zonder stijl: geen Opmaak-tabblad.
  kies('redaction');
  updateContextualTabs();
  assert.equal(lint.contextualTabsVisible(), false);

  // Een selectie opent het Opmaak-tabblad zoals altijd.
  kies('select');
  const ann = { id: 'a1', type: 'box', page: 1, x: 0, y: 0, width: 10, height: 10, strokeColor: '#ff0000' };
  doc.annotations = [ann];
  doc.selectedAnnotations = [ann];
  updateContextualTabs();
  assert.equal(lint.contextualTabsVisible(), true);
  assert.equal(lint.activeTab(), 'format');
  assert.equal(opmaak.opmaakVoorNieuw(), false);
  doc.selectedAnnotations = [];
  updateContextualTabs();
  assert.equal(lint.contextualTabsVisible(), false);
});

test('setTool laat het lint de opmaak van het nieuwe gereedschap tonen', () => {
  const tekst = bron('./manager.js');
  const sync = tekst.indexOf('syncSymbolInsertSession(tool, state.toolOverrides);');
  const lintSync = tekst.indexOf("import('../annotations/rendering/ui-state.js')", sync);
  assert.ok(sync > 0 && lintSync > sync && lintSync - sync < 400);
});

// ── Bedrading in het lint ───────────────────────────────────────────────────

test('Kleur en Breedte in het lint gaan via zetOpmaak, niet meer via de losse lintsignalen', () => {
  const tekst = bron('../solid/components/ribbon/CommentTab.jsx');
  assert.match(tekst, /zetOpmaak\(\{ strokeColor: kleur \}/);
  assert.match(tekst, /zetOpmaak\(\{ lineWidth: dikte \}/);
  assert.doesNotMatch(tekst, /setColorPickerValue|setLineWidthValue/);
  assert.match(tekst, /disabled=\{!kan\('strokeColor'\)\}/);
  assert.match(tekst, /disabled=\{!kan\('lineWidth'\)\}/);
  // De werkbalk gebruikt dezelfde doelkeuze.
  const werkbalk = bron('../solid/components/ribbon/FormatTab.jsx');
  assert.match(werkbalk, /const invoegen = \(\) => opmaakVoorNieuw\(\);/);
  assert.doesNotMatch(werkbalk, /function zetOpmaak/);
});

test('de uitleg bij Kleur en Breedte staat in alle 40 talen', () => {
  const map = new URL('../i18n/locales/', import.meta.url);
  const talen = readdirSync(map);
  assert.equal(talen.length, 40);
  const en = JSON.parse(readFileSync(new URL('en/ribbon.json', map), 'utf8')).comment.propertiesHint;
  assert.ok(en && en.length > 20);
  for (const taal of talen) {
    const tekst = JSON.parse(readFileSync(new URL(`${taal}/ribbon.json`, map), 'utf8')).comment?.propertiesHint;
    assert.ok(typeof tekst === 'string' && tekst.trim().length > 0, taal);
    if (taal !== 'en') assert.notEqual(tekst, en, `${taal} kopieert het Engels`);
  }
});

for (const type of ['textbox', 'callout']) {
  test(`${type}: linttekstkleur wijzigt selectie en toekomstige stijl zonder selectie`, async () => {
    const doc = openen(); verseVoorkeuren(); kies('select');
    doc.annotations = [{ id: 'text-color', type, page: 1, x: 10, y: 10, width: 100, height: 40,
      text: 'kleur', textColor: '#000000', strokeColor: '#ff0000', color: '#ff0000' }];
    doc.selectedAnnotations = [doc.annotations[0]];
    opmaak.syncFormatStore(doc.selectedAnnotations);
    assert.equal(opmaak.hasTextColor(), true);
    opmaak.setFormatTextColor('#008000');
    assert.equal(doc.annotations[0].textColor, '#008000');
    assert.equal(doc.annotations[0].strokeColor, '#ff0000');
    assert.equal(doc.annotations[0].color, '#ff0000');
    assert.equal(opmaak.textColor(), '#008000');
    doc.annotations[0].locked = true;
    opmaak.setFormatTextColor('#0000ff');
    assert.equal(doc.annotations[0].textColor, '#008000');
    doc.selectedAnnotations = []; kies(type); opmaak.syncFormatStore([]);
    opmaak.setFormatTextColor('#0000ff');
    assert.equal(state.preferences[type + 'TextColor'], '#0000ff');
    assert.equal(createAnnotationFromTool(type, 10, 10, 160, 110, null).textColor, '#0000ff');
    kies('select'); opmaak.syncFormatStore([]);
    assert.equal(opmaak.hasTextColor(), false);
  });
}
