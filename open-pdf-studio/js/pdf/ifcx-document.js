// PDF to IFCX (#876, beta): builds an IFCX document (IFC5 alpha, JSON) from a
// PDF — one sheet node per page with drawing, text and raster layers, and the
// annotations of the app on a layer of their own. The design, the mapping and
// what is lossy are in docs/ifcx-export.md.
//
// Pure (pdf-lib, no app state), so it runs under node --test. The app glue
// (dialog, save dialog, menu, MCP) is in ifcx-export.js.
//
// Memory: pages are read one at a time; the nodes of a page are serialised
// to JSON as soon as the page is done, so only the text of the output and one
// page of geometry are in memory together.

import { leesPaginaInhoud, ocgStand, STANDAARD_LIMIETEN } from './ifcx-inhoud.js';
import { zetAfbeeldingOm } from './ifcx-afbeelding.js';
import { ifcEntityFor } from './ifc-entity.js';
import { schaalTekst } from './cad-export-logica.js';

export const IFCX_VERSIE = 'ifcx_alpha';
export const DATA_VERSIE = '0.1.0';
export const IMPORTS = Object.freeze([
  'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx',
  'https://ifcx.dev/@openusd.org/usd@v1.ifcx',
]);
/** Attribute namespaces that come from the imported schemas. */
export const GEIMPORTEERDE_NAMESPACES = Object.freeze(['bsi::ifc::', 'usd::']);

/** One point (1/72 inch) in metres. */
export const PT_M = 0.0254 / 72;
/** Gap between sheets laid out side by side, in metres of the composed model. */
const BLAD_TUSSENRUIMTE = 0.05;

export const STANDAARD_OPTIES = Object.freeze({
  raster: true,
  tekst: true,
  annotaties: true,
  limieten: STANDAARD_LIMIETEN,
  maxBeeldBytes: 16 * 1024 * 1024,   // one image, encoded
  maxRasterBytes: 96 * 1024 * 1024,  // all images together, encoded
  // The whole file, in characters of JSON. A heavy CAD page gives ~13 MB; the
  // text of the file is one string, and a JS string cannot grow past ~512 M
  // characters (the export then failed with "Invalid string length" after a
  // long wait). Once the file is this large, the remaining pages are left out
  // and reported. One more page (paths, text and the raster budget) still fits.
  maxDocumentTekens: 320 * 1024 * 1024,
});

const IFC_KLASSE_URI = 'https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/';
const SCHEMA_URI = 'https://github.com/OpenAEC-Foundation/open-pdf-studio/blob/main/docs/ifcx-export.md#';

// ── Schemas of the own attributes ──

const T = (dataType, extra = {}) => ({ dataType, ...extra });
const OPT = (dataType, extra = {}) => ({ dataType, optional: true, ...extra });
const OBJ = (values) => ({ dataType: 'Object', objectRestrictions: { values } });
const ARR = (value) => ({ dataType: 'Array', arrayRestrictions: { value } });

/** The own attributes (namespace opds::pdf::) with their value descriptions. */
export const SCHEMAS = Object.freeze({
  'opds::pdf::document': OBJ({
    fileName: OPT('String'), pageCount: T('Integer'), exportedPages: ARR(T('Integer')),
    generator: T('String'), created: T('DateTime'), units: T('String'), beta: T('Boolean'),
  }),
  'opds::pdf::sheet': OBJ({
    pageNumber: T('Integer'), label: OPT('String'), widthPt: T('Real'), heightPt: T('Real'),
    rotation: T('Integer'), cropBox: ARR(T('Real')), scaleDenominator: OPT('Real'), scale: OPT('String'),
    origin: ARR(T('Real')),
    counts: OBJ({ paths: T('Integer'), texts: T('Integer'), images: T('Integer'), annotations: T('Integer') }),
    truncated: OPT('Object', { objectRestrictions: { values: { paths: OPT('Integer'), texts: OPT('Integer'), images: OPT('Integer') } } }),
    skipped: OBJ({ inlineImages: T('Integer'), shadings: T('Integer'), invisibleText: T('Integer'), undecodableText: T('Integer'), nestedForms: T('Integer') }),
  }),
  'opds::pdf::layer': OBJ({ kind: T('String'), name: T('String'), source: T('String') }),
  'opds::pdf::style': OBJ({
    stroke: OPT('Array', { arrayRestrictions: { value: T('Real') } }),
    fill: OPT('Array', { arrayRestrictions: { value: T('Real') } }),
    lineWidth: T('Real'), dashed: T('Boolean'), fillRule: OPT('String'),
  }),
  'opds::pdf::text': OBJ({ value: T('String'), fontSize: T('Real'), font: OPT('String'), rotation: T('Real') }),
  'opds::pdf::image': OBJ({
    mimeType: OPT('String'), widthPx: T('Integer'), heightPx: T('Integer'), encoding: OPT('String'),
    data: OPT('String'), byteLength: T('Integer'), omitted: OPT('String'),
  }),
  'opds::pdf::placement': OBJ({ matrix: ARR(T('Real')) }),
  'opds::pdf::annotation': OBJ({
    id: T('String'), type: T('String'), name: OPT('String'), subject: OPT('String'), author: OPT('String'),
    text: OPT('String'), layer: OPT('String'), createdAt: OPT('String'), modifiedAt: OPT('String'),
    color: OPT('String'), lineWidth: OPT('Real'),
    measure: OPT('Object', { objectRestrictions: { values: { value: OPT('Real'), unit: OPT('String'), text: OPT('String') } } }),
    replies: OPT('Array', { arrayRestrictions: { value: OBJ({ author: OPT('String'), text: OPT('String'), createdAt: OPT('String') }) } }),
    properties: OPT('Object'),
  }),
});

function schemaBlok() {
  const uit = {};
  for (const [naam, value] of Object.entries(SCHEMAS)) {
    uit[naam] = { uri: SCHEMA_URI + naam.replace(/::/g, '-'), value };
  }
  return uit;
}

// ── Helpers ──

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const m = (pt) => r6(pt * PT_M);
const p3 = (p) => [m(p[0]), m(p[1]), 0];

function klasse(code) {
  return { code, uri: IFC_KLASSE_URI + code };
}

/** 4x4 transform (row vectors, translation in the last row) as USD writes it. */
function transformatie({ schaal = 1, hoekGraden = 0, tx = 0, ty = 0 }) {
  const a = hoekGraden * Math.PI / 180;
  const c = r6(Math.cos(a) * schaal), s = r6(Math.sin(a) * schaal);
  return [[c, s, 0, 0], [-s, c, 0, 0], [0, 0, r6(schaal), 0], [r6(tx), r6(ty), 0, 1]];
}

/**
 * Unique node paths in UUID form: a random (or seeded) prefix per export
 * and a counter, so paths are unique without a UUID generator per node.
 */
export function padMaker(zaad = null) {
  const hex = (n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  };
  const prefix = zaad
    ? String(zaad).replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(19, '0').slice(0, 19)
    : hex(19);
  // 8-4-4-4-12, version nibble 4 and variant 8.
  const vast = `${prefix.slice(0, 8)}-${prefix.slice(8, 12)}-4${prefix.slice(12, 15)}-8${prefix.slice(15, 18)}`;
  let teller = 0;
  return () => `${vast}-${(++teller).toString(16).padStart(12, '0')}`;
}

function naamSleutel(prefix, i, breedte = 6) {
  return `${prefix}-${String(i).padStart(breedte, '0')}`;
}

// ── Annotations ──

function annotatieGeometrie(ann, hoogtePt) {
  const P = (x, y) => [m(x), m(hoogtePt - y), 0];
  const lijst = (pts) => (Array.isArray(pts) ? pts.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : []);
  const gesloten = ['polygon', 'cloud', 'measureArea', 'filledArea', 'measurePerimeter'].includes(ann.type);
  let punten = null;
  const pts = lijst(ann.points).length ? lijst(ann.points) : lijst(ann.path);
  if (pts.length >= 2) {
    punten = pts.map((p) => P(p.x, p.y));
    if (gesloten) punten.push(punten[0]);
  } else if ([ann.startX, ann.startY, ann.endX, ann.endY].every(Number.isFinite)) {
    punten = [P(ann.startX, ann.startY), P(ann.endX, ann.endY)];
  } else if ([ann.x, ann.y, ann.width, ann.height].every(Number.isFinite) && ann.width > 0 && ann.height > 0) {
    const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
    const rad = (Number(ann.rotation) || 0) * Math.PI / 180;
    const draai = (x, y) => {
      const dx = x - cx, dy = y - cy;
      return P(cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad));
    };
    if (ann.type === 'circle') {
      punten = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32 * 2 * Math.PI;
        punten.push(draai(cx + Math.cos(t) * ann.width / 2, cy + Math.sin(t) * ann.height / 2));
      }
    } else {
      const { x, y, width: w, height: h } = ann;
      punten = [draai(x, y), draai(x + w, y), draai(x + w, y + h), draai(x, y + h), draai(x, y)];
    }
  }
  if (punten) return { 'usd::usdgeom::basiscurves': { points: punten } };
  if (Number.isFinite(ann.x) && Number.isFinite(ann.y)) {
    return { 'usd::xformop': { transform: transformatie({ tx: m(ann.x), ty: m(hoogtePt - ann.y) }) } };
  }
  return {};
}

const tekstOf = (v) => (typeof v === 'string' && v.length ? v : undefined);

/**
 * The attributes of one annotation node: the IFC class and properties of the
 * existing `.ifcreport` mapping (ifc-entity.js), plus geometry on the sheet.
 */
export function annotatieAttributen(ann, hoogtePt, laagNaam = null) {
  const e = ifcEntityFor(ann);
  const kleur = e.style?.color;
  const meet = {};
  if (Number.isFinite(ann.measureValue)) meet.value = ann.measureValue;
  if (tekstOf(ann.measureUnit)) meet.unit = ann.measureUnit;
  if (tekstOf(ann.measureText)) meet.text = ann.measureText;
  const info = {
    id: String(ann.id ?? ''),
    type: String(ann.type ?? ''),
    name: tekstOf(e.name),
    subject: tekstOf(ann.subject),
    author: tekstOf(ann.author),
    text: tekstOf(ann.text) ?? tekstOf(ann.contents),
    layer: tekstOf(laagNaam),
    createdAt: tekstOf(ann.createdAt),
    modifiedAt: tekstOf(ann.modifiedAt),
    color: typeof kleur === 'string' ? kleur : undefined,
    lineWidth: Number.isFinite(e.style?.lineWidth) ? e.style.lineWidth : undefined,
    measure: Object.keys(meet).length ? meet : undefined,
    replies: Array.isArray(ann.replies) && ann.replies.length
      ? ann.replies.map((r) => ({ author: tekstOf(r?.author), text: tekstOf(r?.text), createdAt: tekstOf(r?.createdAt) }))
      : undefined,
    properties: e.properties && Object.keys(e.properties).length ? e.properties : undefined,
  };
  return {
    'bsi::ifc::class': klasse(e.class || 'IfcAnnotation'),
    'opds::pdf::annotation': JSON.parse(JSON.stringify(info)),
    ...annotatieGeometrie(ann, hoogtePt),
  };
}

// ── Writer ──

/** Collects nodes; a page's nodes are serialised as soon as they are added. */
export class IfcxSchrijver {
  constructor({ bron = null, paginaAantal = 0, tijd = new Date().toISOString(), zaad = null, opties = {} } = {}) {
    this.opties = { ...STANDAARD_OPTIES, ...opties, limieten: { ...STANDAARD_LIMIETEN, ...(opties.limieten || {}) } };
    this.nieuwPad = padMaker(zaad);
    this.tijd = tijd;
    this.bron = bron;
    this.paginaAantal = paginaAantal;
    this.stukken = [];
    this.wortel = this.nieuwPad();
    this.bladen = {};
    this.paginas = [];
    this.stijlen = new Map();
    this.beelden = new Map();
    this.rasterBytes = 0;
    this.offsetX = 0;
    this.waarschuwingen = [];
    this.tellingen = { sheets: 0, paths: 0, texts: 0, images: 0, annotations: 0 };
    // Characters of JSON written so far (with the separating commas).
    this.tekens = 0;
  }

  knoop(knoop) {
    const json = JSON.stringify(knoop);
    this.stukken.push(json);
    this.tekens += json.length + 1;
    return knoop.path;
  }

  stijl(sleutel, attributen) {
    let pad = this.stijlen.get(sleutel);
    if (!pad) {
      pad = this.knoop({ path: this.nieuwPad(), attributes: attributen });
      this.stijlen.set(sleutel, pad);
    }
    return pad;
  }

  lijnStijl(pad, fill) {
    const kleur = fill ? pad.vulKleur : pad.lijnKleur;
    const stijl = {
      stroke: fill ? undefined : (pad.lijnKleur || undefined),
      fill: fill ? (pad.vulKleur || undefined) : undefined,
      lineWidth: fill ? 0 : m(pad.lijnBreedte),
      dashed: !fill && !!pad.gestippeld,
      fillRule: fill ? (pad.evenOdd ? 'evenodd' : 'nonzero') : undefined,
    };
    const attributen = {
      'bsi::ifc::class': klasse('IfcAnnotation'),
      'opds::pdf::style': JSON.parse(JSON.stringify(stijl)),
    };
    if (kleur) attributen['bsi::ifc::presentation::diffuseColor'] = kleur;
    return this.stijl(JSON.stringify(attributen), attributen);
  }

  /** A layer node with its children; returns its path. */
  laag(soort, naam, bron, kinderen, zichtbaar = true) {
    const attributen = { 'opds::pdf::layer': { kind: soort, name: naam, source: bron } };
    if (!zichtbaar) attributen['usd::usdgeom::visibility'] = { visibility: 'invisible' };
    return this.knoop({ path: this.nieuwPad(), children: kinderen, attributes: attributen });
  }

  /**
   * Groups children per PDF layer (OCG): without layers the children stay
   * direct; with layers each OCG gets a group node, with its visibility.
   */
  perOcg(items, ocgUit, soort) {
    const heeftOcg = items.some((it) => it.ocg);
    if (!heeftOcg) return Object.fromEntries(items.map((it) => [it.naam, it.pad]));
    const groepen = new Map();
    for (const it of items) {
      const k = it.ocg || '';
      if (!groepen.has(k)) groepen.set(k, {});
      groepen.get(k)[it.naam] = it.pad;
    }
    const kinderen = {};
    let i = 0;
    for (const [ocg, kids] of groepen) {
      i++;
      kinderen[naamSleutel('pdf-layer', i, 3)] = ocg
        ? this.laag(soort, ocg, 'pdf-ocg', kids, !ocgUit.has(ocg))
        : this.laag(soort, '', 'pdf-content', kids);
    }
    return kinderen;
  }

  /**
   * Adds one sheet.
   * @param {{nummer:number, label?:string|null, schaal?:number|null, inhoud:object,
   *   beelden?:Map<string,object>, annotaties?:object[], annotatieLagen?:object[], ocgUit?:Set<string>}} blad
   */
  voegBladToe(blad) {
    const { inhoud } = blad;
    const kader = inhoud.kader;
    const ocgUit = blad.ocgUit || new Set();
    const kinderen = {};

    // Drawing: one node per stroked subpath, one mesh node per filled path.
    const tekening = [];
    let n = 0;
    for (const pad of inhoud.paden) {
      if (pad.fill) {
        const punten = [];
        const indices = [];
        const tellen = [];
        for (const sp of pad.subpaden) {
          const pts = sp.punten.length > 2 && sp.punten[0][0] === sp.punten.at(-1)[0] && sp.punten[0][1] === sp.punten.at(-1)[1]
            ? sp.punten.slice(0, -1) : sp.punten;
          if (pts.length < 3) continue;
          tellen.push(pts.length);
          for (const p of pts) { indices.push(punten.length); punten.push(p3(p)); }
        }
        if (tellen.length) {
          tekening.push({
            naam: naamSleutel('fill', ++n), ocg: pad.ocg,
            pad: this.knoop({
              path: this.nieuwPad(),
              inherits: { style: this.lijnStijl(pad, true) },
              attributes: { 'usd::usdgeom::mesh': { points: punten, faceVertexIndices: indices, faceVertexCounts: tellen } },
            }),
          });
        }
      }
      if (pad.stroke) {
        const stijl = this.lijnStijl(pad, false);
        for (const sp of pad.subpaden) {
          const punten = sp.punten.map(p3);
          if (sp.gesloten) punten.push(punten[0]);
          tekening.push({
            naam: naamSleutel('path', ++n), ocg: pad.ocg,
            pad: this.knoop({ path: this.nieuwPad(), inherits: { style: stijl }, attributes: { 'usd::usdgeom::basiscurves': { points: punten } } }),
          });
        }
      }
    }
    this.tellingen.paths += tekening.length;
    if (tekening.length) kinderen.drawing = this.laag('drawing', 'Drawing', 'pdf-content', this.perOcg(tekening, ocgUit, 'drawing'));

    // Text runs.
    const teksten = [];
    if (this.opties.tekst) {
      inhoud.teksten.forEach((t, i) => {
        const attributen = { 'bsi::ifc::class': klasse('IfcAnnotation') };
        if (t.kleur) attributen['bsi::ifc::presentation::diffuseColor'] = t.kleur;
        const stijl = this.stijl(JSON.stringify(attributen), attributen);
        teksten.push({
          naam: naamSleutel('text', i + 1), ocg: t.ocg,
          pad: this.knoop({
            path: this.nieuwPad(),
            inherits: { style: stijl },
            attributes: {
              'opds::pdf::text': { value: t.tekst, fontSize: m(t.grootte), font: t.font || undefined, rotation: r6(t.hoek) },
              'usd::xformop': { transform: transformatie({ hoekGraden: t.hoek, tx: m(t.x), ty: m(t.y) }) },
            },
          }),
        });
      });
    }
    this.tellingen.texts += teksten.length;
    if (teksten.length) kinderen.text = this.laag('text', 'Text', 'pdf-content', this.perOcg(teksten, ocgUit, 'text'));

    // Raster: the image data once per XObject, a placement per use.
    const raster = [];
    if (this.opties.raster) {
      inhoud.afbeeldingen.forEach((a, i) => {
        const beeld = blad.beelden?.get(a.sleutel);
        if (!beeld) return;
        const mat = a.matrix;
        const hoeken = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => p3([u * mat[0] + v * mat[2] + mat[4], u * mat[1] + v * mat[3] + mat[5]]));
        raster.push({
          naam: naamSleutel('image', i + 1, 4), ocg: a.ocg,
          pad: this.knoop({
            path: this.nieuwPad(),
            inherits: { image: this.beeldBron(a.sleutel, beeld) },
            attributes: {
              'opds::pdf::placement': { matrix: [m(mat[0]), m(mat[1]), m(mat[2]), m(mat[3]), m(mat[4]), m(mat[5])] },
              'usd::usdgeom::mesh': { points: hoeken, faceVertexIndices: [0, 1, 2, 3], faceVertexCounts: [4] },
            },
          }),
        });
      });
    }
    this.tellingen.images += raster.length;
    if (raster.length) kinderen.raster = this.laag('raster', 'Raster', 'pdf-content', this.perOcg(raster, ocgUit, 'raster'));

    // Annotations: a layer of their own, grouped per annotation layer of the app.
    let annAantal = 0;
    if (this.opties.annotaties && blad.annotaties?.length) {
      const lagen = blad.annotatieLagen || [];
      const laagVan = (ann) => lagen.find((l) => l.id === (ann.layer || 'default')) || null;
      const metLagen = lagen.length > 1 || blad.annotaties.some((a) => a.layer && a.layer !== 'default');
      const groepen = new Map();
      blad.annotaties.forEach((ann, i) => {
        const laag = laagVan(ann);
        const naam = laag ? (laag.name || (laag.id === 'default' ? 'Default' : laag.id)) : (ann.layer || 'Default');
        const pad = this.knoop({ path: this.nieuwPad(), attributes: annotatieAttributen(ann, kader.hoogte, metLagen ? naam : null) });
        const k = metLagen ? (ann.layer || 'default') : '';
        if (!groepen.has(k)) groepen.set(k, { naam, zichtbaar: laag ? laag.visible !== false : true, kids: {} });
        groepen.get(k).kids[naamSleutel('annotation', i + 1, 5)] = pad;
        annAantal++;
      });
      let annKinderen;
      if (!metLagen) annKinderen = groepen.get('')?.kids || {};
      else {
        annKinderen = {};
        let i = 0;
        for (const g of groepen.values()) {
          annKinderen[naamSleutel('layer', ++i, 3)] = this.laag('annotations', g.naam, 'annotation-layer', g.kids, g.zichtbaar);
        }
      }
      kinderen.annotations = this.laag('annotations', 'Annotations', 'app-annotations', annKinderen);
    }
    this.tellingen.annotations += annAantal;

    // The sheet itself: frame, size, scale and placement.
    const schaal = Number.isFinite(blad.schaal) && blad.schaal > 0 ? blad.schaal : null;
    const factor = schaal ?? 1;
    const afgekapt = {};
    if (inhoud.totaal.paden > this.opties.limieten.maxPaden) afgekapt.paths = inhoud.totaal.paden;
    if (inhoud.totaal.teksten > inhoud.teksten.length) afgekapt.texts = inhoud.totaal.teksten;
    if (this.opties.raster && inhoud.totaal.afbeeldingen > inhoud.afbeeldingen.length) afgekapt.images = inhoud.totaal.afbeeldingen;
    for (const [soort, totaal] of Object.entries(afgekapt)) {
      const bewaard = soort === 'paths' ? Math.min(totaal, this.opties.limieten.maxPaden)
        : soort === 'texts' ? inhoud.teksten.length : inhoud.afbeeldingen.length;
      this.waarschuwingen.push({ code: 'cap', page: blad.nummer, kind: soort, kept: bewaard, total: totaal });
    }
    const w = kader.breedte, h = kader.hoogte;
    const bladPad = this.knoop({
      path: this.nieuwPad(),
      children: kinderen,
      attributes: {
        'opds::pdf::sheet': JSON.parse(JSON.stringify({
          pageNumber: blad.nummer,
          label: blad.label || undefined,
          widthPt: r6(w),
          heightPt: r6(h),
          rotation: kader.rotatie,
          cropBox: kader.cropBox.map(r6),
          scaleDenominator: schaal ?? undefined,
          scale: schaal ? schaalTekst(schaal, '.') : undefined,
          origin: [r6(this.offsetX), 0, 0],
          counts: { paths: tekening.length, texts: teksten.length, images: raster.length, annotations: annAantal },
          truncated: Object.keys(afgekapt).length ? afgekapt : undefined,
          skipped: {
            inlineImages: inhoud.overgeslagen.inlineAfbeeldingen,
            shadings: inhoud.overgeslagen.verlopen,
            invisibleText: inhoud.overgeslagen.onzichtbareTekst,
            undecodableText: inhoud.overgeslagen.onleesbareTekst,
            nestedForms: inhoud.overgeslagen.formDiepte,
          },
        })),
        'usd::xformop': { transform: transformatie({ schaal: factor, tx: this.offsetX }) },
        'usd::usdgeom::basiscurves': { points: [[0, 0, 0], [m(w), 0, 0], [m(w), m(h), 0], [0, m(h), 0], [0, 0, 0]] },
      },
    });
    this.offsetX += m(w) * factor + BLAD_TUSSENRUIMTE;
    this.bladen[naamSleutel('sheet', blad.nummer, 3)] = bladPad;
    this.paginas.push(blad.nummer);
    this.tellingen.sheets++;
    return bladPad;
  }

  /** The image resource node of one XObject (written once, inherited by placements). */
  beeldBron(sleutel, beeld) {
    let pad = this.beelden.get(sleutel);
    if (pad) return pad;
    let omitted = beeld.reden || null;
    let data = null;
    if (beeld.bytes && !omitted) {
      if (beeld.bytes.length > this.opties.maxBeeldBytes) omitted = 'imageTooLarge';
      else if (this.rasterBytes + beeld.bytes.length > this.opties.maxRasterBytes) omitted = 'rasterBudget';
      else {
        data = base64(beeld.bytes);
        this.rasterBytes += beeld.bytes.length;
      }
    }
    if (omitted) this.waarschuwingen.push({ code: 'image', image: sleutel, reason: omitted });
    pad = this.knoop({
      path: this.nieuwPad(),
      attributes: {
        'opds::pdf::image': JSON.parse(JSON.stringify({
          mimeType: beeld.mimeType || undefined,
          widthPx: beeld.breedte || 0,
          heightPx: beeld.hoogte || 0,
          encoding: data ? 'base64' : undefined,
          data: data || undefined,
          byteLength: data ? beeld.bytes.length : 0,
          omitted: omitted || undefined,
        })),
      },
    });
    this.beelden.set(sleutel, pad);
    return pad;
  }

  /** The whole document as JSON text. */
  afronden() {
    this.knoop({
      path: this.wortel,
      children: this.bladen,
      attributes: {
        'bsi::ifc::class': klasse('IfcProject'),
        'opds::pdf::document': JSON.parse(JSON.stringify({
          fileName: this.bron || undefined,
          pageCount: this.paginaAantal,
          exportedPages: this.paginas,
          generator: 'open-pdf-studio',
          created: this.tijd,
          units: 'm',
          beta: true,
        })),
      },
    });
    const kop = {
      header: {
        id: `opds-ifcx-${this.wortel}`,
        ifcxVersion: IFCX_VERSIE,
        dataVersion: DATA_VERSIE,
        author: 'Open PDF Studio',
        timestamp: this.tijd,
      },
      imports: IMPORTS.map((uri) => ({ uri })),
      schemas: schemaBlok(),
    };
    const begin = JSON.stringify(kop).slice(0, -1);
    return `${begin},"data":[${this.stukken.join(',')}]}`;
  }
}

function base64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * Builds the IFCX text of a PDF, page by page.
 * @param {import('pdf-lib').PDFDocument} pdfDoc  pdf-lib document
 * @param {{paginas?:number[], labels?:(string|null)[], schaalVoor?:(nr:number, kader:object)=>number|null,
 *   annotaties?:object[], annotatieLagen?:object[], opties?:object, bron?:string|null, tijd?:string,
 *   zaad?:string, voortgang?:(klaar:number, totaal:number)=>void, afgebroken?:()=>boolean,
 *   wacht?:()=>Promise<void>}} [o]
 * @returns {Promise<{tekst:string|null, verslag:{pages:number[], counts:object, warnings:object[], cancelled:boolean}}>}
 */
export async function bouwIfcx(pdfDoc, o = {}) {
  const totaalPaginas = pdfDoc.getPageCount();
  const paginas = (o.paginas?.length ? o.paginas : Array.from({ length: totaalPaginas }, (_, i) => i + 1))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= totaalPaginas);
  const schrijver = new IfcxSchrijver({ bron: o.bron ?? null, paginaAantal: totaalPaginas, tijd: o.tijd, zaad: o.zaad, opties: o.opties || {} });
  const { opties } = schrijver;
  const { uit: ocgUit } = ocgStand(pdfDoc);
  const annotaties = Array.isArray(o.annotaties) ? o.annotaties : [];

  for (let i = 0; i < paginas.length; i++) {
    if (o.afgebroken?.()) return { tekst: null, verslag: { pages: schrijver.paginas, counts: schrijver.tellingen, warnings: schrijver.waarschuwingen, cancelled: true } };
    const nr = paginas[i];
    if (schrijver.tekens >= opties.maxDocumentTekens) {
      // Full: the rest of the pages stays out, and the user is told from which page.
      schrijver.waarschuwingen.push({ code: 'size', page: nr, skipped: paginas.length - i });
      break;
    }
    const page = pdfDoc.getPage(nr - 1);
    const inhoud = leesPaginaInhoud(pdfDoc, page, { tekst: opties.tekst, raster: opties.raster, limieten: opties.limieten });
    const beelden = new Map();
    if (opties.raster) {
      for (const a of inhoud.afbeeldingen) {
        if (beelden.has(a.sleutel) || schrijver.beelden.has(a.sleutel)) {
          if (!beelden.has(a.sleutel)) beelden.set(a.sleutel, {});
          continue;
        }
        try {
          beelden.set(a.sleutel, await zetAfbeeldingOm(pdfDoc.context, a.stream));
        } catch {
          beelden.set(a.sleutel, { mimeType: null, breedte: 0, hoogte: 0, bytes: null, reden: 'decodeFailed' });
        }
      }
    }
    schrijver.voegBladToe({
      nummer: nr,
      label: o.labels?.[nr - 1] ?? null,
      schaal: o.schaalVoor ? o.schaalVoor(nr, inhoud.kader) : null,
      inhoud,
      beelden,
      annotaties: annotaties.filter((a) => (a?.page ?? 1) === nr),
      annotatieLagen: o.annotatieLagen || [],
      ocgUit,
    });
    o.voortgang?.(i + 1, paginas.length);
    if (o.wacht) await o.wacht();
  }
  return {
    tekst: schrijver.afronden(),
    verslag: { pages: schrijver.paginas, counts: schrijver.tellingen, warnings: schrijver.waarschuwingen, cancelled: false },
  };
}

/**
 * The warnings of an export as translated lines.
 * @param {(key:string, opts?:object)=>string} t  translator for the dialogs namespace
 */
export function waarschuwingTeksten(t, verslag) {
  const regels = [];
  let beelden = 0;
  for (const w of verslag?.warnings || []) {
    if (w.code === 'cap') {
      const key = w.kind === 'texts' ? 'ifcxExport.capTexts' : w.kind === 'images' ? 'ifcxExport.capImages' : 'ifcxExport.capPaths';
      regels.push(t(key, { page: w.page, kept: w.kept, total: w.total }));
    } else if (w.code === 'image') {
      beelden++;
    } else if (w.code === 'size') {
      regels.push(t('ifcxExport.sizeLimit', { page: w.page }));
    }
  }
  if (beelden) regels.push(t('ifcxExport.imagesOmitted', { count: beelden }));
  return regels;
}

// ── Validation (used by the tests, and cheap enough for a sanity check) ──

function controleerWaarde(waarde, beschrijving, pad, fouten) {
  if (waarde === undefined || waarde === null) {
    if (!beschrijving.optional) fouten.push(`${pad}: missing`);
    return;
  }
  switch (beschrijving.dataType) {
    case 'String': case 'DateTime': if (typeof waarde !== 'string') fouten.push(`${pad}: not a string`); break;
    case 'Integer': if (!Number.isInteger(waarde)) fouten.push(`${pad}: not an integer`); break;
    case 'Real': if (typeof waarde !== 'number' || !Number.isFinite(waarde)) fouten.push(`${pad}: not a number`); break;
    case 'Boolean': if (typeof waarde !== 'boolean') fouten.push(`${pad}: not a boolean`); break;
    case 'Array':
      if (!Array.isArray(waarde)) { fouten.push(`${pad}: not an array`); break; }
      if (beschrijving.arrayRestrictions?.value) waarde.forEach((v, i) => controleerWaarde(v, beschrijving.arrayRestrictions.value, `${pad}[${i}]`, fouten));
      break;
    case 'Object': {
      if (typeof waarde !== 'object' || Array.isArray(waarde)) { fouten.push(`${pad}: not an object`); break; }
      const velden = beschrijving.objectRestrictions?.values;
      if (!velden) break;
      for (const k of Object.keys(waarde)) if (!velden[k]) fouten.push(`${pad}.${k}: not in the schema`);
      for (const [k, b] of Object.entries(velden)) controleerWaarde(waarde[k], b, `${pad}.${k}`, fouten);
      break;
    }
    default: fouten.push(`${pad}: unknown dataType ${beschrijving.dataType}`);
  }
}

/**
 * Checks the structure of an IFCX document: header fields, imports, unique
 * paths, children and inherits that resolve, no cycles, every attribute from
 * an imported namespace or a declared schema (and then matching it).
 * @returns {string[]} problems (empty = valid)
 */
export function valideerIfcx(doc) {
  const fouten = [];
  if (!doc || typeof doc !== 'object') return ['not an object'];
  const h = doc.header || {};
  for (const k of ['id', 'ifcxVersion', 'dataVersion', 'author', 'timestamp']) {
    if (typeof h[k] !== 'string' || !h[k]) fouten.push(`header.${k} missing`);
  }
  if (!Array.isArray(doc.imports) || doc.imports.some((i) => typeof i?.uri !== 'string')) fouten.push('imports must be [{uri}]');
  if (!Array.isArray(doc.data)) return [...fouten, 'data must be an array'];
  const schemas = doc.schemas || {};
  const paden = new Map();
  for (const n of doc.data) {
    if (typeof n?.path !== 'string' || !n.path) { fouten.push('node without path'); continue; }
    if (paden.has(n.path)) fouten.push(`duplicate path ${n.path}`);
    paden.set(n.path, n);
  }
  for (const n of doc.data) {
    for (const veld of ['children', 'inherits']) {
      if (n[veld] === undefined) continue;
      if (typeof n[veld] !== 'object' || Array.isArray(n[veld])) { fouten.push(`${n.path}.${veld} must be an object`); continue; }
      for (const [k, doel] of Object.entries(n[veld])) {
        if (doel !== null && !paden.has(doel)) fouten.push(`${n.path}.${veld}.${k} -> ${doel} does not resolve`);
      }
    }
    for (const [naam, waarde] of Object.entries(n.attributes || {})) {
      if (GEIMPORTEERDE_NAMESPACES.some((ns) => naam.startsWith(ns))) continue;
      const s = schemas[naam];
      if (!s) { fouten.push(`${n.path}: attribute ${naam} has no schema`); continue; }
      controleerWaarde(waarde, s.value, `${n.path}:${naam}`, fouten);
    }
  }
  // No cycles through children.
  const status = new Map();
  const bezoek = (pad) => {
    if (status.get(pad) === 2) return;
    if (status.get(pad) === 1) { fouten.push(`cycle at ${pad}`); return; }
    status.set(pad, 1);
    for (const doel of Object.values(paden.get(pad)?.children || {})) if (paden.has(doel)) bezoek(doel);
    status.set(pad, 2);
  };
  for (const pad of paden.keys()) bezoek(pad);
  return fouten;
}
