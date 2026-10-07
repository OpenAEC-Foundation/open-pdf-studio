// Draait de unit-tests uit scripts/unit-testlijst.txt (één pad per regel,
// '#' is commentaar) met `node --test`. Zonder shell, zodat de lengte van de
// lijst niet tegen de grens van cmd.exe (8191 tekens) aanloopt; wordt hij ooit
// te lang voor één proces, dan draait hij in partijen na elkaar.
//
// Gebruik: npm run test:unit  (extra argumenten gaan mee naar node --test)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');
const LIJST = path.join(hier, 'unit-testlijst.txt');
// Ruim onder de 32767 tekens die Windows voor een hele opdrachtregel toestaat.
const MAX_PARTIJ = 24000;

export function leesTestlijst(tekst = fs.readFileSync(LIJST, 'utf8')) {
  return tekst.split(/\r?\n/).map((r) => r.trim()).filter((r) => r && !r.startsWith('#'));
}

export function inPartijen(bestanden, max = MAX_PARTIJ) {
  const partijen = [];
  let huidig = [];
  let lengte = 0;
  for (const b of bestanden) {
    const extra = (huidig.length ? 1 : 0) + b.length;
    if (huidig.length && lengte + extra > max) {
      partijen.push(huidig);
      huidig = [];
      lengte = 0;
    }
    lengte += (huidig.length ? 1 : 0) + b.length;
    huidig.push(b);
  }
  if (huidig.length) partijen.push(huidig);
  return partijen;
}

function draai() {
  const bestanden = leesTestlijst();
  const ontbreekt = bestanden.filter((b) => !fs.existsSync(path.join(app, b)));
  if (ontbreekt.length) {
    console.error(`unit-testlijst.txt noemt bestanden die niet bestaan:\n  ${ontbreekt.join('\n  ')}`);
    process.exit(1);
  }
  let status = 0;
  for (const partij of inPartijen(bestanden)) {
    const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...partij], { cwd: app, stdio: 'inherit' });
    if (r.status !== 0) status = r.status || 1;
  }
  process.exit(status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) draai();
