// Registratie + persistentie voor gedownloade linework-catalogi.
//
// Zelfde opzet als steel-catalog-store.js: een gedownloade
// `linework-variants`-catalogus wordt een set parametrische templates in de
// gedeelde registry (één per familie). Persistentie kent TWEE vormen naast
// elkaar (#354): kleine catalogi blijven inline in
// state.preferences.lineworkCatalogs (het bestaande gedrag, en buiten Tauri
// de enige optie), grote gaan als los bestand naar
// <appdata>/OpenPDFStudio/catalogs/ met alleen een verwijzing in de
// voorkeuren — zo blijft preferences.json klein en blijft het
// localStorage-quotum (#353) buiten beeld. De palette-groep zelf persist via
// het bestaande custom-groups-mechanisme (customSymbolGroups).
//
// De pure conversie staat in linework-catalog.js (node-testbaar); de pure
// opslagkeuze in catalog-opslagkeuze.js.

import { registerTemplate, unregisterTemplate } from './registry.js';
import { lineworkCatalogTemplates, lineworkTemplateId } from './linework-catalog.js';
import { catalogusOpslagkeuze, isCatalogusVerwijzing } from './catalog-opslagkeuze.js';
import { state } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';
import { isTauri, saveCatalogFile, loadCatalogFile, deleteCatalogFile } from '../core/platform.js';

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
    const json = JSON.stringify(catalog);
    if (catalogusOpslagkeuze(json.length, isTauri()) === 'bestand') {
      // Groot: eigen bestand, verwijzing in de voorkeuren. Het bestand
      // eerst wegschrijven en pas bij succes de verwijzing bewaren — anders
      // zou een mislukte schrijf de catalogus kwijtmaken.
      saveCatalogFile(collectionId, catalog)
        .then(() => {
          all[collectionId] = { extern: true };
          state.preferences.lineworkCatalogs = all;
          savePreferences();
          // Een eerdere inline versie is hiermee vervangen.
        })
        .catch((e) => {
          console.warn(`Catalogus ${collectionId} niet als bestand opgeslagen, valt terug op inline:`, e);
          all[collectionId] = catalog;
          state.preferences.lineworkCatalogs = all;
          savePreferences();
        });
    } else {
      all[collectionId] = catalog;
      state.preferences.lineworkCatalogs = all;
      savePreferences();
      // Restant-bestand van een eerdere (grotere) versie opruimen.
      if (isTauri()) deleteCatalogFile(collectionId);
    }
  }
  return templates;
}

/** Alle bewaarde catalogi opnieuw registreren; eenmalig bij het starten. */
export async function initLineworkCatalogs() {
  const all = state.preferences.lineworkCatalogs || {};
  for (const [collectionId, bewaard] of Object.entries(all)) {
    try {
      const catalog = isCatalogusVerwijzing(bewaard)
        ? await loadCatalogFile(collectionId)
        : bewaard;
      if (!catalog) {
        console.warn(`Linework-catalogus ${collectionId}: bestand ontbreekt`);
        continue;
      }
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
export async function removeLineworkCatalog(collectionId) {
  const all = state.preferences.lineworkCatalogs || {};
  const bewaard = all[collectionId];
  if (!bewaard) return;
  const catalog = isCatalogusVerwijzing(bewaard)
    ? await loadCatalogFile(collectionId).catch(() => null)
    : bewaard;
  for (const f of catalog?.families || []) {
    unregisterTemplate(lineworkTemplateId(collectionId, f.id));
  }
  if (isCatalogusVerwijzing(bewaard)) deleteCatalogFile(collectionId);
  const next = { ...all };
  delete next[collectionId];
  state.preferences.lineworkCatalogs = next;
  savePreferences();
}
