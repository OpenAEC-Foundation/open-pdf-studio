// Pagina-organizer: het nog niet toegepaste plan achter de modus "Pagina's
// bewerken" (#764).
//
// Alles wat de gebruiker in de organizer doet — verplaatsen, draaien,
// verwijderen, invoegen, splitsen — gebeurt in dit plan en niet in het
// document. Pas bij Opslaan maakt organizer-apply.js er één pdf-lib-ronde van
// met één ongedaan-maakstap; Annuleren gooit het plan weg en laat het document
// ongemoeid.
//
// Een plan is { items, splits, bestanden }:
//   items      de pagina's van het resultaat, in volgorde. Elk item is
//              { id, bron: 'doc'|'blanco'|'bestand', pagina, rotatie } —
//              'doc' verwijst naar een pagina van het huidige document,
//              'bestand' naar een pagina van een ingevoegde PDF.
//   splits     de id's van de items waar een nieuw deel begint. Het eerste
//              item kan geen deel-start zijn: daar begint het altijd al.
//   bestanden  ingevoegde PDF's: id -> { naam, bytes, aantalPaginas }.
//
// Een splitspunt hangt aan het item erachter en niet aan een positienummer.
// Zo verhuist het mee als die pagina verschuift en verdwijnt het als de pagina
// verdwijnt, zonder dat er iets hernummerd hoeft te worden.
//
// Alle functies hier zijn puur: ze geven een nieuw plan terug en laten het
// oude staan (de organizer bewaart de oude plannen voor Ctrl+Z).

let teller = 0;

function nieuwId(prefix) {
  teller += 1;
  return `${prefix}${teller}`;
}

/** Alleen voor de tests: laat de id-teller weer bij nul beginnen. */
export function _resetIdTeller() {
  teller = 0;
}

function metItems(plan, items, extra = {}) {
  return { items, splits: plan.splits, bestanden: plan.bestanden, ...extra };
}

/**
 * Het beginplan voor een document van `aantalPaginas` pagina's: alle pagina's
 * in hun eigen volgorde, geen splitspunten, geen ingevoegde bestanden.
 */
export function maakPlan(aantalPaginas) {
  const items = [];
  for (let p = 1; p <= aantalPaginas; p++) {
    items.push({ id: nieuwId('p'), bron: 'doc', pagina: p, rotatie: 0 });
  }
  return { items, splits: new Set(), bestanden: new Map() };
}

/**
 * Staat het plan nog precies zoals het document is? Dan hoeft Opslaan niets te
 * doen (en is Annuleren hetzelfde als Opslaan).
 */
export function planOngewijzigd(plan, aantalPaginas) {
  if (!plan || plan.items.length !== aantalPaginas) return false;
  if (plan.splits.size || plan.bestanden.size) return false;
  return plan.items.every((item, i) => item.bron === 'doc' && item.pagina === i + 1 && !item.rotatie);
}

/** De positie van een item in het plan, of -1. */
export function positieVan(plan, id) {
  return plan.items.findIndex((item) => item.id === id);
}

/**
 * Verplaats `ids` naar `doelIndex`. Die index telt in de lijst ZÓNDER de
 * verplaatste items: de gap tussen twee blijvende pagina's heeft altijd
 * hetzelfde nummer, ook als er tien pagina's naartoe gaan.
 */
export function verplaats(plan, ids, doelIndex) {
  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  const verplaatst = plan.items.filter((item) => gekozen.has(item.id));
  if (!verplaatst.length) return plan;
  const rest = plan.items.filter((item) => !gekozen.has(item.id));
  const index = Math.max(0, Math.min(rest.length, Math.round(doelIndex)));
  // Staat alles al zo? Dan is er niets veranderd (en mag de stapel niet groeien).
  const nieuw = [...rest.slice(0, index), ...verplaatst, ...rest.slice(index)];
  if (nieuw.every((item, i) => item === plan.items[i])) return plan;
  return metItems(plan, nieuw);
}

/**
 * De gap tussen twee kaarten omrekenen naar een index voor `verplaats`. De
 * organizer kent alleen gaps (`voor kaart 3`), terwijl `verplaats` telt in de
 * lijst zónder de verplaatste pagina's: sleep je kaart 1 naar de gap vóór
 * kaart 3, dan is dat index 1 en niet 2.
 */
export function doelIndexVoorGap(plan, ids, gapIndex) {
  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  const grens = Math.max(0, Math.min(plan.items.length, Math.round(gapIndex)));
  let n = 0;
  for (let i = 0; i < grens; i++) {
    if (!gekozen.has(plan.items[i].id)) n++;
  }
  return n;
}

/** Draai `ids` over `graden` (een veelvoud van 90; negatief mag). */
export function draai(plan, ids, graden) {
  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  if (!gekozen.size) return plan;
  let veranderd = false;
  const items = plan.items.map((item) => {
    if (!gekozen.has(item.id)) return item;
    const rotatie = (((item.rotatie || 0) + graden) % 360 + 360) % 360;
    if (rotatie === item.rotatie) return item;
    veranderd = true;
    return { ...item, rotatie };
  });
  return veranderd ? metItems(plan, items) : plan;
}

/**
 * Verwijder `ids` uit het plan. Het laatste blad blijft staan: een leeg
 * document kunnen we niet opslaan, dus dat meldt de aanroeper.
 * @returns {{plan: object, ok: boolean, verwijderd: number}}
 */
export function verwijder(plan, ids) {
  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  const items = plan.items.filter((item) => !gekozen.has(item.id));
  if (!items.length) return { plan, ok: false, verwijderd: 0 };
  const splits = new Set([...plan.splits].filter((id) => !gekozen.has(id)));
  return { plan: { items, splits, bestanden: plan.bestanden }, ok: true, verwijderd: plan.items.length - items.length };
}

/** Voeg `aantal` blanco pagina's in op `index`, met de maat van `maat`. */
export function voegBlancoIn(plan, index, { breedte, hoogte, aantal = 1, maatId = 'a4' } = {}) {
  const items = [...plan.items];
  const at = Math.max(0, Math.min(items.length, Math.round(index)));
  const nieuw = [];
  for (let i = 0; i < Math.max(1, aantal); i++) {
    nieuw.push({ id: nieuwId('b'), bron: 'blanco', pagina: null, rotatie: 0, breedte, hoogte, maatId });
  }
  items.splice(at, 0, ...nieuw);
  return metItems(plan, items, { splits: plan.splits });
}

/**
 * Voeg de pagina's van een ingevoegde PDF in op `index`. De bytes blijven in
 * het plan staan: de organizer toont er miniaturen van en organizer-apply.js
 * kopieert de pagina's uit het bestand zelf.
 * @param {{bestandId: string, naam: string, bytes: Uint8Array, aantalPaginas: number}} bestand
 */
export function voegBestandToe(plan, index, bestand) {
  const items = [...plan.items];
  const at = Math.max(0, Math.min(items.length, Math.round(index)));
  const nieuw = [];
  for (let p = 1; p <= bestand.aantalPaginas; p++) {
    nieuw.push({ id: nieuwId('f'), bron: 'bestand', pagina: p, rotatie: 0, bestandId: bestand.bestandId });
  }
  items.splice(at, 0, ...nieuw);
  const bestanden = new Map(plan.bestanden);
  bestanden.set(bestand.bestandId, {
    naam: bestand.naam, bytes: bestand.bytes, aantalPaginas: bestand.aantalPaginas,
  });
  return { items, splits: plan.splits, bestanden };
}

/**
 * Zet of haalt het splitspunt vóór `id`. Vóór de eerste pagina kan het niet:
 * daar begint het eerste deel al.
 * @returns {{plan: object, aan: boolean}}
 */
export function wisselSplitsing(plan, id) {
  const index = positieVan(plan, id);
  if (index <= 0) return { plan, aan: false };
  const splits = new Set(plan.splits);
  const aan = !splits.has(id);
  if (aan) splits.add(id);
  else splits.delete(id);
  return { plan: { items: plan.items, splits, bestanden: plan.bestanden }, aan };
}

/**
 * De delen waarin het plan uiteenvalt: de reeksen pagina's tussen de
 * splitspunten. Zonder splitspunten is dat één deel. `van` en `tot` zijn
 * positienummers in het resultaat (vanaf 1), zoals de organizer ze toont.
 * @returns {{nummer: number, items: object[], van: number, tot: number}[]}
 */
export function splitsGroepen(plan) {
  const groepen = [];
  let huidig = [];
  let start = 1;
  plan.items.forEach((item, i) => {
    if (i > 0 && plan.splits.has(item.id) && huidig.length) {
      groepen.push({ items: huidig, van: start, tot: i });
      huidig = [];
      start = i + 1;
    }
    huidig.push(item);
  });
  if (huidig.length) groepen.push({ items: huidig, van: start, tot: plan.items.length });
  return groepen.map((groep, i) => ({ nummer: i + 1, ...groep }));
}

/** Hoeveel pagina's van elke soort staan er in het plan? Voor de kopregel. */
export function samenvatting(plan, aantalPaginas) {
  let ingevoegd = 0;
  let gedraaid = 0;
  const gezien = new Set();
  for (const item of plan.items) {
    if (item.bron !== 'doc') ingevoegd++;
    else gezien.add(item.pagina);
    if (item.rotatie) gedraaid++;
  }
  const groepen = splitsGroepen(plan);
  return {
    aantal: plan.items.length,
    verwijderd: Math.max(0, (aantalPaginas || 0) - gezien.size),
    ingevoegd,
    gedraaid,
    splitspunten: plan.splits.size,
    delen: groepen.length,
  };
}

/**
 * De vertaling van het plan naar het document: in welke volgorde de pagina's
 * komen, waar elke oude pagina naartoe gaat, en welke reeksen pagina's de
 * delen zijn.
 *
 * `pageMapping` geeft voor ELKE pagina van het oude document het nieuwe
 * nummer, of null als ze weg is. Pagina's die niet in de map staan (blanco en
 * ingevoegde) zijn nieuw voor het document; reloadFromBytes leest daar de
 * annotaties van in.
 *
 * @param {object} plan
 * @param {number} aantalPaginas  pagina's van het huidige document
 * @param {number} [huidigePagina]  de pagina die de gebruiker bekeek
 * @returns {{volgorde: object[], pageMapping: Record<number, number|null>,
 *            delen: {start: number, eind: number, titel: string|null}[],
 *            doelPagina: number}}
 */
export function bouwToewijzing(plan, aantalPaginas, huidigePagina = 1) {
  const volgorde = plan.items.map(({ id, bron, pagina, rotatie }) => ({ id, bron, pagina, rotatie: rotatie || 0 }));
  const pageMapping = {};
  plan.items.forEach((item, i) => {
    if (item.bron === 'doc') pageMapping[item.pagina] = i + 1;
  });
  for (let p = 1; p <= aantalPaginas; p++) {
    if (pageMapping[p] === undefined) pageMapping[p] = null;
  }
  const titels = groepenTitels(plan);
  const delen = splitsGroepen(plan).map((groep, i) => ({
    start: groep.van, eind: groep.tot, titel: titels[i] || null,
  }));
  return { volgorde, pageMapping, delen, doelPagina: pageMapping[huidigePagina] || 1 };
}

// De titel van een deel: de naam waaronder de gebruiker het herkent, als de
// ingevoegde PDF's een eigen naam hebben ("plan.pdf" → "plan"). Blanco delen
// en delen die alleen uit het document komen hebben geen naam.
function groepenTitels(plan) {
  return splitsGroepen(plan).map((groep) => {
    const bestand = groep.items.find((item) => item.bron === 'bestand');
    if (bestand) {
      const b = plan.bestanden.get(bestand.bestandId);
      if (b?.naam) return String(b.naam).replace(/\.pdf$/i, '');
    }
    return null;
  });
}

/** De nieuwe paginanummers van de gegeven items (voor "Uittreksel" en de balk). */
export function nieuweNummers(plan, ids) {
  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  const nummers = [];
  plan.items.forEach((item, i) => {
    if (gekozen.has(item.id)) nummers.push(i + 1);
  });
  return nummers;
}

/** De items die uit het document komen, in planorde — voor "Uittreksel". */
export function bronPaginas(plan, ids) {
  const gekozen = new Set(Array.isArray(ids) ? ids : [ids]);
  return plan.items.filter((item) => gekozen.has(item.id) && item.bron === 'doc').map((item) => item.pagina);
}
