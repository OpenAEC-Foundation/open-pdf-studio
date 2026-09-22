/**
 * Zoekbronnen: de PDF-tekst en de tekst in annotaties.
 *
 * Pure logica (geen DOM, geen state): welke annotatietypen tekst dragen en in
 * welk veld, hoe treffers uit beide bronnen worden gefilterd, geordend en per
 * pagina gegroepeerd voor de resultatenlijst onder de zoekbalk.
 */

export const BRON_TEKST = 'text';
export const BRON_ANNOTATIE = 'annotation';

/**
 * Annotatietypen met doorzoekbare tekst. `veld` is het veld op de annotatie;
 * de soortnaam voor de resultatenlijst komt uit de bestaande vertaling
 * `types.<type>` (namespace properties).
 */
export const ANNOTATIE_TEKSTVELDEN = [
  { type: 'text', veld: 'text' },
  { type: 'textbox', veld: 'text' },
  { type: 'callout', veld: 'text' },
  { type: 'comment', veld: 'text' },
  { type: 'stamp', veld: 'stampText' },
  { type: 'measureDistance', veld: 'measureText' },
  { type: 'measureArea', veld: 'measureText' },
  { type: 'measurePerimeter', veld: 'measureText' },
  { type: 'measureAngle', veld: 'measureText' },
];

const VELD_PER_TYPE = new Map(ANNOTATIE_TEKSTVELDEN.map((r) => [r.type, r]));

/** Het tekstveld van een annotatietype, of null als het type geen tekst draagt. */
export function annotatieTekstveld(type) {
  return VELD_PER_TYPE.get(type) || null;
}

/** De doorzoekbare tekst van een annotatie ('' als die er niet is). */
export function annotatieTekst(annotation) {
  const regel = annotation && VELD_PER_TYPE.get(annotation.type);
  if (!regel) return '';
  const waarde = annotation[regel.veld];
  return typeof waarde === 'string' ? waarde : '';
}

/**
 * Zoek in de annotaties van één pagina.
 *
 * @param {Array} annotations alle annotaties van het document
 * @param {number} pageNum 1-gebaseerd paginanummer
 * @param {RegExp} pattern globale zoekpatroon (zelfde als voor de tekst)
 * @param {Array<number>} view paginabox [x0, y0, x1, y1] — voor de leesvolgorde
 * @returns {Array} treffers in hetzelfde formaat als de tekstresultaten
 */
export function zoekInAnnotaties(annotations, pageNum, pattern, view) {
  const uit = [];
  if (!Array.isArray(annotations)) return uit;
  const y1 = Array.isArray(view) ? Number(view[3]) || 0 : 0;
  const x0 = Array.isArray(view) ? Number(view[0]) || 0 : 0;
  for (const ann of annotations) {
    if (!ann || ann.page !== pageNum) continue;
    const tekst = annotatieTekst(ann);
    if (!tekst) continue;
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(tekst)) !== null) {
      uit.push({
        pageNum,
        bron: BRON_ANNOTATIE,
        annotationId: ann.id,
        annotationType: ann.type,
        matchText: m[0],
        startPos: m.index,
        endPos: m.index + m[0].length,
        items: [],
        pageView: Array.isArray(view) ? [...view] : null,
        // Leesvolgorde: annotaties staan in app-ruimte (oorsprong linksboven),
        // tekst in user-space (Y omhoog) — hier naar dezelfde as gebracht.
        anchorY: y1 - (Number(ann.y) || 0),
        anchorX: x0 + (Number(ann.x) || 0),
        index: 0,
      });
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }
  return uit;
}

/** Houdt alleen de treffers van de aangevinkte bronnen over. */
export function filterOpBron(results, bronnen) {
  const tekst = !bronnen || bronnen.tekst !== false;
  const annotaties = !bronnen || bronnen.annotaties !== false;
  return (results || []).filter((r) => (r.bron === BRON_ANNOTATIE ? annotaties : tekst));
}

/**
 * Groepeert treffers per pagina voor de resultatenlijst.
 * @returns {Array<{pagina:number,totaal:number,tekst:number,annotaties:number,
 *   soorten:Array<string>,eersteIndex:number}>} oplopend op paginanummer
 */
export function groepeerPerPagina(results) {
  const perPagina = new Map();
  (results || []).forEach((r, i) => {
    const index = Number.isInteger(r.index) ? r.index : i;
    let g = perPagina.get(r.pageNum);
    if (!g) {
      g = { pagina: r.pageNum, totaal: 0, tekst: 0, annotaties: 0, soorten: [], eersteIndex: index };
      perPagina.set(r.pageNum, g);
    }
    g.totaal++;
    if (r.bron === BRON_ANNOTATIE) {
      g.annotaties++;
      if (r.annotationType && !g.soorten.includes(r.annotationType)) g.soorten.push(r.annotationType);
    } else {
      g.tekst++;
    }
    if (index < g.eersteIndex) g.eersteIndex = index;
  });
  return [...perPagina.values()].sort((a, b) => a.pagina - b.pagina);
}

/** De groep waarin treffer `index` valt (voor het markeren van de huidige regel). */
export function groepVanTreffer(groepen, results, index) {
  const r = (results || [])[index];
  if (!r) return null;
  return (groepen || []).find((g) => g.pagina === r.pageNum) || null;
}
