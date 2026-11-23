// A colour in a schedule is shown as a swatch, not as its code (#1242).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { isKleurCel } from './kleur-cel.js';

test('a hex colour is a colour cell; other text is not', () => {
  for (const v of ['#fff700', '#FFFFFF', '#abc', ' #00ff00 ']) assert.equal(isKleurCel(v), true, v);
  for (const v of ['LAC', '', '#12345', '#gggggg', 'fff700', '91,33', null, undefined, 12]) assert.equal(isKleurCel(v), false, String(v));
});

test('the sheet and the panel draw the swatch; the CSV keeps the code', () => {
  const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(lees('../annotations/rendering.js'), /isKleurCel\(val\)/);
  assert.match(lees('../solid/components/SchedulePanel.jsx'), /schedule-color-swatch/);
  assert.doesNotMatch(lees('./schedule-csv.js'), /isKleurCel/);
});
