// Unit-test voor de stavenreeks-geometrie en de hoeveelheden-afleiding.
//
// Dekt de harde eisen uit docs/superpowers/specs/2026-07-22-stavenreeks-design.md:
//  * staafposities gelijkmatig verdeeld (count=1 → midden, count>=2 → incl. uiteinden)
//  * puntstraal per diameter, begrensd op [2, 9]
//  * labeltekst "N ⌀ D" met de doorstreepte-⌀ glyph
//  * hoeveelheden: totale staaflengte = count × barLengthMm (mm → m)
//  * rotatie-veiligheid: geometrie volgt UITSLUITEND uit de vier coördinaten
//  * AABB omvat poten, punten én label — en de AP-primitieven zijn er relatief aan
//
// Draaien: node scripts/test-stavenreeks.mjs

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');

// ESM-bron via temp-.mjs (het package zelf is CJS) — zelfde patroon als
// scripts/test-steel-catalog.mjs. De module is dependency-vrij.
const tmp = mkdtempSync(join(tmpdir(), 'opds-stavenreeks-'));
function stageMjs(relPath) {
  const src = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/(from\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2.mjs$3');
  const target = join(tmp, relPath).replace(/\.js$/, '.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, src);
  return target;
}
stageMjs('js/annotations/stavenreeks.js');
const S = await import(pathToFileURL(join(tmp, 'js/annotations/stavenreeks.mjs')).href);
// categories.js is puur en importeert alleen stavenreeks.js → direct testbaar.
const Q = await import(pathToFileURL(stageMjs('js/quantities/categories.js')).href);

let failures = 0;
let checks = 0;
function check(name, cond, extra) {
  checks++;
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${extra !== undefined ? ` — ${extra}` : ''}`);
  }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── 1. Staafposities gelijkmatig verdeeld ────────────────────────────────
console.log('\n1. Staafposities');
{
  const pos = S.barPositions(0, 0, 100, 0, 5);
  check('count=5 levert 5 posities', pos.length === 5, pos.length);
  check('eerste positie = startpunt', near(pos[0].x, 0) && near(pos[0].y, 0));
  check('laatste positie = eindpunt', near(pos[4].x, 100) && near(pos[4].y, 0));
  const gaps = [];
  for (let i = 1; i < pos.length; i++) gaps.push(pos[i].x - pos[i - 1].x);
  check('tussenafstanden gelijk (25)', gaps.every(g => near(g, 25)), gaps.join(','));

  const one = S.barPositions(0, 0, 100, 40, 1);
  check('count=1 → precies het midden',
    one.length === 1 && near(one[0].x, 50) && near(one[0].y, 20));

  // Schuine lijn: posities blijven gelijkmatig langs de lijn.
  const diag = S.barPositions(10, 10, 40, 50, 3);
  check('schuine lijn: middelste positie is het midden',
    near(diag[1].x, 25) && near(diag[1].y, 30));
  const d01 = Math.hypot(diag[1].x - diag[0].x, diag[1].y - diag[0].y);
  const d12 = Math.hypot(diag[2].x - diag[1].x, diag[2].y - diag[1].y);
  check('schuine lijn: gelijke onderlinge afstand', near(d01, d12), `${d01} vs ${d12}`);
}

// ── 2. Puntstraal per diameter ───────────────────────────────────────────
console.log('\n2. Puntstraal');
{
  check('⌀12 → 3.44', near(S.pointRadius(12), 3.44, 1e-9), S.pointRadius(12));
  check('⌀40 → 6.8', near(S.pointRadius(40), 6.8, 1e-9), S.pointRadius(40));
  check('⌀6 → 2.72', near(S.pointRadius(6), 2.72, 1e-9), S.pointRadius(6));
  check('ondergrens 2 (⌀0)', near(S.pointRadius(0), 2));
  check('bovengrens 9 (⌀200)', near(S.pointRadius(200), 9));
  check('monotoon stijgend over de standaardlijst',
    S.STAVENREEKS_DIAMETERS.every((d, i, arr) =>
      i === 0 || S.pointRadius(d) >= S.pointRadius(arr[i - 1])));
  check('standaarddiameters = 6..40',
    S.STAVENREEKS_DIAMETERS.join(',') === '6,8,10,12,16,20,25,32,40',
    S.STAVENREEKS_DIAMETERS.join(','));
}

// ── 3. Labeltekst "N ⌀ D" ────────────────────────────────────────────────
console.log('\n3. Labeltekst');
{
  check('5 ⌀ 16', S.labelText(5, 16) === '5 ⌀ 16', JSON.stringify(S.labelText(5, 16)));
  check('gebruikt U+2300 (doorstreepte ⌀)', S.labelText(3, 12).includes('⌀'));
  check('default-parameters → "3 ⌀ 12"', S.labelText(undefined, undefined) === '3 ⌀ 12',
    S.labelText(undefined, undefined));
  const built = S.buildStavenreeks({ startX: 0, startY: 0, endX: 100, endY: 0, count: 7, diameter: 25 });
  check('label in de opgebouwde geometrie', built.label.text === '7 ⌀ 25', built.label.text);
}

// ── 4. Hoeveelheden-afleiding ────────────────────────────────────────────
console.log('\n4. Hoeveelheden');
{
  check('5 × 2000 mm → 10 m', near(S.totalBarLengthM({ count: 5, barLengthMm: 2000 }), 10),
    S.totalBarLengthM({ count: 5, barLengthMm: 2000 }));
  check('12 × 6000 mm → 72 m', near(S.totalBarLengthM({ count: 12, barLengthMm: 6000 }), 72));
  check('onbekende staaflengte (0) → null', S.totalBarLengthM({ count: 5, barLengthMm: 0 }) === null);
  check('ontbrekende staaflengte → null', S.totalBarLengthM({ count: 5 }) === null);
  check('1 × 850 mm → 0.85 m', near(S.totalBarLengthM({ count: 1, barLengthMm: 850 }), 0.85));
}

// ── 5. Pootrichting spiegelbaar ──────────────────────────────────────────
console.log('\n5. Pootrichting');
{
  const base = { startX: 0, startY: 0, endX: 100, endY: 0, count: 3, legLength: 20 };
  const dl = S.buildStavenreeks({ ...base, legDir: 'down-left' });
  const dr = S.buildStavenreeks({ ...base, legDir: 'down-right' });
  const ul = S.buildStavenreeks({ ...base, legDir: 'up-left' });
  const ur = S.buildStavenreeks({ ...base, legDir: 'up-right' });

  // Horizontale lijn naar rechts: 'down' = +y (scherm), 'up' = -y.
  check('down-left: punt onder en naar links', dl.dots[1].y > 0 && dl.dots[1].x < 50);
  check('down-right: punt onder en naar rechts', dr.dots[1].y > 0 && dr.dots[1].x > 50);
  check('up-left: punt boven en naar links', ul.dots[1].y < 0 && ul.dots[1].x < 50);
  check('up-right: punt boven en naar rechts', ur.dots[1].y < 0 && ur.dots[1].x > 50);
  check('poot staat onder 45° (gelijke x/y-component)',
    near(Math.abs(dl.dots[1].x - 50), Math.abs(dl.dots[1].y), 1e-9));
  check('pootlengte gerespecteerd',
    near(Math.hypot(dl.legs[1].x2 - dl.legs[1].x1, dl.legs[1].y2 - dl.legs[1].y1), 20));
  check('alle 4 richtingen geldig', S.STAVENREEKS_LEG_DIRS.length === 4);
  check('onbekende richting valt terug op default',
    S.buildStavenreeks({ ...base, legDir: 'zijwaarts' }).params.legDir === 'down-left');
}

// ── 6. Rotatie-veiligheid: geometrie volgt uit de coördinaten ────────────
console.log('\n6. Rotatie-veiligheid');
{
  const ann = { startX: 0, startY: 0, endX: 100, endY: 0, count: 4, diameter: 16, legLength: 20 };
  const flat = S.buildStavenreeks(ann);
  // Dezelfde reeks, 90° gedraaid door ALLEEN de coördinaten te draaien.
  const rot = S.buildStavenreeks({ ...ann, endX: 0, endY: 100 });

  check('geen rotation-veld in de geometrie', !('rotation' in flat) && !('rotation' in flat.params));
  check('gedraaide reeks heeft evenveel punten', rot.dots.length === flat.dots.length);
  // Afstanden poot-tip ↔ bijbehorende staafpositie blijven identiek.
  const legLenFlat = flat.legs.map(l => Math.hypot(l.x2 - l.x1, l.y2 - l.y1));
  const legLenRot = rot.legs.map(l => Math.hypot(l.x2 - l.x1, l.y2 - l.y1));
  check('pootlengtes invariant onder rotatie',
    legLenFlat.every((v, i) => near(v, legLenRot[i])));
  // De AABB draait mee (breedte/hoogte wisselen ongeveer om).
  check('AABB draait mee met de coördinaten',
    rot.aabb.height > rot.aabb.width && flat.aabb.width > flat.aabb.height,
    `flat ${flat.aabb.width}x${flat.aabb.height} / rot ${rot.aabb.width}x${rot.aabb.height}`);
  // Determinisme: tweemaal bouwen geeft exact hetzelfde.
  const again = S.buildStavenreeks(ann);
  check('deterministisch', JSON.stringify(again) === JSON.stringify(flat));
}

// ── 7. AABB + AP-primitieven (persistentie-voorbereiding) ────────────────
console.log('\n7. AABB en AP-primitieven');
{
  const b = S.buildStavenreeks(
    { startX: 20, startY: 60, endX: 140, endY: 60, count: 4, diameter: 20, legLength: 24 },
    { measureText: (t, fs) => t.length * fs * 0.55 },
  );
  const { aabb } = b;
  check('AABB heeft positieve afmetingen', aabb.width > 0 && aabb.height > 0,
    `${aabb.width}x${aabb.height}`);

  // Elke punt-cirkel moet volledig binnen de AABB vallen.
  const dotsInside = b.dots.every(d =>
    d.x - d.r >= aabb.x - 1e-9 && d.x + d.r <= aabb.x + aabb.width + 1e-9 &&
    d.y - d.r >= aabb.y - 1e-9 && d.y + d.r <= aabb.y + aabb.height + 1e-9);
  check('punten (incl. straal) liggen binnen de AABB', dotsInside);

  // Poot-tips binnen de AABB.
  const legsInside = b.legs.every(l =>
    l.x2 >= aabb.x - 1e-9 && l.x2 <= aabb.x + aabb.width + 1e-9 &&
    l.y2 >= aabb.y - 1e-9 && l.y2 <= aabb.y + aabb.height + 1e-9);
  check('poot-tips liggen binnen de AABB', legsInside);

  // Het label steekt aan de labelSide buiten de reekslijn uit.
  check('AABB omvat het label (breder dan de reekslijn)',
    aabb.x + aabb.width > 140, aabb.x + aabb.width);

  // Zonder label zou de AABB smaller zijn — bewijst dat de labelbreedte meetelt.
  const wide = S.buildStavenreeks(
    { startX: 20, startY: 60, endX: 140, endY: 60, count: 4, diameter: 20, legLength: 24 },
    { measureText: () => 400 },
  );
  check('bredere labeltekst → bredere AABB', wide.aabb.width > aabb.width,
    `${wide.aabb.width} vs ${aabb.width}`);

  // AP-primitieven relatief aan de AABB: alles binnen [0..w] × [0..h].
  const local = S.toLocalPrimitives(b.primitives, aabb);
  const linesOk = local.filter(p => p.kind === 'line').every(p =>
    p.x1 >= -1e-9 && p.x1 <= aabb.width + 1e-9 && p.y1 >= -1e-9 && p.y1 <= aabb.height + 1e-9 &&
    p.x2 >= -1e-9 && p.x2 <= aabb.width + 1e-9 && p.y2 >= -1e-9 && p.y2 <= aabb.height + 1e-9);
  check('lokale lijn-primitieven vallen binnen /BBox [0 0 w h]', linesOk);
  const dotsOk = local.filter(p => p.kind === 'dot').every(p =>
    p.x >= -1e-9 && p.x <= aabb.width + 1e-9 && p.y >= -1e-9 && p.y <= aabb.height + 1e-9);
  check('lokale punt-primitieven vallen binnen /BBox', dotsOk);
  check('primitieven bevatten lijn, punten en tekst',
    local.some(p => p.kind === 'line') && local.some(p => p.kind === 'dot') &&
    local.some(p => p.kind === 'text'));
  check('aantal punt-primitieven == count',
    local.filter(p => p.kind === 'dot').length === 4);
  check('aantal lijn-primitieven == 1 reekslijn + count poten',
    local.filter(p => p.kind === 'line').length === 5);

  // flipY (PDF-assen, y omhoog) blijft eveneens binnen de BBox.
  const flipped = S.toLocalPrimitives(b.primitives, aabb, { flipY: true });
  const flipOk = flipped.filter(p => p.kind === 'dot').every(p =>
    p.y >= -1e-9 && p.y <= aabb.height + 1e-9);
  check('flipY-variant blijft binnen /BBox', flipOk);
}

// ── 8. Labelzijde ────────────────────────────────────────────────────────
console.log('\n8. Labelzijde');
{
  const g = { startX: 0, startY: 0, endX: 100, endY: 0, count: 3 };
  const atEnd = S.buildStavenreeks({ ...g, labelSide: 'end' });
  const atStart = S.buildStavenreeks({ ...g, labelSide: 'start' });
  check('labelSide=end → label voorbij het eindpunt', atEnd.label.x > 100, atEnd.label.x);
  check('labelSide=start → label voorbij het beginpunt', atStart.label.x < 0, atStart.label.x);
  check('label aan de startzijde wordt niet ondersteboven getekend',
    Math.abs(atStart.label.angle) <= Math.PI / 2 + 1e-9, atStart.label.angle);
  check('label aan de startzijde loopt fysiek naar links', atStart.label.dirX < 0);
}

// ── 9. Hoeveelheden-register (quantities/categories.js) ──────────────────
console.log('\n9. Hoeveelheden-register');
{
  const el = {
    type: 'stavenreeks', page: 2, count: 5, diameter: 16, barLengthMm: 2400,
    ifcCategory: 'IfcReinforcingBar',
    startX: 0, startY: 0, endX: 100, endY: 0, __pxPerUnit: 1,
  };
  check('stavenreeks valt in categorie line-based', Q.categoryOf(el) === 'line-based', Q.categoryOf(el));
  check('type-naam = Stavenreeks', Q.TYPE_NAMES.stavenreeks === 'Stavenreeks', Q.TYPE_NAMES.stavenreeks);

  const fields = Q.fieldsForCategories(['line-based']);
  const byKey = (k) => fields.find(f => f.key === k);
  check('veld barCount bestaat', !!byKey('barCount'));
  check('veld barDiameter bestaat', !!byKey('barDiameter'));
  check('veld barLength bestaat', !!byKey('barLength'));
  check('veld totalBarLength bestaat', !!byKey('totalBarLength'));

  check('barCount leest 5', byKey('barCount').get(el) === 5, byKey('barCount').get(el));
  check('barDiameter leest 16', byKey('barDiameter').get(el) === 16);
  check('barLength leest 2400 mm', byKey('barLength').get(el) === 2400);
  check('totale staaflengte = 5 × 2400 mm = 12 m',
    near(byKey('totalBarLength').get(el), 12), byKey('totalBarLength').get(el));
  check('totale staaflengte in meter', byKey('totalBarLength').unit === 'm');
  check('IFC-categorie uitleesbaar',
    fields.find(f => f.key === 'ifcCategory').get(el) === 'IfcReinforcingBar');

  // Gewone lijn in dezelfde categorie → wapening-velden blijven leeg.
  const plainLine = { type: 'line', startX: 0, startY: 0, endX: 50, endY: 0, __pxPerUnit: 1 };
  check('gewone lijn: barCount leeg', byKey('barCount').get(plainLine) === null);
  check('gewone lijn: totale staaflengte leeg', byKey('totalBarLength').get(plainLine) === null);
  check('gewone lijn: lengte blijft werken', near(byKey('length').get(plainLine), 50));
  check('stavenreeks: reekslijn-lengte blijft ook beschikbaar',
    near(byKey('length').get(el), 100));
}

// ── 10. Labelindeling (gedeeld door canvas én PDF-appearance) ────────────
console.log('\n10. Labelindeling');
{
  const lay = S.labelLayout(5, 16, 12);
  check('drie onderdelen: tekst, ⌀-vector, tekst', lay.parts.length === 3, lay.parts.length);
  check('eerste deel is het aantal', lay.parts[0].kind === 'text' && lay.parts[0].text === '5');
  check('middendeel is de ⌀-vector (geen glyph)', lay.parts[1].kind === 'dia');
  check('laatste deel is de diameter', lay.parts[2].kind === 'text' && lay.parts[2].text === '16');
  check('onderdelen staan in oplopende volgorde',
    lay.parts[0].dx < lay.parts[1].dx && lay.parts[1].dx < lay.parts[2].dx);
  check('totale breedte omvat het laatste deel',
    near(lay.width, lay.parts[2].dx + lay.parts[2].w), `${lay.width}`);
  check('⌀-straal positief en past in zijn vak',
    lay.signRadius > 0 && lay.signRadius * 2 <= lay.parts[1].w + 1e-9);
  check('grotere fontgrootte → breder label', S.labelLayout(5, 16, 24).width > lay.width);

  // De opgebouwde geometrie gebruikt exact deze indeling.
  const b = S.buildStavenreeks({ startX: 0, startY: 0, endX: 100, endY: 0, count: 5, diameter: 16 });
  check('geometrie gebruikt dezelfde labelbreedte', near(b.label.width, lay.width));
  check('label-onderdelen aanwezig in de geometrie', b.label.parts.length === 3);
  const txtPrim = b.primitives.find(p => p.kind === 'text');
  check('tekst-primitief draagt de onderdelen mee', Array.isArray(txtPrim.parts));
  check('startOffset 0 bij links uitgelijnd label', txtPrim.startOffset === 0);

  // Bij een label aan de startzijde (align 'right') schuift het label naar links.
  const bs = S.buildStavenreeks({ startX: 0, startY: 0, endX: 100, endY: 0, count: 5, diameter: 16, labelSide: 'start' });
  const txtS = bs.primitives.find(p => p.kind === 'text');
  check('startOffset negatief bij rechts uitgelijnd label',
    near(txtS.startOffset, -bs.label.width), txtS.startOffset);
}

// ── 11. Wapenings-diameterteken (2 vlaggetjes) ───────────────────────────
console.log('\n11. Wapeningssymbool');
{
  const fontSize = 12;
  const r = S.labelLayout(3, 12, fontSize).signRadius;
  const sign = S.diameterSignSegments(r);
  check('straal wordt doorgegeven', near(sign.r, r));
  check('drie lijnstukken: streep + 2 vlaggetjes', sign.segments.length === 3, sign.segments.length);

  const [slash, f1, f2] = sign.segments;
  const dirOf = (s) => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, m = Math.hypot(dx, dy);
    return { x: dx / m, y: dy / m, len: m };
  };
  const midOf = (s) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });

  const ds = dirOf(slash);
  check('schuine streep staat onder 45° (linksonder → rechtsboven)',
    near(ds.x, Math.SQRT1_2, 1e-9) && near(ds.y, Math.SQRT1_2, 1e-9), `${ds.x},${ds.y}`);
  check('streep steekt aan weerszijden buiten de cirkel uit',
    near(ds.len, 2 * S.DIAMETER_SIGN_METRICS.slashHalfLength * r, 1e-9) &&
    S.DIAMETER_SIGN_METRICS.slashHalfLength > 1, ds.len);
  check('streep ligt gecentreerd op het cirkelmidden',
    near(midOf(slash).x, 0, 1e-9) && near(midOf(slash).y, 0, 1e-9));

  for (const [i, fl] of [f1, f2].entries()) {
    const d = dirOf(fl);
    check(`vlaggetje ${i + 1} staat LOODRECHT op de streep`,
      near(d.x * ds.x + d.y * ds.y, 0, 1e-9), d.x * ds.x + d.y * ds.y);
    check(`vlaggetje ${i + 1} is kort (0,25–0,35 × tekengrootte)`,
      d.len >= fontSize * 0.25 && d.len <= fontSize * 0.35, d.len);
    const m = midOf(fl);
    const dist = Math.hypot(m.x, m.y);
    check(`vlaggetje ${i + 1} zit net buiten de cirkelrand`,
      dist > r + 1e-9 && dist <= r * 1.5, dist / r);
    check(`vlaggetje ${i + 1} zit op de schuine streep, niet erbuiten`,
      dist <= r * S.DIAMETER_SIGN_METRICS.slashHalfLength + 1e-9, dist);
    check(`vlaggetje ${i + 1} zit ÓP de schuine streep`,
      near(m.x * ds.y - m.y * ds.x, 0, 1e-9));
  }
  const m1 = midOf(f1), m2 = midOf(f2);
  check('vlaggetjes liggen symmetrisch aan weerszijden van de cirkel',
    near(m1.x, -m2.x, 1e-9) && near(m1.y, -m2.y, 1e-9), `${m1.x},${m1.y} vs ${m2.x},${m2.y}`);
  check('vlaggetjes zijn even lang', near(dirOf(f1).len, dirOf(f2).len, 1e-9));
  check('symbool schaalt mee met de tekengrootte',
    near(S.diameterSignSegments(2 * r).segments[1].x1, 2 * sign.segments[1].x1, 1e-9));

  // Gedeeld: dezelfde segmenten belanden in de labelindeling, de geometrie én
  // de AP-primitieven — canvas en PDF-appearance kunnen dus niet uiteenlopen.
  const lay = S.labelLayout(3, 12, fontSize);
  check('labelindeling levert de segmenten mee', Array.isArray(lay.signSegments) &&
    lay.signSegments.length === 3);
  check('labelindeling gebruikt dezelfde geometrie',
    JSON.stringify(lay.signSegments) === JSON.stringify(sign.segments));
  const bb = S.buildStavenreeks({ startX: 0, startY: 0, endX: 100, endY: 0 });
  check('geometrie draagt de segmenten mee',
    JSON.stringify(bb.label.signSegments) === JSON.stringify(sign.segments));
  const tp = bb.primitives.find(p => p.kind === 'text');
  check('tekst-primitief (AP-bron) draagt de segmenten mee',
    JSON.stringify(tp.signSegments) === JSON.stringify(sign.segments));
  const lp = S.toLocalPrimitives(bb.primitives, bb.aabb, { flipY: true })
    .find(p => p.kind === 'text');
  check('lokale AP-primitief behoudt de segmenten',
    JSON.stringify(lp.signSegments) === JSON.stringify(sign.segments));
}

// ── 12. Standaardwaarden ─────────────────────────────────────────────────
console.log('\n12. Standaardwaarden');
{
  check('standaard pootlengte = 36', S.STAVENREEKS_DEFAULTS.legLength === 36,
    S.STAVENREEKS_DEFAULTS.legLength);
  check('standaard pootlengte valt binnen het paneelbereik 1–200',
    S.STAVENREEKS_DEFAULTS.legLength >= 1 && S.STAVENREEKS_DEFAULTS.legLength <= 200);
  const d = S.buildStavenreeks({ startX: 0, startY: 0, endX: 200, endY: 0 });
  check('verse tekening gebruikt pootlengte 36',
    near(Math.hypot(d.legs[0].x2 - d.legs[0].x1, d.legs[0].y2 - d.legs[0].y1), 36),
    Math.hypot(d.legs[0].x2 - d.legs[0].x1, d.legs[0].y2 - d.legs[0].y1));
  check('poot is duidelijk langer dan de punt (zichtbaar segment)',
    36 > 4 * S.pointRadius(d.params.diameter));
  check('standaard labelzijde = end', S.STAVENREEKS_DEFAULTS.labelSide === 'end');
  check('standaard pootrichting = down-left', S.STAVENREEKS_DEFAULTS.legDir === 'down-left');
}

// ── 13. Labelvrijloop t.o.v. de poten ────────────────────────────────────
console.log('\n13. Labelvrijloop');
{
  // Referentie-opstelling: poten hellen WEG van het label (down-left + end).
  const ref = S.buildStavenreeks({ startX: 0, startY: 0, endX: 200, endY: 0 },
    { measureText: (t, fs) => t.length * fs * 0.55 });
  check('label staat net voorbij het eindpunt', ref.label.x > 200 && ref.label.x < 210,
    ref.label.x);
  check('label staat rechtop (niet op zijn kop)', near(ref.label.angle, 0));

  // Het labelvak mag geen enkele poot snijden.
  const boxClearOfLegs = (b) => {
    const half = b.label.fontSize * 0.6;
    const px = -b.label.dirY, py = b.label.dirX;
    // Het labelvak loopt FYSIEK vanaf het ankerpunt `width` ver in dirX/dirY
    // (ook bij align 'right': daar is de tekenrichting 180° gedraaid, zodat de
    // tekst vanaf het anker dezelfde kant op vult). Bemonster dat vak en meet
    // de afstand tot elk pootsegment.
    let minD = Infinity;
    for (let t = 0; t <= b.label.width; t += 1) {
      for (const s of [-half, 0, half]) {
        const X = b.label.x + b.label.dirX * t + px * s;
        const Y = b.label.y + b.label.dirY * t + py * s;
        for (const l of b.legs) {
          const vx = l.x2 - l.x1, vy = l.y2 - l.y1;
          const L2 = vx * vx + vy * vy;
          let u = L2 > 0 ? ((X - l.x1) * vx + (Y - l.y1) * vy) / L2 : 0;
          u = u < 0 ? 0 : (u > 1 ? 1 : u);
          minD = Math.min(minD, Math.hypot(X - (l.x1 + vx * u), Y - (l.y1 + vy * u)));
        }
      }
    }
    return minD;
  };
  check('referentie-opstelling: labelvak raakt geen poot', boxClearOfLegs(ref) > 0,
    boxClearOfLegs(ref));

  // Alle 4 pootrichtingen × beide labelzijden: nooit overlap, nooit op de kop.
  for (const legDir of S.STAVENREEKS_LEG_DIRS) {
    for (const labelSide of ['start', 'end']) {
      const b = S.buildStavenreeks(
        { startX: 0, startY: 0, endX: 200, endY: 0, legDir, labelSide },
        { measureText: (t, fs) => t.length * fs * 0.55 });
      check(`${legDir}/${labelSide}: labelvak vrij van de poten`, boxClearOfLegs(b) > 0.5,
        boxClearOfLegs(b));
      check(`${legDir}/${labelSide}: tekst niet op zijn kop`,
        Math.abs(b.label.angle) <= Math.PI / 2 + 1e-9, b.label.angle);
      check(`${legDir}/${labelSide}: label ligt in de AABB`,
        b.label.x >= b.aabb.x - 1e-6 && b.label.x <= b.aabb.x + b.aabb.width + 1e-6);
    }
  }

  // Ook bij een naar links getekende reeks blijft de tekst leesbaar.
  const back = S.buildStavenreeks({ startX: 200, startY: 0, endX: 0, endY: 0 });
  check('rechts-naar-links getekend: tekst niet op zijn kop',
    Math.abs(back.label.angle) <= Math.PI / 2 + 1e-9, back.label.angle);
  check('rechts-naar-links getekend: label loopt fysiek naar links', back.label.dirX < 0);
  check('rechts-naar-links getekend: label steekt voorbij het eindpunt uit',
    back.aabb.x < 0, back.aabb.x);
}

console.log(`\n${failures === 0 ? 'GESLAAGD' : 'GEFAALD'}: ${checks - failures}/${checks} controles`);
process.exit(failures === 0 ? 0 : 1);
