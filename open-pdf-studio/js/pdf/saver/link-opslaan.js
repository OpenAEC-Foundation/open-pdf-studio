// Een link van de app (#953) als standaard /Link-annotatie, zodat hij ook in
// andere lezers werkt:
//   /Rect        het klikvak
//   /QuadPoints  per tekstregel, als de link uit een tekstselectie komt
//   /Dest        [pagina /XYZ left top zoom] of [pagina /Fit] binnen dit document
//   /A           << /S /URI /URI (...) >> of << /S /Launch /F << filespec >> >>
//   /Border      [0 0 w], en bij een zichtbare rand /BS << /W w /S /S|/U >> en /C
//   /H           de markering bij klikken (standaard /I)
//   /AP          wat de app tekent: niets, een rand of een onderstreping. Met een
//                appearance tekenen alle lezers hetzelfde (en de saver herkent
//                een ongewijzigde link, zie saver/bron-behoud.js).
//   /OPS_Subtype (link): de app laadt alleen deze links weer als bewerkbare
//                annotatie (loader/link-laden.js).
//
// Alleen pdf-lib: ook in node te testen.

import { PDFName, PDFNumber, PDFNull, PDFString, PDFHexString } from 'pdf-lib';
import { hexToColorArray } from '../../utils/colors.js';
import { linkRand, linkRanddikte, linkMarkering, linkVakken, LINK_STANDAARD_KLEUR } from '../../annotations/link/link-model.js';

const N = (n) => PDFName.of(n);
const rond = (v) => (Math.round(v * 1e4) / 1e4) || 0;

// Een string van ASCII-bytes als hex: PDFString.of schrijft haakjes en
// backslashes zonder escape.
function asciiHex(s) {
  let hex = '';
  for (let i = 0; i < s.length; i++) hex += (s.charCodeAt(i) & 0xff).toString(16).padStart(2, '0');
  return PDFHexString.of(hex);
}
const isAscii = (s) => /^[\x20-\x7E]*$/.test(s);

/** /URI is een 7-bits ASCII-string: anders als URL gecodeerd. */
export function uriVoorPdf(uri) {
  const s = String(uri || '');
  if (isAscii(s)) return s;
  try { return new URL(s).href; } catch { return s.replace(/[^\x20-\x7E]/g, (c) => encodeURIComponent(c)); }
}

/** De hoeken van een vak in PDF-ruimte: linksboven, rechtsboven, linksonder, rechtsonder. */
function hoeken(r, map) {
  return [
    map(r.x, r.y), map(r.x + r.width, r.y),
    map(r.x, r.y + r.height), map(r.x + r.width, r.y + r.height),
  ].map((p) => ({ x: rond(p.x), y: rond(p.y) }));
}

function omhullende(punten) {
  const xs = punten.map((p) => p.x);
  const ys = punten.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Een punt `d` naar binnen langs beide zijden van de quad.
function naarBinnen(q, d) {
  const eenheid = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  const u = eenheid(q[0], q[1]); // langs de regel
  const v = eenheid(q[0], q[2]); // van boven naar onder
  const k = (p, su, sv) => ({ x: p.x + (u.x * su + v.x * sv) * d, y: p.y + (u.y * su + v.y * sv) * d });
  return [k(q[0], 1, 1), k(q[1], -1, 1), k(q[2], 1, -1), k(q[3], -1, -1)];
}

const f = (v) => String(rond(v));

/** Inhoud van de appearance: niets, de rand van elke quad of een lijn eronder. */
export function linkApInhoud(quads, rand, dikte, rgb) {
  if (rand === 'none' || !quads.length) return '';
  let s = `q\n${rgb.map(f).join(' ')} RG\n${f(dikte)} w\n0 J 0 j\n`;
  for (const q of quads) {
    const p = naarBinnen(q, dikte / 2);
    if (rand === 'underline') {
      s += `${f(p[2].x)} ${f(p[2].y)} m ${f(p[3].x)} ${f(p[3].y)} l S\n`;
    } else {
      s += `${f(p[0].x)} ${f(p[0].y)} m ${f(p[1].x)} ${f(p[1].y)} l ${f(p[3].x)} ${f(p[3].y)} l ${f(p[2].x)} ${f(p[2].y)} l h S\n`;
    }
  }
  return `${s}Q\n`;
}

/**
 * Het doel als /Dest of /A. Een paginadoel buiten het document gaat naar de
 * laatste pagina; zonder bruikbaar doel komt er geen actie (een lege link).
 * @param {import('pdf-lib').PDFContext} context
 * @param {object} doel  linkTarget van het model
 * @param {import('pdf-lib').PDFPage[]} paginas
 * @returns {{ Dest?: object, A?: object }}
 */
export function linkDoelVoorPdf(context, doel, paginas) {
  if (!doel) return {};
  if (doel.kind === 'uri' && doel.uri) {
    return { A: context.obj({ Type: 'Action', S: 'URI', URI: asciiHex(uriVoorPdf(doel.uri)) }) };
  }
  if (doel.kind === 'file' && doel.file) {
    const pad = String(doel.file);
    const spec = context.obj({
      Type: 'Filespec',
      F: isAscii(pad) ? asciiHex(pad) : PDFHexString.fromText(pad),
      UF: PDFHexString.fromText(pad),
    });
    return { A: context.obj({ Type: 'Action', S: 'Launch', F: spec, NewWindow: true }) };
  }
  if (doel.kind === 'page' && paginas?.length) {
    const nr = Math.min(paginas.length, Math.max(1, Math.round(Number(doel.page)) || 1));
    const pagina = paginas[nr - 1];
    const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? PDFNumber.of(rond(v)) : PDFNull);
    if (doel.fit === 'fit') return { Dest: context.obj([pagina.ref, N('Fit')]) };
    // Zonder eigen positie: de bovenkant van de zichtbare pagina.
    const crop = pagina.getCropBox();
    const top = typeof doel.top === 'number' && Number.isFinite(doel.top) ? doel.top : crop.y + crop.height;
    return {
      Dest: context.obj([pagina.ref, N('XYZ'), getal(doel.left), getal(top), getal(doel.zoom || null)]),
    };
  }
  return {};
}

/**
 * Het /Link-woordenboek van een link uit het model.
 * @param {import('pdf-lib').PDFContext} context
 * @param {object} ann  de link zoals in het model (app-ruimte, niet omgerekend)
 * @param {{ map: (x:number,y:number)=>{x:number,y:number}, paginas: import('pdf-lib').PDFPage[],
 *           flags: number, contents?: object|null }} opties
 *   map: app-ruimte naar PDF (makePointMapper); paginas: alle pagina's van het
 *   uitvoerdocument; flags: /F; contents: /Contents of null
 */
export function buildLinkDict(context, ann, { map, paginas, flags, contents = null }) {
  const quads = linkVakken(ann).map((r) => hoeken(r, map));
  const vak = hoeken({ x: ann.x, y: ann.y, width: ann.width, height: ann.height }, map);
  const rect = omhullende([...vak, ...quads.flat()]).map(rond);
  const rand = linkRand(ann);
  const dikte = linkRanddikte(ann);
  const rgb = hexToColorArray(ann.color || ann.strokeColor || LINK_STANDAARD_KLEUR);

  const velden = {
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    F: flags,
    H: N(linkMarkering(ann)),
    Border: rand === 'none' ? [0, 0, 0] : [0, 0, dikte],
    M: PDFString.of(new Date().toISOString()),
    OPS_Subtype: PDFString.of('link'),
    ...linkDoelVoorPdf(context, ann.linkTarget, paginas),
  };
  if (rand !== 'none') {
    velden.C = rgb;
    velden.BS = context.obj({ Type: 'Border', W: dikte, S: N(rand === 'underline' ? 'U' : 'S') });
  }
  if (Array.isArray(ann.rects) && ann.rects.length > 0) {
    velden.QuadPoints = quads.flatMap((q) => q.flatMap((p) => [p.x, p.y]));
  }
  if (contents) velden.Contents = contents;
  const dict = context.obj(velden);

  // Appearance in paginaruimte: /BBox is /Rect, dus geen schaling.
  const stroom = context.stream(linkApInhoud(rand === 'none' ? [] : quads, rand, dikte, rgb), {
    Type: 'XObject', Subtype: 'Form', BBox: rect,
  });
  dict.set(N('AP'), context.obj({ N: context.register(stroom) }));
  return dict;
}
