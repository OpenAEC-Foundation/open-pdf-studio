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

import { PDFName, PDFArray, PDFDict, PDFRef, PDFBool } from 'pdf-lib';
import { pdfTextString, decodePdfTextObject } from './pdf-text.js';
import {
  DEFAULT_LAYER_ID, layerIdOf, getLayers, ensureLayers, findLayer, layersInUse,
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
    verwijderEigen(pdfDoc, new Set(bestaand.values()));
    catalog.delete(N(LAGEN_CATALOGUS_SLEUTEL));
    return null;
  }

  // De OCG per laag: bestaande hergebruiken (zelfde object, geen groei per save).
  const refs = new Map();
  for (const laag of lagen) {
    if (!laag || typeof laag.id !== 'string' || refs.has(laag.id)) continue;
    let ref = bestaand.get(laag.id);
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
    zetOfWis(dict, 'Usage', laag.printable === false
      ? context.obj({ Print: { PrintState: 'OFF' } }) : null);
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
  const vreemdeOcgs = ocgs.asArray().filter((r) => !(r instanceof PDFRef && alleEigen.has(r)));
  vervangInhoud(ocgs, [...vreemdeOcgs, ...eigenRefs]);

  let d = opgezocht(context, oc.get(N('D')));
  if (!(d instanceof PDFDict)) {
    d = context.obj({});
    oc.set(N('D'), d);
  }
  for (const sleutel of ['Locked', 'RBGroups']) zonderEigen(context, arrayVan(context, d, sleutel), alleEigen);

  // Volgorde in het lagenpaneel van andere lezers: de tekening eerst, dan de
  // annotatielagen in de volgorde van ons paneel.
  let order = arrayVan(context, d, 'Order');
  if (order) {
    zonderEigen(context, order, alleEigen);
    for (const r of eigenRefs) order.push(r);
  } else {
    order = context.obj([...vreemdeOcgs, ...eigenRefs]);
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
  const weg = new Set([...bestaand].filter(([id]) => !refs.has(id)).map(([, r]) => r));
  if (weg.size) verwijderEigen(pdfDoc, weg);

  return refs;
}

/** De OCG voor /OC op een annotatie; een onbekende laag krijgt die van de standaardlaag. */
export function ocVoorAnnotatie(refs, ann) {
  if (!refs) return null;
  return refs.get(layerIdOf(ann)) || refs.get(DEFAULT_LAYER_ID) || null;
}

/** Het laag-id achter /OC van een annotatie, alleen als het een eigen OCG is. */
export function laagVanOc(context, ocRaw) {
  if (!ocRaw) return undefined;
  return eigenId(context, ocRaw);
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
    if (refs.length === 0) return null;

    const d = opgezocht(context, ocProperties(pdfDoc)?.get(N('D')));
    const inLijst = (sleutel) => new Set((arrayVan(context, d, sleutel)?.asArray() || []).filter((r) => r instanceof PDFRef));
    const uit = inLijst('OFF');
    const aan = inLijst('ON');
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
    const huidig = eigen instanceof PDFDict ? tekst(context, eigen.get(N('Current'))) : undefined;
    return {
      lagen,
      huidigeLaag: typeof huidig === 'string' && perId.has(huidig) ? huidig : null,
      refs: perId,
      ocgIds: new Set([...perId.values()].map(pdfjsId)),
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
  doc.annotationLayers = gelezen.lagen.map((l) => ({ ...l }));
  ensureLayers(doc);
  doc.currentLayerId = gelezen.huidigeLaag && findLayer(doc, gelezen.huidigeLaag) ? gelezen.huidigeLaag : null;
  doc._annotatieLaagOcgIds = new Set(gelezen.ocgIds || []);
  return getLayers(doc).length > 0;
}
