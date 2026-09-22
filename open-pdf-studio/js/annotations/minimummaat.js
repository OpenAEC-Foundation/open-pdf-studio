// Eén gedeelde regel voor de ondergrens van een vorm.
//
// Een vorm mag willekeurig klein worden: de gebruiker zoomt in om precies te
// werken, en op een tekening 1:100 is 20 paginapunten al ruim 700 mm. Er is
// daarom GEEN bruikbaarheidsgrens in paginapunten meer. Wat overblijft:
//
//  - een TECHNISCHE ondergrens (MIN_VORM_MAAT_PT) die alleen nul, negatief,
//    NaN en Infinity uit het model houdt;
//  - grenzen die over het SCHERM gaan (klik of sleep, raakvlak, minimale maat
//    van een schaalgebied) en daarom in schermpixels staan: px / zoom.
//
// Dit bestand heeft bewust GEEN imports, zodat het ook in Node getest wordt
// (minimummaat.test.mjs). De browserkant zit in transforms.js, de tools en de
// invoerpaden (paneel, MCP-brug).

/**
 * Technische ondergrens voor breedte/hoogte van een vorm, in paginapunten.
 *
 * 0,01 pt, omdat:
 *  - bij de maximale zoom (6400 %) is één schermpixel 1/64 = 0,0156 pt; de
 *    grens ligt dus onder wat aanwijsbaar is en wordt nooit "gevoeld";
 *  - de vector-appearances ronden af op 0,001 pt — tien keer kleiner;
 *  - ver boven 1e-6, waaronder JavaScript een getal in exponentnotatie
 *    schrijft (ongeldig in een PDF-inhoudsstroom), ook voor afgeleide
 *    waarden als de halve maat;
 *  - boven de float32-resolutie van PDF-lezers op A0-coördinaten.
 */
export const MIN_VORM_MAAT_PT = 0.01;

/** Onder deze sleepafstand (schermpixels, per as) telt een sleep als klik. */
export const KLIK_DREMPEL_PX = 4;

/** Minimale maat van een schaalgebied/viewport/schaalbalk bij slepen (schermpixels). */
export const MIN_GEBIED_PX = 16;

/** Een vorm kleiner dan dit op het scherm krijgt een opgerekt raakvlak (schermpixels). */
export const MIN_RAAKVLAK_PX = 10;

function _ondergrens(min) {
  return (typeof min === 'number' && Number.isFinite(min) && min > MIN_VORM_MAAT_PT)
    ? min : MIN_VORM_MAAT_PT;
}

function _getal(waarde) {
  if (typeof waarde === 'number') return waarde;
  if (typeof waarde === 'string' && waarde.trim() !== '') return Number(waarde);
  return NaN;
}

/**
 * Maak van een willekeurige waarde een geldige maat: eindig en >= ondergrens.
 * Nul, negatief, NaN, Infinity en niet-getallen worden de ondergrens.
 */
export function klemMaat(waarde, min = MIN_VORM_MAAT_PT) {
  const grens = _ondergrens(min);
  const n = _getal(waarde);
  if (!Number.isFinite(n) || n < grens) return grens;
  return n;
}

/** true wanneer waarde een getal is dat als maat in het model mag staan. */
export function isGeldigeMaat(waarde, min = MIN_VORM_MAAT_PT) {
  return typeof waarde === 'number' && Number.isFinite(waarde) && waarde >= _ondergrens(min);
}

/** Schermpixels omgerekend naar paginapunten bij de huidige zoom (px / zoom). */
export function schermPxNaarPt(px, schaal) {
  const s = (typeof schaal === 'number' && Number.isFinite(schaal) && schaal > 0) ? schaal : 1;
  return px / s;
}

/** Breedte/hoogte-verhouding, of 0 wanneer die niet bruikbaar is (geen deling door nul). */
export function veiligeVerhouding(breedte, hoogte) {
  if (!(breedte > 0) || !(hoogte > 0)) return 0;
  const v = breedte / hoogte;
  return (Number.isFinite(v) && v > 0) ? v : 0;
}

/**
 * Delingswacht met behoud van teken: een waarde dichter bij nul dan de
 * ondergrens wordt ±ondergrens. Voor maten die mogen omklappen (vrije hand).
 */
export function nietNul(waarde, min = MIN_VORM_MAAT_PT) {
  const grens = _ondergrens(min);
  if (!Number.isFinite(waarde)) return grens;
  if (Math.abs(waarde) >= grens) return waarde;
  return (waarde < 0 || Object.is(waarde, -0)) ? -grens : grens;
}

/**
 * Rechthoek met positieve maat en x/y op de linkerbovenhoek. Een negatieve
 * maat wordt omgeklapt (zelfde vlak), nul/NaN wordt de ondergrens.
 */
export function normaliseerRechthoek(r, min = MIN_VORM_MAAT_PT) {
  let x = Number.isFinite(r?.x) ? r.x : 0;
  let y = Number.isFinite(r?.y) ? r.y : 0;
  let width = _getal(r?.width);
  let height = _getal(r?.height);
  if (Number.isFinite(width) && width < 0) { x += width; width = -width; }
  if (Number.isFinite(height) && height < 0) { y += height; height = -height; }
  return { x, y, width: klemMaat(width, min), height: klemMaat(height, min) };
}

/** Vormen waarvan x/y/width/height samen de geometrie zijn. */
export const RECHTHOEK_VORMEN = new Set([
  'box', 'mask', 'circle', 'highlight', 'polygon', 'cloud', 'textbox', 'callout',
  'image', 'stamp', 'signature', 'scaleBar', 'scheduleTable', 'parametricSymbol',
  'viewport', 'scaleRegion', 'redaction',
]);

/**
 * Laatste wacht op elk aanmaakpad (tools, plakken, MCP, laden): een
 * rechthoek-vorm komt nooit met nul, negatief of NaN in het model. Alleen
 * velden die er al zijn worden aangeraakt; andere typen blijven met rust.
 * Muteert en geeft hetzelfde object terug.
 */
export function normaliseerVormMaat(ann) {
  if (!ann || typeof ann !== 'object' || !RECHTHOEK_VORMEN.has(ann.type)) return ann;
  if (ann.width !== undefined && ann.width !== null) {
    const w = _getal(ann.width);
    if (Number.isFinite(w) && w < 0 && Number.isFinite(ann.x)) { ann.x += w; ann.width = klemMaat(-w); }
    else ann.width = klemMaat(w);
  }
  if (ann.height !== undefined && ann.height !== null) {
    const h = _getal(ann.height);
    if (Number.isFinite(h) && h < 0 && Number.isFinite(ann.y)) { ann.y += h; ann.height = klemMaat(-h); }
    else ann.height = klemMaat(h);
  }
  return ann;
}

const _LINKS = { tl: true, bl: true, l: true };
const _RECHTS = { tr: true, br: true, r: true };
const _BOVEN = { tl: true, tr: true, t: true };
const _ONDER = { bl: true, br: true, b: true };

/**
 * Schaal een rechthoek met één van de acht maatgrepen.
 *
 * Volgorde: maat berekenen -> klemmen -> positie uit het VASTE punt tegenover
 * de greep. Daardoor loopt de vorm niet weg wanneer de klem grijpt, en klapt
 * een sleep voorbij het vaste punt niet om maar zakt naar de ondergrens.
 * Alleen de as die de greep aanstuurt verandert: een al kleine breedte springt
 * niet omhoog wanneer je de hoogte sleept.
 *
 * @param {{x:number,y:number,width:number,height:number}} orig  maat vóór de sleep
 * @param {string} greep  'tl','tr','bl','br','t','b','l','r'
 * @param {number} deltaX  sleep in paginapunten (paginaruimte)
 * @param {number} deltaY
 * @param {object} [opties]
 * @param {number} [opties.minBreedte]  eigen ondergrens (tekstvak, schaalgebied)
 * @param {number} [opties.minHoogte]
 * @param {boolean} [opties.vasteVerhouding]
 * @param {number} [opties.verhouding]  breedte/hoogte; onbruikbaar -> vrij schalen
 * @param {number} [opties.rotatie]  graden; de vorm draait om zijn midden
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function schaalRechthoekMetGreep(orig, greep, deltaX, deltaY, opties = {}) {
  const o = normaliseerRechthoek(orig);
  const stuurtLinks = !!_LINKS[greep], stuurtRechts = !!_RECHTS[greep];
  const stuurtBoven = !!_BOVEN[greep], stuurtOnder = !!_ONDER[greep];
  if (!stuurtLinks && !stuurtRechts && !stuurtBoven && !stuurtOnder) return o;

  let dx = Number.isFinite(deltaX) ? deltaX : 0;
  let dy = Number.isFinite(deltaY) ? deltaY : 0;
  const rotatie = Number.isFinite(opties.rotatie) ? opties.rotatie : 0;
  if (rotatie) {
    // Sleep van paginaruimte naar de lokale (ongedraaide) ruimte van de vorm.
    const rad = -rotatie * Math.PI / 180;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    dx = lx; dy = ly;
  }

  // Een eigen ondergrens houdt de vorm erboven, maar duwt een vorm die al
  // kleiner is (ingetypt, geladen) niet omhoog: die kan alleen niet verder
  // krimpen.
  const minB = Math.min(_ondergrens(opties.minBreedte), o.width);
  const minH = Math.min(_ondergrens(opties.minHoogte), o.height);

  const verhouding = opties.vasteVerhouding ? opties.verhouding : 0;
  const vast = typeof verhouding === 'number' && Number.isFinite(verhouding) && verhouding > 0;

  let breedte = o.width, hoogte = o.height;
  if (vast) {
    // Eén verhoudingsvaste breedte uit de sleep. Hoeken volgen de dominante
    // richting zodat schuin slepen natuurlijk blijft; randen hun eigen as.
    const bUitX = stuurtLinks ? o.width - dx : stuurtRechts ? o.width + dx : null;
    const hUitY = stuurtBoven ? o.height - dy : stuurtOnder ? o.height + dy : null;
    if (bUitX != null && hUitY != null) {
      breedte = Math.abs(dx) >= Math.abs(dy) ? bUitX : hUitY * verhouding;
    } else if (bUitX != null) {
      breedte = bUitX;
    } else {
      breedte = hUitY * verhouding;
    }
    // Proportionele klem: beide assen blijven boven hun ondergrens en de
    // verhouding blijft bij elke sleepafstand gelden.
    const grensB = Math.max(minB, minH * verhouding);
    if (!(breedte >= grensB)) breedte = grensB;
    hoogte = breedte / verhouding;
  } else {
    if (stuurtLinks) breedte = o.width - dx;
    else if (stuurtRechts) breedte = o.width + dx;
    if (stuurtBoven) hoogte = o.height - dy;
    else if (stuurtOnder) hoogte = o.height + dy;
    if (stuurtLinks || stuurtRechts) breedte = klemMaat(breedte, minB);
    if (stuurtBoven || stuurtOnder) hoogte = klemMaat(hoogte, minH);
  }

  // Positie uit het vaste punt, NA de klem.
  let x = o.x, y = o.y;
  if (stuurtLinks) x = o.x + o.width - breedte;
  else if (!stuurtRechts && vast) x = o.x + (o.width - breedte) / 2;
  if (stuurtBoven) y = o.y + o.height - hoogte;
  else if (!stuurtOnder && vast) y = o.y + (o.height - hoogte) / 2;

  if (rotatie) {
    // De vorm draait om zijn eigen midden: verschuif het nieuwe midden met de
    // teruggedraaide lokale verplaatsing, zodat het vaste punt op de pagina
    // blijft staan.
    const rad = rotatie * Math.PI / 180;
    const offX = (x + breedte / 2) - (o.x + o.width / 2);
    const offY = (y + hoogte / 2) - (o.y + o.height / 2);
    const cx = o.x + o.width / 2 + offX * Math.cos(rad) - offY * Math.sin(rad);
    const cy = o.y + o.height / 2 + offX * Math.sin(rad) + offY * Math.cos(rad);
    x = cx - breedte / 2;
    y = cy - hoogte / 2;
  }
  return { x, y, width: breedte, height: hoogte };
}

/**
 * Is een sleep op het scherm eigenlijk een klik? Rekent in schermpixels, zodat
 * je ingezoomd wél een heel kleine vorm kunt slepen. Beide assen moeten binnen
 * de drempel blijven: smal-maar-lang is een sleep.
 */
export function isKlikSleep(dx, dy, schaal, drempelPx = KLIK_DREMPEL_PX) {
  const grens = schermPxNaarPt(drempelPx, schaal);
  const ax = Number.isFinite(dx) ? Math.abs(dx) : 0;
  const ay = Number.isFinite(dy) ? Math.abs(dy) : 0;
  return ax < grens && ay < grens;
}

/**
 * Extra raakmarge (paginapunten, per kant) voor een vorm die op het scherm
 * kleiner is dan MIN_RAAKVLAK_PX. Een grote vorm krijgt niets extra, zodat
 * "ernaast klikken" blijft deselecteren.
 */
export function raakMarge(maat, schaal, minPx = MIN_RAAKVLAK_PX) {
  if (!(typeof schaal === 'number' && Number.isFinite(schaal) && schaal > 0)) return 0;
  const m = Number.isFinite(maat) ? Math.abs(maat) : 0;
  const tekort = minPx / schaal - m;
  return tekort > 0 ? tekort / 2 : 0;
}

/**
 * Hoe ver de boogjes van een wolk buiten de omhullende steken. Een wolk heeft
 * minimaal twee boogjes per zijde, dus de uitstulping is evenredig met de
 * kortste zijde en hooguit de oude vaste marge.
 */
export function wolkUitstulping(breedte, hoogte, maximum) {
  if (!Number.isFinite(breedte) || !Number.isFinite(hoogte)) return 0;
  const kort = Math.min(Math.abs(breedte), Math.abs(hoogte));
  // Koorde = zijde / 2, boogstraal = koorde / 2 -> uitstulping <= zijde / 4.
  // Ruim genomen op de halve zijde zodat de boogrand raakbaar blijft.
  return Math.max(0, Math.min(maximum, kort / 2));
}

const _MAATVELDEN = ['width', 'height', 'w', 'h', 'radius'];
const _POSITIEVELDEN = ['x', 'y'];

/**
 * Maak de maatvelden van een patch veilig voor het model (paneel, MCP-brug):
 * width/height/w/h/radius worden eindig en >= ondergrens; een niet-eindige
 * x/y vervalt. Andere velden blijven ongemoeid. Geeft een kopie terug.
 */
export function saneerMaatVelden(patch) {
  if (!patch || typeof patch !== 'object') return patch;
  const uit = { ...patch };
  for (const veld of _MAATVELDEN) {
    if (veld in uit) uit[veld] = klemMaat(uit[veld]);
  }
  for (const veld of _POSITIEVELDEN) {
    if (veld in uit && !(typeof uit[veld] === 'number' && Number.isFinite(uit[veld]))) {
      delete uit[veld];
    }
  }
  return uit;
}

/**
 * Ondergrens van een tekstvak of aanhaal-tekstvak: er moet één teken op één
 * regel in passen. Afgeleid van de lettergrootte en de rand, NIET een vast
 * aantal punten — wie voor een detail de tekst klein zet, krijgt een
 * evenredig kleiner minimum.
 */
export function tekstvakMinimum(ann) {
  const fs = (typeof ann?.fontSize === 'number' && Number.isFinite(ann.fontSize) && ann.fontSize > 0)
    ? ann.fontSize : 14;
  const regel = (typeof ann?.lineSpacing === 'number' && Number.isFinite(ann.lineSpacing) && ann.lineSpacing > 0)
    ? ann.lineSpacing : 1.2;
  const rand = (typeof ann?.lineWidth === 'number' && Number.isFinite(ann.lineWidth) && ann.lineWidth > 0)
    ? ann.lineWidth : 0;
  return {
    minBreedte: klemMaat(fs + rand * 2),
    minHoogte: klemMaat(fs * regel + rand * 2),
  };
}

/**
 * Lees een ingetypte maat (paneel, zwevende invoer). Elke positieve waarde
 * mag, met decimalen (punt of komma); onder de technische ondergrens wordt
 * geklemd. Geeft null voor alles wat geen positieve maat is — ook de
 * tussenstanden tijdens het typen ("", "0", "0.") — zodat de aanroeper het
 * model dan met rust laat in plaats van naar een standaardmaat te springen.
 */
export function leesMaatInvoer(waarde) {
  let n;
  if (typeof waarde === 'number') n = waarde;
  else if (typeof waarde === 'string') n = parseFloat(waarde.trim().replace(',', '.'));
  else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return klemMaat(n);
}

/** Maat voor weergave in een invoerveld: 2 decimalen, onder 1 pt 3 — nooit "0" voor een kleine vorm. */
export function toonMaat(waarde) {
  if (typeof waarde !== 'number' || !Number.isFinite(waarde)) return 0;
  return Number(waarde.toFixed(Math.abs(waarde) < 1 ? 3 : 2));
}

/**
 * Valideer de maat- en positievelden van een patch die van buiten komt
 * (MCP-brug). Anders dan het paneel wordt hier GEWEIGERD in plaats van stil
 * geklemd: een aanroeper die width 0, een negatieve maat, NaN of tekst stuurt
 * hoort een fout te krijgen. Elke positieve maat mag; alleen een waarde onder
 * de technische ondergrens wordt daarop geklemd.
 *
 * @returns {{ok: true, patch: object} | {ok: false, error: string}}
 */
export function valideerMaatPatch(patch) {
  if (!patch || typeof patch !== 'object') return { ok: true, patch };
  const uit = { ...patch };
  for (const veld of _MAATVELDEN) {
    if (!(veld in uit)) continue;
    const v = uit[veld];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      return { ok: false, error: `props.${veld} must be a finite number > 0` };
    }
    uit[veld] = klemMaat(v);
  }
  for (const veld of _POSITIEVELDEN) {
    if (!(veld in uit)) continue;
    if (typeof uit[veld] !== 'number' || !Number.isFinite(uit[veld])) {
      return { ok: false, error: `props.${veld} must be a finite number` };
    }
  }
  return { ok: true, patch: uit };
}
