// Formuliervelden in afdruk en export. Op het scherm staan de velden in een
// eigen HTML-laag boven de pagina (form-layer.js); de pagina zelf tekent PDF.js
// zonder annotaties, want de markeringen uit het bestand tekent de app zelf.
// Een afdruk heeft die HTML-laag niet: zonder deze opties komt een ingevuld
// formulier blanco op papier.
//
// Op een pagina met velden tekent PDF.js daarom de annotaties zoals bij een
// afdruk, met de ingevulde waarden uit de annotatieopslag van het document,
// maar alleen de velden: elke andere annotatie uit het bestand krijgt in een
// kopie van die opslag `noPrint`. Zo komt een markering niet dubbel op papier
// en komt een door de gebruiker verwijderde markering niet terug. Het veld
// volgt zijn eigen afdrukvlag, zoals in elke andere PDF-lezer.

// PDF.js AnnotationMode (zie print-formulieren.test.mjs, die het nagaat).
const GEEN_ANNOTATIES = 0;
const MET_OPSLAG = 3;

const isVeld = (annotatie) => annotatie?.subtype === 'Widget';

/** Heeft één van deze pagina's (1-gebaseerd) een formulierveld dat wordt afgedrukt? */
export async function heeftFormulierVelden(pdfDoc, paginas) {
  for (const nummer of paginas) {
    const page = await pdfDoc.getPage(nummer);
    if ((await page.getAnnotations({ intent: 'print' })).some(isVeld)) return true;
  }
  return false;
}

/**
 * De lagenstand voor een render met `intent: 'print'`. PDF.js eist een
 * configuratie met dezelfde intent als de render; de zichtbaarheid komt van
 * het scherm: de eigen lagenkeuze (#377), anders de beginstand van het bestand.
 */
async function afdrukLagen(pdfDoc, schermLagen) {
  const afdruk = await pdfDoc.getOptionalContentConfig({ intent: 'print' });
  const scherm = schermLagen || await pdfDoc.getOptionalContentConfig({ intent: 'display' });
  for (const [id, groep] of scherm) afdruk.setVisibility(id, groep.visible, false);
  return afdruk;
}

/**
 * Opties voor `page.render()` van een afdruk of export van `page`. Zonder
 * velden: geen annotaties, zoals voorheen (`null`: de aanroeper geeft dan zelf
 * de lagenstand mee). Met velden: de velden met hun ingevulde waarden en niets
 * anders uit het bestand, met de lagenstand van het scherm (`schermLagen`, de
 * eigen keuze van de gebruiker of null) in de vorm die een afdruk-render eist.
 */
export async function formulierRenderOpties(page, pdfDoc, schermLagen = null) {
  const annotaties = await page.getAnnotations({ intent: 'print' });
  if (!annotaties.some(isVeld)) return { annotationMode: GEEN_ANNOTATIES };

  const opslag = pdfDoc.annotationStorage;
  const basis = opslag.print; // een losse kopie; het document zelf blijft ongemoeid
  const { map, hash } = basis.serializable;
  const kaart = new Map(map || []);
  const weg = [];
  for (const annotatie of annotaties) {
    if (isVeld(annotatie)) continue;
    kaart.set(annotatie.id, { ...(kaart.get(annotatie.id) || {}), noPrint: true });
    weg.push(annotatie.id);
  }
  // De hash hoort bij de inhoud: PDF.js bewaart tekenopdrachten per hash.
  const printAnnotationStorage = new basis.constructor({
    serializable: { map: kaart, hash: `${hash}|zonder:${weg.join(',')}`, transfer: undefined },
  });
  return {
    intent: 'print',
    annotationMode: MET_OPSLAG,
    printAnnotationStorage,
    optionalContentConfigPromise: afdrukLagen(pdfDoc, schermLagen),
  };
}
