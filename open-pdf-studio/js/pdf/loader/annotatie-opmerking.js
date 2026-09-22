// De opmerking bij een annotatie: /Contents bij het laden.
//
// pdf.js geeft geen /Subject terug. De tekst die een andere lezer of een
// CAD-programma bij een vorm zet, staat in /Contents; de app bewaart hem in
// `subject` en de saver schrijft hem daar weer vandaan naar /Contents. Werd
// die tekst bij het laden niet opgepikt, dan schreef de saver een lege
// tekenreeks terug en was elke opmerking bij een rechthoek, ellips, lijn of
// vlak na één keer opslaan weg.
//
// Soorten met een eigen tekstveld lezen /Contents al in dat veld: de tekst
// van een notitie of tekstvak, de meettekst, het label van een kader. Daar
// blijft `subject` leeg, anders staat dezelfde tekst twee keer (ook in het
// eigenschappenpaneel, dat `subject` als onderwerp toont) en zou een interne
// naam als "Scale Bar" als onderwerp verschijnen.

/** Soorten waarvan de saver /Contents uit een eigen veld schrijft. */
export const SOORTEN_MET_EIGEN_TEKST = new Set([
  'comment',                                                        // notitietekst
  'textbox', 'callout',                                             // de tekst zelf
  'stamp', 'vectorSnippet', 'stavenreeks',                          // stempel-/knipsellabel
  'measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle', // meettekst
  'scaleRegion', 'viewport', 'scaleBar', 'scheduleTable',           // label of naam
]);

/**
 * De opmerkingstekst van een annotatie zoals pdf.js hem aanlevert.
 *
 * Hoort een annotatie bij een groep (/IRT met /RT /Group), dan vult pdf.js
 * `contentsObj` met de tekst van de groepsleider. Die tekst is niet van deze
 * annotatie: hij blijft hier weg, anders zou een vorm die in het origineel
 * géén /Contents had er bij het opslaan ineens een krijgen.
 * @param {{ subject?: string, contentsObj?: { str?: string }, contents?: string, replyType?: string }} annot
 * @returns {string}
 */
export function opmerkingUitAnnot(annot) {
  if (!annot || annot.replyType === 'Group') return '';
  return annot.subject || annot.contentsObj?.str || annot.contents || '';
}

/**
 * Haalt het onderwerp weg bij soorten die de tekst al in een eigen veld
 * hebben staan. Geeft dezelfde annotatie terug.
 * @template {{ type?: string, subject?: string }} T
 * @param {T} ann
 * @returns {T}
 */
export function zonderDubbeleOpmerking(ann) {
  if (ann && ann.subject && SOORTEN_MET_EIGEN_TEKST.has(ann.type)) ann.subject = '';
  return ann;
}
