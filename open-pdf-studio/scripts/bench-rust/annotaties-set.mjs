// Een zware markeringsset om het laden van annotaties te meten (stap 4 in
// docs/rust-stappen.md): N bladen A1 met elk een raster van annotaties van
// veel soorten, geschreven met de echte saver van de app (dus met de eigen
// OPS_-sleutels, appearances, /Measure, antwoorden en statussen), plus per
// blad een paar annotaties zoals een ander programma ze schrijft.
//
// Het bestand wordt één keer gemaakt en in de tijdelijke map bewaard; een
// tweede run gebruikt het opnieuw (sleutel: aantal bladen en per blad).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';

const B = 2384, H = 1684; // A1 liggend

/** De modellen van één blad: een raster van cellen, elke cel één soort. */
export function bladModellen(pagina, perBlad) {
  const basis = {
    page: pagina, rotation: 0, color: '#0000ff', strokeColor: '#0000ff', fillColor: null,
    lineWidth: 1.5, borderStyle: 'solid', opacity: 1, author: 'Tekenaar',
    createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-02T11:30:00.000Z',
  };
  const kolommen = 30;
  const cel = { w: (B - 40) / kolommen, h: 0 };
  const rijen = Math.ceil(perBlad / kolommen);
  cel.h = (H - 40) / rijen;
  const uit = [];
  for (let i = 0; i < perBlad; i++) {
    const x = 20 + (i % kolommen) * cel.w, y = 20 + Math.floor(i / kolommen) * cel.h;
    const w = cel.w * 0.8, h = cel.h * 0.8;
    const id = `p${pagina}-${i}`;
    const b = { ...basis, id, nm: id, subject: `Item ${i}` };
    const soort = i % 22;
    let m;
    switch (soort) {
      case 0: m = { ...b, type: 'box', x, y, width: w, height: h, fillColor: '#ffff00', text: `opmerking ${i}` }; break;
      case 1: m = { ...b, type: 'circle', x, y, width: w, height: h }; break;
      case 2: m = { ...b, type: 'cloud', x, y, width: w, height: h }; break;
      case 3: m = { ...b, type: 'polygon', x, y, width: w, height: h, sides: 6 }; break;
      case 4: m = { ...b, type: 'line', startX: x, startY: y, endX: x + w, endY: y + h }; break;
      case 5: m = { ...b, type: 'arrow', startX: x, startY: y + h, endX: x + w, endY: y, startHead: 'none', endHead: 'closed', headSize: 6 }; break;
      case 6: m = { ...b, type: 'measureDistance', startX: x, startY: y + h / 2, endX: x + w, endY: y + h / 2, measureText: `${(w * 0.3528).toFixed(0)} mm` }; break;
      case 7: m = { ...b, type: 'measureArea', points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], fillColor: '#00ff00', measureText: '1,2 m²' }; break;
      case 8: m = { ...b, type: 'measurePerimeter', points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }], measureText: '3,4 m' }; break;
      case 9: m = { ...b, type: 'count', x: x + w / 2, y: y + h / 2, number: i, categoryId: 'deuren', markerStyle: 'dot', color: '#e11d48', strokeColor: '#e11d48' }; break;
      case 10: m = {
        ...b, type: 'callout', x: x + w * 0.4, y, width: w * 0.6, height: h * 0.5, text: `tip ${i}`, fontSize: 8,
        fontFamily: 'Arial', color: '#000000', strokeColor: '#000000', fillColor: '#FFFFD0', textColor: '#000000',
        arrowX: x, arrowY: y + h, kneeX: x + w * 0.3, kneeY: y + h * 0.25, armOriginX: x + w * 0.4, armOriginY: y + h * 0.25,
      }; break;
      case 11: m = { ...b, type: 'textbox', x, y, width: w, height: h, text: `tekstvak ${i} € ²`, fontSize: 8, fontFamily: 'Arial', textColor: '#000000' }; break;
      case 12: m = { ...b, type: 'stamp', x, y, width: w, height: h * 0.6, stampName: 'Approved' }; break;
      case 13: {
        const path = [];
        for (let k = 0; k < 24; k++) path.push({ x: x + (k / 23) * w, y: y + h / 2 + Math.sin(k / 3) * h * 0.4 });
        m = { ...b, type: 'draw', path };
        break;
      }
      case 14: m = { ...b, type: 'comment', x, y, width: 20, height: 20, text: `notitie ${i}`, icon: 'comment', color: '#ffff00' }; break;
      case 15: m = {
        ...b, type: 'box', x, y, width: w, height: h, status: 'completed', marked: true,
        replies: [{ id: `${id}-r`, author: 'Controleur', text: `antwoord op ${i}`, createdAt: '2026-10-03T08:00:00.000Z' }],
      }; break;
      case 16: m = {
        ...b, type: 'link', x, y, width: w, height: h * 0.4, linkTarget: { kind: 'uri', uri: `https://openaec.org/blad/${pagina}?i=${i}` },
        linkBorder: 'solid', color: '#ff0000', strokeColor: '#ff0000', lineWidth: 1, linkHighlight: 'I',
      }; break;
      case 17: m = {
        ...b, type: 'link', x, y, width: w, height: h * 0.4,
        linkTarget: { kind: 'page', page: 1, fit: 'xyz', left: null, top: null, zoom: null },
        linkBorder: 'underline', color: '#0000ff', strokeColor: '#0000ff', lineWidth: 1, linkHighlight: 'I',
      }; break;
      case 18: m = { ...b, type: 'arc', centerX: x + w / 2, centerY: y + h / 2, radius: Math.min(w, h) / 2, startAngle: 0.3, endAngle: 2.5 }; break;
      case 19: m = {
        ...b, type: 'splineArrow', startHead: 'none', endHead: 'closed', headSize: 6,
        points: [{ x, y: y + h }, { x: x + w / 3, y }, { x: x + 2 * w / 3, y: y + h }, { x: x + w, y }],
      }; break;
      case 20: m = { ...b, type: 'box', x, y, width: w, height: h, hatchPattern: 'diagonal-left', hatchColor: '#ff0000', hatchScale: 100, hatchAngle: 0 }; break;
      default: m = { ...b, type: 'circle', x, y, width: w, height: h, rotation: 30, fillColor: '#00ffff', opacity: 0.5 }; break;
    }
    uit.push(m);
  }
  return uit;
}

/** Een paar annotaties per blad zoals een ander programma ze schrijft. */
function vreemdeAnnotaties(doc, pagina, aantal) {
  const ctx = doc.context;
  const annots = pagina.node.Annots() || ctx.obj([]);
  if (!pagina.node.Annots()) pagina.node.set(PDFName.of('Annots'), annots);
  for (let i = 0; i < aantal; i++) {
    const x = 30 + i * 70, y = H - 60;
    const ap = ctx.register(ctx.stream('/G0 gs 1 0 0 RG 0.9 0.9 0.2 rg 1.5 w 1 1 48 18 re B', {
      Type: 'XObject', Subtype: 'Form', BBox: ctx.obj([0, 0, 50, 20]),
      Resources: ctx.obj({ ExtGState: ctx.obj({ G0: ctx.obj({ ca: 0.3, CA: 1 }) }) }),
    }));
    const kind = i % 3;
    const sub = kind === 0 ? 'Square' : kind === 1 ? 'Polygon' : 'Highlight';
    const dict = ctx.obj({
      Type: 'Annot', Subtype: sub, Rect: [x, y, x + 50, y + 20], F: 4,
      NM: PDFString.of(`ext-${i}`), T: PDFHexString.fromText('Ander programma €'),
      Contents: PDFHexString.fromText(`vreemd ${i} (open`), M: PDFString.of('D:20260101000000Z'),
      C: [1, 0, 0], IC: [0.9, 0.9, 0.2], CA: 1, BS: ctx.obj({ W: 1.5, S: 'D', D: [3, 2] }),
      AP: ctx.obj({ N: ap }), XYZ_Private: ctx.obj([1, ctx.obj([2, 3]), PDFName.of('X')]),
      ...(sub === 'Polygon' ? { Vertices: [x, y, x + 50, y, x + 25, y + 20], IT: PDFName.of('PolygonDimension') } : {}),
      ...(sub === 'Highlight' ? { QuadPoints: [x, y + 20, x + 50, y + 20, x, y, x + 50, y] } : {}),
    });
    annots.push(ctx.register(dict));
  }
}

/**
 * Het bestand met `bladen` bladen en `perBlad` app-annotaties per blad (plus
 * 6 van een ander programma). Bewaard in de tijdelijke map.
 * @param {{ opslaan: Function, state: object }} hulp  rondgang.testhulp.mjs
 */
export async function maakSet(hulp, { bladen = 100, perBlad = 500, vreemd = 6 } = {}) {
  const map = join(tmpdir(), 'opds-annotaties-set');
  mkdirSync(map, { recursive: true });
  const pad = join(map, `set-${bladen}x${perBlad}+${vreemd}.pdf`);
  if (existsSync(pad)) return { pad, bytes: new Uint8Array(readFileSync(pad)) };
  const leeg = await PDFDocument.create();
  for (let p = 0; p < bladen; p++) leeg.addPage([B, H]);
  const leegBytes = await leeg.save();
  const modellen = [];
  for (let p = 1; p <= bladen; p++) modellen.push(...bladModellen(p, perBlad));
  const klaar = new Set(); for (let p = 1; p <= bladen; p++) klaar.add(p);
  const app = await hulp.opslaan(leegBytes, modellen, { document: { _annotationPagesReady: klaar } });
  const doc = await PDFDocument.load(app);
  for (const pagina of doc.getPages()) vreemdeAnnotaties(doc, pagina, vreemd);
  // Zonder objectstromen: elk object los in het bestand, een eenvoudige en
  // vaste opbouw voor de meting.
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(pad, bytes);
  return { pad, bytes };
}
