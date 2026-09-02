import assert from 'node:assert/strict';
import test from 'node:test';

import { svgDominantColor, recolorSvg } from './svg-stroke-color.js';

test('herkleurt stroke- en fill-attributen naar de doelkleur', () => {
  const svg = '<svg viewBox="0 0 64 64"><path stroke="#000" fill="#333" d="M0 0"/></svg>';
  const uit = recolorSvg(svg, '#ff0000');
  assert.equal(uit, '<svg viewBox="0 0 64 64"><path stroke="#ff0000" fill="#ff0000" d="M0 0"/></svg>');
});

test('laat none, wit en url()-paints staan', () => {
  const svg = '<svg viewBox="0 0 8 8"><rect fill="none" stroke="#fff"/><circle fill="url(#g)" stroke="black"/></svg>';
  const uit = recolorSvg(svg, '#00ff00');
  assert.ok(uit.includes('fill="none"'));
  assert.ok(uit.includes('stroke="#fff"'));
  assert.ok(uit.includes('fill="url(#g)"'));
  assert.ok(uit.includes('stroke="#00ff00"'));
});

test('zonder enig paint-attribuut komt de kleur op de root (erft overal)', () => {
  const svg = '<svg viewBox="0 0 8 8"><path d="M0 0h8"/></svg>';
  const uit = recolorSvg(svg, '#0000ff');
  assert.ok(/<svg[^>]*fill="#0000ff">/.test(uit));
});

test('onbruikbare invoer komt ongewijzigd terug', () => {
  const svg = '<svg viewBox="0 0 8 8"><path stroke="red"/></svg>';
  assert.equal(recolorSvg(svg, ''), svg);
  assert.equal(recolorSvg(svg, null), svg);
  assert.equal(recolorSvg(null, '#fff'), null);
});

test('dominante kleur: meest voorkomende zichtbare kleur', () => {
  const svg = '<svg><path stroke="#000"/><path stroke="#000"/><path stroke="#ff00ff"/></svg>';
  assert.equal(svgDominantColor(svg), '#000');
});

test('dominante kleur: null zonder expliciete kleuren', () => {
  assert.equal(svgDominantColor('<svg><path d="M0 0"/></svg>'), null);
  assert.equal(svgDominantColor('<svg><rect fill="none" stroke="white"/></svg>'), null);
});
