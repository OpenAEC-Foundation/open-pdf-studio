// De plattegrond-sleutels terug uit het bestand (zie saver/plattegrond-meta.js).

import { PDFName, PDFArray } from 'pdf-lib';
import { pdfNum } from './pdf-helpers.js';
import { decodePdfTextObject } from '../saver/pdf-text.js';
import { MAAT_GETALLEN, EINDEN } from '../saver/plattegrond-meta.js';

function waar(context, raw) {
  if (raw === undefined || raw === null) return false;
  const v = context.lookup(raw) || raw;
  return v === true || (v && typeof v.value === 'boolean' && v.value)
    || (v && typeof v.asBoolean === 'function' && v.asBoolean());
}

/**
 * Leest de sleutels uit een annotatiewoordenboek. Het zaadpunt blijft in
 * PDF-coördinaten; `plattegrondUitExtra` rekent het om.
 */
export function leesPlattegrondMeta(annotDict, context) {
  const uit = {};
  if (!annotDict || typeof annotDict.get !== 'function') return uit;
  if (waar(context, annotDict.get(PDFName.of('OPS_DimNoUnit')))) uit.opsDimNoUnit = true;
  for (const [veld, sleutel] of MAAT_GETALLEN) {
    const raw = annotDict.get(PDFName.of(sleutel));
    if (!raw) continue;
    const n = pdfNum(context.lookup(raw) || raw);
    if (n !== null && n >= 0) uit[`ops_${veld}`] = n;
  }
  const eindenRaw = annotDict.get(PDFName.of('OPS_DimOvershootEnds'));
  if (eindenRaw) {
    const v = context.lookup(eindenRaw) || eindenRaw;
    const naam = String(v).replace(/^\//, '');
    if (EINDEN.includes(naam)) uit.opsDimOvershootEnds = naam;
  }
  const kettingRaw = annotDict.get(PDFName.of('OPS_DimChain'));
  if (kettingRaw) {
    const id = decodePdfTextObject(context.lookup(kettingRaw) || kettingRaw);
    if (typeof id === 'string' && id) uit.opsDimChain = id;
  }
  const rolRaw = annotDict.get(PDFName.of('OPS_DimRole'));
  if (rolRaw) {
    const rol = String(context.lookup(rolRaw) || rolRaw).replace(/^\//, '');
    if (rol === 'chain' || rol === 'total') uit.opsDimRole = rol;
  }
  if (waar(context, annotDict.get(PDFName.of('OPS_NoLabel')))) uit.opsNoLabel = true;
  const zaadRaw = annotDict.get(PDFName.of('OPS_RuimteZaad'));
  if (zaadRaw) {
    const arr = context.lookup(zaadRaw) || zaadRaw;
    if (arr instanceof PDFArray && arr.size() >= 2) {
      const x = pdfNum(context.lookup(arr.get(0)) || arr.get(0));
      const y = pdfNum(context.lookup(arr.get(1)) || arr.get(1));
      if (x !== null && y !== null) uit.opsRuimteZaadPdf = { x, y };
    }
  }
  const naamRaw = annotDict.get(PDFName.of('OPS_RuimteNaam'));
  if (naamRaw) {
    const naam = decodePdfTextObject(context.lookup(naamRaw) || naamRaw);
    if (typeof naam === 'string' && naam) uit.opsRuimteNaam = naam;
  }
  const nummerRaw = annotDict.get(PDFName.of('OPS_RuimteNummer'));
  if (nummerRaw) {
    const nummer = decodePdfTextObject(context.lookup(nummerRaw) || nummerRaw);
    if (typeof nummer === 'string' && nummer) uit.opsRuimteNummer = nummer;
  }
  return uit;
}

/**
 * De annotatievelden uit de gelezen sleutels. `naarApp(pdfX, pdfY)` geeft
 * `[x, y]` in app-coördinaten (de viewport-omrekening van de lader).
 */
export function plattegrondUitExtra(extra, naarApp) {
  const e = extra || {};
  const uit = {};
  if (e.opsDimNoUnit) uit.dimShowUnit = false;
  for (const [veld] of MAAT_GETALLEN) {
    if (Number.isFinite(e[`ops_${veld}`])) uit[veld] = e[`ops_${veld}`];
  }
  if (e.opsDimOvershootEnds) uit.dimOvershootEnds = e.opsDimOvershootEnds;
  if (e.opsDimChain) uit.opsKettingId = e.opsDimChain;
  if (e.opsDimRole) uit.opsMaatRol = e.opsDimRole;
  if (e.opsNoLabel) uit.measureShowLabel = false;
  if (e.opsRuimteZaadPdf && typeof naarApp === 'function') {
    const [x, y] = naarApp(e.opsRuimteZaadPdf.x, e.opsRuimteZaadPdf.y);
    if (Number.isFinite(x) && Number.isFinite(y)) uit.opsRuimteZaad = { x, y };
  }
  if (e.opsRuimteNaam) uit.opsRuimteNaam = e.opsRuimteNaam;
  if (e.opsRuimteNummer) uit.opsRuimteNummer = e.opsRuimteNummer;
  return uit;
}
