// Schrijft de vaste gevallen voor de pariteit van het beeldwerk in Rust
// (crate open-pdf-image): wat de JS-route maakt van een reeks PNG's.
// `cargo test -p open-pdf-image` eist dezelfde uitkomst.
//
// Run (vanuit open-pdf-studio/), na een wijziging van de JS-route of van de
// gevallen in js/pdf/beeld-gevallen.testhulp.mjs:
//   node scripts/bench-rust/beeld-golden.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bouwGevallen } from '../../js/pdf/beeld-gevallen.testhulp.mjs';

const doel = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'open-pdf-image', 'tests', 'fixtures', 'gevallen.bin');
mkdirSync(dirname(doel), { recursive: true });
const bytes = await bouwGevallen();
writeFileSync(doel, bytes);
console.log(`${doel}: ${bytes.length} bytes`);
