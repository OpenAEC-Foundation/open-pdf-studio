// Alle tabbladen sluiten / andere tabbladen sluiten (#1156): de kant van de
// app. De volgorde en het stoppen staan in tabs-sluiten-model.js; het sluiten
// van elk document loopt door closeTab (tabs.js), dus met dezelfde vraag
// Opslaan / Niet opslaan / Annuleren en dezelfde bewaking als bij één tabblad.
//
// Wat hier NIET dichtgaat: een tabblad dat naar een eigen venster is gesleept
// (dat is een tweede instantie van de app met haar eigen documenten) en het
// venster van de afdrukwachtrij; closeTab raakt alleen de documenten van dit
// venster. Het venster zelf blijft open, zoals bij het sluiten van het
// laatste tabblad met het kruisje.

import { state, getActiveDocument } from '../../core/state.js';
import { compareActive, blurCompareTab, exitCompare } from '../../compare/compare-store.js';
import { tabItems, weergavenVan, actieveWeergaveVan } from './weergave-tabs-model.js';
import { kanAllesSluiten, kanAndereSluiten, sluitPlan, voerSluitPlanUit } from './tabs-sluiten-model.js';

// Eén reeks tegelijk: een tweede opdracht terwijl er nog een vraag openstaat,
// zou dezelfde documenten nog eens langsgaan.
let _bezig = false;

function toestand() {
  return { aantalTabItems: tabItems(state.documents).length, vergelijkActief: compareActive() };
}

/** Staat "Alles sluiten" aan? (Reactief te gebruiken in een Solid-component.) */
export function allesSluitenMogelijk() {
  return kanAllesSluiten(toestand());
}

/** Staat "Andere tabbladen sluiten" aan? */
export function andereSluitenMogelijk() {
  return kanAndereSluiten(toestand());
}

async function sluitDocument(doc) {
  const index = state.documents.indexOf(doc);
  // Al dicht (door de gebruiker, tussen twee vragen door): niets te doen.
  if (index === -1) return true;
  const { closeTab } = await import('./tabs.js');
  return closeTab(index);
}

async function sluitWeergave(doc, weergave) {
  const index = state.documents.indexOf(doc);
  if (index === -1) return true;
  const { sluitTabItem } = await import('./weergave-tabs.js');
  return sluitTabItem(index, weergave);
}

async function voerUit(plan, extra = {}) {
  if (_bezig) return { gesloten: 0, gestopt: true, bij: null };
  _bezig = true;
  try {
    return await voerSluitPlanUit(plan, {
      sluitDocument,
      sluitWeergave,
      sluitVergelijking: () => exitCompare(),
      ...extra,
    });
  } finally {
    _bezig = false;
  }
}

/**
 * Sluit alle tabbladen van dit venster; de app blijft open.
 * @returns {Promise<{gesloten:number, gestopt:boolean, bij:object|null}>}
 */
export async function sluitAlleTabs() {
  if (!allesSluitenMogelijk()) return { gesloten: 0, gestopt: false, bij: null };
  const plan = sluitPlan({
    documenten: [...state.documents],
    actieveIndex: state.activeDocumentIndex,
    vergelijkActief: compareActive(),
  });
  return voerUit(plan);
}

/**
 * Sluit alle tabbladen behalve het aangeklikte; dat komt voor te liggen.
 * @param {number} index  documentindex van het tabblad dat blijft
 * @param {string|null} [weergave]  het tabblad van dat document (#919)
 */
export async function sluitAndereTabs(index, weergave = null) {
  const doc = state.documents[index];
  if (!doc || !andereSluitenMogelijk()) return { gesloten: 0, gestopt: false, bij: null };
  // Het tabblad van dit document dat blijft (#919); zonder aanwijzing het actieve.
  const blijft = weergavenVan(doc).includes(weergave) ? weergave : actieveWeergaveVan(doc);
  const plan = sluitPlan({
    documenten: [...state.documents],
    actieveIndex: state.activeDocumentIndex,
    weergavenVan,
    behoud: { doc, weergave: blijft },
    vergelijkActief: compareActive(),
  });
  // Het tabblad dat blijft naar voren, langs het pad van een klik erop.
  const naarVoren = async () => {
    const nu = state.documents.indexOf(doc);
    if (nu === -1) return false;
    blurCompareTab();
    const { toonTabItem } = await import('./weergave-tabs.js');
    await toonTabItem(nu, blijft);
    return getActiveDocument() === doc;
  };
  return voerUit(plan, {
    maakActief: naarVoren,
    // Opslaan vanaf een achtergrondtabblad wisselt daarheen en weer terug;
    // na afloop ligt in elk geval het tabblad dat blijft voor.
    naAfloop: async () => { if (getActiveDocument() !== doc) await naarVoren(); },
  });
}
