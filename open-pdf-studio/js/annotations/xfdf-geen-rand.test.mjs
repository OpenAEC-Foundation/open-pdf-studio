// Vorm zonder rand in XFDF (#433, nawerk van #431). Exporteren schreef
// color="NONE" — geen geldige XFDF-kleur; andere lezers maken er zwart van.
// Het attribuut hoort wég te blijven, en bij het inlezen telt zowel een
// ontbrekend attribuut als NONE (hoofdletterongevoelig) als "geen rand".

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  randkleurAttribuut,
  randkleurUitAttribuut,
  vulkleurUitAttribuut,
  colorToXFDF,
  xfdfColorToHex,
} from './xfdf-kleur.js';

// --- exporteren -----------------------------------------------------------

test('een vorm zonder rand krijgt GEEN color-attribuut', () => {
  assert.equal(randkleurAttribuut({ type: 'box', strokeColor: 'none', color: '#cc0000' }), '');
  assert.equal(randkleurAttribuut({ type: 'circle', strokeColor: 'transparent' }), '');
  assert.equal(randkleurAttribuut({ type: 'textbox', strokeColor: 'none' }), '');
  // Nergens meer de oude noodwaarde.
  assert.ok(!randkleurAttribuut({ type: 'box', strokeColor: 'none' }).includes('NONE'));
});

test('een vorm met rand houdt zijn kleur, ook via de eigen kleur', () => {
  assert.equal(randkleurAttribuut({ type: 'box', strokeColor: '#cc0000' }), ' color="#CC0000"');
  assert.equal(randkleurAttribuut({ type: 'box', color: '#00ff00' }), ' color="#00FF00"');
  assert.equal(randkleurAttribuut({ type: 'box' }), ' color="#000000"');
});

test('een soort zonder "geen rand" blijft zichtbaar, wat er ook in staat', () => {
  // Een lijn IS zijn streek: het attribuut mag nooit wegvallen.
  assert.equal(randkleurAttribuut({ type: 'line', strokeColor: 'none' }), ' color="#000000"');
  assert.equal(randkleurAttribuut({ type: 'draw', strokeColor: 'transparent' }), ' color="#000000"');
});

// --- inlezen --------------------------------------------------------------

test('ontbrekend of NONE color-attribuut betekent "geen rand"', () => {
  assert.equal(randkleurUitAttribuut(null, 'box'), 'none');
  assert.equal(randkleurUitAttribuut('', 'box'), 'none');
  assert.equal(randkleurUitAttribuut('NONE', 'box'), 'none');
  assert.equal(randkleurUitAttribuut('none', 'circle'), 'none');
  assert.equal(randkleurUitAttribuut('None', 'textbox'), 'none');
  assert.equal(randkleurUitAttribuut(' TRANSPARENT ', 'box'), 'none');
});

test('bij een soort zonder "geen rand" valt een leeg attribuut terug op zwart', () => {
  assert.equal(randkleurUitAttribuut(null, 'line'), '#000000');
  assert.equal(randkleurUitAttribuut('NONE', 'draw'), '#000000');
  assert.equal(randkleurUitAttribuut(undefined, 'comment'), '#000000');
});

test('een gewone kleur komt ongewijzigd terug', () => {
  assert.equal(randkleurUitAttribuut('#CC0000', 'box'), '#CC0000');
  assert.equal(randkleurUitAttribuut('1,0,0', 'box'), '#ff0000');
  assert.equal(randkleurUitAttribuut('0,0,1', 'line'), '#0000ff');
});

test('een ontbrekende interior-color is GEEN vulling, geen zwart', () => {
  assert.equal(vulkleurUitAttribuut(null), null);
  assert.equal(vulkleurUitAttribuut(''), null);
  assert.equal(vulkleurUitAttribuut('NONE'), null);
  assert.equal(vulkleurUitAttribuut('#FFFBEB'), '#FFFBEB');
});

// --- rondgang export → import --------------------------------------------

test('rondgang: een vorm zonder rand komt zonder rand terug', () => {
  for (const type of ['box', 'circle', 'textbox', 'callout', 'polygon', 'cloud']) {
    const attr = randkleurAttribuut({ type, strokeColor: 'none', color: '#123456' });
    // Uit het attribuut terug naar een waarde, zoals de import doet.
    const gelezen = /color="([^"]*)"/.exec(attr);
    assert.equal(randkleurUitAttribuut(gelezen ? gelezen[1] : null, type), 'none', type);
  }
});

test('rondgang: een vorm met rand houdt zijn kleur', () => {
  const attr = randkleurAttribuut({ type: 'box', strokeColor: '#cc0000' });
  const gelezen = /color="([^"]*)"/.exec(attr)[1];
  assert.equal(randkleurUitAttribuut(gelezen, 'box'), '#CC0000');
});

test('rondgang: color="NONE" uit een ouder bestand leest nog steeds als geen rand', () => {
  assert.equal(randkleurUitAttribuut(colorToXFDF('none'), 'box'), 'none');
  assert.equal(xfdfColorToHex('#abc123'), '#abc123');
});
