// Demo-PDF's voor de README-schermafbeeldingen (scripts/generate-readme-screenshots.mjs).
//
// Alles wordt hier met pdf-lib getekend, zodat de beelden geen tekening van
// een klant of project bevatten en vrij te verspreiden zijn:
//  - een eenvoudige plattegrond (A3 liggend, schaal 1:50) met wanden, deuren,
//    ramen, maatvoering, stramien, ruimtenamen en een titelblok, plus een
//    /VP-viewport met /Measure, zodat de app de meetschaal meteen kent;
//  - revisie B van dezelfde plattegrond (een verschoven wand, een extra raam,
//    een andere ruimtenaam) voor de vergelijking;
//  - een set van zes pagina's: voorblad, twee plattegronden en drie
//    tekstpagina's (bestek), voor miniaturen, pagina's ordenen en zoeken.

import { PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts, rgb, degrees } from 'pdf-lib';

const A3 = [1190.55, 841.89];
const A4 = [595.28, 841.89];
// 1:50 → 1 m = 20 mm op papier = 56.693 pt.
const PT_PER_M = (1000 / 50) * (72 / 25.4);
const OORSPRONG = { x: 90, y: 150 };

const ZWART = rgb(0, 0, 0);
const GRIJS = rgb(0.55, 0.55, 0.55);
const WANDGRIJS = rgb(0.72, 0.72, 0.72);
const LICHT = rgb(0.93, 0.93, 0.93);

const px = (m) => OORSPRONG.x + m * PT_PER_M;
const py = (m) => OORSPRONG.y + m * PT_PER_M;

/** Rechthoek in meters (x0, y0)–(x1, y1), gevuld als wand. */
function wand(p, x0, y0, x1, y1) {
  p.drawRectangle({
    x: px(Math.min(x0, x1)), y: py(Math.min(y0, y1)),
    width: Math.abs(x1 - x0) * PT_PER_M, height: Math.abs(y1 - y0) * PT_PER_M,
    color: WANDGRIJS, borderColor: ZWART, borderWidth: 0.8,
  });
}

function lijn(p, x0, y0, x1, y1, dikte = 0.5, kleur = ZWART, dash) {
  p.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: dikte, color: kleur, dashArray: dash });
}

/**
 * Deur: een opening in een wand (wit vlak over de wand), het deurblad en de
 * draaicirkel. `as` 'h' = in een horizontale wand, 'v' = in een verticale.
 */
function deur(p, as, x, y, breedte, wanddikte, richting = 1) {
  const b = breedte * PT_PER_M;
  const d = wanddikte * PT_PER_M;
  if (as === 'h') {
    p.drawRectangle({ x: px(x), y: py(y) - 0.4, width: b, height: d + 0.8, color: rgb(1, 1, 1) });
    const scharnier = { x: px(x), y: richting > 0 ? py(y) + d : py(y) };
    lijn(p, scharnier.x, scharnier.y, scharnier.x, scharnier.y + richting * b, 0.9);
    p.drawSvgPath(`M ${b} 0 A ${b} ${b} 0 0 ${richting > 0 ? 0 : 1} 0 ${-richting * b}`, {
      x: scharnier.x, y: scharnier.y, borderColor: ZWART, borderWidth: 0.4,
    });
  } else {
    p.drawRectangle({ x: px(x) - 0.4, y: py(y), width: d + 0.8, height: b, color: rgb(1, 1, 1) });
    const scharnier = { x: richting > 0 ? px(x) + d : px(x), y: py(y) };
    lijn(p, scharnier.x, scharnier.y, scharnier.x + richting * b, scharnier.y, 0.9);
    p.drawSvgPath(`M 0 ${-b} A ${b} ${b} 0 0 ${richting > 0 ? 1 : 0} ${richting * b} 0`, {
      x: scharnier.x, y: scharnier.y, borderColor: ZWART, borderWidth: 0.4,
    });
  }
}

/** Raam in een buitenwand: wit vlak met drie lijnen. */
function raam(p, as, x, y, lengte, wanddikte) {
  const l = lengte * PT_PER_M;
  const d = wanddikte * PT_PER_M;
  if (as === 'h') {
    p.drawRectangle({ x: px(x), y: py(y), width: l, height: d, color: rgb(1, 1, 1), borderColor: ZWART, borderWidth: 0.6 });
    for (const f of [0.35, 0.5, 0.65]) lijn(p, px(x), py(y) + d * f, px(x) + l, py(y) + d * f, 0.4);
  } else {
    p.drawRectangle({ x: px(x), y: py(y), width: d, height: l, color: rgb(1, 1, 1), borderColor: ZWART, borderWidth: 0.6 });
    for (const f of [0.35, 0.5, 0.65]) lijn(p, px(x) + d * f, py(y), px(x) + d * f, py(y) + l, 0.4);
  }
}

/** Maatlijn tussen twee punten in meters, met tekst in millimeters. */
function maat(p, font, as, a, b, vast, opschrift) {
  const tik = 4;
  if (as === 'h') {
    const y = py(vast);
    lijn(p, px(a), y, px(b), y, 0.4);
    for (const m of [a, b]) lijn(p, px(m) - tik, y - tik, px(m) + tik, y + tik, 0.7);
    const t = opschrift ?? String(Math.round((b - a) * 1000));
    const w = font.widthOfTextAtSize(t, 8);
    p.drawText(t, { x: (px(a) + px(b)) / 2 - w / 2, y: y + 3, size: 8, font });
  } else {
    const x = px(vast);
    lijn(p, x, py(a), x, py(b), 0.4);
    for (const m of [a, b]) lijn(p, x - tik, py(m) - tik, x + tik, py(m) + tik, 0.7);
    const t = opschrift ?? String(Math.round((b - a) * 1000));
    const w = font.widthOfTextAtSize(t, 8);
    p.drawText(t, { x: x - 3, y: (py(a) + py(b)) / 2 - w / 2, size: 8, font, rotate: degrees(90) });
  }
}

function ruimte(p, font, vet, naam, x0, y0, x1, y1) {
  const opp = ((x1 - x0) * (y1 - y0)).toFixed(1);
  const cx = (px(x0) + px(x1)) / 2;
  const cy = (py(y0) + py(y1)) / 2;
  const w1 = vet.widthOfTextAtSize(naam, 11);
  const t2 = `${opp} m²`.replace('²', '2');
  const w2 = font.widthOfTextAtSize(t2, 9);
  p.drawText(naam, { x: cx - w1 / 2, y: cy + 2, size: 11, font: vet });
  p.drawText(t2, { x: cx - w2 / 2, y: cy - 11, size: 9, font });
}

function stramien(p, font, xs, ys, xmax, ymax) {
  const r = 9;
  xs.forEach((x, i) => {
    const label = String.fromCharCode(65 + i);
    lijn(p, px(x), py(-1.2), px(x), py(ymax + 1.0), 0.3, GRIJS, [8, 3, 2, 3]);
    p.drawCircle({ x: px(x), y: py(ymax + 1.0) + r, size: r, borderColor: ZWART, borderWidth: 0.6 });
    const w = font.widthOfTextAtSize(label, 10);
    p.drawText(label, { x: px(x) - w / 2, y: py(ymax + 1.0) + r - 3.5, size: 10, font });
  });
  ys.forEach((y, i) => {
    const label = String(i + 1);
    lijn(p, px(-1.6), py(y), px(xmax + 0.8), py(y), 0.3, GRIJS, [8, 3, 2, 3]);
    p.drawCircle({ x: px(-1.6) - r, y: py(y), size: r, borderColor: ZWART, borderWidth: 0.6 });
    const w = font.widthOfTextAtSize(label, 10);
    p.drawText(label, { x: px(-1.6) - r - w / 2, y: py(y) - 3.5, size: 10, font });
  });
}

function noordpijl(p, font, x, y) {
  p.drawCircle({ x, y, size: 18, borderColor: ZWART, borderWidth: 0.6 });
  p.drawSvgPath('M 0 -16 L 7 10 L 0 4 L -7 10 Z', { x, y, color: ZWART });
  p.drawText('N', { x: x - 3.5, y: y + 22, size: 10, font });
}

/** Titelblok rechtsonder. */
function titelblok(p, font, vet, { tekening, schaal, blad, revisie, datum }) {
  const [W] = A3;
  const b = 300;
  const x = W - 20 - b;
  const y = 20;
  const rijen = [
    ['Project', 'Demo house (example drawing)'],
    ['Drawing', tekening],
    ['Scale', schaal],
    ['Sheet', blad],
    ['Revision', revisie],
    ['Date', datum],
  ];
  const h = 18;
  const kop = 30;
  p.drawRectangle({ x, y, width: b, height: kop + rijen.length * h, borderColor: ZWART, borderWidth: 1.2 });
  p.drawRectangle({ x, y: y + rijen.length * h, width: b, height: kop, color: LICHT, borderColor: ZWART, borderWidth: 1.2 });
  p.drawText('OPEN PDF STUDIO', { x: x + 10, y: y + rijen.length * h + 17, size: 11, font: vet });
  p.drawText('Generated demo drawing, free to redistribute', { x: x + 10, y: y + rijen.length * h + 6, size: 7, font });
  rijen.forEach(([k, v], i) => {
    const ry = y + (rijen.length - 1 - i) * h;
    lijn(p, x, ry + h, x + b, ry + h, 0.4);
    lijn(p, x + 70, ry, x + 70, ry + h, 0.4);
    p.drawText(k, { x: x + 6, y: ry + 6, size: 8, font });
    p.drawText(v, { x: x + 76, y: ry + 6, size: 9, font: vet });
  });
}

function kader(p) {
  const [W, H] = A3;
  p.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: ZWART, borderWidth: 1.4 });
}

/** /VP met /Measure (ISO 32000 12.9): meetschaal 1:50 in meters. */
function zetViewport(doc, p, bbox) {
  const ctx = doc.context;
  const getal = (u, c) => ctx.obj({ Type: 'NumberFormat', U: PDFString.of(u), C: PDFNumber.of(c), D: 100 });
  const meet = ctx.obj({
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFString.of('1:50'),
    X: [getal('m', 1 / PT_PER_M)],
    D: [getal('m', 1)],
    A: [getal('sq m', 1)],
  });
  const vp = ctx.obj({ Type: 'Viewport', BBox: bbox, Name: PDFString.of('Plan 1:50'), Measure: meet });
  p.node.set(PDFName.of('VP'), ctx.obj([vp]));
}

/**
 * Teken een plattegrond op een nieuwe A3-pagina.
 * @param {'A'|'B'} revisie  B verschuift de wand tussen slaapkamer en badkamer,
 *   voegt een raam toe en hernoemt het kantoor.
 * @param {'ground'|'first'} verdieping
 */
async function plattegrond(doc, font, vet, { revisie = 'A', verdieping = 'ground' } = {}) {
  const p = doc.addPage(A3);
  kader(p);
  const L = 14;
  const B = 9;
  const t = 0.3;
  const tb = 0.1;
  const wandX = revisie === 'B' ? 10.1 : 9.5;

  // Buitenwanden.
  wand(p, 0, 0, L, t);
  wand(p, 0, B - t, L, B);
  wand(p, 0, 0, t, B);
  wand(p, L - t, 0, L, B);
  // Binnenwanden.
  wand(p, 5, t, 5 + tb, B - t);
  wand(p, 5 + tb, 5, L - t, 5 + tb);
  wand(p, wandX, 5 + tb, wandX + tb, B - t);
  wand(p, t, 5.5, 5, 5.5 + tb);

  // Deuren.
  deur(p, 'h', 2.0, 0, 1.0, t, 1); // voordeur
  deur(p, 'v', 5, 2.2, 0.9, tb, 1);
  deur(p, 'h', 6.0, 5, 0.9, tb, 1);
  deur(p, 'h', wandX + 0.6, 5, 0.8, tb, 1);
  deur(p, 'h', 3.2, 5.5, 0.9, tb, 1);

  // Ramen.
  raam(p, 'h', 0.9, 0, 0.8, t);
  raam(p, 'h', 3.4, 0, 1.2, t);
  raam(p, 'h', 7.0, 0, 2.4, t);
  raam(p, 'h', 10.6, 0, 2.4, t);
  raam(p, 'h', 1.2, B - t, 2.2, t);
  raam(p, 'h', 6.2, B - t, 2.0, t);
  if (revisie === 'B') raam(p, 'h', 11.4, B - t, 1.4, t);
  raam(p, 'v', 0, 2.0, 2.0, t);
  raam(p, 'v', L - t, 6.2, 1.6, t);

  // Ruimten.
  const kantoor = revisie === 'B' ? 'Studio' : 'Office';
  if (verdieping === 'ground') {
    ruimte(p, font, vet, 'Living room', t, t, 5, 5.5);
    ruimte(p, font, vet, 'Kitchen', t, 5.6, 5, B - t);
    ruimte(p, font, vet, kantoor, 5.1, t, L - t, 5);
    ruimte(p, font, vet, 'Bedroom', 5.1, 5.1, wandX, B - t);
    ruimte(p, font, vet, 'Bathroom', wandX + tb, 5.1, L - t, B - t);
  } else {
    ruimte(p, font, vet, 'Bedroom 2', t, t, 5, 5.5);
    ruimte(p, font, vet, 'Landing', t, 5.6, 5, B - t);
    ruimte(p, font, vet, 'Bedroom 3', 5.1, t, L - t, 5);
    ruimte(p, font, vet, 'Storage', 5.1, 5.1, wandX, B - t);
    ruimte(p, font, vet, 'Bathroom 2', wandX + tb, 5.1, L - t, B - t);
  }

  // Keukenblok en sanitair als eenvoudige lijnen.
  if (verdieping === 'ground') {
    p.drawRectangle({ x: px(t), y: py(B - t - 0.6), width: 4.2 * PT_PER_M, height: 0.6 * PT_PER_M, borderColor: ZWART, borderWidth: 0.5 });
    p.drawRectangle({ x: px(L - t - 1.8), y: py(B - t - 0.9), width: 1.8 * PT_PER_M, height: 0.9 * PT_PER_M, borderColor: ZWART, borderWidth: 0.5 });
    p.drawEllipse({ x: px(L - t - 0.9), y: py(B - t - 0.45), xScale: 0.7 * PT_PER_M, yScale: 0.3 * PT_PER_M, borderColor: ZWART, borderWidth: 0.4 });
  }

  // Stramien en maatvoering.
  stramien(p, font, [0, 5.05, wandX + 0.05, L], [0, 5.05, B], L, B);
  maat(p, font, 'h', 0, 5.05, -0.7);
  maat(p, font, 'h', 5.05, wandX + 0.05, -0.7);
  maat(p, font, 'h', wandX + 0.05, L, -0.7);
  maat(p, font, 'h', 0, L, -1.2);
  maat(p, font, 'v', 0, 5.05, L + 0.5);
  maat(p, font, 'v', 5.05, B, L + 0.5);
  maat(p, font, 'v', 0, B, L + 1.0);

  noordpijl(p, font, A3[0] - 80, A3[1] - 90);
  const titel = verdieping === 'ground' ? 'Ground floor plan' : 'First floor plan';
  p.drawText(`${titel.toUpperCase()}  1:50`, { x: px(0), y: py(B + 1.9), size: 14, font: vet });
  titelblok(p, font, vet, {
    tekening: titel,
    schaal: '1:50 (A3)',
    blad: verdieping === 'ground' ? 'A-101' : 'A-102',
    revisie: revisie === 'B' ? 'B - wall moved, window added' : 'A - first issue',
    datum: revisie === 'B' ? '2026-11-02' : '2026-10-19',
  });
  // De viewport dekt het gebouw; daarbuiten (tekstballonnen, titelblok) geldt geen meetschaal.
  zetViewport(doc, p, [px(0), py(0), px(L), py(B)]);
  return p;
}

const BESTEK = [
  ['1. General', [
    'This specification belongs to the demo drawings A-101 and A-102. It is example text, written to show',
    'how the application handles a document with several pages, headings and running text.',
    'All dimensions are in millimetres unless stated otherwise. Check dimensions on site before',
    'ordering materials. Report any difference between drawing and site to the architect.',
  ]],
  ['2. Walls', [
    'External walls: cavity wall, 300 mm overall. Inner leaf 100 mm calcium silicate, 100 mm insulation,',
    'outer leaf 100 mm facing brick. Internal walls: 100 mm, plastered on both sides.',
    'The wall between bedroom and bathroom is moved in revision B to make the bathroom wider.',
  ]],
  ['3. Doors and windows', [
    'Front door: timber, 1000 mm wide, with a threshold of at most 20 mm. Internal doors: 900 mm,',
    'bathroom door 800 mm. Windows: timber frames with insulating glass, opening inward.',
    'Revision B adds a window to the bathroom on the north side.',
  ]],
  ['4. Finishes', [
    'Floors: screed with floor heating. Walls: plaster, ready for paint. Ceilings: plasterboard.',
    'Bathroom: tiles on walls up to the ceiling and on the floor.',
  ]],
  ['5. Building services', [
    'Electrical installation to the current standard. One socket group per room, two in the kitchen.',
    'Ventilation: balanced system with heat recovery. Extract points in kitchen and bathroom.',
    'Heating: heat pump with floor heating in all rooms on the ground floor.',
  ]],
  ['6. Quantities', [
    'Quantities on the drawings are measured with the measuring tools of the application, using the',
    'scale that the drawing carries. Doors, windows and sockets are counted with the count tool.',
  ]],
];

function tekstpagina(doc, font, vet, paginaNr, delen) {
  const p = doc.addPage(A4);
  let y = A4[1] - 70;
  p.drawText('Specification - demo house', { x: 60, y: A4[1] - 40, size: 9, font, color: GRIJS });
  p.drawText(`Page ${paginaNr}`, { x: A4[0] - 100, y: 40, size: 9, font, color: GRIJS });
  lijn(p, 60, A4[1] - 48, A4[0] - 60, A4[1] - 48, 0.5, GRIJS);
  for (const [kop, regels] of delen) {
    p.drawText(kop, { x: 60, y, size: 14, font: vet });
    y -= 22;
    for (const r of regels) {
      p.drawText(r, { x: 60, y, size: 10, font });
      y -= 15;
    }
    y -= 14;
  }
  return p;
}

function voorblad(doc, font, vet) {
  const p = doc.addPage(A4);
  p.drawRectangle({ x: 0, y: A4[1] - 300, width: A4[0], height: 300, color: rgb(0.16, 0.18, 0.22) });
  p.drawText('Demo house', { x: 60, y: A4[1] - 160, size: 40, font: vet, color: rgb(1, 1, 1) });
  p.drawText('Drawings and specification', { x: 60, y: A4[1] - 200, size: 18, font, color: rgb(0.85, 0.85, 0.85) });
  p.drawText('Example document for the Open PDF Studio README', { x: 60, y: 120, size: 11, font, color: GRIJS });
  p.drawText('Generated by scripts/generate-readme-screenshots.mjs', { x: 60, y: 102, size: 9, font, color: GRIJS });
  // Eenvoudige gevelschets.
  const x = 150; const y = 260;
  p.drawRectangle({ x, y, width: 300, height: 160, borderColor: ZWART, borderWidth: 1.5 });
  p.drawSvgPath('M 0 0 L 150 -90 L 300 0', { x, y: y + 160, borderColor: ZWART, borderWidth: 1.5 });
  for (const wx of [30, 120, 210]) p.drawRectangle({ x: x + wx, y: y + 70, width: 60, height: 60, borderColor: ZWART, borderWidth: 1 });
  p.drawRectangle({ x: x + 130, y, width: 40, height: 55, borderColor: ZWART, borderWidth: 1 });
  return p;
}

async function nieuwDoc(titel) {
  const doc = await PDFDocument.create();
  doc.setTitle(titel);
  doc.setAuthor('Open PDF Studio demo');
  doc.setCreator('scripts/readme-demo-pdfs.mjs');
  doc.setProducer('pdf-lib');
  // Vaste datums: dezelfde invoer geeft dezelfde bestanden.
  doc.setCreationDate(new Date('2026-10-19T09:00:00Z'));
  doc.setModificationDate(new Date('2026-10-19T09:00:00Z'));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const vet = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, vet };
}

/** @returns {Promise<{ [naam: string]: Uint8Array }>} */
export async function maakDemoPdfs() {
  const uit = {};
  {
    const { doc, font, vet } = await nieuwDoc('Ground floor plan, revision A');
    await plattegrond(doc, font, vet, { revisie: 'A' });
    uit['floor-plan-rev-a.pdf'] = await doc.save({ useObjectStreams: false });
  }
  {
    const { doc, font, vet } = await nieuwDoc('Ground floor plan, revision B');
    await plattegrond(doc, font, vet, { revisie: 'B' });
    uit['floor-plan-rev-b.pdf'] = await doc.save({ useObjectStreams: false });
  }
  {
    const { doc, font, vet } = await nieuwDoc('Demo house - drawings and specification');
    voorblad(doc, font, vet);
    await plattegrond(doc, font, vet, { revisie: 'A', verdieping: 'ground' });
    await plattegrond(doc, font, vet, { revisie: 'A', verdieping: 'first' });
    tekstpagina(doc, font, vet, 4, BESTEK.slice(0, 2));
    tekstpagina(doc, font, vet, 5, BESTEK.slice(2, 4));
    tekstpagina(doc, font, vet, 6, BESTEK.slice(4));
    uit['demo-house-set.pdf'] = await doc.save({ useObjectStreams: false });
  }
  return uit;
}
