// Stramienkoppeling in de app: het slotje bij een uiteinde, rechtsklik, het
// eigenschappenpaneel en de MCP-brug gaan allemaal via deze ene schakelaar,
// zodat ze dezelfde ongedaan-stap en dezelfde regels krijgen. Het rekenwerk
// staat in stramien-koppeling.js (puur en los getest).

import { getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { recordBulkModify } from '../core/undo-manager.js';
import { isLayerLocked } from './annotatie-lagen.js';
import i18next from '../i18n/config.js';
import {
  UITEINDEN, isStramien, planKoppeling, geraakteAnnotaties, pasKoppelingToe, slotStatus,
} from './stramien-koppeling.js';

/** Grepen van het slotje: `stramien_slot_begin` / `stramien_slot_einde`. */
export const SLOT_GREEP = 'stramien_slot_';

/** Het uiteinde bij een slot-greep, of null. */
export function slotUiteinde(greep) {
  if (typeof greep !== 'string' || !greep.startsWith(SLOT_GREEP)) return null;
  const eind = greep.slice(SLOT_GREEP.length);
  return UITEINDEN.includes(eind) ? eind : null;
}

/** Mag deze annotatie door een koppeling mee veranderen? */
export function magMeeVeranderen(doc, ann) {
  return !!ann && !ann.locked && !isLayerLocked(doc, ann);
}

/** 'dicht' | 'open' | null voor een uiteinde in het actieve document. */
export function stramienSlotStatus(ann, eind, doc = getActiveDocument()) {
  if (!doc || !isStramien(ann)) return null;
  return slotStatus(doc.annotations || [], ann, eind);
}

/**
 * Koppel (aan = true) of zet los (aan = false) één uiteinde; zonder `aan`
 * wisselt het slotje om. Eén ongedaan-stap voor alle lijnen die veranderen.
 * @returns {{ok:boolean, reden?:string, gewijzigd:number, status:string|null}}
 */
export function schakelStramienSlot(ann, eind, aan, { doc = getActiveDocument(), hertekenen = true } = {}) {
  if (!doc || !isStramien(ann) || !UITEINDEN.includes(eind)) {
    return { ok: false, reden: 'geen-stramien', gewijzigd: 0, status: null };
  }
  if (!magMeeVeranderen(doc, ann)) {
    return { ok: false, reden: 'vergrendeld', gewijzigd: 0, status: stramienSlotStatus(ann, eind, doc) };
  }
  const huidig = stramienSlotStatus(ann, eind, doc);
  const koppelen = aan === undefined ? huidig !== 'dicht' : !!aan;
  const plan = planKoppeling(doc.annotations || [], ann, eind, koppelen);
  if (!plan.ok) return { ok: false, reden: plan.reden, gewijzigd: 0, status: huidig };
  // Andere lijnen die niet mogen veranderen (vergrendeld, op een vergrendelde
  // laag) blijven buiten de koppeling.
  plan.wijzigingen = plan.wijzigingen.filter(w => w.ann === ann || magMeeVeranderen(doc, w.ann));
  const geraakt = geraakteAnnotaties(plan);
  if (!geraakt.length) return { ok: true, gewijzigd: 0, status: huidig };

  const originelen = geraakt.map(a => cloneAnnotation(a));
  pasKoppelingToe(plan);
  const nu = new Date().toISOString();
  for (const a of geraakt) a.modifiedAt = nu;
  recordBulkModify(geraakt, originelen);

  if (hertekenen) vernieuwWeergave(doc, ann);
  return { ok: true, gewijzigd: geraakt.length, status: stramienSlotStatus(ann, eind, doc) };
}

/** Menutekst voor een uiteinde: los zetten als het dicht is, anders koppelen. */
export function slotLabelSleutel(status) {
  return status === 'dicht' ? 'annotation.gridEndUnlock' : 'annotation.gridEndLock';
}

/** Tooltip bij het slotje onder de cursor, of null als het geen slotje is. */
export function slotTooltip(ann, greep) {
  const eind = slotUiteinde(greep);
  if (!eind || !isStramien(ann)) return null;
  const status = stramienSlotStatus(ann, eind);
  if (!status) return null;
  return i18next.t(`context:${slotLabelSleutel(status)}`);
}

/** Klik op een slot-greep van de geselecteerde stramienlijn. true = afgehandeld. */
export function verwerkSlotKlik(ann, greep) {
  const eind = slotUiteinde(greep);
  if (!eind || !isStramien(ann)) return false;
  schakelStramienSlot(ann, eind);
  return true;
}

function vernieuwWeergave(doc, ann) {
  import('./rendering.js').then((m) => {
    if (doc.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => {});
  if (doc.selectedAnnotation && doc.selectedAnnotation.id === ann.id) {
    import('../ui/panels/properties-panel.js')
      .then((m) => m.showProperties(ann))
      .catch(() => {});
  }
}
