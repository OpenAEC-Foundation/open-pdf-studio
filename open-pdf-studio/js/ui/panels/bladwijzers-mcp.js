// MCP-opdracht app_bookmarks: de bladwijzers (outline) van het actieve
// document opvragen, toevoegen, wijzigen (hernoemen, andere pagina, stijl),
// verwijderen en verplaatsen.
//
// De wijzigingen gaan door dezelfde functies als het bladwijzerpaneel
// (bladwijzer-bewerken.js): één ongedaan-maakstap per opdracht, het document
// gewijzigd, het paneel ververst; de saver schrijft de outline bij opslaan.
//
// `o` is de app; de tests geven een eigen omgeving.

import { boomVolgorde } from './bladwijzer-boom.js';
import {
  voegBladwijzerToe, wijzigBladwijzer, verwijderBladwijzersUit, plaatsBladwijzersIn,
} from './bladwijzer-bewerken.js';
import { fout, onbekendArgument, bewerkbaarDocument, hexKleur } from '../../core/mcp-document-regels.js';

export const BLADWIJZER_ACTIES = ['list', 'add', 'update', 'delete', 'move'];
export const MAX_TITEL = 1000;
const POSITIES = ['before', 'after', 'inside', 'end'];

async function appOmgeving() {
  const [st, beveiliging] = await Promise.all([
    import('../../core/state.js'),
    import('../../pdf/wachtwoord-pdf.js'),
  ]);
  // `bewerken` undefined: bladwijzer-bewerken.js gebruikt dan de app zelf.
  return { document: st.getActiveDocument, alleenLezen: beveiliging.isAlleenLezen, bewerken: undefined };
}

/** De echte ouder: null als parentId leeg is of naar niets wijst (zoals de saver). */
function ouderVan(opId, b) {
  return b.parentId != null && b.parentId !== b.id && opId.has(b.parentId) ? b.parentId : null;
}

/** Eén bladwijzer zoals de client hem ziet. */
function beschrijf(b, opId) {
  let level = 0;
  const gezien = new Set([b.id]);
  for (let p = ouderVan(opId, b); p != null && !gezien.has(p); p = ouderVan(opId, opId.get(p))) {
    gezien.add(p);
    level++;
  }
  const kinderen = [...opId.values()].filter((k) => ouderVan(opId, k) === b.id).length;
  return {
    id: b.id,
    title: b.title,
    page: b.page,
    parentId: ouderVan(opId, b),
    level,
    children: kinderen,
    bold: !!b.bold,
    italic: !!b.italic,
    color: b.color || null,
  };
}

/** Alle bladwijzers in de volgorde van het paneel (ouder vóór zijn kinderen). */
export function bladwijzerOverzicht(bookmarks) {
  const lijst = Array.isArray(bookmarks) ? bookmarks : [];
  const opId = new Map(lijst.map((b) => [b.id, b]));
  return boomVolgorde(lijst).map((id) => beschrijf(opId.get(id), opId));
}

function bladwijzerVan(doc, id) {
  const lijst = doc.bookmarks || [];
  const opId = new Map(lijst.map((b) => [b.id, b]));
  return opId.has(id) ? beschrijf(opId.get(id), opId) : null;
}

function titel(waarde) {
  if (typeof waarde !== 'string' || !waarde.trim()) return { error: 'title must be a non-empty string' };
  const t = waarde.trim();
  if (t.length > MAX_TITEL) return { error: `title is longer than ${MAX_TITEL} characters` };
  if ([...t].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return { error: 'title contains control characters or line breaks' };
  return { waarde: t };
}

function pagina(waarde, totaal) {
  if (!Number.isInteger(waarde) || waarde < 1 || waarde > totaal) {
    return { error: `page must be a page number from 1 to ${totaal}` };
  }
  return { waarde };
}

/** De stijlvelden die er staan (bold, italic, color), gecontroleerd. */
function stijl(p) {
  const uit = {};
  for (const veld of ['bold', 'italic']) {
    if (p[veld] === undefined) continue;
    if (typeof p[veld] !== 'boolean') return { error: `${veld} must be a boolean` };
    uit[veld] = p[veld];
  }
  if (p.color !== undefined) {
    if (p.color === null) uit.color = null;
    else {
      const kleur = hexKleur(p.color);
      if (!kleur) return { error: 'color must be #rrggbb or null' };
      uit.color = kleur;
    }
  }
  return { waarde: uit };
}

function idLijst(waarde, bestaand) {
  if (!Array.isArray(waarde) || waarde.length === 0 || waarde.some((id) => typeof id !== 'string' || !id)) {
    return { error: 'ids must be a non-empty array of bookmark ids (from action list)' };
  }
  const onbekend = waarde.find((id) => !bestaand.has(id));
  if (onbekend) return { error: `unknown bookmark id: ${onbekend}` };
  return { waarde: [...new Set(waarde)] };
}

/** Waar `ids` terechtkomen: { ouder, voor } voor plaatsBladwijzers. */
function plaatsVoor(doc, ids, doelId, positie) {
  const lijst = doc.bookmarks || [];
  const opId = new Map(lijst.map((b) => [b.id, b]));
  if (positie === 'end') return { ouder: null, voor: null };
  const doel = opId.get(doelId);
  if (positie === 'inside') return { ouder: doelId, voor: null };
  const ouder = ouderVan(opId, doel);
  if (positie === 'before') return { ouder, voor: doelId };
  // after: vóór de volgende broer die niet zelf verplaatst wordt, of achteraan.
  const weg = new Set(ids);
  const broers = boomVolgorde(lijst).filter((id) => ouderVan(opId, opId.get(id)) === ouder && (id === doelId || !weg.has(id)));
  return { ouder, voor: broers[broers.indexOf(doelId) + 1] ?? null };
}

export async function bookmarks(params, o) {
  const p = params || {};
  if (!BLADWIJZER_ACTIES.includes(p.action)) return fout(`action must be one of: ${BLADWIJZER_ACTIES.join(', ')}`);
  o = o || await appOmgeving();

  if (p.action === 'list') {
    const onbekend = onbekendArgument(p, ['action']);
    if (onbekend) return fout(onbekend);
    const { doc, fout: f } = bewerkbaarDocument(o, { lezen: true });
    if (f) return f;
    const lijst = bladwijzerOverzicht(doc.bookmarks);
    return { ok: true, count: lijst.length, bookmarks: lijst };
  }

  const toegestaan = {
    add: ['action', 'title', 'page', 'parentId', 'bold', 'italic', 'color'],
    update: ['action', 'id', 'title', 'page', 'bold', 'italic', 'color'],
    delete: ['action', 'ids'],
    move: ['action', 'ids', 'targetId', 'position'],
  }[p.action];
  const onbekend = onbekendArgument(p, toegestaan);
  if (onbekend) return fout(onbekend);
  const { doc, fout: f } = bewerkbaarDocument(o);
  if (f) return f;
  const totaal = doc.pdfDoc.numPages;
  const bestaand = new Set((doc.bookmarks || []).map((b) => b.id));

  if (p.action === 'add') {
    const t = titel(p.title);
    if (t.error) return fout(t.error);
    const pg = pagina(p.page ?? doc.currentPage ?? 1, totaal);
    if (pg.error) return fout(pg.error);
    if (p.parentId != null && (typeof p.parentId !== 'string' || !bestaand.has(p.parentId))) return fout(`unknown parentId: ${p.parentId}`);
    const s = stijl(p);
    if (s.error) return fout(s.error);
    const bm = await voegBladwijzerToe(doc, { title: t.waarde, page: pg.waarde, parentId: p.parentId ?? null, ...s.waarde }, o.bewerken);
    return { ok: true, bookmark: bladwijzerVan(doc, bm.id) };
  }

  if (p.action === 'update') {
    if (typeof p.id !== 'string' || !bestaand.has(p.id)) return fout(`unknown bookmark id: ${p.id}`);
    const wijziging = {};
    if (p.title !== undefined) {
      const t = titel(p.title);
      if (t.error) return fout(t.error);
      wijziging.title = t.waarde;
    }
    if (p.page !== undefined) {
      const pg = pagina(p.page, totaal);
      if (pg.error) return fout(pg.error);
      wijziging.page = pg.waarde;
    }
    const s = stijl(p);
    if (s.error) return fout(s.error);
    Object.assign(wijziging, s.waarde);
    if (Object.keys(wijziging).length === 0) return fout('nothing to update: give title, page, bold, italic or color');
    await wijzigBladwijzer(doc, p.id, wijziging, o.bewerken);
    return { ok: true, bookmark: bladwijzerVan(doc, p.id), changed: Object.keys(wijziging) };
  }

  if (p.action === 'delete') {
    const ids = idLijst(p.ids, bestaand);
    if (ids.error) return fout(ids.error);
    const weg = await verwijderBladwijzersUit(doc, ids.waarde, o.bewerken);
    return { ok: true, deleted: weg.map((b) => b.id), count: weg.length, remaining: (doc.bookmarks || []).length };
  }

  // move
  const ids = idLijst(p.ids, bestaand);
  if (ids.error) return fout(ids.error);
  if (!POSITIES.includes(p.position)) return fout(`position must be one of: ${POSITIES.join(', ')}`);
  if (p.position === 'end') {
    if (p.targetId != null) return fout('position end takes no targetId (it moves to the end of the top level)');
  } else if (typeof p.targetId !== 'string' || !bestaand.has(p.targetId)) {
    return fout(`unknown targetId: ${p.targetId}`);
  }
  const plaats = plaatsVoor(doc, ids.waarde, p.targetId, p.position);
  const verplaatst = await plaatsBladwijzersIn(doc, ids.waarde, plaats, o.bewerken);
  if (!verplaatst) {
    return fout('move refused: a bookmark cannot move into or next to itself or its own children, and nothing may stay the same', { moved: false });
  }
  return { ok: true, moved: ids.waarde, bookmarks: bladwijzerOverzicht(doc.bookmarks) };
}
