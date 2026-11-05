// Hetzelfde document in meer tabbladen (#919): de kant van de app.
//
// Zie weergave-tabs-model.js voor het ontwerp. Hier: een weergave openen,
// tonen en sluiten. De stand van een weergave is dezelfde momentopname die
// de gesplitste weergave voor haar tweede paneel gebruikt (split-view.js
// leesWeergaveStand/zetWeergaveStand): pagina, zoom, verschuiving of
// scrollstand, weergaverotatie en weergavemodus.
//
// Alles wat de viewer een stand laat aannemen of er een opneemt, loopt na
// elkaar (inRij): twee snelle klikken mogen elkaars stand niet opnemen.

import { state, getActiveDocument } from '../../core/state.js';
import {
  weergavenVan, actieveWeergaveVan, voegWeergaveToe, verwijderWeergave,
  heeftMeerWeergaven, klikActie, standSleutel,
} from './weergave-tabs-model.js';

// Standen van de weergaven die niet voor liggen. Buiten de store: een stand
// is een momentopname van de viewer, geen documentgegeven.
const _standen = new Map();
// Sleutel van een stand die bij het volgende voorkomen van het document hoort.
const VOLGENDE = '_volgende';
let _rij = Promise.resolve();

/** Voer fn uit na wat er al liep; een fout breekt de rij niet. */
function inRij(fn) {
  const taak = _rij.then(fn);
  _rij = taak.catch((e) => console.warn('[weergave-tabs]', e?.message || e));
  return taak;
}

async function splitView() {
  return import('../../pdf/split-view/split-view.js');
}

/** Kan dit document in nog een tabblad open? */
export function kanNieuweWeergave(doc) {
  return !!doc?.pdfDoc;
}

/**
 * Tab-menu "Nieuw tabblad voor dit document": dezelfde stand in een nieuw
 * tabblad direct ernaast. Beide tabbladen tonen het ene document.
 */
export async function openNieuweWeergave(index) {
  const doc = state.documents[index];
  if (!kanNieuweWeergave(doc)) return false;
  if (state.activeDocumentIndex !== index) {
    const { switchToTab } = await import('./tabs.js');
    await switchToTab(index);
    if (getActiveDocument() !== doc) return false;
    await naTabWissel(doc);
  }
  return inRij(async () => {
    if (getActiveDocument() !== doc) return false;
    const { leesWeergaveStand } = await splitView();
    const stand = leesWeergaveStand(doc);
    const { van } = voegWeergaveToe(doc);
    // De weergave die voor lag, gaat met de huidige stand naar achteren; de
    // nieuwe begint precies daar en is de viewer.
    _standen.set(standSleutel(doc, van), stand);
    return true;
  });
}

/** Wissel binnen het actieve document naar weergave `id`. */
function wisselWeergave(doc, id) {
  return inRij(async () => {
    if (getActiveDocument() !== doc) return false;
    const huidig = actieveWeergaveVan(doc);
    if (!id || id === huidig || !weergavenVan(doc).includes(id)) return false;
    const { leesWeergaveStand, zetWeergaveStand } = await splitView();
    _standen.set(standSleutel(doc, huidig), leesWeergaveStand(doc));
    doc.actieveWeergave = id;
    // Een selectie hoort bij wat je ziet: weg, zoals bij een tabwissel.
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
    import('../../solid/stores/propertiesStore.js').then((m) => m.storeHideProperties()).catch(() => {});
    const stand = _standen.get(standSleutel(doc, id));
    _standen.delete(standSleutel(doc, id));
    if (stand) await zetWeergaveStand(doc, stand);
    import('./status-bar.js').then((m) => m.updateAllStatus()).catch(() => {});
    return true;
  });
}

/**
 * Klik op een tabblad: naar dat document, en daar naar die weergave.
 * @param {number} index  documentindex
 * @param {string|null} id  weergave-id (null bij een document met één tabblad)
 */
export async function toonTabItem(index, id) {
  const doc = state.documents[index];
  if (!doc) return false;
  const actie = klikActie({ index, weergave: id }, state.documents, state.activeDocumentIndex);
  if (actie === 'niets') return true;
  if (actie === 'document') {
    const { switchToTab } = await import('./tabs.js');
    await switchToTab(index);
    if (getActiveDocument() !== doc) return false;
    await naTabWissel(doc);
    if (!id || id === actieveWeergaveVan(doc)) return true;
  }
  return wisselWeergave(doc, id);
}

/**
 * Sluit een tabblad. Heeft het document nog een ander tabblad, dan gaat
 * alleen deze weergave weg en blijft het document open (niets te vragen,
 * niets op te slaan); anders sluit het document zoals altijd.
 * @returns {Promise<boolean>} gesloten
 */
export async function sluitTabItem(index, id) {
  const doc = state.documents[index];
  if (!doc) return false;
  const weg = id ?? actieveWeergaveVan(doc);
  if (!heeftMeerWeergaven(doc) || !weergavenVan(doc).includes(weg)) {
    const { closeTab } = await import('./tabs.js');
    return closeTab(index);
  }
  return inRij(async () => {
    if (!weergavenVan(doc).includes(weg)) return true;
    const voorAan = getActiveDocument() === doc;
    const wasActief = actieveWeergaveVan(doc) === weg;
    const { nieuweActief } = verwijderWeergave(doc, weg);
    _standen.delete(standSleutel(doc, weg));
    if (wasActief && nieuweActief) {
      // De buur komt voor, met zijn eigen stand; ligt het document achter,
      // dan bij de volgende keer dat het voor komt (naTabWissel).
      const stand = _standen.get(standSleutel(doc, nieuweActief));
      _standen.delete(standSleutel(doc, nieuweActief));
      if (stand && voorAan) {
        const { zetWeergaveStand } = await splitView();
        await zetWeergaveStand(doc, stand);
      } else if (stand) {
        _standen.set(standSleutel(doc, VOLGENDE), stand);
      }
    }
    import('./status-bar.js').then((m) => m.updateAllStatus()).catch(() => {});
    return true;
  });
}

/** Ctrl+W en Bestand > Sluiten: het actieve tabblad (één weergave of het document). */
export async function sluitActiefTabItem() {
  const index = state.activeDocumentIndex;
  const doc = state.documents[index];
  if (!doc) return false;
  return sluitTabItem(index, actieveWeergaveVan(doc));
}

/**
 * Na een tabwissel naar `doc` (tabs.js): een stand die nog wachtte toepassen
 * (de weergave die voor lag sloot terwijl het document achter lag).
 */
export function naTabWissel(doc) {
  return inRij(async () => {
    const sleutel = standSleutel(doc, VOLGENDE);
    const stand = _standen.get(sleutel);
    if (!stand || getActiveDocument() !== doc) return;
    _standen.delete(sleutel);
    const { zetWeergaveStand } = await splitView();
    await zetWeergaveStand(doc, stand);
  });
}

/** Vergeet de bewaarde standen van een document (sluiten). */
export function vergeetDocument(doc) {
  const voor = standSleutel(doc, '');
  for (const k of [..._standen.keys()]) if (k.startsWith(voor)) _standen.delete(k);
}
