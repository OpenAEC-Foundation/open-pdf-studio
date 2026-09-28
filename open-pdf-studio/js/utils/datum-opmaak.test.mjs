import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDate } from './datum-opmaak.js';

// De oude opmaak, letterlijk: de nieuwe moet dezelfde tekst geven.
function oud(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

test('zelfde tekst als toLocaleDateString + toLocaleTimeString', () => {
  const invoer = [
    '2026-09-28T06:47:12.345Z', '2026-01-01T00:00:00Z', '1999-12-31T23:59:59Z', '2026-03-29T01:30:00Z',
    1789821652711, new Date(2024, 1, 29, 12, 5), 'D:20260928064712', '28 September 2026 18:07',
  ];
  for (let i = 0; i < 400; i++) invoer.push(Date.UTC(2020, 0, 1) + i * 7_919_311_117 % 3e11);
  for (const v of invoer) assert.equal(formatDate(v), oud(v), String(v));
});

test('leeg blijft leeg, ongeldig blijft de oude tekst', () => {
  for (const v of [null, undefined, '', 0]) assert.equal(formatDate(v), '');
  assert.equal(formatDate('geen datum'), oud('geen datum'));
});

test('duizend datums zijn samen ruim sneller dan de oude weg', () => {
  const datums = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString());
  const meet = (f) => { const t = performance.now(); for (let r = 0; r < 5; r++) for (const d of datums) f(d); return performance.now() - t; };
  meet(formatDate); meet(oud);
  const nieuw = meet(formatDate), vroeger = meet(oud);
  assert.ok(nieuw * 3 < vroeger, `nieuw ${nieuw.toFixed(1)} ms, oud ${vroeger.toFixed(1)} ms`);
});
