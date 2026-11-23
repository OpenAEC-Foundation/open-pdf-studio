// Stamp tool: choose first, then place with a click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const {
  zetStempelKeuze, stempelKeuze, wisStempelKeuze, stempelKeuzeMaat, afbeeldingStempelMaat, stempelKeuzeNaam,
} = await import('./stamp-keuze.js');
const { stampTool } = await import('../tools/tools/text-tool.js');

function ctx(extra = {}) {
  const log = { kiezer: [], gekozen: [], vast: [] };
  return {
    log,
    x: 5, y: 6, pageNum: 3, state: { toolOverrides: null },
    showStampPicker: (...a) => log.kiezer.push(a),
    plaatsGekozenStempel: (...a) => log.gekozen.push(a),
    placeOverrideStamp: (...a) => log.vast.push(a),
    ...extra,
  };
}

test('a click places the chosen stamp instead of opening the picker', () => {
  zetStempelKeuze({ soort: 'vast', stamp: { name: 'Draft', text: 'DRAFT', color: '#3b82f6' } });
  const c = ctx();
  stampTool.onPointerDown(c, { button: 0 });
  assert.deepEqual(c.log.gekozen, [[5, 6, 3]]);
  assert.deepEqual(c.log.kiezer, []);
  // The choice stays for the next click.
  stampTool.onPointerDown(c, { button: 0 });
  assert.equal(c.log.gekozen.length, 2);
  wisStempelKeuze();
});

test('without a choice a click still opens the picker at that point', () => {
  wisStempelKeuze();
  const c = ctx();
  stampTool.onPointerDown(c, { button: 0 });
  assert.deepEqual(c.log.kiezer, [[5, 6, 3]]);
  assert.deepEqual(c.log.gekozen, []);
});

test('a symbol from the library goes before a choice from the picker', () => {
  zetStempelKeuze({ soort: 'vast', stamp: { name: 'Draft', text: 'DRAFT' } });
  const c = ctx({ state: { toolOverrides: { stampImage: 'data:x' } } });
  stampTool.onPointerDown(c, { button: 0 });
  assert.deepEqual(c.log.vast, [[5, 6, 3]]);
  assert.deepEqual(c.log.gekozen, []);
  wisStempelKeuze();
});

test('the right mouse button places nothing', () => {
  zetStempelKeuze({ soort: 'vast', stamp: { name: 'Draft', text: 'DRAFT' } });
  const c = ctx();
  stampTool.onPointerDown(c, { button: 2 });
  assert.deepEqual(c.log.gekozen, []);
  wisStempelKeuze();
});

test('leaving the tool forgets the choice', () => {
  zetStempelKeuze({ soort: 'sjabloon', template: { name: 'Checked' } });
  stampTool.onDeactivate({ redraw() {} });
  assert.equal(stempelKeuze(), null);
});

test('the preview has the size the stamp is placed at', () => {
  assert.deepEqual(afbeeldingStempelMaat(400, 100), { width: 200, height: 50 });
  assert.deepEqual(afbeeldingStempelMaat(80, 40), { width: 80, height: 40 });
  const beeld = { soort: 'afbeelding', img: { naturalWidth: 100, naturalHeight: 400 } };
  assert.deepEqual(stempelKeuzeMaat(beeld), { width: 50, height: 200 });
  const sjabloon = { soort: 'sjabloon', template: { name: 'Checked' } };
  assert.deepEqual(stempelKeuzeMaat(sjabloon, () => ({ width: 120, height: 40 })), { width: 120, height: 40 });
  assert.equal(stempelKeuzeNaam(sjabloon), 'Checked');
  assert.equal(stempelKeuzeMaat(null), null);
});

test('a built-in text stamp is placed at a size its text fills', async () => {
  const { BUILTIN_STAMP_DEFAULT_WIDTH: w, BUILTIN_STAMP_DEFAULT_HEIGHT: h } = await import('./stamp-defaults.js');
  // The screen (rendering.js) and the saved appearance (saver.js) draw the
  // text at half the frame height, capped at 24 and 22 points. A frame that
  // is far higher than that cap is an almost empty box.
  assert.ok(h * 0.5 <= 24 + 1, `frame height ${h} leaves the text at the cap`);
  // On paper: a stamp, not a poster (1 pt = 25.4 / 72 mm).
  const mm = (pt) => pt * 25.4 / 72;
  assert.ok(mm(w) >= 40 && mm(w) <= 80, `width ${mm(w).toFixed(0)} mm`);
  assert.ok(mm(h) >= 12 && mm(h) <= 25, `height ${mm(h).toFixed(0)} mm`);
  assert.deepEqual(stempelKeuzeMaat({ soort: 'vast', stamp: { text: 'DRAFT' } }), { width: w, height: h });
});
