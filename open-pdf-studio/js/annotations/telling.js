// Tellingen (#621).
//
// - De telmarkering van de app (type 'count'): één genummerde stip op een
//   punt. Zie saver/telling.js voor het opslaan.
// - Een telling van een ander programma: een /Polygon met /IT /PolygonCount;
//   elk hoekpunt is één getelde plek. De app laadt hem als veelhoek met de
//   ruwe sleutels (saver/ruwe-sleutels.js) en tekent hem als stippen op de
//   hoekpunten, niet als gesloten veelhoek: zo tekent dat programma hem ook.
//
// Puur: geen DOM, geen pdf-lib.

/** Straal van een telstip in punten (zoals het scherm de eigen telmarkering tekent). */
export const TELSTIP_STRAAL = 9;

/** Halve maat van het kader van een telmarkering: stip (straal 9) of symbool (22 pt). */
export const TELMARKERING_HALF = 11;

/**
 * Kader van de eigen telmarkering (type 'count'), gecentreerd op (x, y).
 * Het selectiekader van het selecteergereedschap, uitlijnen en de omhullende
 * van een selectie lezen dit; zonder kader viel de markering buiten elk
 * selectiekader (#934).
 * @returns {{x:number, y:number, width:number, height:number} | null}
 */
export function tellingKader(ann) {
  const x = Number(ann?.x), y = Number(ann?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const h = TELMARKERING_HALF;
  return { x: x - h, y: y - h, width: 2 * h, height: 2 * h };
}

/** Is dit een telling van een ander programma (/IT /PolygonCount)? */
export function isVreemdeTelling(ann) {
  return ann?.type === 'polygon' && ann?.pdfRaw?.sleutels?.IT?.n === 'PolygonCount';
}

/**
 * Straal van de stippen van een vreemde telling: /CountScale schaalt de
 * standaardmaat (zonder schaal 1). Begrensd, zodat een vreemde waarde geen
 * vlakvullende stip wordt.
 */
export function tellingStraal(ann) {
  const schaal = Number(ann?.pdfRaw?.sleutels?.CountScale);
  const s = Number.isFinite(schaal) && schaal > 0 ? Math.min(schaal, 10) : 1;
  return 4 * s;
}

// --- Telgroepen (#935) ---
//
// Een telgroep is de categorie van een telmarkering (ann.categoryId). De
// definities (naam, kleur, stijl) staan per sessie in countStore; elke
// markering draagt daarnaast de groepsnaam (ann.categoryName), zodat een
// heropend bestand zijn groepen terugkrijgt zonder aparte opslag. De nummers
// lopen per groep in documentvolgorde: 1, 2, 3, … zonder gaten.

/** Sleutel van de groep van een markering; '' = geen groep. */
export function telGroepSleutel(ann) {
  return ann?.categoryId ? String(ann.categoryId) : '';
}

const isTelmarkering = (a) => a?.type === 'count';

/**
 * Nieuwe nummers voor de markeringen van de gegeven groepen (alle groepen
 * zonder `groepen`): per groep 1..n in documentvolgorde.
 * @param {object[]} annotaties
 * @param {Iterable<string|null|undefined>} [groepen]  categoryId's ('' / null = geen groep)
 * @returns {{ann: object, number: number}[]}  alleen de markeringen waarvan het nummer verandert
 */
export function hernummerTellingen(annotaties, groepen) {
  const filter = groepen ? new Set([...groepen].map(g => (g ? String(g) : ''))) : null;
  const teller = new Map();
  const wijzigingen = [];
  for (const a of annotaties || []) {
    if (!isTelmarkering(a)) continue;
    const g = telGroepSleutel(a);
    if (filter && !filter.has(g)) continue;
    const n = (teller.get(g) || 0) + 1;
    teller.set(g, n);
    if (a.number !== n) wijzigingen.push({ ann: a, number: n });
  }
  return wijzigingen;
}

/** Nummer voor de volgende markering in een groep: één hoger dan het hoogste of het aantal. */
export function volgendTelNummer(annotaties, categoryId) {
  const g = categoryId ? String(categoryId) : '';
  let aantal = 0, hoogste = 0;
  for (const a of annotaties || []) {
    if (!isTelmarkering(a) || telGroepSleutel(a) !== g) continue;
    aantal++;
    if (Number.isFinite(a.number) && a.number > hoogste) hoogste = a.number;
  }
  return Math.max(aantal, hoogste) + 1;
}

/** Sleutel van de rij met markeringen zonder groep. */
export const GEEN_TELGROEP = '(geen)';

/**
 * De telgroepen met hun aantal: eerst de gedefinieerde groepen (ook met 0),
 * dan groepen die alleen op markeringen voorkomen (uit een geopend bestand;
 * naam uit ann.categoryName, kleur van de eerste markering), en tot slot de
 * markeringen zonder groep.
 * @param {{id:string, name:string, color?:string, markerStyle?:string, symbolId?:string}[]} definities
 * @param {object[]} annotaties
 * @returns {{id:string, name:string, color:string, markerStyle:string, symbolId?:string, count:number, fromDocument?:boolean}[]}
 */
export function telGroepen(definities, annotaties) {
  const aantal = new Map();
  const uitDocument = new Map();
  for (const a of annotaties || []) {
    if (!isTelmarkering(a)) continue;
    const g = telGroepSleutel(a) || GEEN_TELGROEP;
    aantal.set(g, (aantal.get(g) || 0) + 1);
    if (g !== GEEN_TELGROEP && !uitDocument.has(g)) {
      uitDocument.set(g, {
        id: g,
        name: a.categoryName || g,
        color: a.color || a.strokeColor || '#e11d48',
        markerStyle: a.markerStyle === 'symbol' ? 'symbol' : 'dot',
        ...(a.symbolId ? { symbolId: a.symbolId } : {}),
      });
    }
  }
  const bekend = new Set();
  const rijen = [];
  for (const d of definities || []) {
    bekend.add(d.id);
    rijen.push({ markerStyle: 'dot', color: '#e11d48', ...d, count: aantal.get(d.id) || 0 });
  }
  for (const [id, d] of uitDocument) {
    if (!bekend.has(id)) rijen.push({ ...d, count: aantal.get(id) || 0, fromDocument: true });
  }
  if (aantal.has(GEEN_TELGROEP)) {
    rijen.push({ id: GEEN_TELGROEP, name: '(geen categorie)', color: '#888888', markerStyle: 'dot', count: aantal.get(GEEN_TELGROEP) });
  }
  return rijen;
}

/**
 * Wat er met een markering gebeurt als ze in een groep komt: groep, naam en
 * de opmaak van de groep (kleur, stijl, symbool). Zonder groep blijft de
 * opmaak staan.
 * @returns {object} velden om op de markering te zetten
 */
export function telGroepVelden(groep) {
  if (!groep || groep.id === GEEN_TELGROEP) return { categoryId: null, categoryName: undefined };
  return {
    categoryId: groep.id,
    categoryName: groep.name,
    color: groep.color,
    strokeColor: groep.color,
    markerStyle: groep.markerStyle === 'symbol' && groep.symbolId ? 'symbol' : 'dot',
    symbolId: groep.symbolId,
  };
}
