// Maten en lijnen uit het bestand naar het model van de app.
//
// Puur: de converter (annotation-converter.js) en de tests delen deze regels.
//
// Een maat of lijn uit een ander programma neemt al zijn eigenschappen mee in
// het bewerkbare model; bij opslaan schrijft saver/maatlijn-opslaan.js ze
// terug, met eigen sleutels (OPS_HeadFill, OPS_DimTextPos, OPS_FontSize,
// OPS_LabelColor en de plattegrondsleutels voor uitloop en hulplijnen).
//
// Per sleutel beslist wat er werkelijk in het woordenboek staat, want niet
// elk eigen bestand heeft OPS_Subtype: vóór die sleutel schreef de app een
// maat als /Line /IT /LineDimension zonder /BS, /LE en /LL. Die sleutels
// komen in zo'n bestand dus niet voor, en wat uit /LE, /LL, /LLE, /Cap + /CP
// en /RC volgt, raakt het niet.
//   - lijndikte: zonder /BS en /Border 1 (PDF: /Border [0 0 1]); pdf.js
//     maakt er 0 van, wat op het scherm 0,5 werd en bij opslaan /W 0;
//   - punten: een gesloten /LE zonder /IC is hol (PDF 32000, tabel 175);
//     een pijl uit een ander programma is 9 pt breed onder 30°;
//   - uitloop: geen (die kent de specificatie niet) zodra /LL, /LLE of /LE
//     er staat; hulplijnen: /LLO als vrije afstand en /LLE als doorloop;
//   - bijschrift: in de lijn bij /Cap true met /CP /Inline of zonder /CP,
//     grootte en kleur uit /RC.

import { PDFName, PDFArray, PDFHexString, PDFString } from 'pdf-lib';
import { colorArrayToHex } from '../../utils/colors.js';
import { pdfNum, pdfColorToHex } from './pdf-helpers.js';
import { plattegrondUitExtra } from './plattegrond-meta.js';

const PT_NAAR_MM = 25.4 / 72;

/** Zijde van een pijlpunt uit een ander programma bij lijndikte 1 (pt). */
export const VREEMDE_KOP_ZIJDE = 9;

const GESLOTEN = new Set(['ClosedArrow', 'RClosedArrow', 'Square', 'Circle', 'Diamond']);
const PIJLEN = new Set(['OpenArrow', 'ClosedArrow', 'ROpenArrow', 'RClosedArrow']);

// ── lezen ───────────────────────────────────────────────────────────────────

function opzoeken(context, raw) {
  return raw === undefined || raw === null ? undefined : (context.lookup(raw) || raw);
}

function waarheid(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v?.asBoolean === 'function') return v.asBoolean();
  const s = String(v);
  return s === 'true' ? true : s === 'false' ? false : undefined;
}

const naam = (v) => (v === undefined ? undefined : String(v).replace(/^\//, ''));

function tekstVan(v) {
  if (v instanceof PDFHexString || v instanceof PDFString) return v.decodeText();
  return typeof v?.decodeText === 'function' ? v.decodeText() : undefined;
}

/** Lettergrootte en tekstkleur uit een CSS-achtige stijl (/RC of /DS). */
export function stijlUitTekst(tekst) {
  const uit = {};
  if (typeof tekst !== 'string' || !tekst) return uit;
  const grootte = tekst.match(/font-size\s*:\s*([\d.]+)\s*(pt|px)?/i);
  if (grootte && Number(grootte[1]) > 0) uit.fontSize = Number(grootte[1]);
  const kleur = tekst.match(/(?:^|[\s;"'{])color\s*:\s*#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (kleur) {
    const h = kleur[1].toLowerCase();
    uit.kleur = '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h);
  }
  return uit;
}

/**
 * De sleutels van een /Line of /PolyLine die deze regels nodig hebben, zoals
 * ze in het woordenboek staan (color-extraction.js bewaart ze als `lijn`).
 */
export function leesLijnSleutels(annotDict, context) {
  const get = (k) => annotDict.get(PDFName.of(k));
  const icRaw = opzoeken(context, get('IC'));
  const uit = {
    heeftBs: get('BS') !== undefined,
    heeftBorder: get('Border') !== undefined,
    heeftIc: icRaw instanceof PDFArray && icRaw.size() > 0,
    heeftAp: get('AP') !== undefined,
  };
  const le = opzoeken(context, get('LE'));
  if (le instanceof PDFArray) uit.le = le.asArray().map((n) => naam(opzoeken(context, n)));
  const cap = waarheid(opzoeken(context, get('Cap')));
  if (cap !== undefined) uit.cap = cap;
  const cp = opzoeken(context, get('CP'));
  if (cp !== undefined) uit.cp = naam(cp);
  for (const sleutel of ['RC', 'DS']) {
    const stijl = stijlUitTekst(tekstVan(opzoeken(context, get(sleutel))));
    if (uit.rcFontSize === undefined && stijl.fontSize) uit.rcFontSize = stijl.fontSize;
    if (uit.rcKleur === undefined && stijl.kleur) uit.rcKleur = stijl.kleur;
  }
  // Eigen sleutels (saver/maatlijn-opslaan.js).
  const vulling = waarheid(opzoeken(context, get('OPS_HeadFill')));
  if (vulling !== undefined) uit.opsHeadFill = vulling;
  const plek = opzoeken(context, get('OPS_DimTextPos'));
  if (plek !== undefined) uit.opsDimTextPos = naam(plek);
  const grootte = opzoeken(context, get('OPS_FontSize'));
  if (grootte !== undefined) {
    const n = pdfNum(grootte);
    if (n !== null && n > 0) uit.opsFontSize = n;
  }
  const kleur = opzoeken(context, get('OPS_LabelColor'));
  if (kleur instanceof PDFArray && kleur.size() >= 3) {
    const hex = pdfColorToHex(kleur, context);
    if (hex) uit.opsLabelColor = hex.toLowerCase();
  }
  return uit;
}

// ── omzetten ────────────────────────────────────────────────────────────────

/** Gesloten /LE zonder /IC: de punten zijn hol. */
function holleKoppen(extra) {
  const l = extra?.lijn;
  if (!l || l.heeftIc || extra.ic) return false;
  return (l.le || []).some((n) => GESLOTEN.has(n));
}

/** Puntmaat van een pijl uit een ander programma (lengte langs de lijn). */
function vreemdeKopMaat(extra, lineWidth) {
  if (!(extra?.lijn?.le || []).some((n) => PIJLEN.has(n))) return undefined;
  return VREEMDE_KOP_ZIJDE * Math.cos(Math.PI / 6) * Math.max(1, Number(lineWidth) || 0);
}

/** Lijndikte van een /Line of /PolyLine. */
export function lijnBreedteUitBestand(extra, annot, standaard) {
  if (extra?.borderWidth !== undefined) return extra.borderWidth;
  const l = extra?.lijn;
  if (l && !l.heeftBs && !l.heeftBorder) return 1;
  return annot?.borderStyle?.width ?? standaard;
}

/**
 * Vulling van de punten van een gewone pijl: false = hol, anders undefined
 * (gevuld zoals altijd). Eigen pijlen dragen sinds hun appearance
 * OPS_HeadSize en hadden daarvoor geen appearance: die blijven gevuld.
 */
export function pijlKopVullingUitBestand(extra) {
  const l = extra?.lijn;
  if (!l) return undefined;
  if (l.opsHeadFill === false) return false;
  if (l.opsHeadFill === true || extra.opsSubtype || extra.opsHeadSize !== undefined
    || extra.opsLineHeads || !l.heeftAp) return undefined;
  return holleKoppen(extra) ? false : undefined;
}

/** Puntmaat (en holle punten) van een maat of omtrekmaat. */
export function meetlijnKoppenUitBestand(extra, lineWidth) {
  const e = extra || {};
  const uit = { headSize: e.opsHeadSize || 12 };
  const l = e.lijn;
  if (l?.opsHeadFill === false) uit.headFill = false;
  if (l && !e.opsSubtype) {
    if (!e.opsHeadSize) {
      const kop = vreemdeKopMaat(e, lineWidth);
      if (kop) uit.headSize = kop;
    }
    if (holleKoppen(e)) uit.headFill = false;
  }
  return uit;
}

/** Uitloop, hulplijnen en bijschrift van een maat uit een ander programma. */
function overgenomenOpmaak(extra) {
  const e = extra || {};
  const l = e.lijn || {};
  const uit = {};
  // Eigen sleutels gelden altijd: zo houdt een opgeslagen maat zijn opmaak.
  if (l.opsDimTextPos === 'Inline') uit.dimTextPosition = 'inline';
  // fontSizeUitBestand: de saver schrijft OPS_FontSize dan altijd terug.
  if (l.opsFontSize > 0) { uit.fontSize = l.opsFontSize; uit.fontSizeUitBestand = true; }
  if (l.opsLabelColor) uit.labelColor = l.opsLabelColor;
  if (e.opsSubtype || !e.lijn) return uit;
  const heeftLe = Array.isArray(l.le) && l.le.length > 0;
  const heeftLl = Number.isFinite(e.leaderLength) && e.leaderLength !== 0;
  if (heeftLl || e.leaderExtension !== undefined || heeftLe) uit.dimLineOvershootMm = 0;
  if (heeftLl) {
    uit.dimExtGapMm = Math.max(0, Number(e.leaderOffset) || 0) * PT_NAAR_MM;
    uit.dimExtOvershootMm = Math.max(0, Number(e.leaderExtension) || 0) * PT_NAAR_MM;
  }
  // zonder /CP is Inline de standaard (PDF 32000, tabel 175)
  if (l.cap === true && (l.cp === undefined || l.cp === 'Inline')) uit.dimTextPosition = 'inline';
  if (uit.fontSize === undefined && l.rcFontSize > 0) { uit.fontSize = l.rcFontSize; uit.fontSizeUitBestand = true; }
  if (!uit.labelColor && l.rcKleur) uit.labelColor = l.rcKleur;
  return uit;
}

const mapMdHead = (h) => {
  switch (h) {
    case 'OpenArrow': return 'open';
    case 'ClosedArrow': return 'closed';
    case 'Diamond': return 'diamond';
    case 'Circle': return 'openCircle';
    case 'Square': return 'square';
    case 'Slash': return 'slash';
    case 'Butt': return 'butt';
    case 'ROpenArrow': return 'openReversed';
    case 'RClosedArrow': return 'closedReversed';
    default: return 'openCircle';
  }
};

/**
 * Het model van een maat (/Line /IT /LineDimension of met OPS_Subtype
 * measureDistance), zonder de gedeelde velden en de meettekst.
 * @param {{annot: object, extra: object, convertPoint: (x:number, y:number) => number[]}} o
 */
export function maatlijnUitBestand({ annot, extra = {}, convertPoint }) {
  const extraColors = extra || {};
  // Use original /L coords from pdf-lib (PDF.js normalizeRect destroys direction)
  const lc = extraColors.lineCoords || annot.lineCoordinates;
  const [lsx, lsy] = convertPoint(lc[0], lc[1]);
  const [lex, ley] = convertPoint(lc[2], lc[3]);
  const mdProps = {
    type: 'measureDistance',
    startX: lsx,
    startY: lsy,
    endX: lex,
    endY: ley,
    color: colorArrayToHex(annot.color, '#ff0000'),
    strokeColor: colorArrayToHex(annot.color, '#ff0000'),
    lineWidth: lijnBreedteUitBestand(extraColors, annot, 1),
  };
  // Store per-annotation scale/unit/precision from PDF Measure dictionary
  if (extraColors.measureScale) {
    mdProps.measureScale = extraColors.measureScale;
    mdProps.measureUnit = extraColors.measureUnit || 'mm';
    if (extraColors.measurePrecision !== undefined) {
      mdProps.measurePrecision = extraColors.measurePrecision;
    }
  }
  // Read line endings from PDF LE array
  const mdLe = annot.lineEndings || [];
  if (mdLe.length >= 2) {
    mdProps.startHead = mapMdHead(mdLe[0]);
    mdProps.endHead = mapMdHead(mdLe[1]);
  } else {
    mdProps.startHead = 'openCircle';
    mdProps.endHead = 'openCircle';
  }
  Object.assign(mdProps, meetlijnKoppenUitBestand(extraColors, mdProps.lineWidth));
  if (extraColors.opsPrecision != null) mdProps.measurePrecision = extraColors.opsPrecision;
  // User-dragged text offset (relative to dimension-line midpoint) —
  // written verbatim by the saver, read back verbatim here.
  if (extraColors.opsTextOffsetX != null) mdProps.textOffsetX = extraColors.opsTextOffsetX;
  if (extraColors.opsTextOffsetY != null) mdProps.textOffsetY = extraColors.opsTextOffsetY;
  // Maat zonder eenheid (OPS_DimNoUnit, zie saver/plattegrond-meta.js).
  Object.assign(mdProps, plattegrondUitExtra(extraColors, convertPoint));
  // Compute dimension line position from PDF LL (leader length)
  // Per PDF spec: /L = base points on measured object, /LL = perpendicular
  // offset to the dimension line. Positive LL = counter-clockwise from /L direction.
  // Our data model: startX/Y = dimension line, leaderX/Y = base object points.
  const ll = extraColors.leaderLength;
  if (ll && ll !== 0) {
    const lineAngle = Math.atan2(lc[3] - lc[1], lc[2] - lc[0]);
    const perpX = -Math.sin(lineAngle);
    const perpY = Math.cos(lineAngle);
    // Dimension line endpoints = /L offset by LL along perpendicular
    const [dimX1, dimY1] = convertPoint(lc[0] + ll * perpX, lc[1] + ll * perpY);
    const [dimX2, dimY2] = convertPoint(lc[2] + ll * perpX, lc[3] + ll * perpY);
    // Swap: startX/Y = dimension line, leaderX/Y = /L base points
    mdProps.leaderStartX = lsx;
    mdProps.leaderStartY = lsy;
    mdProps.leaderEndX = lex;
    mdProps.leaderEndY = ley;
    mdProps.startX = dimX1;
    mdProps.startY = dimY1;
    mdProps.endX = dimX2;
    mdProps.endY = dimY2;
  }
  Object.assign(mdProps, overgenomenOpmaak(extraColors));
  return mdProps;
}
