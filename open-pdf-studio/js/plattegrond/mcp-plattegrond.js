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
//     transactie(fn)           -> Promise         (alles in één undo-stap)
//   }
//
// Alle invoer- en uitvoervelden zijn Engels: dit is de buitenkant van de
// MCP-opdracht.

import {
  SPARING_SOORTEN, SPARING_SYMBOOL, SPARING_STANDAARD,
  normaliseerSparing, wandMetSparingen, controleerSparing, sparingSymboolVak,
} from './sparing.js';
import { ruimtenUitWanden, ruimteBijZaad, ruimteLabel } from './ruimte.js';
import { maatketting, herberekenMaten, kettingUitWandstukken } from './maatvoering.js';
import { wandAs, projecteer } from '../annotations/wand-geometrie.js';
import { PRESETS as GEVEL_PRESETS } from '../gevelelement/catalogus.js';
import { indeling as gevelIndeling } from '../gevelelement/indeling.js';
import { twoPointEndpoints } from '../symbols/two-point.js';

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
  (params?.openings || []).forEach((o, i) => {
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
    s.raamtype = o?.windowType || 'fixed';
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

  const wallIds = [];
  const openingIds = [];
  await omgeving.transactie(async () => {
    for (const seg of segmenten) {
      const r = await omgeving.maak('wall', page, {
        startX: seg.startX, startY: seg.startY, endX: seg.endX, endY: seg.endY, ...stijl,
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

/**
 * Het kozijnsymbool in het gat. Een raam is de dag breed en de wand diep. Een
 * deur is de dag breed én diep (vierkant), met de scharnierlijn op het
 * wandvlak, zodat het draaisymbool de ruimte in zwaait; `draaizijde` kiest
 * aan welke kant van de wand dat is.
 */
export function kozijnProps(wand, plaatsing, bron, pxPerMm) {
  const as = wandAs(wand);
  const hoek = plaatsing.rotatie;
  const gedeeld = {
    symbolId: SPARING_SYMBOOL[plaatsing.soort],
    color: '#000000', strokeColor: '#000000', lineWidth: 0.7,
    params: {
      hostWallId: wand.id,
      hostAfstandMm: plaatsing.hartMm,
      width: plaatsing.dagmaatMm,
      dagmaatMm: plaatsing.dagmaatMm,
      borstweringMm: plaatsing.borstweringMm,
      hoogteMm: plaatsing.hoogteMm,
    },
  };
  if (plaatsing.soort === 'raam') {
    const vak = sparingSymboolVak(plaatsing);
    return {
      ...gedeeld, ...vak,
      params: { ...gedeeld.params, wallThickness: getal(wand.dikteMm) || 100, type: bron?.raamtype || 'fixed' },
    };
  }
  // Deur: vierkant vak met de scharnierlijn op één wandvlak, zodat het blad
  // en de boog de ruimte in draaien. `m` is de richting waarin de onderkant
  // van het vak (de scharnierlijn) ligt ná het draaien; het blad zwaait naar
  // -m, dus naar de andere kant van de wand.
  const zijde = getal(bron?.draaizijde) === -1 ? -1 : 1;
  const maat = plaatsing.breedtePt;
  const halveWand = ((getal(wand.dikteMm) || 100) * pxPerMm) / 2;
  const m = { x: -as.u.y * zijde, y: as.u.x * zijde };
  const verschuiving = halveWand - maat / 2;
  const cx = plaatsing.hart.x + m.x * verschuiving;
  const cy = plaatsing.hart.y + m.y * verschuiving;
  return {
    ...gedeeld,
    x: cx - maat / 2, y: cy - maat / 2, width: maat, height: maat,
    rotation: zijde < 0 ? hoek + 180 : hoek,
    params: {
      ...gedeeld.params,
      swing: plaatsing.draairichting === 'rechts' ? 'right' : 'left',
      angle: 90,
      showWall: false,
    },
  };
}

// ── actie: rooms ─────────────────────────────────────────────────────────

const RUIMTE_ZAAD = 'opsRuimteZaad';
const RUIMTE_NAAM = 'opsRuimteNaam';
const RUIMTE_LABEL = 'opsRuimteLabelVoor';

async function actieRuimten(params, omgeving, page) {
  const annotaties = omgeving.doc?.annotations || [];
  const wanden = omsluitingOpPagina(annotaties, page);
  if (!wanden.length) return fout('no wall annotations on this page');
  const pxPerMm = schaalOp(omgeving, page, middenVan(wanden));
  if (!pxPerMm) return fout('no measurement scale on this page - set it with app_set_measure_scale first');

  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, {
    pxPerMm, maxGatMm: getal(params?.maxOpeningMm) ?? 3000,
  });
  const verslag = (r, naam) => ({
    name: naam || null,
    areaM2: Math.round(r.oppervlakteM2 * 100) / 100,
    perimeterM: Math.round(r.omtrekM * 100) / 100,
    labelPoint: r.labelPunt,
    wallIds: r.wandIds,
    label: ruimteLabel(naam, r.oppervlakteM2),
  });

  if (params?.refresh) {
    const bestaand = annotaties.filter((a) => (a.page ?? 1) === page && a[RUIMTE_ZAAD]);
    const bijgewerkt = [];
    const losgeraakt = [];
    await omgeving.transactie(async () => {
      for (const a of bestaand) {
        const zaad = a[RUIMTE_ZAAD];
        const r = ruimteBijZaad(ruimten, zaad);
        if (!r) { losgeraakt.push({ id: a.id, name: a[RUIMTE_NAAM] || null }); continue; }
        if (a.type === 'measureArea') await omgeving.werkBij(a.id, { points: r.polygoon });
        else await omgeving.werkBij(a.id, { x: r.labelPunt.x - (a.width || 0) / 2, y: r.labelPunt.y - (a.height || 0) / 2 });
        bijgewerkt.push({ id: a.id, ...verslag(r, a[RUIMTE_NAAM]) });
      }
    });
    return { ok: true, page, refreshed: bijgewerkt, detached: losgeraakt, openEnds: losseEinden };
  }

  const zaden = Array.isArray(params?.seeds) && params.seeds.length
    ? params.seeds
    : ruimten.map((r) => ({ x: r.labelPunt.x, y: r.labelPunt.y }));
  const gekozen = [];
  for (const z of zaden) {
    const r = ruimteBijZaad(ruimten, z);
    if (r) gekozen.push({ ruimte: r, zaad: { x: z.x, y: z.y }, naam: z.name || z.naam || null });
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
    for (const g of gekozen) {
      const vlak = await omgeving.maak('measureArea', page, {
        points: g.ruimte.polygoon,
        [RUIMTE_ZAAD]: g.zaad,
        [RUIMTE_NAAM]: g.naam,
      });
      let labelId = null;
      if (g.naam) {
        const breedte = Math.max(40, g.naam.length * 7);
        const r = await omgeving.maak('textbox', page, {
          x: g.ruimte.labelPunt.x - breedte / 2, y: g.ruimte.labelPunt.y - 9,
          width: breedte, height: 18,
          text: g.naam,
          [RUIMTE_ZAAD]: g.zaad,
          [RUIMTE_NAAM]: g.naam,
          [RUIMTE_LABEL]: vlak?.id || null,
        });
        labelId = r?.ok ? r.id : null;
      }
      gemaakt.push({ id: vlak?.id || null, labelId, ...verslag(g.ruimte, g.naam) });
    }
  });
  return { ok: true, page, placed: gemaakt, openEnds: losseEinden };
}

// ── actie: dimensions ────────────────────────────────────────────────────

const ANKER_START = 'opsAnkerStart';
const ANKER_EIND = 'opsAnkerEind';
const MAAT_OFFSET = 'opsMaatOffsetMm';
const MAAT_ZIJDE = 'opsMaatZijde';
const MAAT_ROL = 'opsMaatRol';

async function actieMaten(params, omgeving, page) {
  const annotaties = omgeving.doc?.annotations || [];
  const pxPerMm = schaalOp(omgeving, page, middenVan(wandenOpPagina(annotaties, page)));
  if (!pxPerMm) return fout('no measurement scale on this page - set it with app_set_measure_scale first');

  if (params?.refresh) {
    const index = new Map(annotaties.map((a) => [a.id, a]));
    const maten = annotaties
      .filter((a) => (a.page ?? 1) === page && a[ANKER_START] && a[ANKER_EIND])
      .map((a) => ({
        id: a.id, startX: a.startX, startY: a.startY, endX: a.endX, endY: a.endY,
        ankerStart: a[ANKER_START], ankerEind: a[ANKER_EIND],
        offsetMm: getal(a[MAAT_OFFSET]) ?? 0, zijde: getal(a[MAAT_ZIJDE]) ?? 1,
      }));
    const uit = herberekenMaten(maten, index, { pxPerMm });
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

  const punten = kettingUitWandstukken(wanden);
  const offsetMm = getal(params?.offsetMm) ?? 500;
  const zijde = params?.side === 'left' || getal(params?.side) === -1 ? -1 : 1;
  const totaalOffsetMm = getal(params?.totalOffsetMm) ?? offsetMm + 350;
  const { maten } = maatketting(punten, { pxPerMm, offsetMm, totaalOffsetMm, zijde });
  if (!maten.length) return fout('nothing to dimension along this run');

  const gemaakt = [];
  await omgeving.transactie(async () => {
    for (const m of maten) {
      const r = await omgeving.maak('measureDistance', page, {
        startX: m.startX, startY: m.startY, endX: m.endX, endY: m.endY,
        [ANKER_START]: m.ankerStart, [ANKER_EIND]: m.ankerEind,
        [MAAT_OFFSET]: m.rol === 'totaalmaat' ? totaalOffsetMm : offsetMm,
        [MAAT_ZIJDE]: zijde,
        [MAAT_ROL]: m.rol === 'totaalmaat' ? 'total' : 'chain',
      });
      gemaakt.push({
        id: r?.ok ? r.id : null,
        role: m.rol === 'totaalmaat' ? 'total' : 'chain',
        lengthMm: Math.round(m.lengteMm),
      });
    }
  });
  return { ok: true, page, dimensions: gemaakt };
}

// ── actie: inspect ───────────────────────────────────────────────────────

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
    })),
    openings: kozijnen.map((a) => ({
      id: a.id,
      kind: a.symbolId,
      widthMm: getal(a.params?.dagmaatMm) ?? getal(a.params?.width),
      sillMm: getal(a.params?.borstweringMm),
      heightMm: getal(a.params?.hoogteMm),
      hostWallId: a.params?.hostWallId || null,
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
  verslag.rooms = ruimten.map((r) => ({
    areaM2: Math.round(r.oppervlakteM2 * 100) / 100,
    perimeterM: Math.round(r.omtrekM * 100) / 100,
    labelPoint: r.labelPunt,
    wallIds: r.wandIds,
  }));
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
