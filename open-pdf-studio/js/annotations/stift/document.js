// De stiftdefinities van één document: opzoeken, aanvullen, overnemen en
// overzetten. Werkt op een document-object (`doc.stiftDefinities`,
// `doc.annotations`), zonder app-state te importeren.
//
// `doc.stiftDefinities` is undefined zolang het document geen stiften kent;
// het krijgt pas een lijst bij de eerste stift, zodat een document zonder
// stiften niets extra's in de PDF schrijft.
//
// Let op (document-kopieert-bij-toewijzen): de documenten staan in een
// reactieve store. Lees na een toewijzing `doc.stiftDefinities` opnieuw uit
// in plaats van een eerder bewaarde verwijzing te muteren.

import { valideerLijst, valideerDefinitie, standaardSet } from './definities.js';
import { isLayerHidden } from '../annotatie-lagen.js';

const kloon = (waarde) => JSON.parse(JSON.stringify(waarde));

/** De definities van het document (een lege lijst als het er geen heeft). */
export function definitiesVan(doc) {
  return Array.isArray(doc?.stiftDefinities) ? doc.stiftDefinities : [];
}

/** De definitie van een stift (of van een id), of null. */
export function definitieVan(doc, stiftOfId) {
  const id = typeof stiftOfId === 'string' ? stiftOfId : stiftOfId?.stiftDefId;
  return definitiesVan(doc).find((d) => d.id === id) || null;
}

/** De startset: de eigen set uit de voorkeuren, anders de ingebouwde. */
export function startsetUitVoorkeuren(prefs) {
  const eigen = valideerLijst(prefs?.stiftStartset);
  return eigen.length ? eigen : standaardSet();
}

/** Zorg dat het document definities heeft (de startset); geeft de lijst. */
export function zorgVoorDefinities(doc, prefs) {
  if (!Array.isArray(doc.stiftDefinities)) doc.stiftDefinities = kloon(startsetUitVoorkeuren(prefs));
  return doc.stiftDefinities;
}

/**
 * Neem een meegebrachte definitie over (uit een momentopname of het
 * klembord). Kent het document dit id al, dan geldt de eigen definitie.
 * @returns {boolean} of de definitie is toegevoegd
 */
export function neemDefinitieOver(doc, definitie) {
  const def = valideerDefinitie(definitie);
  if (!def) return false;
  if (!Array.isArray(doc.stiftDefinities)) doc.stiftDefinities = [];
  if (doc.stiftDefinities.some((d) => d.id === def.id)) return false;
  doc.stiftDefinities.push(def);
  return true;
}

/**
 * Zet de definities uit de PDF-catalogus: die gaan voor op wat de
 * momentopnamen al hadden toegevoegd; definities die alleen uit een
 * momentopname komen, blijven staan.
 */
export function pasCatalogusToe(doc, catalogus) {
  const lijst = valideerLijst(catalogus);
  if (!lijst.length) return;
  const ids = new Set(lijst.map((d) => d.id));
  const alleenMomentopname = definitiesVan(doc).filter((d) => !ids.has(d.id));
  doc.stiftDefinities = kloon([...lijst, ...alleenMomentopname]);
}

/** Hoe vaak elke definitie gebruikt wordt: Map id → aantal stiften. */
export function gebruik(doc) {
  const telling = new Map();
  for (const a of doc?.annotations || []) {
    if (a?.type === 'stift') telling.set(a.stiftDefId, (telling.get(a.stiftDefId) || 0) + 1);
  }
  return telling;
}

/**
 * Zet alle stiften van definitie `vanId` over naar `naarId`.
 * @returns {{annotationId: string, van: string, naar: string}[]} wat er veranderde (voor undo)
 */
export function zetStiftenOver(doc, vanId, naarId) {
  const gewijzigd = [];
  for (const a of doc?.annotations || []) {
    if (a?.type !== 'stift' || a.stiftDefId !== vanId) continue;
    a.stiftDefId = naarId;
    gewijzigd.push({ annotationId: a.id, van: vanId, naar: naarId });
  }
  return gewijzigd;
}

/**
 * De stiften die in een legenda meetellen: alle stiften van het document,
 * behalve die op een verborgen markeringslaag (die ziet de gebruiker ook niet).
 */
export function zichtbareStiften(doc) {
  return (doc?.annotations || []).filter((a) => a?.type === 'stift' && !isLayerHidden(doc, a));
}

/** Een kopie van de lijst, voor de ongedaan-maakstap. */
export function kopieDefinities(doc) {
  return kloon(definitiesVan(doc));
}
