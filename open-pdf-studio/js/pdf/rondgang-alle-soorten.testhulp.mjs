// Testhulp voor rondgang-alle-soorten.test.mjs (#629): het bronbestand met
// elke annotatiesoort, en de annotatiewoordenboeken ontleed om te vergelijken.
// Zie de kop van de test.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import assert from 'node:assert/strict';
import {
  PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict, PDFRef, PDFNumber, PDFBool,
  PDFNull, PDFStream, PDFObject,
} from 'pdf-lib';
import { leegBlad, opslaan } from './rondgang.testhulp.mjs';

// ── lastige tekst ──────────────────────────────────────────────────────────

/** Unicode-tekst met alles wat een tekenreeks kan breken (#555). */
const LASTIG = 'Prijs €12,50 – 3 m² bij 20 °C ± 0,5 mm Ø100 👷 建筑图纸 שלום مرحبا 1) open ( dicht ) \\ eind\\';
/**
 * Een letterlijke tekenreeks zoals een ander programma hem schrijft: haakjes
 * die niet sluiten en een backslash, ge-escaped.
 * Inhoud: 1) Confirm ((  \ end
 */
const LETTERLIJK = '1\\) Confirm \\(\\( \\\\ end';
const RC = '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" '
  + 'xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:spec="2.0.2">'
  + '<p dir="ltr"><span style="font-weight:bold">Let op:</span> 3 m² &amp; 20 °C (zie detail</p></body>';

// ── het bestand bouwen ─────────────────────────────────────────────────────

export const N = (n) => PDFName.of(n);

/**
 * Het bronbestand: eerst de annotaties die de app zelf schrijft (een boog en
 * een gebogen aanwijzer, met de echte saver), dan alles van een ander
 * programma met pdf-lib erbij.
 */
export async function bouwBron() {
  const basis = {
    page: 1, rotation: 0, color: '#0000ff', strokeColor: '#0000ff', fillColor: null,
    lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'App € gebruiker',
  };
  const eigen = [
    { ...basis, id: 'boog', nm: 'nm-app-boog', subject: 'Boog (eigen', type: 'arc', centerX: 450, centerY: 80, radius: 40, startAngle: 0.3, endAngle: 2.5 },
    {
      ...basis, id: 'spline', nm: 'nm-app-spline', subject: 'Gebogen aanwijzer ²', type: 'splineArrow',
      startHead: 'none', endHead: 'closed', headSize: 8,
      points: [{ x: 300, y: 760 }, { x: 340, y: 720 }, { x: 400, y: 740 }, { x: 440, y: 790 }],
    },
  ];
  const appBytes = await opslaan(await leegBlad(), eigen);
  const doc = await PDFDocument.load(appBytes);
  const ctx = doc.context;
  const pagina = doc.getPage(0);
  const annots = pagina.node.Annots() || ctx.obj([]);
  if (!pagina.node.Annots()) pagina.node.set(N('Annots'), annots);

  // Laag van een ander programma.
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('Markeringen € (laag') }));
  doc.catalog.set(N('OCProperties'), ctx.obj({ OCGs: [ocg], D: ctx.obj({ Order: [ocg], ON: [ocg] }) }));

  // Een stroom in de eigen sleutels van een ander programma.
  const priveStroom = ctx.register(ctx.stream(new Uint8Array([0, 1, 2, 255, 40, 41, 92]), { Type: 'XYZ_Blob', Versie: 2 }));
  const ap = (bbox, inhoud = '0 0 1 rg 0 0 10 10 re f') => {
    const s = ctx.register(ctx.stream(inhoud, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: ctx.obj({}) }));
    return ctx.obj({ N: s });
  };
  const rand = () => ctx.obj({ Type: 'Border', W: 1.5, S: 'D', D: [3, 2] });
  const wolk = () => ctx.obj({ S: 'C', I: 1 });

  const refs = {};
  let n = 0;
  /** Een annotatie met de gedeelde sleutels; `extra` wint. */
  function voeg(naam, subtype, rect, extra = {}, { contents = 'hex' } = {}) {
    n++;
    const dict = ctx.obj({
      Type: 'Annot',
      Subtype: subtype,
      Rect: rect,
      NM: PDFString.of(naam),
      Subj: PDFHexString.fromText(`Onderwerp ${n} € ² ° (open`),
      T: PDFHexString.fromText('Jan Müller-Ø'),
      M: PDFString.of("D:20260115103000+01'00'"),
      CreationDate: PDFString.of('D:20260114090000Z'),
      Contents: contents === 'letterlijk' ? PDFString.of(LETTERLIJK) : PDFHexString.fromText(`${LASTIG} #${n}`),
      F: 4,
      CA: 0.75,
      C: [1, 0, 0],
      BS: rand(),
      XYZ_Private: ctx.obj({
        Versie: 3,
        Lijst: [1, [2, 3, [4.5]], PDFString.of('tekst \\(in'), N('Naam'), true, PDFNull],
        Strm: priveStroom,
        Sub: ctx.obj({ Diep: ctx.obj({ Nog: [0.5, -1] }) }),
      }),
      XYZ_Flag: true,
    });
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) dict.delete(N(k));
      else dict.set(N(k), v instanceof PDFObject ? v : ctx.obj(v));
    }
    const ref = ctx.register(dict);
    annots.push(ref);
    refs[naam] = ref;
    return ref;
  }
  const meting = (soort) => ctx.obj({
    Type: 'Measure', Subtype: 'RL', R: PDFString.of('1 mm = 100 mm'),
    X: [ctx.obj({ Type: 'NumberFormat', U: PDFString.of('mm'), C: 35.28, D: 1, F: 'D' })],
    D: [ctx.obj({ Type: 'NumberFormat', U: PDFString.of('mm'), C: 1, D: 1, F: 'D' })],
    A: [ctx.obj({ Type: 'NumberFormat', U: PDFHexString.fromText('mm²'), C: 1, D: 1, F: 'D' })],
    ...(soort ? { XYZ_Soort: soort } : {}),
  });
  const da = PDFString.of('/Helv 12 Tf 1 0 0 rg');
  const ds = PDFString.of('font: Helvetica,sans-serif 12.0pt; text-align:left; color:#FF0000');

  voeg('nm-notitie', 'Text', [40, 780, 60, 800], { Name: 'Comment', Open: false, AP: ap([0, 0, 20, 20]) });
  voeg('nm-popup', 'Popup', [70, 700, 250, 800], { Parent: refs['nm-notitie'], Open: false });
  ctx.lookup(refs['nm-notitie']).set(N('Popup'), refs['nm-popup']);
  voeg('nm-tekstvak', 'FreeText', [40, 700, 200, 740], {
    DA: da, DS: ds, RC: PDFHexString.fromText(RC), Q: 0, AP: ap([0, 0, 160, 40]), OC: ocg, IC: [1, 1, 0.8],
  });
  voeg('nm-aanwijzer', 'FreeText', [290, 640, 520, 720], {
    IT: 'FreeTextCallout', DA: da, DS: ds, RC: PDFHexString.fromText(RC), CL: [300, 650, 340, 690, 360, 690],
    LE: 'OpenArrow', RD: [60, 5, 5, 5], AP: ap([0, 0, 230, 80]),
  }, { contents: 'letterlijk' });
  voeg('nm-typemachine', 'FreeText', [40, 600, 240, 620], {
    IT: 'FreeTextTypeWriter', DA: da, BS: ctx.obj({ W: 0 }), AP: ap([0, 0, 200, 20]),
  });
  voeg('nm-lijn', 'Line', [45, 550, 255, 570], {
    L: [50, 560, 250, 560], LE: ['OpenArrow', 'ClosedArrow'], IC: [0, 1, 0], AP: ap([45, 550, 255, 570]), OC: ocg,
  });
  voeg('nm-maatlijn', 'Line', [45, 505, 255, 535], {
    IT: 'LineDimension', L: [50, 520, 250, 520], LE: ['OpenArrow', 'OpenArrow'], LL: 10, LLE: 3, Cap: true, CP: 'Top',
    Measure: meting('lengte'), AP: ap([45, 505, 255, 535]),
  });
  voeg('nm-rechthoek', 'Square', [300, 520, 400, 600], { BE: wolk(), IC: [0.9, 0.9, 0.2], RD: [5, 5, 5, 5], AP: ap([0, 0, 100, 80]) });
  voeg('nm-ellips', 'Circle', [420, 520, 520, 600], { IC: [0.2, 0.9, 0.9], AP: ap([0, 0, 100, 80]) });
  voeg('nm-veelhoek', 'Polygon', [40, 400, 160, 480], { Vertices: [50, 410, 150, 410, 150, 470, 50, 470], IC: [0.5, 0.5, 1], AP: ap([40, 400, 160, 480]) });
  voeg('nm-wolk', 'Polygon', [180, 400, 300, 480], {
    IT: 'PolygonCloud', BE: wolk(), Vertices: [190, 410, 290, 410, 290, 470, 190, 470], AP: ap([180, 400, 300, 480]),
  });
  voeg('nm-meetvlak', 'Polygon', [320, 400, 440, 480], {
    IT: 'PolygonDimension', Vertices: [330, 410, 430, 410, 430, 470, 330, 470], Measure: meting('vlak'), AP: ap([320, 400, 440, 480]),
  });
  voeg('nm-polylijn', 'PolyLine', [40, 320, 200, 380], {
    Vertices: [50, 330, 120, 370, 190, 330], LE: ['None', 'OpenArrow'], AP: ap([40, 320, 200, 380]),
  });
  voeg('nm-meetlijn', 'PolyLine', [220, 320, 400, 380], {
    IT: 'PolyLineDimension', Vertices: [230, 330, 300, 370, 390, 330], Measure: meting('omtrek'), AP: ap([220, 320, 400, 380]),
  });
  const quads = (x, y) => [x, y + 12, x + 100, y + 12, x, y, x + 100, y];
  voeg('nm-markeer', 'Highlight', [40, 280, 140, 292], { QuadPoints: quads(40, 280), AP: ap([40, 280, 140, 292]) });
  voeg('nm-onderstreep', 'Underline', [160, 280, 260, 292], { QuadPoints: quads(160, 280), AP: ap([160, 280, 260, 292]) });
  voeg('nm-doorhaal', 'StrikeOut', [280, 280, 380, 292], { QuadPoints: quads(280, 280), AP: ap([280, 280, 380, 292]) });
  voeg('nm-golf', 'Squiggly', [400, 280, 500, 292], { QuadPoints: quads(400, 280), AP: ap([400, 280, 500, 292]) });
  voeg('nm-stempel', 'Stamp', [40, 200, 160, 250], { Name: 'Approved', AP: ap([0, 0, 120, 50], '0 1 0 rg 0 0 120 50 re f') });
  voeg('nm-invoeg', 'Caret', [180, 200, 200, 220], { RD: [1, 1, 1, 1], Sy: 'P', AP: ap([0, 0, 20, 20]) });
  voeg('nm-inkt', 'Ink', [220, 200, 320, 260], { InkList: [[230, 210, 260, 250, 300, 220], [240, 240, 310, 250]], AP: ap([220, 200, 320, 260]) });
  const bijlage = ctx.register(ctx.stream('inhoud € van de bijlage', { Type: 'EmbeddedFile', Subtype: N('text#2Fplain') }));
  voeg('nm-bijlage', 'FileAttachment', [340, 220, 360, 240], {
    FS: ctx.obj({ Type: 'Filespec', F: PDFString.of('spec.txt'), UF: PDFHexString.fromText('spéc €.txt'), EF: ctx.obj({ F: bijlage }) }),
    Name: 'PushPin', AP: ap([0, 0, 20, 20]),
  });
  const geluid = ctx.register(ctx.stream(new Uint8Array([128, 130, 126, 128]), { Type: 'Sound', R: 8000, C: 1, B: 8, E: 'Raw' }));
  voeg('nm-geluid', 'Sound', [380, 220, 400, 240], { Sound: geluid, Name: 'Speaker', AP: ap([0, 0, 20, 20]) });
  // Alleen tekst in het bestand, geen verzoek; in stukken, zodat de scan op
  // adressen van andere hosts (core/webfuncties.test.mjs) hem niet meetelt.
  voeg('nm-koppeling', 'Link', [420, 220, 520, 240], {
    A: ctx.obj({ S: 'URI', URI: PDFString.of(`${'https:'}//example.org/plan?a=1&b=\\(2`) }), Border: [0, 0, 0], H: 'I', BS: undefined,
  });
  voeg('nm-weglakken', 'Redact', [40, 140, 140, 160], {
    QuadPoints: [40, 160, 140, 160, 40, 140, 140, 140], IC: [0, 0, 0], OverlayText: PDFHexString.fromText('VERWIJDERD € (2'), Repeat: false,
  });
  // Boog en gebogen aanwijzer van een ander programma: Ink en PolyLine met eigen sleutels.
  voeg('nm-xyz-boog', 'Ink', [160, 120, 260, 180], {
    InkList: [[170, 130, 190, 160, 220, 172, 250, 160]], IT: 'XYZ_Arc',
    XYZ_ArcData: ctx.obj({ Center: [210, 130], Radius: 40, Start: 0, Sweep: 180 }), AP: ap([160, 120, 260, 180]),
  });
  voeg('nm-xyz-boogaanwijzer', 'PolyLine', [280, 120, 400, 180], {
    Vertices: [290, 130, 320, 170, 360, 175, 390, 150], LE: ['None', 'ClosedArrow'],
    XYZ_Curve: ctx.obj({ Ctrl: [[290, 130], [320, 190], [390, 150]], Tension: 0.5 }), AP: ap([280, 120, 400, 180]),
  });
  // Antwoord, groep, statusantwoorden (Review twee keer, Marked).
  voeg('nm-antwoord', 'Text', [300, 580, 320, 600], { IRT: refs['nm-rechthoek'], RT: 'R', Name: 'Comment', AP: ap([0, 0, 20, 20]) }, { contents: 'letterlijk' });
  voeg('nm-groepskind', 'Square', [430, 530, 470, 560], { IRT: refs['nm-ellips'], RT: 'Group', AP: ap([0, 0, 40, 30]) });
  voeg('nm-status-1', 'Text', [40, 700, 60, 720], {
    IRT: refs['nm-tekstvak'], State: PDFString.of('Accepted'), StateModel: PDFString.of('Review'), F: 30,
    T: PDFHexString.fromText('Piet (controle'), M: PDFString.of('D:20260116080000Z'),
  });
  voeg('nm-status-2', 'Text', [40, 700, 60, 720], {
    IRT: refs['nm-tekstvak'], State: PDFString.of('Completed'), StateModel: PDFString.of('Review'), F: 30,
    M: PDFString.of('D:20260117080000Z'),
  });
  voeg('nm-gemarkeerd', 'Text', [45, 550, 65, 570], {
    IRT: refs['nm-lijn'], State: PDFString.of('Marked'), StateModel: PDFString.of('Marked'), F: 30,
  });
  return new Uint8Array(await doc.save());
}

// ── ontleed vergelijken ────────────────────────────────────────────────────

const hex = (bytes) => Buffer.from(bytes).toString('hex');

/** De annotaties van blad 1: /NM -> woordenboek, met het document erbij. */
export async function annotaties(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const pagina = doc.getPage(0);
  const lijst = pagina.node.Annots()?.asArray() || [];
  const perNaam = new Map();
  const naamVanRef = new Map();
  for (const ref of lijst) {
    const d = ctx.lookup(ref);
    const nm = d.get(N('NM'));
    const naam = nm ? nm.decodeText() : `zonder-naam-${perNaam.size}`;
    assert.ok(!perNaam.has(naam), `/NM ${naam} komt maar één keer voor`);
    perNaam.set(naam, d);
    naamVanRef.set(ref.toString(), naam);
  }
  return { doc, ctx, pagina, perNaam, naamVanRef, aantal: lijst.length };
}

/** Een PDF-waarde als gewone JSON, verwijzingen opgevolgd (zie de kop). */
export function ontleed(w, a, pad = []) {
  if (w instanceof PDFRef) {
    const s = w.toString();
    if (a.naamVanRef.has(s)) return { annotatie: a.naamVanRef.get(s) };
    if (a.pagina.ref.toString() === s) return 'pagina';
    if (pad.includes(s)) return { kring: true };
    return ontleed(a.ctx.lookup(w), a, [...pad, s]);
  }
  if (w === undefined || w === null || w === PDFNull) return null;
  if (w instanceof PDFNumber) return w.asNumber();
  if (w instanceof PDFBool) return w.asBoolean();
  if (w instanceof PDFName) return `/${w.decodeText()}`;
  if (w instanceof PDFString || w instanceof PDFHexString) return { tekst: hex(w.asBytes()) };
  if (w instanceof PDFArray) return w.asArray().map((v) => ontleed(v, a, pad));
  if (w instanceof PDFDict) {
    const uit = {};
    for (const [k, v] of w.entries()) uit[k.decodeText()] = ontleed(v, a, pad);
    return Object.fromEntries(Object.entries(uit).sort(([x], [y]) => (x < y ? -1 : 1)));
  }
  if (w instanceof PDFStream) {
    const d = ontleed(w.dict, a, pad);
    delete d.Length;
    return { stroom: d, bytes: hex(w.getContents()) };
  }
  return String(w);
}

export const ontleedAlle = (a) => new Map([...a.perNaam].map(([naam, d]) => [naam, ontleed(d, a)]));
