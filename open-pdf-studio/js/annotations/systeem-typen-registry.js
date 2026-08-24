// Systeemtype-registry — dunne, state-gebonden brug rond de pure
// systeem-typen-module. Zelfde patroon (en zelfde persistentie-mechanisme:
// app-preferences) als de tekeningtype-registry in annotations/drafting-rules.js.
//
// Importdiscipline: alleen core/state (licht), preferences lazy — deze module
// wordt door rendering/saver/stores gebruikt en mag geen cyclus vormen.
import { state } from '../core/state.js';
import {
  migrateSysteemTypen, findSysteemType, mergeSysteemType, updateSysteemTypeIn,
} from './systeem-typen.js';

/** Actuele (gemigreerde) systeemtype-data; seedt de defaults bij eerste
 *  gebruik en schrijft migraties terug in de preferences. */
export function getSysteemTypenData() {
  const cur = state.preferences?.systeemTypen;
  const next = migrateSysteemTypen(cur);
  if (next !== cur && state.preferences) {
    state.preferences.systeemTypen = next;
  }
  return next;
}

/** Systeemtype op id, of null. */
export function getSysteemTypeById(id) {
  return findSysteemType(getSysteemTypenData(), id);
}

/** Persisteer gewijzigde systeemtype-data (preferences-mechanisme). */
export function saveSysteemTypen(next) {
  if (next && state.preferences) state.preferences.systeemTypen = next;
  import('../core/preferences.js')
    .then(m => m.savePreferences && m.savePreferences())
    .catch(() => { /* buiten Tauri geen file-backend */ });
}

/** Registreer een uit een PDF meegereisd type-snapshot (bestaand id wint). */
export function ensureSysteemType(def) {
  const cur = getSysteemTypenData();
  const next = mergeSysteemType(cur, def);
  if (next !== cur) saveSysteemTypen(next);
}

/** Werk een type bij; alle instanties die ernaar verwijzen tekenen na de
 *  eerstvolgende redraw met de nieuwe definitie. */
export function updateSysteemType(id, patch) {
  const next = updateSysteemTypeIn(getSysteemTypenData(), id, patch);
  saveSysteemTypen(next);
}
