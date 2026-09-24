// Wandjoin — wanneer sluiten twee wanden als hoek op elkaar aan? Pure module.
//
// De wandweergave (rendering/walls.js) vraagt per uiteinde van een wand naar
// een partner; met die partner worden de banden in verstek gezet. Dezelfde
// vorm gaat mee in de PDF-appearance en in de objectsnap. Deze module
// beantwoordt alleen de vraag WIE de partner is; de geometrie van het
// verstek blijft in walls.js.
//
// Twee soorten aansluiting:
//   - samenvallend: een eindpunt van de andere wand ligt binnen JOIN_TOL.
//     Dat is een bewust getekende hoek; die verstekt ongeacht materiaal.
//   - kruisend: de einden passeren elkaar net of blijven net te kort
//     (hoek-trim.js). Dat geldt alleen binnen DEZELFDE LAAG (materiaal),
//     zodat bij een spouwmuur uit losse lagen metselwerk op metselwerk
//     sluit, isolatie op isolatie en kalkzandsteen op kalkzandsteen — en een
//     laag nooit door een andere laag steekt.
//
// Per uiteinde kan de join uit: `noJoinStart` / `noJoinEnd` op de wand
// (true = dit uiteinde joint nooit; ontbreekt het veld, dan mag het). Een
// join vraagt dat BEIDE uiteinden hem toestaan, zodat de partner ook niet
// in verstek gaat tegen een uiteinde dat stomp moet blijven.

import { kruisendeHoek, kruisendeHoekReik } from './hoek-trim.js';

/** Eindpunten binnen deze afstand (paginapunten) vallen samen. */
export const JOIN_TOL = 1.5;

/**
 * Reikwijdte van een kruisende hoek binnen één laag, als factor × de
 * grootste halve dikte. Ruimer dan de algemene 4× uit hoek-trim.js: de
 * lagen van een spouwmuurpakket (± 360 mm) die tot de buiten- of binnenhoek
 * van het pakket getekend zijn, liggen tot de pakketdikte van hun eigen
 * hoekpunt af. Met 8× sluit ook het binnenblad (120 mm, halve dikte 60)
 * nog bij een pakket tot ± 400 mm.
 */
export const LAAG_REIK_FACTOR = 8;

const VLAG = { start: 'noJoinStart', end: 'noJoinEnd' };

/** De laag van een wand: het materiaal; alle isolatiesoorten zijn één laag. */
export function wandLaag(w) {
  const id = w?.hatchPattern;
  if (!id || id === 'none') return 'none';
  if (id === 'isolatie' || id.startsWith('iso-')) return 'isolatie';
  return id;
}

export function zelfdeLaag(a, b) {
  return wandLaag(a) === wandLaag(b);
}

/** Mag uiteinde `eind` ('start' | 'end') van wand `w` joinen? */
export function joinToegestaan(w, eind) {
  const vlag = VLAG[eind];
  return !!vlag && w?.[vlag] !== true;
}

/**
 * Mogen uiteinde `eindA` van a en uiteinde `eindB` van b een hoek vormen?
 * `soort`: 'samenvallend' (eindpunten op elkaar) of 'kruisend'.
 */
export function magJoinen(a, eindA, b, eindB, soort) {
  if (!joinToegestaan(a, eindA) || !joinToegestaan(b, eindB)) return false;
  if (soort === 'kruisend') return zelfdeLaag(a, b);
  return true;
}

/** Zet de join van één uiteinde aan (veld weg = standaard) of uit. */
export function zetJoin(w, eind, toegestaan) {
  const vlag = VLAG[eind];
  if (!w || !vlag) return w;
  if (toegestaan) delete w[vlag];
  else w[vlag] = true;
  return w;
}

function punt(w, eind) {
  return eind === 'start' ? { x: w.startX, y: w.startY } : { x: w.endX, y: w.endY };
}

const ANDER = { start: 'end', end: 'start' };

/** Het uiteinde van `w` dat het dichtst bij punt p ligt; null zonder punt. */
export function dichtstbijzijndEind(w, p) {
  if (!w || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const dS = Math.hypot(p.x - w.startX, p.y - w.startY);
  const dE = Math.hypot(p.x - w.endX, p.y - w.endY);
  return dE < dS ? 'end' : 'start';
}

function isZelfde(a, b) {
  return a === b || (a?.id != null && a.id === b?.id);
}

/** Uiteinden van andere wanden die samenvallen met P (en mogen joinen). */
function samenvallend(w, eind, P, wanden) {
  const uit = [];
  for (const o of wanden) {
    if (!o || isZelfde(o, w)) continue;
    for (const e of ['start', 'end']) {
      const q = punt(o, e);
      const d = Math.hypot(q.x - P.x, q.y - P.y);
      if (d <= JOIN_TOL && magJoinen(w, eind, o, e, 'samenvallend')) uit.push({ o, e, d });
    }
  }
  return uit;
}

/**
 * De joinpartner van uiteinde `eind` van wand `w`.
 *
 * @param {object} w          de wand (startX/Y, endX/Y, hatchPattern, noJoin*)
 * @param {'start'|'end'} eind
 * @param {object[]} wanden   de wanden op dezelfde pagina (w mag erin staan)
 * @param {(w:object)=>number} halfW  halve dikte in paginapunten
 * @returns {{wall:object, eind:'start'|'end', far:{x,y}, at?:{x,y},
 *   soort:'samenvallend'|'kruisend'}|null}  `far` = het verre uiteinde van
 *   de partner (de richting waarin hij wegloopt); `at` alleen bij een
 *   kruisende hoek: het hoekpunt waarheen beide banden getrimd worden.
 */
export function zoekJoinPartner(w, eind, wanden, halfW) {
  if (!w || !joinToegestaan(w, eind)) return null;
  const lijst = wanden || [];
  const P = punt(w, eind);

  // 1. Samenvallende eindpunten. Bij meer dan één kandidaat wint dezelfde
  //    laag, daarna de kleinste afstand.
  const samen = samenvallend(w, eind, P, lijst);
  if (samen.length) {
    samen.sort((a, b) => (zelfdeLaag(w, b.o) - zelfdeLaag(w, a.o)) || (a.d - b.d));
    const k = samen[0];
    return { wall: k.o, eind: k.e, far: punt(k.o, ANDER[k.e]), soort: 'samenvallend' };
  }

  // 2. Kruisende hoek, alleen binnen de laag. Het partner-uiteinde moet vrij
  //    zijn: een hoek die daar al met samenvallende eindpunten dicht is,
  //    wordt niet door een losse wand aangesneden.
  const eigenVer = punt(w, ANDER[eind]);
  const eigenHalf = halfW(w);
  let beste = null;
  for (const o of lijst) {
    if (!o || isZelfde(o, w) || !zelfdeLaag(w, o)) continue;
    const k = kruisendeHoek(
      P, eigenVer,
      { x: o.startX, y: o.startY }, { x: o.endX, y: o.endY },
      eigenHalf, halfW(o), { reikFactor: LAAG_REIK_FACTOR },
    );
    if (!k || (beste && k.score >= beste.score)) continue;
    if (!magJoinen(w, eind, o, k.eind, 'kruisend')) continue;
    if (samenvallend(o, k.eind, punt(o, k.eind), lijst.filter((q) => !isZelfde(q, w))).length) continue;
    beste = { wall: o, eind: k.eind, far: k.far, at: k.at, soort: 'kruisend', score: k.score };
  }
  if (!beste) return null;
  const { score: _score, ...partner } = beste;
  return partner;
}

// ── hoek trimmen ──────────────────────────────────────────────────────────

function snijpuntHartlijnen(a, b) {
  const d1 = { x: a.endX - a.startX, y: a.endY - a.startY };
  const d2 = { x: b.endX - b.startX, y: b.endY - b.startY };
  const l1 = Math.hypot(d1.x, d1.y), l2 = Math.hypot(d2.x, d2.y);
  if (l1 < 1e-9 || l2 < 1e-9) return null;
  const noemer = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(noemer) < 1e-9 * l1 * l2) return null;           // evenwijdig
  const t = ((b.startX - a.startX) * d2.y - (b.startY - a.startY) * d2.x) / noemer;
  return { x: a.startX + d1.x * t, y: a.startY + d1.y * t };
}

function dichtstBij(w, X) {
  const dS = Math.hypot(X.x - w.startX, X.y - w.startY);
  const dE = Math.hypot(X.x - w.endX, X.y - w.endY);
  return dE < dS ? { eind: 'end', d: dE } : { eind: 'start', d: dS };
}

/**
 * "Hoek trimmen": welke uiteinden verschuiven naar welk hoekpunt?
 *
 * Per paar wanden verschuift van elke wand het uiteinde dat het dichtst bij
 * het snijpunt van de hartlijnen ligt naar dat snijpunt (inkorten of
 * verlengen). Daarna vallen de eindpunten samen en verstekt de weergave de
 * hoek zelf. Omdat steeds het dichtstbijzijnde uiteinde verschuift, blijft
 * de wand dezelfde kant op wijzen.
 *
 *  - Precies twee wanden: dat paar, ongeacht materiaal of afstand — de
 *    gebruiker heeft ze zelf gekozen.
 *  - Meer wanden (bijvoorbeeld het hele pakket van twee gevels): alleen
 *    paren van dezelfde laag binnen de laag-reikwijdte, beste eerst, elk
 *    uiteinde hooguit één keer.
 *
 * @returns {Array<{id, eind:'start'|'end', x:number, y:number}>}
 */
export function hoekTrimPlan(wanden, halfW) {
  const lijst = (wanden || []).filter((w) => w
    && [w.startX, w.startY, w.endX, w.endY].every(Number.isFinite));
  const twee = lijst.length === 2;
  const kandidaten = [];
  for (let i = 0; i < lijst.length; i++) {
    for (let j = i + 1; j < lijst.length; j++) {
      const a = lijst[i], b = lijst[j];
      if (!twee && !zelfdeLaag(a, b)) continue;
      const X = snijpuntHartlijnen(a, b);
      if (!X) continue;
      const na = dichtstBij(a, X), nb = dichtstBij(b, X);
      if (!twee) {
        const reik = kruisendeHoekReik(halfW(a), halfW(b), LAAG_REIK_FACTOR);
        if (na.d > reik || nb.d > reik) continue;
      }
      kandidaten.push({ a, ea: na.eind, b, eb: nb.eind, X, score: na.d + nb.d });
    }
  }
  kandidaten.sort((p, q) => p.score - q.score);
  const bezet = new Set();
  const plan = [];
  for (const k of kandidaten) {
    const sa = `${k.a.id}:${k.ea}`, sb = `${k.b.id}:${k.eb}`;
    if (bezet.has(sa) || bezet.has(sb)) continue;
    bezet.add(sa); bezet.add(sb);
    plan.push({ id: k.a.id, eind: k.ea, x: k.X.x, y: k.X.y });
    plan.push({ id: k.b.id, eind: k.eb, x: k.X.x, y: k.X.y });
  }
  return plan;
}

/**
 * Voer de zetten uit het plan uit op één wand (muteert). Een getrimd
 * uiteinde krijgt de join weer aan: hoek trimmen vraagt om een nette hoek.
 * Geeft true als er iets veranderde.
 */
export function pasTrimToe(w, plan) {
  let geraakt = false;
  for (const z of plan || []) {
    if (!w || z.id !== w.id) continue;
    if (z.eind === 'start') { w.startX = z.x; w.startY = z.y; }
    else { w.endX = z.x; w.endY = z.y; }
    zetJoin(w, z.eind, true);
    geraakt = true;
  }
  return geraakt;
}
