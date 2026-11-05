// Gedeelde hulp voor PDF/A-validatie en -conversie (#379): objecten opzoeken,
// streams decoderen en alle inhoud van een document doorlopen.
//
// Een "eenheid" is één tekenbare inhoud met haar resources: de inhoud van
// een pagina, een form-XObject, een appearance stream van een annotatie, een
// tiling pattern, de tekenprocedures van een Type3-font of de groep van een
// soft mask. scanInhoud() leest de operatoren van een eenheid en meldt wat
// PDF/A wil weten: welke fonts met welke codes, welke kleurruimten, welke
// graphics states, welke XObjects, de q-diepte en inline images.

import { PDFName, PDFDict, PDFArray, PDFRawStream, PDFStream, PDFRef, PDFNumber, PDFString, PDFHexString, PDFBool, decodePDFRawStream } from 'pdf-lib';
import { tokenizeContentStream } from '../../text/content-stream-text.js';

export const N = (s) => PDFName.of(s);

/** Indirecte verwijzing oplossen (meerdere niveaus). */
export function zoek(pdf, v) {
  let x = v;
  for (let i = 0; i < 8 && x instanceof PDFRef; i++) x = pdf.context.lookup(x);
  return x instanceof PDFRef ? undefined : x;
}

/** Waarde van sleutel `k` in dict of stream, opgelost. */
export function haal(pdf, d, k) {
  const dict = d instanceof PDFStream ? d.dict : d;
  if (!(dict instanceof PDFDict)) return undefined;
  return zoek(pdf, dict.get(N(k)));
}

/** De dict van een dict of stream. */
export function dictVan(v) {
  if (v instanceof PDFStream) return v.dict;
  return v instanceof PDFDict ? v : null;
}

export function naam(v) {
  return v instanceof PDFName ? v.decodeText() : '';
}

export function getal(v) {
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

export function tekst(v) {
  if (v instanceof PDFString || v instanceof PDFHexString) {
    try { return v.decodeText(); } catch { return ''; }
  }
  return undefined;
}

export function isWaar(v) {
  return v instanceof PDFBool && v.asBoolean();
}

export function refTekst(v) {
  return v instanceof PDFRef ? `${v.objectNumber} ${v.generationNumber} R` : null;
}

/** Een object herkenbaar beschrijven: zijn verwijzing, anders een pad. */
export function objectNaam(ref, pad) {
  return refTekst(ref) || pad || '';
}

/** De filternamen van een stream. */
export function filters(pdf, stream) {
  const f = haal(pdf, stream, 'Filter');
  if (f instanceof PDFName) return [naam(f)];
  if (f instanceof PDFArray) return f.asArray().map((x) => naam(zoek(pdf, x)));
  return [];
}

/** Gedecodeerde streambytes, of null als dat niet lukt (bv. DCT/JPX). */
export function decodeer(stream) {
  if (!(stream instanceof PDFRawStream)) {
    try { return stream.getContents(); } catch { return null; }
  }
  try { return decodePDFRawStream(stream).decode(); } catch { return null; }
}

export function latin1(bytes) {
  let s = '';
  const STAP = 0x8000;
  for (let i = 0; i < bytes.length; i += STAP) s += String.fromCharCode.apply(null, bytes.subarray(i, i + STAP));
  return s;
}

/** De inhoudstreams van een pagina. */
export function paginaStreams(pdf, pageNode) {
  const c = zoek(pdf, pageNode.get(N('Contents')));
  if (c instanceof PDFStream) return [c];
  if (c instanceof PDFArray) return c.asArray().map((x) => zoek(pdf, x)).filter((x) => x instanceof PDFStream);
  return [];
}

/**
 * Alle appearance streams van een annotatie: [{ pad, stream, ref }]. Een
 * toestandsdictionary (N/D/R als dict van streams) levert er meerdere.
 */
export function appearanceStreams(pdf, annot) {
  const ap = haal(pdf, annot, 'AP');
  const uit = [];
  if (!(ap instanceof PDFDict)) return uit;
  for (const sleutel of ['N', 'D', 'R']) {
    const raw = ap.get(N(sleutel));
    const v = zoek(pdf, raw);
    if (v instanceof PDFStream) uit.push({ pad: `AP/${sleutel}`, stream: v, ref: raw instanceof PDFRef ? raw : null });
    else if (v instanceof PDFDict) {
      for (const [k, r] of v.entries()) {
        const s = zoek(pdf, r);
        if (s instanceof PDFStream) uit.push({ pad: `AP/${sleutel}/${k.decodeText()}`, stream: s, ref: r instanceof PDFRef ? r : null });
      }
    }
  }
  return uit;
}

/** De annotaties van een pagina: [{ ref, dict }]. */
export function annotaties(pdf, pageNode) {
  const a = zoek(pdf, pageNode.get(N('Annots')));
  if (!(a instanceof PDFArray)) return [];
  const uit = [];
  for (const raw of a.asArray()) {
    const d = zoek(pdf, raw);
    if (d instanceof PDFDict) uit.push({ ref: raw instanceof PDFRef ? raw : null, dict: d });
  }
  return uit;
}

/** Bladeren van een name tree (Names/EmbeddedFiles, Names/JavaScript …): [{ sleutel, waarde }]. */
export function nameTree(pdf, wortel, max = 100000) {
  const uit = [];
  const bezocht = new Set();
  const loop = (knoop, diepte) => {
    const d = zoek(pdf, knoop);
    if (!(d instanceof PDFDict) || bezocht.has(d) || diepte > 32 || uit.length >= max) return;
    bezocht.add(d);
    const namen = haal(pdf, d, 'Names');
    if (namen instanceof PDFArray) {
      for (let i = 0; i + 1 < namen.size(); i += 2) {
        uit.push({ sleutel: tekst(zoek(pdf, namen.get(i))) ?? '', waarde: namen.get(i + 1), houder: namen, index: i });
      }
    }
    const kinderen = haal(pdf, d, 'Kids');
    if (kinderen instanceof PDFArray) for (const k of kinderen.asArray()) loop(k, diepte + 1);
  };
  loop(wortel, 0);
  return uit;
}

// ── Inhoud scannen ─────────────────────────────────────────────────────────

const KLEUR_OPS = { rg: 'DeviceRGB', RG: 'DeviceRGB', k: 'DeviceCMYK', K: 'DeviceCMYK', g: 'DeviceGray', G: 'DeviceGray' };
const TOON_OPS = new Set(['Tj', 'TJ', "'", '"']);

/**
 * Leest de operatoren van één eenheid.
 * @param {string[]} bronnen gedecodeerde streams (latin1)
 * @returns {{
 *   kleurOps: Set<string>, kleurNamen: Set<string>, fonts: Map<string, { strings: number[][], zichtbaar: boolean }>,
 *   gs: Set<string>, xobjecten: Set<string>, shadings: Set<string>, patronen: Set<string>,
 *   intenties: Set<string>, maxDiepte: number, inline: string[], fout: boolean }}
 *   fonts: resourcenaam → de getoonde strings (bytes; de aanroeper deelt ze
 *   in codes van één of twee bytes) en of er zichtbare tekst mee getekend is.
 */
export function scanInhoud(bronnen) {
  const r = {
    kleurOps: new Set(), kleurNamen: new Set(), fonts: new Map(), gs: new Set(), xobjecten: new Set(),
    shadings: new Set(), patronen: new Set(), intenties: new Set(), maxDiepte: 0, inline: [], fout: false,
  };
  let diepte = 0;
  let font = null;
  let modus = 0;
  const modusStapel = [];
  for (const bron of bronnen) {
    let tokens;
    try { tokens = tokenizeContentStream(bron); } catch { r.fout = true; continue; }
    const ops = [];
    for (const t of tokens) {
      if (t.t !== 'op') { ops.push(t); continue; }
      const op = t.v;
      const laatste = ops[ops.length - 1];
      if (op === 'q') { diepte++; modusStapel.push(modus); if (diepte > r.maxDiepte) r.maxDiepte = diepte; }
      else if (op === 'Q') { diepte = Math.max(0, diepte - 1); if (modusStapel.length) modus = modusStapel.pop(); }
      else if (KLEUR_OPS[op]) r.kleurOps.add(KLEUR_OPS[op]);
      else if ((op === 'cs' || op === 'CS') && laatste?.t === 'name') r.kleurNamen.add(laatste.v);
      else if ((op === 'scn' || op === 'SCN') && laatste?.t === 'name') r.patronen.add(laatste.v);
      else if (op === 'gs' && laatste?.t === 'name') r.gs.add(laatste.v);
      else if (op === 'Do' && laatste?.t === 'name') r.xobjecten.add(laatste.v);
      else if (op === 'sh' && laatste?.t === 'name') r.shadings.add(laatste.v);
      else if (op === 'ri' && laatste?.t === 'name') r.intenties.add(laatste.v);
      else if (op === 'Tr' && laatste?.t === 'num') modus = laatste.v;
      else if (op === 'Tf') {
        const nm = ops[ops.length - 2];
        if (nm?.t === 'name') {
          font = nm.v;
          if (!r.fonts.has(font)) r.fonts.set(font, { strings: [], zichtbaar: false });
        }
      } else if (TOON_OPS.has(op) && font) {
        const f = r.fonts.get(font);
        if (modus !== 3) f.zichtbaar = true;
        // Tj ' " nemen één string; TJ een array met strings en getallen.
        for (let i = ops.length - 1; i >= 0; i--) {
          const x = ops[i];
          if (x.t === 'str') { if (f.strings.length < 20000) f.strings.push(x.v); if (op !== 'TJ') break; }
          else if (x.t === 'arr[') break;
          else if (op !== 'TJ' && x.t !== 'num') break;
        }
      } else if (op === 'BI..EI') r.inline.push(bron.slice(t.s, Math.min(t.e, t.s + 4096)));
      ops.length = 0;
    }
  }
  return r;
}

/** De sleutels uit het woordenboek van een inline image (BI … ID). */
export function inlineImageSleutels(tekstBI) {
  const kop = tekstBI.slice(2, Math.max(2, tekstBI.search(/\sID[\s]/)));
  const tokens = tokenizeContentStream(kop);
  const m = new Map();
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i].t !== 'name') continue;
    const w = tokens[i + 1];
    if (w.t === 'name') { m.set(tokens[i].v, w.v); i++; }
    else if (w.t === 'bool' || w.t === 'num') { m.set(tokens[i].v, w.v); i++; }
    else if (w.t === 'arr[') {
      const lijst = [];
      let j = i + 2;
      for (; j < tokens.length && tokens[j].t !== 'arr]'; j++) if (tokens[j].t === 'name') lijst.push(tokens[j].v);
      m.set(tokens[i].v, lijst);
      i = j;
    }
  }
  return m;
}

/**
 * Alle eenheden van het document, elk één keer (gededupliceerd op object);
 * met `perPagina` één keer per pagina.
 * @returns {Array<{ soort: string, pagina: number|null, object: string, houder: any,
 *   streams: PDFStream[], resources: PDFDict|null, annot?: PDFDict }>}
 *   houder: het stream-object (form/AP/pattern) of de pagina-dict
 */
export function verzamelEenheden(pdf, { perPagina = false } = {}) {
  const eenheden = [];
  let gezien = new Set();
  const pages = pdf.getPages();

  const voegToe = (e) => {
    if (gezien.has(e.houder)) return;
    gezien.add(e.houder);
    eenheden.push(e);
    volgResources(e);
  };

  const volgResources = (e) => {
    const res = e.resources;
    if (!(res instanceof PDFDict)) return;
    const xo = haal(pdf, res, 'XObject');
    if (xo instanceof PDFDict) {
      for (const [k, raw] of xo.entries()) {
        const s = zoek(pdf, raw);
        if (!(s instanceof PDFStream) || naam(haal(pdf, s, 'Subtype')) !== 'Form') continue;
        const eigen = haal(pdf, s, 'Resources');
        voegToe({ soort: 'form', pagina: e.pagina, object: objectNaam(raw, `${e.object}/XObject/${k.decodeText()}`), houder: s, streams: [s], resources: eigen instanceof PDFDict ? eigen : res });
      }
    }
    const pat = haal(pdf, res, 'Pattern');
    if (pat instanceof PDFDict) {
      for (const [k, raw] of pat.entries()) {
        const s = zoek(pdf, raw);
        if (!(s instanceof PDFStream)) continue; // shading patterns hebben geen inhoud
        const eigen = haal(pdf, s, 'Resources');
        voegToe({ soort: 'pattern', pagina: e.pagina, object: objectNaam(raw, `${e.object}/Pattern/${k.decodeText()}`), houder: s, streams: [s], resources: eigen instanceof PDFDict ? eigen : null });
      }
    }
    const fonts = haal(pdf, res, 'Font');
    if (fonts instanceof PDFDict) {
      for (const [k, raw] of fonts.entries()) {
        const f = zoek(pdf, raw);
        if (!(f instanceof PDFDict) || naam(haal(pdf, f, 'Subtype')) !== 'Type3') continue;
        const procs = haal(pdf, f, 'CharProcs');
        if (!(procs instanceof PDFDict)) continue;
        const eigen = haal(pdf, f, 'Resources');
        const streams = procs.entries().map(([, r]) => zoek(pdf, r)).filter((s) => s instanceof PDFStream);
        voegToe({ soort: 'type3', pagina: e.pagina, object: objectNaam(raw, `${e.object}/Font/${k.decodeText()}`), houder: f, streams, resources: eigen instanceof PDFDict ? eigen : res });
      }
    }
    const gss = haal(pdf, res, 'ExtGState');
    if (gss instanceof PDFDict) {
      for (const [k, raw] of gss.entries()) {
        const smask = haal(pdf, zoek(pdf, raw), 'SMask');
        const g = smask instanceof PDFDict ? smask.get(N('G')) : null;
        const s = zoek(pdf, g);
        if (!(s instanceof PDFStream)) continue;
        const eigen = haal(pdf, s, 'Resources');
        voegToe({ soort: 'smask', pagina: e.pagina, object: objectNaam(g, `${e.object}/ExtGState/${k.decodeText()}/SMask`), houder: s, streams: [s], resources: eigen instanceof PDFDict ? eigen : null });
      }
    }
  };

  pages.forEach((page, i) => {
    const pagina = i + 1;
    // perPagina: een gedeeld object telt bij elke pagina die het gebruikt.
    if (perPagina) gezien = new Set();
    voegToe({ soort: 'page', pagina, object: `page ${pagina}`, houder: page.node, streams: paginaStreams(pdf, page.node), resources: page.node.Resources() || null });
    for (const { ref, dict } of annotaties(pdf, page.node)) {
      for (const ap of appearanceStreams(pdf, dict)) {
        const eigen = haal(pdf, ap.stream, 'Resources');
        voegToe({ soort: 'ap', pagina, object: objectNaam(ap.ref, `${objectNaam(ref, `page ${pagina}/Annots`)}/${ap.pad}`), houder: ap.stream, streams: [ap.stream], resources: eigen instanceof PDFDict ? eigen : null, annot: dict });
      }
    }
  });
  return eenheden;
}

/** De bronteksten van de streams van een eenheid (latin1), of null bij een fout. */
export function bronnen(e) {
  const uit = [];
  for (const s of e.streams) {
    const b = decodeer(s);
    if (!b) return null;
    uit.push(latin1(b));
  }
  return uit;
}

/** Een resource uit een categorie (Font, XObject, ColorSpace …) opzoeken. */
export function resource(pdf, resources, categorie, sleutel) {
  const cat = haal(pdf, resources, categorie);
  if (!(cat instanceof PDFDict)) return { waarde: undefined, raw: undefined };
  const raw = cat.get(N(sleutel));
  return { waarde: zoek(pdf, raw), raw };
}

/**
 * Welke apparaatkleurruimten een kleurruimtewaarde gebruikt (Indexed-basis,
 * Separation/DeviceN-alternatief en Pattern-onderlaag inbegrepen).
 * @returns {Set<string>} subset van DeviceRGB/DeviceCMYK/DeviceGray
 */
export function apparaatRuimten(pdf, cs, diepte = 0) {
  const uit = new Set();
  const v = zoek(pdf, cs);
  if (diepte > 8) return uit;
  if (v instanceof PDFName) {
    const n = naam(v);
    if (n === 'DeviceRGB' || n === 'RGB') uit.add('DeviceRGB');
    else if (n === 'DeviceCMYK' || n === 'CMYK') uit.add('DeviceCMYK');
    else if (n === 'DeviceGray' || n === 'G') uit.add('DeviceGray');
    return uit;
  }
  if (!(v instanceof PDFArray) || !v.size()) return uit;
  const soort = naam(zoek(pdf, v.get(0)));
  const voeg = (x) => { for (const s of apparaatRuimten(pdf, x, diepte + 1)) uit.add(s); };
  if (soort === 'Indexed' || soort === 'I') voeg(v.get(1));
  else if (soort === 'Separation') voeg(v.get(2));
  else if (soort === 'DeviceN') voeg(v.get(2));
  else if (soort === 'Pattern' && v.size() > 1) voeg(v.get(1));
  else if (soort === 'ICCBased') {
    // Ongeldig ICC-profiel: het /Alternate telt niet; dat is een andere regel.
  } else if (['DeviceRGB', 'DeviceCMYK', 'DeviceGray'].includes(soort)) uit.add(soort);
  return uit;
}
