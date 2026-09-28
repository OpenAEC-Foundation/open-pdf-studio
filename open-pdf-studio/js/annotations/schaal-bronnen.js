// Schaalbronnen per doorloop (#491).
//
// Een schaalopzoeking (getMeasureScale, getScaleForPoint, het schaalgebied)
// moet weten welke annotaties schaalbron zijn: viewports, schaalbalken en
// schaalgebieden. Die zoektocht doorliep per opzoeking de hele
// annotatielijst. Een lus die voor elke annotatie een schaal opzoekt (de
// hoeveelhedenstaat, het hertekenen, recalculateAllMeasurements) werd
// daardoor kwadratisch, en binnen een Solid-memo schreef elke gelezen
// eigenschap ook nog een abonnement in: n² stuks, die bij de volgende
// herberekening weer opgeruimd moesten worden. Eén ongedaan-stap kostte zo
// seconden bij een paar duizend annotaties.
//
// metSchaalBronnen(fn) opent een doorloop: binnen fn worden de bronnen van
// een document één keer verzameld en daarna hergebruikt. Na fn zijn ze weg,
// dus een wijziging vóór de volgende doorloop is altijd zichtbaar; er is geen
// blijvende cache die iemand ongeldig moet maken. Buiten een doorloop
// verzamelt elke opzoeking vers, zoals voorheen.
//
// Een reactieve berekening (memo, effect) die binnen een doorloop draait
// maar hem niet zelf opende, krijgt de gedeelde bronnen NIET: haar
// abonnementen moeten uit haar eigen lezingen komen, anders merkt ze een
// nieuwe of verplaatste schaalbron later niet op. Daarom onthoudt een
// doorloop de luisteraar (getListener) die hem opende, en geldt alleen de
// binnenste doorloop.
//
// De callback moet synchroon zijn: bij een async functie eindigt de doorloop
// al bij de eerste await.

import { getListener } from 'solid-js';
import { verzamelSchaalBronnen } from './schaal-op-punt.js';

/** @type {Array<{luisteraar: unknown, perDoc: Map<object, import('./schaal-op-punt.js').SchaalBronnen>}>} */
const doorlopen = [];

/**
 * Voer fn uit met gedeelde schaalbronnen per document.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function metSchaalBronnen(fn) {
  doorlopen.push({ luisteraar: getListener(), perDoc: new Map() });
  try {
    return fn();
  } finally {
    doorlopen.pop();
  }
}

/**
 * De bronnen uit de lopende doorloop, of null buiten een doorloop (of als de
 * huidige luisteraar niet die van de doorloop is).
 * @param {object | null | undefined} doc
 */
export function schaalBronnenInDoorloop(doc) {
  const doorloop = doorlopen[doorlopen.length - 1];
  if (!doc || !doorloop || doorloop.luisteraar !== getListener()) return null;
  let bronnen = doorloop.perDoc.get(doc);
  if (!bronnen) {
    bronnen = verzamelSchaalBronnen(doc);
    doorloop.perDoc.set(doc, bronnen);
  }
  return bronnen;
}

/**
 * De schaalbronnen van een document: gedeeld binnen een doorloop, anders vers.
 * @param {object | null | undefined} doc
 */
export function schaalBronnen(doc) {
  return schaalBronnenInDoorloop(doc) || verzamelSchaalBronnen(doc);
}

/** Gooi de bronnen van lopende doorlopen weg (na een wijziging midden in een doorloop). */
export function vergeetSchaalBronnen() {
  for (const doorloop of doorlopen) doorloop.perDoc.clear();
}
