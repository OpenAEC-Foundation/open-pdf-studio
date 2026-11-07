// Een link maken of bewerken (#953): uit een tekstselectie (de vakken van de
// geselecteerde regels worden /QuadPoints) of uit een getrokken vak (het
// gereedschap 'link', tools/tools/link-tool.js). Daarna kiest de gebruiker het
// doel in het venster 'link' (LinkDialog.jsx); pas bij OK komt de link in het
// document, als één stap voor ongedaan maken.

import { state, getActiveDocument } from '../../core/state.js';
import { createAnnotation, cloneAnnotation } from '../factory.js';
import { recordAdd, recordModify } from '../../core/undo-manager.js';
import { openDialog } from '../../bridge.js';
import { getSelectionRectsForAnnotation, clearTextSelection } from '../../text/text-selection.js';
import { nieuweLinkVelden, vakUitRegels, normaliseerDoel, LINK_RANDEN, LINK_SOORT } from './link-model.js';

export const LINK_TOOL = 'link';
export const LINK_DIALOOG = 'link';

function herteken() {
  import('../rendering.js').then((m) => {
    if (getActiveDocument()?.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => {});
}

/**
 * Het vak van de huidige tekstselectie, of null zonder selectie.
 * @returns {{ page: number, vak: object }|null}
 */
export function selectieVak() {
  const rects = getSelectionRectsForAnnotation() || [];
  if (!rects.length) return null;
  const page = rects[0].page;
  const vak = vakUitRegels(rects.filter((r) => r.page === page));
  return vak ? { page, vak } : null;
}

/** Open het venster voor een nieuwe link op dit vak (app-ruimte). */
export function vraagNieuweLink(page, vak) {
  openDialog(LINK_DIALOOG, { nieuw: { page, vak } });
}

/** Open het venster om een bestaande link te bewerken. */
export function bewerkLink(ann) {
  if (!ann || ann.type !== LINK_SOORT || ann.locked) return;
  openDialog(LINK_DIALOOG, { annotationId: ann.id });
}

/**
 * Is er tekst geselecteerd, dan wordt die de link: de selectie gaat weg en het
 * venster opent. Synchroon, vóór het wisselen van gereedschap: daarna is de
 * tekstlaag niet meer selecteerbaar.
 * @returns {boolean} of de selectie gebruikt is
 */
export function neemSelectieOver() {
  const uitSelectie = selectieVak();
  if (!uitSelectie) return false;
  clearTextSelection();
  vraagNieuweLink(uitSelectie.page, uitSelectie.vak);
  return true;
}

async function magBewerken() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  const { isPdfAReadOnly } = await import('../../pdf/loader.js');
  return !isPdfAReadOnly();
}

/**
 * Link uit de tekstselectie, anders het gereedschap om een vak te trekken
 * (het lint en het menu Meer op mobiel; het palet kiest het gereedschap, dat
 * bij het aanzetten hetzelfde doet).
 */
export async function startLink() {
  if (!(await magBewerken())) return;
  if (neemSelectieOver()) return;
  const { setTool } = await import('../../tools/manager.js');
  setTool(LINK_TOOL);
}

/** Link uit de tekstselectie (contextmenu); niets zonder selectie. */
export async function linkUitSelectie() {
  if (!(await magBewerken())) return false;
  return neemSelectieOver();
}

/**
 * Wat het venster bewaart. `keuze` = { doel, rand, kleur, dikte }.
 * Nieuw: de link komt in het document (recordAdd) en wordt geselecteerd.
 * Bestaand: één wijzigingsstap (recordModify).
 * @returns {object|null} de link, of null als het doel ongeldig is
 */
export function bewaarLinkKeuze(data, keuze) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const aantal = doc.pdfDoc?.numPages || Infinity;
  const doel = normaliseerDoel(keuze?.doel, aantal);
  if (!doel) return null;
  const rand = LINK_RANDEN.includes(keuze.rand) ? keuze.rand : 'none';
  const kleur = keuze.kleur || undefined;
  const dikte = Number(keuze.dikte) > 0 ? Number(keuze.dikte) : 1;

  if (data?.nieuw) {
    const ann = createAnnotation(nieuweLinkVelden({
      page: data.nieuw.page, vak: data.nieuw.vak, doel, rand, kleur, dikte,
    }));
    doc.annotations.push(ann);
    recordAdd(ann);
    const inDoc = doc.annotations.find((a) => a.id === ann.id) || ann;
    doc.selectedAnnotations = [inDoc];
    doc.selectedAnnotation = inDoc;
    import('../../ui/panels/properties-panel.js').then((m) => m.showProperties(inDoc)).catch(() => {});
    herteken();
    if (state.currentTool === LINK_TOOL) {
      import('../../tools/manager.js').then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect()).catch(() => {});
    }
    return inDoc;
  }

  const ann = doc.annotations.find((a) => a.id === data?.annotationId);
  if (!ann || ann.locked) return null;
  const voor = cloneAnnotation(ann);
  ann.linkTarget = doel;
  ann.linkBorder = rand;
  if (kleur) { ann.color = kleur; ann.strokeColor = kleur; }
  ann.lineWidth = dikte;
  ann.modifiedAt = new Date().toISOString();
  recordModify(ann.id, voor, cloneAnnotation(ann));
  import('../../ui/panels/properties-panel.js').then((m) => m.showProperties(ann)).catch(() => {});
  herteken();
  return ann;
}

/**
 * Eén eigenschap van een link aanpassen vanuit het eigenschappenpaneel:
 * `patch` = { doel } en/of { rand }. Een ongeldig doel verandert niets.
 * Eén stap voor ongedaan maken.
 * @returns {boolean} of er iets veranderd is
 */
export function wijzigLink(ann, patch = {}) {
  const doc = getActiveDocument();
  if (!doc || !ann || ann.type !== LINK_SOORT || ann.locked) return false;
  const inDoc = doc.annotations.find((a) => a.id === ann.id) || ann;
  const voor = cloneAnnotation(inDoc);
  let veranderd = false;
  if ('doel' in patch) {
    const doel = normaliseerDoel(patch.doel, doc.pdfDoc?.numPages || Infinity);
    if (!doel) return false;
    if (JSON.stringify(doel) !== JSON.stringify(inDoc.linkTarget)) { inDoc.linkTarget = doel; veranderd = true; }
  }
  if ('rand' in patch && LINK_RANDEN.includes(patch.rand) && patch.rand !== (inDoc.linkBorder || 'none')) {
    inDoc.linkBorder = patch.rand;
    veranderd = true;
  }
  if (!veranderd) return false;
  inDoc.modifiedAt = new Date().toISOString();
  recordModify(inDoc.id, voor, cloneAnnotation(inDoc));
  import('../../ui/panels/properties-panel.js').then((m) => m.showProperties(inDoc)).catch(() => {});
  herteken();
  return true;
}
