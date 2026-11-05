// Bouwt het voorbeeldprogramma van open-pdf-security (opds-beveiliging) en
// geeft het pad van het programma. De interoptest van de documentbeveiliging
// (js/pdf/document-beveiliging-interop.test.mjs, #378) gebruikt het.
//
// draai-unit-tests.mjs bouwt het VÓÓR de testpartijen en geeft het pad door in
// OPDS_BEVEILIGING_BIN: een compiler die tijdens de parallelle node --test-fase
// alle kernen bezet, liet tijdgevoelige tests (wachten op een debounce) op een
// trage runner mislukken. De test zelf start daarna alleen het programma.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(hier, '..', '..');

/**
 * @returns {{bin:string}|{geenCargo:true}|{fout:string}}
 */
export function bouwBeveiligingshulp({ cargo = process.env.CARGO || 'cargo' } = {}) {
  const r = spawnSync(cargo, [
    'build', '-q', '-p', 'open-pdf-security', '--example', 'opds-beveiliging', '--message-format=json-render-diagnostics',
  ], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error?.code === 'ENOENT') return { geenCargo: true };
  if (r.status !== 0) return { fout: (r.stderr || String(r.error || '')).trim() || `cargo exit ${r.status}` };
  for (const regel of (r.stdout || '').split(/\r?\n/)) {
    if (!regel.startsWith('{')) continue;
    let m;
    try { m = JSON.parse(regel); } catch { continue; }
    if (m.reason === 'compiler-artifact' && m.target?.name === 'opds-beveiliging' && m.executable) {
      return { bin: m.executable };
    }
  }
  return { fout: 'cargo reported no executable for opds-beveiliging' };
}

/** Het programma uit OPDS_BEVEILIGING_BIN, of zelf bouwen. */
export function beveiligingshulp() {
  const bin = process.env.OPDS_BEVEILIGING_BIN;
  if (bin && fs.existsSync(bin)) return { bin };
  return bouwBeveiligingshulp();
}
