// Unit-tests voor de contenteditable-parse — met nagebootste DOM-knopen.
// Kern-regressie: kale tekstknopen die de browser bij typen aan het EINDE
// neerzet (in de regel-div of zelfs op root-niveau) mogen nooit wegvallen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEditorDom, cssColorToHex } from './editor-dom-parse.js';
import { runsPlainText } from './text-edit-appearance.js';

// ── mini-DOM-bouwers ──
const tekst = (data) => ({ nodeType: 3, data });
function el(tag, kinderen = [], extra = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: kinderen,
    classList: { contains: (c) => (extra.className || '').split(' ').includes(c) },
    style: extra.style || {},
    getAttribute: (n) => (extra.attrs || {})[n] ?? null,
    parentElement: null,
    previousSibling: null,
    nextSibling: null,
  };
  kinderen.forEach((k, i) => {
    k.parentElement = node;
    k.previousSibling = kinderen[i - 1] || null;
    k.nextSibling = kinderen[i + 1] || null;
  });
  return node;
}
const spacer = () => el('span', [], { className: 'pdf-tab-spacer' });
const root = (...kinderen) => el('#root', kinderen); // tagName '#ROOT' is geen blok
const platteTekst = (lines) => lines.map(runsPlainText).join('\n');

test('parse: toevoeging als kale tekstknoop aan het EINDE van de regel-div', () => {
  const r = root(el('div', [tekst('2438'), tekst('0')]));
  assert.equal(platteTekst(parseEditorDom(r)), '24380');
});

test('parse: kale tekstknoop op ROOT-niveau na de laatste regel-div', () => {
  const r = root(el('div', [tekst('2438')]), tekst('0'));
  assert.equal(platteTekst(parseEditorDom(r)), '24380');
});

test('parse: kale tekstknoop vóór de eerste regel-div (begin van de regel)', () => {
  const r = root(tekst('0'), el('div', [tekst('2438')]));
  // root-tekst opent regel 1; de div opent daarna een nieuwe regel
  assert.equal(platteTekst(parseEditorDom(r)), '0\n2438');
});

test('parse: tekstknoop direct ná een tab-spacer', () => {
  const r = root(el('div', [tekst('Label'), spacer(), tekst('2438'), tekst('0')]));
  assert.equal(platteTekst(parseEditorDom(r)), 'Label\t24380');
});

test('parse: toevoeging na een vet element als laatste kind', () => {
  const r = root(el('div', [tekst('abc '), el('b', [tekst('vet')]), tekst('0')]));
  const lines = parseEditorDom(r);
  assert.equal(platteTekst(lines), 'abc vet0');
  assert.deepEqual(lines[0].map(x => ({ t: x.text, b: !!x.bold })), [
    { t: 'abc ', b: false }, { t: 'vet', b: true }, { t: '0', b: false },
  ]);
});

test('parse: toevoeging BINNEN het laatste vetted element blijft vet', () => {
  const r = root(el('div', [el('b', [tekst('vet'), tekst('0')])]));
  const lines = parseEditorDom(r);
  assert.deepEqual(lines[0], [{ text: 'vet0', bold: true, italic: false }]);
});

test('parse: midden-in typen (gesplitste tekstknopen) blijft één run', () => {
  const r = root(el('div', [tekst('22'), tekst('X'), tekst('48')]));
  assert.equal(platteTekst(parseEditorDom(r)), '22X48');
});

test('parse: lege regel met <br>-placeholder', () => {
  const r = root(el('div', [tekst('a')]), el('div', [el('br')]), el('div', [tekst('b')]));
  assert.equal(platteTekst(parseEditorDom(r)), 'a\n\nb');
});

test('parse: kleur-span geeft run-kleur; regel-div-kleur niet', () => {
  const r = root(el('div', [
    tekst('zwart '),
    el('span', [tekst('rood')], { style: { color: 'rgb(255, 0, 0)' } }),
  ], { style: { color: '#000000' } }));
  const lines = parseEditorDom(r);
  assert.equal(lines[0][1].color, '#ff0000');
  assert.equal(lines[0][0].color, undefined);
});

test('cssColorToHex: rgb/hex-vormen', () => {
  assert.equal(cssColorToHex('rgb(255, 0, 0)'), '#ff0000');
  assert.equal(cssColorToHex('#A1B2C3'), '#a1b2c3');
  assert.equal(cssColorToHex('#abc'), '#aabbcc');
  assert.equal(cssColorToHex('geenkleur'), null);
});

test('parse: letterlijke CR/CRLF in een tekstknoop telt als regeleinde', () => {
  const r = root(el('div', [tekst('regel een\rregel twee')]));
  assert.equal(platteTekst(parseEditorDom(r)), 'regel een\nregel twee');
  const r2 = root(el('div', [tekst('a\r\nb')]));
  assert.equal(platteTekst(parseEditorDom(r2)), 'a\nb');
});
