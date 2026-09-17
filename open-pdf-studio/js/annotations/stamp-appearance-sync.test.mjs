import assert from 'node:assert/strict';
import test from 'node:test';

import { stampAppearanceSnapshot, syncStampAppearance } from './stamp-appearance-sync.js';

// Nep-hooks: leggen vast wat er aangeroepen is, in volgorde.
function spyHooks() {
  const calls = [];
  return {
    calls,
    applyStampColor: (ann) => { calls.push(['color', ann.color]); return true; },
    applyStampLineWidth: (ann) => { calls.push(['lineWidth', ann.lineWidth]); return true; },
  };
}

function symbool(extra = {}) {
  return {
    type: 'stamp', color: '#000000', lineWidth: 1,
    stampSvg: '<svg viewBox="0 0 64 64"><g stroke="#000" stroke-width="2"><path d="M0 0"/></g></svg>',
    ...extra,
  };
}

test('lijnkleur uit de opmaakwerkbalk (strokeColor + color) herkleurt het symbool', () => {
  const ann = symbool();
  const voor = stampAppearanceSnapshot(ann);
  ann.strokeColor = '#ff0000';
  ann.color = '#ff0000';
  const hooks = spyHooks();
  syncStampAppearance(ann, voor, hooks);
  assert.deepEqual(hooks.calls, [['color', '#ff0000']]);
});

test('alleen strokeColor gewijzigd (stijlvoorinstelling): color volgt en het symbool herkleurt', () => {
  const ann = symbool();
  const voor = stampAppearanceSnapshot(ann);
  ann.strokeColor = '#0066cc';
  const hooks = spyHooks();
  syncStampAppearance(ann, voor, hooks);
  assert.equal(ann.color, '#0066cc');
  assert.deepEqual(hooks.calls, [['color', '#0066cc']]);
});

test('lijndikte uit de opmaakwerkbalk gaat de SVG in', () => {
  const ann = symbool();
  const voor = stampAppearanceSnapshot(ann);
  ann.lineWidth = 3;
  const hooks = spyHooks();
  syncStampAppearance(ann, voor, hooks);
  assert.deepEqual(hooks.calls, [['lineWidth', 3]]);
});

test('kleur en dikte tegelijk: eerst dikte, dan kleur (zelfde volgorde als de MCP-brug)', () => {
  const ann = symbool();
  const voor = stampAppearanceSnapshot(ann);
  ann.lineWidth = 2;
  ann.color = '#008000';
  ann.strokeColor = '#008000';
  const hooks = spyHooks();
  syncStampAppearance(ann, voor, hooks);
  assert.deepEqual(hooks.calls, [['lineWidth', 2], ['color', '#008000']]);
});

test('ongewijzigde kleur/dikte (bv. dekking of verbergen) raakt de SVG niet', () => {
  const ann = symbool({ strokeColor: '#000000' });
  const voor = stampAppearanceSnapshot(ann);
  ann.opacity = 0.5;
  const hooks = spyHooks();
  syncStampAppearance(ann, voor, hooks);
  assert.deepEqual(hooks.calls, []);
});

test('geen symbool (andere annotatie of stempel zonder SVG): geen snapshot, geen hooks', () => {
  assert.equal(stampAppearanceSnapshot({ type: 'line', color: '#000' }), null);
  assert.equal(stampAppearanceSnapshot({ type: 'stamp', stampText: 'OK', color: '#000' }), null);
  const ann = { type: 'line', color: '#000' };
  ann.color = '#f00';
  const hooks = spyHooks();
  syncStampAppearance(ann, null, hooks);
  assert.deepEqual(hooks.calls, []);
});

test('met de echte herkleurregel: een NL-Elektra-achtige bron krijgt de werkbalkkleur', async () => {
  const { recolorSvg } = await import('./svg-stroke-color.js');
  const ann = symbool();
  const voor = stampAppearanceSnapshot(ann);
  ann.strokeColor = '#cc0000';
  ann.color = '#cc0000';
  syncStampAppearance(ann, voor, {
    applyStampColor: (a) => { a.stampSvg = recolorSvg(a.stampSvg, a.color); },
    applyStampLineWidth: () => {},
  });
  assert.ok(ann.stampSvg.includes('stroke="#cc0000"'));
  assert.ok(!ann.stampSvg.includes('stroke="#000"'));
});
