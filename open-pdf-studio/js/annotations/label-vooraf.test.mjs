// Het label van een meting vooraf instellen (#1055): wat bij het actieve
// meetgereedschap als onderwerp of naam is ingevuld, gaat mee naar de
// volgende meting van die soort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLabelVeld, zetLabelVooraf, labelVooraf, metLabelVooraf, wisLabelVooraf } from './label-vooraf.js';

test('het ingestelde onderwerp gaat mee naar een nieuwe maatlijn', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  const p = metLabelVooraf({ type: 'measureDistance', startX: 0 });
  assert.equal(p.subject, 'Keukenwand');
  assert.equal(p.startX, 0);
});

test('een label geldt alleen voor de eigen soort meting', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  assert.equal('subject' in metLabelVooraf({ type: 'measureArea' }), false);
  assert.deepEqual(labelVooraf('measureArea'), {});
});

test('de naam van een oppervlak gaat mee, naast het onderwerp', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureArea', 'measureName', 'Woonkamer');
  zetLabelVooraf('measureArea', 'subject', 'Begane grond');
  assert.deepEqual(labelVooraf('measureArea'), { measureName: 'Woonkamer', subject: 'Begane grond' });
});

test('wat het gereedschap zelf al invult blijft staan', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  assert.equal(metLabelVooraf({ type: 'measureDistance', subject: 'Radius' }).subject, 'Radius');
});

test('een leeggemaakt label vervalt', () => {
  wisLabelVooraf();
  zetLabelVooraf('measureDistance', 'subject', 'Keukenwand');
  zetLabelVooraf('measureDistance', 'subject', '   ');
  assert.deepEqual(labelVooraf('measureDistance'), {});
});

test('alleen metingen en alleen labelvelden doen mee', () => {
  wisLabelVooraf();
  assert.equal(isLabelVeld('measureDistance', 'subject'), true);
  assert.equal(isLabelVeld('measureArea', 'measureName'), true);
  assert.equal(isLabelVeld('measureDistance', 'color'), false);
  assert.equal(isLabelVeld('box', 'subject'), false);
  zetLabelVooraf('box', 'subject', 'x');
  const p = { type: 'box' };
  assert.equal(metLabelVooraf(p), p);
});
