// Klembord voor vectorknipsels.
//
// Een eigen, app-intern klembord: het knipsel is geen plaatje en geen tekst, en
// het besturingssysteem kan er niets mee. Het leeft op moduleniveau, dus het
// werkt tussen tabbladen door — precies waar het voor bedoeld is.

import { getActiveDocument } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { recordAdd } from '../core/undo-manager.js';
import { heeft, wisOngebruikt } from './vector-snippet-store.js';

let _knipsel = null;

/** @param {{snippetKey:string, srcBox:object, srcLabel:string, breedte:number, hoogte:number}} k */
export function zetKnipselOpKlembord(k) {
  _knipsel = k ? { ...k } : null;
}

export function heeftKnipsel() {
  return !!_knipsel && heeft(_knipsel.snippetKey);
}

export function knipselOpKlembord() {
  return _knipsel;
}

/**
 * Maakt een vectorSnippet-annotatie van het klembord op de gegeven plek.
 * Zonder plek komt hij linksboven op de huidige pagina.
 * @returns {object|null} de nieuwe annotatie
 */
export function plakKnipsel({ x, y, page } = {}) {
  if (!heeftKnipsel()) return null;
  const doc = getActiveDocument();
  if (!doc) return null;

  const paginaNr = page || doc.currentPage || 1;
  // Op ware grootte: één punt in de bron is één punt in het doel.
  const ann = createAnnotation({
    type: 'vectorSnippet',
    page: paginaNr,
    x: Number.isFinite(x) ? x : 40,
    y: Number.isFinite(y) ? y : 40,
    width: _knipsel.breedte,
    height: _knipsel.hoogte,
    snippetKey: _knipsel.snippetKey,
    srcBox: { ..._knipsel.srcBox },
    srcLabel: _knipsel.srcLabel || '',
    opacity: 1,
  });

  doc.annotations.push(ann);
  recordAdd(ann);
  doc.selectedAnnotations = [ann];
  doc.selectedAnnotation = ann;
  return ann;
}

/** Alle sleutels die op dit moment ergens in gebruik zijn — voor het opruimen. */
export function gebruikteSleutels(documenten) {
  const uit = new Set();
  if (_knipsel) uit.add(_knipsel.snippetKey);
  for (const doc of documenten || []) {
    for (const a of doc?.annotations || []) {
      if (a.type === 'vectorSnippet' && a.snippetKey) uit.add(a.snippetKey);
    }
  }
  return [...uit];
}

/**
 * Ruimt bronbytes op waar geen knipsel in een open document en ook het
 * klembord niet meer naar verwijst. Geheugenhygiene: zonder dit blijft elk ooit
 * geknipt blad in het geheugen hangen. De BESTANDSGROOTTE verandert hier niet
 * door — een knipsel dat in het document staat gebruikt zijn bron echt.
 * @returns {number} aantal opgeruimde bronnen
 */
export function ruimKnipselBronnenOp(documenten) {
  return wisOngebruikt(gebruikteSleutels(documenten));
}
