import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { staatIdBijDoel, isPaginaDoel } from './schedule-pointer-drag.js';

const element = (selectors, dataset) => ({
  closest: (s) => (s.split(',').some((d) => selectors.includes(d.trim())) ? { dataset } : null),
});

test('een rij en zijn knoppen starten het slepen, het naamveld niet', () => {
  assert.equal(staatIdBijDoel(element(['.schedules-item'], { scheduleId: 's1' })), 's1');
  assert.equal(staatIdBijDoel(element(['.schedules-item', 'button'], { scheduleId: 's1' })), 's1');
  assert.equal(staatIdBijDoel(element(['.schedules-item', 'input'], { scheduleId: 's1' })), null);
  assert.equal(staatIdBijDoel(element([])), null);
});

test('plaatsen kan alleen op de PDF, in doorlopend alleen op een pagina', () => {
  assert.equal(isPaginaDoel(element(['#pdf-container']), 'single'), true);
  assert.equal(isPaginaDoel(element([]), 'single'), false);
  assert.equal(isPaginaDoel(element(['#pdf-container']), 'continuous'), false);
  assert.equal(isPaginaDoel(element(['#pdf-container', '.canvas-container-cont']), 'continuous'), true);
  assert.equal(isPaginaDoel(null, 'single'), false);
});

test('het paneel gebruikt geen HTML5-slepen meer', () => {
  const paneel = readFileSync(new URL('../solid/components/left-panel/panels/SchedulesPanel.jsx', import.meta.url), 'utf8');
  assert.ok(!paneel.includes('onDragStart'));
  assert.ok(!/class="schedules-item"[^>]*draggable/.test(paneel));
  assert.ok(paneel.includes('koppelStaatSlepen('));
});
