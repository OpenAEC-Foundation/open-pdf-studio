// Testhulp voor incrementeel opslaan (#679): handgemaakte PDF's met een
// bekende xref-vorm, en twee onafhankelijke lezers (pdf.js en MuPDF; qpdf als
// het geïnstalleerd is). Geen *.test.mjs: dit bestand bevat zelf geen tests.

import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { bereidIncrementeelVoor, bouwIncrementeleUpdate } from './incrementeel.js';

const enc = (s) => Buffer.from(s, 'latin1');

/**
 * Een kleine PDF met een bekende xref-vorm.
 * - 'tabel': klassieke xref-tabel
 * - 'stroom': xref-stroom; het lettertype staat in een objectstroom
 * - 'hybride': klassieke tabel met /XRefStm naar een xref-stroom voor het
 *   lettertype in een objectstroom (§7.5.8.4)
 * `voorspeller`: de xref-stroom met /Predictor 12 (PNG Up), zoals veel
 * schrijvers het doen.
 */
export function handgemaakt({ vorm = 'tabel', voorspeller = false } = {}) {
  const inhoud = 'BT /F1 18 Tf 20 100 Td (Hallo) Tj ET';
  const plat = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    4: `<< /Length ${inhoud.length} >>\nstream\n${inhoud}\nendstream`,
  };
  const font = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const delen = [enc('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  let lengte = delen[0].length;
  const offsets = {};
  const voeg = (b) => { delen.push(b); lengte += b.length; };
  const schrijf = (n, body) => { offsets[n] = lengte; voeg(enc(`${n} 0 obj\n${body}\nendobj\n`)); };
  for (const n of [1, 2, 3, 4]) schrijf(n, plat[n]);
  if (vorm === 'tabel') schrijf(5, font);
  const objstm = () => {
    const kop = '5 0 ';
    const data = kop + font;
    schrijf(6, `<< /Type /ObjStm /N 1 /First ${kop.length} /Length ${data.length} >>\nstream\n${data}\nendstream`);
  };
  const xrefStroom = (nummer, regels, extra) => {
    // regels: [[num, soort, v2, v3]]
    regels.sort((a, b) => a[0] - b[0]);
    const rij = (s, v2, v3) => [s, (v2 >>> 24) & 255, (v2 >>> 16) & 255, (v2 >>> 8) & 255, v2 & 255, (v3 >> 8) & 255, v3 & 255];
    const rijen = regels.map(([, s, v2, v3]) => rij(s, v2, v3));
    let ruw;
    if (voorspeller) {
      const uit = [];
      let vorige = new Array(7).fill(0);
      for (const r of rijen) { uit.push(2, ...r.map((x, i) => (x - vorige[i] + 256) & 255)); vorige = r; }
      ruw = Buffer.from(uit);
    } else ruw = Buffer.from(rijen.flat());
    const data = deflateSync(ruw);
    const index = [];
    let start = null; let vorigeN = null; let tel = 0;
    for (const [n] of regels) {
      if (start === null) { start = n; tel = 1; } else if (n === vorigeN + 1) tel++; else { index.push(start, tel); start = n; tel = 1; }
      vorigeN = n;
    }
    index.push(start, tel);
    const parms = voorspeller ? ' /DecodeParms << /Predictor 12 /Columns 7 >>' : '';
    offsets[nummer] = lengte;
    voeg(enc(`${nummer} 0 obj\n<< /Type /XRef /W [1 4 2] /Index [${index.join(' ')}] /Filter /FlateDecode${parms} /Length ${data.length}${extra} >>\nstream\n`));
    voeg(data);
    voeg(enc('\nendstream\nendobj\n'));
  };
  if (vorm === 'stroom') {
    objstm();
    const nummer = 7;
    const start = lengte;
    xrefStroom(nummer, [[0, 0, 0, 65535], [1, 1, offsets[1], 0], [2, 1, offsets[2], 0], [3, 1, offsets[3], 0],
      [4, 1, offsets[4], 0], [5, 2, 6, 0], [6, 1, offsets[6], 0], [7, 1, lengte, 0]], ' /Size 8 /Root 1 0 R');
    voeg(enc(`startxref\n${start}\n%%EOF\n`));
  } else if (vorm === 'hybride') {
    objstm();
    const stm = lengte;
    xrefStroom(7, [[5, 2, 6, 0], [7, 1, stm, 0]], ' /Size 8');
    const xref = lengte;
    let t = 'xref\n0 5\n0000000000 65535 f\r\n';
    for (const n of [1, 2, 3, 4]) t += `${String(offsets[n]).padStart(10, '0')} 00000 n\r\n`;
    t += `6 1\n${String(offsets[6]).padStart(10, '0')} 00000 n\r\n`;
    t += `trailer\n<< /Size 8 /Root 1 0 R /XRefStm ${stm} >>\nstartxref\n${xref}\n%%EOF\n`;
    voeg(enc(t));
  } else {
    const xref = lengte;
    let t = 'xref\n0 6\n0000000000 65535 f\r\n';
    for (const n of [1, 2, 3, 4, 5]) t += `${String(offsets[n]).padStart(10, '0')} 00000 n\r\n`;
    t += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    voeg(enc(t));
  }
  return new Uint8Array(Buffer.concat(delen));
}

/** Laden zoals de saver dat in incrementele modus doet, bewerken, toevoeging bouwen. */
export async function bewerk(bytes, wijzig, opties = {}) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ...(opties.laad || {}) });
  const plan = bereidIncrementeelVoor(bytes, doc, opties);
  await wijzig(doc);
  await doc.flush();
  return { ...bouwIncrementeleUpdate(plan, doc), plan, doc };
}

/** Een tekstnotitie op blad 1 erbij. */
export function voegNotitieToe(doc, tekst = 'notitie') {
  const page = doc.getPage(0);
  const a = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of(tekst),
  }));
  const annots = page.node.Annots();
  if (annots) annots.push(a); else page.node.set(PDFName.of('Annots'), doc.context.obj([a]));
  return a;
}

/** Wat pdf.js op blad 1 ziet. */
export async function pdfjsLees(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const pagina = await doc.getPage(1);
    const annotaties = await pagina.getAnnotations();
    const tekst = (await pagina.getTextContent()).items.map((i) => i.str).join('');
    const velden = Object.fromEntries(annotaties.filter((a) => a.fieldName).map((a) => [a.fieldName, a.fieldValue]));
    return { paginas: doc.numPages, annotaties, tekst, velden };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Wat MuPDF ziet; `hersteld` is waar als MuPDF de xref moest reconstrueren. */
export function mupdfLees(bytes) {
  const m = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  const pagina = m.loadPage(0);
  const uit = {
    hersteld: m.wasRepaired(),
    versies: m.countVersions(),
    annotaties: pagina.getAnnotations().map((a) => ({ soort: a.getType(), inhoud: a.getContents() })),
    widgets: pagina.getWidgets().map((w) => ({ naam: w.getName?.(), waarde: w.getValue?.() })),
    tekst: pagina.toStructuredText().asText(),
  };
  return uit;
}

let qpdfPad;
/** `qpdf --check` als qpdf geïnstalleerd is; anders null. */
export function qpdfControle(bytes) {
  if (qpdfPad === undefined) {
    const r = spawnSync('qpdf', ['--version'], { encoding: 'utf8' });
    qpdfPad = r.status === 0 ? 'qpdf' : null;
  }
  if (!qpdfPad) return null;
  const map = mkdtempSync(path.join(tmpdir(), 'opds-incr-'));
  try {
    const bestand = path.join(map, 'in.pdf');
    writeFileSync(bestand, bytes);
    const r = spawnSync(qpdfPad, ['--check', bestand], { encoding: 'utf8' });
    return { status: r.status, uitvoer: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(map, { recursive: true, force: true });
  }
}

export const begintMet = (bytes, voorvoegsel) => bytes.length >= voorvoegsel.length
  && Buffer.from(bytes.buffer, bytes.byteOffset, voorvoegsel.length).equals(Buffer.from(voorvoegsel));
