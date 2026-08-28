// Registratie + persistentie voor gedownloade linework-catalogi.
//
// Zelfde opzet als steel-catalog-store.js: een gedownloade
// `linework-variants`-catalogus wordt een set parametrische templates in de
// gedeelde registry (één per familie) en wordt bewaard in
// state.preferences.lineworkCatalogs, zodat de templates na een herstart
// terugkomen. De palette-groep zelf persist via het bestaande
// custom-groups-mechanisme (customSymbolGroups).
//
// De pure conversie staat in linework-catalog.js (node-testbaar); deze module
// voegt alleen registry- en preferences-lijm toe.

import { registerTemplate, unregisterTemplate } from './registry.js';
import { lineworkCatalogTemplates, lineworkTemplateId } from './linework-catalog.js';
import { state } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';

/**
 * Registreer alle templates van een linework-catalogus en bewaar de catalogus
 * zodat hij bij de volgende start opnieuw geregistreerd kan worden.
 * Idempotent: opnieuw registreren vervangt.
 */
export function registerLineworkCatalog(collectionId, catalog, { persist = true, lang } = {}) {
  const templates = lineworkCatalogTemplates(collectionId, catalog, lang);
  for (const t of templates) registerTemplate(t);
  if (persist) {
    const all = { ...(state.preferences.lineworkCatalogs || {}) };
    all[collectionId] = catalog;
    state.preferences.lineworkCatalogs = all;
    savePreferences();
  }
  return templates;
}

/** Alle bewaarde catalogi opnieuw registreren; eenmalig bij het starten. */
export function initLineworkCatalogs() {
  const all = state.preferences.lineworkCatalogs || {};
  for (const [collectionId, catalog] of Object.entries(all)) {
    try {
      registerLineworkCatalog(collectionId, catalog, { persist: false });
    } catch (e) {
      console.warn(`Linework-catalogus ${collectionId} niet geregistreerd:`, e);
    }
  }
}

/**
 * Verwijder een bewaarde catalogus en zijn templates. Aangeroepen wanneer de
 * gebruiker de gedownloade palette-groep verwijdert
 * (symbolStore.removeCustomGroup). No-op voor collecties zonder catalogus.
 */
export function removeLineworkCatalog(collectionId) {
  const all = state.preferences.lineworkCatalogs || {};
  const catalog = all[collectionId];
  if (!catalog) return;
  for (const f of catalog.families || []) {
    unregisterTemplate(lineworkTemplateId(collectionId, f.id));
  }
  const next = { ...all };
  delete next[collectionId];
  state.preferences.lineworkCatalogs = next;
  savePreferences();
}
