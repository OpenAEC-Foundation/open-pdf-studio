// Lagen schakelen verandert wat er getekend wordt (#377), op de renderpaden
// die in node beschikbaar zijn:
//   - pdf.js (webversie, voorvertoning, miniaturen, export/afdrukken via
//     pdfjsLaagOpties): page.render met optionalContentConfigPromise;
//   - het bestandspad dat PDFium op de desktop tekent: de weergavekopie uit
//     laagstand.js (het bestand plus een update van /D). Altijd met MuPDF,
//     dat /D op dezelfde manier volgt en hier staat voor elke lezer die het
//     bestand tekent zoals het is; met een gebouwde pdfium-worker
//     (OPDS_PDFIUM_WORKER) ook met PDFium zelf, onderaan;
//   - de laagstand als standaard bewaard (lagen-boom.js): daarna tekent elke
//     lezer de nieuwe stand vanzelf;
//   - een annotatie met /OC verdwijnt met haar laag (ook in andere lezers).
// Een tekening met twee lagen: A (rood vlak links) staat aan, B (blauw vlak
// rechts) staat standaard uit.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { laagstandBasis, laagstandUpdate, weergaveBytes } from './laagstand.js';
import { schrijfStandaardLaagstand, pdfjsIdVanRef } from './lagen-boom.js';

const N = PDFName.of;
const MAAT = 100;
// Meetpunten in paginacoördinaten (y omhoog): midden van vlak A, B en het groene annotatievlak.
const PUNT_A = [25, 50];
const PUNT_B = [75, 50];
const PUNT_ANN = [50, 90];

async function tekening({ metAnnotatie = false } = {}) {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([MAAT, MAAT]);
  const ctx = pdf.context;
  const a = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('A') }));
  const b = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('B') }));
  pagina.node.set(N('Resources'), ctx.obj({ Properties: { LA: a, LB: b } }));
  const inhoud = ctx.flateStream(
    '/OC /LA BDC 1 0 0 rg 10 10 30 80 re f EMC\n/OC /LB BDC 0 0 1 rg 60 10 30 80 re f EMC\n',
  );
  pagina.node.set(N('Contents'), ctx.register(inhoud));
  pdf.catalog.set(N('OCProperties'), ctx.obj({ OCGs: [a, b], D: { Order: [a, b], OFF: [b] } }));
  if (metAnnotatie) {
    // Een vierkant met een eigen appearance, op laag A.
    const ap = ctx.register(ctx.stream('0 1 0 rg 0 0 20 6 re f', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 20, 6],
    }));
    const annot = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Square', Rect: [40, 87, 60, 93], F: 4, AP: { N: ap }, OC: a,
    }));
    pagina.node.set(N('Annots'), ctx.obj([annot]));
  }
  return { bytes: await pdf.save(), a: pdfjsIdVanRef(a), b: pdfjsIdVanRef(b) };
}

function kleur(pixel) {
  const [r, g, b] = pixel;
  if (r > 200 && g < 80 && b < 80) return 'rood';
  if (b > 200 && r < 80 && g < 80) return 'blauw';
  if (g > 200 && r < 80 && b < 80) return 'groen';
  if (r > 230 && g > 230 && b > 230) return 'wit';
  return `anders(${r},${g},${b})`;
}

// ---- pdf.js ---------------------------------------------------------------

let napiCanvas = null;
try { napiCanvas = await import('@napi-rs/canvas'); } catch { napiCanvas = null; }

async function pdfjsDoc(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
}

/** Tekent pagina 1 zoals renderer.js: annotationMode 0, plus de laagopties. */
async function pdfjsKleuren(doc, laagOpties = {}) {
  const page = await doc.getPage(1);
  const schaal = 2;
  const canvas = napiCanvas.createCanvas(MAAT * schaal, MAAT * schaal);
  await page.render({
    canvas,
    viewport: page.getViewport({ scale: schaal }),
    background: '#ffffff',
    annotationMode: 0,
    ...laagOpties,
  }).promise;
  const ctx = canvas.getContext('2d');
  const lees = ([x, y]) => kleur(ctx.getImageData(x * schaal, (MAAT - y) * schaal, 1, 1).data);
  return { a: lees(PUNT_A), b: lees(PUNT_B) };
}

test('pdf.js: een laag die standaard uit staat, wordt niet getekend', { skip: napiCanvas ? false : '@napi-rs/canvas ontbreekt' }, async () => {
  const { bytes } = await tekening();
  const doc = await pdfjsDoc(bytes);
  try {
    assert.deepEqual(await pdfjsKleuren(doc), { a: 'rood', b: 'wit' });
  } finally {
    await doc.loadingTask.destroy();
  }
});

test('pdf.js: schakelen in de config tekent de andere stand, zonder herladen', { skip: napiCanvas ? false : '@napi-rs/canvas ontbreekt' }, async () => {
  const { bytes, a, b } = await tekening();
  const doc = await pdfjsDoc(bytes);
  try {
    // Zoals lagen-schakelen.js: één config per document, pdfjsLaagOpties geeft hem mee.
    const config = await doc.getOptionalContentConfig();
    const opties = { optionalContentConfigPromise: Promise.resolve(config) };
    config.setVisibility(a, false);
    config.setVisibility(b, true);
    assert.deepEqual(await pdfjsKleuren(doc, opties), { a: 'wit', b: 'blauw' });
    config.setVisibility(a, true);
    assert.deepEqual(await pdfjsKleuren(doc, opties), { a: 'rood', b: 'blauw' });
    // Zonder de opties: nog steeds de beginstand van het document.
    assert.deepEqual(await pdfjsKleuren(doc), { a: 'rood', b: 'wit' });
  } finally {
    await doc.loadingTask.destroy();
  }
});

// ---- het bestand zelf (PDFium-pad, hier met MuPDF) -------------------------

let mupdf = null;
try { mupdf = await import('mupdf'); } catch { mupdf = null; }

function mupdfKleuren(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  let page;
  let pix;
  try {
    page = doc.loadPage(0);
    const schaal = 2;
    pix = page.toPixmap(mupdf.Matrix.scale(schaal, schaal), mupdf.ColorSpace.DeviceRGB, false, true);
    const breedte = pix.getWidth();
    const data = pix.getPixels();
    const lees = ([x, y]) => {
      const o = (Math.round((MAAT - y) * schaal) * breedte + Math.round(x * schaal)) * 3;
      return kleur([data[o], data[o + 1], data[o + 2]]);
    };
    return { a: lees(PUNT_A), b: lees(PUNT_B), ann: lees(PUNT_ANN) };
  } finally {
    pix?.destroy();
    page?.destroy();
    doc.destroy();
  }
}

test('bestand: een laag die standaard uit staat, tekent een lezer ook niet', { skip: mupdf ? false : 'mupdf ontbreekt' }, async () => {
  const { bytes } = await tekening();
  const k = mupdfKleuren(bytes);
  assert.equal(k.a, 'rood');
  assert.equal(k.b, 'wit');
});

test('bestand: de weergavekopie (laagstand.js) tekent de geschakelde stand', { skip: mupdf ? false : 'mupdf ontbreekt' }, async () => {
  const { bytes, a } = await tekening();
  const basis = await laagstandBasis(bytes);
  // A uit, B aan (B staat dan niet meer in /OFF).
  const kopie = weergaveBytes(bytes, laagstandUpdate(basis, [a]));
  const k = mupdfKleuren(kopie);
  assert.deepEqual([k.a, k.b], ['wit', 'blauw']);
  // Alles aan.
  const k2 = mupdfKleuren(weergaveBytes(bytes, laagstandUpdate(basis, [])));
  assert.deepEqual([k2.a, k2.b], ['rood', 'blauw']);
});

test('bestand: de stand als standaard bewaard, tekent elke lezer vanzelf', { skip: mupdf && napiCanvas ? false : 'mupdf of @napi-rs/canvas ontbreekt' }, async () => {
  const { bytes, a, b } = await tekening();
  const pdf = await PDFDocument.load(bytes);
  assert.equal(schrijfStandaardLaagstand(pdf, new Map([[a, false], [b, true]])), true);
  const opgeslagen = await pdf.save();
  const k = mupdfKleuren(opgeslagen);
  assert.deepEqual([k.a, k.b], ['wit', 'blauw']);
  const doc = await pdfjsDoc(opgeslagen);
  try {
    assert.deepEqual(await pdfjsKleuren(doc), { a: 'wit', b: 'blauw' });
  } finally {
    await doc.loadingTask.destroy();
  }
});

test('bestand: een annotatie met /OC verdwijnt met haar laag', { skip: mupdf ? false : 'mupdf ontbreekt' }, async () => {
  const { bytes, a } = await tekening({ metAnnotatie: true });
  assert.equal(mupdfKleuren(bytes).ann, 'groen');
  const basis = await laagstandBasis(bytes);
  const k = mupdfKleuren(weergaveBytes(bytes, laagstandUpdate(basis, [a])));
  assert.equal(k.a, 'wit');
  assert.equal(k.ann, 'wit', 'laag A uit: de annotatie op laag A ook');
});

// ---- PDFium zelf, via de echte pdfium-worker ---------------------------------
// Alleen als er een gebouwde worker is: OPDS_PDFIUM_WORKER=<pad naar
// pdfium-worker> (libpdfium naast het programma). Zelfde opdrachten als de
// werkerpool van de desktop (render, slot, namespace, gedeeld geheugen).

const WORKER = process.env.OPDS_PDFIUM_WORKER || '';

test('PDFium (pdfium-worker): beginstand, weergavekopie en bewaarde standaard', { skip: WORKER ? false : 'OPDS_PDFIUM_WORKER niet gezet' }, async () => {
  const [{ spawn }, fs, os, path, readline] = await Promise.all([
    import('node:child_process'), import('node:fs'), import('node:os'), import('node:path'), import('node:readline'),
  ]);
  const { bytes, a, b } = await tekening();
  const basis = await laagstandBasis(bytes);
  const bewaard = await PDFDocument.load(bytes);
  schrijfStandaardLaagstand(bewaard, new Map([[a, false], [b, true]]));
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-lagen-'));
  const bestanden = {
    begin: bytes,
    kopie: weergaveBytes(bytes, laagstandUpdate(basis, [a])),
    bewaard: await bewaard.save(),
  };
  for (const [naam, inhoud] of Object.entries(bestanden)) fs.writeFileSync(path.join(map, `${naam}.pdf`), inhoud);

  const ns = `lagentest${process.pid}`;
  const worker = spawn(WORKER, ['97', ns], { stdio: ['pipe', 'pipe', 'inherit'] });
  const regels = readline.createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
  try {
    assert.match((await regels.next()).value, /"op":"ready"/);
    const kleuren = {};
    let id = 0;
    for (const naam of Object.keys(bestanden)) {
      worker.stdin.write(`${JSON.stringify({ op: 'render', id: ++id, path: path.join(map, `${naam}.pdf`), page_index: 0, scale: 2, rotation: 0 })}\n`);
      const antwoord = JSON.parse((await regels.next()).value);
      assert.equal(antwoord.ok, true);
      const shm = fs.readFileSync(path.join(os.tmpdir(), `pdfium-worker-${ns}-97.shm`));
      const lees = ([x, y]) => {
        const o = 32 + (Math.round((MAAT - y) * 2) * antwoord.w + Math.round(x * 2)) * 4;
        return kleur([shm[o], shm[o + 1], shm[o + 2]]);
      };
      kleuren[naam] = [lees(PUNT_A), lees(PUNT_B)];
    }
    assert.deepEqual(kleuren, {
      begin: ['rood', 'wit'],
      kopie: ['wit', 'blauw'],
      bewaard: ['wit', 'blauw'],
    });
  } finally {
    worker.stdin.write('{"op":"shutdown"}\n');
    worker.stdin.end();
    await new Promise((r) => { worker.once('exit', r); setTimeout(r, 5000); });
    fs.rmSync(map, { recursive: true, force: true });
    fs.rmSync(path.join(os.tmpdir(), `pdfium-worker-${ns}-97.shm`), { force: true });
  }
});
