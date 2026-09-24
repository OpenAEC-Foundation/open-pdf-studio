// De opdracht achter `app_facade_element`: gevelelementen (vliesgevel,
// kozijn) aanmaken, bewerken en terugvragen.
//
// Net als mcp-plattegrond.js raakt deze module de app niet rechtstreeks aan;
// de app-kant komt binnen als `omgeving`:
//
//   {
//     doc:          { currentPage, annotations, paginas },
//     pxPerMmAt(page, x, y) -> number,
//     maak(type, page, props)  -> { ok, id }
//     werkBij(id, props)       -> { ok }
//     verwijder(id)            -> { ok }
//     transactie(fn)           -> Promise      (alles in één undo-stap)
//   }
//
// De buitenkant (invoer- en uitvoervelden) is Engels; intern gelden de
// Nederlandse namen uit de catalogus.

import { PRESETS } from './catalogus.js';
import {
  indeling, legVast, verdeelGelijk, zetVeldbreedtes, voegStijlToe, splitsVeld,
  verwijderStijl, verschuifStijl, wisselStijlType, wisselPaneel,
} from './indeling.js';
import { elementMaat } from './weergave.js';
import { geometrieNaParams, ptPerMm } from './element.js';
import { plaatsInWand, wandSnedePlan } from './wand-hosting.js';
import { syncTwoPointGeometry, twoPointEndpoints } from '../symbols/two-point.js';
import { ifcCategoryForParametric } from '../solid/data/ifcCategoryMap.js';

export const FACADE_ACTIES = Object.freeze([
  'create', 'get', 'addMullion', 'removeMullion', 'moveMullion',
  'setMullionType', 'setPanel', 'divide',
]);

const PRESET_VAN = { curtainWall: 'vliesgevel', windowFrame: 'kozijn', vliesgevel: 'vliesgevel', kozijn: 'kozijn' };
const PRESET_NAAR = { vliesgevel: 'curtainWall', kozijn: 'windowFrame' };
const PANEEL_VAN = { glass: 'glas', solid: 'dicht', door: 'deur', turnSash: 'draairaam', open: 'open' };
const PANEEL_NAAR = Object.fromEntries(Object.entries(PANEEL_VAN).map(([en, nl]) => [nl, en]));
const SCHARNIER_VAN = { start: 'begin', end: 'eind', begin: 'begin', eind: 'eind' };
const DRAAI_VAN = { inside: 'binnen', outside: 'buiten', binnen: 'binnen', buiten: 'buiten' };
const ZIJDE_VAN = { right: 'rechts', left: 'links', rechts: 'rechts', links: 'links' };

function getal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rond(v) {
  return Math.round(v * 10) / 10;
}

function fout(error) {
  return { ok: false, error };
}

/** Paneel uit de MCP-invoer: 'glass' of { type, hinge, swing }. */
export function paneelUitInvoer(p) {
  if (typeof p === 'string') return { type: PANEEL_VAN[p] ?? p };
  if (!p || typeof p !== 'object') return null;
  const uit = {};
  if (p.type !== undefined) uit.type = PANEEL_VAN[p.type] ?? p.type;
  if (p.hinge !== undefined) uit.scharnier = SCHARNIER_VAN[p.hinge] ?? p.hinge;
  if (p.swing !== undefined) uit.draaiNaar = DRAAI_VAN[p.swing] ?? p.swing;
  return uit;
}

function presetVanAnnotatie(a) {
  return a?.type === 'parametricSymbol' && PRESETS[a.symbolId] ? a.symbolId : null;
}

/** Het element zoals de buitenwereld het ziet. */
export function beschrijf(ann) {
  const presetId = presetVanAnnotatie(ann);
  const lay = indeling(ann.params, presetId);
  const l = twoPointEndpoints(ann);
  const host = ann.params?.host;
  return {
    id: ann.id,
    page: ann.page ?? 1,
    preset: PRESET_NAAR[presetId],
    start: { x: l.startX, y: l.startY },
    end: { x: l.endX, y: l.endY },
    lengthMm: rond(lay.lengteMm),
    depthMm: rond(lay.diepteMm),
    insideSide: lay.binnenzijde === 'links' ? 'left' : 'right',
    mullions: lay.stijlen.map((s) => ({
      index: s.index,
      role: s.rol === 'begin' ? 'frameStart' : (s.rol === 'eind' ? 'frameEnd' : 'mullion'),
      atMm: rond(s.posMm),
      type: s.type,
      widthMm: s.breedteMm,
      depthMm: s.diepteMm,
    })),
    fields: lay.velden.map((v) => {
      const f = {
        index: v.index,
        fromMm: rond(v.vanMm),
        toMm: rond(v.totMm),
        widthMm: rond(v.breedteMm),
        clearWidthMm: rond(v.dagMm),
        panel: PANEEL_NAAR[v.paneel.type] ?? v.paneel.type,
      };
      if (v.paneel.scharnier) f.hinge = v.paneel.scharnier === 'eind' ? 'end' : 'start';
      if (v.paneel.draaiNaar) f.swing = v.paneel.draaiNaar === 'buiten' ? 'outside' : 'inside';
      return f;
    }),
    host: host ? {
      wallId: host.wandId, fromMm: rond(host.vanMm), lengthMm: rond(host.lengteMm),
      offsetMm: rond(host.offsetMm), thicknessMm: host.dikteMm,
    } : null,
  };
}

function paginaVan(params, omgeving) {
  const ruw = params?.page ?? omgeving.doc?.currentPage ?? 1;
  const page = Number(ruw);
  if (!Number.isInteger(page) || page < 1) return { error: 'invalid page (1-based integer)' };
  const paginas = getal(omgeving.doc?.paginas);
  if (paginas && page > paginas) return { error: `page ${page} out of range (doc has ${paginas} pages)` };
  return { page };
}

/** Een reeks bewerkingen na elkaar; de eerste fout stopt alles. */
function keten(params, presetId, stappen) {
  let p = params;
  for (const stap of stappen) {
    const r = stap(p, presetId);
    if (!r?.ok) return r || fout('edit failed');
    p = r.params;
  }
  return { ok: true, params: p };
}

function panelenStappen(params, lay) {
  const stappen = [];
  const lijst = params?.panels;
  if (lijst !== undefined && !Array.isArray(lijst)) return { error: 'panels must be a list' };
  if (Array.isArray(lijst) && lijst.length > lay.velden.length) {
    return { error: `panels has ${lijst.length} entries but there are ${lay.velden.length} fields` };
  }
  const standaard = params?.panel !== undefined ? paneelUitInvoer(params.panel) : null;
  for (let i = 0; i < lay.velden.length; i++) {
    const eigen = Array.isArray(lijst) && lijst[i] !== undefined && lijst[i] !== null ? paneelUitInvoer(lijst[i]) : null;
    const p = eigen || standaard;
    if (p) stappen.push((q, id) => wisselPaneel(q, id, i, p));
  }
  return { stappen };
}

// ── create ───────────────────────────────────────────────────────────────

async function actieMaak(params, omgeving, pageArg) {
  const presetId = PRESET_VAN[params?.preset ?? 'curtainWall'];
  if (!presetId) return fout('preset must be "curtainWall" or "windowFrame"');
  const annotaties = omgeving.doc?.annotations || [];
  const breedtes = Array.isArray(params?.fieldWidthsMm) ? params.fieldWidthsMm.map(getal) : null;
  if (breedtes && breedtes.some((b) => !(b > 0))) return fout('every entry of fieldWidthsMm must be a number > 0');
  const som = breedtes ? breedtes.reduce((a, b) => a + b, 0) : null;

  let page = pageArg;
  let lijn, k, host = null, snede = null;
  if (params?.wallId !== undefined) {
    const wandAnn = annotaties.find((a) => a?.id === params.wallId && a.type === 'wall');
    if (!wandAnn) return fout(`wallId ${params.wallId} is not a wall annotation`);
    page = wandAnn.page ?? 1;
    k = omgeving.pxPerMmAt(page, wandAnn.startX, wandAnn.startY);
    if (!(k > 0)) return fout('no measurement scale on this page - set it with app_set_measure_scale first');
    const lengteMm = getal(params?.lengthMm) ?? som;
    if (!(lengteMm > 0)) return fout('create in a wall needs lengthMm (or fieldWidthsMm)');
    if (som !== null && Math.abs(som - lengteMm) > 1) {
      return fout(`fieldWidthsMm add up to ${rond(som)} mm but lengthMm is ${rond(lengteMm)} mm`);
    }
    const plek = plaatsInWand(
      { id: wandAnn.id, startX: wandAnn.startX, startY: wandAnn.startY, endX: wandAnn.endX, endY: wandAnn.endY, dikteMm: wandAnn.dikteMm },
      { vanMm: getal(params?.fromMm), hartMm: getal(params?.alongMm), lengteMm, offsetMm: getal(params?.offsetMm) ?? 0 },
      k,
    );
    if (!plek.ok) return fout(plek.error);
    lijn = plek.lijn;
    host = plek.host;
    snede = wandSnedePlan(wandAnn, plek.stukken);
  } else {
    const s = params?.start, e = params?.end;
    if (!s || !e || ![s.x, s.y, e.x, e.y].every((v) => getal(v) !== null)) {
      return fout('create needs start:{x,y} and end:{x,y} in page points, or wallId with a position along the wall');
    }
    k = omgeving.pxPerMmAt(page, s.x, s.y);
    if (!(k > 0)) return fout('no measurement scale on this page - set it with app_set_measure_scale first');
    lijn = { startX: s.x, startY: s.y, endX: e.x, endY: e.y };
  }
  const lengte = Math.hypot(lijn.endX - lijn.startX, lijn.endY - lijn.startY) / k;
  if (!(lengte > 0)) return fout('start and end are the same point');
  if (som !== null && Math.abs(som - lengte) > 1) {
    return fout(`fieldWidthsMm add up to ${rond(som)} mm but the line is ${rond(lengte)} mm long`);
  }

  const basis = { lengte, binnenzijde: ZIJDE_VAN[params?.insideSide] ?? 'rechts' };
  if (params?.frameType !== undefined) basis.kader = [params.frameType, params.frameType];
  let r;
  if (breedtes) r = zetVeldbreedtes(basis, presetId, breedtes);
  else if (params?.fields !== undefined) r = verdeelGelijk(basis, presetId, params.fields);
  else r = { ok: true, params: legVast(basis, presetId) };
  if (!r.ok) return fout(r.error);
  // De verdeling is gezet op de lengte uit de lijn; die telt, niet de som.
  let p = { ...r.params, lengte };
  const lay = indeling(p, presetId);
  const stappen = [];
  if (params?.frameType !== undefined) {
    stappen.push((q, id) => wisselStijlType(q, id, 0, params.frameType));
    stappen.push((q, id) => wisselStijlType(q, id, lay.stijlen.length - 1, params.frameType));
  }
  if (params?.mullionType !== undefined) {
    for (const st of lay.stijlen.slice(1, -1)) stappen.push((q, id) => wisselStijlType(q, id, st.index, params.mullionType));
  }
  const pan = panelenStappen(params, lay);
  if (pan.error) return fout(pan.error);
  stappen.push(...pan.stappen);
  const k2 = keten(p, presetId, stappen);
  if (!k2.ok) return fout(k2.error);
  p = k2.params;
  if (host) p = { ...p, host };

  const ann = { type: 'parametricSymbol', symbolId: presetId, page, params: p };
  syncTwoPointGeometry(ann, lijn.startX, lijn.startY, lijn.endX, lijn.endY, elementMaat(p, presetId).bandMm * k);
  const props = {
    symbolId: presetId,
    params: p,
    startX: ann.startX, startY: ann.startY, endX: ann.endX, endY: ann.endY,
    x: ann.x, y: ann.y, width: ann.width, height: ann.height, rotation: ann.rotation,
    color: '#000000', strokeColor: '#000000', lineWidth: 0.5,
    ifcCategory: ifcCategoryForParametric(presetId),
  };

  let id = null;
  const wallIds = [];
  await omgeving.transactie(async () => {
    if (snede) {
      if (snede.wijzig) {
        await omgeving.werkBij(snede.wijzig.id, snede.wijzig.props);
        wallIds.push(snede.wijzig.id);
      }
      for (const w of snede.nieuw) {
        const rw = await omgeving.maak('wall', page, w);
        if (rw?.ok && rw.id) wallIds.push(rw.id);
      }
      if (snede.verwijder) await omgeving.verwijder(snede.verwijder);
    }
    const rs = await omgeving.maak('parametricSymbol', page, props);
    if (rs?.ok) id = rs.id;
  });
  if (!id) return fout('the element could not be created');
  const uit = { ok: true, ...beschrijf({ ...ann, id }) };
  if (snede) uit.wallIds = wallIds;
  return uit;
}

// ── bewerken ─────────────────────────────────────────────────────────────

function dichtsteStijl(lay, atMm, ookKader) {
  let beste = -1, afstand = Infinity;
  for (const s of lay.stijlen) {
    if (!ookKader && s.rol !== 'tussen') continue;
    const d = Math.abs(s.posMm - atMm);
    if (d < afstand) { afstand = d; beste = s.index; }
  }
  return beste;
}

function stijlIndex(params, lay, ookKader) {
  const i = getal(params?.mullion);
  if (i !== null) return Number.isInteger(i) ? i : -1;
  const at = getal(params?.atMm);
  if (at !== null) return dichtsteStijl(lay, at, ookKader);
  return null;
}

function bewerking(actie, params, presetId, lay) {
  switch (actie) {
    case 'addMullion': {
      const at = getal(params?.atMm);
      const veld = getal(params?.field);
      if (at !== null) return (p, id) => voegStijlToe(p, id, at, params?.mullionType);
      if (veld !== null) return (p, id) => splitsVeld(p, id, veld, params?.mullionType);
      return fout('addMullion needs atMm (position from the start) or field (split that field in the middle)');
    }
    case 'removeMullion': {
      const i = stijlIndex(params, lay, false);
      if (i === null) return fout('removeMullion needs mullion (index) or atMm (nearest mullion)');
      if (i < 0) return fout('there is no mullion to remove');
      return (p, id) => verwijderStijl(p, id, i);
    }
    case 'moveMullion': {
      const i = stijlIndex(params, lay, false);
      if (i === null) return fout('moveMullion needs mullion (index) or atMm (nearest mullion)');
      if (i < 0 || !lay.stijlen[i]) return fout('there is no mullion to move');
      const naar = getal(params?.toMm);
      const door = getal(params?.byMm);
      if (naar === null && door === null) return fout('moveMullion needs toMm (new position) or byMm (shift)');
      const doel = naar !== null ? naar : lay.stijlen[i].posMm + door;
      return (p, id) => verschuifStijl(p, id, i, doel);
    }
    case 'setMullionType': {
      if (params?.mullionType === undefined) return fout('setMullionType needs mullionType');
      const i = stijlIndex(params, lay, true);
      if (i === null) {
        // Zonder keuze: alle tussenstijlen.
        const stappen = lay.stijlen.slice(1, -1).map((s) => (p, id) => wisselStijlType(p, id, s.index, params.mullionType));
        return (p, id) => keten(p, id, stappen);
      }
      return (p, id) => wisselStijlType(p, id, i, params.mullionType);
    }
    case 'setPanel': {
      if (params?.panel === undefined) return fout('setPanel needs panel');
      const paneel = paneelUitInvoer(params.panel);
      if (!paneel) return fout('panel must be a panel type or an object {type, hinge, swing}');
      let velden;
      if (Array.isArray(params?.fieldIndexes)) velden = params.fieldIndexes.map(getal);
      else if (getal(params?.field) !== null) velden = [getal(params.field)];
      else if (getal(params?.atMm) !== null) {
        const at = getal(params.atMm);
        const v = lay.velden.find((f) => at >= f.vanMm && at <= f.totMm);
        velden = v ? [v.index] : [];
      } else return fout('setPanel needs field (index), fieldIndexes (list) or atMm');
      if (!velden.length || velden.some((v) => v === null)) return fout('no such field');
      return (p, id) => keten(p, id, velden.map((v) => (q, i2) => wisselPaneel(q, i2, v, paneel)));
    }
    case 'divide': {
      if (Array.isArray(params?.fieldWidthsMm)) return (p, id) => zetVeldbreedtes(p, id, params.fieldWidthsMm);
      if (getal(params?.fields) !== null) return (p, id) => verdeelGelijk(p, id, getal(params.fields));
      return fout('divide needs fields (number of equal fields) or fieldWidthsMm');
    }
    default:
      return fout(`unknown action ${actie}`);
  }
}

async function actieBewerk(actie, params, omgeving) {
  const annotaties = omgeving.doc?.annotations || [];
  const ann = annotaties.find((a) => a?.id === params?.id);
  if (!ann) return fout(`${actie} needs the id of a facade element`);
  const presetId = presetVanAnnotatie(ann);
  if (!presetId) return fout(`annotation ${params.id} is not a facade element`);
  if (ann.locked) return fout('the element is locked');
  const lay = indeling(ann.params, presetId);
  const bewerk = bewerking(actie, params, presetId, lay);
  if (typeof bewerk !== 'function') return bewerk;
  const r = bewerk(ann.params || {}, presetId);
  if (!r?.ok) return fout(r?.error || 'edit failed');
  const k = ptPerMm(ann, presetId);
  const werk = { ...ann, params: r.params };
  geometrieNaParams(werk, presetId, k);
  const patch = {
    params: r.params,
    startX: werk.startX, startY: werk.startY, endX: werk.endX, endY: werk.endY,
    x: werk.x, y: werk.y, width: werk.width, height: werk.height, rotation: werk.rotation,
  };
  await omgeving.transactie(async () => {
    await omgeving.werkBij(ann.id, patch);
  });
  return { ok: true, ...beschrijf({ ...ann, ...patch }) };
}

// ── get ──────────────────────────────────────────────────────────────────

function actieLees(params, omgeving, page) {
  const annotaties = omgeving.doc?.annotations || [];
  if (params?.id !== undefined) {
    const ann = annotaties.find((a) => a?.id === params.id);
    if (!ann || !presetVanAnnotatie(ann)) return fout(`annotation ${params.id} is not a facade element`);
    return { ok: true, ...beschrijf(ann) };
  }
  const lijst = annotaties.filter((a) => presetVanAnnotatie(a) && (a.page ?? 1) === page);
  return {
    ok: true,
    page,
    elements: lijst.map((a) => {
      const b = beschrijf(a);
      return {
        id: b.id, preset: b.preset, lengthMm: b.lengthMm,
        fields: b.fields.length, panels: b.fields.map((f) => f.panel),
        hostWallId: b.host?.wallId ?? null,
      };
    }),
  };
}

// ── ingang ───────────────────────────────────────────────────────────────

export async function gevelelementOpdracht(params, omgeving) {
  const actie = params?.action;
  if (!FACADE_ACTIES.includes(actie)) return fout(`action must be one of: ${FACADE_ACTIES.join(', ')}`);
  if (!omgeving?.doc) return fout('no active document');
  const p = paginaVan(params, omgeving);
  if (p.error) return fout(p.error);
  if (actie === 'create') return actieMaak(params, omgeving, p.page);
  if (actie === 'get') return actieLees(params, omgeving, p.page);
  return actieBewerk(actie, params, omgeving);
}
