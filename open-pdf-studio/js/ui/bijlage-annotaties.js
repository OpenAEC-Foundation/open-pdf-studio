// Bijlage-annotaties in de app (#376): plaatsen, openen en opslaan.
//
// Het model: { type: 'fileAttachment', x, y, width, height, icon, color,
// text (de beschrijving, /Contents), attachment: { key, name, description,
// mime, size, createdAt, modifiedAt, relationship, pdfjsId } }. De bytes
// staan in de bijlage-store (annotations/bijlage-store.js); de saver schrijft
// /FileAttachment met /FS en /EF (pdf/bijlage-annotatie.js).

import i18next from '../i18n/config.js';
import { state, getActiveDocument } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { recordAdd } from '../core/undo-manager.js';
import { layerForNewAnnotation } from '../annotations/annotatie-lagen.js';
import { showProperties } from './panels/properties-panel.js';
import { bewaarBijlageInhoud, bijlageInhoud } from '../annotations/bijlage-store.js';
import {
  BIJLAGE_ICOON_MAAT, STANDAARD_BIJLAGE_ICOON, STANDAARD_BIJLAGE_KLEUR,
} from '../annotations/bijlage-iconen.js';
import { showMessage } from '../solid/stores/dialogStore.js';

function nieuweId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

function hertekenen(doc) {
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/**
 * Een nieuwe bijlage-annotatie (zonder haar aan een document toe te voegen).
 * @param {{ x:number, y:number, page:number, name:string, bytes:Uint8Array, mime?:string }} p
 */
export function maakBijlageAnnotatie({ x, y, page, name, bytes, mime }) {
  const nu = new Date().toISOString();
  return {
    id: nieuweId(),
    type: 'fileAttachment',
    page,
    x,
    y,
    width: BIJLAGE_ICOON_MAAT,
    height: BIJLAGE_ICOON_MAAT,
    text: name,
    color: STANDAARD_BIJLAGE_KLEUR,
    icon: STANDAARD_BIJLAGE_ICOON,
    opacity: 1,
    author: state.defaultAuthor,
    createdAt: nu,
    modifiedAt: nu,
    locked: false,
    printable: true,
    attachment: {
      key: bewaarBijlageInhoud({ bytes }),
      name,
      description: name,
      mime: mime || null,
      size: bytes.length,
      createdAt: nu,
      modifiedAt: nu,
      relationship: null,
      pdfjsId: null,
    },
  };
}

/**
 * Het gereedschap: kies een bestand en zet het pictogram op (x, y).
 */
export async function plaatsBijlageAnnotatie(x, y, pageNum) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  const page = pageNum || doc.currentPage || 1;
  const { kiesBestanden, guessMimeType } = await import('./panels/attachments.js');
  let gekozen;
  try {
    gekozen = await kiesBestanden({ multiple: false });
  } catch (e) {
    console.error('Failed to pick attachment file:', e);
    return null;
  }
  if (!gekozen.length || getActiveDocument() !== doc) return null;
  const { name, bytes } = gekozen[0];
  const ann = maakBijlageAnnotatie({ x, y, page, name, bytes, mime: guessMimeType(name) });
  const laag = layerForNewAnnotation(doc);
  if (laag) ann.layer = laag;
  doc.annotations.push(ann);
  recordAdd(ann);
  doc.selectedAnnotations = [ann];
  doc.selectedAnnotation = ann;
  hertekenen(doc);
  showProperties(ann);
  ververstBijlagenPaneel();
  return ann;
}

function ververstBijlagenPaneel() {
  import('./panels/attachments.js').then((m) => m.updateAttachmentsList()).catch(() => {});
}

async function inhoudOfMelding(ann) {
  const inhoud = await bijlageInhoud(ann, getActiveDocument());
  if (inhoud?.bytes) return inhoud.bytes;
  showMessage(i18next.t('properties:attachment.noContent'));
  return null;
}

/** Dubbelklik of de knop Openen: het bestand in het standaardprogramma. */
export async function openBijlageAnnotatie(ann) {
  if (ann?.type !== 'fileAttachment') return;
  const bytes = await inhoudOfMelding(ann);
  if (!bytes) return;
  const { openAttachmentExternal } = await import('./panels/attachments.js');
  await openAttachmentExternal(ann.attachment?.name || 'attachment', bytes);
}

/** Opslaan als: het bestand naar schijf (of een download in de browser). */
export async function bewaarBijlageAnnotatie(ann) {
  if (ann?.type !== 'fileAttachment') return;
  const bytes = await inhoudOfMelding(ann);
  if (!bytes) return;
  const { saveAttachmentToDisk } = await import('./panels/attachments.js');
  await saveAttachmentToDisk(ann.attachment?.name || 'attachment', bytes);
}
