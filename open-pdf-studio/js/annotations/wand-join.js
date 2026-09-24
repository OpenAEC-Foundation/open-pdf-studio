// Wandjoin — wanneer sluiten twee wanden als hoek op elkaar aan? Pure module.
//
// De wandweergave (rendering/walls.js) vraagt per uiteinde van een wand naar
// een partner; met die partner worden de banden in verstek gezet. Dezelfde
// vorm gaat mee in de PDF-appearance en in de objectsnap. Deze module
// beantwoordt alleen de vraag WIE de partner is; de geometrie van het
// verstek blijft in walls.js.
//
// Drie soorten aansluiting, in deze volgorde:
//   - samenvallend: een eindpunt van de andere wand ligt binnen JOIN_TOL.
//     Dat is een bewust getekende hoek; die verstekt ongeacht materiaal.
//   - kruisend: de einden passeren elkaar net of blijven net te kort
//     (hoek-trim.js). Dat geldt alleen binnen DEZELFDE LAAG (materiaal),
//     zodat bij een spouwmuur uit losse lagen metselwerk op metselwerk
//     sluit, isolatie op isolatie en kalkzandsteen op kalkzandsteen — en een
//     laag nooit door een andere laag steekt.
//   - T: het uiteinde stopt op (of net voor, of in) een wand die aan beide
//     kanten doorloopt. Zelfde materiaal: de wanden vloeien in elkaar over
//     (geen kap, de vlaklijn van de doorgaande wand onderbroken). Ander
//     materiaal: stomp tegen het vlak van de doorgaande wand, met naadlijn.
//     De geometrie daarvan staat in wand-vorm.js.
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

/**
 * Een T vraagt een duidelijke hoek tussen de twee wanden: onder ± 11,5°
 * (sinus 0,2) is het eerder een wand die langs de andere loopt.
 */
export const T_MIN_SIN = 0.2;

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

function as(w) {
  const dx = w.endX - w.startX, dy = w.endY - w.startY;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  const u = { x: dx / len, y: dy / len };
  return { u, n: { x: -u.y, y: u.x }, len };
}

function evenwijdig(a, b) {
  const aa = as(a), ab = as(b);
  return !!aa && !!ab && Math.abs(aa.u.x * ab.u.y - aa.u.y * ab.u.x) < 1e-3;
}

/**
 * De wand die uiteinde `eind` van `w` in dezelfde richting voortzet: een
 * evenwijdige wand waarvan een eindpunt samenvalt en die de andere kant op
 * wegloopt (een wand die bij een naad in stukken is getekend). `behalve`
 * telt niet mee.
 */
export function doorlopendVia(w, eind, wanden, behalve = null) {
  const P = punt(w, eind), F = punt(w, ANDER[eind]);
  for (const q of wanden || []) {
    if (!q || isZelfde(q, w) || (behalve && isZelfde(q, behalve)) || !evenwijdig(w, q)) continue;
    for (const e of ['start', 'end']) {
      const Q = punt(q, e);
      if (Math.hypot(Q.x - P.x, Q.y - P.y) > JOIN_TOL) continue;
      const G = punt(q, ANDER[e]);
      if ((F.x - P.x) * (G.x - P.x) + (F.y - P.y) * (G.y - P.y) < 0) return q;
    }
  }
  return null;
}

/**
 * Stopt uiteinde `eind` van `w` als T op wand `o`?
 *
 * Voorwaarden: een duidelijke hoek (T_MIN_SIN); het eindpunt ligt binnen de
 * dikte van `o` of er hooguit de halve dikte van de dunste wand voor of
 * voorbij (op de hartlijn, op het vlak, net ervoor of erin: alles telt);
 * het ligt binnen de lengte van `o` (`opties.marge`, standaard JOIN_TOL);
 * het verre uiteinde van `w` ligt buiten `o`; en `o` loopt aan beide kanten
 * door. Ligt een uiteinde van `o` in de band van `w`, dan is het een hoek,
 * tenzij dat uiteinde door een evenwijdige wand wordt voortgezet.
 *
 * @returns {{wall, t:number, d:number, zijde:1|-1, vlak:{p:{x,y}, u:{x,y}},
 *   afstand:number}|null}  `zijde` = de kant van `o` (langs zijn normaal
 *   (-u.y, u.x)) waar `w` vandaan komt; `vlak` = het nabije vlak van `o`
 *   als lijn; `afstand` = afstand van het eindpunt tot dat vlak.
 */
export function tAansluiting(w, eind, o, halfW, wanden = [], opties = {}) {
  if (!w || !o || isZelfde(w, o)) return null;
  const aw = as(w), ao = as(o);
  if (!aw || !ao) return null;
  if (Math.abs(aw.u.x * ao.u.y - aw.u.y * ao.u.x) < T_MIN_SIN) return null;
  const hO = halfW(o), hW = halfW(w);
  const tol = Math.min(hO, hW);
  const P = punt(w, eind), F = punt(w, ANDER[eind]);
  const rx = P.x - o.startX, ry = P.y - o.startY;
  const t = rx * ao.u.x + ry * ao.u.y;
  const d = rx * ao.n.x + ry * ao.n.y;
  const marge = opties.marge ?? JOIN_TOL;
  if (t < -marge || t > ao.len + marge) return null;
  if (Math.abs(d) > hO + tol) return null;
  const dF = (F.x - o.startX) * ao.n.x + (F.y - o.startY) * ao.n.y;
  const zijde = dF >= 0 ? 1 : -1;
  if (zijde * dF <= hO) return null;
  for (const e of ['start', 'end']) {
    const Q = punt(o, e);
    const dq = Math.abs((Q.x - P.x) * aw.n.x + (Q.y - P.y) * aw.n.y);
    if (dq <= hW + tol && !doorlopendVia(o, e, wanden, w)) return null;
  }
  return {
    wall: o, t, d, zijde,
    vlak: { p: { x: o.startX + ao.n.x * zijde * hO, y: o.startY + ao.n.y * zijde * hO }, u: ao.u },
    afstand: Math.abs(zijde * d - hO),
  };
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
 * @returns {{wall:object, soort:'samenvallend'|'kruisend'|'T',
 *   eind?:'start'|'end', far?:{x,y}, at?:{x,y}, zelfdeLaag?:boolean,
 *   zijde?:1|-1, vlak?:{p,u}}|null}
 *   Hoek (samenvallend/kruisend): `eind` = het uiteinde van de partner,
 *   `far` = zijn verre uiteinde (de richting waarin hij wegloopt), `at`
 *   alleen bij een kruisende hoek: het hoekpunt waarheen beide banden
 *   getrimd worden. T: `vlak` = het nabije vlak van de doorgaande wand,
 *   `zelfdeLaag` bepaalt overvloeien (true) of stomp met naad (false).
 */
export function zoekJoinPartner(w, eind, wanden, halfW) {
  if (!w || !joinToegestaan(w, eind)) return null;
  const lijst = wanden || [];
  const P = punt(w, eind);

  // 1. Samenvallende eindpunten. Bij meer dan één kandidaat wint dezelfde
  //    laag, daarna de kleinste afstand. Wordt dit uiteinde door een
  //    evenwijdige wand voortgezet (een wand in stukken), dan is alleen dat
  //    stuk een partner: een dwarswand die precies op de naad stopt, is een
  //    T en wordt vanaf zijn eigen kant afgehandeld. Omgekeerd is zo'n naad
  //    voor die dwarswand geen hoek maar een T.
  const verleng = doorlopendVia(w, eind, lijst);
  const samen = samenvallend(w, eind, P, lijst).filter((k) => (verleng
    ? isZelfde(k.o, verleng)
    : (evenwijdig(w, k.o) || !doorlopendVia(k.o, k.e, lijst, w))));
  if (samen.length) {
    samen.sort((a, b) => (zelfdeLaag(w, b.o) - zelfdeLaag(w, a.o)) || (a.d - b.d));
    const k = samen[0];
    return { wall: k.o, eind: k.e, far: punt(k.o, ANDER[k.e]), soort: 'samenvallend' };
  }

  // 2. Kruisende hoek, alleen binnen de laag. Het partner-uiteinde moet vrij
  //    zijn: een hoek die daar al met samenvallende eindpunten dicht is,
  //    wordt niet door een losse wand aangesneden. En het mag geen T zijn:
  //    loopt één van beide wanden voorbij de andere door, dan stopt de
  //    andere er als T op.
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
    if (tAansluiting(w, eind, o, halfW, lijst) || tAansluiting(o, k.eind, w, halfW, lijst)) continue;
    beste = { wall: o, eind: k.eind, far: k.far, at: k.at, soort: 'kruisend', score: k.score };
  }
  if (beste) {
    const { score: _score, ...partner } = beste;
    return partner;
  }

  // 3. T: het uiteinde stopt op een doorgaande wand, elk materiaal. De
  //    wand met het nabije vlak het dichtst bij het eindpunt wint.
  let t = null;
  for (const o of lijst) {
    if (!o || isZelfde(o, w)) continue;
    const k = tAansluiting(w, eind, o, halfW, lijst);
    if (k && (!t || k.afstand < t.afstand)) t = k;
  }
  if (!t) return null;
  return { wall: t.wall, soort: 'T', zelfdeLaag: zelfdeLaag(w, t.wall), zijde: t.zijde, vlak: t.vlak };
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
