// Store voor het paneel "Markeringslagen" (#468).
//
// De lagen zelf staan op het document (doc.annotationLayers, zie
// annotations/annotatie-lagen.js voor de regels); deze store houdt alleen de
// zichtbaarheid van het paneel bij en een versieteller waarmee het paneel
// opnieuw rekent na een wijziging. Elke actie werkt op het actieve document,
// hertekent het canvas en haalt markeringen die niet meer aanklikbaar zijn
// (laag uit of op slot) uit de selectie.
//
// Vanilla JS gebruikt deze store via bridge.ts.

import { createSignal } from 'solid-js';
import i18next from '../../i18n/config.js';
import { getActiveDocument } from '../../core/state.js';
import { openDialog } from './dialogStore.js';
import {
  DEFAULT_LAYER_ID,
  addLayer, renameLayer, updateLayer, moveLayer, deleteLayer,
  getLayers, findLayer, layerDisplayName, nextLayerName,
  annotationsOnLayer, assignLayer, setCurrentLayer, layerIdOf,
} from '../../annotations/annotatie-lagen.js';

const [panelVisible, setPanelVisible] = createSignal(false);
const [layersVersion, setLayersVersion] = createSignal(0);

/** Het paneel opnieuw laten rekenen (lagen, aantallen, huidige laag). */
export function refreshAnnotationLayers() {
  setLayersVersion((v) => v + 1);
}

export function toggleAnnotationLayersPanel() {
  setPanelVisible(!panelVisible());
  refreshAnnotationLayers();
}

/** De weergavenaam van de standaardlaag in de huidige taal. */
export function defaultLayerName() {
  return i18next.t('ribbon:annotationLayers.defaultName');
}

// Herteken de annotatie-overlay (enkel of doorlopend), zoals elementVisibilityStore.
function redraw() {
  import('../../annotations/rendering.js').then((m) => {
    if (getActiveDocument()?.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => { /* renderer nog niet geladen */ });
}

// Een uitgezette of vergrendelde laag is niet aanklikbaar; wat al geselecteerd
// was, gaat eruit — anders kun je het nog verslepen of verwijderen.
async function snoeiSelectie(doc) {
  if (!doc || !Array.isArray(doc.selectedAnnotations) || doc.selectedAnnotations.length === 0) return;
  const { isAnnotationPickableInView } = await import('../../annotations/view-filters.js');
  const over = doc.selectedAnnotations.filter((a) => isAnnotationPickableInView(a));
  if (over.length === doc.selectedAnnotations.length) return;
  doc.selectedAnnotations = over;
  doc.selectedAnnotation = over.length ? over[over.length - 1] : null;
  const panel = await import('../../ui/panels/properties-panel.js');
  if (over.length === 0) panel.hideProperties();
  else if (over.length === 1) panel.showProperties(over[0]);
  else panel.showMultiSelectionProperties();
}

function markeerGewijzigd() {
  import('../../ui/chrome/tabs.js').then((m) => m.markDocumentModified()).catch(() => {});
}

function lijstBijwerken() {
  import('../../ui/panels/annotations-list.js').then((m) => m.updateAnnotationsList()).catch(() => {});
}

async function naWijziging(doc, { gewijzigd = true } = {}) {
  if (gewijzigd) markeerGewijzigd();
  refreshAnnotationLayers();
  redraw();
  await snoeiSelectie(doc);
  redraw();
}

/**
 * Voor vanilla JS (de MCP-brug): na een wijziging aan de lagen van het actieve
 * document het paneel, het canvas en de selectie bijwerken. `modified: false`
 * voor een wijziging die de tekening zelf niet raakt (de huidige laag).
 */
export function annotationLayersChanged({ modified = true } = {}) {
  return naWijziging(getActiveDocument(), { gewijzigd: modified });
}

/** Nieuwe laag achteraan, met de eerste vrije naam. Geeft het id terug. */
export function addAnnotationLayer() {
  const doc = getActiveDocument();
  if (!doc) return null;
  const naam = nextLayerName(doc, i18next.t('ribbon:annotationLayers.newName'));
  const r = addLayer(doc, { name: naam });
  if (!r.ok) return null;
  naWijziging(doc);
  return r.layer.id;
}

/** @returns {string|null} een foutcode (name-empty, name-taken, …) of null */
export function renameAnnotationLayer(id, naam) {
  const doc = getActiveDocument();
  if (!doc) return 'not-found';
  const huidig = findLayer(doc, id);
  if (huidig && huidig.name === String(naam ?? '').trim()) return null;
  const r = renameLayer(doc, id, naam);
  if (!r.ok) return r.error;
  naWijziging(doc);
  lijstBijwerken();
  return null;
}

/** Zichtbaar, afdrukbaar of vergrendeld aan- of uitzetten. */
export function setAnnotationLayerFlag(id, sleutel, waarde) {
  if (!['visible', 'printable', 'locked'].includes(sleutel)) return;
  const doc = getActiveDocument();
  if (!doc) return;
  if (updateLayer(doc, id, { [sleutel]: !!waarde }).ok) naWijziging(doc);
}

export function setAnnotationLayerColor(id, kleur) {
  const doc = getActiveDocument();
  if (!doc) return;
  if (updateLayer(doc, id, { color: kleur }).ok) naWijziging(doc);
}

/** Een laag één plek omhoog (-1) of omlaag (+1). */
export function moveAnnotationLayerBy(id, stap) {
  const doc = getActiveDocument();
  if (!doc) return;
  const i = getLayers(doc).findIndex((l) => l.id === id);
  if (i < 0) return;
  const naar = i + stap;
  if (naar < 0 || naar >= getLayers(doc).length) return;
  if (moveLayer(doc, id, naar).ok) naWijziging(doc);
}

/**
 * De huidige laag kiezen: daar landen nieuwe markeringen. Bewaard bij de
 * volgende keer opslaan, maar geen wijziging aan de tekening zelf.
 */
export function setCurrentAnnotationLayer(id) {
  const doc = getActiveDocument();
  if (!doc) return;
  if (setCurrentLayer(doc, id).ok) naWijziging(doc, { gewijzigd: false });
}

/**
 * Een laag verwijderen. Een lege laag gaat meteen weg; een laag met
 * markeringen vraagt eerst wat ermee moet gebeuren.
 */
export function requestDeleteAnnotationLayer(id) {
  const doc = getActiveDocument();
  if (!doc || id === DEFAULT_LAYER_ID) return;
  const laag = findLayer(doc, id);
  if (!laag) return;
  const op = annotationsOnLayer(doc, id);
  if (op.length === 0) {
    deleteAnnotationLayer(id, 'move');
    return;
  }
  openDialog('annotation-layer-delete', {
    layerId: id,
    name: layerDisplayName(laag, defaultLayerName()),
    count: op.length,
  });
}

/**
 * Een laag verwijderen en haar markeringen verplaatsen naar `doelId`
 * (keuze 'move') of mee verwijderen (keuze 'delete'). Het verplaatsen of
 * verwijderen van de markeringen is één undo-stap.
 */
export async function deleteAnnotationLayer(id, keuze = 'move', doelId = DEFAULT_LAYER_ID) {
  const doc = getActiveDocument();
  if (!doc || id === DEFAULT_LAYER_ID || !findLayer(doc, id)) return false;
  const doel = doelId !== id && findLayer(doc, doelId) ? doelId : DEFAULT_LAYER_ID;
  const op = annotationsOnLayer(doc, id);
  if (op.length > 0) {
    const undo = await import('../../core/undo-manager.js');
    if (keuze === 'delete') {
      undo.recordBulkDelete(op);
      const weg = new Set(op);
      doc.annotations = doc.annotations.filter((a) => !weg.has(a));
      doc.selectedAnnotations = (doc.selectedAnnotations || []).filter((a) => !weg.has(a));
      if (doc.selectedAnnotation && weg.has(doc.selectedAnnotation)) {
        doc.selectedAnnotation = doc.selectedAnnotations[0] || null;
      }
    } else {
      const { cloneAnnotation } = await import('../../annotations/factory.js');
      const voor = op.map(cloneAnnotation);
      assignLayer(op, doel);
      undo.recordBulkModify(op, voor);
    }
  }
  deleteLayer(doc, id);
  await naWijziging(doc);
  lijstBijwerken();
  return true;
}

/**
 * Markeringen naar een laag verplaatsen, als één undo-stap. Wat op een
 * uitgezette of vergrendelde laag belandt, gaat uit de selectie.
 * @returns {Promise<number>} hoeveel markeringen er verplaatst zijn
 */
export async function moveAnnotationsToAnnotationLayer(anns, id) {
  const doc = getActiveDocument();
  if (!doc || !findLayer(doc, id)) return 0;
  const te = (anns || []).filter((a) => a && layerIdOf(a) !== id);
  if (te.length === 0) return 0;
  const { cloneAnnotation } = await import('../../annotations/factory.js');
  const voor = te.map(cloneAnnotation);
  const n = assignLayer(te, id);
  const nu = new Date().toISOString();
  for (const a of te) a.modifiedAt = nu;
  const undo = await import('../../core/undo-manager.js');
  undo.recordBulkModify(te, voor);
  await naWijziging(doc, { gewijzigd: false });
  lijstBijwerken();
  return n;
}

/** De geselecteerde markeringen naar een laag. */
export function moveSelectionToAnnotationLayer(id) {
  const doc = getActiveDocument();
  return moveAnnotationsToAnnotationLayer([...(doc?.selectedAnnotations || [])], id);
}

export { panelVisible, setPanelVisible, layersVersion };
