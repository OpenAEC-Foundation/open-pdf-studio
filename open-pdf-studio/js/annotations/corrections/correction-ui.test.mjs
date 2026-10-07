// Proefleescorrecties (#508) in de bediening: een vervanging (invoegteken
// plus doorhaling) wordt als één geheel geselecteerd, verwijderd en
// ongedaan gemaakt; de lijst toont haar als één regel; een invoegteken is
// klein en krijgt dus raakruimte.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expandCorrectionGroups, replaceParentOf, withoutFoldedChildren,
} from './model.js';
import { caretHit } from './geometry.js';

const KARET = { id: 'k', type: 'caret', page: 1, intent: 'Replace', groupId: 'k', text: 'the' };
const DOOR = {
  id: 's', type: 'textStrikethrough', page: 1, intent: 'StrikeOutTextEdit',
  inReplyTo: 'k', replyType: 'group', groupId: 'k', markedText: 'teh',
};
const INVOEG = { id: 'i', type: 'caret', page: 1, text: 'a' };
const SCHRAP = { id: 'd', type: 'textStrikethrough', page: 1, intent: 'StrikeOutTextEdit', markedText: 'x' };
const MARKEER = { id: 'h', type: 'textHighlight', page: 1 };
const VAK = { id: 'b', type: 'box', page: 1 };
const ALLE = [KARET, DOOR, INVOEG, SCHRAP, MARKEER, VAK];

test('de andere helft van een vervanging komt mee, in beide richtingen', () => {
  assert.deepEqual(expandCorrectionGroups(ALLE, [KARET]), [KARET, DOOR]);
  assert.deepEqual(expandCorrectionGroups(ALLE, [DOOR]), [DOOR, KARET]);
  assert.deepEqual(expandCorrectionGroups(ALLE, [KARET, DOOR]), [KARET, DOOR], 'geen dubbelen');
  assert.deepEqual(expandCorrectionGroups(ALLE, [VAK, DOOR]), [VAK, DOOR, KARET], 'de selectie blijft vooraan');
});

test('losse correcties en andere annotaties blijven zoals ze zijn', () => {
  assert.deepEqual(expandCorrectionGroups(ALLE, [INVOEG]), [INVOEG]);
  assert.deepEqual(expandCorrectionGroups(ALLE, [SCHRAP, MARKEER]), [SCHRAP, MARKEER]);
  assert.deepEqual(expandCorrectionGroups(ALLE, []), []);
  assert.deepEqual(expandCorrectionGroups(ALLE, null), []);
});

test('een verzameling rond een vervanging sleept de rest van de verzameling niet mee', () => {
  const k = { ...KARET, groupId: 'grp_1' };
  const s = { ...DOOR, groupId: 'grp_1' };
  const b = { ...VAK, groupId: 'grp_1' };
  assert.deepEqual(expandCorrectionGroups([k, s, b], [k]), [k, s]);
});

test('een doorhaling met een groepskoppeling naar iets anders dan een invoegteken blijft alleen', () => {
  const wees = { ...DOOR, id: 's2', inReplyTo: 'weg' };
  const naarVak = { ...DOOR, id: 's3', inReplyTo: 'b' };
  assert.deepEqual(expandCorrectionGroups([...ALLE, wees, naarVak], [wees]), [wees]);
  assert.deepEqual(expandCorrectionGroups([...ALLE, wees, naarVak], [naarVak]), [naarVak]);
});

test('replaceParentOf: het invoegteken als de groep precies één vervanging is', () => {
  assert.equal(replaceParentOf([KARET, DOOR], ALLE), KARET);
  assert.equal(replaceParentOf([DOOR, KARET], ALLE), KARET);
  assert.equal(replaceParentOf([KARET, DOOR, VAK], ALLE), null, 'een verzameling met meer erin');
  assert.equal(replaceParentOf([DOOR], ALLE), null, 'zonder het invoegteken');
  assert.equal(replaceParentOf([INVOEG, SCHRAP], ALLE), null, 'invoegen en schrappen zijn geen vervanging');
  assert.equal(replaceParentOf([], ALLE), null);
});

test('de lijst vouwt de doorhaling onder haar invoegteken, maar niet als dat er niet in staat', () => {
  assert.deepEqual(withoutFoldedChildren([KARET, DOOR, INVOEG, SCHRAP], ALLE), [KARET, INVOEG, SCHRAP]);
  assert.deepEqual(withoutFoldedChildren([DOOR, INVOEG], ALLE), [DOOR, INVOEG], 'gefilterd op soort: de helft blijft zichtbaar');
  assert.deepEqual(withoutFoldedChildren([MARKEER, VAK], ALLE), [MARKEER, VAK]);
});

test('het vak van een invoegteken groeit met de raaktolerantie', () => {
  const vak = { x: 10, y: 10, width: 6, height: 6 };
  assert.equal(caretHit(vak, 13, 13, 0), true);
  assert.equal(caretHit(vak, 9, 9, 0), false);
  assert.equal(caretHit(vak, 9, 9, 2), true);
  assert.equal(caretHit(vak, 17, 13, 1), true);
  assert.equal(caretHit(vak, 17.5, 13, 1), false);
  assert.equal(caretHit(vak, 13, 4, 5), false);
});
