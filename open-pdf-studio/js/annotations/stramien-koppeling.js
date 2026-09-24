// Stramienkoppeling — PURE module (geen UI-, DOM- of app-state-imports; los
// testbaar onder node --test).
//
// De uiteinden van evenwijdige stramienlijnen liggen op één lijn: daar staan
// de bollen. Die uiteinden zijn aan elkaar GEKOPPELD. Versleep je het uiteinde
// van één stramienlijn, dan schuiven de gekoppelde uiteinden van de andere
// lijnen evenveel mee, elk langs zijn eigen lijn, zodat de bollen op één lijn
// blijven. Een slotje bij het uiteinde zet één uiteinde los en weer vast.
//
// VASTGELEGDE KEUZES
//  - De koppeling is PER UITEINDE en staat in de parameters van het symbool
//    (koppelBegin/koppelEinde = groeps-id, losBegin/losEinde = losgezet).
//    Zo reist hij met OPS_Params mee bij opslaan en heropenen, zonder eigen
//    opslagsleutel.
//  - 'begin' is het uiteinde aan de kant van x/y van het kader (boven bij een
//    verticale lijn, links bij een horizontale), vóór de draaiing; 'einde' is
//    de overkant. Draaiing draait beide mee om het midden van het kader.
//  - Een groep geldt per pagina. Een losgezet uiteinde houdt zijn groeps-id,
//    zodat weer vastzetten het bij dezelfde groep terugbrengt — en terug op
//    de lijn van die groep zet.
//  - Meeslepen = elk lid verlengt (of kort in) met DEZELFDE afstand langs zijn
//    eigen richting naar buiten. Bij evenwijdige lijnen blijven de bollen zo
//    op één lijn; bij niet-evenwijdige lijnen blijft de uitloop gelijk.
//  - Een hele stramienlijn verplaatsen raakt de koppeling niet: het gaat
//    alleen om de uiteinden (de lengte, de uitloop).

export const STRAMIEN_SYMBOOL = 'stramien';
export const UITEINDEN = ['begin', 'einde'];

const GROEP_PARAM = { begin: 'koppelBegin', einde: 'koppelEinde' };
const LOS_PARAM = { begin: 'losBegin', einde: 'losEinde' };

/** De parameters waarin de koppeling staat. */
export const STRAMIEN_KOPPEL_PARAMS = [
  GROEP_PARAM.begin, GROEP_PARAM.einde, LOS_PARAM.begin, LOS_PARAM.einde,
];

/** Kleinste afstand (paginapunten) waarbinnen twee uiteinden op één lijn liggen. */
export const UITLIJN_TOLERANTIE_PT = 2;
/** Daarnaast telt een kwart bolmaat mee: met de hand geplaatste bollen liggen
 *  zelden op de punt nauwkeurig, maar een halve bol ernaast is bedoeld. */
export const UITLIJN_TOLERANTIE_BOLDEEL = 0.25;
/** Hoek (graden) waarbinnen twee stramienlijnen als evenwijdig gelden. */
export const EVENWIJDIG_TOLERANTIE_GRADEN = 1;
/** Kortste lengte (paginapunten) waartoe meeslepen een lijn inkort. */
export const MIN_LENGTE_PT = 1;

const EPS = 1e-9;

const getal = (v, standaard = 0) => (Number.isFinite(Number(v)) ? Number(v) : standaard);
const pagina = (a) => a?.page ?? 1;
const zelfde = (a, b) => a === b || (a?.id != null && a.id === b?.id);

export function isStramien(ann) {
  return !!ann && ann.type === 'parametricSymbol' && ann.symbolId === STRAMIEN_SYMBOOL;
}

function isVerticaal(ann) {
  return (ann?.params?.orientation || 'verticaal') !== 'horizontaal';
}

/**
 * De as van een stramienlijn in paginaruimte.
 * @returns {{begin:{x,y}, einde:{x,y}, richting:{x,y}, midden:{x,y},
 *            lengte:number, dwars:number, verticaal:boolean}}
 *          richting = eenheidsvector van begin naar einde.
 */
export function stramienAs(ann) {
  const x = getal(ann.x), y = getal(ann.y);
  const w = getal(ann.width), h = getal(ann.height);
  const cx = x + w / 2, cy = y + h / 2;
  const verticaal = isVerticaal(ann);
  const lengte = Math.abs(verticaal ? h : w);
  const dwars = Math.abs(verticaal ? w : h);
  const lx = verticaal ? 0 : 1, ly = verticaal ? 1 : 0;
  const rad = getal(ann.rotation) * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const ux = lx * cos - ly * sin, uy = lx * sin + ly * cos;
  const half = lengte / 2;
  return {
    begin: { x: cx - ux * half, y: cy - uy * half },
    einde: { x: cx + ux * half, y: cy + uy * half },
    richting: { x: ux, y: uy },
    midden: { x: cx, y: cy },
    lengte, dwars, verticaal,
  };
}

/** Eenheidsvector die bij dit uiteinde van de lijn af naar buiten wijst. */
function naarBuiten(as, eind) {
  return eind === 'begin'
    ? { x: -as.richting.x, y: -as.richting.y }
    : { x: as.richting.x, y: as.richting.y };
}

/**
 * Verleng (d > 0) of kort in (d < 0) het uiteinde `eind` langs de eigen lijn.
 * Het andere uiteinde, de bolmaat en de draaiing blijven. Muteert het kader.
 */
export function verlengUiteinde(ann, eind, d) {
  const afstand = getal(d);
  if (!afstand) return ann;
  const as = stramienAs(ann);
  const u = naarBuiten(as, eind);
  const lengte = Math.max(EPS, as.lengte + afstand);
  const werkelijk = lengte - as.lengte;
  const cx = as.midden.x + u.x * werkelijk / 2;
  const cy = as.midden.y + u.y * werkelijk / 2;
  if (as.verticaal) {
    ann.width = as.dwars;
    ann.height = lengte;
  } else {
    ann.width = lengte;
    ann.height = as.dwars;
  }
  ann.x = cx - ann.width / 2;
  ann.y = cy - ann.height / 2;
  return ann;
}

/** Welk uiteinde verlengt deze maatgreep? null voor grepen die dat niet doen. */
export function uiteindeVanGreep(ann, greep) {
  if (!isStramien(ann) || typeof greep !== 'string') return null;
  if (isVerticaal(ann)) {
    if (greep === 't' || greep === 'tl' || greep === 'tr') return 'begin';
    if (greep === 'b' || greep === 'bl' || greep === 'br') return 'einde';
    return null;
  }
  if (greep === 'l' || greep === 'tl' || greep === 'bl') return 'begin';
  if (greep === 'r' || greep === 'tr' || greep === 'br') return 'einde';
  return null;
}

/** Hoe ver is dit uiteinde langs de eigen lijn naar buiten geschoven? */
export function uiteindeVerschuiving(orig, nieuw, eind) {
  const a0 = stramienAs(orig), a1 = stramienAs(nieuw);
  const u = naarBuiten(a0, eind);
  return (a1[eind].x - a0[eind].x) * u.x + (a1[eind].y - a0[eind].y) * u.y;
}

/** Het uiteinde dat het dichtst bij een punt ligt (rechtsklik op de lijn). */
export function dichtstbijzijndUiteinde(ann, p) {
  const as = stramienAs(ann);
  const d = (q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  return d(as.begin) <= d(as.einde) ? 'begin' : 'einde';
}

// ── Koppelingsgegevens ─────────────────────────────────────────────────────

/** @returns {{groep:string|null, los:boolean}} */
export function koppelingVan(ann, eind) {
  const p = ann?.params || {};
  const groep = p[GROEP_PARAM[eind]];
  return {
    groep: typeof groep === 'string' && groep ? groep : null,
    los: p[LOS_PARAM[eind]] === true,
  };
}

/** Zet groep en/of los van één uiteinde. Vervangt params door een nieuw object. */
export function zetKoppeling(ann, eind, { groep, los } = {}) {
  const params = { ...(ann.params || {}) };
  if (groep !== undefined) params[GROEP_PARAM[eind]] = groep || '';
  if (los !== undefined) params[LOS_PARAM[eind]] = los === true;
  ann.params = params;
  return ann;
}

/**
 * Nieuwe params voor een stramien waarvan de params in hun geheel vervangen
 * worden (MCP-brug): de koppeling van het oude object blijft staan, tenzij de
 * nieuwe params haar zelf noemen.
 */
export function bewaarKoppeling(oudeParams, nieuweParams) {
  const bewaard = {};
  for (const sleutel of STRAMIEN_KOPPEL_PARAMS) {
    if (oudeParams && sleutel in oudeParams) bewaard[sleutel] = oudeParams[sleutel];
  }
  return { ...bewaard, ...(nieuweParams || {}) };
}

/** Een groeps-id die niet met een andere groep botst. */
let _teller = 0;
export function nieuwGroepsId() {
  _teller = (_teller + 1) % 1679616;
  return `sg-${Date.now().toString(36)}${_teller.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * De andere uiteinden in dezelfde groep: zelfde pagina, niet dezelfde lijn,
 * en (tenzij ookLos) niet losgezet.
 * @returns {Array<{ann:object, eind:'begin'|'einde'}>}
 */
export function groepsleden(annotaties, ann, eind, { ookLos = false } = {}) {
  const { groep } = koppelingVan(ann, eind);
  if (!groep) return [];
  const uit = [];
  for (const a of annotaties || []) {
    if (!isStramien(a) || zelfde(a, ann) || pagina(a) !== pagina(ann)) continue;
    for (const e of UITEINDEN) {
      const k = koppelingVan(a, e);
      if (k.groep !== groep || (k.los && !ookLos)) continue;
      uit.push({ ann: a, eind: e });
    }
  }
  return uit;
}

function tolerantieVoor(ann, opties) {
  if (Number.isFinite(opties?.tolerantie)) return opties.tolerantie;
  return Math.max(UITLIJN_TOLERANTIE_PT, stramienAs(ann).dwars * UITLIJN_TOLERANTIE_BOLDEEL);
}

/**
 * Uiteinden van andere stramienlijnen op dezelfde pagina die met dit uiteinde
 * op één lijn liggen: evenwijdige lijn, zelfde kant naar buiten, en langs de
 * lijn gemeten binnen de tolerantie.
 */
export function herkenUitgelijnd(annotaties, ann, eind, opties = {}) {
  const as = stramienAs(ann);
  const u = naarBuiten(as, eind);
  const p = as[eind];
  const tol = tolerantieVoor(ann, opties);
  const cosTol = Math.cos((opties.hoekTolerantie ?? EVENWIJDIG_TOLERANTIE_GRADEN) * Math.PI / 180);
  const uit = [];
  for (const a of annotaties || []) {
    if (!isStramien(a) || zelfde(a, ann) || pagina(a) !== pagina(ann)) continue;
    const asA = stramienAs(a);
    for (const e of UITEINDEN) {
      const uA = naarBuiten(asA, e);
      if (u.x * uA.x + u.y * uA.y < cosTol) continue;
      const q = asA[e];
      const langs = (q.x - p.x) * u.x + (q.y - p.y) * u.y;
      if (Math.abs(langs) > tol) continue;
      uit.push({ ann: a, eind: e });
    }
  }
  return uit;
}

/**
 * Hoe ver moet dit uiteinde langs zijn lijn om op de lijn van de gegeven
 * uiteinden te komen? Evenwijdige leden: het gemiddelde langs de eigen lijn.
 * Anders het snijpunt met de lijn door de twee verste leden. 0 als er geen
 * lijn te bepalen valt.
 */
function verlengingNaarLijn(ann, eind, leden) {
  if (!leden.length) return 0;
  const as = stramienAs(ann);
  const u = naarBuiten(as, eind);
  const p = as[eind];
  const cosTol = Math.cos(EVENWIJDIG_TOLERANTIE_GRADEN * Math.PI / 180);
  const evenwijdig = leden.filter(l => {
    const uL = naarBuiten(stramienAs(l.ann), l.eind);
    return u.x * uL.x + u.y * uL.y >= cosTol;
  });
  if (evenwijdig.length) {
    let som = 0;
    for (const l of evenwijdig) {
      const q = stramienAs(l.ann)[l.eind];
      som += (q.x - p.x) * u.x + (q.y - p.y) * u.y;
    }
    return som / evenwijdig.length;
  }
  if (leden.length < 2) return 0;
  const punten = leden.map(l => stramienAs(l.ann)[l.eind]);
  let a = punten[0], b = punten[1], best = -1;
  for (let i = 0; i < punten.length; i++) {
    for (let j = i + 1; j < punten.length; j++) {
      const d = (punten[i].x - punten[j].x) ** 2 + (punten[i].y - punten[j].y) ** 2;
      if (d > best) { best = d; a = punten[i]; b = punten[j]; }
    }
  }
  // p + t·u snijdt a + s·(b - a)
  const vx = b.x - a.x, vy = b.y - a.y;
  const noemer = u.x * vy - u.y * vx;
  if (Math.abs(noemer) < EPS) return 0;
  return ((a.x - p.x) * vy - (a.y - p.y) * vx) / noemer;
}

// ── Los zetten en koppelen ─────────────────────────────────────────────────

/**
 * Plan om één uiteinde los te zetten (aan = false) of te koppelen (aan = true).
 * Muteert niets; pasKoppelingToe voert het uit. De aanroeper kloont
 * `plan.wijzigingen[].ann` vooraf voor de ongedaan-stap.
 *
 * Koppelen:
 *  - heeft het uiteinde een groep met andere leden: los = false en terug op
 *    de lijn van de groep;
 *  - anders: de uitgelijnde uiteinden herkennen. Hoort een van hen bij een
 *    groep, dan sluit dit uiteinde (en elk uitgelijnd uiteinde zonder groep)
 *    daarbij aan en schuift op de lijn van die groep. Zo niet, dan vormen ze
 *    samen een nieuwe groep op de lijn van dit uiteinde. Een bewust
 *    losgezet uiteinde blijft los.
 *
 * @returns {{ok:boolean, reden?:string, wijzigingen:Array<{ann, eind, groep?, los?, verlenging?}>}}
 */
export function planKoppeling(annotaties, ann, eind, aan, opties = {}) {
  if (!isStramien(ann) || !UITEINDEN.includes(eind)) {
    return { ok: false, reden: 'geen-stramien', wijzigingen: [] };
  }
  const k = koppelingVan(ann, eind);

  if (!aan) {
    if (!k.groep || k.los) return { ok: true, wijzigingen: [] };
    return { ok: true, wijzigingen: [{ ann, eind, los: true }] };
  }

  const actief = groepsleden(annotaties, ann, eind);
  if (k.groep && groepsleden(annotaties, ann, eind, { ookLos: true }).length > 0) {
    if (!k.los) return { ok: true, wijzigingen: [] };
    return {
      ok: true,
      wijzigingen: [{ ann, eind, los: false, verlenging: verlengingNaarLijn(ann, eind, actief) }],
    };
  }

  const kandidaten = herkenUitgelijnd(annotaties, ann, eind, opties);
  if (!kandidaten.length) return { ok: false, reden: 'geen-uitgelijnde-uiteinden', wijzigingen: [] };

  const metGroep = kandidaten.find(c => {
    const kc = koppelingVan(c.ann, c.eind);
    return kc.groep && !kc.los;
  });
  if (metGroep) {
    const groep = koppelingVan(metGroep.ann, metGroep.eind).groep;
    const groepAnn = { ...ann, params: { ...(ann.params || {}), [GROEP_PARAM[eind]]: groep } };
    const lijn = groepsleden(annotaties, groepAnn, eind);
    const wijzigingen = [{ ann, eind, groep, los: false, verlenging: verlengingNaarLijn(ann, eind, lijn) }];
    for (const c of kandidaten) {
      if (koppelingVan(c.ann, c.eind).groep) continue;
      wijzigingen.push({ ...c, groep, los: false, verlenging: verlengingNaarLijn(c.ann, c.eind, lijn) });
    }
    return { ok: true, wijzigingen };
  }

  const vrij = kandidaten.filter(c => !koppelingVan(c.ann, c.eind).groep);
  if (!vrij.length) return { ok: false, reden: 'geen-uitgelijnde-uiteinden', wijzigingen: [] };
  const maakId = typeof opties.nieuwGroepsId === 'function' ? opties.nieuwGroepsId : nieuwGroepsId;
  const groep = maakId();
  const wijzigingen = [{ ann, eind, groep, los: false }];
  for (const c of vrij) {
    wijzigingen.push({ ...c, groep, los: false, verlenging: verlengingNaarLijn(c.ann, c.eind, [{ ann, eind }]) });
  }
  return { ok: true, wijzigingen };
}

/** Voer een plan uit. @returns de gewijzigde annotaties (elk één keer). */
export function pasKoppelingToe(plan) {
  const geraakt = [];
  for (const w of plan?.wijzigingen || []) {
    const koppeling = {};
    if (w.groep !== undefined) koppeling.groep = w.groep;
    if (w.los !== undefined) koppeling.los = w.los;
    zetKoppeling(w.ann, w.eind, koppeling);
    if (Math.abs(getal(w.verlenging)) > EPS) verlengUiteinde(w.ann, w.eind, w.verlenging);
    if (!geraakt.includes(w.ann)) geraakt.push(w.ann);
  }
  return geraakt;
}

/** De annotaties die een plan raakt, zonder dubbelen (voor de ongedaan-stap). */
export function geraakteAnnotaties(plan) {
  const uit = [];
  for (const w of plan?.wijzigingen || []) if (!uit.includes(w.ann)) uit.push(w.ann);
  return uit;
}

/**
 * Het slotje bij een uiteinde: 'dicht' (gekoppeld), 'open' (los, of te
 * koppelen met uitgelijnde uiteinden) of null (niets om mee te koppelen).
 */
export function slotStatus(annotaties, ann, eind, opties = {}) {
  if (!isStramien(ann)) return null;
  const k = koppelingVan(ann, eind);
  if (k.groep && groepsleden(annotaties, ann, eind, { ookLos: true }).length > 0) {
    return k.los ? 'open' : 'dicht';
  }
  return herkenUitgelijnd(annotaties, ann, eind, opties).length > 0 ? 'open' : null;
}

/** Overzicht per uiteinde voor de MCP-kant (Engelse sleutels, zoals de brug). */
export function koppelingOverzicht(annotaties, ann) {
  const uiteinde = (eind) => {
    const k = koppelingVan(ann, eind);
    const status = slotStatus(annotaties, ann, eind);
    return {
      group: k.groep,
      locked: status === 'dicht',
      linkedEnds: status === 'dicht' ? groepsleden(annotaties, ann, eind).length : 0,
      canLock: status !== null,
    };
  };
  return { start: uiteinde('begin'), end: uiteinde('einde') };
}

// ── Meeslepen ──────────────────────────────────────────────────────────────

/**
 * Begin van een sleep aan een maatgreep van een stramienlijn: welke
 * gekoppelde uiteinden gaan mee? null als er niets meegaat.
 *
 * @param {object[]} annotaties  alle annotaties van het document
 * @param {object} orig  de versleepte lijn zoals hij vóór de sleep was
 * @param {string} greep  de maatgreep ('t', 'b', 'l', 'r', of een hoek)
 * @param {(a:object)=>object} kloon  kopie voor de ongedaan-stap
 * @param {{magMee?:(a:object)=>boolean}} [opties]  bijv. vergrendelde laag
 */
export function startMeeslepen(annotaties, orig, greep, kloon, opties = {}) {
  const eind = uiteindeVanGreep(orig, greep);
  if (!eind) return null;
  const k = koppelingVan(orig, eind);
  if (!k.groep || k.los) return null;
  const magMee = typeof opties.magMee === 'function' ? opties.magMee : () => true;
  const leden = groepsleden(annotaties, orig, eind)
    .filter(l => !l.ann.locked && magMee(l.ann));
  if (!leden.length) return null;
  return {
    eind,
    leden: leden.map(l => ({ ann: l.ann, eind: l.eind, orig: kloon(l.ann) })),
  };
}

function zetKader(doel, bron) {
  doel.x = bron.x;
  doel.y = bron.y;
  doel.width = bron.width;
  doel.height = bron.height;
}

/**
 * Laat de gekoppelde uiteinden de sleep van `bron` volgen. Idempotent: elk
 * lid gaat eerst terug naar zijn begintoestand. Inkorten stopt voor iedereen
 * tegelijk bij de kortste lijn, ook voor de versleepte lijn zelf.
 * @returns {number} de toegepaste verlenging
 */
export function sleepMee(sessie, origBron, bron) {
  if (!sessie) return 0;
  let d = uiteindeVerschuiving(origBron, bron, sessie.eind);
  let grens = MIN_LENGTE_PT - stramienAs(origBron).lengte;
  for (const lid of sessie.leden) grens = Math.max(grens, MIN_LENGTE_PT - stramienAs(lid.orig).lengte);
  if (d < grens) {
    verlengUiteinde(bron, sessie.eind, grens - d);
    d = grens;
  }
  for (const lid of sessie.leden) {
    zetKader(lid.ann, lid.orig);
    verlengUiteinde(lid.ann, lid.eind, d);
  }
  return d;
}

function kaderVeranderd(a, b) {
  return ['x', 'y', 'width', 'height'].some(k => Math.abs(getal(a[k]) - getal(b[k])) > EPS);
}

/**
 * De ongedaan-stap van een sleep: de versleepte lijn plus elk meegeschoven lid
 * dat echt veranderde, met hun originelen in dezelfde volgorde.
 */
export function meesleepWijzigingen(sessie, bron, origBron) {
  const huidig = [bron];
  const origineel = [origBron];
  for (const lid of sessie?.leden || []) {
    if (!kaderVeranderd(lid.ann, lid.orig)) continue;
    huidig.push(lid.ann);
    origineel.push(lid.orig);
  }
  return { huidig, origineel };
}

/** Zet alle leden terug (sleep afgebroken). */
export function herstelMeeslepen(sessie) {
  for (const lid of sessie?.leden || []) zetKader(lid.ann, lid.orig);
}
