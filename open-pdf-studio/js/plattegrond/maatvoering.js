// Maatvoering die vastzit aan wat ze meet.
//
// Een losse maatlijn hangt nergens aan vast: verschuif de gevel en de maat
// blijft staan waar hij stond. Hier krijgt elk eindpunt van een maatlijn een
// ANKER — een verwijzing naar een object plus welk punt daarvan bedoeld is.
// Bij een herberekening worden de ankers opnieuw uitgelezen en verspringt de
// maat mee.
//
// Ontwerpregel uit #450: het anker is een HINT, nooit de enige bron van
// waarheid. Valt het object weg, dan houdt de maatlijn zijn laatste
// geometrie en meldt de herberekening dat het anker los is. Zo gaat er nooit
// een maat verloren doordat een wand verdwijnt.
//
// Anker:
//   { annotationId, punt: 'start' | 'end' | 'sparingVan' | 'sparingTot' | 'sparingHart' }
// Op een wand kan het anker ook een VLAK aanwijzen (#477): een bouwkundige
// meet vanaf het wandvlak aan de kant van de maatketting, niet vanaf de
// hartlijn.
//   { annotationId, punt: 'start' | 'end', vlak: +1 | -1, hoek?: true }
//   { annotationId, punt: 'langs', vlak: +1 | -1, afstandMm }   (een punt halverwege)
// `vlak` is de kant van de wand in haar eigen frame (n = (-u.y, u.x)). Staat
// er aan die kant een evenwijdige laag tegen (spouwmuur uit losse wanden),
// dan telt het vlak van de BUITENSTE laag. `hoek` maakt er een uiterste punt
// van een gevelketting van: het wandvlak doorgetrokken tot het vlak van de
// aansluitende wand - de buitenhoek van het gebouw, ook als het eigen
// wandstuk (getrimd) eerder stopt.
// Een maatlijn ligt `offsetMm` naast de gemeten lijn, aan de kant die
// `zijde` (+1 / -1) aanwijst. Alles in paginapunten tenzij anders vermeld.

import { wandAs, projecteer, lijnSnijpunt } from '../annotations/wand-geometrie.js';
import { maatTekstStrook } from '../annotations/maat-label.js';
import { dimensionTypeProps } from '../annotations/dimension-types.js';
import { kettingEinden } from '../annotations/maatlijn-geometrie.js';

export { kettingEinden };

const EPS = 1e-9;

/** Ankerpunten die deze module kent. */
export const ANKER_PUNTEN = Object.freeze([
  'start', 'end', 'langs', 'sparingVan', 'sparingTot', 'sparingHart',
]);

function eenheid(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  return { x: dx / len, y: dy / len, len };
}

/**
 * Dagkanten van een gehost kozijn uit zijn eigen omhullende vak: het vak is
 * de dagmaat breed en de wand diep, om het hart gedraaid over `rotation`
 * (graden). Zo hoeft de maatlijn niets van de wand te weten om de dag terug
 * te vinden — ook niet na het opslaan en opnieuw openen.
 */
export function sparingKanten(ann) {
  if (!ann || !Number.isFinite(ann.x) || !Number.isFinite(ann.width)) return null;
  const hoek = ((Number(ann.rotation) || 0) * Math.PI) / 180;
  const u = { x: Math.cos(hoek), y: Math.sin(hoek) };
  const halve = (Number(ann.width) || 0) / 2;
  const hart = { x: ann.x + halve, y: ann.y + (Number(ann.height) || 0) / 2 };
  return {
    hart,
    van: { x: hart.x - u.x * halve, y: hart.y - u.y * halve },
    tot: { x: hart.x + u.x * halve, y: hart.y + u.y * halve },
  };
}

/**
 * Los een anker op tegen de huidige toestand.
 * @param {object} anker
 * @param {Map|object} index  id → annotatie (Map of gewoon object)
 * @param {object} extra      optioneel `{ sparingen: [{ id, van, tot, hart }] }`
 *   — terugval voor een sparing die nog geen annotatie is (plannen vooraf).
 * @returns {null|{x:number,y:number}}
 */
export function ankerPunt(anker, index, extra = {}) {
  if (!anker || !anker.annotationId) return null;
  const haal = (id) => (index instanceof Map ? index.get(id) : index?.[id]);
  const ann = haal(anker.annotationId);
  switch (anker.punt) {
    case 'start':
    case 'end': {
      const eind = anker.punt === 'end';
      const x = eind ? ann?.endX : ann?.startX, y = eind ? ann?.endY : ann?.startY;
      if (!ann || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (anker.vlak !== 1 && anker.vlak !== -1) return { x, y };
      return wandvlakPunt(ann, anker.punt, anker.vlak, {
        hoek: anker.hoek === true,
        wanden: extra.wanden,
        pxPerMm: extra.pxPerMm,
        tolerantie: extra.tolerantie,
      });
    }
    case 'langs': {
      if (!ann || !Number.isFinite(ann.startX) || (anker.vlak !== 1 && anker.vlak !== -1)) return null;
      return wandvlakPunt(ann, 'langs', anker.vlak, {
        afstandMm: anker.afstandMm,
        wanden: extra.wanden,
        pxPerMm: extra.pxPerMm,
        tolerantie: extra.tolerantie,
      });
    }
    case 'sparingVan':
    case 'sparingTot':
    case 'sparingHart': {
      const veld = anker.punt === 'sparingVan' ? 'van' : anker.punt === 'sparingTot' ? 'tot' : 'hart';
      const kanten = sparingKanten(ann);
      if (kanten) return kanten[veld];
      const sp = (extra.sparingen || []).find((s) => s.id === anker.annotationId);
      return sp && sp[veld] ? { x: sp[veld].x, y: sp[veld].y } : null;
    }
    default:
      return null;
  }
}

/**
 * Geometrie van een maatlijn tussen twee punten, `offsetMm` opzij gelegd.
 * `zijde` +1 legt hem aan de +n-kant (n = (-u.y, u.x)): op het blad, met y
 * omlaag, RECHTS van de richting p1→p2; -1 aan de linkerkant.
 * @returns {null|{startX,startY,endX,endY,lengteMm}}
 */
export function maatGeometrie(p1, p2, offsetMm = 0, pxPerMm = 1, zijde = 1) {
  if (!p1 || !p2) return null;
  const u = eenheid(p2.x - p1.x, p2.y - p1.y);
  if (!u) return null;
  const k = pxPerMm > 0 ? pxPerMm : 1;
  const d = offsetMm * k * (zijde < 0 ? -1 : 1);
  const n = { x: -u.y, y: u.x };
  return {
    startX: p1.x + n.x * d, startY: p1.y + n.y * d,
    endX: p2.x + n.x * d, endY: p2.y + n.y * d,
    lengteMm: u.len / k,
  };
}

/**
 * Maatketting: opeenvolgende tussenmaten op één lijn, plus — als er meer dan
 * één tussenmaat is — een totaalmaat een regel verder naar buiten, zoals op
 * elke bouwtekening.
 *
 * @param {Array<{x,y,anker?}>} punten  minimaal twee, op volgorde
 * @returns {{ maten: Array<{startX,startY,endX,endY,lengteMm,rol,ankerStart,ankerEind}> }}
 */
export function maatketting(punten, opties = {}) {
  const pxPerMm = opties.pxPerMm > 0 ? opties.pxPerMm : 1;
  const offsetMm = opties.offsetMm ?? 500;
  const totaalOffsetMm = opties.totaalOffsetMm ?? offsetMm + 350;
  const zijde = opties.zijde < 0 ? -1 : 1;
  const punten_ = (punten || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const maten = [];
  for (let i = 0; i + 1 < punten_.length; i++) {
    const g = maatGeometrie(punten_[i], punten_[i + 1], offsetMm, pxPerMm, zijde);
    if (!g || g.lengteMm <= 0) continue;
    maten.push({
      ...g, rol: 'tussenmaat',
      ankerStart: punten_[i].anker || null,
      ankerEind: punten_[i + 1].anker || null,
      basis: { van: { x: punten_[i].x, y: punten_[i].y }, tot: { x: punten_[i + 1].x, y: punten_[i + 1].y } },
    });
  }
  // Uitloop van de maatlijn alleen aan het begin en het eind van de hele
  // ketting, niet op elk tussenpunt.
  maten.forEach((m, i) => { m.einden = kettingEinden(i, maten.length); });
  if (maten.length > 1) {
    const g = maatGeometrie(punten_[0], punten_[punten_.length - 1], totaalOffsetMm, pxPerMm, zijde);
    if (g) {
      const eerste = punten_[0], laatste = punten_[punten_.length - 1];
      maten.push({
        ...g, rol: 'totaalmaat',
        ankerStart: eerste.anker || null,
        ankerEind: laatste.anker || null,
        basis: { van: { x: eerste.x, y: eerste.y }, tot: { x: laatste.x, y: laatste.y } },
        einden: 'both',
      });
    }
  }
  return { maten };
}

/**
 * De kettingpunten van een gevel volgen uit de wandstukken zelf: elk stuk
 * levert zijn begin- en eindpunt, en het gat tussen het einde van het ene en
 * het begin van het volgende stuk IS de sparing. Zo krijg je precies de
 * maatketting van een bouwtekening — penant, dagmaat, penant — waarvan elk
 * punt aan een wand hangt. Verschuift die wand, dan verspringt de maat mee.
 *
 * @param {Array} wanden `{ id, startX, startY, endX, endY }`, op volgorde
 *   langs de loop.
 */
export function kettingUitWandstukken(wanden) {
  const punten = [];
  for (const w of wanden || []) {
    punten.push({ x: w.startX, y: w.startY, anker: { annotationId: w.id, punt: 'start' } });
    punten.push({ x: w.endX, y: w.endY, anker: { annotationId: w.id, punt: 'end' } });
  }
  return punten;
}

/**
 * Herbereken één verankerde maatlijn tegen de huidige toestand.
 * @returns {{ status: 'ongewijzigd'|'bijgewerkt'|'losgeraakt', patch?: object }}
 *   `patch` bevat alleen de gewijzigde geometrie; `losgeraakt` betekent dat
 *   (een van) de ankers niet meer bestaat — de maatlijn blijft zoals hij is.
 */
export function herberekenMaat(maat, index, opties = {}) {
  const pxPerMm = opties.pxPerMm > 0 ? opties.pxPerMm : 1;
  const extra = {
    sparingen: opties.sparingen || [],
    wanden: opties.wanden,
    pxPerMm,
    tolerantie: opties.tolerantie,
  };
  // Een eind zonder anker (een vrij toegevoegd punt) blijft op zijn plek.
  const vast = (eind) => {
    const x = eind ? maat?.leaderEndX : maat?.leaderStartX;
    const y = eind ? maat?.leaderEndY : maat?.leaderStartY;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
  const a = maat?.ankerStart ? ankerPunt(maat.ankerStart, index, extra) : vast(false);
  const b = maat?.ankerEind ? ankerPunt(maat.ankerEind, index, extra) : vast(true);
  if (!a || !b) return { status: 'losgeraakt' };
  const g = maatGeometrie(a, b, maat.offsetMm ?? 0, pxPerMm, maat.zijde ?? 1);
  if (!g) return { status: 'losgeraakt' };
  const doel = { startX: g.startX, startY: g.startY, endX: g.endX, endY: g.endY };
  // Hulplijnen (vanaf het gemeten punt naar de maatlijn) alleen bijwerken als
  // de maat ze heeft: een oude maat zonder hulplijnen krijgt er geen bij.
  if (Number.isFinite(maat.leaderStartX)) {
    Object.assign(doel, { leaderStartX: a.x, leaderStartY: a.y, leaderEndX: b.x, leaderEndY: b.y });
  }
  const zelfde = Object.keys(doel)
    .every((k) => Math.abs((maat[k] ?? NaN) - doel[k]) < 1e-6);
  if (zelfde) return { status: 'ongewijzigd' };
  return { status: 'bijgewerkt', patch: doel, lengteMm: g.lengteMm };
}

/** Herbereken een hele set verankerde maatlijnen in één keer. */
export function herberekenMaten(maten, index, opties = {}) {
  const bijgewerkt = [];
  const losgeraakt = [];
  let ongewijzigd = 0;
  for (const m of maten || []) {
    const r = herberekenMaat(m, index, opties);
    if (r.status === 'bijgewerkt') bijgewerkt.push({ id: m.id, patch: r.patch, lengteMm: r.lengteMm });
    else if (r.status === 'losgeraakt') losgeraakt.push({ id: m.id });
    else ongewijzigd++;
  }
  return { bijgewerkt, losgeraakt, ongewijzigd };
}

// ── wandvlak, buitenste laag, buitenhoek (#477) ─────────────────────────

const EVENWIJDIG = 0.035;        // sinus ~2°: lagen van een en dezelfde gevel
const HAAKS_MIN = 0.26;          // sinus ~15°: een aansluitende wand
const MAX_SPOUW_MM = 250;        // grootste gat tussen twee lagen van een gevel

function halveDiktePt(w, pxPerMm) {
  const d = Number(w?.dikteMm);
  return ((d > 0 ? d : 100) / 2) * pxPerMm;
}

function langs(p, oorsprong, u) {
  return (p.x - oorsprong.x) * u.x + (p.y - oorsprong.y) * u.y;
}

/**
 * De buitenste laag van een gevel aan kant `vlak` van wand `w`. Een laag is
 * een evenwijdige wand waarvan het binnenvlak binnen een spouw (250 mm) van
 * het huidige buitenvlak ligt en die langs de wand overlapt; zo klimt de
 * zoektocht van binnenblad over isolatie en spouw naar het metselwerk.
 * @returns {{ wand, afstand }} `afstand`: van de hartlijn van `w` tot het
 *   buitenste vlak, in pt, gemeten naar kant `vlak`.
 */
export function buitensteLaag(w, vlak, wanden, pxPerMm = 1, opties = {}) {
  const k = pxPerMm > 0 ? pxPerMm : 1;
  const as = wandAs(w);
  if (!as) return { wand: w, afstand: 0 };
  const tol = opties.tolerantie ?? 1.5;
  const maxSpouw = (opties.maxSpouwMm ?? MAX_SPOUW_MM) * k;
  const m = { x: as.n.x * vlak, y: as.n.y * vlak };
  const o = { x: w.startX, y: w.startY };
  let huidig = w;
  let afstand = halveDiktePt(w, k);
  const gezien = new Set([w]);
  for (let ronde = 0; ronde < 8; ronde++) {
    let beste = null;
    for (const x of wanden || []) {
      if (!x || gezien.has(x) || (x.id != null && x.id === w.id)) continue;
      const ax = wandAs(x);
      if (!ax || Math.abs(ax.u.x * as.u.y - ax.u.y * as.u.x) > EVENWIJDIG) continue;
      const hx = halveDiktePt(x, k);
      const d = langs({ x: x.startX, y: x.startY }, o, m);
      const spleet = d - hx - afstand;
      if (spleet < -tol || spleet > maxSpouw) continue;
      const ta = langs({ x: x.startX, y: x.startY }, o, as.u);
      const tb = langs({ x: x.endX, y: x.endY }, o, as.u);
      const overlap = Math.min(Math.max(ta, tb), as.len) - Math.max(Math.min(ta, tb), 0);
      if (overlap <= tol) continue;
      if (!beste || spleet < beste.spleet) beste = { wand: x, spleet, buitenkant: d + hx };
    }
    if (!beste) break;
    gezien.add(beste.wand);
    huidig = beste.wand;
    afstand = beste.buitenkant;
  }
  return { wand: huidig, afstand };
}

/**
 * Het uiterste punt van een gevelketting: het wandvlak (lijn door `F` langs
 * `u`) doorgetrokken tot het vlak van de wand die bij het einde van
 * `eindWand` aansluit. Loopt die wand van de maatzijde af (de gewone
 * buitenhoek), dan telt zijn VERSTE vlak; steekt hij de maatzijde in (een
 * ketting aan de binnenkant), dan zijn NABIJE vlak: de binnenhoek. Zonder
 * aansluitende wand blijft het einde van de eigen (buitenste) laag.
 */
function hoekPunt(F, u, m, e, eindWand, pxPerMm, wanden, tol) {
  // Het einde van de buitenste laag in de richting e*u (de laag kan
  // andersom getekend zijn dan de wand van het anker).
  const s = { x: eindWand.startX, y: eindWand.startY };
  const t = { x: eindWand.endX, y: eindWand.endY };
  const eindpunt = e * langs(t, s, u) >= 0 ? t : s;
  const he = halveDiktePt(eindWand, pxPerMm);
  let sigma = e * langs(eindpunt, F, u);
  let blok = Infinity;
  for (const c of wanden || []) {
    if (!c || c === eindWand || (c.id != null && c.id === eindWand.id)) continue;
    const ac = wandAs(c);
    if (!ac || Math.abs(ac.u.x * u.y - ac.u.y * u.x) < HAAKS_MIN) continue;
    const hc = halveDiktePt(c, pxPerMm);
    // Raakt de wand het einde? Afstand van het eindpunt tot zijn band.
    const pr = projecteer(eindpunt, c);
    const dt = Math.max(0, -pr.t, pr.t - ac.len);
    const dd = Math.max(0, Math.abs(pr.d) - hc);
    if (Math.hypot(dt, dd) > he + tol) continue;
    const vlakken = [];
    for (const z of [1, -1]) {
      const p = { x: c.startX + ac.n.x * z * hc, y: c.startY + ac.n.y * z * hc };
      const snij = lijnSnijpunt(F, u, p, ac.u);
      if (snij) vlakken.push(e * langs(snij, F, u));
    }
    if (!vlakken.length) continue;
    const hoeken = [
      { x: c.startX + ac.n.x * hc, y: c.startY + ac.n.y * hc },
      { x: c.startX - ac.n.x * hc, y: c.startY - ac.n.y * hc },
      { x: c.endX + ac.n.x * hc, y: c.endY + ac.n.y * hc },
      { x: c.endX - ac.n.x * hc, y: c.endY - ac.n.y * hc },
    ];
    const voorbij = Math.max(...hoeken.map((q) => langs(q, F, m)));
    if (voorbij > tol) blok = Math.min(blok, ...vlakken);
    else sigma = Math.max(sigma, ...vlakken);
  }
  if (blok < Infinity) sigma = Math.min(sigma, blok);
  return { x: F.x + u.x * e * sigma, y: F.y + u.y * e * sigma };
}

/**
 * Het punt op het wandvlak voor een vlak-anker (zie de kop van dit bestand).
 * `opties.wanden` zijn alle wanden van het blad (voor de lagen en de
 * aansluitende wand); zonder lijst telt alleen de eigen wand.
 */
export function wandvlakPunt(w, punt, vlak, opties = {}) {
  const k = opties.pxPerMm > 0 ? opties.pxPerMm : 1;
  const tol = opties.tolerantie ?? 1.5;
  const as = wandAs(w);
  let P = punt === 'end' ? { x: w.endX, y: w.endY } : { x: w.startX, y: w.startY };
  if (!as) return P;
  if (punt === 'langs') {
    // Een punt halverwege de wand: afstand (mm) vanaf het beginpunt.
    const t = (Number(opties.afstandMm) || 0) * k;
    P = { x: w.startX + as.u.x * t, y: w.startY + as.u.y * t };
  }
  const wanden = Array.isArray(opties.wanden) && opties.wanden.length ? opties.wanden : [w];
  const laag = buitensteLaag(w, vlak, wanden, k, { tolerantie: tol });
  const m = { x: as.n.x * vlak, y: as.n.y * vlak };
  const F = { x: P.x + m.x * laag.afstand, y: P.y + m.y * laag.afstand };
  if (!opties.hoek || punt === 'langs') return F;
  return hoekPunt(F, as.u, m, punt === 'end' ? 1 : -1, laag.wand, k, wanden, tol);
}

/**
 * Het anker voor een los aangewezen punt (een punt dat aan een maatketting
 * wordt toegevoegd): ligt het op een wandvlak, dan hangt het voortaan aan die
 * wand - aan een uiteinde (`start`/`end`) of ergens langs (`langs`, met de
 * afstand in mm vanaf het beginpunt). Anders null: een vrij punt.
 */
export function ankerVoorPunt(p, wanden, pxPerMm = 1, tol = 1.5) {
  const k = pxPerMm > 0 ? pxPerMm : 1;
  let beste = null;
  for (const w of wanden || []) {
    const pr = projecteer(p, w);
    if (!pr || w?.id == null) continue;
    if (pr.t < -tol || pr.t > pr.as.len + tol) continue;
    const naastVlak = Math.abs(Math.abs(pr.d) - halveDiktePt(w, k));
    if (naastVlak > tol || (beste && naastVlak >= beste.afstand)) continue;
    const vlak = pr.d >= 0 ? 1 : -1;
    let anker;
    if (Math.abs(pr.t) <= tol) anker = { annotationId: w.id, punt: 'start', vlak };
    else if (Math.abs(pr.t - pr.as.len) <= tol) anker = { annotationId: w.id, punt: 'end', vlak };
    else anker = { annotationId: w.id, punt: 'langs', vlak, afstandMm: Math.round((pr.t / k) * 10) / 10 };
    beste = { afstand: naastVlak, anker };
  }
  return beste ? beste.anker : null;
}

/**
 * De kettingpunten langs een wandloop, op het wandvlak aan de maatzijde.
 * Elk wandstuk levert zijn twee uiteinden (op volgorde langs de loop, ook als
 * het stuk andersom getekend is); het eerste en het laatste punt worden de
 * buitenhoeken van het gebouw.
 *
 * @param {Array} loop  wandstukken `{ id, startX, startY, endX, endY, dikteMm }`
 *   op volgorde langs de loop
 * @param {object} opties `{ zijde, wanden, pxPerMm, tolerantie }`: `zijde`
 *   (+1/-1) in het frame van het eerste stuk, zoals bij maatketting;
 *   `wanden` alle wanden van het blad.
 */
export function kettingLangsWandvlak(loop, opties = {}) {
  const stukken = (loop || []).filter((w) => wandAs(w));
  if (!stukken.length) return [];
  const zijde = opties.zijde < 0 ? -1 : 1;
  const run = wandAs(stukken[0]);
  const m = { x: run.n.x * zijde, y: run.n.y * zijde };
  const index = new Map();
  for (const w of [...(opties.wanden || []), ...stukken]) if (w?.id != null) index.set(w.id, w);
  const extra = { wanden: opties.wanden, pxPerMm: opties.pxPerMm, tolerantie: opties.tolerantie };
  const punten = [];
  stukken.forEach((w, i) => {
    const as = wandAs(w);
    const mee = as.u.x * run.u.x + as.u.y * run.u.y >= 0;
    const vlak = as.n.x * m.x + as.n.y * m.y >= 0 ? 1 : -1;
    const volgorde = mee ? ['start', 'end'] : ['end', 'start'];
    volgorde.forEach((punt, j) => {
      const anker = { annotationId: w.id, punt, vlak };
      if ((i === 0 && j === 0) || (i === stukken.length - 1 && j === 1)) anker.hoek = true;
      const p = ankerPunt(anker, index, extra);
      if (p) punten.push({ x: p.x, y: p.y, anker });
    });
  });
  return punten;
}

/**
 * Maatstijl voor de maatvoering van een plattegrond: het maattype 2,5 mm
 * (zwart, 7 pt tekst, open rondjes) met een dunne lijn en alleen het getal.
 */
export const PLATTEGROND_MAATSTIJL = Object.freeze({
  ...dimensionTypeProps('2.5'),
  lineWidth: 0.35,
  borderStyle: 'solid',
  opacity: 1,
  dimShowUnit: false,
  dimExtension: true,
  // Uitloop van de maatlijn voorbij de buitenste hulplijnen, en hulplijnen
  // die vrij van het wandvlak beginnen en iets doorlopen (mm op papier).
  dimLineOvershootMm: 2,
  dimExtGapMm: 1.5,
  dimExtOvershootMm: 2,
});


/**
 * Standaardafstanden van ketting en totaalmaat, in mm, gemeten vanaf het
 * wandvlak. Op 1:50 de gangbare 500 en 850; bij een kleinere schaal groeien
 * ze mee, zodat er op papier altijd een tekstregel (met markering) tussen
 * past. `offsetMm` is een opgegeven kettingafstand; de tussenruimte tot het
 * totaal volgt dan dezelfde regel.
 */
export function standaardMaatAfstanden(pxPerMm, stijl = PLATTEGROND_MAATSTIJL, offsetMm = null) {
  const k = pxPerMm > 0 ? pxPerMm : 1;
  const strookMm = maatTekstStrook(stijl) / k;
  const rond = (mm) => Math.ceil(mm / 50 - 1e-9) * 50;
  const tussenMm = Math.max(350, rond(strookMm));
  const ketting = Number.isFinite(offsetMm) ? offsetMm : Math.max(500, rond(strookMm));
  return { offsetMm: ketting, totaalOffsetMm: ketting + tussenMm };
}
