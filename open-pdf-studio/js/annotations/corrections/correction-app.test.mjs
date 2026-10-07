// Proefleescorrecties (#508) in de echte app-modules: de state-store, de
// undo-manager, het eigenschappenpaneel, de selectie-tekening en het
// ontbinden van verzamelingen. Een vervanging (invoegteken plus doorhaling)
// gedraagt zich als één geheel; andere soorten blijven zoals ze waren.
//
// De modules draaien onder node met de laadhaken van de app (zie
// core/app-test-hooks.mjs); rendering.js en de i18n-opzet zijn daar stubs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const { explodeCollection } = await import('../segment-ops.js');
const { storeShowProperties, sectionVis, annotProps, updateAnnotProp } = await import('../../solid/stores/propertiesStore.js');
const { getAnnotationDisplayName } = await import('../../utils/helpers.js');
const { getAnnotationHandles } = await import('../handles.js');
const { drawSelectionHandles } = await import('../rendering/selection.js');
const { getAnnotationHoverCursor } = await import('../../ui/cursors/annotation-cursors.js');
const { expandCorrectionGroups } = await import('./model.js');
const { deleteAnnotationsWithUndo } = await import('../mutations.js');

const karet = (extra = {}) => ({
  id: 'k', type: 'caret', page: 1, x: 87, y: 94.8, width: 6, height: 6, textDir: 0,
  intent: 'Replace', groupId: 'k', text: 'the', color: '#9900CC', opacity: 1,
  author: 'A', createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z', ...extra,
});
const doorhaling = (extra = {}) => ({
  id: 's', type: 'textStrikethrough', page: 1, x: 72, y: 90.4, width: 18, height: 12,
  rects: [{ x: 72, y: 90.4, width: 18, height: 12 }], intent: 'StrikeOutTextEdit',
  inReplyTo: 'k', replyType: 'group', groupId: 'k', markedText: 'teh', color: '#9900CC', opacity: 1,
  author: 'A', createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z', ...extra,
});
const vak = (id, extra = {}) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5, ...extra });

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const ids = (lijst) => lijst.map((a) => a.id);

test('het invoegteken verwijderen neemt zijn doorhaling mee, en één keer ongedaan maken zet beide terug', async () => {
  const doc = openen([vak('b1'), karet(), doorhaling(), vak('b2')]);
  const weg = expandCorrectionGroups(doc.annotations, [doc.annotations[1]]);
  assert.deepEqual(ids(weg), ['k', 's']);
  undo.recordBulkDelete(weg);
  const set = new Set(weg);
  doc.annotations = doc.annotations.filter((a) => !set.has(a));
  assert.deepEqual(ids(state.documents[0].annotations), ['b1', 'b2'], 'geen losse doorhaling achtergebleven');
  await undo.undo();
  assert.deepEqual(ids(state.documents[0].annotations), ['b1', 'k', 's', 'b2'], 'beide terug op hun plek');
});

test('deleteAnnotationsWithUndo: de doorhaling verwijderen neemt het invoegteken mee, in één stap', async () => {
  const doc = openen([vak('b1'), karet(), doorhaling()]);
  const weg = deleteAnnotationsWithUndo(doc, [doc.annotations[2]]);
  assert.deepEqual(ids(weg), ['s', 'k']);
  assert.deepEqual(ids(state.documents[0].annotations), ['b1']);
  assert.equal(state.documents[0].undoStack.length, 1, 'één ongedaan-stap');
  assert.equal(state.documents[0].undoStack[0].type, 'bulkDelete');
  await undo.undo();
  assert.deepEqual(ids(state.documents[0].annotations), ['b1', 'k', 's']);
});

test('deleteAnnotationsWithUndo: één gewone annotatie blijft een gewone verwijderstap', async () => {
  const doc = openen([vak('b1'), vak('b2'), karet()]);
  const weg = deleteAnnotationsWithUndo(doc, [doc.annotations[1]]);
  assert.deepEqual(ids(weg), ['b2']);
  assert.deepEqual(ids(state.documents[0].annotations), ['b1', 'k']);
  assert.equal(state.documents[0].undoStack[0].type, 'deleteAnnotation');
  assert.equal(state.documents[0].undoStack[0].index, 1);
  await undo.undo();
  assert.deepEqual(ids(state.documents[0].annotations), ['b1', 'b2', 'k']);
  assert.deepEqual(deleteAnnotationsWithUndo(state.documents[0], []), []);
  assert.deepEqual(deleteAnnotationsWithUndo(null, [vak('x')]), []);
});

test('deleteAnnotationsWithUndo: een vergrendelde helft wordt niet ongevraagd meegenomen', () => {
  const doc = openen([vak('b1'), karet({ locked: true }), doorhaling()]);
  const weg = deleteAnnotationsWithUndo(doc, [doc.annotations[2]]);
  assert.deepEqual(weg, []);
  assert.deepEqual(ids(state.documents[0].annotations), ['b1', 'k', 's'], 'beide helften blijven');
  assert.equal(state.documents[0].undoStack.length, 0, 'geen ongedaan-stap');
  // Ook andersom: de doorhaling vergrendeld, het invoegteken gekozen.
  const doc2 = openen([karet(), doorhaling({ locked: true })]);
  assert.deepEqual(deleteAnnotationsWithUndo(doc2, [doc2.annotations[0]]), []);
  assert.deepEqual(ids(state.documents[0].annotations), ['k', 's']);
  // Wie beide helften zelf kiest (meervoudige selectie), beslist zelf.
  const doc3 = openen([karet({ locked: true }), doorhaling()]);
  assert.deepEqual(ids(deleteAnnotationsWithUndo(doc3, [...doc3.annotations])), ['k', 's']);
});

test('ontbinden laat een vervanging heel; een gewone verzameling wordt nog steeds ontbonden', () => {
  const doc = openen([karet(), doorhaling(), vak('b1', { groupId: 'grp_1' }), vak('b2', { groupId: 'grp_1' })]);
  doc.selectedAnnotations = [doc.annotations[0]];
  assert.equal(explodeCollection(), 0);
  assert.deepEqual(state.documents[0].annotations.map((a) => a.groupId), ['k', 'k', 'grp_1', 'grp_1']);

  doc.selectedAnnotations = [state.documents[0].annotations[2]];
  assert.equal(explodeCollection(), 2);
  assert.deepEqual(state.documents[0].annotations.map((a) => a.groupId), ['k', 'k', null, null]);
});

test('ontbinden van een verzameling van vervangingen geeft elk paar zijn eigen groep terug', async () => {
  const { createCollection } = await import('../segment-ops.js');
  const { groupMembers } = await import('./model.js');
  const doc = openen([
    karet({ id: 'k1', groupId: 'k1' }), doorhaling({ id: 's1', inReplyTo: 'k1', groupId: 'k1' }),
    karet({ id: 'k2', groupId: 'k2' }), doorhaling({ id: 's2', inReplyTo: 'k2', groupId: 'k2' }),
    vak('b1'),
  ]);
  doc.selectedAnnotations = [...state.documents[0].annotations];
  assert.equal(createCollection(), 5);
  const gid = state.documents[0].annotations[0].groupId;
  assert.match(gid, /^grp_/);
  state.documents[0].selectedAnnotations = [state.documents[0].annotations[0]];
  assert.equal(explodeCollection(), 5);
  const alle = state.documents[0].annotations;
  assert.deepEqual(alle.map((a) => a.groupId), ['k1', 'k1', 'k2', 'k2', null]);
  // Een klik op het eerste invoegteken selecteert alleen zijn eigen paar.
  assert.deepEqual(ids(expandCorrectionGroups(alle, groupMembers(alle, alle[0]))), ['k1', 's1']);
  // Eén keer ongedaan maken zet de verzameling terug.
  await undo.undo();
  assert.deepEqual(state.documents[0].annotations.map((a) => a.groupId), [gid, gid, gid, gid, gid]);
});

test('het paneel toont bij een invoegteken de inhoud zonder lijndikte, en noemt de vervanging bij naam', () => {
  const doc = openen([karet(), doorhaling()]);
  storeShowProperties(doc.annotations[0]);
  assert.equal(sectionVis.content, true, 'inhoud zichtbaar');
  assert.equal(sectionVis.textGroup, true, 'tekstveld zichtbaar');
  assert.equal(sectionVis.fontSizeGroup, false);
  assert.equal(sectionVis.lineWidthGroup, false, 'een invoegteken heeft geen lijndikte');
  assert.equal(annotProps.text, 'the');
  assert.equal(annotProps.typeDisplay, 'Replace Text');

  storeShowProperties(vak('b'));
  assert.equal(sectionVis.content, false, 'een rechthoek blijft zonder inhoud');
  assert.equal(sectionVis.lineWidthGroup, true);
});

test('na ongedaan maken en opnieuw toont het paneel weer het invoegteken, geen meervoudige selectie', async () => {
  const { commitAnnotationMutation } = await import('../mutations.js');
  const { showMultiSelectionProperties } = await import('../../ui/panels/properties-panel.js');
  openen([karet(), doorhaling(), vak('b1')]);
  const [k, s] = state.documents[0].annotations;
  state.documents[0].selectedAnnotations = [k, s];
  state.documents[0].selectedAnnotation = k;
  commitAnnotationMutation(k, (a) => { a.text = 'thee'; });

  globalThis.__stubCalls = {};
  await undo.undo();
  assert.equal(state.documents[0].annotations[0].text, 'the');
  assert.equal(globalThis.__stubCalls.storeShowProperties, 1, 'het paneel van het invoegteken');
  assert.equal(globalThis.__stubCalls.storeShowMultiSelection, undefined);
  assert.deepEqual(ids(state.documents[0].selectedAnnotations), ['k', 's'], 'het paar blijft geselecteerd');
  assert.equal(state.documents[0].selectedAnnotation.id, 'k');

  globalThis.__stubCalls = {};
  await undo.redo();
  assert.equal(state.documents[0].annotations[0].text, 'thee');
  assert.equal(globalThis.__stubCalls.storeShowProperties, 1);
  assert.equal(globalThis.__stubCalls.storeShowMultiSelection, undefined);

  // Een echte meervoudige selectie blijft meervoudig.
  globalThis.__stubCalls = {};
  state.documents[0].selectedAnnotations = [...state.documents[0].annotations];
  showMultiSelectionProperties();
  assert.equal(globalThis.__stubCalls.storeShowMultiSelection, 1);
  assert.equal(globalThis.__stubCalls.storeShowProperties, undefined);
});

test('alleen de doorhaling van een vervanging geselecteerd: het paneel bewerkt het invoegteken', () => {
  openen([karet(), doorhaling()]);
  const [k, s] = state.documents[0].annotations;
  storeShowProperties(s);
  assert.equal(annotProps.id, 'k', 'het paneel toont het invoegteken');
  updateAnnotProp('color', '#00AA00');
  assert.equal(state.documents[0].annotations[0].color, '#00AA00', 'de kleur waarmee de doorhaling getekend en opgeslagen wordt');
  assert.equal(k.id, 'k');
  // Een losse schrapping toont zichzelf.
  const los = doorhaling({ id: 'x', inReplyTo: undefined, replyType: undefined, groupId: undefined });
  openen([los]);
  storeShowProperties(state.documents[0].annotations[0]);
  assert.equal(annotProps.id, 'x');
});

test('de weergavenaam volgt de soort correctie, andere annotaties houden hun typenaam', () => {
  const alle = [karet(), doorhaling()];
  assert.equal(getAnnotationDisplayName(alle[0], alle), 'Replace Text');
  assert.equal(getAnnotationDisplayName(alle[1], alle), 'Replace Text');
  assert.equal(getAnnotationDisplayName(karet({ intent: undefined, groupId: undefined }), []), 'Inserted Text');
  assert.equal(getAnnotationDisplayName(doorhaling({ inReplyTo: undefined, replyType: undefined }), []), 'Cross-Out');
  // Geen correctie: de bestaande typenaam (hier zonder vertaling de terugval).
  const gewoon = { id: 'x', type: 'textStrikethrough' };
  assert.equal(getAnnotationDisplayName(gewoon, [gewoon]), 'TextStrikethrough');
});

/** Canvas-stub die elke aanroep vastlegt. */
function opnameCtx() {
  const ops = [];
  const ctx = new Proxy({}, {
    get(doel, naam) {
      if (naam === 'ops') return ops;
      if (naam in doel) return doel[naam];
      return (...args) => { ops.push([String(naam), ...args]); };
    },
    set(doel, naam, waarde) { doel[naam] = waarde; return true; },
  });
  return ctx;
}

test('een geselecteerd invoegteken krijgt een gestippelde omtrek en geen grepen', () => {
  openen([karet()]);
  const k = karet();
  assert.deepEqual(getAnnotationHandles(k, 1), []);
  const ctx = opnameCtx();
  drawSelectionHandles(ctx, k);
  const getekend = ctx.ops.filter(([naam]) => naam !== 'setLineDash');
  assert.deepEqual(getekend, [['strokeRect', 87, 94.8, 6, 6]]);
  assert.ok(ctx.ops.some(([naam, dash]) => naam === 'setLineDash' && dash.length === 2), 'gestippeld');
});

test('boven een invoegteken krijgt de cursor een eigen kenteken', () => {
  assert.notEqual(getAnnotationHoverCursor('caret'), getAnnotationHoverCursor('onbekendeSoort'));
  assert.notEqual(getAnnotationHoverCursor('caret'), getAnnotationHoverCursor('textStrikethrough'));
});

test('uitlijnen verschuift geen correcties, wel de andere annotaties', async () => {
  const { alignLeft } = await import('../alignment.js');
  const doc = openen([vak('b1', { x: 10 }), vak('b2', { x: 40 }), karet(), doorhaling()]);
  doc.selectedAnnotations = [...doc.annotations];
  alignLeft();
  const [b1, b2, k, s] = state.documents[0].annotations;
  assert.equal(b1.x, 10);
  assert.equal(b2.x, 10, 'de rechthoeken lijnen uit');
  assert.equal(k.x, 87, 'het invoegteken blijft bij zijn tekst');
  assert.equal(s.x, 72, 'de doorhaling blijft bij haar tekst');
  assert.deepEqual(JSON.parse(JSON.stringify(s.rects)), [{ x: 72, y: 90.4, width: 18, height: 12 }]);
});

test('kopiëren en plakken van een vervanging geeft een eigen paar, los van het origineel', async () => {
  const clip = await import('../clipboard.js');
  const { linkPlanForSave, withoutFoldedChildren } = await import('./model.js');
  openen([karet({ nm: 'nm-k' }), doorhaling({ nm: 'nm-s' })]);
  const origineel = () => state.documents[0].annotations.slice(0, 2);

  // Ctrl+C, Ctrl+V op dezelfde pagina.
  clip.copyAnnotations(origineel());
  clip.pasteAnnotations();
  let alle = state.documents[0].annotations;
  assert.equal(alle.length, 4);
  const [k2, s2] = alle.slice(2);
  assert.notEqual(k2.id, 'k');
  assert.equal(s2.inReplyTo, k2.id, 'de geplakte doorhaling hoort bij het geplakte invoegteken');
  assert.equal(s2.groupId, k2.id);
  assert.equal(k2.groupId, k2.id);
  assert.equal(k2.intent, 'Replace');
  assert.equal(k2.nm, undefined);
  assert.equal(s2.nm, undefined);
  let plan = linkPlanForSave(alle);
  assert.deepEqual(plan.links, [{ childId: 's', parentId: 'k' }, { childId: s2.id, parentId: k2.id }]);
  assert.equal(plan.stripReplaceIntent.size, 0);
  assert.deepEqual(ids(expandCorrectionGroups(alle, [alle[0]])), ['k', 's']);
  assert.deepEqual(ids(withoutFoldedChildren(alle, alle)), ['k', k2.id]);

  // Plakken op plaats.
  clip.pasteAnnotationsInPlace();
  alle = state.documents[0].annotations;
  const [k3, s3] = alle.slice(4);
  assert.equal(s3.inReplyTo, k3.id);
  assert.equal(s3.groupId, k3.id);
  assert.equal(k3.nm, undefined);
  plan = linkPlanForSave(alle);
  assert.equal(plan.links.length, 3, 'één kind per invoegteken');
  assert.deepEqual(new Set(plan.links.map((l) => l.parentId)).size, 3);

  // Eén helft kopiëren (contextmenu, lijst) of dupliceren.
  state.documents[0].selectedAnnotation = state.documents[0].annotations[0];
  clip.duplicateAnnotation();
  const losKaret = state.documents[0].annotations.at(-1);
  assert.equal(losKaret.type, 'caret');
  assert.equal(losKaret.intent, undefined, 'een losse kopie is een gewone invoeging');
  assert.equal(losKaret.groupId, undefined);
  clip.copyAnnotation(state.documents[0].annotations[1]);
  clip.pasteAnnotation();
  const losDoor = state.documents[0].annotations.at(-1);
  assert.equal(losDoor.inReplyTo, undefined, 'een losse kopie is een gewone schrapping');
  assert.equal(losDoor.groupId, undefined);
  assert.deepEqual(ids(expandCorrectionGroups(state.documents[0].annotations, [state.documents[0].annotations[0]])), ['k', 's']);
  assert.equal(state.documents[0].annotations[0].nm, 'nm-k', 'het origineel houdt zijn /NM');
});
