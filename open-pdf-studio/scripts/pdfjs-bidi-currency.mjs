// Narrow classification backport from Mozilla PDF.js #22593,
// 98100629a8ab3c6625c82a5ab5b9a82457f415f3, src/core/bidi_tables.js.
// Copyright Mozilla Foundation, Apache-2.0:
// https://www.apache.org/licenses/LICENSE-2.0
// Unicode 17.0 DerivedBidiClass assigns the entire Currency Symbols block
// U+20A0..U+20CF to ET. PDF.js 6.4.299 instead defaults it to strong L,
// separating shekel/euro from their amount in RTL extraction (#1266).
// Keep this bounded patch until a released worker passes the extraction and
// consumer regressions. It does not adopt the upstream mirroring changes.
const BEFORE = `    if (charCode <= 0x00ff) {
      charType = baseTypes[charCode];
    } else if (0x0590 <= charCode && charCode <= 0x05f4) {`;
const AFTER = `    if (charCode <= 0x00ff) {
      charType = baseTypes[charCode];
    } else if (0x20a0 <= charCode && charCode <= 0x20cf) {
      charType = "ET"; // Currency Symbols: Unicode Bidi_Class (#1266).
    } else if (0x0590 <= charCode && charCode <= 0x05f4) {`;
export function patchBidiCurrency(source) {
  if (source.split(AFTER).length === 2 && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2 || source.includes('Currency Symbols: Unicode Bidi_Class (#1266)')) {
    throw new Error('PDF.js currency classification patch no longer matches; qualify the worker before updating PDF.js (#1266).');
  }
  return source.replace(BEFORE, AFTER);
}
