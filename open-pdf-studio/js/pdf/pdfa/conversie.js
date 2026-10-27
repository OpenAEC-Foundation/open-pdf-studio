// PDF/A-conversie (#379): maakt van een PDF een PDF/A-1b, -2b of -3b.
//
// Volgorde:
//  1. verwijderen wat nooit mag: JavaScript, verboden acties, extra acties
//     (AA), XFA, NeedAppearances, alternatieve presentaties, externe
//     streams; LZW opnieuw comprimeren met Flate; Interpolate/Alternates/OPI
//     van afbeeldingen; PostScript-XObjects; transferfuncties.
//  2. ingesloten bestanden: deel 1 haalt ze weg, deel 2 houdt alleen
//     PDF/A-bestanden, deel 3 vult AFRelationship, UF, MIME-type en /AF aan.
//  3. optionele inhoud: deel 1 haalt de lagen weg (alles wordt zichtbaar),
//     deel 2/3 repareert de configuraties.
//  4. annotaties: verborgen annotaties weg, Print-vlag aan, verboden typen
//     plat in de pagina, ontbrekende appearance streams aanmaken, alleen /N.
//  5. OutputIntent (sRGB, of de bestaande als die geldig is).
//  6. fonts: niet-ingebedde simpele fonts inbedden (Liberation Sans),
//     breedtes en coderingen gelijk trekken met het programma.
//  7. transparantie (deel 1): lege transparantiegroepen weg; een pagina met
//     echte transparantie, een font dat niet in te bedden is of een JPX-beeld
//     wordt als afbeelding vastgelegd (alleen als er een rasterfunctie is).
//  8. kleur: /DefaultRGB of /DefaultCMYK waar apparaatkleur niet bij de
//     OutputIntent past.
//  9. /Info en XMP met pdfaid, bestands-ID, kop, opslaan zonder
//     objectstreams; daarna de eigen validatie op het resultaat.
//
// Wat niet op te lossen is, komt als bevinding in `onopgelost`; de bytes zijn
// dan géén PDF/A en de aanroeper moet ze niet als zodanig opslaan.

import {
  PDFDocument, PDFDict, PDFArray, PDFStream, PDFNumber, PDFRef, PDFHexString, PDFString,
} from 'pdf-lib';
import {
  N, zoek, haal, naam, getal, tekst, isWaar, filters, decodeer, annotaties, nameTree, verzamelEenheden, bronnen,
  scanInhoud, resource, apparaatRuimten, paginaStreams, inlineImageSleutels,
} from './doorloop.js';
import {
  fontInfo, isIngebed, isVervangbaar, vervangDoorLiberation, herstelBreedtes, trueTypeCoderingOk, herstelTrueTypeCodering,
} from './fonts.js';
import { bouwSrgbProfiel } from './icc.js';
import { cmykProfielBytes } from './cmyk-profiel.js';
import { bouwPdfAXmp, pdfDatum, leesPdfDatum } from './xmp.js';
import { valideerPdfA, outputIntents, isPdfABytes, velden, outlines, veldWaarde } from './validatie.js';
import {
  ANNOTATIES_DEEL1, ANNOTATIES_DEEL2, TOEGESTANE_ACTIES, TOEGESTANE_NAMED, MENGMODI, WEERGAVE_INTENTIES, VLAG,
} from './regels.js';

export const PRODUCER = 'Open PDF Studio';

const DECODEERBAAR = new Set(['FlateDecode', 'Fl', 'LZWDecode', 'LZW', 'ASCII85Decode', 'A85', 'ASCIIHexDecode', 'AHx', 'RunLengthDecode', 'RL']);

const MIME = {
  pdf: 'application/pdf', xml: 'application/xml', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
  html: 'text/html', htm: 'text/html', zip: 'application/zip', ifc: 'application/x-step', dwg: 'application/acad',
  dxf: 'image/vnd.dxf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bcf: 'application/zip', bcfzip: 'application/zip',
};

/** MIME-type naar de extensie van een bestandsnaam. */
export function mimeVoor(bestandsnaam) {
  const ext = String(bestandsnaam || '').toLowerCase().split('.').pop();
  return MIME[ext] || 'application/octet-stream';
}

function willekeurigId() {
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * @param {Uint8Array} bytes
 * @param {{
 *   deel: 1|2|3,
 *   laadFont: (variant: 'Regular'|'Bold'|'Italic'|'BoldItalic') => Promise<Uint8Array>,
 *   rasteriseer?: (paginaIndex: number) => Promise<{ breedte: number, hoogte: number, rgb: Uint8Array }>,
 *   nu?: Date, id?: Uint8Array, signal?: AbortSignal,
 * }} opties
 * @returns {Promise<{ bytes: Uint8Array, deel: number, ok: boolean, wijzigingen: Array<{code: string, pagina: number|null, details: object}>,
 *   onopgelost: Array, validatie: object }>}
 */
export async function converteerNaarPdfA(bytes, opties) {
  const deel = Number(opties?.deel);
  if (![1, 2, 3].includes(deel)) throw new Error('PDFA_PART');
  const nu = opties.nu || new Date();
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  if (pdf.context.trailerInfo.Encrypt) throw new Error('PDFA_ENCRYPTED');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const ctx = pdf.context;
  const wijzigingen = [];
  const gemeld = new Set();
  const wijzig = (code, pagina = null, details = {}) => {
    const k = `${code}|${pagina}|${JSON.stringify(details)}`;
    if (gemeld.has(k)) return;
    gemeld.add(k);
    wijzigingen.push({ code, pagina, details });
  };
  const deelSleutel = deel === 1 ? 1 : 2;
  const pauze = async () => {
    await new Promise((r) => setTimeout(r, 0));
    if (opties.signal?.aborted) throw new Error('CANCELLED');
  };

  // ── 1. Verwijderen wat nooit mag ──
  const catalog = pdf.catalog;
  const namen = haal(pdf, catalog, 'Names');
  if (namen instanceof PDFDict) {
    if (namen.has(N('JavaScript'))) { namen.delete(N('JavaScript')); wijzig('change.actionRemoved', null, { type: 'JavaScript' }); }
    if (namen.has(N('AlternatePresentations'))) { namen.delete(N('AlternatePresentations')); wijzig('change.keyRemoved', null, { key: 'AlternatePresentations' }); }
  }
  for (const k of ['AA', 'NeedsRendering', 'Requirements']) {
    if (catalog.has(N(k))) { catalog.delete(N(k)); wijzig(k === 'AA' ? 'change.actionRemoved' : 'change.keyRemoved', null, k === 'AA' ? { type: 'AA' } : { key: k }); }
  }
  const acro = haal(pdf, catalog, 'AcroForm');
  if (acro instanceof PDFDict) {
    if (acro.has(N('XFA'))) { acro.delete(N('XFA')); wijzig('change.keyRemoved', null, { key: 'XFA' }); }
    velden(pdf, haal(pdf, acro, 'Fields'), (veld) => {
      if (veld.has(N('AA'))) { veld.delete(N('AA')); wijzig('change.actionRemoved', null, { type: 'AA' }); }
    });
  }

  // Acties: een verboden actie gaat weg (met wat er via /Next aan hangt).
  const actieOk = (raw) => {
    const d = zoek(pdf, raw);
    if (!(d instanceof PDFDict)) return true;
    const s = naam(haal(pdf, d, 'S'));
    if (!TOEGESTANE_ACTIES[deelSleutel].has(s)) { wijzig('change.actionRemoved', null, { type: s || '?' }); return false; }
    if (s === 'Named' && !TOEGESTANE_NAMED.has(naam(haal(pdf, d, 'N')))) { wijzig('change.actionRemoved', null, { type: 'Named' }); return false; }
    const volgende = d.get(N('Next'));
    if (volgende) {
      const v = zoek(pdf, volgende);
      if (v instanceof PDFArray) {
        const goed = v.asArray().filter((x) => actieOk(x));
        if (goed.length) d.set(N('Next'), ctx.obj(goed)); else d.delete(N('Next'));
      } else if (!actieOk(volgende)) d.delete(N('Next'));
    }
    return true;
  };
  if (catalog.has(N('OpenAction')) && zoek(pdf, catalog.get(N('OpenAction'))) instanceof PDFDict && !actieOk(catalog.get(N('OpenAction')))) catalog.delete(N('OpenAction'));
  outlines(pdf, (item) => { if (item.has(N('A')) && !actieOk(item.get(N('A')))) item.delete(N('A')); });

  // Streams: LZW, externe data, afbeeldingen, PostScript.
  let teller = 0;
  for (const [ref, obj] of [...ctx.enumerateIndirectObjects()]) {
    if (++teller % 2000 === 0) await pauze();
    if (!(obj instanceof PDFStream)) continue;
    const d = obj.dict;
    for (const k of ['F', 'FFilter', 'FDecodeParms']) if (d.has(N(k))) { d.delete(N(k)); wijzig('change.keyRemoved', null, { key: k }); }
    const f = filters(pdf, obj);
    if (f.some((x) => x === 'LZWDecode' || x === 'LZW') || f.includes('Crypt')) {
      if (f.every((x) => DECODEERBAAR.has(x))) {
        const inhoud = decodeer(obj);
        if (inhoud) {
          const nieuw = ctx.flateStream(inhoud, {});
          for (const [k, v] of d.entries()) {
            if (!['Filter', 'DecodeParms', 'Length'].includes(k.decodeText())) nieuw.dict.set(k, v);
          }
          ctx.assign(ref, nieuw);
          wijzig('change.recompressed');
        }
      }
    }
    const st = naam(haal(pdf, d, 'Subtype'));
    if (st === 'Image') {
      for (const k of ['Interpolate', 'Alternates', 'OPI']) if (d.has(N(k))) { d.delete(N(k)); wijzig('change.keyRemoved', null, { key: k }); }
      const intent = haal(pdf, d, 'Intent');
      if (intent && !WEERGAVE_INTENTIES.has(naam(intent))) d.set(N('Intent'), N('RelativeColorimetric'));
    } else if (st === 'Form') {
      for (const k of ['OPI', 'PS', 'Ref', 'Subtype2']) if (d.has(N(k))) { d.delete(N(k)); wijzig('change.keyRemoved', null, { key: k }); }
    } else if (st === 'PS') {
      ctx.assign(ref, ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 0, 0] }));
      wijzig('change.keyRemoved', null, { key: 'PS' });
    }
  }
  // Deel 1: reële getallen boven 32767 (PDF 1.4-grens) worden gehele getallen.
  if (deel === 1) {
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (rondGrotGetallen(obj instanceof PDFStream ? obj.dict : obj, 0)) wijzig('change.limitsFixed');
    }
  }

  // Graphics states: transferfuncties, weergave-intenties, mengmodi (deel 2/3).
  const egsGezien = new Set();
  for (const e of verzamelEenheden(pdf)) {
    const gss = haal(pdf, e.resources, 'ExtGState');
    if (!(gss instanceof PDFDict)) continue;
    for (const [, raw] of gss.entries()) {
      const g = zoek(pdf, raw);
      if (g instanceof PDFDict && !egsGezien.has(g)) { egsGezien.add(g); egsHerstel(pdf, g, deel, wijzig); }
    }
  }

  // ── 2. Ingesloten bestanden ──
  const af = [];
  const herstelSpec = (spec) => {
    if (!(spec instanceof PDFDict)) return;
    const nm = tekst(haal(pdf, spec, 'UF')) || tekst(haal(pdf, spec, 'F')) || 'attachment';
    if (!spec.has(N('F'))) spec.set(N('F'), PDFString.of(nm.replace(/[^\x20-\x7E]/g, '_')));
    if (!spec.has(N('UF'))) spec.set(N('UF'), PDFHexString.fromText(nm));
    if (!spec.has(N('AFRelationship'))) spec.set(N('AFRelationship'), N('Unspecified'));
    if (!spec.has(N('Type'))) spec.set(N('Type'), N('Filespec'));
    const ef = haal(pdf, spec, 'EF');
    if (ef instanceof PDFDict) {
      for (const k of ['F', 'UF']) {
        const s = zoek(pdf, ef.get(N(k)));
        if (!(s instanceof PDFStream)) continue;
        if (!s.dict.has(N('Subtype'))) s.dict.set(N('Subtype'), N(mimeVoor(nm)));
        if (!s.dict.has(N('Type'))) s.dict.set(N('Type'), N('EmbeddedFile'));
        let params = haal(pdf, s, 'Params');
        if (!(params instanceof PDFDict)) { params = ctx.obj({}); s.dict.set(N('Params'), params); }
        if (!params.has(N('ModDate'))) params.set(N('ModDate'), PDFString.of(pdfDatum(nu)));
      }
    }
    af.push(spec);
  };
  const specGoed = (spec) => {
    const ef = haal(pdf, spec, 'EF');
    const s = ef instanceof PDFDict ? zoek(pdf, ef.get(N('UF')) || ef.get(N('F'))) : null;
    const b = s instanceof PDFStream ? decodeer(s) : null;
    return !!b && isPdfABytes(b);
  };
  if (namen instanceof PDFDict && namen.has(N('EmbeddedFiles'))) {
    const items = nameTree(pdf, namen.get(N('EmbeddedFiles')));
    if (deel === 1) {
      namen.delete(N('EmbeddedFiles'));
      for (const e of items) wijzig('change.embeddedRemoved', null, { name: e.sleutel });
    } else if (deel === 2) {
      const weg = items.filter((e) => !specGoed(zoek(pdf, e.waarde)));
      if (weg.length === items.length) namen.delete(N('EmbeddedFiles'));
      else for (const e of [...weg].reverse()) { e.houder.remove(e.index + 1); e.houder.remove(e.index); }
      for (const e of weg) wijzig('change.embeddedRemoved', null, { name: e.sleutel });
    } else for (const e of items) herstelSpec(zoek(pdf, e.waarde));
  }

  // ── 3. Optionele inhoud ──
  if (catalog.has(N('OCProperties'))) {
    if (deel === 1) {
      catalog.delete(N('OCProperties'));
      for (const [, obj] of ctx.enumerateIndirectObjects()) {
        const d = obj instanceof PDFStream ? obj.dict : obj;
        if (d instanceof PDFDict && d.has(N('OC'))) d.delete(N('OC'));
      }
      wijzig('change.layersRemoved');
    } else ocHerstel(pdf, haal(pdf, catalog, 'OCProperties'), wijzig);
  }

  // ── 4. Annotaties ──
  const toegestaan = deel === 1 ? ANNOTATIES_DEEL1 : ANNOTATIES_DEEL2;
  const pages = pdf.getPages();
  let formAppearances = false;
  for (let i = 0; i < pages.length; i++) {
    if (i % 20 === 19) await pauze();
    const pagina = i + 1;
    const node = pages[i].node;
    for (const k of ['AA', 'PresSteps']) if (node.has(N(k))) { node.delete(N(k)); wijzig(k === 'AA' ? 'change.actionRemoved' : 'change.keyRemoved', pagina, k === 'AA' ? { type: 'AA' } : { key: k }); }
    const lijst = zoek(pdf, node.get(N('Annots')));
    if (!(lijst instanceof PDFArray)) continue;
    const houden = [];
    for (const { ref, dict } of annotaties(pdf, node)) {
      const type = naam(haal(pdf, dict, 'Subtype'));
      const f = getal(haal(pdf, dict, 'F')) || 0;
      if (type !== 'Popup' && (f & (VLAG.Hidden | VLAG.NoView))) { wijzig('change.annotRemoved', pagina, { type }); continue; }
      let verboden = !toegestaan.has(type);
      if (!verboden && type === 'FileAttachment') {
        const fs = haal(pdf, dict, 'FS');
        if (deel === 2 && !specGoed(fs)) verboden = true;
        else if (deel === 3) herstelSpec(fs);
      }
      if (verboden) {
        if (vlakAnnotatie(pdf, pages[i], dict)) wijzig('change.annotFlattened', pagina, { type });
        else wijzig('change.annotRemoved', pagina, { type });
        continue;
      }
      // Vlaggen
      let nieuw = (f | VLAG.Print) & ~(VLAG.Hidden | VLAG.Invisible | VLAG.NoView | VLAG.ToggleNoView);
      if (nieuw !== f || !dict.has(N('F'))) dict.set(N('F'), PDFNumber.of(nieuw));
      for (const k of ['AA']) if (dict.has(N(k))) { dict.delete(N(k)); wijzig('change.actionRemoved', pagina, { type: 'AA' }); }
      if (dict.has(N('A')) && ((deel === 1 && type === 'Widget') || !actieOk(dict.get(N('A'))))) { dict.delete(N('A')); wijzig('change.actionRemoved', pagina, { type: 'A' }); }
      // Appearance
      if (type === 'Popup' || type === 'Link') {
        const ap = haal(pdf, dict, 'AP');
        if (ap instanceof PDFDict) { ap.delete(N('D')); ap.delete(N('R')); }
        houden.push(ref || dict);
        continue;
      }
      let ap = haal(pdf, dict, 'AP');
      const isBtn = type === 'Widget' && naam(veldWaarde(pdf, dict, 'FT')) === 'Btn';
      if (!(ap instanceof PDFDict) || !haal(pdf, ap, 'N')) {
        if (type === 'Widget' && !formAppearances) {
          formAppearances = true;
          try { pdf.getForm().updateFieldAppearances(); } catch { /* valt terug op een eenvoudige appearance */ }
          ap = haal(pdf, dict, 'AP');
        }
        if (!(ap instanceof PDFDict) || !haal(pdf, ap, 'N')) {
          dict.set(N('AP'), ctx.obj({ N: maakAppearance(pdf, dict, type) }));
          wijzig('change.appearanceGenerated', pagina, { type });
          ap = haal(pdf, dict, 'AP');
        }
      }
      ap.delete(N('D'));
      ap.delete(N('R'));
      const nn = haal(pdf, ap, 'N');
      if (!isBtn && nn instanceof PDFDict && !(nn instanceof PDFStream)) {
        const as = haal(pdf, dict, 'AS');
        const keuze = (as && nn.get(as)) || nn.values()[0];
        if (keuze) ap.set(N('N'), keuze);
        else ap.set(N('N'), maakAppearance(pdf, dict, type));
      }
      houden.push(ref || dict);
    }
    if (houden.length !== lijst.size()) node.set(N('Annots'), ctx.obj(houden));
  }
  if (acro instanceof PDFDict && acro.has(N('NeedAppearances'))) {
    acro.delete(N('NeedAppearances'));
    wijzig('change.keyRemoved', null, { key: 'NeedAppearances' });
  }

  // ── 5. OutputIntent ──
  const intents = outputIntents(pdf);
  const geldig = (o) => o.kop && ['mntr', 'prtr'].includes(o.kop.klasse) && ['RGB ', 'CMYK', 'GRAY'].includes(o.kop.ruimte)
    && (deel === 1 ? o.kop.versie < 3 : o.kop.versie < 5);
  let profielRef = null;
  let oiRuimte = null;
  const bruikbaar = intents.find((o) => o.s === 'GTS_PDFA1' && geldig(o)) || intents.find((o) => geldig(o));
  if (bruikbaar) {
    profielRef = bruikbaar.profielRaw instanceof PDFRef ? bruikbaar.profielRaw : ctx.register(bruikbaar.profiel);
    oiRuimte = bruikbaar.kop.ruimte;
    if (!bruikbaar.profiel.dict.has(N('N'))) bruikbaar.profiel.dict.set(N('N'), PDFNumber.of(bruikbaar.kop.n));
  }
  const nieuweIntents = [];
  if (!profielRef) {
    profielRef = ctx.register(ctx.flateStream(bouwSrgbProfiel(), { N: 3 }));
    oiRuimte = 'RGB ';
    nieuweIntents.push(ctx.obj({
      Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
      Info: PDFString.of('sRGB IEC61966-2.1'), RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: profielRef,
    }));
    wijzig('change.outputIntentAdded', null, { profile: 'sRGB IEC61966-2.1' });
  } else {
    for (const o of intents) {
      // Elke OutputIntent met een profiel moet naar hetzelfde profiel wijzen.
      if (o.profiel && o.profielRaw !== profielRef) o.dict.set(N('DestOutputProfile'), profielRef);
      nieuweIntents.push(o.dict);
    }
    if (!intents.some((o) => o.s === 'GTS_PDFA1')) {
      const bron = bruikbaar.dict;
      const oci = haal(pdf, bron, 'OutputConditionIdentifier');
      nieuweIntents.push(ctx.obj({
        Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: oci || PDFString.of('Custom'),
        Info: haal(pdf, bron, 'Info') || oci || PDFString.of('Custom'), DestOutputProfile: profielRef,
      }));
      wijzig('change.outputIntentAdded', null, { profile: tekst(oci) || 'ICC' });
    }
  }
  catalog.set(N('OutputIntents'), ctx.obj(nieuweIntents));

  // ── 6. Fonts ──
  const perPagina = verzamelEenheden(pdf, { perPagina: true });
  const rasterRedenen = new Map(); // paginaIndex → Set(reden)
  const rasterNodig = (pagina, reden) => {
    if (!rasterRedenen.has(pagina)) rasterRedenen.set(pagina, new Set());
    rasterRedenen.get(pagina).add(reden);
  };
  const fontCache = new Map();
  const fontKlaar = new Map(); // fontDict → true | 'onmogelijk'
  for (let i = 0; i < perPagina.length; i++) {
    if (i % 50 === 49) await pauze();
    const e = perPagina[i];
    const src = bronnen(e);
    if (!src) continue;
    const scan = scanInhoud(src);
    e.scan = scan;
    for (const [fnaam, gebruik] of scan.fonts) {
      const fd = resource(pdf, e.resources, 'Font', fnaam).waarde;
      if (!(fd instanceof PDFDict)) continue;
      if (!fontKlaar.has(fd)) {
        const info = fontInfo(pdf, fd);
        if (isIngebed(pdf, fd)) {
          if (info.subtype !== 'Type3') {
            if (!trueTypeCoderingOk(pdf, fd)) { herstelTrueTypeCodering(pdf, fd); wijzig('change.fontEncoding', null, { font: info.baseFont }); }
            if (info.samengesteld && naam(haal(pdf, info.descendant, 'Subtype')) === 'CIDFontType2' && !info.descendant.has(N('CIDToGIDMap'))) {
              info.descendant.set(N('CIDToGIDMap'), N('Identity'));
            }
            try { if (herstelBreedtes(pdf, fd, fontkit)) wijzig('change.widthsFixed', null, { font: info.baseFont }); } catch { /* niet te lezen programma */ }
          }
          const subsetOk = info.subtype === 'Type3' || herstelSubsetSet(pdf, info, deel, fontkit);
          fontKlaar.set(fd, subsetOk ? true : { onmogelijk: info.baseFont || '?' });
        } else if (isVervangbaar(pdf, fd)) {
          const r = await vervangDoorLiberation(pdf, fd, fontkit, opties.laadFont, fontCache);
          wijzig(r.maatvast ? 'change.fontEmbedded' : 'change.fontSubstituted', null, { font: info.baseFont, substitute: `Liberation Sans ${r.variant}` });
          fontKlaar.set(fd, true);
        } else fontKlaar.set(fd, { onmogelijk: info.baseFont || '?' });
      }
      const st = fontKlaar.get(fd);
      if (st !== true && gebruik.zichtbaar) rasterNodig(e.pagina - 1, `font:${st.onmogelijk}`);
    }
  }
  // Ook de fonts in de standaardresources van het formulier.
  const dr = haal(pdf, acro, 'DR');
  const drFonts = haal(pdf, dr, 'Font');
  if (drFonts instanceof PDFDict) {
    for (const [, raw] of drFonts.entries()) {
      const fd = zoek(pdf, raw);
      if (fd instanceof PDFDict && !fontKlaar.has(fd) && !isIngebed(pdf, fd) && isVervangbaar(pdf, fd)) {
        await vervangDoorLiberation(pdf, fd, fontkit, opties.laadFont, fontCache);
        fontKlaar.set(fd, true);
      }
    }
  }

  // ── 7. Transparantie (deel 1) ──
  if (deel === 1) {
    for (const e of perPagina) {
      const d = e.houder instanceof PDFStream ? e.houder.dict : e.houder;
      if (e.soort === 'form' || e.soort === 'page' || e.soort === 'ap') {
        const groep = haal(pdf, d, 'Group');
        if (naam(haal(pdf, groep, 'S')) === 'Transparency') { d.delete(N('Group')); wijzig('change.groupRemoved', e.pagina); }
      }
      if (e.soort === 'smask') rasterNodig(e.pagina - 1, 'transparency');
      if (e.annot) {
        const ca = getal(haal(pdf, e.annot, 'CA'));
        if (ca !== undefined && ca < 1) rasterNodig(e.pagina - 1, 'transparency');
        else if (ca !== undefined) e.annot.delete(N('CA'));
      }
      if (transparantIn(pdf, e.resources, e.scan || null)) rasterNodig(e.pagina - 1, 'transparency');
      const xo = haal(pdf, e.resources, 'XObject');
      if (xo instanceof PDFDict) {
        for (const [, raw] of xo.entries()) {
          const s = zoek(pdf, raw);
          if (naam(haal(pdf, s, 'Subtype')) === 'Image' && filters(pdf, s).includes('JPXDecode')) rasterNodig(e.pagina - 1, 'jpx');
        }
      }
      if (e.scan?.maxDiepte > 28) rasterNodig(e.pagina - 1, 'limits');
    }
  }

  // ── Rasteren ──
  const onopgelostRaster = [];
  for (const [index, redenen] of [...rasterRedenen].sort((a, b) => a[0] - b[0])) {
    await pauze();
    if (!opties.rasteriseer) { onopgelostRaster.push({ pagina: index + 1, redenen: [...redenen] }); continue; }
    const beeld = await opties.rasteriseer(index);
    rasterPagina(pdf, pages[index], beeld);
    wijzig('change.pageRasterised', index + 1, { reasons: [...new Set([...redenen].map((r) => r.split(':')[0]))] });
  }
  if (rasterRedenen.size && opties.rasteriseer) pruneVelden(pdf);

  // ── 8. Kleur ──
  const srgbRef = () => {
    if (oiRuimte === 'RGB ') return profielRef;
    srgbRef.ref ??= ctx.register(ctx.flateStream(bouwSrgbProfiel(), { N: 3 }));
    return srgbRef.ref;
  };
  const cmykRef = () => {
    srgbRef.cmyk ??= ctx.register(ctx.flateStream(cmykProfielBytes(), { N: 4 }));
    return srgbRef.cmyk;
  };
  const naRaster = verzamelEenheden(pdf);
  for (const e of naRaster) {
    const src = bronnen(e);
    const scan = src ? scanInhoud(src) : null;
    const ruimten = gebruikteRuimten(pdf, e, scan);
    const d = e.houder instanceof PDFStream ? e.houder.dict : e.houder;
    const groep = haal(pdf, d, 'Group');
    if (groep instanceof PDFDict) {
      const cs = haal(pdf, groep, 'CS');
      const r = apparaatRuimten(pdf, cs);
      if (r.has('DeviceRGB') && oiRuimte !== 'RGB ' && naam(cs)) groep.set(N('CS'), ctx.obj([N('ICCBased'), srgbRef()]));
      if (r.has('DeviceCMYK') && oiRuimte !== 'CMYK' && naam(cs)) groep.set(N('CS'), ctx.obj([N('ICCBased'), cmykRef()]));
    }
    const rgb = ruimten.has('DeviceRGB') && oiRuimte !== 'RGB ';
    const cmyk = ruimten.has('DeviceCMYK') && oiRuimte !== 'CMYK';
    if (!rgb && !cmyk) continue;
    let res = e.resources;
    if (!(res instanceof PDFDict)) {
      res = ctx.obj({});
      d.set(N('Resources'), res);
      e.resources = res;
    }
    let cs = haal(pdf, res, 'ColorSpace');
    if (!(cs instanceof PDFDict)) { cs = ctx.obj({}); res.set(N('ColorSpace'), cs); }
    if (rgb && !cs.has(N('DefaultRGB'))) { cs.set(N('DefaultRGB'), ctx.obj([N('ICCBased'), srgbRef()])); wijzig('change.defaultColorSpace', null, { space: 'DeviceRGB' }); }
    if (cmyk && !cs.has(N('DefaultCMYK'))) { cs.set(N('DefaultCMYK'), ctx.obj([N('ICCBased'), cmykRef()])); wijzig('change.defaultColorSpace', null, { space: 'DeviceCMYK' }); }
  }
  if (deel === 1 && oiRuimte !== 'RGB ') {
    for (const page of pages) {
      for (const { dict } of annotaties(pdf, page.node)) {
        if (dict.has(N('C')) || dict.has(N('IC'))) { dict.delete(N('C')); dict.delete(N('IC')); }
      }
    }
  }

  // ── 9. Metadata, ID, kop ──
  schrijfMetadata(pdf, deel, nu);
  wijzig('change.metadataWritten', null, { part: `${deel}B` });
  const oudId = zoek(pdf, ctx.trailerInfo.ID);
  const eerste = oudId instanceof PDFArray && oudId.size() === 2 ? zoek(pdf, oudId.get(0)) : null;
  const tweede = PDFHexString.of(hex(opties.id || willekeurigId()));
  ctx.trailerInfo.ID = ctx.obj([eerste instanceof PDFHexString || eerste instanceof PDFString ? eerste : tweede, tweede]);
  if (catalog.has(N('Version')) && deel === 1) catalog.delete(N('Version'));

  const uit = await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  // pdf-lib schrijft altijd %PDF-1.7; PDF/A-1 is gebaseerd op PDF 1.4. Even
  // lang, dus geen verschuiving van de xref-offsets.
  if (deel === 1 && uit[7] === 0x37) uit[7] = 0x34;
  const validatie = await valideerPdfA(uit, { deel, signal: opties.signal });
  const onopgelost = validatie.bevindingen;
  return {
    bytes: uit,
    deel,
    ok: onopgelost.length === 0,
    wijzigingen,
    onopgelost,
    rasterNodig: onopgelostRaster,
    validatie,
  };
}

/**
 * CIDSet/CharSet van een ingebedde subset: deel 1 eist ze (6.3.5), deel 2/3
 * eisen alleen dat ze kloppen; daar gaan ze weg. Een Type1-subset zonder
 * CharSet in deel 1 is niet te herstellen zonder het programma te lezen.
 */
function herstelSubsetSet(pdf, info, deel, fontkit) {
  const desc = info.descriptor;
  if (!desc) return true;
  if (deel !== 1) { desc.delete(N('CIDSet')); desc.delete(N('CharSet')); return true; }
  if (!/^[A-Z]{6}\+/.test(info.baseFont)) return true;
  if (info.samengesteld) {
    if (desc.has(N('CIDSet'))) desc.delete(N('CIDSet'));
    const ff = info.programma && decodeer(info.programma.stream);
    let aantal = 0;
    try { aantal = ff ? fontkit.create(ff).numGlyphs : 0; } catch { aantal = 0; }
    const map = haal(pdf, info.descendant, 'CIDToGIDMap');
    if (!aantal || (map && naam(map) !== 'Identity')) return false;
    const bits = new Uint8Array(Math.ceil(aantal / 8));
    for (let cid = 0; cid < aantal; cid++) bits[cid >> 3] |= 0x80 >> (cid & 7);
    desc.set(N('CIDSet'), pdf.context.register(pdf.context.flateStream(bits)));
  } else if (info.programma?.sleutel === 'FontFile' && !desc.has(N('CharSet'))) return false;
  return true;
}

/** Vervangt reële getallen met |v| > 32767 door het afgeronde gehele getal. */
function rondGrotGetallen(obj, diepte) {
  if (diepte > 32) return false;
  let veranderd = false;
  const nieuw = (v) => (v instanceof PDFNumber && !Number.isInteger(v.asNumber()) && Math.abs(v.asNumber()) > 32767
    ? PDFNumber.of(Math.round(v.asNumber())) : null);
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i);
      const n = nieuw(v);
      if (n) { obj.set(i, n); veranderd = true; } else if (rondGrotGetallen(v, diepte + 1)) veranderd = true;
    }
  } else if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) {
      const n = nieuw(v);
      if (n) { obj.set(k, n); veranderd = true; } else if (rondGrotGetallen(v, diepte + 1)) veranderd = true;
    }
  }
  return veranderd;
}

function egsHerstel(pdf, g, deel, wijzig) {
  if (g.has(N('TR'))) { g.delete(N('TR')); wijzig('change.keyRemoved', null, { key: 'TR' }); }
  const tr2 = haal(pdf, g, 'TR2');
  if (tr2 && naam(tr2) !== 'Default') { g.delete(N('TR2')); wijzig('change.keyRemoved', null, { key: 'TR2' }); }
  const ri = haal(pdf, g, 'RI');
  if (ri && !WEERGAVE_INTENTIES.has(naam(ri))) g.set(N('RI'), N('RelativeColorimetric'));
  if (deel !== 1) {
    const bm = haal(pdf, g, 'BM');
    const modi = bm instanceof PDFArray ? bm.asArray().map((x) => naam(zoek(pdf, x))) : bm ? [naam(bm)] : [];
    if (modi.some((m) => !MENGMODI.has(m))) g.set(N('BM'), N(modi.find((m) => MENGMODI.has(m)) || 'Normal'));
  }
}

/**
 * Heeft een eenheid echte transparantie (deel 1)? Met een scan tellen alleen
 * de graphics states en afbeeldingen die de inhoud gebruikt, net als in de
 * validatie.
 */
export function transparantIn(pdf, res, scan = null) {
  const gss = haal(pdf, res, 'ExtGState');
  if (gss instanceof PDFDict) {
    for (const [k, raw] of gss.entries()) {
      if (scan && !scan.gs.has(k.decodeText())) continue;
      const g = zoek(pdf, raw);
      if (!(g instanceof PDFDict)) continue;
      const smask = haal(pdf, g, 'SMask');
      if (smask && naam(smask) !== 'None') return true;
      if ([getal(haal(pdf, g, 'CA')), getal(haal(pdf, g, 'ca'))].some((v) => v !== undefined && v < 1)) return true;
      const bm = haal(pdf, g, 'BM');
      const modi = bm instanceof PDFArray ? bm.asArray().map((x) => naam(zoek(pdf, x))) : bm ? [naam(bm)] : [];
      if (modi.some((m) => !['Normal', 'Compatible'].includes(m))) return true;
    }
  }
  const xo = haal(pdf, res, 'XObject');
  if (xo instanceof PDFDict) {
    for (const [k, raw] of xo.entries()) {
      if (scan && !scan.xobjecten.has(k.decodeText())) continue;
      const s = zoek(pdf, raw);
      if (naam(haal(pdf, s, 'Subtype')) === 'Image' && haal(pdf, s, 'SMask') instanceof PDFStream) return true;
    }
  }
  return false;
}

/** Welke apparaatkleurruimten een eenheid gebruikt. */
function gebruikteRuimten(pdf, e, scan) {
  const ruimten = new Set();
  const res = e.resources;
  if (scan) {
    for (const s of scan.kleurOps) ruimten.add(s);
    for (const nm of scan.kleurNamen) {
      if (['DeviceRGB', 'DeviceCMYK', 'DeviceGray'].includes(nm)) ruimten.add(nm);
      else for (const s of apparaatRuimten(pdf, resource(pdf, res, 'ColorSpace', nm).waarde)) ruimten.add(s);
    }
    for (const nm of scan.shadings) for (const s of apparaatRuimten(pdf, haal(pdf, resource(pdf, res, 'Shading', nm).waarde, 'ColorSpace'))) ruimten.add(s);
    for (const nm of scan.patronen) {
      const sh = haal(pdf, resource(pdf, res, 'Pattern', nm).waarde, 'Shading');
      if (sh) for (const s of apparaatRuimten(pdf, haal(pdf, sh, 'ColorSpace'))) ruimten.add(s);
    }
    for (const nm of scan.xobjecten) {
      const x = resource(pdf, res, 'XObject', nm).waarde;
      if (naam(haal(pdf, x, 'Subtype')) !== 'Image' || isWaar(haal(pdf, x, 'ImageMask'))) continue;
      for (const s of apparaatRuimten(pdf, haal(pdf, x, 'ColorSpace'))) ruimten.add(s);
    }
    for (const bi of scan.inline) {
      const cs = inlineImageSleutels(bi).get('CS') ?? inlineImageSleutels(bi).get('ColorSpace');
      if (cs === 'RGB' || cs === 'DeviceRGB') ruimten.add('DeviceRGB');
      else if (cs === 'CMYK' || cs === 'DeviceCMYK') ruimten.add('DeviceCMYK');
      else if (typeof cs === 'string') for (const s of apparaatRuimten(pdf, resource(pdf, res, 'ColorSpace', cs).waarde)) ruimten.add(s);
    }
  }
  return ruimten;
}

function ocHerstel(pdf, ocp, wijzig) {
  if (!(ocp instanceof PDFDict)) return;
  const ctx = pdf.context;
  const ocgs = haal(pdf, ocp, 'OCGs');
  const alle = ocgs instanceof PDFArray ? ocgs.asArray() : [];
  const configs = [];
  let d = haal(pdf, ocp, 'D');
  if (!(d instanceof PDFDict)) { d = ctx.obj({}); ocp.set(N('D'), d); }
  configs.push(d);
  const lijst = haal(pdf, ocp, 'Configs');
  if (lijst instanceof PDFArray) for (const x of lijst.asArray()) { const c = zoek(pdf, x); if (c instanceof PDFDict) configs.push(c); }
  const namen = new Set();
  configs.forEach((c, i) => {
    let nm = tekst(haal(pdf, c, 'Name'));
    if (!nm || namen.has(nm)) {
      nm = i === 0 ? 'Default' : `Config ${i}`;
      while (namen.has(nm)) nm += '+';
      c.set(N('Name'), PDFHexString.fromText(nm));
      wijzig('change.layersFixed');
    }
    namen.add(nm);
    if (c.has(N('AS'))) { c.delete(N('AS')); wijzig('change.layersFixed'); }
    let order = haal(pdf, c, 'Order');
    const aanwezig = new Set();
    const loop = (arr, diepte) => {
      if (!(arr instanceof PDFArray) || diepte > 16) return;
      for (const x of arr.asArray()) { const v = zoek(pdf, x); if (v instanceof PDFArray) loop(v, diepte + 1); else if (v instanceof PDFDict) aanwezig.add(v); }
    };
    loop(order, 0);
    const missend = alle.filter((x) => !aanwezig.has(zoek(pdf, x)));
    if (missend.length) {
      if (!(order instanceof PDFArray)) { order = ctx.obj([]); c.set(N('Order'), order); }
      for (const x of missend) order.push(x);
      wijzig('change.layersFixed');
    }
  });
}

/** Annotatie-appearance als XObject in de pagina tekenen (ISO 32000-1 12.5.5). */
function vlakAnnotatie(pdf, page, annot) {
  const ctx = pdf.context;
  const ap = haal(pdf, annot, 'AP');
  let n = haal(pdf, ap, 'N');
  if (n instanceof PDFDict && !(n instanceof PDFStream)) {
    const as = haal(pdf, annot, 'AS');
    n = zoek(pdf, (as && n.get(as)) || n.values()[0]);
  }
  if (!(n instanceof PDFStream)) return false;
  const rect = (haal(pdf, annot, 'Rect')?.asArray?.() || []).map((x) => getal(zoek(pdf, x)) || 0);
  if (rect.length !== 4) return false;
  const bbox = (haal(pdf, n, 'BBox')?.asArray?.() || [0, 0, 1, 1]).map((x) => getal(zoek(pdf, x)) || 0);
  const m = (haal(pdf, n, 'Matrix')?.asArray?.() || [1, 0, 0, 1, 0, 0]).map((x) => getal(zoek(pdf, x)) || 0);
  const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const hoeken = [pt(bbox[0], bbox[1]), pt(bbox[2], bbox[1]), pt(bbox[0], bbox[3]), pt(bbox[2], bbox[3])];
  const xs = hoeken.map((p) => p[0]);
  const ys = hoeken.map((p) => p[1]);
  const [bx0, by0, bx1, by1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [rx0, ry0, rx1, ry1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const sx = bx1 - bx0 ? (rx1 - rx0) / (bx1 - bx0) : 1;
  const sy = by1 - by0 ? (ry1 - ry0) / (by1 - by0) : 1;
  const a = [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy];
  if (!n.dict.has(N('Type'))) n.dict.set(N('Type'), N('XObject'));
  if (!n.dict.has(N('Subtype'))) n.dict.set(N('Subtype'), N('Form'));
  const ref = ctx.getObjectRef(n) || ctx.register(n);
  const xo = page.node.normalizedEntries().XObject;
  let sleutel = 'OPSAnnot0';
  for (let i = 1; xo.has(N(sleutel)); i++) sleutel = `OPSAnnot${i}`;
  xo.set(N(sleutel), ref);
  omhulInhoud(pdf, page);
  const getal6 = (v) => (Math.round(v * 1e5) / 1e5).toString();
  page.node.addContentStream(ctx.register(ctx.flateStream(`q ${a.map(getal6).join(' ')} cm /${sleutel} Do Q\n`)));
  return true;
}

/** Zet de bestaande pagina-inhoud tussen q … Q (één keer), zodat erachter toegevoegde inhoud een schone toestand heeft. */
function omhulInhoud(pdf, page) {
  if (page.__pdfaOmhuld) return;
  page.__pdfaOmhuld = true;
  const ctx = pdf.context;
  const huidig = paginaStreams(pdf, page.node);
  const refs = [];
  const c = page.node.get(N('Contents'));
  const lijst = zoek(pdf, c);
  if (lijst instanceof PDFArray) refs.push(...lijst.asArray());
  else if (c) refs.push(c);
  if (!huidig.length) return;
  const q = ctx.register(ctx.stream('q\n'));
  const Q = ctx.register(ctx.stream('\nQ\n'));
  page.node.set(N('Contents'), ctx.obj([q, ...refs, Q]));
}

const kleurOp = (c, vul) => {
  if (!c || !c.length) return '';
  const w = c.map((v) => (Math.round(v * 1000) / 1000).toString()).join(' ');
  if (c.length === 1) return `${w} ${vul ? 'g' : 'G'}`;
  if (c.length === 3) return `${w} ${vul ? 'rg' : 'RG'}`;
  if (c.length === 4) return `${w} ${vul ? 'k' : 'K'}`;
  return '';
};

/** Een eenvoudige appearance stream voor een annotatie zonder /AP. */
export function maakAppearance(pdf, annot, type) {
  const ctx = pdf.context;
  const getallen = (k) => {
    const v = haal(pdf, annot, k);
    return v instanceof PDFArray ? v.asArray().map((x) => getal(zoek(pdf, x))).filter((x) => x !== undefined) : null;
  };
  const r = getallen('Rect') || [0, 0, 0, 0];
  const [x0, y0, x1, y1] = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  const c = getallen('C');
  const ic = getallen('IC');
  const bs = haal(pdf, annot, 'BS');
  const bw = getal(haal(pdf, bs, 'W')) ?? 1;
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  const lijn = c ? `${kleurOp(c, false)} ${f(bw)} w ` : '';
  let ops = '';
  if (type === 'Square' && c) ops = `${lijn}${ic ? kleurOp(ic, true) + ' ' : ''}${f(x0 + bw / 2)} ${f(y0 + bw / 2)} ${f(x1 - x0 - bw)} ${f(y1 - y0 - bw)} re ${ic ? 'B' : 'S'}`;
  else if (type === 'Circle' && c) {
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const rx = (x1 - x0 - bw) / 2; const ry = (y1 - y0 - bw) / 2; const k = 0.5523;
    ops = `${lijn}${ic ? kleurOp(ic, true) + ' ' : ''}${f(cx + rx)} ${f(cy)} m `
      + `${f(cx + rx)} ${f(cy + k * ry)} ${f(cx + k * rx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c `
      + `${f(cx - k * rx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + k * ry)} ${f(cx - rx)} ${f(cy)} c `
      + `${f(cx - rx)} ${f(cy - k * ry)} ${f(cx - k * rx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c `
      + `${f(cx + k * rx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - k * ry)} ${f(cx + rx)} ${f(cy)} c ${ic ? 'B' : 'S'}`;
  } else if (type === 'Line' && c) {
    const l = getallen('L');
    if (l && l.length === 4) ops = `${lijn}${f(l[0])} ${f(l[1])} m ${f(l[2])} ${f(l[3])} l S`;
  } else if ((type === 'Polygon' || type === 'PolyLine') && c) {
    const v = getallen('Vertices') || [];
    if (v.length >= 4) ops = `${lijn}${f(v[0])} ${f(v[1])} m ${v.slice(2).reduce((s, x, i, a) => (i % 2 ? s : `${s}${f(x)} ${f(a[i + 1])} l `), '')}${type === 'Polygon' ? 'h S' : 'S'}`;
  } else if (type === 'Ink' && c) {
    const lijsten = haal(pdf, annot, 'InkList');
    if (lijsten instanceof PDFArray) {
      ops = lijn;
      for (const raw of lijsten.asArray()) {
        const p = zoek(pdf, raw)?.asArray?.().map((x) => getal(zoek(pdf, x)) || 0) || [];
        if (p.length < 4) continue;
        ops += `${f(p[0])} ${f(p[1])} m `;
        for (let i = 2; i + 1 < p.length; i += 2) ops += `${f(p[i])} ${f(p[i + 1])} l `;
        ops += 'S ';
      }
    }
  } else if (['Underline', 'StrikeOut', 'Squiggly', 'Highlight'].includes(type) && c) {
    const q = getallen('QuadPoints') || [];
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]]; const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      const a = Math.min(...xs); const b = Math.max(...xs); const lo = Math.min(...ys); const hi = Math.max(...ys);
      if (type === 'Highlight') ops += `${kleurOp(c, true)} ${f(a)} ${f(lo)} ${f(b - a)} ${f(hi - lo)} re f `;
      else {
        const y = type === 'StrikeOut' ? (lo + hi) / 2 : lo + (hi - lo) * 0.08;
        ops += `${kleurOp(c, false)} ${f(Math.max(0.5, (hi - lo) / 16))} w ${f(a)} ${f(y)} m ${f(b)} ${f(y)} l S `;
      }
    }
  } else if (type === 'Text') {
    const w = Math.min(20, x1 - x0); const h = Math.min(20, y1 - y0);
    ops = `${c ? kleurOp(c, true) : '1 1 0 rg'} 0 G 0.5 w ${f(x0 + 0.5)} ${f(y1 - h + 0.5)} ${f(w - 1)} ${f(h - 1)} re B`;
  }
  return ctx.register(ctx.stream(ops ? `q ${ops.trim()} Q\n` : '', {
    Type: 'XObject', Subtype: 'Form', BBox: [x0, y0, x1, y1], Resources: {},
  }));
}

/** Vervangt de inhoud van een pagina door een afbeelding (DeviceRGB, Flate). */
export function rasterPagina(pdf, page, beeld) {
  const ctx = pdf.context;
  const { breedte, hoogte, rgb } = beeld;
  if (!(breedte > 0 && hoogte > 0) || !rgb || rgb.length < breedte * hoogte * 3) throw new Error('PDFA_RASTER');
  const img = ctx.register(ctx.flateStream(rgb.subarray(0, breedte * hoogte * 3), {
    Type: 'XObject', Subtype: 'Image', Width: breedte, Height: hoogte, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
  }));
  const box = page.getCropBox();
  const inhoud = ctx.register(ctx.flateStream(`q ${box.width} 0 0 ${box.height} ${box.x} ${box.y} cm /OPSRaster Do Q\n`));
  const node = page.node;
  node.set(N('Contents'), inhoud);
  node.set(N('Resources'), ctx.obj({ XObject: { OPSRaster: img } }));
  node.delete(N('Group'));
  // Alles wat zichtbaar was, zit nu in het beeld; alleen koppelingen blijven.
  const houden = annotaties(pdf, node).filter(({ dict }) => naam(haal(pdf, dict, 'Subtype')) === 'Link').map(({ ref, dict }) => ref || dict);
  if (houden.length) node.set(N('Annots'), ctx.obj(houden));
  else node.delete(N('Annots'));
}

/** Formuliervelden zonder widget op een pagina horen niet meer in /Fields. */
function pruneVelden(pdf) {
  const acro = haal(pdf, pdf.catalog, 'AcroForm');
  const fields = haal(pdf, acro, 'Fields');
  if (!(fields instanceof PDFArray)) return;
  const opPagina = new Set();
  for (const page of pdf.getPages()) for (const { dict } of annotaties(pdf, page.node)) opPagina.add(dict);
  const heeftWidget = (v, diepte = 0) => {
    if (!(v instanceof PDFDict) || diepte > 32) return false;
    if (opPagina.has(v)) return true;
    const kids = haal(pdf, v, 'Kids');
    return kids instanceof PDFArray && kids.asArray().some((k) => heeftWidget(zoek(pdf, k), diepte + 1));
  };
  const houden = fields.asArray().filter((raw) => heeftWidget(zoek(pdf, raw)));
  if (houden.length !== fields.size()) acro.set(N('Fields'), pdf.context.obj(houden));
}

/** /Info opschonen en het XMP met pdfaid schrijven, met dezelfde waarden. */
export function schrijfMetadata(pdf, deel, nu) {
  const ctx = pdf.context;
  let info = zoek(pdf, ctx.trailerInfo.Info);
  const oud = {};
  if (info instanceof PDFDict) {
    for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'CreationDate']) {
      // Tekens die in XML niet mogen, gaan weg (anders is het XMP ongeldig);
      // alleen witruimte telt als leeg.
      const t = tekst(haal(pdf, info, k))?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
      if (t !== undefined && t.trim() !== '') oud[k] = t;
    }
  }
  const aangemaakt = (oud.CreationDate && leesPdfDatum(oud.CreationDate)) || nu;
  const nieuw = ctx.obj({});
  const zet = (k, v) => { if (v != null) nieuw.set(N(k), PDFHexString.fromText(v)); };
  zet('Title', oud.Title);
  zet('Author', oud.Author);
  zet('Subject', oud.Subject);
  zet('Keywords', oud.Keywords);
  zet('Creator', oud.Creator);
  zet('Producer', PRODUCER);
  nieuw.set(N('CreationDate'), PDFString.of(pdfDatum(aangemaakt)));
  nieuw.set(N('ModDate'), PDFString.of(pdfDatum(nu)));
  // Op dezelfde plek, zodat de oude /Info niet als los object achterblijft.
  if (ctx.trailerInfo.Info instanceof PDFRef) ctx.assign(ctx.trailerInfo.Info, nieuw);
  else ctx.trailerInfo.Info = ctx.register(nieuw);
  const xml = bouwPdfAXmp({
    part: deel, conformance: 'B', title: oud.Title, author: oud.Author, subject: oud.Subject, keywords: oud.Keywords,
    creator: oud.Creator, producer: PRODUCER, createDate: aangemaakt, modifyDate: nu,
  });
  const stream = ctx.stream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' });
  const oudRef = pdf.catalog.get(N('Metadata'));
  if (oudRef instanceof PDFRef) ctx.assign(oudRef, stream);
  else pdf.catalog.set(N('Metadata'), ctx.register(stream));
  return xml;
}

