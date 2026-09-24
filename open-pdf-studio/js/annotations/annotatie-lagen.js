// Annotatielagen (#468): markeringen groeperen op benoemde lagen.
//
// Een document heeft een lijst lagen (`doc.annotationLayers`), elk met een
// id, een naam, een kleur, en de schakelaars zichtbaar, afdrukbaar en
// vergrendeld. De volgorde van de lijst is de volgorde in het paneel. Elke
// annotatie hoort bij één laag via `ann.layer`; zonder dat veld hoort ze bij
// de standaardlaag. Zo blijft een document zonder lagen precies wat het was:
// geen veld op de annotaties, niets extra's in het bestand.
//
// Deze module is puur: geen DOM, geen stores, geen state. Ze werkt op een
// document-achtig object `{ annotations, annotationLayers, currentLayerId }`.
// Het tekenen en de raakdetectie (view-filters.js), het paneel, de saver en
// de MCP-opdrachten gebruiken allemaal deze regels.

/** Id van de standaardlaag. Annotaties zonder `layer` horen hierbij. */
export const DEFAULT_LAYER_ID = 'default';

const MAX_NAAM = 120;
const HEX = /^#[0-9a-f]{6}$/i;

function schoneNaam(naam) {
  return typeof naam === 'string' ? naam.trim().slice(0, MAX_NAAM) : '';
}

function naamSleutel(naam) {
  return schoneNaam(naam).toLowerCase();
}

function schoneKleur(kleur) {
  return typeof kleur === 'string' && HEX.test(kleur.trim()) ? kleur.trim().toLowerCase() : null;
}

function standaardLaag() {
  return { id: DEFAULT_LAYER_ID, name: '', color: null, visible: true, printable: true, locked: false };
}

/** Eén laag in vaste vorm, of null als er geen bruikbaar id is. */
function normaliseer(ruw) {
  if (!ruw || typeof ruw !== 'object') return null;
  const id = typeof ruw.id === 'string' ? ruw.id.trim() : '';
  if (!id) return null;
  return {
    id,
    // De standaardlaag heeft geen eigen naam: die komt uit de vertaling.
    name: id === DEFAULT_LAYER_ID ? '' : schoneNaam(ruw.name),
    color: schoneKleur(ruw.color),
    visible: ruw.visible === undefined ? true : !!ruw.visible,
    printable: ruw.printable === undefined ? true : !!ruw.printable,
    locked: !!ruw.locked,
  };
}

/**
 * De lagen van een document, opgeschoond, altijd mét de standaardlaag.
 * Laat het document zelf ongemoeid.
 */
export function getLayers(doc) {
  const uit = [];
  const gezien = new Set();
  const ruw = Array.isArray(doc?.annotationLayers) ? doc.annotationLayers : [];
  for (const r of ruw) {
    const laag = normaliseer(r);
    if (!laag || gezien.has(laag.id)) continue;
    gezien.add(laag.id);
    uit.push(laag);
  }
  if (!gezien.has(DEFAULT_LAYER_ID)) uit.unshift(standaardLaag());
  return uit;
}

/** Schrijft de opgeschoonde lijst op het document en geeft haar terug. */
export function ensureLayers(doc) {
  const lagen = getLayers(doc);
  if (doc) doc.annotationLayers = lagen;
  return lagen;
}

export function findLayer(doc, id) {
  if (typeof id !== 'string' || !id) return null;
  return getLayers(doc).find((l) => l.id === id) || null;
}

/** Het laag-id van een annotatie; zonder veld de standaardlaag. */
export function layerIdOf(ann) {
  return (ann && typeof ann.layer === 'string' && ann.layer) ? ann.layer : DEFAULT_LAYER_ID;
}

/**
 * De laag van een annotatie. Een id dat het document niet kent (een laag die
 * verwijderd is, of een bestand uit een andere versie) valt terug op de
 * standaardlaag: dan blijft de annotatie gewoon zichtbaar en bruikbaar.
 */
export function layerOf(doc, ann) {
  const lagen = getLayers(doc);
  const id = layerIdOf(ann);
  return lagen.find((l) => l.id === id) || lagen.find((l) => l.id === DEFAULT_LAYER_ID);
}

/**
 * Een laag opzoeken zoals een gebruiker of assistent hem noemt: op id, anders
 * op naam (hoofdletters en spaties tellen niet). De standaardlaag is ook te
 * vinden op haar id en op de weergavenaam in `defaultName`.
 */
export function resolveLayer(doc, ref, { defaultName } = {}) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const lagen = getLayers(doc);
  const opId = lagen.find((l) => l.id === ref.trim());
  if (opId) return opId;
  const sleutel = naamSleutel(ref);
  const opNaam = lagen.find((l) => l.id !== DEFAULT_LAYER_ID && naamSleutel(l.name) === sleutel);
  if (opNaam) return opNaam;
  if (defaultName && naamSleutel(defaultName) === sleutel) {
    return lagen.find((l) => l.id === DEFAULT_LAYER_ID) || null;
  }
  return null;
}

function naamBezet(lagen, naam, behalveId) {
  const sleutel = naamSleutel(naam);
  return lagen.some((l) => l.id !== behalveId && l.id !== DEFAULT_LAYER_ID && naamSleutel(l.name) === sleutel);
}

/** De eerste vrije naam "<basis> n" (n vanaf 1). */
export function nextLayerName(doc, basis = 'Layer') {
  const lagen = getLayers(doc);
  for (let n = 1; ; n++) {
    const naam = `${basis} ${n}`;
    if (!naamBezet(lagen, naam, null)) return naam;
  }
}

function nieuwId(lagen) {
  for (;;) {
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!lagen.some((l) => l.id === id)) return id;
  }
}

/**
 * Een laag achteraan toevoegen. `props.id` is optioneel (de lader en XFDF
 * geven het bestaande id mee).
 * @returns {{ok:true, layer:object} | {ok:false, error:'name-empty'|'name-taken'|'id-taken'}}
 */
export function addLayer(doc, props = {}) {
  const lagen = ensureLayers(doc);
  const naam = schoneNaam(props.name);
  if (!naam) return { ok: false, error: 'name-empty' };
  if (naamBezet(lagen, naam, null)) return { ok: false, error: 'name-taken' };
  let id = typeof props.id === 'string' ? props.id.trim() : '';
  if (id && lagen.some((l) => l.id === id)) return { ok: false, error: 'id-taken' };
  if (!id) id = nieuwId(lagen);
  const laag = normaliseer({ ...props, id, name: naam });
  lagen.push(laag);
  return { ok: true, layer: laag };
}

export function renameLayer(doc, id, naam) {
  const lagen = ensureLayers(doc);
  const laag = lagen.find((l) => l.id === id);
  if (!laag) return { ok: false, error: 'not-found' };
  if (laag.id === DEFAULT_LAYER_ID) return { ok: false, error: 'default-layer' };
  const schoon = schoneNaam(naam);
  if (!schoon) return { ok: false, error: 'name-empty' };
  if (naamBezet(lagen, schoon, id)) return { ok: false, error: 'name-taken' };
  laag.name = schoon;
  return { ok: true };
}

/** Zichtbaar, afdrukbaar, vergrendeld en kleur bijwerken; de rest blijft. */
export function updateLayer(doc, id, patch = {}) {
  const lagen = ensureLayers(doc);
  const laag = lagen.find((l) => l.id === id);
  if (!laag) return { ok: false, error: 'not-found' };
  for (const sleutel of ['visible', 'printable', 'locked']) {
    if (patch[sleutel] !== undefined) laag[sleutel] = !!patch[sleutel];
  }
  if (patch.color !== undefined) laag.color = schoneKleur(patch.color);
  return { ok: true, layer: laag };
}

/** Een laag naar plek `naar` in de lijst verplaatsen (buiten bereik = achteraan). */
export function moveLayer(doc, id, naar) {
  const lagen = ensureLayers(doc);
  const van = lagen.findIndex((l) => l.id === id);
  if (van < 0) return { ok: false, error: 'not-found' };
  const [laag] = lagen.splice(van, 1);
  const doel = Number.isInteger(naar) ? Math.max(0, Math.min(naar, lagen.length)) : lagen.length;
  lagen.splice(doel, 0, laag);
  return { ok: true };
}

/**
 * Een laag uit de lijst halen. De annotaties erop laat deze functie staan:
 * de aanroeper beslist (verplaatsen of verwijderen, met een undo-stap). Wat
 * blijft staan valt terug op de standaardlaag (zie layerOf).
 */
export function deleteLayer(doc, id) {
  const lagen = ensureLayers(doc);
  if (id === DEFAULT_LAYER_ID) return { ok: false, error: 'default-layer' };
  const i = lagen.findIndex((l) => l.id === id);
  if (i < 0) return { ok: false, error: 'not-found' };
  lagen.splice(i, 1);
  if (doc.currentLayerId === id) doc.currentLayerId = DEFAULT_LAYER_ID;
  return { ok: true };
}

/** De annotaties van een laag; die van een onbekende laag tellen als standaard. */
export function annotationsOnLayer(doc, id) {
  const bekend = new Set(getLayers(doc).map((l) => l.id));
  const anns = Array.isArray(doc?.annotations) ? doc.annotations : [];
  return anns.filter((a) => {
    const eigen = layerIdOf(a);
    return (bekend.has(eigen) ? eigen : DEFAULT_LAYER_ID) === id;
  });
}

/**
 * Annotaties op een laag zetten. De standaardlaag haalt het veld weg, zodat
 * zo'n annotatie er precies zo uitziet als een die nooit een laag had.
 * @returns {number} hoeveel annotaties er echt veranderden
 */
export function assignLayer(anns, id) {
  let veranderd = 0;
  for (const a of anns || []) {
    if (!a || typeof a !== 'object') continue;
    if (layerIdOf(a) === (id || DEFAULT_LAYER_ID) && (id !== DEFAULT_LAYER_ID || !('layer' in a))) continue;
    if (!id || id === DEFAULT_LAYER_ID) delete a.layer;
    else a.layer = id;
    veranderd++;
  }
  return veranderd;
}

/** Aantal annotaties per laag-id (onbekende tellen bij de standaardlaag). */
export function countByLayer(doc) {
  const lagen = getLayers(doc);
  const tel = new Map(lagen.map((l) => [l.id, 0]));
  for (const a of Array.isArray(doc?.annotations) ? doc.annotations : []) {
    if (!a || a.type === '__tool-defaults__') continue;
    const id = tel.has(layerIdOf(a)) ? layerIdOf(a) : DEFAULT_LAYER_ID;
    tel.set(id, tel.get(id) + 1);
  }
  return tel;
}

/** De huidige laag: waar nieuwe markeringen op landen. Nooit een onbekende. */
export function currentLayerId(doc) {
  const id = doc?.currentLayerId;
  return (typeof id === 'string' && getLayers(doc).some((l) => l.id === id)) ? id : DEFAULT_LAYER_ID;
}

export function setCurrentLayer(doc, id) {
  if (!getLayers(doc).some((l) => l.id === id)) return { ok: false, error: 'not-found' };
  doc.currentLayerId = id;
  return { ok: true };
}

/** Het `layer`-veld voor een nieuwe annotatie: undefined voor de standaardlaag. */
export function layerForNewAnnotation(doc) {
  if (!doc) return undefined;
  const id = currentLayerId(doc);
  return id === DEFAULT_LAYER_ID ? undefined : id;
}

function staatAfwijkend(laag) {
  return !laag.visible || !laag.printable || laag.locked || !!laag.color;
}

/**
 * Heeft dit document iets aan lagen dat bewaard moet worden? Een eigen laag,
 * of een standaardlaag die niet in haar standaardstand staat. Zo niet, dan
 * schrijft de saver niets extra's en blijft het bestand zoals het was.
 */
export function layersInUse(doc) {
  const lagen = getLayers(doc);
  return lagen.length > 1 || lagen.some(staatAfwijkend);
}

/** De lagen die de saver moet schrijven, of null als er niets te bewaren is. */
export function layersForSave(doc) {
  return layersInUse(doc) ? getLayers(doc) : null;
}

// Snel pad voor het tekenen en de raakdetectie, die per annotatie per frame
// vragen: geen hele lijst normaliseren, alleen de ene laag opzoeken. Zelfde
// uitkomst als layerOf (eerste treffer wint, onbekend = standaardlaag).
function ruweLaag(ruw, id) {
  for (const r of ruw) {
    if (r && typeof r === 'object' && typeof r.id === 'string' && r.id.trim() === id) return r;
  }
  return null;
}

function laagVan(doc, ann) {
  const ruw = doc?.annotationLayers;
  if (!Array.isArray(ruw) || ruw.length === 0) return null;
  return ruweLaag(ruw, layerIdOf(ann)) || ruweLaag(ruw, DEFAULT_LAYER_ID);
}

export function isLayerHidden(doc, ann) {
  const laag = laagVan(doc, ann);
  return !!laag && laag.visible !== undefined && !laag.visible;
}

export function isLayerLocked(doc, ann) {
  const laag = laagVan(doc, ann);
  return !!laag && !!laag.locked;
}

export function isLayerPrintable(doc, ann) {
  const laag = laagVan(doc, ann);
  return !laag || laag.printable === undefined || !!laag.printable;
}

/** De naam zoals het paneel hem toont; de standaardlaag krijgt de vertaling. */
export function layerDisplayName(laag, defaultName) {
  if (!laag) return '';
  return laag.id === DEFAULT_LAYER_ID ? (defaultName || 'Default') : laag.name;
}

/**
 * De regels van het lagenpaneel: per laag de weergavenaam, het aantal
 * markeringen, de schakelaars en of het de huidige laag is.
 */
export function layerRows(doc, defaultName) {
  const tel = countByLayer(doc);
  const huidig = currentLayerId(doc);
  return getLayers(doc).map((l) => ({
    id: l.id,
    name: layerDisplayName(l, defaultName),
    color: l.color,
    visible: l.visible,
    printable: l.printable,
    locked: l.locked,
    count: tel.get(l.id) || 0,
    current: l.id === huidig,
    isDefault: l.id === DEFAULT_LAYER_ID,
  }));
}
