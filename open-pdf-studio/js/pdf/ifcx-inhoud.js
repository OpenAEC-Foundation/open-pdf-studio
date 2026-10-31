// PDF to IFCX (#876): reads what a page draws — vector paths, text runs and
// image placements — straight from its content streams with pdf-lib, in sheet
// coordinates. Pure (no app state, no DOM), so it runs under node --test.
//
// Sheet coordinates: points (1/72 inch), origin at the lower left of the page
// as it is SHOWN (CropBox, /Rotate applied), x to the right, y up. The
// interpreter starts with that display matrix as its CTM, so every point it
// emits is already on the sheet.
//
// Memory: the content stream is walked token by token (iterContentTokens) and
// a page stops collecting geometry once it reaches its cap; after that it only
// counts, so the caller can say how much was left out.

import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, PDFHexString, decodePDFRawStream } from 'pdf-lib';
import { iterContentTokens, matMul, decodeShowOpText } from '../text/content-stream-text.js';
import { buildFontInfos } from './saver/text-edit-inplace.js';
import { knipselMatrix, paginaRotatie } from './vector-embed.js';

/** Default caps per page; the caller may lower or raise them. */
export const STANDAARD_LIMIETEN = Object.freeze({
  maxPaden: 50000,       // stroked subpaths + filled paths
  maxTekst: 20000,       // text runs
  maxAfbeeldingen: 500,  // image placements
});

const MAX_FORM_DIEPTE = 12;
// Curve flattening: one segment per this many points of control polygon, within bounds.
const BOOG_STAP_PT = 2;
const BOOG_MIN = 2;
const BOOG_MAX = 48;

const nameStr = (o) => (o ? String(o).replace(/^\//, '') : '');

function bytesToLatin1(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function streamTekst(stream) {
  if (stream instanceof PDFRawStream) return bytesToLatin1(decodePDFRawStream(stream).decode());
  if (stream && typeof stream.getContents === 'function') return bytesToLatin1(stream.getContents());
  return '';
}

function pdfTekst(o) {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  return o ? nameStr(o) : '';
}

/**
 * The sheet frame of a pdf-lib page: the display matrix (user space to sheet
 * points), the shown size and the rotation.
 */
export function bladKader(page) {
  const cb = page.getCropBox();
  const rotatie = paginaRotatie(page);
  const vak = { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height };
  const { matrix, breedte, hoogte } = knipselMatrix(vak, rotatie);
  return { matrix, breedte, hoogte, rotatie, cropBox: [vak.left, vak.bottom, vak.right, vak.top] };
}

/** Names of the optional content groups that are off in the default view (/OCProperties /D /OFF). */
export function ocgStand(pdfDoc) {
  const uit = new Set();
  try {
    const props = pdfDoc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
    const d = props?.lookupMaybe(PDFName.of('D'), PDFDict);
    const off = d?.lookupMaybe(PDFName.of('OFF'), PDFArray);
    for (let i = 0; i < (off?.size() ?? 0); i++) {
      const ocg = pdfDoc.context.lookup(off.get(i));
      if (ocg instanceof PDFDict) uit.add(pdfTekst(ocg.lookup(PDFName.of('Name'))));
    }
  } catch { /* no layers */ }
  return { uit };
}

function ocgNaam(context, obj) {
  const d = context.lookup(obj);
  if (!(d instanceof PDFDict)) return null;
  const type = nameStr(d.lookupMaybe(PDFName.of('Type'), PDFName));
  if (type === 'OCMD') {
    // Membership dictionary: name it after its first group (approximation).
    const ocgs = d.lookup(PDFName.of('OCGs'));
    if (ocgs instanceof PDFArray) return ocgs.size() ? ocgNaam(context, ocgs.get(0)) : null;
    return ocgs ? ocgNaam(context, ocgs) : null;
  }
  const naam = d.lookup(PDFName.of('Name'));
  return naam ? pdfTekst(naam) || null : null;
}

function cmykNaarRgb(c, m, y, k) {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

const rond3 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

function kleurUit(nums, soort) {
  if (soort === 'pattern' || soort === 'indexed') return null;
  if (nums.length === 1) return [rond3(nums[0]), rond3(nums[0]), rond3(nums[0])];
  if (nums.length === 3) return nums.map(rond3);
  if (nums.length === 4) return cmykNaarRgb(...nums).map(rond3);
  return null;
}

function kleurruimteSoort(naam, resources, context) {
  if (naam === 'DeviceGray' || naam === 'CalGray' || naam === 'G') return 'gray';
  if (naam === 'DeviceRGB' || naam === 'CalRGB' || naam === 'RGB') return 'rgb';
  if (naam === 'DeviceCMYK' || naam === 'CMYK') return 'cmyk';
  if (naam === 'Pattern') return 'pattern';
  try {
    const cs = resources?.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
    const def = cs ? context.lookup(cs.get(PDFName.of(naam))) : null;
    const eerste = def instanceof PDFArray ? nameStr(context.lookup(def.get(0))) : nameStr(def);
    if (eerste === 'Indexed' || eerste === 'I') return 'indexed';
    if (eerste === 'Pattern') return 'pattern';
  } catch { /* unknown space */ }
  return 'other';
}

function transformeer(m, x, y) {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

/** Flattens a cubic Bézier (sheet points) into the polyline `uit`. */
export function vlakBoog(uit, p0, p1, p2, p3) {
  const lengte = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    + Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(BOOG_MIN, Math.min(BOOG_MAX, Math.ceil(lengte / BOOG_STAP_PT)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    uit.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
}

function resourceDict(resources, soort) {
  try { return resources ? resources.lookupMaybe(PDFName.of(soort), PDFDict) : null; } catch { return null; }
}

/**
 * Reads one page.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('pdf-lib').PDFPage} page
 * @param {{tekst?:boolean, raster?:boolean, limieten?:object}} [opties]
 * @returns {{kader:object, paden:object[], teksten:object[], afbeeldingen:object[],
 *   totaal:{paden:number, teksten:number, afbeeldingen:number},
 *   overgeslagen:{inlineAfbeeldingen:number, verlopen:number, onzichtbareTekst:number, onleesbareTekst:number, formDiepte:number}}}
 */
export function leesPaginaInhoud(pdfDoc, page, opties = {}) {
  const context = pdfDoc.context;
  const lim = { ...STANDAARD_LIMIETEN, ...(opties.limieten || {}) };
  const metTekst = opties.tekst !== false;
  const metRaster = opties.raster !== false;
  const kader = bladKader(page);

  const paden = [];
  const teksten = [];
  const afbeeldingen = [];
  const totaal = { paden: 0, teksten: 0, afbeeldingen: 0 };
  const overgeslagen = { inlineAfbeeldingen: 0, verlopen: 0, onzichtbareTekst: 0, onleesbareTekst: 0, formDiepte: 0 };
  const fontCache = new WeakMap();

  const fontInfosVoor = (resources) => {
    const fonts = resourceDict(resources, 'Font');
    if (!fonts) return new Map();
    let infos = fontCache.get(fonts);
    if (!infos) {
      try { infos = buildFontInfos(context, fonts); } catch { infos = new Map(); }
      fontCache.set(fonts, infos);
    }
    return infos;
  };

  // Text runs: consecutive show operators on one baseline merge into one run.
  let run = null;
  const flushRun = () => {
    if (!run) return;
    const tekst = run.tekst.replace(/\s+/g, ' ').trim();
    if (tekst) {
      totaal.teksten++;
      if (teksten.length < lim.maxTekst) {
        teksten.push({ tekst, x: run.x, y: run.y, grootte: run.grootte, hoek: run.hoek, font: run.font, kleur: run.kleur, ocg: run.ocg });
      }
    }
    run = null;
  };

  const voerUit = (src, resources, start) => {
    let gs = start.gs;
    const stapel = [];
    const mcStapel = [];
    let ocgBasis = start.ocg;
    const huidigeOcg = () => {
      for (let i = mcStapel.length - 1; i >= 0; i--) if (mcStapel[i]) return mcStapel[i];
      return ocgBasis;
    };
    const fontInfos = metTekst ? fontInfosVoor(resources) : new Map();

    // Path under construction: subpaths in sheet points.
    let subpaden = [];
    let huidig = null;
    let startPunt = null;
    // Subpaths with at least one segment (a lone moveto draws nothing).
    let telSub = 0;
    let huidigGeteld = false;
    const vol = () => totaal.paden >= lim.maxPaden;
    const nieuwSub = (p) => {
      huidigGeteld = false;
      startPunt = p;
      if (vol()) { huidig = null; return; }
      huidig = { punten: [p], gesloten: false };
      subpaden.push(huidig);
    };
    const segment = () => {
      if (!huidigGeteld) { telSub++; huidigGeteld = true; }
    };
    let laatste = null;
    const T = (x, y) => transformeer(gs.ctm, x, y);

    // Text state.
    let tm = null;
    let lm = null;

    const verf = (stroke, fill, evenOdd) => {
      if (stroke || fill) {
        const sub = subpaden.filter((sp) => sp.punten.length >= 2);
        // Each stroked subpath and each filled path counts toward the cap.
        const kosten = (stroke ? telSub : 0) + (fill ? 1 : 0);
        const ruimte = Math.max(0, lim.maxPaden - totaal.paden);
        totaal.paden += kosten;
        if (sub.length && ruimte > 0) {
          const past = kosten <= ruimte;
          paden.push({
            subpaden: past ? sub : sub.slice(0, ruimte),
            stroke: !!stroke,
            fill: !!fill && (past || !stroke),
            evenOdd: !!evenOdd,
            lijnKleur: gs.lijnKleur,
            vulKleur: gs.vulKleur,
            lijnBreedte: gs.lineWidth * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) || 0,
            gestippeld: gs.gestippeld,
            ocg: huidigeOcg(),
          });
        }
      }
      subpaden = [];
      huidig = null;
      startPunt = null;
      laatste = null;
      telSub = 0;
      huidigGeteld = false;
    };

    const toon = (elementen, fontInfo) => {
      // elementen: the TJ array in order, as [{s:bytes}|{n:number}]
      if (!tm) return;
      if (gs.tr === 3 || gs.tr === 7) {
        overgeslagen.onzichtbareTekst++;
        return;
      }
      const m0 = matMul(tm, gs.ctm);
      const x = m0[4], y = m0[5];
      const hoek = Math.atan2(m0[1], m0[0]) * 180 / Math.PI;
      const grootte = Math.abs(gs.size) * Math.hypot(m0[2], m0[3]);
      const th = gs.tz / 100;
      let tekst = '';
      let ok = false;
      let tx = 0;
      let bytes = 0;
      for (const el of elementen) {
        if (el.n !== undefined) {
          tx -= el.n / 1000 * gs.size * th;
          if (el.n < -200 && tekst && !tekst.endsWith(' ')) tekst += ' ';
          continue;
        }
        bytes += el.s.length;
        const dec = fontInfo ? decodeShowOpText({ strings: [el.s] }, fontInfo) : { text: '', codes: [] };
        if (dec.text && /[^�]/.test(dec.text)) ok = true;
        tekst += dec.text.replace(/�/g, '');
        const bpc = fontInfo?.bytesPerCode || 1;
        const codes = dec.codes.length ? dec.codes : Array.from({ length: Math.floor(el.s.length / bpc) }, () => 0);
        for (const code of codes) {
          const w = fontInfo?.widthOf ? fontInfo.widthOf(code) : undefined;
          const w0 = (Number.isFinite(w) ? w : 500) / 1000;
          tx += (w0 * gs.size + gs.tc + (bpc === 1 && code === 32 ? gs.tw : 0)) * th;
        }
      }
      tm = matMul([1, 0, 0, 1, tx, 0], tm);
      const m1 = matMul(tm, gs.ctm);
      if (!ok) {
        if (bytes) overgeslagen.onleesbareTekst++;
        return;
      }
      const font = fontInfo?.baseFont || gs.font || '';
      const ocg = huidigeOcg();
      if (run && run.font === font && Math.abs(run.grootte - grootte) < 0.01 && Math.abs(run.hoek - hoek) < 0.5
        && run.ocg === ocg && String(run.kleur) === String(gs.vulKleur)) {
        // Distance from the end of the run to this start, along and across the baseline.
        const rad = hoek * Math.PI / 180;
        const dx = x - run.eindX, dy = y - run.eindY;
        const langs = dx * Math.cos(rad) + dy * Math.sin(rad);
        const dwars = -dx * Math.sin(rad) + dy * Math.cos(rad);
        if (Math.abs(dwars) < grootte * 0.2 && langs > -grootte * 0.3 && langs < grootte * 1.5) {
          if (langs > grootte * 0.2 && !run.tekst.endsWith(' ') && !tekst.startsWith(' ')) run.tekst += ' ';
          run.tekst += tekst;
          run.eindX = m1[4];
          run.eindY = m1[5];
          return;
        }
      }
      flushRun();
      run = { tekst, x, y, grootte, hoek, font, kleur: gs.vulKleur, ocg, eindX: m1[4], eindY: m1[5] };
    };

    let operanden = [];
    for (const tok of iterContentTokens(src)) {
      if (tok.t !== 'op') {
        operanden.push(tok);
        continue;
      }
      const op = tok.v;
      const ops = operanden;
      operanden = [];
      const nums = [];
      for (const t of ops) if (t.t === 'num') nums.push(t.v);
      const n = (i) => nums[nums.length - i];

      switch (op) {
        case 'q': stapel.push(gs); gs = { ...gs }; break;
        case 'Q': if (stapel.length) gs = stapel.pop(); break;
        case 'cm': if (nums.length >= 6) gs = { ...gs, ctm: matMul(nums.slice(-6), gs.ctm) }; break;
        case 'w': if (nums.length) gs.lineWidth = n(1); break;
        case 'd': {
          let inArr = false; let aantal = 0;
          for (const t of ops) {
            if (t.t === 'arr[') inArr = true;
            else if (t.t === 'arr]') inArr = false;
            else if (inArr && t.t === 'num' && t.v > 0) aantal++;
          }
          gs.gestippeld = aantal > 0;
          break;
        }
        // Colour.
        case 'g': gs.vulKleur = kleurUit(nums.slice(-1), 'gray'); gs.vulSoort = 'gray'; break;
        case 'G': gs.lijnKleur = kleurUit(nums.slice(-1), 'gray'); gs.lijnSoort = 'gray'; break;
        case 'rg': gs.vulKleur = kleurUit(nums.slice(-3), 'rgb'); gs.vulSoort = 'rgb'; break;
        case 'RG': gs.lijnKleur = kleurUit(nums.slice(-3), 'rgb'); gs.lijnSoort = 'rgb'; break;
        case 'k': gs.vulKleur = kleurUit(nums.slice(-4), 'cmyk'); gs.vulSoort = 'cmyk'; break;
        case 'K': gs.lijnKleur = kleurUit(nums.slice(-4), 'cmyk'); gs.lijnSoort = 'cmyk'; break;
        case 'cs':
        case 'CS': {
          const naam = ops.filter((t) => t.t === 'name').pop()?.v || '';
          const soort = kleurruimteSoort(naam, resources, context);
          const zwart = soort === 'pattern' || soort === 'indexed' ? null : [0, 0, 0];
          if (op === 'cs') { gs.vulSoort = soort; gs.vulKleur = zwart; } else { gs.lijnSoort = soort; gs.lijnKleur = zwart; }
          break;
        }
        case 'sc': case 'scn': {
          const patroon = ops.some((t) => t.t === 'name');
          gs.vulKleur = patroon ? null : kleurUit(nums, gs.vulSoort);
          break;
        }
        case 'SC': case 'SCN': {
          const patroon = ops.some((t) => t.t === 'name');
          gs.lijnKleur = patroon ? null : kleurUit(nums, gs.lijnSoort);
          break;
        }
        // Path construction.
        case 'm':
          if (nums.length >= 2) { const p = T(n(2), n(1)); nieuwSub(p); laatste = p; }
          break;
        case 'l':
          if (nums.length >= 2) {
            const p = T(n(2), n(1));
            if (!startPunt) nieuwSub(laatste || p);
            else if (huidig?.gesloten) nieuwSub(startPunt);
            segment();
            if (huidig) huidig.punten.push(p);
            laatste = p;
          }
          break;
        case 'c': case 'v': case 'y': {
          const need = op === 'c' ? 6 : 4;
          if (nums.length < need || !laatste) break;
          const v = nums.slice(-need);
          let p1, p2, p3;
          if (op === 'c') { p1 = T(v[0], v[1]); p2 = T(v[2], v[3]); p3 = T(v[4], v[5]); }
          else if (op === 'v') { p1 = laatste; p2 = T(v[0], v[1]); p3 = T(v[2], v[3]); }
          else { p1 = T(v[0], v[1]); p2 = T(v[2], v[3]); p3 = p2; }
          if (huidig?.gesloten) nieuwSub(startPunt);
          segment();
          if (huidig) vlakBoog(huidig.punten, laatste, p1, p2, p3);
          laatste = p3;
          break;
        }
        case 'h':
          if (huidig) huidig.gesloten = true;
          laatste = startPunt;
          break;
        case 're':
          if (nums.length >= 4) {
            const [x, y, w, h] = nums.slice(-4);
            const p0 = T(x, y);
            nieuwSub(p0);
            segment();
            if (huidig) {
              huidig.punten.push(T(x + w, y), T(x + w, y + h), T(x, y + h));
              huidig.gesloten = true;
            }
            laatste = p0;
          }
          break;
        case 'S': verf(true, false, false); break;
        case 's': if (huidig) huidig.gesloten = true; verf(true, false, false); break;
        case 'f': case 'F': verf(false, true, false); break;
        case 'f*': verf(false, true, true); break;
        case 'B': verf(true, true, false); break;
        case 'B*': verf(true, true, true); break;
        case 'b': if (huidig) huidig.gesloten = true; verf(true, true, false); break;
        case 'b*': if (huidig) huidig.gesloten = true; verf(true, true, true); break;
        case 'n': verf(false, false, false); break;
        case 'sh': overgeslagen.verlopen++; break;
        case 'BI..EI': overgeslagen.inlineAfbeeldingen++; break;
        // Marked content (optional content).
        case 'BMC': mcStapel.push(null); break;
        case 'BDC': {
          const namen = ops.filter((t) => t.t === 'name');
          let ocg = null;
          if (namen[0]?.v === 'OC' && namen[1]) {
            const props = resourceDict(resources, 'Properties');
            try { ocg = props ? ocgNaam(context, props.get(PDFName.of(namen[1].v))) : null; } catch { ocg = null; }
          }
          mcStapel.push(ocg);
          break;
        }
        case 'EMC': mcStapel.pop(); break;
        // Text.
        case 'BT': tm = [1, 0, 0, 1, 0, 0]; lm = tm.slice(); break;
        case 'ET': flushRun(); tm = null; lm = null; break;
        case 'Tf': {
          const naam = ops.filter((t) => t.t === 'name').pop();
          if (naam) gs.font = naam.v;
          if (nums.length) gs.size = n(1);
          break;
        }
        case 'Tc': if (nums.length) gs.tc = n(1); break;
        case 'Tw': if (nums.length) gs.tw = n(1); break;
        case 'Tz': if (nums.length) gs.tz = n(1); break;
        case 'TL': if (nums.length) gs.tl = n(1); break;
        case 'Tr': if (nums.length) gs.tr = n(1); break;
        case 'Td': case 'TD':
          if (nums.length >= 2 && lm) {
            if (op === 'TD') gs.tl = -n(1);
            lm = matMul([1, 0, 0, 1, n(2), n(1)], lm); tm = lm.slice();
          }
          break;
        case 'Tm': if (nums.length >= 6) { lm = nums.slice(-6); tm = lm.slice(); } break;
        case 'T*': if (lm) { lm = matMul([1, 0, 0, 1, 0, -gs.tl], lm); tm = lm.slice(); } break;
        case 'Tj': case "'": case '"': case 'TJ': {
          if (!metTekst) {
            if (op === "'" || op === '"') { if (lm) { lm = matMul([1, 0, 0, 1, 0, -gs.tl], lm); tm = lm.slice(); } }
            break;
          }
          if (op === "'" || op === '"') {
            if (op === '"' && nums.length >= 2) { gs.tw = n(2); gs.tc = n(1); }
            if (lm) { lm = matMul([1, 0, 0, 1, 0, -gs.tl], lm); tm = lm.slice(); }
          }
          const elementen = [];
          if (op === 'TJ') {
            for (const t of ops) {
              if (t.t === 'str') elementen.push({ s: t.v });
              else if (t.t === 'num') elementen.push({ n: t.v });
            }
          } else {
            const s = ops.filter((t) => t.t === 'str').pop();
            if (s) elementen.push({ s: s.v });
          }
          toon(elementen, fontInfos.get(gs.font) || null);
          break;
        }
        case 'Do': {
          const naam = ops.filter((t) => t.t === 'name').pop()?.v;
          const xobjs = resourceDict(resources, 'XObject');
          if (!naam || !xobjs) break;
          const ref = xobjs.get(PDFName.of(naam));
          const xo = context.lookup(ref);
          if (!(xo instanceof PDFStream)) break;
          const sub = nameStr(xo.dict.lookupMaybe(PDFName.of('Subtype'), PDFName));
          let ocg = huidigeOcg();
          const oc = xo.dict.get(PDFName.of('OC'));
          if (oc) ocg = ocgNaam(context, oc) || ocg;
          if (sub === 'Image') {
            totaal.afbeeldingen++;
            if (metRaster && afbeeldingen.length < lim.maxAfbeeldingen) {
              afbeeldingen.push({
                sleutel: ref instanceof PDFRef ? ref.toString() : `inline-${totaal.afbeeldingen}`,
                stream: xo,
                matrix: gs.ctm.slice(),
                ocg,
              });
            }
          } else if (sub === 'Form') {
            if (start.diepte >= MAX_FORM_DIEPTE || start.bezig.has(xo)) { overgeslagen.formDiepte++; break; }
            const mArr = xo.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
            const m = mArr && mArr.size() === 6
              ? Array.from({ length: 6 }, (_, i) => context.lookup(mArr.get(i), PDFNumber).asNumber())
              : [1, 0, 0, 1, 0, 0];
            let res = resources;
            try { res = xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || resources; } catch { /* parent's */ }
            let inhoud = '';
            try { inhoud = streamTekst(xo); } catch { inhoud = ''; }
            flushRun();
            start.bezig.add(xo);
            voerUit(inhoud, res, {
              gs: { ...gs, ctm: matMul(m, gs.ctm) },
              ocg,
              diepte: start.diepte + 1,
              bezig: start.bezig,
            });
            start.bezig.delete(xo);
          }
          break;
        }
        default: break;
      }
    }
    flushRun();
  };

  const inhoud = [];
  const contents = page.node.Contents();
  const lijst = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, i) => context.lookup(contents.get(i)))
    : [contents];
  for (const s of lijst) {
    if (s instanceof PDFStream) {
      try { inhoud.push(streamTekst(s)); } catch { /* unreadable stream: skip it */ }
    }
  }
  let resources = null;
  try { resources = page.node.Resources() || null; } catch { resources = null; }

  voerUit(inhoud.join('\n'), resources, {
    gs: {
      ctm: kader.matrix.slice(),
      lineWidth: 1,
      lijnKleur: [0, 0, 0], vulKleur: [0, 0, 0], lijnSoort: 'gray', vulSoort: 'gray',
      gestippeld: false,
      font: null, size: 0, tc: 0, tw: 0, tz: 100, tl: 0, tr: 0,
    },
    ocg: null,
    diepte: 0,
    bezig: new Set(),
  });

  return { kader, paden, teksten, afbeeldingen, totaal, overgeslagen };
}
