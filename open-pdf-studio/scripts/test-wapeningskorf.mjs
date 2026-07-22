// Unittest voor het parametrische sjabloon "wapeningskorf"
// (js/symbols/templates/wapeningskorf.js).
//
// Controleert:
//  1. aantallen staven kloppen met de parameters (boven/onder/zij);
//  2. staven liggen GELIJKMATIG verdeeld tussen de dekkingsgrenzen;
//  3. geen staaf steekt buiten de beugel-binnenmaat (dekking respecteren) en
//     staven overlappen elkaar niet;
//  4. labelteksten vormen "N ⌀ D" resp. "bgls ⌀ D - afstand", met het
//     diameterteken UIT stavenreeks.js (dezelfde segmenten);
//  5. realSizeMm volgt breedte/hoogte;
//  6. wijzigen van breedte/hoogte/aantallen verplaatst de staven consistent;
//  7. de render blijft binnen de bbox (anders valt hij uit de PDF-appearance).
//
// Draaien: node scripts/test-wapeningskorf.mjs

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');

// ESM-bronnen via temp-.mjs met behouden mappenstructuur (package is CJS).
const tmp = mkdtempSync(join(tmpdir(), 'opds-korf-'));
function stageMjs(relPath) {
  const src = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/(from\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2.mjs$3');
  const target = join(tmp, relPath).replace(/\.js$/, '.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, src);
  return target;
}
stageMjs('js/annotations/stavenreeks.js');
const staven = await import(pathToFileURL(join(tmp, 'js/annotations/stavenreeks.mjs')).href);
const { wapeningskorfTemplate: T } = await import(
  pathToFileURL(stageMjs('js/symbols/templates/wapeningskorf.js')).href
);

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FOUT: ${msg}`);
}
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, `${msg} (${a} != ${b}, tol ${eps})`);
}
function section(t) { console.log(`\n== ${t}`); }

// De twee referentievoorbeelden uit de opdracht.
const REF_A = {
  breedte: 350, hoogte: 400, dekking: 30,
  bovenAantal: 3, bovenDiameter: 12,
  zijAantal: 2, zijDiameter: 8,
  onderAantal: 3, onderDiameter: 12,
  beugelDiameter: 8, beugelAfstand: 250,
  naam: 'Korf A',
};
const REF_B = {
  breedte: 400, hoogte: 400, dekking: 30,
  bovenAantal: 4, bovenDiameter: 12,
  zijAantal: 2, zijDiameter: 10,
  onderAantal: 6, onderDiameter: 16,
  beugelDiameter: 8, beugelAfstand: 150,
  naam: 'Korf A',
};

// ─── 1/2/3. Staafposities ────────────────────────────────────────────────
section('Staafposities, aantallen en dekking');
for (const [naam, P] of [['REF_A 350x400', REF_A], ['REF_B 400x400', REF_B]]) {
  const L = T.layoutMm(P);
  ok(L.boven.length === P.bovenAantal, `${naam}: bovenaantal ${L.boven.length}`);
  ok(L.onder.length === P.onderAantal, `${naam}: onderaantal ${L.onder.length}`);
  ok(L.zij.length === P.zijAantal, `${naam}: zijaantal ${L.zij.length}`);

  // Gelijkmatig: alle onderlinge afstanden binnen een rij gelijk.
  for (const [rij, bars] of [['boven', L.boven], ['onder', L.onder]]) {
    if (bars.length < 3) continue;
    const gaps = bars.slice(1).map((b, i) => b.x - bars[i].x);
    const g0 = gaps[0];
    for (const g of gaps) near(g, g0, 1e-9, `${naam}: ${rij} niet gelijkmatig`);
    ok(g0 > 0, `${naam}: ${rij} oplopende x`);
  }

  // Zij: bij 2 → één links, één rechts, op halve hoogte.
  if (P.zijAantal === 2) {
    const links = L.zij.filter(b => b.side === 'left');
    const rechts = L.zij.filter(b => b.side === 'right');
    ok(links.length === 1 && rechts.length === 1, `${naam}: zij 1x links / 1x rechts`);
    const mid = (L.boven[0].y + L.onder[0].y) / 2;
    near(links[0].y, mid, 1e-9, `${naam}: zijstaaf links op halve hoogte`);
    near(rechts[0].y, mid, 1e-9, `${naam}: zijstaaf rechts op halve hoogte`);
  }

  // Binnen de beugel (dus binnen de dekking) — geen staaf steekt eruit.
  const bi = L.stirrupInner;
  for (const b of [...L.boven, ...L.onder, ...L.zij]) {
    ok(b.x - b.r >= bi.x - 1e-9 && b.x + b.r <= bi.x + bi.w + 1e-9,
      `${naam}: staaf buiten beugel in x (${b.x})`);
    ok(b.y - b.r >= bi.y - 1e-9 && b.y + b.r <= bi.y + bi.h + 1e-9,
      `${naam}: staaf buiten beugel in y (${b.y})`);
  }
  // Beugel zelf ligt exact op de dekking.
  near(L.stirrupOuter.x - L.sec.x, P.dekking, 1e-9, `${naam}: beugel op dekking`);
  near(L.stirrupInner.x - L.stirrupOuter.x, P.beugelDiameter, 1e-9, `${naam}: beugeldikte`);
  // Staven raken de binnenkant van de beugel.
  near(L.boven[0].x - L.boven[0].r, bi.x, 1e-9, `${naam}: eerste bovenstaaf tegen beugel`);
  near(L.boven[0].y - L.boven[0].r, bi.y, 1e-9, `${naam}: bovenrij tegen beugel`);
  near(L.onder[0].y + L.onder[0].r, bi.y + bi.h, 1e-9, `${naam}: onderrij tegen beugel`);

  // Geen onderlinge overlap binnen een rij.
  for (const bars of [L.boven, L.onder]) {
    for (let i = 1; i < bars.length; i++) {
      ok(bars[i].x - bars[i - 1].x >= bars[i].r + bars[i - 1].r - 1e-9,
        `${naam}: staven overlappen elkaar`);
    }
  }
}

// ─── 4. Labels + diameterteken uit stavenreeks.js ────────────────────────
section('Labels en hergebruik van het diameterteken');
{
  const L = T.layoutMm(REF_B);
  const lab = staven.labelText(REF_B.onderAantal, REF_B.onderDiameter);
  ok(lab === '6 ⌀ 16', `labeltekst onder: "${lab}"`);
  const parts = staven.labelLayout(L.labels.onder.n, L.labels.onder.d, L.font, staven.approxTextWidth);
  ok(parts.parts.map(p => p.kind).join(',') === 'text,dia,text', 'labelLayout-onderdelen');
  ok(parts.parts[0].text === '6' && parts.parts[2].text === '16', 'labelwaarden N en D');

  const cmds = T.render(REF_B, { x: 0, y: 0, width: 800, height: 800 });
  const texts = cmds.filter(c => c.kind === 'text').map(c => c.text);
  for (const t of ['4', '12', '6', '16', '2', '10', 'bgls', '8 - 150', 'Korf A', '400']) {
    ok(texts.includes(t), `render mist tekst "${t}" (aanwezig: ${texts.join('|')})`);
  }

  // Het diameterteken MOET exact de segmenten van stavenreeks.js zijn: drie
  // lijnstukken (streep + twee vlaggetjes) per teken, plus de cirkel.
  const sig = staven.diameterSignSegments(1).segments;
  ok(sig.length === 3, 'diameterSignSegments levert 3 segmenten');
  // 4 tekens (boven, zij, onder, beugel) → 4 cirkels van het teken.
  const S = Math.min(800 / L.footprint.width, 800 / L.footprint.height);
  const r = L.font * 0.22 * S;
  const signCircles = cmds.filter(c => c.kind === 'circle' && Math.abs(c.r - r) < 1e-6);
  ok(signCircles.length === 4, `4 diametertekens verwacht, ${signCircles.length} gevonden`);
  // Verhoudingen binnen het teken volgen exact de gedeelde metriek.
  const M = staven.DIAMETER_SIGN_METRICS;
  const slash = sig[0];
  const len = Math.hypot(slash.x2 - slash.x1, slash.y2 - slash.y1);
  near(len, M.slashUp + M.slashDown, 1e-9, 'streeplengte volgt de gedeelde metriek');
}

// ─── 5. realSizeMm ───────────────────────────────────────────────────────
section('realSizeMm volgt de parameters');
for (const P of [REF_A, REF_B, { ...REF_B, breedte: 250, hoogte: 600 }]) {
  const mm = T.realSizeMm(P);
  near(mm.width, P.breedte, 1e-9, 'realSizeMm.width');
  near(mm.height, P.hoogte, 1e-9, 'realSizeMm.height');
}
ok(T.fixedSize === true, 'fixedSize = true (maat komt uit de parameters)');

// ─── 6. Parameters wijzigen verplaatst de staven consistent ──────────────
section('Parameterwijzigingen verplaatsen de staven consistent');
{
  const base = T.layoutMm(REF_B);
  // Breder → dezelfde aantallen, grotere onderlinge afstand, rijen blijven
  // symmetrisch t.o.v. het hart van de doorsnede.
  const breder = T.layoutMm({ ...REF_B, breedte: 800 });
  ok(breder.onder.length === base.onder.length, 'aantal onveranderd bij breder');
  const gap = (L) => L.onder[1].x - L.onder[0].x;
  ok(gap(breder) > gap(base), 'onderlinge afstand groeit met de breedte');
  const symm = (L) => {
    const c = L.sec.x + L.breedte / 2;
    return Math.abs((L.onder[0].x - c) + (L.onder[L.onder.length - 1].x - c));
  };
  near(symm(base), 0, 1e-9, 'onderrij symmetrisch (basis)');
  near(symm(breder), 0, 1e-9, 'onderrij symmetrisch (breder)');

  // Hoger → boven/onder verder uit elkaar, x ongewijzigd.
  const hoger = T.layoutMm({ ...REF_B, hoogte: 700 });
  ok(hoger.onder[0].y - hoger.boven[0].y > base.onder[0].y - base.boven[0].y,
    'rijen schuiven uit elkaar bij grotere hoogte');
  near(hoger.boven[0].x - hoger.sec.x, base.boven[0].x - base.sec.x, 1e-9,
    'x-positie t.o.v. de doorsnede onveranderd bij hoogtewijziging');

  // Meer staven → meer punten, nog steeds gelijkmatig en zonder overlap.
  const meer = T.layoutMm({ ...REF_B, onderAantal: 8 });
  ok(meer.onder.length === 8, 'aantal volgt de parameter');
  const gaps = meer.onder.slice(1).map((b, i) => b.x - meer.onder[i].x);
  for (const g of gaps) near(g, gaps[0], 1e-9, 'gelijkmatig bij 8 staven');
  ok(gaps[0] >= 2 * meer.onder[0].r, 'geen overlap bij 8 staven ⌀16 in 400 mm');

  // Grotere dekking → staven schuiven naar binnen.
  const dik = T.layoutMm({ ...REF_B, dekking: 60 });
  ok(dik.onder[0].x - dik.sec.x > base.onder[0].x - base.sec.x, 'dekking duwt staven naar binnen');
  ok(dik.onder[0].y < base.onder[0].y, 'grotere dekking tilt de onderrij op');

  // 1 staaf → precies in het midden.
  const een = T.layoutMm({ ...REF_B, bovenAantal: 1 });
  near(een.boven[0].x, een.sec.x + een.breedte / 2, 1e-9, 'één bovenstaaf in het midden');

  // 0 staven → geen punten, geen crash.
  const geen = T.layoutMm({ ...REF_B, zijAantal: 0 });
  ok(geen.zij.length === 0, 'zijAantal 0 levert geen zijstaven');
}

// ─── 7. Render blijft binnen de bbox ─────────────────────────────────────
section('Render binnen de bbox (PDF-appearance-veilig)');
for (const [naam, P] of [['REF_A', REF_A], ['REF_B', REF_B]]) {
  const bbox = { x: 100, y: 50, width: 600, height: 400 };
  const cmds = T.render(P, bbox);
  ok(cmds.length > 20, `${naam}: render levert commando's (${cmds.length})`);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (const c of cmds) {
    if (c.kind === 'line') { acc(c.x1, c.y1); acc(c.x2, c.y2); }
    else if (c.kind === 'polyline') for (const p of c.points) acc(p.x, p.y);
    else if (c.kind === 'circle') { acc(c.cx - c.r, c.cy - c.r); acc(c.cx + c.r, c.cy + c.r); }
    else if (c.kind === 'text') {
      const half = (c.text.length * c.size * 0.55) / 2;
      acc(c.x - half, c.y - c.size * 0.6); acc(c.x + half, c.y + c.size * 0.6);
    }
  }
  const pad = 0.5;
  ok(minX >= bbox.x - pad, `${naam}: links binnen bbox (${minX} >= ${bbox.x})`);
  ok(minY >= bbox.y - pad, `${naam}: boven binnen bbox (${minY} >= ${bbox.y})`);
  ok(maxX <= bbox.x + bbox.width + pad, `${naam}: rechts binnen bbox (${maxX})`);
  ok(maxY <= bbox.y + bbox.height + pad, `${naam}: onder binnen bbox (${maxY})`);

  // Gevulde staafpunten: één gevulde polyline per staaf.
  const L = T.layoutMm(P);
  const dots = cmds.filter(c => c.kind === 'polyline' && c.fill);
  ok(dots.length === L.boven.length + L.onder.length + L.zij.length,
    `${naam}: aantal gevulde staafpunten (${dots.length})`);
}

console.log(`\n${checks - failures}/${checks} controles geslaagd`);
if (failures) {
  console.error(`${failures} FOUT(EN)`);
  process.exit(1);
}
console.log('OK — wapeningskorf');
