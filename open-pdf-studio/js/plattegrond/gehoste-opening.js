// Gehoste openingen (#1229): een deur of raam hoort bij zijn wand.
//
// De wand is één annotatie met een lijst `openingen` (zie
// annotations/wand-openingen.js); het kozijn blijft een eigen annotatie
// (parametricSymbol door/window) en wijst terug met params.hostWallId. Beide
// kanten moeten kloppen: een kozijn is alleen gehost als zijn wand het ook
// in haar lijst heeft. Een kopie van een kozijn, of een kozijn uit een ouder
// bestand (wand in stukken geknipt), is dus gewoon een los symbool.
//
// Wie is de baas over wat:
//   - de PLAATS langs de wand (afstandMm) staat in de wand; het symbool
//     draagt een kopie (params.hostAfstandMm);
//   - de BREEDTE komt van het symbool (params.width), de wand volgt;
//   - de draaizijde staat in de wand (zijde).
// Het vak van een gehost kozijn (x, y, maat, rotatie) volgt daar altijd
// volledig uit: het staat nooit "ongeveer" op de wand.
//
// Deze module rekent alleen en kent geen app-state. Ze krijgt de
// annotatielijst en `pxPerMmVan(wand)` (paginapunten per werkelijke mm, de
// schaal op het beginpunt van de wand, zoals de wandweergave).
//
//   hostingNaCommando(cmd, annotaties, pxPerMmVan)
//     een stap die net is uitgevoerd en in de undo-geschiedenis komt. Zet de
//     andere kant goed en geeft de extra stappen terug die bij dezelfde
//     ongedaan-stap horen.
//   hostingLive(bewegend, annotaties, pxPerMmVan)
//     tijdens het slepen: kozijnen lopen meteen mee, zonder geschiedenis.
//   herstelHosting(annotaties, pxPerMmVan)
//     alle koppelingen van een document nalopen.

import { wandAs, projecteer } from '../annotations/wand-geometrie.js';
import { kozijnIndeling, vakOffsetMm } from './kozijn.js';
import {
  wandOpeningen, pasOpeningenIn, klemAfstandMm, nieuweOpeningSleutel, SOORT_VAN_SYMBOOL,
} from '../annotations/wand-openingen.js';

const EPS = 1e-6;

function getal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function kloon(a) {
  return JSON.parse(JSON.stringify(a));
}

function dikteMm(wand) {
  const d = getal(wand?.dikteMm);
  return d > 0 ? d : 100;
}

function paginaVan(a) {
  return a?.page ?? 1;
}

/** Een deur- of raamsymbool? */
export function isKozijnSymbool(a) {
  return a?.type === 'parametricSymbol' && (a.symbolId === 'door' || a.symbolId === 'window');
}

function indexVan(annotaties) {
  const perId = new Map();
  for (const a of annotaties || []) if (a && a.id != null && !perId.has(a.id)) perId.set(a.id, a);
  return perId;
}

/**
 * De wand waar dit kozijn bij hoort, of null. `perId`: Map id -> annotatie.
 * Beide kanten moeten naar elkaar wijzen, op dezelfde pagina.
 */
export function gehosteWand(symbool, perId) {
  if (!isKozijnSymbool(symbool)) return null;
  const wand = perId.get(symbool.params?.hostWallId);
  if (!wand || wand.type !== 'wall' || paginaVan(wand) !== paginaVan(symbool)) return null;
  return (wand.openingen || []).some((o) => o && o.id === symbool.id) ? wand : null;
}

/** De opening van dit kozijn in de lijst van zijn wand. */
function openingVan(wand, id) {
  return (wand?.openingen || []).find((o) => o && o.id === id) || null;
}

function lengteMm(wand, pxPerMm) {
  const as = wandAs(wand);
  return as && pxPerMm > 0 ? as.len / pxPerMm : 0;
}

// ── plaats langs de wand ────────────────────────────────────────────────

/**
 * De plek die het dichtst bij `gewenstMm` ligt waar een opening van
 * `breedteMm` past: binnen de wand en zonder een van de `anderen` te raken.
 * Past ze nergens, dan null.
 */
export function vrijePlek(lengte, breedteMm, gewenstMm, anderen = []) {
  const L = Math.max(0, getal(lengte) ?? 0);
  const b = getal(breedteMm) ?? 0;
  if (!(b > 0) || b > L + EPS) return null;
  const bezet = (anderen || [])
    .map((o) => [o.afstandMm - o.breedteMm / 2, o.afstandMm + o.breedteMm / 2])
    .sort((p, q) => p[0] - q[0]);
  const vrij = [];
  let cursor = 0;
  for (const [van, tot] of bezet) {
    if (van > cursor) vrij.push([cursor, Math.min(van, L)]);
    cursor = Math.max(cursor, tot);
  }
  if (cursor < L) vrij.push([cursor, L]);
  const doel = getal(gewenstMm) ?? 0;
  let beste = null;
  for (const [van, tot] of vrij) {
    if (tot - van < b - EPS) continue;
    const laag = van + b / 2, hoog = Math.max(laag, tot - b / 2);
    const c = Math.min(hoog, Math.max(laag, doel));
    if (beste === null || Math.abs(c - doel) < Math.abs(beste - doel)) beste = c;
  }
  return beste;
}

/**
 * Mag hier een nieuwe opening komen? `kandidaat`: { afstandMm, breedteMm }.
 * `passend`: het hart mag opschuiven tot de opening binnen de wand valt (een
 * aangewezen punt); zonder dat moet de opgegeven plaats zelf passen.
 * @returns {{ ok: true, afstandMm: number } | { ok: false, reden: string, code: string }}
 */
export function controleerNieuweOpening(wand, kandidaat, pxPerMm, opties = {}) {
  const L = lengteMm(wand, pxPerMm);
  if (!(L > 0)) return { ok: false, code: 'wall', reden: 'wall has no length' };
  const b = getal(kandidaat?.breedteMm);
  if (!(b > 0)) return { ok: false, code: 'width', reden: 'opening width must be > 0' };
  if (b > L + EPS) return { ok: false, code: 'outside', reden: 'opening is wider than the wall' };
  let c = getal(kandidaat?.afstandMm) ?? 0;
  if (opties.passend) c = klemAfstandMm(L, b, c);
  if (c - b / 2 < -EPS || c + b / 2 > L + EPS) {
    return { ok: false, code: 'outside', reden: 'opening falls outside the wall' };
  }
  const anderen = pasOpeningenIn(L, wandOpeningen(wand));
  const raakt = anderen.some((o) => c - b / 2 < o.afstandMm + o.breedteMm / 2 - EPS
    && o.afstandMm - o.breedteMm / 2 < c + b / 2 - EPS);
  if (raakt) return { ok: false, code: 'overlap', reden: 'opening overlaps another opening in the same wall' };
  return { ok: true, afstandMm: c };
}

// ── het vak van het kozijn ──────────────────────────────────────────────

function kozijnSoort(symbolId) {
  return symbolId === 'window' ? 'raam' : 'deur';
}

function kozijnVakMm(symbolId, params, breedteMm, wandDikteMm) {
  return kozijnIndeling(kozijnSoort(symbolId), { ...params, width: breedteMm, wallThickness: wandDikteMm }).vak;
}

function assenBij(graden) {
  const r = (graden * Math.PI) / 180;
  return { ex: { x: Math.cos(r), y: Math.sin(r) }, ey: { x: -Math.sin(r), y: Math.cos(r) } };
}

/**
 * Het vak van een gehost kozijn op zijn wand: { x, y, width, height,
 * rotation }. Het symbool tekent het kozijn op ware grootte met de
 * binnenzijde bovenaan; de deur draait naar de kant van `zijde` (+1 = links
 * van de wandrichting). Zelfde afspraak als kozijnProps in mcp-plattegrond.js.
 */
export function kozijnVak(wand, opening, params, pxPerMm, symbolId) {
  const as = wandAs(wand || {});
  if (!as || !(pxPerMm > 0) || !opening) return null;
  const T = dikteMm(wand);
  const b = Number(opening.breedteMm);
  const vak = kozijnVakMm(symbolId, params, b, T);
  const wandhoek = (Math.atan2(as.u.y, as.u.x) * 180) / Math.PI;
  const rotatie = Number(opening.zijde) === -1 ? wandhoek + 180 : wandhoek;
  const { ex, ey } = assenBij(rotatie);
  const t = Number(opening.afstandMm) * pxPerMm;
  const hart = { x: wand.startX + as.u.x * t, y: wand.startY + as.u.y * t };
  const off = vakOffsetMm(vak, b / 2, T / 2);
  const cx = hart.x - (ex.x * off.dx + ey.x * off.dy) * pxPerMm;
  const cy = hart.y - (ex.y * off.dx + ey.y * off.dy) * pxPerMm;
  const width = (vak.uMax - vak.uMin) * pxPerMm;
  const height = (vak.vMax - vak.vMin) * pxPerMm;
  return { x: cx - width / 2, y: cy - height / 2, width, height, rotation: rotatie };
}

/**
 * Waar ligt het hart van de opening volgens het vak van het symbool zelf?
 * Het omgekeerde van kozijnVak: het midden van het vak, teruggerekend naar
 * het midden van het kozijn op de hartlijn van de wand.
 */
export function hartVanSymbool(symbool, pxPerMm, wandDikteMm) {
  if (!symbool || !(pxPerMm > 0)) return null;
  const b = getal(symbool.params?.width);
  if (![symbool.x, symbool.y, symbool.width, symbool.height].every(Number.isFinite) || !(b > 0)) return null;
  const T = wandDikteMm > 0 ? wandDikteMm : 100;
  const vak = kozijnVakMm(symbool.symbolId, symbool.params, b, T);
  const { ex, ey } = assenBij(Number(symbool.rotation) || 0);
  const off = vakOffsetMm(vak, b / 2, T / 2);
  const cx = symbool.x + symbool.width / 2, cy = symbool.y + symbool.height / 2;
  return {
    x: cx + (ex.x * off.dx + ey.x * off.dy) * pxPerMm,
    y: cy + (ex.y * off.dx + ey.y * off.dy) * pxPerMm,
  };
}

/** Wat het symbool moet zijn op zijn wand: het vak plus de gekoppelde params. */
function symboolDoel(wand, opening, symbool, pxPerMm) {
  const vak = kozijnVak(wand, opening, symbool.params, pxPerMm, symbool.symbolId);
  if (!vak) return null;
  return {
    ...vak,
    params: {
      ...symbool.params,
      hostWallId: wand.id,
      hostKey: opening.key,
      hostAfstandMm: opening.afstandMm,
      width: opening.breedteMm,
      dagmaatMm: opening.breedteMm,
      wallThickness: dikteMm(wand),
    },
  };
}

function zelfdeHoek(a, b) {
  const d = (((Number(a) || 0) - (Number(b) || 0)) % 360 + 540) % 360 - 180;
  return Math.abs(d) < 1e-6;
}

const KOPPEL_PARAMS = ['hostWallId', 'hostKey', 'hostAfstandMm', 'width', 'dagmaatMm', 'wallThickness'];

function staatOpDoel(symbool, doel) {
  for (const k of ['x', 'y', 'width', 'height']) {
    if (!(Math.abs((Number(symbool[k]) || 0) - doel[k]) < 1e-6)) return false;
  }
  if (!zelfdeHoek(symbool.rotation, doel.rotation)) return false;
  for (const k of KOPPEL_PARAMS) {
    const a = symbool.params?.[k], b = doel.params[k];
    if (typeof b === 'number' ? !(Math.abs((Number(a)) - b) < 1e-6) : a !== b) return false;
  }
  return true;
}

function zetOpDoel(symbool, doel) {
  if (staatOpDoel(symbool, doel)) return false;
  symbool.x = doel.x;
  symbool.y = doel.y;
  symbool.width = doel.width;
  symbool.height = doel.height;
  symbool.rotation = doel.rotation;
  symbool.params = doel.params;
  return true;
}

// ── de lijst van de wand ────────────────────────────────────────────────

function opgeschoond(o) {
  return {
    id: o.id,
    key: typeof o.key === 'string' && o.key ? o.key : nieuweOpeningSleutel(),
    afstandMm: Number(o.afstandMm),
    breedteMm: Number(o.breedteMm),
    soort: o.soort === 'raam' ? 'raam' : 'deur',
    zijde: Number(o.zijde) === -1 ? -1 : 1,
  };
}

function zelfdeLijst(a, b) {
  const x = a || [], y = b || [];
  if (x.length !== y.length) return false;
  return x.every((o, i) => o.id === y[i].id && o.key === y[i].key && o.soort === y[i].soort
    && (Number(o.zijde) === -1 ? -1 : 1) === y[i].zijde
    && Math.abs(Number(o.afstandMm) - y[i].afstandMm) < 1e-6
    && Math.abs(Number(o.breedteMm) - y[i].breedteMm) < 1e-6);
}

function zetLijst(wand, lijst) {
  if (zelfdeLijst(wand.openingen, lijst)) return false;
  if (lijst.length) wand.openingen = lijst;
  else delete wand.openingen;
  return true;
}

/**
 * De openingen van een wand die echt bij een kozijn horen: het symbool
 * bestaat, staat op dezelfde pagina en wijst terug. De breedte en de soort
 * komen van het symbool.
 */
function geldigeOpeningen(wand, perId) {
  const uit = [];
  for (const o of wand.openingen || []) {
    const s = o ? perId.get(o.id) : null;
    if (!isKozijnSymbool(s) || s.params?.hostWallId !== wand.id || paginaVan(s) !== paginaVan(wand)) continue;
    const b = getal(s.params?.width);
    if (!(getal(o.breedteMm) > 0) && !(b > 0)) continue;
    uit.push(opgeschoond({ ...o, breedteMm: b > 0 ? b : o.breedteMm, soort: SOORT_VAN_SYMBOOL[s.symbolId] }));
  }
  return uit;
}

/** Zet één opening in de lijst van de wand op een nieuwe plaats en breedte. */
function werkOpeningBij(wand, id, patch) {
  wand.openingen = (wand.openingen || []).map((o) => (o && o.id === id ? { ...o, ...patch } : o));
}

/**
 * De plaats en breedte van een kozijn op zijn wand. `verschoven`: het vak van
 * het symbool is verplaatst, dus zijn hart wordt op de wand geprojecteerd;
 * anders houdt het zijn afstand en volgt alleen de breedte.
 */
function plaatsUitSymbool(symbool, wand, pxPerMm, opening, verschoven = true) {
  const L = lengteMm(wand, pxPerMm);
  const eigen = getal(symbool.params?.width);
  let breedte = eigen > 0 ? eigen : Number(opening.breedteMm);
  let gewenst = Number(opening.afstandMm);
  const hart = verschoven ? hartVanSymbool(symbool, pxPerMm, dikteMm(wand)) : null;
  const pr = hart ? projecteer(hart, wand) : null;
  if (pr) gewenst = pr.t / pxPerMm;
  const anderen = pasOpeningenIn(L, wandOpeningen(wand).filter((o) => o.id !== symbool.id));
  let afstand = vrijePlek(L, breedte, gewenst, anderen);
  if (afstand === null) {
    // De (nieuwe) breedte past nergens: de oude breedte en plaats blijven.
    breedte = Number(opening.breedteMm);
    afstand = vrijePlek(L, breedte, Number(opening.afstandMm), anderen)
      ?? klemAfstandMm(L, breedte, Number(opening.afstandMm));
  }
  return { afstandMm: afstand, breedteMm: breedte };
}

// ── na een stap in de geschiedenis ──────────────────────────────────────

function asGewijzigd(oud, nu) {
  return ['startX', 'startY', 'endX', 'endY']
    .some((k) => Math.abs((Number(oud?.[k]) || 0) - (Number(nu?.[k]) || 0)) > 1e-9);
}

function vakGewijzigd(oud, nu) {
  if (['x', 'y', 'width', 'height'].some((k) => Math.abs((Number(oud?.[k]) || 0) - (Number(nu?.[k]) || 0)) > 1e-9)) return true;
  return !zelfdeHoek(oud?.rotation, nu?.rotation);
}

const rond = (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
function zelfdeStaat(a, b) {
  const zonderTijd = (x) => JSON.stringify({ ...x, modifiedAt: undefined }, rond);
  return zonderTijd(a) === zonderTijd(b);
}

function nu() {
  return new Date().toISOString();
}

/** De toestand van een meebewegend kozijn vóór de wand veranderde. */
function symboolVoorheen(symbool, oudeWand, pxPerMmVan) {
  const oud = kloon(symbool);
  const k = pxPerMmVan(oudeWand);
  const ingepast = pasOpeningenIn(lengteMm(oudeWand, k), wandOpeningen(oudeWand))
    .find((o) => o.id === symbool.id);
  if (!ingepast) return oud;
  const doel = symboolDoel(oudeWand, ingepast, { ...oud, params: { ...oud.params, width: ingepast.breedteMm } }, k);
  if (doel) zetOpDoel(oud, doel);
  return oud;
}

function naWijziging(items, annotaties, pxPerMmVan) {
  const perId = indexVan(annotaties);
  const inStap = new Map(items.map((it) => [it.id, it]));
  const gemuteerd = new Set();        // annotaties uit de stap die hier veranderden
  const oudeWanden = new Map();       // wanden buiten de stap: hun toestand vooraf
  const teDoen = new Set();
  const verplaatst = new Set();       // wanden waarvan de as veranderde
  const extra = [];

  for (const it of items) {
    const a = perId.get(it.id);
    if (a?.type !== 'wall') continue;
    if (!(a.openingen || []).length && !(it.oud?.openingen || []).length) continue;
    teDoen.add(a.id);
    if (asGewijzigd(it.oud, a)) verplaatst.add(a.id);
  }

  // Kozijnen uit de stap: hun nieuwe plaats langs de wand.
  for (const it of items) {
    const symbool = perId.get(it.id);
    const wand = gehosteWand(symbool, perId);
    if (!wand || verplaatst.has(wand.id)) continue;    // de wand neemt het kozijn mee
    const pxPerMm = pxPerMmVan(wand);
    if (!wandAs(wand) || !(pxPerMm > 0)) continue;
    const opening = openingVan(wand, symbool.id);
    if (!inStap.has(wand.id) && !oudeWanden.has(wand.id)) oudeWanden.set(wand.id, kloon(wand));
    // De lijst kan tijdens het slepen al zijn meegelopen: de toestand vooraf
    // volgt uit het kozijn zoals het was.
    const vooraf = oudeWanden.get(wand.id);
    const oo = vooraf ? openingVan(vooraf, symbool.id) : null;
    if (oo) {
      const a = getal(it.oud?.params?.hostAfstandMm), b = getal(it.oud?.params?.width);
      if (a !== null) oo.afstandMm = a;
      if (b > 0) oo.breedteMm = b;
    }
    const plaats = plaatsUitSymbool(symbool, wand, pxPerMm, opening, vakGewijzigd(it.oud, symbool));
    if (getal(symbool.params?.width) !== plaats.breedteMm) {
      symbool.params = { ...symbool.params, width: plaats.breedteMm };
      gemuteerd.add(symbool.id);
    }
    werkOpeningBij(wand, symbool.id, plaats);
    teDoen.add(wand.id);
  }

  // Elke geraakte wand: lijst opschonen, inpassen, kozijnen op hun plaats.
  for (const wandId of teDoen) {
    const wand = perId.get(wandId);
    const pxPerMm = wand ? pxPerMmVan(wand) : 0;
    if (!wand || !wandAs(wand) || !(pxPerMm > 0)) continue;
    const it = inStap.get(wandId);
    const lijst = pasOpeningenIn(lengteMm(wand, pxPerMm), geldigeOpeningen(wand, perId)).map(opgeschoond);
    if (zetLijst(wand, lijst) && it) gemuteerd.add(wandId);
    for (const o of lijst) {
      const symbool = perId.get(o.id);
      const doel = symboolDoel(wand, o, symbool, pxPerMm);
      if (!doel) continue;
      if (inStap.has(symbool.id)) {
        if (zetOpDoel(symbool, doel)) gemuteerd.add(symbool.id);
        continue;
      }
      // Een kozijn buiten de stap: het kan tijdens het slepen al zijn
      // meegelopen, dus zijn toestand vooraf volgt uit de wand zoals ze was.
      const oud = it ? symboolVoorheen(symbool, it.oud, pxPerMmVan) : kloon(symbool);
      zetOpDoel(symbool, doel);
      if (zelfdeStaat(oud, symbool)) continue;
      symbool.modifiedAt = nu();
      extra.push({ type: 'modifyAnnotation', id: symbool.id, oldState: oud, newState: kloon(symbool) });
    }
  }

  for (const [id, oud] of oudeWanden) {
    const wand = perId.get(id);
    if (!wand || zelfdeStaat(oud, wand)) continue;
    wand.modifiedAt = nu();
    extra.push({ type: 'modifyAnnotation', id, oldState: oud, newState: kloon(wand) });
  }
  for (const id of gemuteerd) {
    const a = perId.get(id);
    if (a) inStap.get(id).zet(kloon(a));
  }
  return extra;
}

function naVerwijderen(weg, annotaties) {
  const perId = indexVan(annotaties);
  const stapIds = new Set(weg.map((a) => a?.id));
  const wegIds = new Set(stapIds);
  const extra = [];
  const oudeWanden = new Map();
  // De plaats in de tekenvolgorde waar een meegenomen kozijn bij ongedaan
  // maken terugkomt. Op dat moment zijn de annotaties van de stap zelf nog
  // weg (de aanroeper kan ze nu al dan niet uit de lijst hebben gehaald):
  // die tellen dus niet mee.
  const plaatsZonderStap = (index) => {
    let n = 0;
    for (let i = 0; i < index; i++) if (!stapIds.has(annotaties[i]?.id)) n++;
    return n;
  };
  for (const a of weg) {
    if (a?.type === 'wall') {
      // De wand gaat weg: haar kozijnen gaan mee, in dezelfde stap.
      for (const o of a.openingen || []) {
        const symbool = o ? perId.get(o.id) : null;
        if (!isKozijnSymbool(symbool) || wegIds.has(symbool.id) || symbool.params?.hostWallId !== a.id) continue;
        const index = annotaties.indexOf(symbool);
        if (index < 0) continue;
        const terug = plaatsZonderStap(index);
        annotaties.splice(index, 1);
        wegIds.add(symbool.id);
        extra.push({ type: 'deleteAnnotation', annotation: kloon(symbool), index: terug });
      }
    } else if (isKozijnSymbool(a)) {
      // Het kozijn gaat weg: de wand sluit.
      const wand = perId.get(a.params?.hostWallId);
      if (!wand || wand.type !== 'wall' || wegIds.has(wand.id) || !openingVan(wand, a.id)) continue;
      if (annotaties.indexOf(wand) < 0) continue;
      if (!oudeWanden.has(wand.id)) oudeWanden.set(wand.id, kloon(wand));
      zetLijst(wand, (wand.openingen || []).filter((o) => o && o.id !== a.id).map(opgeschoond));
    }
  }
  for (const [id, oud] of oudeWanden) {
    const wand = perId.get(id);
    if (zelfdeStaat(oud, wand)) continue;
    wand.modifiedAt = nu();
    extra.push({ type: 'modifyAnnotation', id, oldState: oud, newState: kloon(wand) });
  }
  return extra;
}

function naToevoegen(items, annotaties) {
  const perId = indexVan(annotaties);
  const nieuw = items.map((it) => ({ it, a: perId.get(it.ann?.id) })).filter((x) => x.a);
  const gemuteerd = new Set();
  const gekoppeld = new Set();
  for (const { a: wand } of nieuw) {
    if (wand.type !== 'wall' || !(wand.openingen || []).length) continue;
    const lijst = [];
    for (const o of wand.openingen) {
      const eigen = o ? perId.get(o.id) : null;
      if (isKozijnSymbool(eigen) && eigen.params?.hostWallId === wand.id) { lijst.push(opgeschoond(o)); continue; }
      // Een kopie van de wand: haar opening hoort bij de kopie van het
      // kozijn die in dezelfde stap is toegevoegd (zelfde sleutel).
      const kopie = nieuw.map((x) => x.a).find((s) => isKozijnSymbool(s) && !gekoppeld.has(s.id)
        && typeof o?.key === 'string' && s.params?.hostKey === o.key
        && paginaVan(s) === paginaVan(wand) && !gehosteWand(s, perId));
      if (!kopie) continue;                    // geen kozijn mee: de kopie is daar dicht
      const key = nieuweOpeningSleutel();
      kopie.params = { ...kopie.params, hostWallId: wand.id, hostKey: key };
      gekoppeld.add(kopie.id);
      gemuteerd.add(kopie.id);
      lijst.push(opgeschoond({ ...o, id: kopie.id, key }));
    }
    if (zetLijst(wand, lijst)) gemuteerd.add(wand.id);
  }
  // Een losse kopie van een gehost kozijn: de wand heeft het origineel al.
  // De kopie is een los symbool en mag bij heropenen niet voor het
  // origineel worden aangezien.
  for (const { a } of nieuw) {
    if (!isKozijnSymbool(a) || !a.params?.hostKey || gehosteWand(a, perId)) continue;
    const wand = perId.get(a.params.hostWallId);
    const origineel = wand?.type === 'wall'
      ? (wand.openingen || []).find((o) => o && o.key === a.params.hostKey && o.id !== a.id)
      : null;
    if (!origineel || !perId.has(origineel.id)) continue;
    const { hostWallId: _w, hostKey: _k, hostAfstandMm: _a, ...rest } = a.params;
    a.params = rest;
    gemuteerd.add(a.id);
  }
  for (const { it, a } of nieuw) if (gemuteerd.has(a.id)) it.zet(kloon(a));
  return [];
}

/**
 * Een stap die net is uitgevoerd (de annotaties staan al in hun nieuwe
 * toestand) en nu in de undo-geschiedenis komt. Zet de andere kant van elke
 * koppeling goed, werkt de vastgelegde nieuwe toestand in `cmd` bij en geeft
 * de extra stappen terug die bij dezelfde ongedaan-stap horen.
 */
export function hostingNaCommando(cmd, annotaties, pxPerMmVan) {
  if (!cmd || !annotaties) return [];
  switch (cmd.type) {
    case 'modifyAnnotation':
      return naWijziging([{ id: cmd.id, oud: cmd.oldState, zet: (s) => { cmd.newState = s; } }], annotaties, pxPerMmVan);
    case 'bulkModify':
      return naWijziging(cmd.items.map((it) => ({ id: it.id, oud: it.oldState, zet: (s) => { it.newState = s; } })), annotaties, pxPerMmVan);
    case 'deleteAnnotation':
      return naVerwijderen([cmd.annotation], annotaties);
    case 'bulkDelete':
      return naVerwijderen(cmd.items.map((it) => it.annotation), annotaties);
    case 'addAnnotation':
      return naToevoegen([{ ann: cmd.annotation, zet: (s) => { cmd.annotation = s; } }], annotaties);
    case 'bulkAdd':
      return naToevoegen(cmd.items.map((it) => ({ ann: it.annotation, zet: (s) => { it.annotation = s; } })), annotaties);
    default:
      return [];
  }
}

// ── tijdens het slepen ──────────────────────────────────────────────────

/** De kozijnen van een wand op hun (ingepaste) plaats zetten; de lijst blijft. */
function plaatsKozijnen(wand, perId, pxPerMm) {
  let iets = false;
  for (const o of pasOpeningenIn(lengteMm(wand, pxPerMm), geldigeOpeningen(wand, perId))) {
    const symbool = perId.get(o.id);
    const doel = symboolDoel(wand, opgeschoond(o), symbool, pxPerMm);
    if (doel && zetOpDoel(symbool, doel)) iets = true;
  }
  return iets;
}

/**
 * Tijdens het slepen, rekken of draaien van `bewegend`: een kozijn schuift
 * langs zijn wand (en nergens anders heen), en de kozijnen van een bewegende
 * wand lopen mee. Niets komt in de geschiedenis; dat doet de stap aan het
 * eind (hostingNaCommando). De wand bewaart de afstand van elke opening tot
 * haar begin: wordt ze tijdens het rekken tijdelijk te kort, dan schuift het
 * kozijn alleen in beeld terug.
 * @returns {boolean} of er iets veranderde
 */
export function hostingLive(bewegend, annotaties, pxPerMmVan) {
  const perId = indexVan(annotaties);
  const ids = new Set((bewegend || []).map((a) => a?.id));
  const wanden = new Set();
  let iets = false;
  for (const a of bewegend || []) {
    if (a?.type === 'wall') {
      if ((a.openingen || []).length) wanden.add(a);
      continue;
    }
    const wand = gehosteWand(a, perId);
    if (!wand) continue;
    wanden.add(wand);
    if (ids.has(wand.id)) continue;            // samen bewegen: de wand neemt het kozijn mee
    const pxPerMm = pxPerMmVan(wand);
    if (!wandAs(wand) || !(pxPerMm > 0)) continue;
    const opening = openingVan(wand, a.id);
    const plaats = plaatsUitSymbool(a, wand, pxPerMm, opening);
    if (Math.abs(plaats.afstandMm - Number(opening.afstandMm)) > 1e-9
      || Math.abs(plaats.breedteMm - Number(opening.breedteMm)) > 1e-9) {
      werkOpeningBij(wand, a.id, plaats);
      iets = true;
    }
  }
  for (const wand of wanden) {
    const pxPerMm = pxPerMmVan(wand);
    if (wandAs(wand) && pxPerMm > 0 && plaatsKozijnen(wand, perId, pxPerMm)) iets = true;
  }
  return iets;
}

/**
 * Alle koppelingen van een annotatielijst nalopen: openingen zonder kozijn
 * vervallen, elk gehost kozijn staat op zijn plaats. Zonder geschiedenis.
 * @returns {boolean} of er iets veranderde
 */
export function herstelHosting(annotaties, pxPerMmVan) {
  const perId = indexVan(annotaties);
  let iets = false;
  for (const wand of annotaties || []) {
    if (wand?.type !== 'wall' || !(wand.openingen || []).length) continue;
    const pxPerMm = pxPerMmVan(wand);
    if (!wandAs(wand) || !(pxPerMm > 0)) continue;
    const lijst = pasOpeningenIn(lengteMm(wand, pxPerMm), geldigeOpeningen(wand, perId)).map(opgeschoond);
    if (zetLijst(wand, lijst)) iets = true;
    if (plaatsKozijnen(wand, perId, pxPerMm)) iets = true;
  }
  return iets;
}

// ── een opening maken ───────────────────────────────────────────────────

/**
 * De regel voor de lijst van de wand bij een nieuw kozijn.
 * @param {{ id: string, key?: string, afstandMm: number, breedteMm: number,
 *   soort?: 'deur'|'raam', zijde?: 1|-1 }} gegevens
 */
export function nieuweOpening(gegevens) {
  return opgeschoond(gegevens);
}

/** De lijst van een wand met een opening erbij, op volgorde langs de wand. */
export function lijstMetOpening(wand, opening) {
  return [...(wand?.openingen || []).filter((o) => o && o.id !== opening.id).map(opgeschoond), opgeschoond(opening)]
    .sort((a, b) => a.afstandMm - b.afstandMm);
}
