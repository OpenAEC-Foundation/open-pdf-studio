// Een maatketting verlengen of inkorten (#477).
//
// Een ketting is een rij maatlijnen (measureDistance) op één lijn, elk van
// hulplijn tot hulplijn, eventueel met een totaalmaat een regel verder. Hier:
//   - een punt TOEVOEGEN: tussen twee hulplijnen splitst het dat segment,
//     buiten de ketting komt er een segment bij (de ketting wordt langer);
//   - een hulplijn WEGHALEN: de twee segmenten worden er één, of aan de rand
//     wordt de ketting korter;
//   - de totaalmaat (als die er is) gaat mee, en de uitloop van de maatlijn
//     staat daarna weer alleen aan begin en eind van de hele ketting.
//
// Puur: de functies geven een PLAN terug (wat er gewijzigd, gemaakt en
// verwijderd moet worden). De opdracht `app_floorplan` en het gereedschap in
// de app voeren dat plan uit, elk met hun eigen ongedaan-stap.
//
// Plan: {
//   ok, fout?,
//   wijzig: [{ id, geometrie, ankerStart?, ankerEind?, einden }],
//   nieuw:  [{ sjabloon, geometrie, ankerStart, ankerEind, einden, rol: 'chain' }],
//   weg:    [id, ...],
// }
// `geometrie` bevat startX/Y en endX/Y (de maatlijn) en, als de ketting
// hulplijnen heeft, leaderStartX/Y en leaderEndX/Y (de gemeten punten).

import { kettingEinden } from './maatlijn-geometrie.js';

export const ANKER_START_VELD = 'opsAnkerStart';
export const ANKER_EIND_VELD = 'opsAnkerEind';
export const ROL_VELD = 'opsMaatRol';
export const KETTING_VELD = 'opsKettingId';

const TOL = 0.5;               // paginapunten: zo dicht bij elkaar is hetzelfde punt

const eindig = (...v) => v.every((n) => Number.isFinite(n));

function gemeten(m, eind) {
  const lx = eind ? m.leaderEndX : m.leaderStartX;
  const ly = eind ? m.leaderEndY : m.leaderStartY;
  if (eindig(lx, ly)) return { x: lx, y: ly };
  return eind ? { x: m.endX, y: m.endY } : { x: m.startX, y: m.startY };
}

/**
 * Een ketting uit zijn maten lezen.
 * @param {Array} segmenten  de tussenmaten (volgorde en richting vrij)
 * @param {object|null} totaal  de totaalmaat, of null
 * @returns {null|{ u, o, punten: [{x,y,t,anker}], delen: [{maat, a, b}],
 *   segmenten, totaal, hulplijnen, tol }}
 */
export function leesKetting(segmenten, totaal = null, tol = TOL) {
  const segs = (segmenten || []).filter((m) => m && eindig(m.startX, m.startY, m.endX, m.endY));
  if (!segs.length) return null;
  const s0 = segs[0];
  const len = Math.hypot(s0.endX - s0.startX, s0.endY - s0.startY);
  if (len < 1e-9) return null;
  const u = { x: (s0.endX - s0.startX) / len, y: (s0.endY - s0.startY) / len };
  const o = { x: s0.startX, y: s0.startY };
  const t = (p) => (p.x - o.x) * u.x + (p.y - o.y) * u.y;
  const delen = segs.map((m) => {
    let a = { p: gemeten(m, false), t: t({ x: m.startX, y: m.startY }), anker: m[ANKER_START_VELD] ?? null };
    let b = { p: gemeten(m, true), t: t({ x: m.endX, y: m.endY }), anker: m[ANKER_EIND_VELD] ?? null };
    if (a.t > b.t) [a, b] = [b, a];
    return { maat: m, a, b };
  }).sort((x, y) => x.a.t - y.a.t);
  const punten = [];
  const voegToe = (q) => {
    const bestaand = punten.find((p) => Math.abs(p.t - q.t) <= tol);
    if (bestaand) {
      if (!bestaand.anker && q.anker) bestaand.anker = q.anker;
      return;
    }
    punten.push({ x: q.p.x, y: q.p.y, t: q.t, anker: q.anker });
  };
  for (const d of delen) { voegToe(d.a); voegToe(d.b); }
  punten.sort((p, q) => p.t - q.t);
  return {
    u, o, punten, delen,
    segmenten: delen.map((d) => d.maat),
    totaal: totaal || null,
    hulplijnen: segs.some((m) => eindig(m.leaderStartX, m.leaderStartY)),
    tol,
  };
}

function geometrie(k, A, B, lijnOorsprong = k.o) {
  const tA = (A.x - lijnOorsprong.x) * k.u.x + (A.y - lijnOorsprong.y) * k.u.y;
  const tB = (B.x - lijnOorsprong.x) * k.u.x + (B.y - lijnOorsprong.y) * k.u.y;
  const g = {
    startX: lijnOorsprong.x + k.u.x * tA, startY: lijnOorsprong.y + k.u.y * tA,
    endX: lijnOorsprong.x + k.u.x * tB, endY: lijnOorsprong.y + k.u.y * tB,
  };
  if (k.hulplijnen) Object.assign(g, { leaderStartX: A.x, leaderStartY: A.y, leaderEndX: B.x, leaderEndY: B.y });
  return g;
}

const zelfdeGetal = (a, b) => Math.abs((a ?? NaN) - b) < 1e-6;
const zelfdeAnker = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Het plan uit de nieuwe rij delen: elk deel `{ maat?, sjabloon?, A, B }`
 * (A/B: `{x, y, anker}`), op volgorde langs de ketting.
 */
function maakPlan(k, delen, weg) {
  const plan = { ok: true, wijzig: [], nieuw: [], weg: [...weg] };
  delen.forEach((d, i) => {
    const einden = kettingEinden(i, delen.length);
    const geo = geometrie(k, d.A, d.B);
    if (!d.maat) {
      plan.nieuw.push({
        sjabloon: d.sjabloon, geometrie: geo,
        ankerStart: d.A.anker ?? null, ankerEind: d.B.anker ?? null,
        einden, rol: 'chain',
      });
      return;
    }
    const m = d.maat;
    // De maat kan andersom getekend zijn: vergelijk met hoe hij nu staat.
    const omgekeerd = ((m.endX - m.startX) * k.u.x + (m.endY - m.startY) * k.u.y) < 0;
    const huidigStart = omgekeerd ? m[ANKER_EIND_VELD] : m[ANKER_START_VELD];
    const huidigEind = omgekeerd ? m[ANKER_START_VELD] : m[ANKER_EIND_VELD];
    const zelfde = !omgekeerd
      && Object.keys(geo).every((veld) => zelfdeGetal(m[veld], geo[veld]))
      && (m.dimOvershootEnds || 'both') === einden
      && zelfdeAnker(huidigStart, d.A.anker) && zelfdeAnker(huidigEind, d.B.anker);
    if (!zelfde) {
      plan.wijzig.push({ id: m.id, geometrie: geo, ankerStart: d.A.anker ?? null, ankerEind: d.B.anker ?? null, einden });
    }
  });
  // Totaalmaat: van het eerste tot het laatste punt, op zijn eigen lijn. Met
  // nog maar één segment is hij dubbel en gaat hij weg.
  const t = k.totaal;
  if (t) {
    if (delen.length < 2) {
      plan.weg.push(t.id);
    } else {
      const A = delen[0].A, B = delen[delen.length - 1].B;
      const oT = { x: t.startX, y: t.startY };
      const geo = geometrie({ ...k, hulplijnen: eindig(t.leaderStartX, t.leaderStartY) }, A, B, oT);
      const zelfde = Object.keys(geo).every((veld) => zelfdeGetal(t[veld], geo[veld]))
        && ((t.endX - t.startX) * k.u.x + (t.endY - t.startY) * k.u.y) > 0
        && zelfdeAnker(t[ANKER_START_VELD], A.anker) && zelfdeAnker(t[ANKER_EIND_VELD], B.anker);
      if (!zelfde) plan.wijzig.push({ id: t.id, geometrie: geo, ankerStart: A.anker ?? null, ankerEind: B.anker ?? null, einden: 'both' });
    }
  }
  return plan;
}

function huidigeDelen(k) {
  return k.delen.map((d) => ({
    maat: d.maat,
    A: { x: d.a.p.x, y: d.a.p.y, anker: d.a.anker },
    B: { x: d.b.p.x, y: d.b.p.y, anker: d.b.anker },
    tA: d.a.t, tB: d.b.t,
  }));
}

/**
 * Een punt aan de ketting toevoegen. `anker` (optioneel) verankert het nieuwe
 * punt, bijvoorbeeld aan het wandvlak waarop het gesnapt is.
 */
export function puntToevoegen(k, punt, anker = null) {
  if (!k || !punt || !eindig(punt.x, punt.y)) return { ok: false, fout: 'no chain or no point' };
  const tp = (punt.x - k.o.x) * k.u.x + (punt.y - k.o.y) * k.u.y;
  if (k.punten.some((p) => Math.abs(p.t - tp) <= k.tol)) {
    return { ok: false, fout: 'the chain already has a point there' };
  }
  const P = { x: punt.x, y: punt.y, anker };
  const delen = huidigeDelen(k);
  const eerste = delen[0], laatste = delen[delen.length - 1];
  if (tp < eerste.tA) {
    delen.unshift({ sjabloon: eerste.maat.id, A: P, B: eerste.A });
  } else if (tp > laatste.tB) {
    delen.push({ sjabloon: laatste.maat.id, A: laatste.B, B: P });
  } else {
    const i = delen.findIndex((d) => d.tA < tp && tp < d.tB);
    if (i < 0) return { ok: false, fout: 'the point falls in a gap of the chain' };
    const d = delen[i];
    delen.splice(i, 1, { maat: d.maat, A: d.A, B: P }, { sjabloon: d.maat.id, A: P, B: d.B });
  }
  return maakPlan(k, delen, []);
}

/** Hulplijn `index` (in `k.punten`) uit de ketting halen. */
export function puntVerwijderen(k, index) {
  if (!k || !Number.isInteger(index) || index < 0 || index >= k.punten.length) {
    return { ok: false, fout: 'no such point in the chain' };
  }
  const t = k.punten[index].t;
  const delen = huidigeDelen(k);
  const links = delen.findIndex((d) => Math.abs(d.tB - t) <= k.tol);
  const rechts = delen.findIndex((d) => Math.abs(d.tA - t) <= k.tol);
  if (links < 0 && rechts < 0) return { ok: false, fout: 'no such point in the chain' };
  if (delen.length === 1) return { ok: false, fout: 'a dimension needs two points' };
  const weg = [];
  if (links >= 0 && rechts >= 0) {
    // Tussenpunt: het linkerdeel loopt door tot het einde van het rechterdeel.
    const r = delen[rechts];
    delen[links] = { maat: delen[links].maat, A: delen[links].A, B: r.B };
    weg.push(r.maat.id);
    delen.splice(rechts, 1);
  } else {
    const i = links >= 0 ? links : rechts;
    weg.push(delen[i].maat.id);
    delen.splice(i, 1);
  }
  return maakPlan(k, delen, weg);
}

function afstandTotLijnstuk(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * Het punt van de ketting bij `p`, binnen `tol` punten; of -1. Raak is het
 * gemeten punt zelf of zijn hulplijn (van dat punt tot de maatlijn), zodat je
 * een hulplijn ook ergens halverwege kunt aanwijzen.
 */
export function puntBij(k, p, tol = 6) {
  let beste = -1, afstand = Infinity;
  (k?.punten || []).forEach((q, i) => {
    const opLijn = { x: k.o.x + k.u.x * q.t, y: k.o.y + k.u.y * q.t };
    const d = afstandTotLijnstuk(p, q, opLijn);
    if (d <= tol && d < afstand) { beste = i; afstand = d; }
  });
  return beste;
}

// Velden die een kopie van een buurmaat NIET overneemt: identiteit, meting en
// eigen tekstplek.
const NIET_KOPIEREN = new Set([
  'id', 'measureText', 'measureValue', 'measurePixels', 'textOffsetX', 'textOffsetY',
  ANKER_START_VELD, ANKER_EIND_VELD, 'createdAt', 'modifiedAt', 'selectedSub',
]);

/** De eigenschappen van een nieuw segment: de opmaak van zijn buur plus de plan-gegevens. */
export function nieuwSegment(sjabloon, n) {
  const kopie = {};
  for (const [veld, waarde] of Object.entries(sjabloon || {})) {
    // Tijdelijke velden van het scherm (hover, selectie) beginnen met '_'.
    if (!NIET_KOPIEREN.has(veld) && !veld.startsWith('_')) kopie[veld] = waarde;
  }
  return {
    ...kopie,
    ...n.geometrie,
    [ANKER_START_VELD]: n.ankerStart ?? null,
    [ANKER_EIND_VELD]: n.ankerEind ?? null,
    dimOvershootEnds: n.einden,
    [ROL_VELD]: n.rol || 'chain',
  };
}

/** De wijziging voor een bestaande maat. */
export function wijzigPatch(w) {
  return {
    ...w.geometrie,
    [ANKER_START_VELD]: w.ankerStart ?? null,
    [ANKER_EIND_VELD]: w.ankerEind ?? null,
    dimOvershootEnds: w.einden,
  };
}

/** Een plan uitvoeren op een lijst maten (zonder app): voor tests en voorbeelden. */
export function pasPlanToe(maten, plan, nieuwId) {
  const weg = new Set(plan.weg || []);
  const perId = new Map((maten || []).map((m) => [m.id, m]));
  const uit = (maten || []).filter((m) => !weg.has(m.id)).map((m) => {
    const w = (plan.wijzig || []).find((x) => x.id === m.id);
    return w ? { ...m, ...wijzigPatch(w) } : m;
  });
  for (const n of plan.nieuw || []) uit.push({ ...nieuwSegment(perId.get(n.sjabloon), n), id: nieuwId() });
  return uit;
}
