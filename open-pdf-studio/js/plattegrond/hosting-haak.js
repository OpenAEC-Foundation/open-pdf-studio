// Haak voor gehoste deuren en ramen (#1229).
//
// Een deur of raam dat bij een wand hoort, beweegt mee met die wand en
// schuift alleen LANGS de wand. Dat rekenwerk (gehoste-opening.js, met de
// app-kant in hosting-app.js) is alleen nodig in een document dat zulke
// openingen heeft; het laadt daarom pas bij het eerste gebruik. Dit bestand
// is het kleine deel dat altijd geladen is: het herkent of een wijziging een
// gehoste opening raakt en geeft haar dan door.
//
// Geen imports: dit bestand hangt aan de undo-stapel en aan de lader en mag
// daar niets meetrekken.

let kern = null;
let laden = null;

/** Raakt deze annotatie de hosting: een wand met openingen of een gehost kozijn? */
export function raaktHosting(ann) {
  if (!ann) return false;
  if (ann.type === 'wall') return Array.isArray(ann.openingen) && ann.openingen.length > 0;
  return ann.type === 'parametricSymbol' && !!ann.params && !!ann.params.hostWallId
    && (ann.symbolId === 'door' || ann.symbolId === 'window');
}

/** Laadt het rekenwerk (eenmalig). Geeft de geladen module, of null als het laden mislukt. */
export function laadHostingKern() {
  if (kern) return Promise.resolve(kern);
  if (!laden) {
    laden = import('./hosting-app.js')
      .then((m) => { kern = m; return m; })
      .catch((e) => { laden = null; console.warn('[hosting] loading failed:', e); return null; });
  }
  return laden;
}

/** Alleen voor tests: een eigen kern zetten of weghalen. */
export function zetHostingKern(k) {
  kern = k || null;
  laden = null;
}

function commandoRaaktHosting(cmd) {
  switch (cmd.type) {
    case 'modifyAnnotation': return raaktHosting(cmd.oldState) || raaktHosting(cmd.newState);
    case 'addAnnotation':
    case 'deleteAnnotation': return raaktHosting(cmd.annotation);
    case 'bulkModify': return cmd.items.some((it) => raaktHosting(it.oldState) || raaktHosting(it.newState));
    case 'bulkAdd':
    case 'bulkDelete': return cmd.items.some((it) => raaktHosting(it.annotation));
    default: return false;
  }
}

/**
 * Een stap die net in de undo-geschiedenis komt. Raakt hij een gehoste
 * opening, dan volgt de andere kant (het kozijn volgt de wand, de wand sluit
 * als het kozijn weggaat, ...) en horen die wijzigingen bij DEZELFDE stap.
 * @returns {object|null} de stap die in de geschiedenis hoort (dezelfde, of
 *   een samengestelde stap), of null als er niets verandert.
 */
export function hostingBijCommando(cmd, doc) {
  if (!cmd || !doc || !commandoRaaktHosting(cmd)) return null;
  if (!kern) {
    // Nog niet geladen (een geplakte wand uit een ander venster): laden en
    // daarna de koppelingen van het document nalopen.
    laadHostingKern().then((m) => m?.herstelActiefDocument?.());
    return null;
  }
  return kern.naCommando(cmd, doc);
}

/**
 * Tijdens het slepen of rekken van de selectie: gehoste kozijnen meteen
 * laten meelopen. Doet niets zolang het rekenwerk niet geladen is.
 */
export function hostingTijdensSleep(doc) {
  if (!kern || !doc) return;
  const selectie = doc.selectedAnnotations;
  if (!selectie || !selectie.length || !selectie.some(raaktHosting)) return;
  kern.tijdensSleep(doc);
}
