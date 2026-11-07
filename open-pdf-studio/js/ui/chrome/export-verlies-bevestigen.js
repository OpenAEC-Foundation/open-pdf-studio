// Eén vraag vóór elke export die informatie verliest (#629): "dit gaat niet
// mee — doorgaan of annuleren?". Elke exportopdracht roept
// bevestigExportVerlies aan vóór het opslagvenster; het venster is
// ExportVerliesDialog.jsx, de lijst komt uit pdf/export-verlies.js.
//
// "Niet meer vragen voor deze export" staat per soort in de opslag van de
// app (core/opslag.js). Voor XFDF kiest de gebruiker in hetzelfde venster de
// auteurs; die keuze komt elke keer terug als er meer dan één auteur is.

import { leesOpslagJson, schrijfOpslagJson } from '../../core/opslag.js';
import { exportVerliezen, vensterNodig } from '../../pdf/export-verlies.js';
import { verzamelExportInhoud } from '../../pdf/export-verlies-inhoud.js';
import { auteursIn, vanAuteurs } from '../../annotations/xfdf-samenvoegen.js';
import { openDialog, closeDialog } from '../../solid/stores/dialogStore.js';

export const NIET_VRAGEN_NAAM = 'exportVerliesNietVragen';

// Het antwoord op de vraag die nu open staat (er is er hooguit één).
let lopend = null;

/** Koos de gebruiker "niet meer vragen" voor deze export? */
export function nietMeerVragen(soort) {
  const keuzes = leesOpslagJson(NIET_VRAGEN_NAAM, {});
  return !!(keuzes && typeof keuzes === 'object' && keuzes[soort] === true);
}

/** Onthoudt "niet meer vragen" voor deze export. */
export function zetNietMeerVragen(soort, waarde = true) {
  const oud = leesOpslagJson(NIET_VRAGEN_NAAM, {});
  const keuzes = oud && typeof oud === 'object' && !Array.isArray(oud) ? { ...oud } : {};
  if (waarde) keuzes[soort] = true;
  else delete keuzes[soort];
  try {
    schrijfOpslagJson(NIET_VRAGEN_NAAM, keuzes);
  } catch (e) {
    console.warn('Could not store the export warning choice:', e);
  }
}

/**
 * Vraagt de gebruiker of de export door mag, met wat er niet meegaat.
 *
 * @param {string} soort  een van EXPORT_SOORTEN (pdf/export-verlies.js)
 * @param {object} doc  het document dat geëxporteerd wordt
 * @param {object} [opties]  de opties voor exportVerliezen (deel, conformance,
 *   afbeeldingen, annotaties als boolean voor CAD), plus voor XFDF:
 *   `annotatieLijst` (wat geëxporteerd wordt) en `auteursKiezen: true`
 * @returns {Promise<{ok: boolean, auteurs: string[]|null}>} `auteurs`: de
 *   gekozen auteurs (alleen bij een keuze), anders null = alle
 */
export async function bevestigExportVerlies(soort, doc, opties = {}) {
  const { annotatieLijst, auteursKiezen, ...verliesOpties } = opties;
  const inhoud = await verzamelExportInhoud(doc, { annotaties: annotatieLijst });
  const alleAnnotaties = inhoud.annotaties;
  const auteurs = auteursKiezen ? auteursIn(alleAnnotaties) : [];
  const verliesVoor = (gekozen) => exportVerliezen(soort,
    { ...inhoud, annotaties: vanAuteurs(alleAnnotaties, gekozen) }, verliesOpties);
  const nodig = vensterNodig({ verliezen: verliesVoor(null), auteurs, nietVragen: nietMeerVragen(soort) });
  if (!nodig.tonen) return { ok: true, auteurs: null };
  // Een vraag die nog open staat, telt als geannuleerd en maakt plaats:
  // openDialog opent geen tweede venster met dezelfde naam.
  lopend?.({ ok: false });
  return new Promise((resolve) => {
    let klaar = false;
    const antwoord = (a) => {
      if (klaar) return;
      klaar = true;
      if (lopend === antwoord) lopend = null;
      closeDialog('export-verlies');
      if (a?.ok && a.nietMeerVragen) zetNietMeerVragen(soort);
      resolve({ ok: !!a?.ok, auteurs: a?.ok && Array.isArray(a.auteurs) ? a.auteurs : null });
    };
    lopend = antwoord;
    openDialog('export-verlies', {
      soort,
      verliesVoor,
      verliezenTonen: nodig.verliezenTonen,
      auteurs: nodig.auteursTonen ? auteurs : [],
      resolve: antwoord,
    });
  });
}
