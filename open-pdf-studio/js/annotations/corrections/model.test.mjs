// Model van proefleescorrecties (#508): welke soort correctie een annotatie
// is, welke annotaties samen één vervanging vormen en hoe ze in de lijst staan.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORRECTION_COLORS, isTextAnchored, isTextEditStrike, correctionKind, groupMembers,
  linkPlanForSave, saveColor, displayKey, listPreview, isFoldedChild,
  expandCorrectionGroups, withoutFoldedChildren, relinkPastedCorrections,
} from './model.js';

const invoeg = { id: 'c1', type: 'caret', page: 1, text: 'the' };
const vervangKaret = { id: 'c2', type: 'caret', page: 1, text: 'the', intent: 'Replace', groupId: 'c2' };
const vervangDoorhaal = {
  id: 's2', type: 'textStrikethrough', page: 1, intent: 'StrikeOutTextEdit',
  inReplyTo: 'c2', replyType: 'group', groupId: 'c2', markedText: 'teh',
};
const schrap = { id: 's1', type: 'textStrikethrough', page: 1, intent: 'StrikeOutTextEdit', markedText: 'teh' };
const gewoneDoorhaal = { id: 's3', type: 'textStrikethrough', page: 1 };
const markering = { id: 'h1', type: 'textHighlight', page: 1 };
const alle = [invoeg, vervangDoorhaal, vervangKaret, schrap, gewoneDoorhaal, markering];
const perId = new Map(alle.map((a) => [a.id, a]));

test('kleuren per soort: invoegen blauw, schrappen rood, vervangen paars', () => {
  assert.deepEqual(CORRECTION_COLORS, { insert: '#0066FF', delete: '#FF0000', replace: '#9900CC' });
});

test('isTextAnchored: tekstmarkeringen en het invoegteken', () => {
  for (const type of ['textHighlight', 'textStrikethrough', 'textUnderline', 'textSquiggly', 'caret']) {
    assert.equal(isTextAnchored({ type }), true, type);
  }
  for (const type of ['highlight', 'box', 'comment', 'textbox']) {
    assert.equal(isTextAnchored({ type }), false, type);
  }
  assert.equal(isTextAnchored(null), false);
});

test('isTextEditStrike: alleen een doorhaling met /IT StrikeOutTextEdit', () => {
  assert.equal(isTextEditStrike(schrap), true);
  assert.equal(isTextEditStrike(vervangDoorhaal), true);
  assert.equal(isTextEditStrike(gewoneDoorhaal), false);
  assert.equal(isTextEditStrike({ type: 'textHighlight', intent: 'StrikeOutTextEdit' }), false);
});

test('correctionKind: invoegen, vervangen, deel van een vervanging, schrappen en gewone markeringen', () => {
  assert.equal(correctionKind(invoeg, perId), 'insert');
  assert.equal(correctionKind(vervangKaret, perId), 'replace');
  assert.equal(correctionKind(vervangDoorhaal, perId), 'replaceChild');
  assert.equal(correctionKind(schrap, perId), 'delete');
  assert.equal(correctionKind(gewoneDoorhaal, perId), null);
  assert.equal(correctionKind(markering, perId), null);
  assert.equal(correctionKind(null, perId), null);
});

test('correctionKind kijkt nooit naar /Subj', () => {
  assert.equal(correctionKind({ ...gewoneDoorhaal, pdfSubject: 'Cross-Out' }, perId), null);
  assert.equal(correctionKind({ ...markering, pdfSubject: 'Inserted Text' }, perId), null);
  assert.equal(correctionKind({ ...invoeg, pdfSubject: 'Replace Text' }, perId), 'insert');
  assert.equal(correctionKind({ ...schrap, pdfSubject: 'Highlight' }, perId), 'delete');
});

test('een doorhaling waarvan het invoegteken ontbreekt telt als haar eigen soort', () => {
  const zonderOuder = new Map([[vervangDoorhaal.id, vervangDoorhaal]]);
  assert.equal(correctionKind(vervangDoorhaal, zonderOuder), 'delete');
  const ouderGeenKaret = new Map([...perId, ['c2', { id: 'c2', type: 'box' }]]);
  assert.equal(correctionKind(vervangDoorhaal, ouderGeenKaret), 'delete');
});

test('groupMembers: op groupId, anders op het /IRT-paar', () => {
  assert.deepEqual(groupMembers(alle, vervangKaret).map((a) => a.id).sort(), ['c2', 's2']);
  assert.deepEqual(groupMembers(alle, vervangDoorhaal).map((a) => a.id).sort(), ['c2', 's2']);
  const losKaret = { ...vervangKaret, groupId: undefined };
  const losKind = { ...vervangDoorhaal, groupId: undefined };
  const zonderGroep = [losKaret, losKind, schrap];
  assert.deepEqual(groupMembers(zonderGroep, losKaret).map((a) => a.id), ['c2', 's2']);
  assert.deepEqual(groupMembers(zonderGroep, losKind).map((a) => a.id), ['c2', 's2']);
  assert.deepEqual(groupMembers(zonderGroep, schrap).map((a) => a.id), ['s1']);
});

test('linkPlanForSave koppelt een kind alleen aan een invoegteken op dezelfde pagina', () => {
  const plan = linkPlanForSave([vervangDoorhaal, vervangKaret, schrap, invoeg]);
  assert.deepEqual(plan.links, [{ childId: 's2', parentId: 'c2' }]);
  assert.equal(plan.stripReplaceIntent.size, 0);

  // Het invoegteken staat op een andere pagina: niet in deze lijst.
  const zonderOuder = linkPlanForSave([vervangDoorhaal, schrap]);
  assert.deepEqual(zonderOuder.links, []);
});

test('linkPlanForSave haalt /IT Replace weg bij een invoegteken zonder kind', () => {
  const plan = linkPlanForSave([vervangKaret, invoeg]);
  assert.deepEqual(plan.links, []);
  assert.deepEqual([...plan.stripReplaceIntent], ['c2']);
});

test('linkPlanForSave negeert groepen die geen vervanging zijn', () => {
  const vierkant = { id: 'b1', type: 'box', page: 1 };
  const notitie = { id: 't1', type: 'comment', page: 1, inReplyTo: 'b1', replyType: 'group' };
  const naarMarkering = { id: 's9', type: 'textStrikethrough', inReplyTo: 'h1', replyType: 'group' };
  const plan = linkPlanForSave([vierkant, notitie, markering, naarMarkering]);
  assert.deepEqual(plan.links, []);
  assert.equal(plan.stripReplaceIntent.size, 0);
});

test('displayKey en listPreview geven de samengevouwen labels', () => {
  assert.equal(displayKey(vervangKaret, perId), 'replaceText');
  assert.equal(displayKey(vervangDoorhaal, perId), 'replaceText');
  assert.equal(displayKey(invoeg, perId), 'caret');
  assert.equal(displayKey(schrap, perId), 'crossOut');
  assert.equal(displayKey(gewoneDoorhaal, perId), null);
  assert.equal(listPreview(vervangKaret, perId), 'teh -> the');
  assert.equal(listPreview(vervangDoorhaal, perId), 'teh -> the');
  assert.equal(listPreview(invoeg, perId), '+ the');
  assert.equal(listPreview(schrap, perId), '- teh');
  assert.equal(listPreview(markering, perId), '');
});

test('isFoldedChild: alleen de doorhaling die bij een vervanging hoort', () => {
  assert.equal(isFoldedChild(vervangDoorhaal, perId), true);
  assert.equal(isFoldedChild(vervangKaret, perId), false);
  assert.equal(isFoldedChild(schrap, perId), false);
  assert.equal(isFoldedChild(gewoneDoorhaal, perId), false);
});

test('saveColor: een kind krijgt de kleur van zijn invoegteken, anders de eigen of de standaardkleur', () => {
  const ouder = { ...vervangKaret, color: '#123456' };
  const kind = { ...vervangDoorhaal, color: '#FF0000' };
  const pagina = [kind, ouder, schrap, invoeg];
  const plan = linkPlanForSave(pagina);
  assert.equal(saveColor(kind, pagina, plan), '#123456');
  assert.equal(saveColor(ouder, pagina, plan), '#123456');
  assert.equal(saveColor(schrap, pagina, plan), CORRECTION_COLORS.delete, 'zonder kleur de standaardkleur');
  assert.equal(saveColor(invoeg, pagina, plan), CORRECTION_COLORS.insert);
  assert.equal(saveColor({ ...vervangKaret, color: undefined }, pagina, plan), CORRECTION_COLORS.replace);
  // Zonder ouder op de pagina telt de eigen kleur.
  assert.equal(saveColor(kind, [kind], linkPlanForSave([kind])), '#FF0000');
});

// Plakken en dupliceren: de klonen hebben al een nieuw id (zoals clipboard.js
// en paste-in-place.js doen), de rest is een diepe kopie.
const kopie = (a, id) => ({ ...JSON.parse(JSON.stringify(a)), id });
const plakKaret = () => ({ id: 'k', type: 'caret', page: 1, intent: 'Replace', groupId: 'k', nm: 'nm-k', text: 'the' });
const plakDoorhaal = () => ({
  id: 's', type: 'textStrikethrough', page: 1, intent: 'StrikeOutTextEdit',
  inReplyTo: 'k', replyType: 'group', groupId: 'k', nm: 'nm-s', markedText: 'teh',
});
const idsVan = (lijst) => lijst.map((a) => a.id);

test('relinkPastedCorrections: een geplakte vervanging koppelt alleen aan haar eigen kopie', () => {
  const k = plakKaret();
  const s = plakDoorhaal();
  const klonen = [kopie(k, 'k2'), kopie(s, 's2')];
  assert.equal(relinkPastedCorrections([k, s], klonen), klonen);
  const [k2, s2] = klonen;
  assert.equal(s2.inReplyTo, 'k2');
  assert.equal(s2.replyType, 'group');
  assert.equal(s2.groupId, 'k2');
  assert.equal(k2.groupId, 'k2');
  assert.equal(k2.intent, 'Replace');
  assert.equal(k2.nm, undefined, 'een kopie krijgt bij opslaan een eigen /NM');
  assert.equal(s2.nm, undefined);
  assert.equal(k.nm, 'nm-k', 'het origineel blijft ongemoeid');
  assert.equal(s.inReplyTo, 'k');

  // Op dezelfde pagina: elk invoegteken precies één kind, niets gestript.
  const alle4 = [k, s, k2, s2];
  const plan = linkPlanForSave(alle4);
  assert.deepEqual(plan.links, [{ childId: 's', parentId: 'k' }, { childId: 's2', parentId: 'k2' }]);
  assert.equal(plan.stripReplaceIntent.size, 0);
  assert.deepEqual(idsVan(expandCorrectionGroups(alle4, [k])), ['k', 's'], 'verwijderen raakt de kopie niet');
  assert.deepEqual(idsVan(expandCorrectionGroups(alle4, [k2])), ['k2', 's2']);
  assert.deepEqual(idsVan(groupMembers(alle4, k)), ['k', 's'], 'groepsklik op het origineel');
  assert.deepEqual(idsVan(withoutFoldedChildren(alle4, alle4)), ['k', 'k2'], 'beide paren in de lijst');
});

test('relinkPastedCorrections: een losse kopie van een helft hoort niet bij het origineel', () => {
  const k = plakKaret();
  const s = plakDoorhaal();
  // Alleen het invoegteken (kopiëren of dupliceren van één annotatie): een gewone invoeging.
  const [k2] = relinkPastedCorrections([k], [kopie(k, 'k2')]);
  assert.equal(k2.intent, undefined);
  assert.equal(k2.groupId, undefined);
  assert.equal(correctionKind(k2), 'insert');
  // Alleen de doorhaling: een gewone schrapping.
  const [s2] = relinkPastedCorrections([s], [kopie(s, 's2')]);
  assert.equal(s2.inReplyTo, undefined);
  assert.equal(s2.replyType, undefined);
  assert.equal(s2.groupId, undefined);
  assert.equal(s2.intent, 'StrikeOutTextEdit');
  const alle = [k, s, k2, s2];
  assert.equal(correctionKind(s2, alle), 'delete');
  const plan = linkPlanForSave(alle);
  assert.deepEqual(plan.links, [{ childId: 's', parentId: 'k' }]);
  assert.equal(plan.stripReplaceIntent.size, 0);
  assert.deepEqual(idsVan(expandCorrectionGroups(alle, [k])), ['k', 's']);
});

test('relinkPastedCorrections: een verzameling houdt haar groupId, andere annotaties alleen geen /NM', () => {
  const k = { ...plakKaret(), groupId: 'grp_1' };
  const s = { ...plakDoorhaal(), groupId: 'grp_1' };
  const b = { id: 'b', type: 'box', page: 1, groupId: 'grp_1', nm: 'vreemd' };
  const [k2, s2, b2] = relinkPastedCorrections([k, s, b], [kopie(k, 'k2'), kopie(s, 's2'), kopie(b, 'b2')]);
  assert.deepEqual([k2.groupId, s2.groupId, b2.groupId], ['grp_1', 'grp_1', 'grp_1']);
  assert.equal(s2.inReplyTo, 'k2');
  assert.equal(k2.intent, 'Replace');
  assert.equal(b2.nm, undefined);
  assert.deepEqual(relinkPastedCorrections([], []), []);
});
