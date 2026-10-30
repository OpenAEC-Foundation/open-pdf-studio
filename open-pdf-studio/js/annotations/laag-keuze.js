// De keuzelijst "Laag" in het eigenschappenpaneel (#377): één lijst met de
// markeringslagen van de app (#468) en de lagen van de tekening (OCG's van
// het document). Een waarde is 'a:<laag-id>' voor een markeringslaag of
// 'o:<pdf.js-id>' voor een laag van de tekening. Een markering op een laag
// van de tekening heeft als `layer` 'ocg-<object>-<generatie>' (zie
// saver/annotatie-lagen.js); in de lijst staat die bij de tekening.
//
// Puur, getest in laag-keuze.test.mjs.

import { DEFAULT_LAYER_ID, getLayers, layerDisplayName, layerIdOf, annotationsInDocument } from './annotatie-lagen.js';
import { ocgVoorAnnotatieLaagId } from '../pdf/laag-ids.js';

/** De waarde in de keuzelijst voor de laag van deze annotatie. */
export function laagKeuzeWaarde(ann, doc = null) {
  const id = layerIdOf(ann);
  const ocg = ocgVoorAnnotatieLaagId(id);
  if (ocg) return `o:${ocg}`;
  // Een laag die het document niet kent, valt terug op de standaardlaag.
  if (doc && !getLayers(doc).some((l) => l.id === id)) return `a:${DEFAULT_LAYER_ID}`;
  return `a:${id}`;
}

/**
 * De waarde voor een selectie (de keuzelijst op het tabblad Opmaak, #865):
 * '' zonder selectie, 'mixed' bij verschillende lagen. Leest de annotaties
 * van het document zelf: een selectie kan een ander object vasthouden dan
 * het document, en verplaatsen werkt op dat van het document.
 */
export function selectieLaagKeuze(selectie, doc = null) {
  const lijst = (selectie || []).filter((a) => a && typeof a === 'object');
  if (!lijst.length) return '';
  const eigen = doc ? annotationsInDocument(doc, lijst) : [];
  const bron = eigen.length === lijst.length ? eigen : lijst;
  const eerste = laagKeuzeWaarde(bron[0], doc);
  return bron.every((a) => laagKeuzeWaarde(a, doc) === eerste) ? eerste : 'mixed';
}

/** 'a:x' → {soort:'annotatie', id:'x'}; 'o:12R' → {soort:'tekening', id:'12R'}; anders null. */
export function leesLaagKeuze(waarde) {
  const m = /^([ao]):(.+)$/.exec(String(waarde || ''));
  if (!m) return null;
  return { soort: m[1] === 'a' ? 'annotatie' : 'tekening', id: m[2] };
}

/**
 * De opties van de keuzelijst.
 * @param {object} doc  het document (annotationLayers)
 * @param {{id: string, name: string}[]} tekeningLagen  de lagen van de tekening
 *   (de regels van het paneel Lagen zonder koppen)
 * @param {string} standaardNaam  de weergavenaam van de standaardlaag
 * @returns {{markeringen: {waarde: string, naam: string}[], tekening: {waarde: string, naam: string}[]}}
 */
export function laagKeuzeOpties(doc, tekeningLagen, standaardNaam) {
  const tekening = (tekeningLagen || []).map((l) => ({ waarde: `o:${l.id}`, naam: l.name }));
  const inTekening = new Set(tekening.map((t) => t.waarde));
  const markeringen = [];
  for (const laag of getLayers(doc)) {
    const ocg = ocgVoorAnnotatieLaagId(laag.id);
    if (ocg) {
      // Een overgenomen laag die (nog) niet bij de tekening staat: bij die groep.
      if (!inTekening.has(`o:${ocg}`)) tekening.push({ waarde: `o:${ocg}`, naam: laag.name });
      continue;
    }
    markeringen.push({ waarde: `a:${laag.id}`, naam: layerDisplayName(laag, standaardNaam) });
  }
  return { markeringen, tekening };
}
