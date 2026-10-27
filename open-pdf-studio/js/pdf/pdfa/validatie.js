// PDF/A-validatie (#379): controleert een PDF op de regels van PDF/A-1b,
// -2b of -3b en geeft per overtreding een bevinding met pagina en object.
//
// Dit is een eigen controle van de veelvoorkomende regels (zie REGELS in
// regels.js voor de volledige lijst met clausules), geen certificering: een
// extern validatieprogramma blijft de maatstaf. Wat hier niet gecontroleerd
// wordt, staat in BEPERKINGEN.
//
// Draait zonder DOM of app-afhankelijkheden, dus ook onder node.

import { PDFDocument, PDFDict, PDFArray, PDFStream, PDFName, PDFNumber, PDFString, PDFHexString, PDFRef } from 'pdf-lib';
import {
  N, zoek, haal, naam, getal, tekst, isWaar, refTekst, objectNaam, filters, decodeer, latin1,
  annotaties, nameTree, verzamelEenheden, bronnen, scanInhoud, resource, apparaatRuimten, inlineImageSleutels,
} from './doorloop.js';
import { fontInfo, isIngebed, codesUit, breedteAfwijkingen, trueTypeCoderingOk } from './fonts.js';
import { leesIccKop } from './icc.js';
import { xmpWaarde, xmpVerpakking, infoVerschillen } from './xmp.js';
import {
  ANNOTATIES_DEEL1, ANNOTATIES_DEEL2, TOEGESTANE_ACTIES, TOEGESTANE_NAMED, MENGMODI, WEERGAVE_INTENTIES,
  VLAG, GRENZEN_DEEL1, GRENZEN_DEEL2, REGELS, geldtVoor, clausuleVoor,
} from './regels.js';

export const BEPERKINGEN = Object.freeze([
  'structure', // syntaxis van xref, objecten en streamlengtes wordt niet byte voor byte nagelopen
  'fontPrograms', // breedtes alleen voor TrueType/OpenType; Type1/CFF-programma's en CMaps niet
  'iccContents', // ICC-profielen: alleen de kop, niet de tabellen
  'embeddedPdfA', // ingesloten PDF's (deel 2): alleen de PDF/A-identificatie
  'levelA', // geen toegankelijkheidsregels (niveau a/u)
]);

const MAX_PER_REGEL = 50;

let fontkitBelofte = null;
function laadFontkit() {
  fontkitBelofte ??= import('@pdf-lib/fontkit').then((m) => m.default || m);
  return fontkitBelofte;
}

/** Wat het document zelf zegt te zijn (pdfaid in het XMP), of null. */
export function geclaimdeConformiteit(xml) {
  const part = Number(xmpWaarde(xml, 'pdfaid:part'));
  if (!Number.isInteger(part) || part < 1 || part > 4) return null;
  const conformance = String(xmpWaarde(xml, 'pdfaid:conformance') || '').trim().toUpperCase() || null;
  return { part, conformance };
}

/** Het document-XMP als tekst, of null. */
export function documentXmp(pdf) {
  const m = haal(pdf, pdf.catalog, 'Metadata');
  if (!(m instanceof PDFStream)) return null;
  const b = decodeer(m);
  if (!b) return null;
  try { return new TextDecoder('utf-8').decode(b); } catch { return latin1(b); }
}

/** /Info als { sleutel: tekst } (alleen tekstwaarden). */
export function infoTeksten(pdf) {
  const info = zoek(pdf, pdf.context.trailerInfo.Info);
  const uit = {};
  if (!(info instanceof PDFDict)) return uit;
  for (const [k, v] of info.entries()) {
    const t = tekst(zoek(pdf, v));
    if (t !== undefined) uit[k.decodeText()] = t;
  }
  return uit;
}

/** De OutputIntents met hun profielkop. */
export function outputIntents(pdf) {
  const arr = haal(pdf, pdf.catalog, 'OutputIntents');
  const uit = [];
  if (!(arr instanceof PDFArray)) return uit;
  arr.asArray().forEach((raw, i) => {
    const d = zoek(pdf, raw);
    if (!(d instanceof PDFDict)) return;
    const profielRaw = d.get(N('DestOutputProfile'));
    const profiel = zoek(pdf, profielRaw);
    let kop = null;
    if (profiel instanceof PDFStream) {
      const b = decodeer(profiel);
      kop = b ? leesIccKop(b) : null;
    }
    uit.push({ index: i, dict: d, s: naam(haal(pdf, d, 'S')), profiel: profiel instanceof PDFStream ? profiel : null, profielRaw, kop, n: getal(haal(pdf, profiel, 'N')) });
  });
  return uit;
}

/** De kleurruimte die de PDF/A-OutputIntent dekt: 'RGB ', 'CMYK', 'GRAY' of null. */
export function pdfaOutputRuimte(pdf) {
  const oi = outputIntents(pdf).find((o) => o.s === 'GTS_PDFA1' && o.kop);
  return oi ? oi.kop.ruimte : null;
}

/** Ruwe bytecontroles: kop, einde, xref-streams. */
function bytesControle(bytes, deel, voeg) {
  const kop = latin1(bytes.subarray(0, Math.min(bytes.length, 64)));
  const m = /^%PDF-\d\.\d[\r\n]{1,2}%(.{4})/s.exec(kop);
  if (!/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(kop)) voeg('file.header', null, 'header', { problem: 'version' });
  else if (!m || [...m[1]].some((c) => c.charCodeAt(0) <= 127)) voeg('file.header', null, 'header', { problem: 'binaryComment' });
  const staart = latin1(bytes.subarray(Math.max(0, bytes.length - 1024)));
  const eof = staart.lastIndexOf('%%EOF');
  if (eof < 0) voeg('file.dataAfterEof', null, 'trailer', { problem: 'missing' });
  else {
    const rest = staart.slice(eof + 5);
    if (!/^(\r\n|\r|\n)?$/.test(rest)) voeg('file.dataAfterEof', null, 'trailer', { problem: 'data' });
  }
  if (deel === 1) {
    const alles = latin1(bytes);
    if (/\/Type\s*\/XRef\b/.test(alles) || /\/Type\s*\/ObjStm\b/.test(alles)) voeg('file.xrefStream', null, 'xref', {});
  }
}

/**
 * Valideert een PDF tegen PDF/A-<deel>b.
 * @param {Uint8Array} bytes
 * @param {{ deel?: 1|2|3, signal?: AbortSignal }} [opties] zonder deel: het geclaimde deel, anders 2
 * @returns {Promise<{ deel: number, conformance: string, geclaimd: {part:number,conformance:string|null}|null,
 *   bevindingen: Array<{ code: string, clausule: string, pagina: number|null, object: string, details: object }>,
 *   gecontroleerd: string[], beperkingen: string[], paginas: number, conform: boolean }>}
 */
export async function valideerPdfA(bytes, opties = {}) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const xml = documentXmp(pdf);
  const geclaimd = xml ? geclaimdeConformiteit(xml) : null;
  let deel = Number(opties.deel) || (geclaimd && geclaimd.part <= 3 ? geclaimd.part : 2);
  if (![1, 2, 3].includes(deel)) deel = 2;
  const deelSleutel = deel === 1 ? 1 : 2;
  const fontkit = await laadFontkit();

  const bevindingen = [];
  const telling = new Map();
  const gezienSleutel = new Set();
  const voeg = (code, pagina, object, details = {}) => {
    if (!geldtVoor(code, deel)) return;
    const sleutel = `${code}|${object}|${JSON.stringify(details)}`;
    if (gezienSleutel.has(sleutel)) return;
    gezienSleutel.add(sleutel);
    const n = (telling.get(code) || 0) + 1;
    telling.set(code, n);
    if (n > MAX_PER_REGEL) return;
    bevindingen.push({ code, clausule: clausuleVoor(code, deel), pagina: pagina ?? null, object: String(object ?? ''), details });
  };
  const pauze = async () => {
    await new Promise((r) => setTimeout(r, 0));
    if (opties.signal?.aborted) throw new Error('CANCELLED');
  };

  // ── Bestand ──
  bytesControle(bytes, deel, voeg);
  const trailer = pdf.context.trailerInfo;
  if (trailer.Encrypt) voeg('file.encrypted', null, 'trailer', {});
  const id = zoek(pdf, trailer.ID);
  if (!(id instanceof PDFArray) || id.size() !== 2) voeg('file.trailerId', null, 'trailer', {});

  // ── Alle objecten: filters, externe streams, grenzen (deel 1) ──
  let teller = 0;
  for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
    if (++teller % 2000 === 0) await pauze();
    const obj2 = obj instanceof PDFStream ? obj.dict : obj;
    if (obj instanceof PDFStream) {
      const f = filters(pdf, obj);
      if (f.some((x) => x === 'LZWDecode' || x === 'LZW')) voeg('file.lzw', null, refTekst(ref), {});
      if (f.includes('Crypt')) voeg('file.cryptFilter', null, refTekst(ref), {});
      if (['F', 'FFilter', 'FDecodeParms'].some((k) => obj.dict.has(N(k)))) voeg('file.externalStream', null, refTekst(ref), {});
    }
    grenzen(obj2, refTekst(ref), voeg, 0, deel === 1 ? GRENZEN_DEEL1 : GRENZEN_DEEL2);
  }

  // ── Metadata ──
  const meta = haal(pdf, pdf.catalog, 'Metadata');
  if (!(meta instanceof PDFStream) || !xml) voeg('meta.missing', null, 'Catalog/Metadata', {});
  else {
    const metaObj = objectNaam(pdf.catalog.get(N('Metadata')), 'Catalog/Metadata');
    if (filters(pdf, meta).length) voeg('meta.filtered', null, metaObj, {});
    const v = xmpVerpakking(xml);
    if (!v.kop) voeg('meta.packet', null, metaObj, { problem: 'header' });
    if (!v.voet) voeg('meta.packet', null, metaObj, { problem: 'trailer' });
    if (!v.rdf) voeg('meta.packet', null, metaObj, { problem: 'rdf' });
    if (deel === 1 && (v.bytesAttribuut || v.encodingAttribuut)) voeg('meta.packet', null, metaObj, { problem: 'attributes' });
    const toegestaan = deel === 1 ? ['A', 'B'] : ['A', 'B', 'U'];
    if (!geclaimd) voeg('meta.pdfaid', null, metaObj, { problem: 'none', expected: `${deel}B` });
    else if (geclaimd.part !== deel || !toegestaan.includes(geclaimd.conformance)) {
      voeg('meta.pdfaid', null, metaObj, { expected: `${deel}B`, found: `${geclaimd.part}${geclaimd.conformance || ''}` });
    }
    for (const sleutel of infoVerschillen(infoTeksten(pdf), xml)) voeg('meta.infoMismatch', null, 'Info', { key: sleutel });
  }

  // ── OutputIntents ──
  const intents = outputIntents(pdf);
  const pdfaOi = intents.filter((o) => o.s === 'GTS_PDFA1');
  for (const o of intents) {
    if (o.s !== 'GTS_PDFA1' && !o.profiel) continue;
    const obj = `Catalog/OutputIntents/${o.index}`;
    if (!o.profiel) { if (o.s === 'GTS_PDFA1') voeg('oi.profile', null, obj, { problem: 'missing' }); continue; }
    if (!o.kop) { voeg('oi.profile', null, obj, { problem: 'unreadable' }); continue; }
    if (deel === 1 && o.kop.versie >= 3) voeg('oi.profile', null, obj, { problem: 'version' });
    if (deel !== 1 && o.kop.versie >= 5) voeg('oi.profile', null, obj, { problem: 'version' });
    if (!['mntr', 'prtr'].includes(o.kop.klasse)) voeg('oi.profile', null, obj, { problem: 'class' });
    if (!['RGB ', 'CMYK', 'GRAY'].includes(o.kop.ruimte)) voeg('oi.profile', null, obj, { problem: 'colorSpace' });
    if (o.n !== undefined && o.kop.n && o.n !== o.kop.n) voeg('oi.profile', null, obj, { problem: 'components' });
  }
  const profielen = new Set(intents.filter((o) => o.profiel).map((o) => refTekst(o.profielRaw) || o.profiel));
  if (profielen.size > 1) voeg('oi.multiple', null, 'Catalog/OutputIntents', {});
  const oiRuimte = pdfaOi.find((o) => o.kop)?.kop.ruimte || null;

  // ── Catalogus ──
  if (pdf.catalog.has(N('AA'))) voeg('action.additional', null, 'Catalog/AA', {});
  const namen = haal(pdf, pdf.catalog, 'Names');
  if (namen instanceof PDFDict) {
    if (namen.has(N('JavaScript'))) voeg('action.javascript', null, 'Catalog/Names/JavaScript', {});
    if (namen.has(N('AlternatePresentations'))) voeg('catalog.forbidden', null, 'Catalog/Names/AlternatePresentations', { key: 'AlternatePresentations' });
  }
  if (isWaar(haal(pdf, pdf.catalog, 'NeedsRendering'))) voeg('catalog.forbidden', null, 'Catalog/NeedsRendering', { key: 'NeedsRendering' });
  const acro = haal(pdf, pdf.catalog, 'AcroForm');
  if (acro instanceof PDFDict) {
    if (isWaar(haal(pdf, acro, 'NeedAppearances'))) voeg('form.needAppearances', null, 'Catalog/AcroForm', {});
    if (acro.has(N('XFA'))) voeg('form.xfa', null, 'Catalog/AcroForm/XFA', {});
    velden(pdf, haal(pdf, acro, 'Fields'), (veld, ref) => {
      if (veld.has(N('AA'))) voeg('action.additional', null, objectNaam(ref, 'AcroForm/Fields'), {});
    });
  }
  const ocp = haal(pdf, pdf.catalog, 'OCProperties');
  if (ocp instanceof PDFDict) {
    if (deel === 1) voeg('oc.forbidden', null, 'Catalog/OCProperties', {});
    else ocControle(pdf, ocp, voeg);
  }

  // ── Acties ──
  const acties = [];
  const actieGezien = new Set();
  const volgActie = (raw, pagina, waar) => {
    let a = raw;
    for (let i = 0; i < 64; i++) {
      const d = zoek(pdf, a);
      if (!(d instanceof PDFDict) || actieGezien.has(d)) return;
      actieGezien.add(d);
      acties.push({ d, pagina, waar: objectNaam(a, waar) });
      const volgende = haal(pdf, d, 'Next');
      if (volgende instanceof PDFArray) { for (const x of volgende.asArray()) volgActie(x, pagina, waar); return; }
      a = d.get(N('Next'));
      if (!a) return;
    }
  };
  const open = pdf.catalog.get(N('OpenAction'));
  if (zoek(pdf, open) instanceof PDFDict) volgActie(open, null, 'Catalog/OpenAction');
  outlines(pdf, (item, ref) => { if (item.has(N('A'))) volgActie(item.get(N('A')), null, objectNaam(ref, 'Outlines')); });

  // ── Ingesloten bestanden ──
  const ingesloten = [];
  if (namen instanceof PDFDict && namen.has(N('EmbeddedFiles'))) {
    for (const e of nameTree(pdf, namen.get(N('EmbeddedFiles')))) ingesloten.push({ spec: zoek(pdf, e.waarde), raw: e.waarde, naam: e.sleutel, pagina: null });
  }
  const geassocieerd = new Set();
  const noteerAf = (d) => {
    const af = haal(pdf, d, 'AF');
    if (af instanceof PDFArray) for (const x of af.asArray()) geassocieerd.add(zoek(pdf, x));
  };
  noteerAf(pdf.catalog);

  // ── Pagina's en annotaties ──
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    if (i % 20 === 19) await pauze();
    const pagina = i + 1;
    const node = pages[i].node;
    noteerAf(node);
    if (node.has(N('AA'))) voeg('action.additional', pagina, `page ${pagina}/AA`, {});
    if (node.has(N('PresSteps'))) voeg('catalog.forbidden', pagina, `page ${pagina}/PresSteps`, { key: 'PresSteps' });
    const groep = haal(pdf, node, 'Group');
    if (naam(haal(pdf, groep, 'S')) === 'Transparency') voeg('transp.group', pagina, `page ${pagina}/Group`, {});
    for (const { ref, dict } of annotaties(pdf, node)) {
      const obj = objectNaam(ref, `page ${pagina}/Annots`);
      const type = naam(haal(pdf, dict, 'Subtype'));
      noteerAf(dict);
      const toegestaan = deel === 1 ? ANNOTATIES_DEEL1 : ANNOTATIES_DEEL2;
      if (!toegestaan.has(type)) voeg('annot.type', pagina, obj, { type: type || '?' });
      if (type === 'FileAttachment') {
        const fs = haal(pdf, dict, 'FS');
        if (fs instanceof PDFDict) ingesloten.push({ spec: fs, raw: dict.get(N('FS')), naam: tekst(haal(pdf, fs, 'UF')) || tekst(haal(pdf, fs, 'F')) || '', pagina, annot: true });
      }
      const f = getal(haal(pdf, dict, 'F'));
      if (!(deel !== 1 && type === 'Popup')) {
        if (f === undefined) voeg('annot.flags', pagina, obj, { problem: 'missing' });
        else {
          if (!(f & VLAG.Print)) voeg('annot.flags', pagina, obj, { problem: 'print' });
          const verboden = VLAG.Hidden | VLAG.Invisible | VLAG.NoView | (deel === 1 ? 0 : VLAG.ToggleNoView);
          if (f & verboden) voeg('annot.flags', pagina, obj, { problem: 'hidden' });
        }
      }
      const ap = haal(pdf, dict, 'AP');
      const rect = haal(pdf, dict, 'Rect');
      const r = rect instanceof PDFArray ? rect.asArray().map((x) => getal(zoek(pdf, x)) || 0) : [0, 0, 0, 0];
      const leeg = Math.abs(r[2] - r[0]) < 1e-6 || Math.abs(r[3] - r[1]) < 1e-6;
      if (ap instanceof PDFDict) {
        if (ap.has(N('D')) || ap.has(N('R'))) voeg('annot.appearance', pagina, obj, { problem: 'extraKeys' });
        const nn = haal(pdf, ap, 'N');
        const isBtn = type === 'Widget' && naam(veldWaarde(pdf, dict, 'FT')) === 'Btn';
        if (!nn) voeg('annot.appearance', pagina, obj, { problem: 'missing' });
        else if (!isBtn && !(nn instanceof PDFStream)) voeg('annot.appearance', pagina, obj, { problem: 'notStream' });
      } else if (deel !== 1 && !['Popup', 'Link'].includes(type) && !leeg) {
        voeg('annot.appearance', pagina, obj, { problem: 'missing' });
      }
      if (deel === 1) {
        const ca = getal(haal(pdf, dict, 'CA'));
        if (ca !== undefined && ca !== 1) voeg('annot.alpha', pagina, obj, {});
        if ((dict.has(N('C')) || dict.has(N('IC'))) && oiRuimte !== 'RGB ') voeg('annot.color', pagina, obj, {});
      }
      if (dict.has(N('AA'))) voeg('action.additional', pagina, `${obj}/AA`, {});
      if (dict.has(N('A'))) {
        // PDF/A-1 6.6.1: een widget heeft geen /A.
        if (deel === 1 && type === 'Widget') voeg('action.forbidden', pagina, `${obj}/A`, { type: 'Widget/A' });
        volgActie(dict.get(N('A')), pagina, `${obj}/A`);
      }
    }
  }
  for (const { d, pagina, waar } of acties) {
    const s = naam(haal(pdf, d, 'S'));
    if (!TOEGESTANE_ACTIES[deelSleutel].has(s)) voeg('action.forbidden', pagina, waar, { type: s || '?' });
    else if (s === 'Named') {
      const n = naam(haal(pdf, d, 'N'));
      if (!TOEGESTANE_NAMED.has(n)) voeg('action.named', pagina, waar, { name: n || '?' });
    }
  }
  for (const e of ingesloten) {
    const obj = objectNaam(e.raw, 'EmbeddedFiles');
    if (deel === 1) { if (!e.annot) voeg('embed.forbidden', e.pagina, obj, { name: e.naam }); continue; }
    if (!(e.spec instanceof PDFDict)) continue;
    const ef = haal(pdf, e.spec, 'EF');
    const stroom = ef instanceof PDFDict ? zoek(pdf, ef.get(N('UF')) || ef.get(N('F'))) : null;
    if (deel === 2) {
      const b = stroom instanceof PDFStream ? decodeer(stroom) : null;
      if (!b || !isPdfABytes(b)) voeg('embed.notPdfA', e.pagina, obj, { name: e.naam });
      continue;
    }
    const ontbreekt = [];
    if (!e.spec.has(N('F'))) ontbreekt.push('F');
    if (!e.spec.has(N('UF'))) ontbreekt.push('UF');
    if (!e.spec.has(N('AFRelationship'))) ontbreekt.push('AFRelationship');
    if (!(stroom instanceof PDFStream) || !stroom.dict.has(N('Subtype'))) ontbreekt.push('Subtype');
    if (!geassocieerd.has(e.spec)) ontbreekt.push('AF');
    if (ontbreekt.length) voeg('embed.spec', e.pagina, obj, { name: e.naam, missing: ontbreekt.join(', ') });
  }

  // ── Inhoud: fonts, kleur, transparantie, XObjects ──
  const eenheden = verzamelEenheden(pdf);
  const fontGezien = new Map();
  const resGezien = new Set();
  let geenOiGemeld = false;
  for (let i = 0; i < eenheden.length; i++) {
    if (i % 50 === 49) await pauze();
    const e = eenheden[i];
    const src = bronnen(e);
    const scan = src ? scanInhoud(src) : null;
    const res = e.resources;

    if (e.soort === 'form') {
      const d = e.houder.dict;
      if (naam(haal(pdf, haal(pdf, d, 'Group'), 'S')) === 'Transparency') voeg('transp.group', e.pagina, e.object, {});
      for (const k of ['OPI', 'PS', 'Ref']) if (d.has(N(k))) voeg('xobject.forbidden', e.pagina, e.object, { key: k });
      if (naam(haal(pdf, d, 'Subtype2')) === 'PS') voeg('xobject.forbidden', e.pagina, e.object, { key: 'Subtype2' });
    }
    if (scan) {
      if (scan.maxDiepte > GRENZEN_DEEL1.qNesting) voeg('file.limits', e.pagina, e.object, { what: 'q' });
      for (const ri of scan.intenties) if (!WEERGAVE_INTENTIES.has(ri)) voeg('color.renderingIntent', e.pagina, e.object, { intent: ri });
    }

    // Resources: wat deze eenheid gebruikt (dezelfde dict kan bij meer
    // eenheden horen; dubbele bevindingen vallen weg in voeg()).
    const gebruikteGs = scan ? scan.gs : new Set();
    const gebruikteXo = scan ? scan.xobjecten : new Set();
    if (res instanceof PDFDict) {
      resGezien.add(res);
      const gss = haal(pdf, res, 'ExtGState');
      if (gss instanceof PDFDict) {
        for (const [k, raw] of gss.entries()) {
          // Alleen wat de inhoud gebruikt (een ongebruikte state tekent niets).
          if (scan && !gebruikteGs.has(k.decodeText())) continue;
          const g = zoek(pdf, raw);
          if (!(g instanceof PDFDict)) continue;
          const obj = objectNaam(raw, `${e.object}/ExtGState/${k.decodeText()}`);
          const smask = haal(pdf, g, 'SMask');
          if (smask && naam(smask) !== 'None') voeg('transp.smask', e.pagina, obj, {});
          const alfa = [getal(haal(pdf, g, 'CA')), getal(haal(pdf, g, 'ca'))].filter((v) => v !== undefined);
          if (alfa.some((v) => v < 1)) voeg('transp.alpha', e.pagina, obj, {});
          const bm = haal(pdf, g, 'BM');
          const modi = bm instanceof PDFArray ? bm.asArray().map((x) => naam(zoek(pdf, x))) : bm ? [naam(bm)] : [];
          for (const m of modi) {
            if (deel === 1 ? !['Normal', 'Compatible'].includes(m) : !MENGMODI.has(m)) voeg('transp.blend', e.pagina, obj, { mode: m });
          }
          if (g.has(N('TR'))) voeg('gs.transfer', e.pagina, obj, { key: 'TR' });
          const tr2 = haal(pdf, g, 'TR2');
          if (tr2 && naam(tr2) !== 'Default') voeg('gs.transfer', e.pagina, obj, { key: 'TR2' });
          const ri = haal(pdf, g, 'RI');
          if (ri && !WEERGAVE_INTENTIES.has(naam(ri))) voeg('color.renderingIntent', e.pagina, obj, { intent: naam(ri) });
        }
      }
      const xo = haal(pdf, res, 'XObject');
      if (xo instanceof PDFDict) {
        for (const [k, raw] of xo.entries()) {
          const s = zoek(pdf, raw);
          if (!(s instanceof PDFStream)) continue;
          const obj = objectNaam(raw, `${e.object}/XObject/${k.decodeText()}`);
          const st = naam(haal(pdf, s, 'Subtype'));
          if (st === 'PS') { voeg('xobject.forbidden', e.pagina, obj, { key: 'PS' }); continue; }
          if (st !== 'Image') continue;
          if (isWaar(haal(pdf, s, 'Interpolate'))) voeg('image.interpolate', e.pagina, obj, {});
          if (s.dict.has(N('Alternates')) || s.dict.has(N('OPI'))) voeg('image.alternates', e.pagina, obj, {});
          if (deel === 1 && haal(pdf, s, 'SMask') instanceof PDFStream && (!scan || gebruikteXo.has(k.decodeText()))) voeg('transp.smask', e.pagina, obj, {});
          if (deel === 1 && filters(pdf, s).includes('JPXDecode')) voeg('image.jpx', e.pagina, obj, {});
          const intent = haal(pdf, s, 'Intent');
          if (intent && !WEERGAVE_INTENTIES.has(naam(intent))) voeg('color.renderingIntent', e.pagina, obj, { intent: naam(intent) });
        }
      }
    }

    // Fonts die echt gebruikt worden
    if (scan) {
      for (const [fnaam, gebruik] of scan.fonts) {
        const { waarde: fd, raw } = resource(pdf, res, 'Font', fnaam);
        if (!(fd instanceof PDFDict)) continue;
        const obj = objectNaam(raw, `${e.object}/Font/${fnaam}`);
        let vorig = fontGezien.get(fd);
        if (!vorig) { vorig = { strings: [], zichtbaar: false, pagina: e.pagina, obj }; fontGezien.set(fd, vorig); }
        vorig.zichtbaar ||= gebruik.zichtbaar;
        for (const s of gebruik.strings) if (vorig.strings.length < 20000) vorig.strings.push(s);
      }
    }

    // Kleur
    const ruimten = new Set();
    if (scan) {
      for (const s of scan.kleurOps) ruimten.add(s);
      for (const nm of scan.kleurNamen) {
        if (['DeviceRGB', 'DeviceCMYK', 'DeviceGray'].includes(nm)) ruimten.add(nm);
        else for (const s of apparaatRuimten(pdf, resource(pdf, res, 'ColorSpace', nm).waarde)) ruimten.add(s);
      }
      for (const nm of scan.shadings) {
        for (const s of apparaatRuimten(pdf, haal(pdf, resource(pdf, res, 'Shading', nm).waarde, 'ColorSpace'))) ruimten.add(s);
      }
      for (const nm of scan.patronen) {
        const p = resource(pdf, res, 'Pattern', nm).waarde;
        const sh = haal(pdf, p, 'Shading');
        if (sh) for (const s of apparaatRuimten(pdf, haal(pdf, sh, 'ColorSpace'))) ruimten.add(s);
      }
      for (const nm of scan.xobjecten) {
        const x = resource(pdf, res, 'XObject', nm).waarde;
        if (naam(haal(pdf, x, 'Subtype')) !== 'Image' || isWaar(haal(pdf, x, 'ImageMask'))) continue;
        for (const s of apparaatRuimten(pdf, haal(pdf, x, 'ColorSpace'))) ruimten.add(s);
      }
      for (const bi of scan.inline) {
        const m = inlineImageSleutels(bi);
        const cs = m.get('CS') ?? m.get('ColorSpace');
        if (typeof cs === 'string') {
          if (['RGB', 'DeviceRGB'].includes(cs)) ruimten.add('DeviceRGB');
          else if (['CMYK', 'DeviceCMYK'].includes(cs)) ruimten.add('DeviceCMYK');
          else if (['G', 'DeviceGray'].includes(cs)) ruimten.add('DeviceGray');
          else for (const s of apparaatRuimten(pdf, resource(pdf, res, 'ColorSpace', cs).waarde)) ruimten.add(s);
        }
        const fl = m.get('F') ?? m.get('Filter');
        const lijst = Array.isArray(fl) ? fl : fl ? [fl] : [];
        if (lijst.some((x) => x === 'LZW' || x === 'LZWDecode')) voeg('file.lzw', e.pagina, e.object, { inline: true });
        if (m.get('I') === true || m.get('Interpolate') === true) voeg('image.interpolate', e.pagina, e.object, { inline: true });
      }
    }
    const groep = haal(pdf, e.houder instanceof PDFStream ? e.houder.dict : e.houder, 'Group');
    if (groep instanceof PDFDict) for (const s of apparaatRuimten(pdf, haal(pdf, groep, 'CS'))) ruimten.add(s);
    if (ruimten.size) {
      if (!pdfaOi.length) {
        if (!geenOiGemeld) { geenOiGemeld = true; voeg('oi.missing', e.pagina, e.object, {}); }
      } else {
        const standaard = (nm) => !!resource(pdf, res, 'ColorSpace', nm).waarde;
        if (ruimten.has('DeviceRGB') && oiRuimte !== 'RGB ' && !standaard('DefaultRGB')) voeg('color.device', e.pagina, e.object, { space: 'DeviceRGB' });
        if (ruimten.has('DeviceCMYK') && oiRuimte !== 'CMYK' && !standaard('DefaultCMYK')) voeg('color.device', e.pagina, e.object, { space: 'DeviceCMYK' });
      }
    }
  }

  // Fonts: inbedden, breedtes, codering
  for (const [fd, gebruik] of fontGezien) {
    const info = fontInfo(pdf, fd);
    const fontNaam = info.baseFont || '?';
    if (!isIngebed(pdf, fd)) {
      if (gebruik.zichtbaar) voeg('font.notEmbedded', gebruik.pagina, gebruik.obj, { font: fontNaam });
      continue;
    }
    if (info.subtype === 'Type3') continue;
    if (!trueTypeCoderingOk(pdf, fd)) voeg('font.encoding', gebruik.pagina, gebruik.obj, { font: fontNaam });
    if (info.samengesteld && naam(haal(pdf, info.descendant, 'Subtype')) === 'CIDFontType2' && !info.descendant.has(N('CIDToGIDMap'))) {
      voeg('font.cidToGid', gebruik.pagina, gebruik.obj, { font: fontNaam });
    }
    if (deel === 1 && /^[A-Z]{6}\+/.test(fontNaam) && info.descriptor) {
      if (info.samengesteld && !info.descriptor.has(N('CIDSet'))) voeg('font.subsetSet', gebruik.pagina, gebruik.obj, { font: fontNaam, key: 'CIDSet' });
      if (!info.samengesteld && info.programma?.sleutel === 'FontFile' && !info.descriptor.has(N('CharSet'))) voeg('font.subsetSet', gebruik.pagina, gebruik.obj, { font: fontNaam, key: 'CharSet' });
    }
    const codes = codesUit(pdf, fd, gebruik.strings);
    const afw = codes ? breedteAfwijkingen(pdf, fd, fontkit, codes) : null;
    if (afw && afw.length) voeg('font.widths', gebruik.pagina, gebruik.obj, { font: fontNaam, count: afw.length });
  }

  const gecontroleerd = Object.keys(REGELS).filter((c) => geldtVoor(c, deel));
  return {
    deel,
    conformance: 'B',
    geclaimd,
    bevindingen,
    gecontroleerd,
    beperkingen: [...BEPERKINGEN],
    paginas: pages.length,
    conform: bevindingen.length === 0,
  };
}

/** Is dit (ingesloten) bestand een PDF met een PDF/A-1- of -2-identificatie? */
export function isPdfABytes(b) {
  if (b.length < 8 || latin1(b.subarray(0, 5)) !== '%PDF-') return false;
  const s = latin1(b);
  return /pdfaid:part(?:>|\s*=\s*["'])\s*[12]\b/.test(s);
}

function grenzen(obj, ref, voeg, diepte, g) {
  if (diepte > 32 || obj == null) return;
  if (obj instanceof PDFNumber) {
    const v = obj.asNumber();
    if (Number.isInteger(v) ? Math.abs(v) > g.integer : Math.abs(v) > g.real) voeg('file.limits', null, ref, { what: Number.isInteger(v) ? 'integer' : 'real' });
  } else if (obj instanceof PDFString) {
    if (obj.asString().length > g.string) voeg('file.limits', null, ref, { what: 'string' });
  } else if (obj instanceof PDFHexString) {
    if (obj.asString().length / 2 > g.string) voeg('file.limits', null, ref, { what: 'string' });
  } else if (obj instanceof PDFName) {
    if (obj.asBytes().length > g.name + 1) voeg('file.limits', null, ref, { what: 'name' });
  } else if (obj instanceof PDFArray) {
    if (obj.size() > g.array) voeg('file.limits', null, ref, { what: 'array' });
    for (const x of obj.asArray()) if (!(x instanceof PDFRef)) grenzen(x, ref, voeg, diepte + 1, g);
  } else if (obj instanceof PDFDict) {
    const items = obj.entries();
    if (items.length > g.dict) voeg('file.limits', null, ref, { what: 'dict' });
    for (const [k, x] of items) {
      grenzen(k, ref, voeg, diepte + 1, g);
      if (!(x instanceof PDFRef)) grenzen(x, ref, voeg, diepte + 1, g);
    }
  }
}

/** Een veldwaarde van een widget, met overerving via /Parent. */
export function veldWaarde(pdf, dict, sleutel) {
  let d = dict;
  for (let i = 0; i < 32 && d instanceof PDFDict; i++) {
    const v = haal(pdf, d, sleutel);
    if (v !== undefined) return v;
    d = haal(pdf, d, 'Parent');
  }
  return undefined;
}

/** Alle velden van een AcroForm (recursief via Kids). */
export function velden(pdf, lijst, bezoek, diepte = 0, gezien = new Set()) {
  if (!(lijst instanceof PDFArray) || diepte > 32) return;
  for (const raw of lijst.asArray()) {
    const v = zoek(pdf, raw);
    if (!(v instanceof PDFDict) || gezien.has(v)) continue;
    gezien.add(v);
    bezoek(v, raw);
    velden(pdf, haal(pdf, v, 'Kids'), bezoek, diepte + 1, gezien);
  }
}

/** Alle bladwijzers (First/Next, met lusbewaking). */
export function outlines(pdf, bezoek) {
  const wortel = haal(pdf, pdf.catalog, 'Outlines');
  const gezien = new Set();
  const loop = (raw, diepte) => {
    let r = raw;
    while (r && diepte < 64) {
      const d = zoek(pdf, r);
      if (!(d instanceof PDFDict) || gezien.has(d) || gezien.size > 100000) return;
      gezien.add(d);
      bezoek(d, r);
      if (d.has(N('First'))) loop(d.get(N('First')), diepte + 1);
      r = d.get(N('Next'));
    }
  };
  if (wortel instanceof PDFDict) loop(wortel.get(N('First')), 0);
}

/** Alle OCG's in een (geneste) Order-array. */
function inOrder(pdf, arr, uit, diepte = 0) {
  if (!(arr instanceof PDFArray) || diepte > 16) return;
  for (const x of arr.asArray()) {
    const v = zoek(pdf, x);
    if (v instanceof PDFArray) inOrder(pdf, v, uit, diepte + 1);
    else if (v instanceof PDFDict) uit.add(v);
  }
}

function ocControle(pdf, ocp, voeg) {
  const configs = [];
  const d = haal(pdf, ocp, 'D');
  if (d instanceof PDFDict) configs.push({ d, obj: 'Catalog/OCProperties/D' });
  const lijst = haal(pdf, ocp, 'Configs');
  if (lijst instanceof PDFArray) lijst.asArray().forEach((x, i) => {
    const c = zoek(pdf, x);
    if (c instanceof PDFDict) configs.push({ d: c, obj: `Catalog/OCProperties/Configs/${i}` });
  });
  const namen = new Set();
  const ocgs = haal(pdf, ocp, 'OCGs');
  const alle = ocgs instanceof PDFArray ? ocgs.asArray().map((x) => zoek(pdf, x)).filter((x) => x instanceof PDFDict) : [];
  for (const { d: c, obj } of configs) {
    const nm = tekst(haal(pdf, c, 'Name'));
    if (!nm) voeg('oc.config', null, obj, { problem: 'name' });
    else if (namen.has(nm)) voeg('oc.config', null, obj, { problem: 'duplicateName' });
    else namen.add(nm);
    if (c.has(N('AS'))) voeg('oc.config', null, obj, { problem: 'as' });
    const order = new Set();
    inOrder(pdf, haal(pdf, c, 'Order'), order);
    if (alle.some((g) => !order.has(g))) voeg('oc.config', null, obj, { problem: 'order' });
  }
}

