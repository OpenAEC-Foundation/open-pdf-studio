// De opdracht achter `app_floorplan`: de drie relaties van #450 uitvoeren op
// het geopende document — een sparing hoort bij een wand, een ruimte bij de
// wanden eromheen, een maat bij wat hij meet.
//
// Deze module raakt de app niet rechtstreeks aan. Alles wat ze nodig heeft
// komt binnen als `omgeving`, zodat de hele opdracht met eenvoudige stubs te
// toetsen is:
//
//   {
//     doc:          { currentPage, annotations, paginas },
//     pxPerMmAt(page, x, y) -> number,
//     maak(type, page, props)  -> { ok, id }      (annotatie toevoegen)
//     werkBij(id, props)       -> { ok }          (annotatie wijzigen)
//     verwijder(id)            -> { ok }          (annotatie weghalen)
//     herorden(ids)            -> { ok }          (tekenvolgorde: alle ids, van
//                                                  achter naar voor; optioneel)
//     transactie(fn)           -> Promise         (alles in één undo-stap)
//   }
//
// Alle invoer- en uitvoervelden zijn Engels: dit is de buitenkant van de
// MCP-opdracht.

import {
  SPARING_SOORTEN, SPARING_SYMBOOL, SPARING_STANDAARD,
  normaliseerSparing, wandMetSparingen, controleerSparing, sparingPlaatsing,
} from './sparing.js';
import { ruimtenUitWanden, ruimteBijZaad, ruimteLabel, RUIMTE_VLAKSTIJL, puntInPolygoon } from './ruimte.js';
import {
  isRuimteVlak, isRuimteTag, ruimteVanTag, tagsVanRuimte, ruimteNaamPatch,
} from './ruimte-koppeling.js';
import {
  maatketting, herberekenMaten, kettingLangsWandvlak,
  standaardMaatAfstanden, PLATTEGROND_MAATSTIJL, ankerVoorPunt,
} from './maatvoering.js';
import {
  leesKetting, puntToevoegen, puntVerwijderen, puntBij, nieuwSegment, wijzigPatch,
} from '../annotations/maatketting-bewerken.js';
import { wandAs, projecteer } from '../annotations/wand-geometrie.js';
import { PRESETS as GEVEL_PRESETS } from '../gevelelement/catalogus.js';
import { indeling as gevelIndeling } from '../gevelelement/indeling.js';
import { twoPointEndpoints } from '../symbols/two-point.js';
import { kozijnIndeling, kozijnMaten, vakOffsetMm } from './kozijn.js';
import {
  normaliseerPakket, kozijnInPakket, laagSparingMm, laagLijnen, zoekLaagHoek,
} from './spouwmuur.js';
import {
  RUIMTETAG_ID, ruimteTagVak, tagVolgtRuimte, RUIMTETAG_STIJL, RUIMTETAG_TEKST_PT,
} from '../symbols/templates/ruimtetag.js';

export const FLOORPLAN_ACTIES = Object.freeze(['inspect', 'wall', 'rooms', 'dimensions']);

const SOORT_VAN_KIND = { door: 'deur', window: 'raam' };
const KIND_VAN_SOORT = { deur: 'door', raam: 'window' };

function getal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fout(bericht) {
  return { ok: false, error: bericht };
}

function paginaVan(params, omgeving) {
  const doc = omgeving.doc || {};
  const ruw = params?.page ?? doc.currentPage ?? 1;
  const page = Number(ruw);
  if (!Number.isInteger(page) || page < 1) return { error: 'invalid page (1-based integer)' };
  return { page };
}

/** Gevelelementen (vliesgevel, kozijn — #475) op een pagina. */
function gevelelementenOpPagina(annotaties, page) {
  return (annotaties || []).filter((a) => a?.type === 'parametricSymbol'
    && GEVEL_PRESETS[a.symbolId] && (a.page ?? 1) === page);
}

/** De wanden op een pagina, in de vorm die de rekenmodules verwachten. */
function wandenOpPagina(annotaties, page) {
  return (annotaties || [])
    .filter((a) => a?.type === 'wall' && (a.page ?? 1) === page)
    .map((a) => ({
      id: a.id, startX: a.startX, startY: a.startY, endX: a.endX, endY: a.endY,
      dikteMm: getal(a.dikteMm) || 100,
      // Join per uiteinde (#476), voor inspect.
      noJoinStart: a.noJoinStart === true, noJoinEnd: a.noJoinEnd === true,
    }));
}

/**
 * Wat een ruimte omsluit: de wanden plus de gevelelementen. Een vliesgevel
 * sluit een ruimte net zo goed af als een wand; hij telt mee met de dikte
 * van de wand waarin hij staat (dan loopt de contour recht door het gat), of
 * los met zijn eigen diepte.
 */
function omsluitingOpPagina(annotaties, page) {
  const wanden = wandenOpPagina(annotaties, page);
  for (const g of gevelelementenOpPagina(annotaties, page)) {
    const l = twoPointEndpoints(g);
    const dikte = getal(g.params?.host?.dikteMm) || gevelIndeling(g.params, g.symbolId).diepteMm;
    wanden.push({ id: g.id, startX: l.startX, startY: l.startY, endX: l.endX, endY: l.endY, dikteMm: dikte });
  }
  return wanden;
}

/** De gehoste kozijnen op een pagina (deur/raam als parametricSymbol). */
function sparingenOpPagina(annotaties, page) {
  return (annotaties || []).filter((a) => a?.type === 'parametricSymbol'
    && (a.page ?? 1) === page
    && (a.symbolId === 'door' || a.symbolId === 'window'));
}

/** Schaal op een houvastpunt; zonder punt het midden van alle wanden. */
function schaalOp(omgeving, page, punt) {
  const p = punt || { x: 0, y: 0 };
  const k = omgeving.pxPerMmAt(page, p.x, p.y);
  return k > 0 ? k : null;
}

function middenVan(wanden) {
  if (!wanden.length) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const w of wanden) { x += (w.startX + w.endX) / 2; y += (w.startY + w.endY) / 2; }
  return { x: x / wanden.length, y: y / wanden.length };
}

// ── actie: wall ──────────────────────────────────────────────────────────

/**
 * Eén wandloop tekenen mét zijn sparingen. De wand wordt opgeknipt: per
 * solide stuk één wand-annotatie, en in elk gat het kozijnsymbool. Daardoor
 * onderbreekt een deur of raam de wand echt — de arcering stopt bij de dag
 * en de bestaande wandrenderer zet op elk vrij einde een dagkant.
 */
async function actieWand(params, omgeving, page) {
  const start = params?.start, end = params?.end;
  if (!start || !end || ![start.x, start.y, end.x, end.y].every((v) => getal(v) !== null)) {
    return fout('action "wall" needs start:{x,y} and end:{x,y} in page points');
  }
  const dikteMm = getal(params?.thicknessMm) || 100;
  if (dikteMm <= 0) return fout('thicknessMm must be > 0');
  const pxPerMm = schaalOp(omgeving, page, start);
  if (!pxPerMm) return fout('no measurement scale on this page - set it with app_set_measure_scale first');
  if (Array.isArray(params?.layers) && params.layers.length) {
    return actieGelaagdeWand(params, omgeving, page, pxPerMm);
  }

  const wand = {
    id: params?.wallId || `run:${Math.round(start.x)}:${Math.round(start.y)}`,
    startX: start.x, startY: start.y, endX: end.x, endY: end.y, dikteMm,
  };
  const as = wandAs(wand);
  if (!as) return fout('start and end are the same point');

  // Openingen omzetten en stuk voor stuk controleren: liever een nette
  // weigering dan een half getekende gevel.
  const sparingen = [];
  const klachten = [];
  const enkelPakket = normaliseerPakket([{ dikteMm, materiaal: params?.material || 'nen47-metselwerk-baksteen' }]);
  (params?.openings || []).forEach((o, i) => {
    const s = leesOpening(o, i, wand, enkelPakket);
    const soort = s.soort;
    const controle = controleerSparing(wand, s, sparingen, pxPerMm, getal(params?.minPierMm) ?? 0);
    if (!controle.ok) klachten.push(`opening ${i} (${o?.kind || soort}): ${controle.reden}`);
    else sparingen.push(s);
  });
  if (klachten.length) return { ok: false, error: klachten.join('; ') };

  const { segmenten, sparingen: plaatsingen, lengteMm } = wandMetSparingen(wand, sparingen, pxPerMm);
  const stijl = {
    dikteMm,
    hatchPattern: params?.material || 'nen47-metselwerk-baksteen',
    ...(params?.insulation ? { isolatieType: params.insulation } : {}),
  };

  // Join uit aan het begin en/of eind van de LOOP (#476): alleen op het
  // wandstuk dat daar echt ligt; einden bij een sparing zijn al vrij.
  const joinUit = (seg) => ({
    ...(params?.joinStart === false && seg.vanPt <= 1e-6 ? { noJoinStart: true } : {}),
    ...(params?.joinEnd === false && seg.totPt >= as.len - 1e-6 ? { noJoinEnd: true } : {}),
  });

  const wallIds = [];
  const openingIds = [];
  await omgeving.transactie(async () => {
    for (const seg of segmenten) {
      const r = await omgeving.maak('wall', page, {
        startX: seg.startX, startY: seg.startY, endX: seg.endX, endY: seg.endY, ...stijl,
        ...joinUit(seg),
      });
      if (r?.ok && r.id) wallIds.push(r.id);
    }
    for (const p of plaatsingen) {
      const bron = sparingen.find((s) => s.id === p.id) || {};
      const props = kozijnProps(wand, p, bron, pxPerMm);
      const r = await omgeving.maak('parametricSymbol', page, props);
      if (r?.ok && r.id) openingIds.push(r.id);
    }
  });

  return {
    ok: true,
    page,
    wallIds,
    openingIds,
    lengthMm: Math.round(lengteMm * 10) / 10,
    segments: segmenten.map((s) => ({ fromMm: Math.round(s.vanPt / pxPerMm), lengthMm: Math.round(s.lengteMm) })),
    openings: plaatsingen.map((p) => ({
      kind: KIND_VAN_SOORT[p.soort], widthMm: p.dagmaatMm, alongMm: p.hartMm,
      sillMm: p.borstweringMm, heightMm: p.hoogteMm,
    })),
  };
}

/**
 * Naar welke kant van de wand draait de deur open?
 *   +1 = naar de kant die je, langs de wandrichting kijkend, LINKS op het
 *        blad ziet;  -1 = rechts.
 * `openTo: {x, y}` is de fijnste manier: geef een punt in de ruimte waarin de
 * deur moet openen (bijvoorbeeld het midden van die ruimte) en de kant volgt
 * daaruit. Zonder dat punt telt `openSide: 'left' | 'right'`.
 */
export function draaizijde(wand, opening) {
  const doel = opening?.openTo;
  if (doel && getal(doel.x) !== null && getal(doel.y) !== null) {
    const pr = projecteer(doel, wand);
    if (pr && Math.abs(pr.d) > 1e-9) return pr.d > 0 ? -1 : 1;
  }
  return opening?.openSide === 'right' ? -1 : 1;
}

const RAAMTYPEN = ['fixed', 'turn', 'pivot', 'tilt'];

/**
 * Eén opening uit de MCP-invoer: de sparing (plaats langs de wand, maat)
 * plus het kozijn in het wandpakket. `widthMm` is de kozijnmaat
 * (buitenwerks); in een enkele wand is dat ook de sparing.
 */
function leesOpening(o, i, wand, pakket) {
  const soort = SOORT_VAN_KIND[o?.kind] || (SPARING_SOORTEN.includes(o?.kind) ? o.kind : 'deur');
  const langs = getal(o?.alongMm);
  const s = normaliseerSparing({
    id: `opening-${i}`,
    soort,
    dagmaatMm: getal(o?.widthMm) ?? SPARING_STANDAARD[soort].dagmaatMm,
    hartMm: langs ?? 0,
    borstweringMm: getal(o?.sillMm),
    hoogteMm: getal(o?.heightMm),
    draairichting: o?.swing === 'rechts' || o?.swing === 'right' ? 'rechts' : 'links',
  });
  s.draaizijde = draaizijde(wand, o);
  s.raamtype = RAAMTYPEN.includes(o?.windowType) ? o.windowType : 'fixed';
  // Leeg (niet opgegeven) blijft leeg, zodat de standaard geldt.
  const maat = (v) => (v === undefined || v === null || v === '' ? undefined : (getal(v) ?? undefined));
  const stijl = maat(o?.stileWidthMm);
  const blad = maat(o?.leafThicknessMm);
  s.kozijn = {
    ...kozijnInPakket(pakket, {
      positieMm: maat(o?.framePositionMm),
      diepteMm: maat(o?.frameDepthMm),
      aanslagMm: maat(o?.overlapMm),
      spelingMm: maat(o?.clearanceMm),
    }),
    stijlBreedteMm: stijl > 0 ? stijl : 67,
    deurbladDikteMm: blad > 0 ? blad : 40,
  };
  return s;
}

/**
 * Het kozijnsymbool in het gat. Het symbool tekent het kozijn op ware
 * grootte in de wand (stijlen met sponning, glas of deurblad met
 * draaicirkel, zie kozijn.js); zijn vak beslaat de wand plus, bij een deur,
 * de draaicirkel. In het symbool staat de binnenzijde bovenaan, dus de
 * rotatie kiest welke kant van de wand binnen is.
 *
 * `pakket` (optioneel, voor een gelaagde wand): { dikteMm, middenOffsetPt,
 * binnenN }. `wand` is dan het buitenvlak van het pakket; het hart van het
 * pakket ligt `middenOffsetPt` langs de wandnormaal n daarvandaan, en
 * `binnenN` (+1/-1) zegt aan welke kant van n binnen is. Zonder pakket is
 * `wand` de hartlijn van één wand en is binnen de kant waar de deur heen
 * draait (`draaizijde`; bij een raam de kant van `openTo`/`openSide`).
 */
export function kozijnProps(wand, plaatsing, bron, pxPerMm, pakket = null) {
  const as = wandAs(wand);
  const deur = plaatsing.soort !== 'raam';
  // draaizijde +1 = de kant links van de wandrichting = -n.
  const zijde = getal(bron?.draaizijde) === -1 ? -1 : 1;
  const T = pakket ? pakket.dikteMm : (getal(wand.dikteMm) || 100);
  const binnenN = pakket ? (pakket.binnenN < 0 ? -1 : 1) : -zijde;
  const middenOffsetPt = pakket ? (getal(pakket.middenOffsetPt) || 0) : 0;
  const kz = bron?.kozijn || {};
  const params = {
    hostWallId: wand.id,
    hostAfstandMm: plaatsing.hartMm,
    width: plaatsing.dagmaatMm,
    dagmaatMm: plaatsing.dagmaatMm,
    borstweringMm: plaatsing.borstweringMm,
    hoogteMm: plaatsing.hoogteMm,
    wallThickness: T,
    stijlBreedteMm: getal(kz.stijlBreedteMm) || 67,
    stijlDiepteMm: getal(kz.diepteMm) || Math.min(114, T),
    kozijnPositieMm: getal(kz.positieMm) ?? -1,
    aanslagMm: getal(kz.aanslagMm) ?? 0,
    binnenSpelingMm: getal(kz.spelingMm) ?? 0,
    swing: plaatsing.draairichting === 'rechts' ? 'right' : 'left',
  };
  if (deur) {
    // De deur draait naar de kant van `zijde` (-zijde langs n); is dat de
    // binnenkant, dan draait hij naar binnen.
    params.draaiNaar = -zijde === binnenN ? 'binnen' : 'buiten';
    params.angle = 90;
    params.showWall = false;
    params.deurbladDikteMm = getal(kz.deurbladDikteMm) || 40;
  } else {
    params.type = bron?.raamtype || 'fixed';
  }
  const { vak } = kozijnIndeling(deur ? 'deur' : 'raam', params);
  const k = pxPerMm;
  const breedte = (vak.uMax - vak.uMin) * k;
  const hoogte = (vak.vMax - vak.vMin) * k;
  // Binnen bovenaan: lokale +y (omlaag) wijst naar buiten. Met rotatie =
  // wandhoek is lokale +y gelijk aan n, dus buiten = +n; is binnen +n, dan
  // een halve slag erbij.
  const rotatie = binnenN > 0 ? plaatsing.rotatie + 180 : plaatsing.rotatie;
  const r = (rotatie * Math.PI) / 180;
  const ex = { x: Math.cos(r), y: Math.sin(r) };
  const ey = { x: -Math.sin(r), y: Math.cos(r) };
  // Het midden van het kozijn (halve kozijnmaat, halve pakketdikte) ligt op
  // het hart van de sparing, verschoven naar het midden van het pakket.
  const P0 = {
    x: plaatsing.hart.x + as.n.x * middenOffsetPt,
    y: plaatsing.hart.y + as.n.y * middenOffsetPt,
  };
  const off = vakOffsetMm(vak, plaatsing.dagmaatMm / 2, T / 2);
  const cx = P0.x - (ex.x * off.dx + ey.x * off.dy) * k;
  const cy = P0.y - (ex.y * off.dx + ey.y * off.dy) * k;
  return {
    symbolId: SPARING_SYMBOOL[plaatsing.soort],
    color: '#000000', strokeColor: '#000000', lineWidth: 0.7,
    x: cx - breedte / 2, y: cy - hoogte / 2, width: breedte, height: hoogte,
    rotation: rotatie,
    params,
  };
}

// ── actie: wall met lagen (spouwmuur) ────────────────────────────────────

/**
 * Een wandloop met een laagopbouw (spouwmuur): per getekende laag eigen
 * wandstukken, per laag anders opgeknipt rond elk kozijn (aanslag in het
 * buitenblad, isolatie tegen het kozijn, dagkant met speling in het
 * binnenblad), en één kozijnsymbool per opening in het pakket. start/end is
 * het BUITENVLAK van het pakket; `insideSide` zegt aan welke kant binnen
 * is. Sluit het buitenvlak in een hoek aan op een eerder getekende gevel
 * met dezelfde lagen, dan worden de laageinden daar per laag verstekt.
 */
async function actieGelaagdeWand(params, omgeving, page, pxPerMm) {
  const start = params.start, end = params.end;
  const pakket = normaliseerPakket(params.layers);
  if (!pakket.lagen.some((l) => l.getekend)) {
    return fout('layers: at least one layer needs a material other than none');
  }
  const binnenzijde = params?.insideSide === 'left' ? 'links' : 'rechts';
  const binnenN = binnenzijde === 'rechts' ? 1 : -1;
  const T = pakket.dikteMm;
  const ref = {
    id: params?.wallId || `run:${Math.round(start.x)}:${Math.round(start.y)}`,
    startX: start.x, startY: start.y, endX: end.x, endY: end.y, dikteMm: T,
  };
  if (!wandAs(ref)) return fout('start and end are the same point');

  const sparingen = [];
  const klachten = [];
  (params?.openings || []).forEach((o, i) => {
    const s = leesOpening(o, i, ref, pakket);
    // Zonder opgegeven kant draait een deur naar binnen.
    if (!o?.openTo && !o?.openSide) s.draaizijde = -binnenN;
    const kozijn = { breedteMm: s.dagmaatMm, ...s.kozijn };
    s.laagMaten = pakket.lagen.map((l) => (l.getekend ? laagSparingMm(l, kozijn) : null));
    // Controle op de breedste sparing: die moet in de wand passen en mag
    // geen andere raken.
    s.breedsteMm = Math.max(s.dagmaatMm, ...s.laagMaten.filter((m) => m !== null));
    const controle = controleerSparing(
      ref, { ...s, dagmaatMm: s.breedsteMm },
      sparingen.map((x) => ({ ...x, dagmaatMm: x.breedsteMm })),
      pxPerMm, getal(params?.minPierMm) ?? 0,
    );
    if (!controle.ok) klachten.push(`opening ${i} (${o?.kind || s.soort}): ${controle.reden}`);
    else sparingen.push(s);
  });
  if (klachten.length) return { ok: false, error: klachten.join('; ') };

  const lijnen = laagLijnen(start, end, pakket, pxPerMm, binnenzijde);
  const bestaande = (omgeving.doc?.annotations || [])
    .filter((a) => a?.type === 'wall' && (a.page ?? 1) === page);
  const EPS = 1e-6;

  // Per laag: opknippen, hoeken zoeken, eerste en laatste stuk verstekken.
  const perLaag = [];
  const aanpassingen = [];
  let hoekenStart = 0, hoekenEind = 0;
  lijnen.forEach((lijn, i) => {
    if (!lijn.getekend) return;
    const laagWand = {
      id: `${ref.id}:${i}`, startX: lijn.startX, startY: lijn.startY,
      endX: lijn.endX, endY: lijn.endY, dikteMm: lijn.dikteMm,
    };
    const laagSparingen = sparingen.map((s) => ({ ...s, dagmaatMm: s.laagMaten[i] }));
    const { segmenten, lengteMm } = wandMetSparingen(laagWand, laagSparingen, pxPerMm);
    const lenPt = lengteMm * pxPerMm;
    const hStart = zoekLaagHoek(start, lijn, bestaande, { pxPerMm, binnenzijde });
    const hEind = zoekLaagHoek(end, lijn, bestaande, { pxPerMm, binnenzijde });
    const eerste = segmenten[0], laatste = segmenten[segmenten.length - 1];
    if (hStart && eerste && eerste.vanPt <= EPS) {
      eerste.startX = hStart.snijpunt.x; eerste.startY = hStart.snijpunt.y;
      aanpassingen.push(eindPatch(hStart));
      hoekenStart++;
    }
    if (hEind && laatste && laatste.totPt >= lenPt - EPS) {
      laatste.endX = hEind.snijpunt.x; laatste.endY = hEind.snijpunt.y;
      aanpassingen.push(eindPatch(hEind));
      hoekenEind++;
    }
    perLaag.push({ index: i, lijn, segmenten });
  });

  const wallIds = [];
  const openingIds = [];
  const lagenUit = [];
  await omgeving.transactie(async () => {
    for (const a of aanpassingen) await omgeving.werkBij(a.id, a.patch);
    for (const { index, lijn, segmenten } of perLaag) {
      const ids = [];
      for (const seg of segmenten) {
        const r = await omgeving.maak('wall', page, {
          startX: seg.startX, startY: seg.startY, endX: seg.endX, endY: seg.endY,
          dikteMm: lijn.dikteMm,
          hatchPattern: lijn.materiaal,
          ...(lijn.isolatie ? { isolatieType: lijn.isolatie } : {}),
        });
        if (r?.ok && r.id) { ids.push(r.id); wallIds.push(r.id); }
      }
      lagenUit.push({
        index, material: lijn.materiaal, thicknessMm: lijn.dikteMm, wallIds: ids,
        segments: segmenten.map((g) => ({ fromMm: Math.round(g.vanPt / pxPerMm), lengthMm: Math.round(g.lengteMm) })),
      });
    }
    const pakketInfo = { dikteMm: T, middenOffsetPt: (binnenN * T * pxPerMm) / 2, binnenN };
    for (const s of sparingen) {
      const p = sparingPlaatsing(ref, s, pxPerMm);
      if (!p) continue;
      const r = await omgeving.maak('parametricSymbol', page, kozijnProps(ref, p, s, pxPerMm, pakketInfo));
      if (r?.ok && r.id) openingIds.push(r.id);
    }
  });

  return {
    ok: true,
    page,
    wallIds,
    openingIds,
    lengthMm: Math.round((wandAs(ref).len / pxPerMm) * 10) / 10,
    thicknessMm: T,
    insideSide: binnenzijde === 'links' ? 'left' : 'right',
    layers: lagenUit,
    cavities: pakket.lagen
      .map((l, i) => ({ index: i, thicknessMm: l.dikteMm, drawn: l.getekend }))
      .filter((l) => !l.drawn)
      .map(({ index, thicknessMm }) => ({ index, thicknessMm })),
    corners: { start: hoekenStart, end: hoekenEind },
    openings: sparingen.map((s) => ({
      kind: KIND_VAN_SOORT[s.soort], widthMm: s.dagmaatMm, alongMm: s.hartMm,
      sillMm: s.borstweringMm, heightMm: s.hoogteMm,
      frame: {
        positionMm: s.kozijn.positieMm, depthMm: s.kozijn.diepteMm,
        overlapMm: s.kozijn.aanslagMm, clearanceMm: s.kozijn.spelingMm,
      },
      layerOpeningsMm: s.laagMaten,
    })),
  };
}

/** Patch voor het uiteinde van een bestaande laagwand dat in de hoek komt. */
function eindPatch(hoek) {
  const X = hoek.snijpunt;
  return {
    id: hoek.wand.id,
    patch: hoek.eind === 'start' ? { startX: X.x, startY: X.y } : { endX: X.x, endY: X.y },
  };
}

// ── actie: rooms ─────────────────────────────────────────────────────────

const RUIMTE_ZAAD = 'opsRuimteZaad';
const RUIMTE_NAAM = 'opsRuimteNaam';
const RUIMTE_NUMMER = 'opsRuimteNummer';

async function actieRuimten(params, omgeving, page) {
  const annotaties = omgeving.doc?.annotations || [];
  const wanden = omsluitingOpPagina(annotaties, page);
  if (!wanden.length) return fout('no wall annotations on this page');
  const pxPerMm = schaalOp(omgeving, page, middenVan(wanden));
  if (!pxPerMm) return fout('no measurement scale on this page - set it with app_set_measure_scale first');

  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, {
    pxPerMm, maxGatMm: getal(params?.maxOpeningMm) ?? 3000,
  });
  // De geplaatste ruimte (het ruimtevlak) bij een gevonden ruimte: zij draagt
  // naam en nummer; haar tags tonen die (ruimte-koppeling.js).
  const vlakVoor = (r) => geplaatsteRuimte(omgeving.doc?.annotations, page, ruimten, r);
  const verslag = (r, naam, vlak = vlakVoor(r)) => {
    const n = vlak ? (vlak[RUIMTE_NAAM] || null) : (naam || null);
    return {
      ...(vlak ? { id: vlak.id } : {}),
      name: n,
      ...(vlak?.[RUIMTE_NUMMER] ? { number: vlak[RUIMTE_NUMMER] } : {}),
      areaM2: Math.round(r.oppervlakteM2 * 100) / 100,
      perimeterM: Math.round(r.omtrekM * 100) / 100,
      labelPoint: r.labelPunt,
      wallIds: r.wandIds,
      label: ruimteLabel(n, r.oppervlakteM2),
      ...(vlak ? { tagIds: tagsVanRuimte(vlak, omgeving.doc?.annotations).map((t) => t.id) } : {}),
    };
  };

  // Naam en nummer op geplaatste ruimten zetten.
  if (Array.isArray(params?.names) && params.names.length && !params?.place && !params?.refresh) {
    const hernoemd = [];
    const klachten = [];
    await omgeving.transactie(async () => {
      for (const item of params.names) {
        const vlak = ruimteVoorVerwijzing(omgeving.doc?.annotations, page, ruimten, item);
        if (!vlak) {
          const waar = item?.id ? `id ${item.id}` : `(${item?.x}, ${item?.y})`;
          klachten.push(`names: no placed room for ${waar}`);
          continue;
        }
        await zetRuimteNaam(omgeving, vlak, item?.name, item?.number);
        const r = vlak[RUIMTE_ZAAD] ? ruimteBijZaad(ruimten, vlak[RUIMTE_ZAAD]) : null;
        hernoemd.push(r
          ? verslag(r, null, vlak)
          : { id: vlak.id, name: vlak[RUIMTE_NAAM] || null, number: vlak[RUIMTE_NUMMER] || null });
      }
    });
    return {
      ok: hernoemd.length > 0, page, renamed: hernoemd,
      ...(klachten.length ? { warnings: klachten } : {}),
    };
  }

  if (params?.refresh) {
    const bestaand = annotaties.filter((a) => (a.page ?? 1) === page && zaadVan(a));
    const bijgewerkt = [];
    const losgeraakt = [];
    await omgeving.transactie(async () => {
      for (const a of bestaand) {
        const tag = isRuimteTag(a);
        const eigenRuimte = tag ? ruimteVanTag(a, annotaties) : null;
        const naam = tag
          ? ((eigenRuimte ? eigenRuimte[RUIMTE_NAAM] : a.params?.naam) || null)
          : (a[RUIMTE_NAAM] || null);
        const r = ruimteBijZaad(ruimten, zaadVan(a));
        if (!r) { losgeraakt.push({ id: a.id, name: naam }); continue; }
        if (a.type === 'measureArea') {
          await omgeving.werkBij(a.id, { points: r.polygoon });
        } else if (tag) {
          // De tag houdt zijn plek ten opzichte van de ruimte; zijn
          // reservekopie volgt de ruimte (naam, nummer, oppervlakte).
          await omgeving.werkBij(a.id, {
            ...tagVolgtRuimte(a, r.labelPunt),
            params: {
              ...a.params,
              ...(eigenRuimte ? { naam: eigenRuimte[RUIMTE_NAAM] || '', nummer: eigenRuimte[RUIMTE_NUMMER] || '' } : {}),
              oppervlakteM2: Math.round(r.oppervlakteM2 * 100) / 100,
              ankerX: r.labelPunt.x, ankerY: r.labelPunt.y,
            },
          });
        } else {
          // Los naamlabel uit een eerdere versie: terug naar het labelpunt.
          await omgeving.werkBij(a.id, { x: r.labelPunt.x - (a.width || 0) / 2, y: r.labelPunt.y - (a.height || 0) / 2 });
        }
        const eigenVlak = a.type === 'measureArea' ? a : eigenRuimte;
        bijgewerkt.push({ ...verslag(r, naam, eigenVlak), id: a.id, ...(tag ? { kind: 'tag' } : {}) });
      }
    });
    return { ok: true, page, refreshed: bijgewerkt, detached: losgeraakt, openEnds: losseEinden };
  }

  const metSeeds = Array.isArray(params?.seeds) && params.seeds.length > 0;
  const zaden = metSeeds
    ? params.seeds
    : ruimten.map((r) => ({ x: r.labelPunt.x, y: r.labelPunt.y }));
  const gekozen = [];
  for (const z of zaden) {
    const r = ruimteBijZaad(ruimten, z);
    if (!r) continue;
    // Zonder seeds levert elk gevonden vlak een zaadpunt; bij een gevel uit
    // losse lagen vallen die in dezelfde (kleinste) ruimte. Die telt een keer.
    if (!metSeeds && gekozen.some((g) => g.ruimte === r)) continue;
    const nummer = z.number ?? z.nummer;
    gekozen.push({
      ruimte: r,
      zaad: { x: z.x, y: z.y },
      naam: z.name || z.naam || null,
      nummer: nummer != null && String(nummer).trim() ? String(nummer).trim() : null,
    });
  }
  if (!params?.place) {
    return {
      ok: true, page,
      rooms: gekozen.map((g) => verslag(g.ruimte, g.naam)),
      openEnds: losseEinden,
    };
  }

  const gemaakt = [];
  await omgeving.transactie(async () => {
    const vlakIds = [];
    for (const g of gekozen) {
      // Staat deze ruimte er al (bijvoorbeeld nadat haar tag verwijderd is),
      // dan geen tweede vlak: naam en nummer bijwerken als ze opgegeven zijn.
      let vlak = vlakVoor(g.ruimte);
      if (vlak) {
        if (g.naam || g.nummer) await zetRuimteNaam(omgeving, vlak, g.naam || undefined, g.nummer ?? undefined);
      } else {
        // Het ruimtevlak: ingetogen, zonder eigen label (dat is de tag).
        const r = await omgeving.maak('measureArea', page, {
          ...RUIMTE_VLAKSTIJL,
          points: g.ruimte.polygoon,
          measureName: g.naam || undefined,
          [RUIMTE_ZAAD]: g.zaad,
          [RUIMTE_NAAM]: g.naam,
          ...(g.nummer ? { [RUIMTE_NUMMER]: g.nummer } : {}),
        });
        if (r?.ok && r.id) {
          vlakIds.push(r.id);
          vlak = (omgeving.doc?.annotations || []).find((a) => a.id === r.id) || null;
        }
      }
      // Een ruimtetag: alleen als de ruimte er nog geen heeft. Hij toont naam,
      // nummer en oppervlakte van de ruimte; zijn params zijn een reservekopie.
      let tagId = vlak ? (tagsVanRuimte(vlak, omgeving.doc?.annotations)[0]?.id || null) : null;
      if (!tagId) {
        const tagParams = {
          naam: (vlak ? vlak[RUIMTE_NAAM] : g.naam) || '',
          nummer: (vlak ? vlak[RUIMTE_NUMMER] : g.nummer) || '',
          oppervlakteM2: Math.round(g.ruimte.oppervlakteM2 * 100) / 100,
          decimalen: 1,
          toonOppervlakte: true,
          zaadX: vlak?.[RUIMTE_ZAAD]?.x ?? g.zaad.x,
          zaadY: vlak?.[RUIMTE_ZAAD]?.y ?? g.zaad.y,
          ankerX: g.ruimte.labelPunt.x, ankerY: g.ruimte.labelPunt.y,
        };
        const tag = await omgeving.maak('parametricSymbol', page, {
          ...RUIMTETAG_STIJL,
          symbolId: RUIMTETAG_ID,
          ...ruimteTagVak(g.ruimte.labelPunt, tagParams, RUIMTETAG_TEKST_PT),
          params: tagParams,
        });
        tagId = tag?.ok ? tag.id : null;
      }
      gemaakt.push({ ...verslag(g.ruimte, g.naam, vlak), id: vlak?.id || null, tagId });
    }
    // Ruimten achter de wanden en kozijnen, zodat een deurdraai zichtbaar blijft.
    const volgorde = ruimtenAchterBouwdelen(omgeving.doc?.annotations, vlakIds, page);
    if (volgorde && typeof omgeving.herorden === 'function') await omgeving.herorden(volgorde);
  });
  return { ok: true, page, placed: gemaakt, openEnds: losseEinden };
}

/** Het geplaatste ruimtevlak voor een gevonden ruimte (via zijn zaadpunt). */
function geplaatsteRuimte(annotaties, page, ruimten, r) {
  return (annotaties || []).find((a) => (a.page ?? 1) === page && isRuimteVlak(a)
    && a[RUIMTE_ZAAD] && ruimteBijZaad(ruimten, a[RUIMTE_ZAAD]) === r) || null;
}

/** Een geplaatste ruimte aangewezen met `{id}` of met een punt `{x, y}` erin. */
function ruimteVoorVerwijzing(annotaties, page, ruimten, item) {
  const lijst = (annotaties || []).filter((a) => (a.page ?? 1) === page && isRuimteVlak(a));
  if (item?.id) return lijst.find((a) => a.id === item.id) || null;
  const x = getal(item?.x), y = getal(item?.y);
  if (x === null || y === null) return null;
  const r = ruimteBijZaad(ruimten, { x, y });
  const viaWanden = r ? geplaatsteRuimte(annotaties, page, ruimten, r) : null;
  if (viaWanden) return viaWanden;
  // De wanden zijn veranderd: dan het vlak zelf waar het punt in valt.
  return lijst.find((a) => Array.isArray(a.points) && a.points.length >= 3 && puntInPolygoon({ x, y }, a.points)) || null;
}

/** Naam en/of nummer op de ruimte zetten; de reservekopie in haar tags volgt. */
async function zetRuimteNaam(omgeving, vlak, naam, nummer) {
  const patch = ruimteNaamPatch(naam, nummer);
  if (!Object.keys(patch).length) return;
  await omgeving.werkBij(vlak.id, patch);
  for (const t of tagsVanRuimte(vlak, omgeving.doc?.annotations)) {
    await omgeving.werkBij(t.id, {
      params: {
        ...t.params,
        ...('opsRuimteNaam' in patch ? { naam: patch.opsRuimteNaam } : {}),
        ...('opsRuimteNummer' in patch ? { nummer: patch.opsRuimteNummer } : {}),
      },
    });
  }
}

/** Het zaadpunt van een geplaatst ruimte-onderdeel (vlak, tag of oud label). */
function zaadVan(a) {
  if (isRuimteTag(a)) {
    const x = getal(a.params?.zaadX), y = getal(a.params?.zaadY);
    return x !== null && y !== null ? { x, y } : null;
  }
  const z = a?.[RUIMTE_ZAAD];
  return z && getal(z.x) !== null && getal(z.y) !== null ? z : null;
}

/**
 * Tekenvolgorde met de ruimtevlakken `ids` direct ACHTER de eerste wand of
 * het eerste kozijn van de pagina, zodat wanden, deurdraaien en ramen er
 * bovenop liggen. De rest van de volgorde blijft staan (een onderlegger
 * onderin blijft onderin). Geeft de ids van alle annotaties, van achter naar
 * voor, of null als er niets te verschuiven is.
 */
export function ruimtenAchterBouwdelen(annotaties, ids, page) {
  const lijst = annotaties || [];
  const achter = new Set((ids || []).filter(Boolean));
  if (!achter.size) return null;
  const bouwdeel = (a) => (a?.page ?? 1) === page && !achter.has(a.id)
    && (a.type === 'wall' || (a.type === 'parametricSymbol' && SPARING_SYMBOOL_IDS.has(a.symbolId)));
  const eerste = lijst.findIndex(bouwdeel);
  if (eerste < 0) return null;
  const verplaatst = lijst.filter((a) => achter.has(a.id));
  if (verplaatst.every((a) => lijst.indexOf(a) < eerste)) return null;
  const rest = lijst.filter((a) => !achter.has(a.id));
  const plek = rest.findIndex(bouwdeel);
  return [...rest.slice(0, plek), ...verplaatst, ...rest.slice(plek)].map((a) => a.id);
}

const SPARING_SYMBOOL_IDS = new Set(Object.values(SPARING_SYMBOOL));

// ── actie: dimensions ────────────────────────────────────────────────────

const ANKER_START = 'opsAnkerStart';
const ANKER_EIND = 'opsAnkerEind';
const MAAT_OFFSET = 'opsMaatOffsetMm';
const MAAT_ZIJDE = 'opsMaatZijde';
const MAAT_ROL = 'opsMaatRol';
const KETTING_ID = 'opsKettingId';

let kettingTeller = 0;
function nieuwKettingId() {
  kettingTeller += 1;
  return `ketting-${Date.now().toString(36)}-${kettingTeller}`;
}

async function actieMaten(params, omgeving, page) {
  // Een bestaande ketting verlengen of inkorten.
  if (params?.chainOf) return actieKettingBewerken(params, omgeving);
  const annotaties = omgeving.doc?.annotations || [];
  const pxPerMm = schaalOp(omgeving, page, middenVan(wandenOpPagina(annotaties, page)));
  if (!pxPerMm) return fout('no measurement scale on this page - set it with app_set_measure_scale first');

  if (params?.refresh) {
    const index = new Map(annotaties.map((a) => [a.id, a]));
    // Ook een maat met maar een verankerd eind (een los toegevoegd punt aan
    // de andere kant) schuift mee; het vrije eind blijft staan.
    const maten = annotaties
      .filter((a) => (a.page ?? 1) === page && (a[ANKER_START] || a[ANKER_EIND]))
      .map((a) => ({
        id: a.id, startX: a.startX, startY: a.startY, endX: a.endX, endY: a.endY,
        leaderStartX: a.leaderStartX, leaderStartY: a.leaderStartY,
        leaderEndX: a.leaderEndX, leaderEndY: a.leaderEndY,
        ankerStart: a[ANKER_START], ankerEind: a[ANKER_EIND],
        offsetMm: getal(a[MAAT_OFFSET]) ?? 0, zijde: getal(a[MAAT_ZIJDE]) ?? 1,
      }));
    // Alle wanden van de pagina: voor het wandvlak, de buitenste laag en de
    // buitenhoek van vlak-ankers.
    const uit = herberekenMaten(maten, index, { pxPerMm, wanden: wandenOpPagina(annotaties, page) });
    await omgeving.transactie(async () => {
      for (const b of uit.bijgewerkt) await omgeving.werkBij(b.id, b.patch);
    });
    return {
      ok: true, page,
      updated: uit.bijgewerkt.map((b) => ({ id: b.id, lengthMm: Math.round(b.lengteMm) })),
      detached: uit.losgeraakt.map((d) => d.id),
      unchanged: uit.ongewijzigd,
    };
  }

  const ids = Array.isArray(params?.wallIds) && params.wallIds.length
    ? params.wallIds
    : (params?.wallId ? [params.wallId] : []);
  if (!ids.length) return fout('action "dimensions" needs wallIds (in order along the run) or refresh:true');
  const perId = new Map(annotaties.map((a) => [a.id, a]));
  const wanden = ids.map((id) => perId.get(id));
  if (wanden.some((w) => !w || w.type !== 'wall')) {
    return fout('wallIds must all be existing wall annotations');
  }
  const eerste = wanden[0], laatste = wanden[wanden.length - 1];
  if (!wandAs({
    startX: eerste.startX, startY: eerste.startY, endX: laatste.endX, endY: laatste.endY,
  })) return fout('the wall run has no length');

  // Kettingpunten op het wandvlak aan de maatzijde (buitenste laag), de
  // uiterste punten op de buitenhoek van het gebouw.
  const zijde = params?.side === 'left' || getal(params?.side) === -1 ? -1 : 1;
  const punten = kettingLangsWandvlak(
    wanden.map((w) => ({
      id: w.id, startX: w.startX, startY: w.startY, endX: w.endX, endY: w.endY,
      dikteMm: getal(w.dikteMm) || 100,
    })),
    { zijde, wanden: wandenOpPagina(annotaties, page), pxPerMm },
  );
  // Afstanden vanaf het wandvlak; zonder opgave groeien ze mee met de schaal,
  // zodat ketting, totaal en hun teksten elkaar niet raken.
  const stijl = { ...PLATTEGROND_MAATSTIJL, dimShowUnit: params?.showUnit === true };
  const afstanden = standaardMaatAfstanden(pxPerMm, stijl, getal(params?.offsetMm));
  const offsetMm = afstanden.offsetMm;
  const totaalOffsetMm = getal(params?.totalOffsetMm) ?? afstanden.totaalOffsetMm;
  const { maten } = maatketting(punten, { pxPerMm, offsetMm, totaalOffsetMm, zijde });
  if (!maten.length) return fout('nothing to dimension along this run');

  const gemaakt = [];
  // Eén id voor de hele ketting (tussenmaten en totaal), zodat hij later als
  // geheel te verlengen of in te korten is.
  const kettingId = nieuwKettingId();
  await omgeving.transactie(async () => {
    for (const m of maten) {
      const r = await omgeving.maak('measureDistance', page, {
        ...stijl,
        startX: m.startX, startY: m.startY, endX: m.endX, endY: m.endY,
        // Hulplijnen vanaf het wandvlak naar de maatlijn.
        leaderStartX: m.basis.van.x, leaderStartY: m.basis.van.y,
        leaderEndX: m.basis.tot.x, leaderEndY: m.basis.tot.y,
        // Uitloop alleen aan begin en eind van de hele ketting.
        dimOvershootEnds: m.einden,
        [ANKER_START]: m.ankerStart, [ANKER_EIND]: m.ankerEind,
        [MAAT_OFFSET]: m.rol === 'totaalmaat' ? totaalOffsetMm : offsetMm,
        [MAAT_ZIJDE]: zijde,
        [MAAT_ROL]: m.rol === 'totaalmaat' ? 'total' : 'chain',
        [KETTING_ID]: kettingId,
      });
      gemaakt.push({
        id: r?.ok ? r.id : null,
        role: m.rol === 'totaalmaat' ? 'total' : 'chain',
        lengthMm: Math.round(m.lengteMm),
      });
    }
  });
  return { ok: true, page, chainId: kettingId, dimensions: gemaakt };
}

// ── dimensions met chainOf: een ketting verlengen of inkorten ────────────

/** De maten van een ketting: zelfde ketting-id, anders alleen deze maat. */
function kettingLeden(annotaties, basis) {
  const id = basis[KETTING_ID];
  const leden = id
    ? annotaties.filter((a) => a?.type === 'measureDistance' && a[KETTING_ID] === id && (a.page ?? 1) === (basis.page ?? 1))
    : [basis];
  return {
    segmenten: leden.filter((a) => a[MAAT_ROL] !== 'total'),
    totaal: leden.find((a) => a[MAAT_ROL] === 'total') || null,
  };
}

function kettingVerslag(annotaties, basis, pxPerMm) {
  const { segmenten, totaal } = kettingLeden(annotaties, basis);
  const k = leesKetting(segmenten, totaal);
  const lengte = (m) => {
    const px = Math.hypot(m.endX - m.startX, m.endY - m.startY);
    return pxPerMm ? Math.round(px / pxPerMm) : Math.round(px);
  };
  return {
    points: (k?.punten || []).map((p) => ({ x: p.x, y: p.y, anchored: !!p.anker })),
    dimensions: [
      ...(k?.segmenten || []).map((m) => ({ id: m.id, role: 'chain', lengthMm: lengte(m) })),
      ...(totaal ? [{ id: totaal.id, role: 'total', lengthMm: lengte(totaal) }] : []),
    ],
  };
}

async function actieKettingBewerken(params, omgeving) {
  const annotaties = () => omgeving.doc?.annotations || [];
  const basis = annotaties().find((a) => a.id === params.chainOf);
  if (!basis || basis.type !== 'measureDistance') {
    return fout('chainOf must be the id of an existing dimension (measureDistance)');
  }
  const geldig = (lijst) => (Array.isArray(lijst) ? lijst : [])
    .filter((p) => p && getal(p.x) !== null && getal(p.y) !== null);
  const erbij = geldig(params.addPoints);
  const eraf = geldig(params.removePoints);
  if (!erbij.length && !eraf.length) return fout('chainOf needs addPoints and/or removePoints ({x, y} in page points)');
  const page = basis.page ?? 1;
  const pxPerMm = schaalOp(omgeving, page, { x: basis.startX, y: basis.startY });
  const klachten = [];

  await omgeving.transactie(async () => {
    // Een losse maat wordt een ketting.
    if (!basis[KETTING_ID]) {
      await omgeving.werkBij(basis.id, { [KETTING_ID]: nieuwKettingId(), [MAAT_ROL]: basis[MAAT_ROL] || 'chain' });
    }
    const voerUit = async (plan) => {
      const perId = new Map(annotaties().map((a) => [a.id, a]));
      for (const w of plan.wijzig) await omgeving.werkBij(w.id, wijzigPatch(w));
      for (const n of plan.nieuw) {
        await omgeving.maak('measureDistance', page, nieuwSegment(perId.get(n.sjabloon), n));
      }
      for (const id of plan.weg) {
        if (typeof omgeving.verwijder === 'function') await omgeving.verwijder(id);
      }
    };
    for (const p of erbij) {
      const { segmenten, totaal } = kettingLeden(annotaties(), basis);
      const k = leesKetting(segmenten, totaal);
      // Snapt het punt op een wandvlak, dan hangt het voortaan aan die wand.
      const anker = pxPerMm ? ankerVoorPunt(p, wandenOpPagina(annotaties(), page), pxPerMm) : null;
      const plan = puntToevoegen(k, { x: getal(p.x), y: getal(p.y) }, anker);
      if (!plan.ok) { klachten.push(`addPoint (${p.x}, ${p.y}): ${plan.fout}`); continue; }
      await voerUit(plan);
    }
    for (const p of eraf) {
      const { segmenten, totaal } = kettingLeden(annotaties(), basis);
      const k = leesKetting(segmenten, totaal);
      const i = puntBij(k, { x: getal(p.x), y: getal(p.y) }, getal(params.tolerance) ?? 6);
      const plan = puntVerwijderen(k, i);
      if (!plan.ok) { klachten.push(`removePoint (${p.x}, ${p.y}): ${plan.fout}`); continue; }
      await voerUit(plan);
    }
  });
  // De basis kan zelf verwijderd zijn: verslag via een overgebleven lid.
  const nuBasis = annotaties().find((a) => a.id === basis.id)
    || annotaties().find((a) => a[KETTING_ID] && a[KETTING_ID] === basis[KETTING_ID]);
  const verslag = nuBasis ? kettingVerslag(annotaties(), nuBasis, pxPerMm) : { points: [], dimensions: [] };
  return {
    ok: klachten.length < erbij.length + eraf.length,
    page,
    chainId: nuBasis?.[KETTING_ID] || null,
    ...verslag,
    ...(klachten.length ? { warnings: klachten } : {}),
  };
}

// ── actie: inspect ───────────────────────────────────────────────────────

/** Het kozijn van een door/window-symbool zoals het getekend wordt. */
function kozijnVerslag(a) {
  const soort = a.symbolId === 'window' ? 'raam' : 'deur';
  // Een oude deur zonder wanddikte heeft nog geen kozijnopbouw.
  if (!(getal(a.params?.wallThickness) > 0)) return { wallThicknessMm: null, frame: null };
  const m = kozijnMaten(soort, a.params);
  return {
    wallThicknessMm: m.wandDikteMm,
    frame: {
      stileWidthMm: m.stijlBreedteMm, depthMm: m.stijlDiepteMm, positionMm: m.positieMm,
      overlapMm: m.aanslagMm, clearanceMm: m.spelingMm,
    },
  };
}

async function actieInspect(params, omgeving, page) {
  const annotaties = omgeving.doc?.annotations || [];
  const wanden = wandenOpPagina(annotaties, page);
  const pxPerMm = schaalOp(omgeving, page, middenVan(wanden));
  const kozijnen = sparingenOpPagina(annotaties, page);
  const maten = annotaties.filter((a) => (a.page ?? 1) === page && a[ANKER_START] && a[ANKER_EIND]);

  const verslag = {
    ok: true,
    page,
    scalePxPerMm: pxPerMm ? Math.round(pxPerMm * 1e6) / 1e6 : null,
    walls: wanden.map((w) => ({
      id: w.id, thicknessMm: w.dikteMm,
      lengthMm: pxPerMm ? Math.round(wandAs(w).len / pxPerMm) : null,
      start: { x: w.startX, y: w.startY }, end: { x: w.endX, y: w.endY },
      joinStart: !w.noJoinStart, joinEnd: !w.noJoinEnd,
    })),
    openings: kozijnen.map((a) => ({
      id: a.id,
      kind: a.symbolId,
      widthMm: getal(a.params?.dagmaatMm) ?? getal(a.params?.width),
      sillMm: getal(a.params?.borstweringMm),
      heightMm: getal(a.params?.hoogteMm),
      hostWallId: a.params?.hostWallId || null,
      ...kozijnVerslag(a),
    })),
    anchoredDimensions: maten.length,
    facadeElements: gevelelementenOpPagina(annotaties, page).map((a) => {
      const lay = gevelIndeling(a.params, a.symbolId);
      return {
        id: a.id,
        preset: a.symbolId === 'kozijn' ? 'windowFrame' : 'curtainWall',
        lengthMm: Math.round(lay.lengteMm),
        fields: lay.velden.length,
        hostWallId: a.params?.host?.wandId ?? null,
      };
    }),
  };
  if (!pxPerMm || !wanden.length) {
    verslag.rooms = [];
    verslag.openEnds = [];
    if (!pxPerMm) verslag.warning = 'no measurement scale on this page';
    return verslag;
  }
  const { ruimten, losseEinden } = ruimtenUitWanden(omsluitingOpPagina(annotaties, page), {
    pxPerMm, maxGatMm: getal(params?.maxOpeningMm) ?? 3000,
  });
  verslag.rooms = ruimten.map((r) => {
    // Een geplaatste ruimte: met haar id, naam, nummer en tags.
    const vlak = geplaatsteRuimte(annotaties, page, ruimten, r);
    return {
      ...(vlak ? {
        id: vlak.id,
        name: vlak[RUIMTE_NAAM] || null,
        number: vlak[RUIMTE_NUMMER] || null,
        tagIds: tagsVanRuimte(vlak, annotaties).map((t) => t.id),
      } : {}),
      areaM2: Math.round(r.oppervlakteM2 * 100) / 100,
      perimeterM: Math.round(r.omtrekM * 100) / 100,
      labelPoint: r.labelPunt,
      wallIds: r.wandIds,
    };
  });
  verslag.openEnds = losseEinden;
  return verslag;
}

// ── ingang ───────────────────────────────────────────────────────────────

/** De hele opdracht. `omgeving` levert de app-kant (zie kop van dit bestand). */
export async function plattegrondOpdracht(params, omgeving) {
  const actie = params?.action;
  if (!FLOORPLAN_ACTIES.includes(actie)) {
    return fout(`action must be one of: ${FLOORPLAN_ACTIES.join(', ')}`);
  }
  if (!omgeving?.doc) return fout('no active document');
  const p = paginaVan(params, omgeving);
  if (p.error) return fout(p.error);
  const paginas = getal(omgeving.doc.paginas);
  if (paginas && p.page > paginas) return fout(`page ${p.page} out of range (doc has ${paginas} pages)`);

  switch (actie) {
    case 'wall': return actieWand(params, omgeving, p.page);
    case 'rooms': return actieRuimten(params, omgeving, p.page);
    case 'dimensions': return actieMaten(params, omgeving, p.page);
    default: return actieInspect(params, omgeving, p.page);
  }
}
