// Annotatielagen in de PDF (#468) — schrijven en lezen, zonder app-state.
//
// Per laag een optional content group (OCG). Daarmee zijn de lagen ook in
// andere PDF-lezers aan en uit te zetten (hetzelfde mechanisme als de lagen
// van een tekening, #377):
//
//   /Root
//     /OCProperties <<
//       /OCGs [ …lagen van de tekening…  ocgStandaard ocgA ocgB ]
//       /D << /Order [ …tekening…  ocgStandaard ocgA ocgB ]
//             /OFF   [ …tekening…  uitgezette annotatielagen ]
//             /AS    [ << /Event /Print /OCGs [niet-afdrukbare lagen]
//                         /Category [/Print] /OPS_AnnotLayers true >> ] >>
//     >>
//     /OPS_AnnotLayers << /Layers [ocgStandaard ocgA ocgB] /Current (id) >>
//
//   OCG: << /Type /OCG /Name (Constructie) /OPS_LayerId (l…)
//           /OPS_Color (#ff0000) /OPS_Locked true /OPS_Printable false
//           /Usage << /Print << /PrintState /OFF >> >> >>
//
//   annotatie: /OC ocgA
//
// Naam en zichtbaarheid zijn gewone PDF (/Name, /D /OFF). Niet afdrukbaar
// staat er in twee vormen: /Usage + /AS voor andere lezers, /OPS_Printable
// voor deze app. Wat een OCG niet kent — kleur, vergrendeld, de volgorde van
// het paneel en de huidige laag — staat in eigen OPS_-sleutels.
//
// Lagen van de tekening zelf (een CAD-PDF) blijven staan: alleen de eigen
// OCG's (herkenbaar aan /OPS_LayerId) worden toegevoegd, bijgewerkt of
// verwijderd. Een document zonder lagen raakt het bestand niet aan.
//
// Lagen van een ander programma (#621): een OCG zonder /OPS_LayerId waar een
// annotatie met /OC naar wijst, is een annotatielaag van dat programma. De
// lader maakt er een laag van met het id 'ocg-<object>-<generatie>', met de
// naam, zichtbaarheid, vergrendeling en afdrukstand uit het bestand. Bij het
// opslaan krijgt diezelfde OCG het id als /OPS_LayerId erbij: hij blijft
// staan (geen tweede groep met dezelfde naam) en is daarna een eigen laag.
// Een OCG waar geen annotatie naar wijst (inhoud van de tekening, een
// watermerk) is geen annotatielaag en blijft buiten het paneel.
//
// Een laag van de tekening als annotatielaag (#377): in het eigenschappen-
// paneel kan een markering op een laag van de tekening gezet worden. Dat is
// dezelfde route: een laag 'ocg-<object>-<generatie>' die bij het opslaan
// de OCG van de tekening zelf als /OC krijgt. Zo'n "overgenomen" OCG blijft
// een laag van de tekening: hij houdt zijn plek in /Order, /Locked en
// /RBGroups, blijft in het paneel Lagen staan, en verdwijnt niet uit het
// bestand als de annotatielaag weggaat (alleen de OPS_-sleutels gaan eraf).

import { PDFName, PDFArray, PDFDict, PDFRef, PDFBool } from 'pdf-lib';
import { pdfTextString, decodePdfTextObject } from './pdf-text.js';
import {
  DEFAULT_LAYER_ID, layerIdOf, getLayers, layersInUse,
} from '../../annotations/annotatie-lagen.js';

export const LAGEN_CATALOGUS_SLEUTEL = 'OPS_AnnotLayers';

const N = (s) => PDFName.of(s);

function opgezocht(context, raw) {
  return raw instanceof PDFRef ? context.lookup(raw) : raw;
}

function tekst(context, raw) {
  const v = opgezocht(context, raw);
  if (!v) return undefined;
  const t = decodePdfTextObject(v);
  if (t !== undefined) return t;
  return typeof v.decodeText === 'function' ? v.decodeText() : undefined;
}

function isWaar(context, raw) {
  const v = opgezocht(context, raw);
  return v === PDFBool.True || String(v) === 'true';
}

function isOnwaar(context, raw) {
  const v = opgezocht(context, raw);
  return v === PDFBool.False || String(v) === 'false';
}

const VREEMD_ID = /^ocg-(\d+)-(\d+)$/;

/** Is dit het id van een overgenomen OCG (van de tekening of een ander programma)? */
function isOvergenomenId(id) {
  return typeof id === 'string' && VREEMD_ID.test(id);
}

/** Het laag-id voor een OCG van een ander programma (zie de kop). */
function vreemdId(ref) {
  return `ocg-${ref.objectNumber}-${ref.generationNumber || 0}`;
}

function isOcg(context, raw) {
  const dict = opgezocht(context, raw);
  return dict instanceof PDFDict && String(dict.get(N('Type'))) === '/OCG';
}

/** Het laag-id van een eigen OCG (ref of dict), anders undefined. */
function eigenId(context, raw) {
  const dict = opgezocht(context, raw);
  if (!(dict instanceof PDFDict)) return undefined;
  const id = tekst(context, dict.get(N('OPS_LayerId')));
  return typeof id === 'string' && id ? id : undefined;
}

function arrayVan(context, dict, sleutel) {
  if (!(dict instanceof PDFDict)) return null;
  const v = opgezocht(context, dict.get(N(sleutel)));
  return v instanceof PDFArray ? v : null;
}

/** Een array in place vullen, zodat een indirect object indirect blijft. */
function vervangInhoud(array, elementen) {
  while (array.size() > 0) array.remove(0);
  for (const e of elementen) array.push(e);
}

/** Eigen refs uit een (mogelijk geneste, zoals /Order) array halen. */
function zonderEigen(context, array, eigen) {
  if (!array) return;
  const over = [];
  for (const e of array.asArray()) {
    if (e instanceof PDFRef && eigen.has(e)) continue;
    const genest = opgezocht(context, e);
    if (genest instanceof PDFArray) zonderEigen(context, genest, eigen);
    over.push(e);
  }
  if (over.length !== array.size()) vervangInhoud(array, over);
}

function ocProperties(pdfDoc) {
  const oc = pdfDoc.catalog.lookup(N('OCProperties'));
  return oc instanceof PDFDict ? oc : null;
}

/** De eigen OCG's in het bestand: id → ref. Leest alleen. */
function eigenOcgs(pdfDoc) {
  const context = pdfDoc.context;
  const uit = new Map();
  const kandidaten = [];
  const eigenLijst = arrayVan(context, opgezocht(context, pdfDoc.catalog.get(N(LAGEN_CATALOGUS_SLEUTEL))), 'Layers');
  if (eigenLijst) kandidaten.push(...eigenLijst.asArray());
  const ocgs = arrayVan(context, ocProperties(pdfDoc), 'OCGs');
  if (ocgs) kandidaten.push(...ocgs.asArray());
  for (const ref of kandidaten) {
    if (!(ref instanceof PDFRef)) continue;
    const id = eigenId(context, ref);
    if (id && !uit.has(id)) uit.set(id, ref);
  }
  return uit;
}

// Onze /AS-regel voor het afdrukken herkennen we aan /OPS_AnnotLayers.
function isEigenAsRegel(context, raw) {
  const d = opgezocht(context, raw);
  return d instanceof PDFDict && d.get(N(LAGEN_CATALOGUS_SLEUTEL)) !== undefined;
}

function zetOfWis(dict, sleutel, waarde) {
  if (waarde === null || waarde === undefined) dict.delete(N(sleutel));
  else dict.set(N(sleutel), waarde);
}

/** Alle sporen van de eigen OCG's uit /OCProperties halen. */
function verwijderEigen(pdfDoc, eigen) {
  const context = pdfDoc.context;
  const oc = ocProperties(pdfDoc);
  if (!oc) return;
  zonderEigen(context, arrayVan(context, oc, 'OCGs'), eigen);
  const d = opgezocht(context, oc.get(N('D')));
  if (d instanceof PDFDict) {
    for (const sleutel of ['Order', 'ON', 'OFF', 'Locked', 'RBGroups']) {
      zonderEigen(context, arrayVan(context, d, sleutel), eigen);
    }
    const as = arrayVan(context, d, 'AS');
    if (as) {
      const over = as.asArray().filter((r) => !isEigenAsRegel(context, r));
      if (over.length !== as.size()) {
        if (over.length === 0) d.delete(N('AS'));
        else vervangInhoud(as, over);
      }
    }
  }
  const ocgs = arrayVan(context, oc, 'OCGs');
  // Zonder één OCG heeft /OCProperties geen betekenis meer.
  if (!ocgs || ocgs.size() === 0) pdfDoc.catalog.delete(N('OCProperties'));
}

const EIGEN_SLEUTELS = ['OPS_LayerId', 'OPS_Color', 'OPS_Locked', 'OPS_Printable'];

/**
 * Eigen OCG's die uit het model verdwenen: een OCG die we zelf maakten gaat
 * weg; een overgenomen OCG (zie de kop) blijft als laag van de tekening
 * staan, zonder onze sleutels.
 */
function ruimEigenOp(pdfDoc, weg) {
  const context = pdfDoc.context;
  const verwijderen = new Set();
  for (const [id, ref] of weg) {
    if (!isOvergenomenId(id)) {
      verwijderen.add(ref);
      continue;
    }
    const dict = context.lookup(ref);
    if (!(dict instanceof PDFDict)) continue;
    for (const k of EIGEN_SLEUTELS) dict.delete(N(k));
    if (isEigenUsage(context, dict.get(N('Usage')))) dict.delete(N('Usage'));
  }
  if (verwijderen.size) verwijderEigen(pdfDoc, verwijderen);
}

/** Staat `ref` ergens in deze (mogelijk geneste) array? */
function bevat(context, array, ref, diepte = 0) {
  if (!array || diepte > 10) return false;
  for (const e of array.asArray()) {
    if (e === ref) return true;
    const genest = opgezocht(context, e);
    if (genest instanceof PDFArray && bevat(context, genest, ref, diepte + 1)) return true;
  }
  return false;
}

/**
 * Schrijf de annotatielagen in het document.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {object[]|null} lagen  de lagen van het model (layersForSave), of null
 *   als het document geen lagen heeft: dan blijft een bestand zonder eigen
 *   lagen byte-voor-byte gelijk, en worden eerder geschreven lagen opgeruimd.
 * @param {{standaardNaam?:string, huidigeLaag?:string|null}} [opties]
 *   standaardNaam: de /Name van de standaardlaag voor andere lezers.
 * @returns {Map<string, PDFRef>|null} laag-id → OCG, voor /OC op de annotaties
 */
export function schrijfAnnotatieLagen(pdfDoc, lagen, { standaardNaam = 'Default', huidigeLaag = null } = {}) {
  const context = pdfDoc.context;
  const catalog = pdfDoc.catalog;
  const bestaand = eigenOcgs(pdfDoc);

  if (!Array.isArray(lagen) || lagen.length === 0) {
    if (bestaand.size === 0 && catalog.get(N(LAGEN_CATALOGUS_SLEUTEL)) === undefined) return null;
    ruimEigenOp(pdfDoc, bestaand);
    catalog.delete(N(LAGEN_CATALOGUS_SLEUTEL));
    return null;
  }

  // De OCG per laag: bestaande hergebruiken (zelfde object, geen groei per save).
  const refs = new Map();
  for (const laag of lagen) {
    if (!laag || typeof laag.id !== 'string' || refs.has(laag.id)) continue;
    let ref = bestaand.get(laag.id) || vreemdeOcgTerug(pdfDoc, laag);
    let dict = ref ? context.lookup(ref) : null;
    if (!(dict instanceof PDFDict)) {
      dict = context.obj({});
      ref = context.register(dict);
    }
    const naam = laag.id === DEFAULT_LAYER_ID ? standaardNaam : laag.name;
    dict.set(N('Type'), N('OCG'));
    dict.set(N('Name'), pdfTextString(naam || laag.id));
    dict.set(N('OPS_LayerId'), pdfTextString(laag.id));
    zetOfWis(dict, 'OPS_Color', laag.color ? pdfTextString(laag.color) : null);
    zetOfWis(dict, 'OPS_Locked', laag.locked ? PDFBool.True : null);
    zetOfWis(dict, 'OPS_Printable', laag.printable === false ? PDFBool.False : null);
    if (laag.printable === false) dict.set(N('Usage'), context.obj({ Print: { PrintState: 'OFF' } }));
    else if (isEigenUsage(context, dict.get(N('Usage')))) dict.delete(N('Usage'));
    refs.set(laag.id, ref);
  }
  const eigenRefs = [...refs.values()];
  const alleEigen = new Set([...bestaand.values(), ...eigenRefs]);

  // /OCProperties: aanvullen, niet overschrijven.
  let oc = ocProperties(pdfDoc);
  if (!oc) {
    oc = context.obj({});
    catalog.set(N('OCProperties'), oc);
  }
  let ocgs = arrayVan(context, oc, 'OCGs');
  if (!ocgs) {
    ocgs = context.obj([]);
    oc.set(N('OCGs'), ocgs);
  }
  // Overgenomen OCG's (zie de kop) houden hun plek in /OCGs, in de boom, hun
  // slot en hun keuzegroep.
  const overgenomen = new Set(lagen.filter((l) => l && isOvergenomenId(l.id)).map((l) => refs.get(l.id)).filter(Boolean));
  const vreemdeOcgs = ocgs.asArray().filter((r) => !(r instanceof PDFRef && alleEigen.has(r) && !overgenomen.has(r)));
  vervangInhoud(ocgs, [...vreemdeOcgs, ...eigenRefs.filter((r) => !vreemdeOcgs.includes(r))]);

  let d = opgezocht(context, oc.get(N('D')));
  if (!(d instanceof PDFDict)) {
    d = context.obj({});
    oc.set(N('D'), d);
  }
  const losTeMaken = new Set([...alleEigen].filter((r) => !overgenomen.has(r)));
  for (const sleutel of ['Locked', 'RBGroups']) zonderEigen(context, arrayVan(context, d, sleutel), losTeMaken);

  // Volgorde in het lagenpaneel van andere lezers: de tekening eerst, dan de
  // annotatielagen in de volgorde van ons paneel.
  let order = arrayVan(context, d, 'Order');
  if (order) {
    const alInBoom = new Set([...overgenomen].filter((r) => bevat(context, order, r)));
    zonderEigen(context, order, new Set([...alleEigen].filter((r) => !alInBoom.has(r))));
    for (const r of eigenRefs) if (!alInBoom.has(r)) order.push(r);
  } else {
    order = context.obj([...vreemdeOcgs, ...eigenRefs.filter((r) => !vreemdeOcgs.includes(r))]);
    d.set(N('Order'), order);
  }

  // Zichtbaarheid: /OFF bij een basisstand AAN (standaard), /ON bij /OFF.
  const basisUit = String(d.get(N('BaseState'))) === '/OFF';
  const verborgen = lagen.filter((l) => l && l.visible === false).map((l) => refs.get(l.id)).filter(Boolean);
  const zichtbaar = eigenRefs.filter((r) => !verborgen.includes(r));
  let uit = arrayVan(context, d, 'OFF');
  zonderEigen(context, uit, alleEigen);
  let aan = arrayVan(context, d, 'ON');
  zonderEigen(context, aan, alleEigen);
  if (basisUit) {
    if (!aan && zichtbaar.length) { aan = context.obj([]); d.set(N('ON'), aan); }
    for (const r of zichtbaar) aan.push(r);
  } else {
    if (!uit && verborgen.length) { uit = context.obj([]); d.set(N('OFF'), uit); }
    for (const r of verborgen) uit.push(r);
  }

  // Niet afdrukbaar voor andere lezers: /AS met de gebeurtenis Print.
  const nietAfdrukbaar = lagen.filter((l) => l && l.printable === false).map((l) => refs.get(l.id)).filter(Boolean);
  let as = arrayVan(context, d, 'AS');
  const vreemdeAs = as ? as.asArray().filter((r) => !isEigenAsRegel(context, r)) : [];
  const eigenAs = nietAfdrukbaar.length
    ? [context.obj({ Event: 'Print', OCGs: nietAfdrukbaar, Category: ['Print'], [LAGEN_CATALOGUS_SLEUTEL]: true })]
    : [];
  if (as) {
    if (vreemdeAs.length + eigenAs.length === 0) d.delete(N('AS'));
    else vervangInhoud(as, [...vreemdeAs, ...eigenAs]);
  } else if (eigenAs.length) {
    d.set(N('AS'), context.obj(eigenAs));
  }

  // De volgorde van ons paneel en de huidige laag.
  const eigen = context.obj({ Layers: eigenRefs });
  if (huidigeLaag && huidigeLaag !== DEFAULT_LAYER_ID && refs.has(huidigeLaag)) {
    eigen.set(N('Current'), pdfTextString(huidigeLaag));
  }
  catalog.set(N(LAGEN_CATALOGUS_SLEUTEL), eigen);

  // Lagen die uit het model verdwenen zijn: nergens meer genoemd.
  const weg = new Map([...bestaand].filter(([id, r]) => !refs.has(id) && !eigenRefs.includes(r)));
  if (weg.size) ruimEigenOp(pdfDoc, weg);

  return refs;
}

/** De OCG voor /OC op een annotatie; een onbekende laag krijgt die van de standaardlaag. */
export function ocVoorAnnotatie(refs, ann) {
  if (!refs) return null;
  return refs.get(layerIdOf(ann)) || refs.get(DEFAULT_LAYER_ID) || null;
}

/**
 * Het laag-id achter /OC van een annotatie: van een eigen OCG, of van een OCG
 * van een ander programma (#621). Een lidmaatschapsregel (/OCMD) is geen laag.
 */
export function laagVanOc(context, ocRaw) {
  if (!ocRaw) return undefined;
  const eigen = eigenId(context, ocRaw);
  if (eigen) return eigen;
  return ocRaw instanceof PDFRef && isOcg(context, ocRaw) ? vreemdId(ocRaw) : undefined;
}

/** De OCG's zonder /OPS_LayerId waar een annotatie in het document naar wijst. */
function vreemdeAnnotatieOcgs(pdfDoc) {
  const context = pdfDoc.context;
  const uit = new Map();
  for (const pagina of pdfDoc.getPages()) {
    const annots = opgezocht(context, pagina.node.get(N('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (const a of annots.asArray()) {
      const dict = opgezocht(context, a);
      if (!(dict instanceof PDFDict)) continue;
      const oc = dict.get(N('OC'));
      if (!(oc instanceof PDFRef) || eigenId(context, oc) || !isOcg(context, oc)) continue;
      const id = vreemdId(oc);
      if (!uit.has(id)) uit.set(id, oc);
    }
  }
  return uit;
}

/**
 * De OCG van een laag van een ander programma in het uitvoerdocument: het
 * object met hetzelfde nummer als het nog een OCG zonder eigen id is, anders
 * een OCG zonder eigen id met dezelfde naam in /OCProperties.
 */
function vreemdeOcgTerug(pdfDoc, laag) {
  const context = pdfDoc.context;
  const m = VREEMD_ID.exec(laag.id || '');
  if (!m) return null;
  const kandidaat = PDFRef.of(Number(m[1]), Number(m[2]));
  if (isOcg(context, kandidaat) && !eigenId(context, kandidaat)) return kandidaat;
  const ocgs = arrayVan(context, ocProperties(pdfDoc), 'OCGs');
  for (const r of ocgs?.asArray() || []) {
    if (r instanceof PDFRef && isOcg(context, r) && !eigenId(context, r)
        && tekst(context, context.lookup(r).get(N('Name'))) === laag.name) return r;
  }
  return null;
}

// Alleen onze eigen /Usage (niet afdrukken) weghalen; die van een ander
// programma (bekijken, exporteren, …) blijft staan.
function isEigenUsage(context, raw) {
  const u = opgezocht(context, raw);
  if (!(u instanceof PDFDict) || u.keys().length !== 1) return false;
  const print = opgezocht(context, u.get(N('Print')));
  return print instanceof PDFDict && print.keys().length === 1 && String(print.get(N('PrintState'))) === '/OFF';
}

/** Het id dat pdf.js aan een OCG geeft (Ref.toString): "12R", of "12R3". */
function pdfjsId(ref) {
  return ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`;
}

/**
 * Lees de annotatielagen uit een document.
 * @returns {{lagen:object[], huidigeLaag:string|null, refs:Map<string,PDFRef>, ocgIds:Set<string>}|null}
 */
export function leesAnnotatieLagen(pdfDoc) {
  try {
    const context = pdfDoc.context;
    const eigen = opgezocht(context, pdfDoc.catalog.get(N(LAGEN_CATALOGUS_SLEUTEL)));
    let refs = [];
    const lijst = arrayVan(context, eigen, 'Layers');
    if (lijst) refs = lijst.asArray().filter((r) => r instanceof PDFRef && eigenId(context, r));
    if (refs.length === 0) refs = [...eigenOcgs(pdfDoc).values()];
    // Lagen van een ander programma (#621), na de eigen lagen.
    const vreemd = vreemdeAnnotatieOcgs(pdfDoc);
    if (refs.length === 0 && vreemd.size === 0) return null;

    const d = opgezocht(context, ocProperties(pdfDoc)?.get(N('D')));
    const inLijst = (sleutel) => new Set((arrayVan(context, d, sleutel)?.asArray() || []).filter((r) => r instanceof PDFRef));
    const uit = inLijst('OFF');
    const aan = inLijst('ON');
    const vast = inLijst('Locked');
    const basisUit = d instanceof PDFDict && String(d.get(N('BaseState'))) === '/OFF';

    const lagen = [];
    const perId = new Map();
    for (const ref of refs) {
      const id = eigenId(context, ref);
      if (!id || perId.has(id)) continue;
      const dict = context.lookup(ref);
      const kleur = tekst(context, dict.get(N('OPS_Color')));
      lagen.push({
        id,
        name: id === DEFAULT_LAYER_ID ? '' : (tekst(context, dict.get(N('Name'))) || id),
        color: typeof kleur === 'string' && /^#[0-9a-f]{6}$/i.test(kleur) ? kleur.toLowerCase() : null,
        visible: basisUit ? aan.has(ref) : !uit.has(ref),
        printable: !isOnwaar(context, dict.get(N('OPS_Printable'))),
        locked: isWaar(context, dict.get(N('OPS_Locked'))),
      });
      perId.set(id, ref);
    }
    // Een overgenomen OCG (#377) blijft een laag van de tekening.
    const eigenOcgIds = new Set([...perId].filter(([id]) => !isOvergenomenId(id)).map(([, r]) => pdfjsId(r)));
    for (const [id, ref] of vreemd) {
      if (perId.has(id)) continue;
      const dict = context.lookup(ref);
      const print = opgezocht(context, opgezocht(context, dict.get(N('Usage')))?.get?.(N('Print')));
      lagen.push({
        id,
        name: tekst(context, dict.get(N('Name'))) || id,
        color: null,
        visible: basisUit ? aan.has(ref) : !uit.has(ref),
        printable: !(print instanceof PDFDict && String(print.get(N('PrintState'))) === '/OFF'),
        locked: vast.has(ref),
      });
      perId.set(id, ref);
    }
    const huidig = eigen instanceof PDFDict ? tekst(context, eigen.get(N('Current'))) : undefined;
    return {
      lagen,
      huidigeLaag: typeof huidig === 'string' && perId.has(huidig) ? huidig : null,
      refs: perId,
      // Alleen de eigen OCG's verdwijnen uit het paneel met de lagen van de
      // tekening: een vreemde groep kan ook inhoud van de pagina schakelen.
      ocgIds: eigenOcgIds,
    };
  } catch {
    return null;
  }
}

/**
 * Gelezen lagen op het document zetten — één keer per document. Een tweede
 * lezing (na het herladen van de bytes) of een document waarop de gebruiker
 * al lagen maakte, blijft ongemoeid: het model is dan de waarheid.
 * @returns {boolean} of het model veranderd is
 */
export function pasGelezenLagenToe(doc, gelezen) {
  if (!doc || doc._annotatieLagenGelezen) return false;
  doc._annotatieLagenGelezen = true;
  if (!gelezen || !Array.isArray(gelezen.lagen) || gelezen.lagen.length === 0) return false;
  if (layersInUse(doc)) return false;
  // Eerst lokaal opschonen, dan één keer toewijzen en teruglezen: het document
  // in de app bewaart bij toewijzen een kopie (zie de schrijfregel in
  // annotations/annotatie-lagen.js).
  const lagen = getLayers({ annotationLayers: gelezen.lagen });
  doc.annotationLayers = lagen;
  doc.currentLayerId = gelezen.huidigeLaag && lagen.some((l) => l.id === gelezen.huidigeLaag)
    ? gelezen.huidigeLaag : null;
  doc._annotatieLaagOcgIds = new Set(gelezen.ocgIds || []);
  const terug = getLayers(doc);
  return terug.length === lagen.length && lagen.every((l, i) => terug[i].id === l.id);
}

/**
 * Lagen uit samengevoegde pagina's bij die van het document (samenvoegen.js):
 * wat het model nog niet kent, komt erachter; een laag met hetzelfde id is
 * dezelfde laag en blijft zoals het model hem had.
 * @returns {boolean} of het model veranderd is
 */
export function voegGelezenLagenToe(doc, gelezen) {
  if (!doc || !gelezen || !Array.isArray(gelezen.lagen) || gelezen.lagen.length === 0) return false;
  const bestaand = getLayers(doc);
  const ids = new Set(bestaand.map((l) => l.id));
  const erbij = getLayers({ annotationLayers: gelezen.lagen }).filter((l) => !ids.has(l.id));
  const ocgIds = new Set([...(doc._annotatieLaagOcgIds || []), ...(gelezen.ocgIds || [])]);
  doc._annotatieLaagOcgIds = ocgIds;
  if (!erbij.length) return false;
  // Eén toewijzing (het document bewaart een kopie, zie hierboven).
  doc.annotationLayers = [...bestaand, ...erbij];
  doc._annotatieLagenGelezen = true;
  return true;
}
