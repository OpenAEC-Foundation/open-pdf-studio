// Bladwijzers toevoegen, wijzigen, verwijderen en verplaatsen zonder dialoog.
//
// Het paneel (bookmarks.js) vraagt titel en pagina in een dialoog en roept dan
// deze functies aan; de MCP-opdracht app_bookmarks roept dezelfde functies aan
// met de argumenten van de client. Zo krijgt elke wijziging dezelfde
// ongedaan-maakstap, wordt het document gewijzigd gemarkeerd en ververst het
// paneel, waar hij ook vandaan komt.
//
// `o` is de app (undo, tabbladen, paneel); de tests geven een nagebootste.

import { plaatsBladwijzers, verplaatsBladwijzers, verwijderBladwijzers } from './bladwijzer-boom.js';
import { doelVelden } from '../../pdf/bladwijzer-doel.js';

export function nieuweBladwijzerId() {
  return 'bm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

async function appOmgeving() {
  const [undo, tabs, paneel] = await Promise.all([
    import('../../core/undo-manager.js'),
    import('../chrome/tabs.js'),
    import('./bookmarks.js'),
  ]);
  return {
    legToevoegenVast: undo.recordAddBookmark,
    legWijzigingVast: undo.recordModifyBookmark,
    legVerwijderenVast: undo.recordRemoveBookmark,
    legLijstVast: undo.recordBookmarksChange,
    markeerGewijzigd: tabs.markDocumentModified,
    ververs: paneel.updateBookmarksList,
  };
}

/**
 * Een nieuwe bladwijzer achteraan onder `parentId` (null: de wortel).
 * @param {object} doc
 * @param {{title: string, page: number, left?: number|null, top?: number|null,
 *   parentId?: string|null, bold?: boolean, italic?: boolean, color?: string|null}} velden
 *   `left`/`top`: de plek op de pagina (PDF-punten, #1157); zonder: de pagina.
 * @returns {Promise<object>} de bladwijzer zoals hij in het document staat
 */
export async function voegBladwijzerToe(doc, velden, o) {
  o = o || await appOmgeving();
  if (!doc.bookmarks) doc.bookmarks = [];
  const parentId = velden.parentId ?? null;
  const doel = doelVelden({ page: velden.page, left: velden.left, top: velden.top });
  const bm = {
    id: nieuweBladwijzerId(),
    title: velden.title,
    page: velden.page,
    top: doel.top,
    left: doel.left,
    zoom: null,
    parentId,
    expanded: true,
    bold: !!velden.bold,
    italic: !!velden.italic,
    color: velden.color || null,
    sortOrder: doc.bookmarks.filter((b) => (b.parentId ?? null) === parentId).length,
    fromPdf: false,
  };
  // Een nieuwe onderliggende bladwijzer is zichtbaar: de ouder klapt open.
  if (parentId) {
    const ouder = doc.bookmarks.find((b) => b.id === parentId);
    if (ouder) ouder.expanded = true;
  }
  doc.bookmarks.push(bm);
  o.markeerGewijzigd(doc);
  o.legToevoegenVast(bm);
  o.ververs();
  return doc.bookmarks.find((b) => b.id === bm.id) || bm;
}

const DOEL_VELDEN = ['left', 'top', 'zoom', 'destType', 'destArgs'];

/**
 * Titel, pagina, plek en stijl van één bladwijzer wijzigen; alleen de velden
 * die in `wijziging` staan. Geeft de bladwijzer terug, of null als hij niet
 * bestaat.
 *
 * De plek (#1157) hoort bij de pagina: een andere pagina zonder nieuwe plek
 * wijst naar de bovenkant van die pagina, niet naar de oude hoogte op een
 * ander blad. Een nieuwe plek (`left`/`top`, zie doelVelden) vervangt het hele
 * doel, ook de vorm die een ander programma schreef.
 */
export async function wijzigBladwijzer(doc, id, wijziging, o) {
  o = o || await appOmgeving();
  const bm = (doc.bookmarks || []).find((b) => b.id === id);
  if (!bm) return null;
  // Alle doelvelden in de oude toestand: ongedaan maken zet ze dan ook terug
  // als de bladwijzer ze eerst niet had.
  const oud = { destType: null, destArgs: null, ...bm };
  const nieuwePlek = DOEL_VELDEN.some((veld) => veld in wijziging);
  if (nieuwePlek || ('page' in wijziging && wijziging.page !== bm.page)) {
    Object.assign(bm, doelVelden({
      page: 'page' in wijziging ? wijziging.page : bm.page,
      left: nieuwePlek ? wijziging.left : null,
      top: nieuwePlek ? wijziging.top : null,
    }));
  }
  for (const veld of ['title', 'page', 'bold', 'italic', 'color']) {
    if (!(veld in wijziging)) continue;
    if (veld === 'bold' || veld === 'italic') bm[veld] = !!wijziging[veld];
    else if (veld === 'color') bm.color = wijziging.color || null;
    else bm[veld] = wijziging[veld];
  }
  o.markeerGewijzigd(doc);
  o.legWijzigingVast(id, oud, { ...bm });
  o.ververs();
  return doc.bookmarks.find((b) => b.id === id) || bm;
}

/** De bladwijzers `ids` met alles eronder weg, als één stap. Geeft de verwijderde. */
export async function verwijderBladwijzersUit(doc, ids, o) {
  o = o || await appOmgeving();
  const { bookmarks, verwijderd } = verwijderBladwijzers(doc.bookmarks || [], ids);
  if (verwijderd.length === 0) return [];
  doc.bookmarks = bookmarks;
  o.markeerGewijzigd(doc);
  o.legVerwijderenVast(verwijderd);
  o.ververs();
  return verwijderd;
}

// Een nieuwe lijst in één keer: één toewijzing, één undo-stap.
async function vervangLijst(doc, oud, nieuw, o) {
  o = o || await appOmgeving();
  doc.bookmarks = nieuw;
  o.markeerGewijzigd(doc);
  o.legLijstVast(oud, nieuw);
  o.ververs();
  return true;
}

/**
 * Slepen in het paneel: `ids` vóór/na/in `doelId` ('before' | 'after' |
 * 'inside'), of achteraan in de wortel ('end', `doelId` null). Geeft false als
 * het niet mag (in zichzelf of een eigen kind) of niets verandert.
 */
export async function verplaatsBladwijzersIn(doc, ids, doelId, positie, o) {
  if (!doc?.bookmarks) return false;
  const oud = doc.bookmarks.map((b) => ({ ...b }));
  const nieuw = verplaatsBladwijzers(oud, ids, doelId, positie);
  if (!nieuw) return false;
  return vervangLijst(doc, oud, nieuw, o);
}

/**
 * `ids` onder `ouder` (null: de wortel), vóór `voor` (null: achteraan). Geeft
 * false als het niet mag (in zichzelf of een eigen kind, `voor` niet onder
 * `ouder`) of niets verandert.
 */
export async function plaatsBladwijzersIn(doc, ids, plaats, o) {
  if (!doc?.bookmarks) return false;
  const oud = doc.bookmarks.map((b) => ({ ...b }));
  const nieuw = plaatsBladwijzers(oud, ids, plaats);
  if (!nieuw) return false;
  return vervangLijst(doc, oud, nieuw, o);
}
