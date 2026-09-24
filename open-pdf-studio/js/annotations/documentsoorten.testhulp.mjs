// Testhulp voor de lagen-tests (#468): de documentsoorten waartegen de model-,
// MCP- en XFDF-tests draaien.
//
// In de app bewaart het document bij het toewijzen van `annotationLayers` een
// kopie: code die na `doc.annotationLayers = lijst` nog in `lijst` schrijft,
// raakt die wijziging kwijt. Een kaal object in node doet dat niet, en daar
// bleef zo'n fout onzichtbaar. Daarom draait elke test ook tegen een document
// met een setter die een diepe kopie bewaart, en tegen een strengere variant
// die ook bij het lezen een kopie teruggeeft (wie een gelezen laag aanpast
// zonder terug te schrijven, verliest dat dan ook).
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

function metKopie(extra, { bijLezen }) {
  const doc = { annotations: [] };
  let opgeslagen;
  Object.defineProperty(doc, 'annotationLayers', {
    enumerable: true,
    configurable: true,
    get() { return bijLezen && opgeslagen !== undefined ? structuredClone(opgeslagen) : opgeslagen; },
    set(waarde) { opgeslagen = waarde === undefined ? undefined : structuredClone(waarde); },
  });
  Object.assign(doc, extra);
  return doc;
}

/** [naam, maakDocument(extra)] */
export const DOCUMENTSOORTEN = [
  ['kaal object', (extra = {}) => ({ annotations: [], ...extra })],
  ['app: kopie bij toewijzen', (extra = {}) => metKopie(extra, { bijLezen: false })],
  ['app: kopie bij lezen en toewijzen', (extra = {}) => metKopie(extra, { bijLezen: true })],
];

/** Een document dat elke toewijzing van de lagen stil negeert (voor de wachters). */
export function documentDatNietsBewaart() {
  const doc = { annotations: [] };
  Object.defineProperty(doc, 'annotationLayers', {
    enumerable: true, configurable: true,
    get() { return []; },
    set() { /* weggegooid */ },
  });
  return doc;
}

/**
 * node:test's `test`, maar dan één keer per documentsoort. `huidig()` geeft
 * de maakfunctie van de soort die nu draait (tests lopen na elkaar).
 */
export function perDocumentsoort(basisTest) {
  let maak = DOCUMENTSOORTEN[0][1];
  const test = (naam, fn) => {
    for (const [soort, maker] of DOCUMENTSOORTEN) {
      basisTest(`${soort}: ${naam}`, (t) => { maak = maker; return fn(t); });
    }
  };
  return { test, maakDoc: (extra) => maak(extra) };
}
