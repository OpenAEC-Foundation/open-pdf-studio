// createDateFormatter (#491) makes its two locale formatters once, for the
// annotation list with thousands of rows; the text must stay exactly what
// formatDate gives, for every date the list can meet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// helpers.js imports the i18n set-up, which only Vite can load.
register('../core/app-test-hooks.mjs', import.meta.url);
const { formatDate, createDateFormatter } = await import('./helpers.js');

test('the list date formatter gives exactly the text of formatDate', () => {
  const opmaak = createDateFormatter();
  const waarden = [
    '2026-09-28T06:00:00.000Z', '2026-01-01T00:00:00Z', '1999-12-31T23:59:59.999Z',
    '2026-03-29T00:59:00Z', '2026-03-29T01:00:00Z', '2026-10-25T00:59:00Z', '2026-10-25T01:00:00Z',
    Date.UTC(2024, 1, 29, 12, 30), new Date(2020, 5, 15, 8, 5), 1,
    '', null, undefined, 0, 'geen datum', NaN, new Date('x'),
  ];
  // En een reeks willekeurige tijdstippen over meer dan een eeuw.
  let t = 17;
  for (let i = 0; i < 500; i++) {
    t = (t * 1103515245 + 12345) % 2147483648;
    waarden.push(new Date(Date.UTC(1950, 0, 1) + (t / 2147483648) * 150 * 365.25 * 86400000).toISOString());
  }
  for (const waarde of waarden) assert.equal(opmaak(waarde), formatDate(waarde), String(waarde));
});
