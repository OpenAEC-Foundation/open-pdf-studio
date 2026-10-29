// Sleutels van een annotatie die het model van de app niet kent (#621).
//
// Bij het laden zet de lader elke annotatie om naar het model, en de saver
// schrijft uit dat model een nieuw woordenboek. Wat het model niet kent —
// een lijnstijl (/LineStyle), een telling (/NumCounts, /CountStyle), een
// bijschrift (/CO), de hoeken van een boog (/Angle1, /Angle2), een gebogen
// maatlijn (/Curves), een tweede aanhaallijn (/CLEx), kolomwaarden van een
// ander programma, de naam van een tegelpatroon (/PatternName) … — ging zo
// bij elke save verloren. De regel: lezen, de ruwe waarde bewaren,
// terugschrijven.
//
// - leesRuweSleutels maakt bij het laden een draagbare kopie (gewone JSON:
//   het model wordt bij ongedaan maken en in de store gekloond). Een
//   verwijzing wordt opgevolgd en ingevoegd; een stroom gaat mee met zijn
//   gecodeerde bytes en filter.
// - schrijfRuweSleutels zet ze bij het opslaan terug in het NIEUWE
//   woordenboek, als nieuwe objecten in het uitvoerdocument: nooit een
//   verwijzing naar een object dat in het nieuwe bestand niet meer bestaat.
//
// Nooit ruw teruggeschreven:
// - sleutels die de app zelf beheert (EIGEN_SLEUTELS): de lader leest ze in
//   het model en de saver schrijft ze uit het model, ook als hij ze bewust
//   weglaat (geen /C bij een vorm zonder rand, geen /Q bij links uitlijnen).
//   Een oude ruwe waarde zou daar een wijziging van de gebruiker ongedaan maken;
// - een sleutel die de saver al schreef (de app wint), behalve /IT van een
//   meting: zie schrijfRuweSleutels;
// - alle OPS_-sleutels (de eigen sleutels van de app);
// - een waarde die naar een pagina, annotatie, catalogus of laag (OCG)
//   verwijst: een kopie daarvan zou een tweede pagina of een losse laag zijn.
//   /OC (de laag) loopt via saver/annotatie-lagen.js;
// - een sleutel die vorm beschrijft (GEOMETRIE_SLEUTELS: een eigen pad, een
//   kromme, een tweede arm, booghoeken …) zodra de gebruiker de vorm in de
//   app veranderde: dan klopt hij niet meer, en een programma dat er zijn
//   tekening uit opbouwt zou de oude vorm tonen. Of de vorm veranderde,
//   zegt de vingerafdruk die de lader bij het lezen vastlegt.
//
// Alleen pdf-lib: ook in node te testen.

import {
  PDFName, PDFNumber, PDFString, PDFHexString, PDFArray, PDFDict, PDFRef, PDFBool, PDFNull,
  PDFStream, PDFRawStream,
} from 'pdf-lib';

/** Sleutels die het model van de app bezit; zie de kop van dit bestand. */
export const EIGEN_SLEUTELS = new Set([
  // structuur en koppelingen
  'Type', 'Subtype', 'Rect', 'P', 'Parent', 'Popup', 'IRT', 'RT', 'StructParent', 'OC',
  // appearance: wordt uit het model opnieuw gebouwd
  'AP', 'AS',
  // tekst en metagegevens
  'Contents', 'NM', 'M', 'CreationDate', 'T', 'Subj', 'State', 'StateModel', 'Name', 'Open',
  // vlaggen, kleur, rand, doorzichtigheid
  'F', 'C', 'IC', 'CA', 'ca', 'BS', 'Border', 'BE', 'BM', 'FillOpacity',
  // geometrie
  'L', 'Vertices', 'InkList', 'QuadPoints', 'CL', 'RD', 'LE', 'Sy', 'Rotate',
  // tekstvak: opmaak die de saver alleen schrijft als het model hem heeft
  'Q', 'RC',
  // meting: schaal, bijschrift en hulplijnen schrijft de saver uit het model
  'Measure', 'Cap', 'CP', 'LL', 'LLE', 'LLO',
  // draaiing: de app tekent haar in de appearance en bewaart haar zelf
  // (/OPS_Rotation); een oude /Rotation zou na draaien in de app niet kloppen
  'Rotation',
]);

/**
 * Per soort de sleutels die het model bezit. Een bijlage-annotatie (#376)
 * heeft haar bestand in het model (bijlage-store): /FS en /AF schrijft de
 * saver daar opnieuw uit.
 */
const EIGEN_PER_SOORT = { '/FileAttachment': new Set(['FS', 'AF']) };

/** Sleutels die vorm beschrijven; zie de kop van dit bestand. */
export const GEOMETRIE_SLEUTELS = new Set([
  'Path', 'PathPressureList', 'PressureList', 'Curves', 'SO', 'CLEx', 'Segments',
  'Angle1', 'Angle2', 'RiseDrop',
]);

const VORM_VELDEN = [
  'x', 'y', 'width', 'height', 'rotation', 'startX', 'startY', 'endX', 'endY', 'centerX', 'centerY',
  'radius', 'startAngle', 'endAngle', 'arrowX', 'arrowY', 'kneeX', 'kneeY', 'armOriginX', 'armOriginY',
  'points', 'path', 'controlPoints', 'rects',
];
const rond = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

/** Vingerafdruk van de vorm van een model (posities op 0,01 pt). */
export function vormVingerafdruk(ann) {
  return JSON.stringify(VORM_VELDEN.map((k) => {
    const v = ann?.[k];
    if (Array.isArray(v)) return v.map((p) => (p && typeof p === 'object' ? [rond(p.x), rond(p.y), rond(p.width), rond(p.height)] : rond(p)));
    return rond(v);
  }));
}

// Soorten waarvan de app de bedoeling (/IT) zelf leest en schrijft.
const IT_VAN_APP = new Set(['/FreeText', '/Caret', '/Highlight', '/Underline', '/StrikeOut', '/Squiggly']);
// Bedoelingen die de saver voor een meting schrijft. Las de app een andere
// bedoeling voor dezelfde meting (bijv. /RectangleSketchToScale), dan gaat
// die terug: de soort van de markering mag door opslaan niet veranderen.
const METING_IT = new Set(['/PolygonDimension', '/PolyLineDimension', '/LineDimension']);

// Grenzen per annotatie: een vreemd bestand mag het model niet opblazen.
const MAX_KNOPEN = 5000;
const MAX_STROOM_BYTES = 512 * 1024;
const MAX_DIEPTE = 12;
const VERBODEN_SOORTEN = new Set(['/Page', '/Pages', '/Catalog', '/Annot', '/OCG', '/OCMD']);

class TeGroot extends Error {}

// Zonder Buffer: de saver draait ook in de WebView.
const naarHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function naarBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function uitBase64(tekst) {
  const bin = atob(tekst);
  const uit = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) uit[i] = bin.charCodeAt(i);
  return uit;
}

/**
 * Een PDF-object als draagbare JSON:
 *   getal | boolean | null | [..] | { n: naam } | { s: hex } | { d: {..} }
 *   | { st: { d: {..}, b: base64 } }
 */
function codeer(context, waarde, staat, pad) {
  if (++staat.knopen > MAX_KNOPEN) throw new TeGroot();
  if (pad.length > MAX_DIEPTE) throw new TeGroot();
  if (waarde instanceof PDFRef) {
    const sleutel = waarde.toString();
    if (pad.includes(sleutel)) throw new TeGroot(); // kringverwijzing
    return codeer(context, context.lookup(waarde), staat, [...pad, sleutel]);
  }
  if (waarde === undefined || waarde === PDFNull || waarde === null) return null;
  if (waarde instanceof PDFNumber) return waarde.asNumber();
  if (waarde instanceof PDFBool) return waarde.asBoolean();
  if (waarde instanceof PDFName) return { n: waarde.decodeText() };
  if (waarde instanceof PDFString || waarde instanceof PDFHexString) return { s: naarHex(waarde.asBytes()) };
  if (waarde instanceof PDFArray) return waarde.asArray().map((v) => codeer(context, v, staat, pad));
  if (waarde instanceof PDFDict) {
    const soort = waarde.get(PDFName.of('Type'));
    if (soort && VERBODEN_SOORTEN.has(soort.toString())) throw new TeGroot();
    return { d: codeerDict(context, waarde, staat, pad) };
  }
  if (waarde instanceof PDFStream) {
    const bytes = waarde.getContents();
    staat.bytes += bytes.length;
    if (staat.bytes > MAX_STROOM_BYTES) throw new TeGroot();
    const d = codeerDict(context, waarde.dict, staat, pad);
    delete d.Length;
    return { st: { d, b: naarBase64(bytes) } };
  }
  throw new TeGroot(); // onbekend objecttype
}

function codeerDict(context, dict, staat, pad) {
  const uit = {};
  for (const [k, v] of dict.entries()) uit[k.decodeText()] = codeer(context, v, staat, pad);
  return uit;
}

/**
 * De sleutels van een annotatie die de app niet zelf beheert, als draagbare
 * JSON (zie codeer). Een sleutel die te groot is of naar een pagina,
 * annotatie of laag verwijst, valt weg. Zonder zulke sleutels: undefined.
 * @param {import('pdf-lib').PDFContext} context
 * Met de /Subtype van de bron: alleen een annotatie van dezelfde soort krijgt
 * ze terug (een /Square die als afbeelding laadt, wordt een /Stamp).
 * @param {PDFDict} dict  het annotatiewoordenboek zoals het in het bestand staat
 * @returns {{ soort: string, sleutels: Record<string, unknown> }|undefined}
 */
export function leesRuweSleutels(context, dict) {
  if (!(dict instanceof PDFDict)) return undefined;
  const uit = {};
  const staat = { knopen: 0, bytes: 0 };
  const eigenSoort = EIGEN_PER_SOORT[dict.get(PDFName.of('Subtype'))?.toString() || ''];
  for (const [k, v] of dict.entries()) {
    const sleutel = k.decodeText();
    if (sleutel.startsWith('OPS_') || (EIGEN_SLEUTELS.has(sleutel) && sleutel !== 'IT')) continue;
    if (eigenSoort?.has(sleutel)) continue;
    try {
      uit[sleutel] = codeer(context, v, staat, []);
    } catch (e) {
      if (!(e instanceof TeGroot)) throw e;
    }
  }
  if (!Object.keys(uit).length) return undefined;
  return { soort: dict.get(PDFName.of('Subtype'))?.toString() || '', sleutels: uit };
}

/** Draagbare JSON terug naar een PDF-object in `context` (nieuwe objecten). */
function bouw(context, w) {
  if (w === null || w === undefined) return PDFNull;
  if (typeof w === 'number') return PDFNumber.of(w);
  if (typeof w === 'boolean') return w ? PDFBool.True : PDFBool.False;
  if (Array.isArray(w)) {
    const arr = context.obj([]);
    for (const v of w) arr.push(bouw(context, v));
    return arr;
  }
  if (typeof w === 'object') {
    if (typeof w.n === 'string') return PDFName.of(w.n);
    if (typeof w.s === 'string') return PDFHexString.of(w.s);
    if (w.d && typeof w.d === 'object') return bouwDict(context, w.d);
    if (w.st && typeof w.st === 'object') {
      const d = bouwDict(context, w.st.d || {});
      const bytes = uitBase64(String(w.st.b || ''));
      return context.register(PDFRawStream.of(d, bytes));
    }
  }
  return PDFNull;
}

function bouwDict(context, obj) {
  const d = context.obj({});
  for (const [k, v] of Object.entries(obj)) d.set(PDFName.of(k), bouw(context, v));
  return d;
}

/**
 * Zet de bewaarde sleutels terug op het nieuwe woordenboek. Met `ann` (het
 * model zoals de gebruiker het nu heeft) vallen de vormsleutels weg als de
 * vorm sinds het laden veranderde. Een sleutel die
 * de saver al schreef blijft van de saver, met één uitzondering: de bedoeling
 * (/IT) van een meting. Schreef de saver /PolygonDimension voor een vlak dat
 * als /RectangleSketchToScale binnenkwam, dan gaat de oorspronkelijke terug —
 * de app herkent de meting aan haar eigen /OPS_Subtype.
 * @returns {string[]} de teruggezette sleutels
 */
export function schrijfRuweSleutels(context, dict, ruw, ann) {
  if (!ruw || typeof ruw !== 'object' || !ruw.sleutels || !(dict instanceof PDFDict)) return [];
  const soort = dict.get(PDFName.of('Subtype'))?.toString();
  if (ruw.soort !== soort) return [];
  const vormGewijzigd = !!ann && typeof ruw.vorm === 'string' && ruw.vorm !== vormVingerafdruk(ann);
  const gezet = [];
  for (const [sleutel, waarde] of Object.entries(ruw.sleutels)) {
    if (sleutel.startsWith('OPS_')) continue;
    if (vormGewijzigd && GEOMETRIE_SLEUTELS.has(sleutel)) continue;
    if (sleutel === 'IT') {
      if (IT_VAN_APP.has(soort)) continue;
      const huidig = dict.get(PDFName.of('IT'));
      if (huidig !== undefined) {
        const eigenSoort = dict.get(PDFName.of('OPS_Subtype')) !== undefined;
        if (!eigenSoort || !METING_IT.has(huidig.toString())) continue;
      }
    } else if (EIGEN_SLEUTELS.has(sleutel) || dict.get(PDFName.of(sleutel)) !== undefined) {
      continue;
    }
    dict.set(PDFName.of(sleutel), bouw(context, waarde));
    gezet.push(sleutel);
  }
  return gezet;
}
