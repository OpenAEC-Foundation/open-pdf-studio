// Round-trip-test: FreeText/callout-rotatie op pagina's met /Rotate.
//
// Dekt drie zaken (fix voor verticale tekst na opslaan+heropenen op
// /Rotate 90-pagina's):
//  1. SAVER   — de AP-inhoud krijgt op geroteerde pagina's een
//               paginarotatie-compensatie (cm-transform met cos/sin) en er
//               wordt ALTIJD een /OPS_Rotation-sleutel geschreven (ook 0).
//  2. LOADER  — converter respecteert een expliciete /OPS_Rotation 0 en
//               levert visuele rotatie 0 terug (tekst horizontaal).
//  3. HEALING — een door een oudere versie beschadigd bestand (AP zonder
//               rotatie op een /Rotate-pagina, geen /OPS_Rotation) wordt bij
//               laden als visueel-onberoteerd behandeld.
//
// De saver/loader draaien als ECHTE app-code in de browser (web-modus) via
// playwright, net als scripts/test-pdf-text-native-editing.mjs; de
// PDF-inspectie gebeurt in node met pdf-lib + pdfjs-dist (zoals
// scripts/test-status-reply.mjs).
//
// Het script start zijn EIGEN Vite dev-server op poort 3199 (een gedeelde
// server met openstaande HMR-invalidaties geeft dubbele module-instanties
// bij import() vanuit evaluate, waardoor de bytes-cache van de saver leeg
// lijkt).
// Draaien: node scripts/test-freetext-rotation.mjs   (vanuit open-pdf-studio/)

import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { chromium } from 'playwright';

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function startVite() {
  const proc = spawn(process.execPath, [
    join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--port', String(PORT), '--strictPort',
  ], { cwd: projectRoot, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return proc;
    } catch { /* nog niet klaar */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Vite dev-server kwam niet op binnen 30s op poort ${PORT}`);
}

function stopVite(proc) {
  if (!proc) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* al gestopt */ }
}

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Invoer-PDF bouwen: pagina 1 met /Rotate 90, pagina 2 zonder rotatie
// ---------------------------------------------------------------------------
async function buildInputPdf() {
  const pdfDoc = await PDFDocument.create();
  const p1 = pdfDoc.addPage([595, 842]);
  p1.setRotation(degrees(90));
  pdfDoc.addPage([595, 842]);
  return await pdfDoc.save();
}

// "Beschadigde" PDF zoals een oudere versie van onze saver die schreef:
// /Rotate 90-pagina, FreeText met AP-stream waarin de tekst horizontaal in
// PDF-ruimte staat (identiteits-/translatie-matrices, geen rotatie), onze
// tekst-state-signatuur, en GEEN /OPS_Rotation-sleutel.
async function buildLegacyDamagedPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  page.setRotation(degrees(90));
  const context = pdfDoc.context;

  // Visueel 200x60-vak op (100,100) => PDF-ruimte Rect [100, 542, 160, 742]
  const rect = [100, 542, 160, 742];
  const apContent =
    '1 1 0 rg\n' +
    `${rect[0]} ${rect[1]} 60 200 re f\n` +
    `${rect[0]} ${rect[1]} 60 200 re W n\n` +
    'BT\n' +
    '0 0 0 rg 0 Tc 0 Tw 100 Tz 0 Tr\n' +
    '/Helv 14 Tf\n' +
    `${rect[0] + 2} ${rect[3] - 16} Td\n(Legacy tekst) Tj\n` +
    'ET\n';
  const fontDict = context.obj({
    Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
  });
  const apStream = context.stream(apContent, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Matrix: [1, 0, 0, 1, -rect[0], -rect[1]],
    Resources: context.obj({ Font: context.obj({ Helv: fontDict }) }),
  });
  const apRef = context.register(apStream);

  const annotDict = context.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: rect,
    Contents: PDFString.of('Legacy tekst'),
    DA: PDFString.of('0 0 0 rg /Helv 14 Tf'),
    C: [1, 1, 0],
    F: 4,
    T: PDFString.of('Tester'),
  });
  annotDict.set(PDFName.of('AP'), context.obj({ N: apRef }));
  const annotRef = context.register(annotDict);
  page.node.set(PDFName.of('Annots'), context.obj([annotRef]));
  return await pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Hulpjes voor AP-inspectie in node (pdf-lib)
// ---------------------------------------------------------------------------
async function collectFreeTexts(bytes) {
  const pdfDoc = await PDFDocument.load(bytes);
  const context = pdfDoc.context;
  const out = [];
  const pages = pdfDoc.getPages();
  for (let pi = 0; pi < pages.length; pi++) {
    const annotsRaw = pages[pi].node.get(PDFName.of('Annots'));
    if (!annotsRaw) continue;
    const annots = context.lookup(annotsRaw);
    for (let i = 0; i < annots.size(); i++) {
      const dict = context.lookup(annots.get(i));
      if (dict?.get(PDFName.of('Subtype'))?.toString() !== '/FreeText') continue;
      const opsRotRaw = dict.get(PDFName.of('OPS_Rotation'));
      const opsRot = opsRotRaw !== undefined
        ? Number((context.lookup(opsRotRaw) || opsRotRaw)?.numberValue ?? (context.lookup(opsRotRaw) || opsRotRaw)?.value)
        : undefined;
      // AP/N-stream decoderen (onze saver schrijft ongecomprimeerd)
      let ap = null;
      const apRaw = dict.get(PDFName.of('AP'));
      if (apRaw) {
        const nRaw = context.lookup(apRaw)?.get(PDFName.of('N'));
        const nStream = nRaw ? context.lookup(nRaw) : null;
        if (nStream) {
          const contents = typeof nStream.getContents === 'function'
            ? nStream.getContents() : nStream.contents?.();
          if (contents) ap = new TextDecoder('latin1').decode(contents);
        }
      }
      out.push({ page: pi + 1, opsRot, ap });
    }
  }
  return out;
}

// Zoek cm/Tm-operators met een rotatiecomponent (b of c != 0)
function rotationOps(apText) {
  const re = /(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(cm|Tm)\b/g;
  const hits = [];
  let m;
  while ((m = re.exec(apText)) !== null) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]), c = parseFloat(m[3]), d = parseFloat(m[4]);
    if (Math.abs(b) > 0.001 || Math.abs(c) > 0.001) hits.push({ a, b, c, d });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 2. Round trip door de ECHTE app-code (web-modus via playwright)
// ---------------------------------------------------------------------------
const inputBytes = await buildInputPdf();
const legacyBytes = await buildLegacyDamagedPdf();
console.log(`Invoer-PDF: ${inputBytes.length} bytes (p1 /Rotate 90, p2 recht)`);
console.log(`Legacy-PDF: ${legacyBytes.length} bytes (beschadigd patroon)`);

const tmpDir = mkdtempSync(join(tmpdir(), 'opds-ftrot-'));
const viteProc = await startVite();
const browser = await chromium.launch({ headless: true });
let savedBytes;
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  page.on('console', msg => {
    if (msg.type() === 'error') console.error('  [browser]', msg.text());
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 2a. Openen + 2 textbox-annotaties toevoegen + opslaan (echte savePDF)
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(async (bytesArr) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { state } = await import('/js/core/state.ts');
    const { savePDF } = await import('/js/pdf/saver.js');

    const { index } = createTab('rt-input.pdf');
    await loadPDF('rt-input.pdf', index, new Uint8Array(bytesArr));
    // Muteer via de store-proxy (state.documents[index]), niet via het rauwe
    // object dat createTab teruggeeft — de saver leest via de proxy.
    const doc = state.documents[index];
    for (const pg of [1, 2]) {
      doc.annotations.push(createAnnotation({
        type: 'textbox', page: pg,
        x: 100, y: 100, width: 200, height: 60,
        text: 'Horizontale tekst', fontSize: 14,
        textColor: '#000000', fillColor: '#ffff00', strokeColor: '#000000',
        lineWidth: 1, rotation: 0,
      }));
    }
    await savePDF(); // web-modus: schrijft via browser-download
  }, Array.from(inputBytes));
  const download = await downloadPromise;
  const savedPath = join(tmpDir, 'rt-saved.pdf');
  await download.saveAs(savedPath);
  savedBytes = new Uint8Array(readFileSync(savedPath));
  console.log(`\nOpgeslagen via echte saver: ${savedBytes.length} bytes`);

  // ---------------------------------------------------------------------------
  // 3. Asserties op het opgeslagen bestand (node, pdf-lib)
  // ---------------------------------------------------------------------------
  console.log('\n[SAVER] AP-stream + OPS_Rotation:');
  const fts = await collectFreeTexts(savedBytes);
  assert(fts.length === 2, `2 FreeText-annotaties in opgeslagen PDF (was ${fts.length})`);
  const ft1 = fts.find(f => f.page === 1);
  const ft2 = fts.find(f => f.page === 2);
  assert(ft1 && ft1.opsRot === 0, `p1: /OPS_Rotation aanwezig en 0 (was ${ft1?.opsRot})`);
  assert(ft2 && ft2.opsRot === 0, `p2: /OPS_Rotation aanwezig en 0 (was ${ft2?.opsRot})`);
  const rot1 = ft1?.ap ? rotationOps(ft1.ap) : [];
  assert(rot1.length > 0, 'p1 (/Rotate 90): AP bevat rotatietransform (cm/Tm met sin-component)');
  const r1 = rot1[0];
  assert(r1 && Math.abs(r1.a) < 0.01 && Math.abs(Math.abs(r1.b) - 1) < 0.01,
    `p1: rotatie is 90 graden (cos=0, sin=±1; was a=${r1?.a} b=${r1?.b})`);
  const rot2 = ft2?.ap ? rotationOps(ft2.ap) : [];
  assert(rot2.length === 0, 'p2 (recht): AP bevat GEEN rotatietransform (regressie-check)');
  assert(!!ft2?.ap && ft2.ap.includes('re'), 'p2: AP-inhoud aanwezig en ongewijzigd van vorm');

  // Sanity via pdfjs: /Rotate 90 behouden, annotaties zichtbaar voor PDF.js
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjsLib.getDocument({ data: savedBytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pjPage1 = await pdf.getPage(1);
  assert(pjPage1.rotate === 90, `pdfjs: pagina 1 heeft /Rotate 90 (was ${pjPage1.rotate})`);
  const pjAnnots = await pjPage1.getAnnotations();
  assert(pjAnnots.some(a => a.subtype === 'FreeText'), 'pdfjs: FreeText-annotatie zichtbaar op p1');
  await pdf.destroy();

  // ---------------------------------------------------------------------------
  // 4. Heropenen door de ECHTE loader/converter: visuele rotatie 0
  // ---------------------------------------------------------------------------
  console.log('\n[LOADER] heropenen van het opgeslagen bestand:');
  const reload = await page.evaluate(async (bytesArr) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab('rt-reload.pdf');
    await loadPDF('rt-reload.pdf', index, new Uint8Array(bytesArr));
    const doc = state.documents[index];
    // wacht tot achtergrond-annotatielaad + kleur-update klaar is
    for (let i = 0; i < 200; i++) {
      if (doc.annotations.length >= 2 && doc._pagesNeedingColorUpdate.size === 0) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return doc.annotations.map(a => ({
      type: a.type, page: a.page, rotation: a.rotation || 0,
      x: Math.round(a.x), y: Math.round(a.y),
      width: Math.round(a.width), height: Math.round(a.height),
      text: a.text,
    }));
  }, Array.from(savedBytes));
  console.log('  app-model:', JSON.stringify(reload));
  assert(reload.length === 2, `2 annotaties terug in app-model (was ${reload.length})`);
  const r1a = reload.find(a => a.page === 1);
  const r2a = reload.find(a => a.page === 2);
  assert(r1a && r1a.rotation === 0, `p1: converter levert visuele rotatie 0 (was ${r1a?.rotation})`);
  assert(r2a && r2a.rotation === 0, `p2: converter levert visuele rotatie 0 (was ${r2a?.rotation})`);
  assert(r1a && Math.abs(r1a.width - 200) <= 2 && Math.abs(r1a.height - 60) <= 2,
    `p1: visuele afmetingen behouden (200x60, was ${r1a?.width}x${r1a?.height})`);
  assert(r1a && Math.abs(r1a.x - 100) <= 2 && Math.abs(r1a.y - 100) <= 2,
    `p1: visuele positie behouden (100,100, was ${r1a?.x},${r1a?.y})`);

  // ---------------------------------------------------------------------------
  // 5. Zelfheling: beschadigd bestand laadt als visueel-onberoteerd
  // ---------------------------------------------------------------------------
  console.log('\n[HEALING] beschadigd (oud) bestand:');
  const healed = await page.evaluate(async (bytesArr) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab('rt-legacy.pdf');
    await loadPDF('rt-legacy.pdf', index, new Uint8Array(bytesArr));
    const doc = state.documents[index];
    for (let i = 0; i < 200; i++) {
      if (doc.annotations.length >= 1 && doc._pagesNeedingColorUpdate.size === 0) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return doc.annotations.map(a => ({ type: a.type, rotation: a.rotation || 0, text: a.text }));
  }, Array.from(legacyBytes));
  console.log('  app-model:', JSON.stringify(healed));
  assert(healed.length === 1, `1 annotatie geladen (was ${healed.length})`);
  assert(healed[0] && healed[0].rotation === 0,
    `zelfheling: visuele rotatie 0 i.p.v. paginarotatie (was ${healed[0]?.rotation})`);
} finally {
  await browser.close();
  stopVite(viteProc);
}

if (failures > 0) {
  console.error(`\n${failures} assertie(s) gefaald`);
  process.exit(1);
}
console.log('\nAlle asserties geslaagd.');
