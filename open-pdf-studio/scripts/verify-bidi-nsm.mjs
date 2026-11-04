// Verify the committed BMP NSM table from a local copy of the pinned UCD file.
// node scripts/verify-bidi-nsm.mjs /path/to/DerivedBidiClass.txt
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BMP_NSM_PATTERN } from './unicode-bidi-nsm.mjs';
const source = readFileSync(process.argv[2]);
assert.equal(createHash('sha256').update(source).digest('hex'), '4867b4b7f0731ed1bfcd34cc6251211ff1542541fce0734b6fbda139ee80b3a4');
const expected = new Set();
for (const line of source.toString().split('\n')) {
  const m = line.match(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*; NSM\b/);
  if (!m) continue;
  for (let c = parseInt(m[1], 16); c <= Math.min(65535, parseInt(m[2] || m[1], 16)); c++) expected.add(c);
}
const pattern = new RegExp(BMP_NSM_PATTERN);
for (let c = 0; c <= 65535; c++) assert.equal(pattern.test(String.fromCharCode(c)), expected.has(c), `U+${c.toString(16)}`);
console.log(`PASS: all 65536 BMP code units match UCD 17.0.0 (${expected.size} NSM)`);
