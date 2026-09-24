// Indeling van een gevelelement: velden, stijlen en panelen — en de
// bewerkingen daarop (stijl toevoegen, verwijderen, verschuiven, wisselen;
// paneel wisselen; opnieuw verdelen; uitrekken).
//
// Puur: geen annotaties, geen canvas, geen app-state. Alle maten in mm.
//
// Opgeslagen parameters (annotation.params van het parametrische symbool):
//
//   {
//     lengte: 3600,                                  // totale lengte
//     stijlen: [{ pos: 1200, type: 'alu-50x150' }],  // TUSSENstijlen: hart vanaf het begin
//     kader: ['alu-50x150', 'alu-50x150'],           // stijltype begin- en eindkader
//     panelen: [{ type: 'glas' }, { type: 'deur', scharnier: 'begin', draaiNaar: 'binnen' }],
//     binnenzijde: 'rechts' | 'links',               // welke kant van de tekenrichting binnen is
//   }
//
// Zonder `stijlen` is de verdeling automatisch: gelijke velden van ongeveer
// de streefbreedte van de voorinstelling. Zodra er iets aan de verdeling
// verandert, legt de bewerking de stijlen expliciet vast.
//
// Maatvoering: de RASTERLIJNEN liggen op 0, op het hart van elke tussenstijl
// en op de totale lengte. Een veld loopt van rasterlijn tot rasterlijn
// (hart-op-hart, "veldbreedte"). Het begin- en eindkader liggen BINNEN de
// lengte, tegen de uiteinden aan — zo is het element precies zo lang als zijn
// lijn en past het exact in een wandsparing. De vrije breedte (dagmaat) van
// een veld loopt van stijlvlak tot stijlvlak.
//
// Nummering: stijl 0 is het beginkader, stijl n het eindkader, stijlen
// 1 .. n-1 zijn de tussenstijlen. Veld i ligt tussen stijl i en stijl i+1.

import {
  preset as presetVan, stijlType, paneelType,
  stijlTypeToegestaan, paneelTypeToegestaan,
} from './catalogus.js';

const EPS = 1e-6;

function getal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rond(v) {
  return Math.round(v * 100) / 100;
}

function kaderTypeId(pr, id) {
  return stijlTypeToegestaan(pr.id, id) ? id : pr.kaderType;
}

function tussenTypeId(pr, id) {
  return stijlTypeToegestaan(pr.id, id) ? id : pr.stijlType;
}

function breedteVan(typeId) {
  return stijlType(typeId)?.breedteMm || 50;
}

function diepteVan(typeId) {
  return stijlType(typeId)?.diepteMm || 150;
}

/** Paneel met de standaardwaarden van zijn type aangevuld. */
export function normaliseerPaneel(p, presetId) {
  const pr = presetVan(presetId);
  const ruw = typeof p === 'string' ? { type: p } : (p && typeof p === 'object' ? p : {});
  const type = paneelTypeToegestaan(pr.id, ruw.type) ? ruw.type : pr.paneelType;
  const uit = { ...ruw, type };
  const w = paneelType(type)?.weergave;
  if (w === 'deur' || w === 'draairaam') {
    uit.scharnier = ruw.scharnier === 'eind' ? 'eind' : 'begin';
    uit.draaiNaar = ruw.draaiNaar === 'buiten' ? 'buiten' : 'binnen';
  } else {
    delete uit.scharnier;
    delete uit.draaiNaar;
  }
  return uit;
}

/**
 * Houd alleen tussenstijlen die passen: elk veld houdt minstens de minimale
 * dagmaat over, ook het laatste. Invoer gesorteerd op positie.
 */
function passendeTussenstijlen(L, b0, bn, kandidaten, minDag) {
  const uit = [];
  let vorigVlak = b0;
  const eindVlak = L - bn;
  for (const c of kandidaten) {
    const half = breedteVan(c.type) / 2;
    if (c.pos - half - vorigVlak < minDag - EPS) continue;
    if (eindVlak - (c.pos + half) < minDag - EPS) continue;
    uit.push(c);
    vorigVlak = c.pos + half;
  }
  return uit;
}

function automatischeStijlen(L, pr, kader) {
  const b0 = breedteVan(kader[0]), bn = breedteVan(kader[1]);
  let n = Math.max(1, Math.round(L / pr.standaardVeldMm));
  for (; n > 1; n--) {
    const kandidaten = [];
    for (let k = 1; k < n; k++) kandidaten.push({ pos: (L * k) / n, type: pr.stijlType });
    if (passendeTussenstijlen(L, b0, bn, kandidaten, pr.minDagMm).length === n - 1) {
      return kandidaten;
    }
  }
  return [];
}

/**
 * De volledige indeling uit de parameters. Ongeldige of niet-passende
 * waarden vallen terug op wat wel kan; deze functie gooit nooit.
 *
 * @returns {{ preset, lengteMm, diepteMm, binnenzijde, expliciet,
 *   stijlen: Array<{index, rol, posMm, type, breedteMm, diepteMm, vanMm, totMm}>,
 *   velden: Array<{index, vanMm, totMm, breedteMm, dagVanMm, dagTotMm, dagMm, paneel}> }}
 */
export function indeling(params, presetId) {
  const pr = presetVan(presetId);
  const L = getal(params?.lengte) > 0 ? getal(params.lengte) : pr.standaardLengteMm;
  const kaderRuw = Array.isArray(params?.kader) ? params.kader : [];
  const kader = [kaderTypeId(pr, kaderRuw[0]), kaderTypeId(pr, kaderRuw[1])];
  const b0 = breedteVan(kader[0]), bn = breedteVan(kader[1]);

  const expliciet = Array.isArray(params?.stijlen);
  let tussen;
  if (expliciet) {
    const kandidaten = params.stijlen
      .map((s) => (typeof s === 'number' || typeof s === 'string'
        ? { pos: getal(s), type: pr.stijlType }
        : { pos: getal(s?.pos), type: tussenTypeId(pr, s?.type) }))
      .filter((s) => s.pos !== null)
      .sort((a, b) => a.pos - b.pos);
    tussen = passendeTussenstijlen(L, b0, bn, kandidaten, pr.minDagMm);
  } else {
    tussen = automatischeStijlen(L, pr, kader);
  }

  const stijlen = [];
  const maakStijl = (index, rol, posMm, type) => {
    const b = breedteVan(type);
    stijlen.push({
      index, rol, posMm, type,
      breedteMm: b, diepteMm: diepteVan(type),
      vanMm: posMm - b / 2, totMm: posMm + b / 2,
    });
  };
  maakStijl(0, 'begin', b0 / 2, kader[0]);
  tussen.forEach((s, i) => maakStijl(i + 1, 'tussen', s.pos, s.type));
  maakStijl(tussen.length + 1, 'eind', L - bn / 2, kader[1]);

  const n = tussen.length + 1;
  const panelenRuw = Array.isArray(params?.panelen) ? params.panelen : [];
  const velden = [];
  for (let i = 0; i < n; i++) {
    const links = stijlen[i], rechts = stijlen[i + 1];
    const vanMm = i === 0 ? 0 : links.posMm;
    const totMm = i === n - 1 ? L : rechts.posMm;
    velden.push({
      index: i,
      vanMm, totMm,
      breedteMm: totMm - vanMm,
      dagVanMm: links.totMm,
      dagTotMm: rechts.vanMm,
      dagMm: rechts.vanMm - links.totMm,
      paneel: normaliseerPaneel(panelenRuw[i], pr.id),
    });
  }

  return {
    preset: pr.id,
    lengteMm: L,
    diepteMm: Math.max(...stijlen.map((s) => s.diepteMm)),
    binnenzijde: params?.binnenzijde === 'links' ? 'links' : 'rechts',
    expliciet,
    stijlen,
    velden,
  };
}

/** De indeling terug naar parameters, met de stijlen expliciet vastgelegd. */
export function naarParams(basis, lay) {
  const eind = lay.stijlen.length - 1;
  return {
    ...(basis || {}),
    lengte: rond(lay.lengteMm),
    stijlen: lay.stijlen.slice(1, eind).map((s) => ({ pos: rond(s.posMm), type: s.type })),
    kader: [lay.stijlen[0].type, lay.stijlen[eind].type],
    panelen: lay.velden.map((v) => ({ ...v.paneel })),
    binnenzijde: lay.binnenzijde,
  };
}

// ── bewerkingen ──────────────────────────────────────────────────────────
//
// Elke bewerking neemt parameters en geeft { ok: true, params, ... } of
// { ok: false, error }. De invoer wordt nooit gemuteerd.

function fout(error) {
  return { ok: false, error };
}

/**
 * Bouw parameters uit tussenstijlen + panelen en controleer dat er niets
 * wegvalt: past een stijl niet, dan is de bewerking ongeldig.
 */
function samenstellen(basis, presetId, tussen, panelen, extra = {}) {
  const params = {
    ...(basis || {}),
    ...extra,
    stijlen: tussen.map((s) => ({ pos: rond(s.pos), type: s.type })),
    panelen: panelen.map((p) => ({ ...p })),
  };
  const lay = indeling(params, presetId);
  if (lay.stijlen.length - 2 !== tussen.length) return null;
  return naarParams(params, lay);
}

function tussenUit(lay) {
  return lay.stijlen.slice(1, -1).map((s) => ({ pos: s.posMm, type: s.type }));
}

function panelenUit(lay) {
  return lay.velden.map((v) => ({ ...v.paneel }));
}

/** Het veld waarin positie `posMm` valt (rasterlijnen); -1 buiten het element. */
export function veldBij(lay, posMm) {
  if (!(posMm >= 0) || posMm > lay.lengteMm) return -1;
  const i = lay.velden.findIndex((v) => posMm <= v.totMm + EPS);
  return i < 0 ? lay.velden.length - 1 : i;
}

/**
 * Stijl toevoegen: het veld op `posMm` wordt in tweeën gesplitst. Het nieuwe
 * rechterveld krijgt hetzelfde paneel (een deur wordt niet verdubbeld: dan
 * het standaardpaneel).
 * @returns {{ ok, params, index }} index = nummer van de nieuwe stijl.
 */
export function voegStijlToe(params, presetId, posMm, typeId) {
  const pr = presetVan(presetId);
  const lay = indeling(params, presetId);
  const pos = getal(posMm);
  if (pos === null || pos <= 0 || pos >= lay.lengteMm) return fout('mullion position must lie inside the element');
  if (typeId !== undefined && typeId !== null && !stijlTypeToegestaan(pr.id, typeId)) {
    return fout(`unknown mullion type for ${pr.id}: ${typeId}`);
  }
  const type = typeId || pr.stijlType;
  const veld = veldBij(lay, pos);
  const tussen = tussenUit(lay);
  const panelen = panelenUit(lay);
  tussen.splice(veld, 0, { pos, type });
  const kopie = paneelType(panelen[veld].type)?.weergave === 'deur'
    ? { type: pr.paneelType } : { ...panelen[veld] };
  panelen.splice(veld + 1, 0, kopie);
  const uit = samenstellen(params, presetId, tussen, panelen);
  if (!uit) return fout(`a field would become narrower than ${pr.minDagMm} mm`);
  return { ok: true, params: uit, index: veld + 1 };
}

/**
 * Stijl in het midden van veld `veldIndex` toevoegen: het veld wordt
 * hart-op-hart gehalveerd, zodat een regelmatig raster regelmatig blijft.
 */
export function splitsVeld(params, presetId, veldIndex, typeId) {
  const lay = indeling(params, presetId);
  const v = lay.velden[veldIndex];
  if (!v) return fout(`field ${veldIndex} does not exist`);
  return voegStijlToe(params, presetId, (v.vanMm + v.totMm) / 2, typeId);
}

/**
 * Stijl verwijderen: de twee velden ernaast worden één veld, met het paneel
 * van het linkerveld (aan de beginkant). Het kader blijft altijd staan.
 */
export function verwijderStijl(params, presetId, index) {
  const lay = indeling(params, presetId);
  const n = lay.velden.length;
  if (!Number.isInteger(index) || index < 0 || index > n) return fout(`mullion ${index} does not exist`);
  if (index === 0 || index === n) return fout('the outer frame cannot be removed');
  const tussen = tussenUit(lay);
  const panelen = panelenUit(lay);
  tussen.splice(index - 1, 1);
  panelen.splice(index, 1);
  const uit = samenstellen(params, presetId, tussen, panelen);
  return uit ? { ok: true, params: uit } : fout('could not merge the fields');
}

/**
 * Het bereik waarbinnen tussenstijl `index` mag liggen: beide velden ernaast
 * houden de minimale dagmaat. null voor het kader.
 */
export function stijlBereik(lay, index, typeId) {
  const n = lay.velden.length;
  if (!(index >= 1 && index <= n - 1)) return null;
  const minDag = presetVan(lay.preset).minDagMm;
  const half = breedteVan(typeId || lay.stijlen[index].type) / 2;
  const links = lay.stijlen[index - 1], rechts = lay.stijlen[index + 1];
  return { vanMm: links.totMm + minDag + half, totMm: rechts.vanMm - minDag - half };
}

/**
 * Stijl verschuiven naar positie `posMm` (hart, vanaf het begin). De velden
 * ernaast worden breder/smaller; de lengte blijft gelijk. Met `klem: true`
 * (slepen) blijft de stijl tegen de grens staan in plaats van te weigeren.
 * @returns {{ ok, params, posMm }}
 */
export function verschuifStijl(params, presetId, index, posMm, opties = {}) {
  const lay = indeling(params, presetId);
  const n = lay.velden.length;
  if (!Number.isInteger(index) || index < 0 || index > n) return fout(`mullion ${index} does not exist`);
  if (index === 0 || index === n) return fout('the outer frame cannot be moved; change the length instead');
  let pos = getal(posMm);
  if (pos === null) return fout('mullion position must be a number');
  const bereik = stijlBereik(lay, index);
  if (bereik.vanMm > bereik.totMm + EPS) return { ok: true, params: naarParams(params, lay), posMm: lay.stijlen[index].posMm };
  if (opties.klem) pos = Math.min(bereik.totMm, Math.max(bereik.vanMm, pos));
  else if (pos < bereik.vanMm - EPS || pos > bereik.totMm + EPS) {
    return fout(`mullion ${index} can move between ${Math.ceil(bereik.vanMm)} and ${Math.floor(bereik.totMm)} mm`);
  }
  const tussen = tussenUit(lay);
  tussen[index - 1] = { ...tussen[index - 1], pos };
  const uit = samenstellen(params, presetId, tussen, panelenUit(lay));
  return uit ? { ok: true, params: uit, posMm: rond(pos) } : fout('a field would become too narrow');
}

/**
 * Veldbreedte (hart-op-hart) van veld `veldIndex` instellen door een stijl te
 * verschuiven: de stijl aan de eindkant van het veld, of voor het laatste
 * veld de stijl aan de beginkant. Het buurveld krijgt het verschil; de lengte
 * blijft gelijk.
 */
export function zetVeldbreedte(params, presetId, veldIndex, breedteMm) {
  const lay = indeling(params, presetId);
  const n = lay.velden.length;
  const v = lay.velden[veldIndex];
  if (!v) return fout(`field ${veldIndex} does not exist`);
  const b = getal(breedteMm);
  if (!(b > 0)) return fout('field width must be > 0');
  if (n < 2) return fout('a single field is as wide as the element; change the length instead');
  if (veldIndex < n - 1) return verschuifStijl(params, presetId, veldIndex + 1, v.vanMm + b);
  return verschuifStijl(params, presetId, veldIndex, lay.lengteMm - b);
}

/** Stijl (of kader) wisselen voor een ander stijltype. */
export function wisselStijlType(params, presetId, index, typeId) {
  const pr = presetVan(presetId);
  const lay = indeling(params, presetId);
  const n = lay.velden.length;
  if (!Number.isInteger(index) || index < 0 || index > n) return fout(`mullion ${index} does not exist`);
  if (!stijlTypeToegestaan(pr.id, typeId)) return fout(`unknown mullion type for ${pr.id}: ${typeId}`);
  const tussen = tussenUit(lay);
  const kader = [lay.stijlen[0].type, lay.stijlen[n].type];
  if (index === 0) kader[0] = typeId;
  else if (index === n) kader[1] = typeId;
  else tussen[index - 1] = { ...tussen[index - 1], type: typeId };
  const uit = samenstellen(params, presetId, tussen, panelenUit(lay), { kader });
  return uit ? { ok: true, params: uit } : fout(`mullion type ${typeId} is too wide here: a field would become too narrow`);
}

/**
 * Paneel van veld `veldIndex` wisselen. `paneel` is een type-id of een
 * object; een object zonder `type` wijzigt alleen de eigenschappen (bijv.
 * de scharnierkant van een deur).
 */
export function wisselPaneel(params, presetId, veldIndex, paneel) {
  const pr = presetVan(presetId);
  const lay = indeling(params, presetId);
  const v = lay.velden[veldIndex];
  if (!v) return fout(`field ${veldIndex} does not exist`);
  const wijziging = typeof paneel === 'string' ? { type: paneel } : (paneel && typeof paneel === 'object' ? paneel : null);
  if (!wijziging) return fout('panel must be a panel type or an object');
  const nieuw = { ...v.paneel, ...wijziging };
  if (!paneelTypeToegestaan(pr.id, nieuw.type)) return fout(`unknown panel type for ${pr.id}: ${nieuw.type}`);
  const panelen = panelenUit(lay);
  panelen[veldIndex] = normaliseerPaneel(nieuw, pr.id);
  const uit = samenstellen(params, presetId, tussenUit(lay), panelen);
  return uit ? { ok: true, params: uit } : fout('could not change the panel');
}

/**
 * Opnieuw verdelen in `aantal` gelijke velden (hart-op-hart). Panelen blijven
 * per veldnummer staan zolang dat veld bestaat; tussenstijlen krijgen het
 * type van de eerste bestaande tussenstijl (anders het standaardtype).
 */
export function verdeelGelijk(params, presetId, aantal) {
  const pr = presetVan(presetId);
  const lay = indeling(params, presetId);
  const n = Math.round(Number(aantal));
  if (!(n >= 1)) return fout('number of fields must be at least 1');
  const type = lay.stijlen.length > 2 ? lay.stijlen[1].type : pr.stijlType;
  const tussen = [];
  for (let k = 1; k < n; k++) tussen.push({ pos: (lay.lengteMm * k) / n, type });
  const oud = panelenUit(lay);
  const panelen = [];
  for (let i = 0; i < n; i++) panelen.push(oud[i] ? { ...oud[i] } : { type: pr.paneelType });
  const uit = samenstellen(params, presetId, tussen, panelen);
  return uit ? { ok: true, params: uit } : fout(`${n} fields do not fit: a field would become narrower than ${pr.minDagMm} mm`);
}

/**
 * Veldbreedtes (hart-op-hart) vastleggen; de lengte wordt hun som.
 */
export function zetVeldbreedtes(params, presetId, breedtes) {
  const pr = presetVan(presetId);
  if (!Array.isArray(breedtes) || !breedtes.length) return fout('field widths must be a non-empty list');
  const ws = breedtes.map(getal);
  if (ws.some((w) => w === null || w <= 0)) return fout('every field width must be a number > 0');
  const L = ws.reduce((a, b) => a + b, 0);
  const lay = indeling({ ...(params || {}), lengte: L }, presetId);
  const type = lay.stijlen.length > 2 ? lay.stijlen[1].type : pr.stijlType;
  const tussen = [];
  let acc = 0;
  for (let i = 0; i < ws.length - 1; i++) { acc += ws[i]; tussen.push({ pos: acc, type }); }
  const oud = Array.isArray(params?.panelen) ? params.panelen : [];
  const panelen = ws.map((_, i) => normaliseerPaneel(oud[i], pr.id));
  const uit = samenstellen(params, presetId, tussen, panelen, { lengte: L });
  return uit ? { ok: true, params: uit } : fout(`a field would become narrower than ${pr.minDagMm} mm clear`);
}

/**
 * Uitrekken of inkorten tot `lengteMm`. `vasteKant` is het uiteinde dat
 * blijft staan: 'begin' (het eind is versleept) of 'eind' (het begin is
 * versleept). De stijlen houden hun plaats ten opzichte van de vaste kant;
 * alleen het veld aan de bewegende kant verandert. Stijlen die niet meer
 * passen vallen weg; hun velden gaan op in het buurveld.
 */
export function rekUit(params, presetId, lengteMm, vasteKant = 'begin') {
  const L1 = getal(lengteMm);
  if (!(L1 > 0)) return fout('length must be > 0');
  const lay = indeling(params, presetId);
  const pr = presetVan(presetId);
  const verschil = vasteKant === 'eind' ? L1 - lay.lengteMm : 0;
  const oudTussen = tussenUit(lay).map((s, i) => ({ ...s, pos: s.pos + verschil, oud: i + 1 }));
  const b0 = lay.stijlen[0].breedteMm, bn = lay.stijlen[lay.stijlen.length - 1].breedteMm;
  const kandidaten = vasteKant === 'eind' ? [...oudTussen].reverse() : oudTussen;
  // Laat de stijlen aan de VASTE kant voorgaan: bij 'eind' van achteren af.
  let blijft;
  if (vasteKant === 'eind') {
    const gespiegeld = kandidaten.map((s) => ({ ...s, pos: L1 - s.pos }));
    blijft = passendeTussenstijlen(L1, bn, b0, gespiegeld, pr.minDagMm)
      .map((s) => ({ ...s, pos: L1 - s.pos }))
      .reverse();
  } else {
    blijft = passendeTussenstijlen(L1, b0, bn, kandidaten, pr.minDagMm);
  }
  const oudePanelen = panelenUit(lay);
  // Veld j ligt rechts van (blijvende) stijl j: het paneel van het oude veld
  // rechts van die stijl. Het eerste veld houdt het paneel van oud veld 0.
  const panelen = [{ ...oudePanelen[0] }, ...blijft.map((s) => ({ ...oudePanelen[s.oud] }))];
  const uit = samenstellen(params, presetId, blijft.map(({ pos, type }) => ({ pos, type })), panelen, { lengte: L1 });
  return uit ? { ok: true, params: uit } : fout('could not stretch the element');
}

/** Maak een automatische verdeling expliciet (zonder iets te veranderen). */
export function legVast(params, presetId) {
  return naarParams(params, indeling(params, presetId));
}
