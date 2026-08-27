import assert from 'node:assert/strict';
import test from 'node:test';

import {
  destTopOffsetPt,
  isSafeLinkUrl,
  parseDestinationArray,
} from './link-destination.js';

const A4_H = 841.92;

test('leest een /XYZ-bestemming zoals PDF.js die aanlevert', () => {
  const dest = [{ num: 12, gen: 0 }, { name: 'XYZ' }, 68, 708, 0];
  const info = parseDestinationArray(dest);
  assert.equal(info.type, 'XYZ');
  assert.deepEqual(info.pageRef, { num: 12, gen: 0 });
  assert.equal(info.left, 68);
  assert.equal(info.top, 708);
  assert.equal(info.zoom, 0);
});

test('accepteert een naam met schuine streep uit rauwe PDF-objecten', () => {
  const info = parseDestinationArray([{ num: 3, gen: 0 }, '/FitH', 500]);
  assert.equal(info.type, 'FitH');
  assert.equal(info.top, 500);
});

test('valt terug op Fit wanneer het naamelement ontbreekt', () => {
  const info = parseDestinationArray([{ num: 3, gen: 0 }]);
  assert.equal(info.type, 'Fit');
  assert.equal(info.top, null);
});

test('negeert niet-numerieke argumenten (null in /XYZ)', () => {
  const info = parseDestinationArray([{ num: 1, gen: 0 }, { name: 'XYZ' }, null, null, null]);
  assert.equal(info.left, null);
  assert.equal(info.top, null);
});

test('geeft null voor niet-arrays', () => {
  assert.equal(parseDestinationArray(null), null);
  assert.equal(parseDestinationArray('hoofdstuk-1'), null);
  assert.equal(parseDestinationArray([]), null);
});

test('rekent /XYZ om naar afstand vanaf de bovenkant van de pagina', () => {
  const info = parseDestinationArray([{ num: 12, gen: 0 }, { name: 'XYZ' }, 68, 708, 0]);
  assert.equal(destTopOffsetPt(info, A4_H).toFixed(2), (A4_H - 708).toFixed(2));
});

test('/FitH en /FitR sturen ook verticaal', () => {
  assert.equal(destTopOffsetPt(parseDestinationArray([1, { name: 'FitH' }, 800]), A4_H).toFixed(2), '41.92');
  assert.equal(
    destTopOffsetPt(parseDestinationArray([1, { name: 'FitR' }, 10, 100, 500, 700]), A4_H).toFixed(2),
    '141.92',
  );
});

test('/Fit en /FitB springen naar de bovenkant van de pagina', () => {
  assert.equal(destTopOffsetPt(parseDestinationArray([1, { name: 'Fit' }]), A4_H), 0);
  assert.equal(destTopOffsetPt(parseDestinationArray([1, { name: 'FitB' }]), A4_H), 0);
});

test('/FitV laat de verticale positie ongemoeid', () => {
  assert.equal(destTopOffsetPt(parseDestinationArray([1, { name: 'FitV' }, 20]), A4_H), null);
});

test('klemt bestemmingen buiten de pagina af', () => {
  // top boven de pagina (Word schrijft soms een top > pageHeight)
  assert.equal(destTopOffsetPt(parseDestinationArray([1, { name: 'XYZ' }, 0, 2000, 0]), A4_H), 0);
  // top onder de pagina
  assert.equal(destTopOffsetPt(parseDestinationArray([1, { name: 'XYZ' }, 0, -500, 0]), A4_H), A4_H);
});

test('geeft null zonder bruikbare paginahoogte', () => {
  const info = parseDestinationArray([1, { name: 'XYZ' }, 0, 700, 0]);
  assert.equal(destTopOffsetPt(info, 0), null);
  assert.equal(destTopOffsetPt(info, NaN), null);
  assert.equal(destTopOffsetPt(null, A4_H), null);
});

test('laat alleen veilige schema\'s naar buiten', () => {
  assert.equal(isSafeLinkUrl('https://voorbeeld.nl/pagina'), true);
  assert.equal(isSafeLinkUrl('http://voorbeeld.nl'), true);
  assert.equal(isSafeLinkUrl('mailto:iemand@voorbeeld.nl'), true);
  assert.equal(isSafeLinkUrl('javascript:alert(1)'), false);
  assert.equal(isSafeLinkUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(isSafeLinkUrl('file:///C:/Windows/System32/cmd.exe'), false);
  assert.equal(isSafeLinkUrl('/relatief/pad'), false);
  assert.equal(isSafeLinkUrl(''), false);
  assert.equal(isSafeLinkUrl(null), false);
});
