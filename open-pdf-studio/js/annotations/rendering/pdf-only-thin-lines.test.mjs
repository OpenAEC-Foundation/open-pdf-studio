import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { weergaveLijndikte } from './lijndikte.js';

// Exercise the production state adapters without importing the app webview.
const rendering = readFileSync(new URL('../rendering.js', import.meta.url), 'utf8');
// From the function header to its closing brace: what follows it in the file moves around.
const widthStart = rendering.indexOf('function thinLw(');
const widthFunction = rendering.slice(widthStart, rendering.indexOf('\n}', widthStart) + 2);
const hatches = readFileSync(new URL('./hatch-patterns.js', import.meta.url), 'utf8');
const hatchFunction = hatches.slice(hatches.indexOf('function _hatchLineWidth('), hatches.indexOf('// ---------------------------------------------------------------------------'));
function adapters(zoom) {
  const doc = { filePath: 'drawing.pdf', scale: zoom };
  const state = { preferences: { thinLines: false }, documents: [doc], activeDocumentIndex: 0 };
  const deps = { state, window: { __pdfViewport: { active: true, zoom } },
    getActiveDocument: () => doc, paneelDocument: () => null, schermSchaal: () => zoom,
    laag: () => true, weergaveLijndikte };
  const api = new Function('deps', `with (deps) { ${widthFunction}\n${hatchFunction}\nreturn { thinLw, hatch: _hatchLineWidth }; }`)(deps);
  return { api, state };
}
test('PDF Thin Lines preserves annotation widths at low and high zoom', () => {
  for (const zoom of [0.25, 1, 4]) {
    const { api, state } = adapters(zoom);
    const widths = [0, 0.35, 2, 12];
    const before = widths.map(api.thinLw);
    state.preferences.thinLines = true;
    assert.deepEqual(widths.map(api.thinLw), before);
    assert.equal(api.thinLw(12), 12);
  }
});
test('PDF Thin Lines preserves annotation hatch family widths', () => {
  for (const zoom of [0.25, 1, 4]) {
    const { api, state } = adapters(zoom);
    const before = [undefined, 0.2, 2].map(api.hatch);
    state.preferences.thinLines = true;
    assert.deepEqual([undefined, 0.2, 2].map(api.hatch), before);
    assert.deepEqual(before, [0.4, 0.2, 2]);
  }
});
