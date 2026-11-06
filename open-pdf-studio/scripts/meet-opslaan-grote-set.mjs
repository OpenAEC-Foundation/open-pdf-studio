// Meting: opslaan van een grote tekeningenset (#629, met #581).
//
// Bouwt met pdf-lib een set van BLADEN bladen (standaard 150) met zoveel
// markeringen dat het bestand minstens OBJECTEN indirecte objecten telt
// (standaard 100.000: elke markering is een annotatie met een eigen
// appearance-stroom), laadt hem met de echte lader en slaat hem op met de
// echte saver (js/pdf/rondgang.testhulp.mjs). Gemeten, mediaan van RONDES
// keer:
//   - opslaan zonder bewerking;
//   - opslaan na een bewerking op elk blad: één markering verplaatst en één
//     nieuwe rechthoek erbij.
// Het laden telt niet mee; dat meet de prestatievergelijking van de release
// (verify-prestaties.mjs in scripts/ van de hoofdmap).
//
// Gebruik (in open-pdf-studio/):
//   node scripts/meet-opslaan-grote-set.mjs [--bladen 150] [--objecten 100000]
//        [--rondes 3] [--grens-ms 6000] [--json uitvoer.json]
// Exit 1 als een mediaan boven --grens-ms ligt. De saver draait hier in node
// (V8, zoals de WebView); de tijd in de app ligt in dezelfde orde, plus het
// schrijven naar schijf.

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString, PDFHexString, rgb } from 'pdf-lib';

const N = (n) => PDFName.of(n);

/**
 * De set: `bladen` A1-bladen met een tekenkader, elk met evenveel
 * markeringen (Square, Line, FreeText en Text afwisselend), samen genoeg voor
 * `objecten` indirecte objecten.
 */
export async function bouwSet({ bladen = 150, objecten = 100000 } = {}) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  // Twee objecten per markering (annotatie + appearance), plus de bladen.
  const perBlad = Math.ceil(Math.max(0, objecten - bladen * 3) / (2 * bladen));
  const datum = PDFString.of('D:20261001120000+01\'00\'');
  for (let b = 0; b < bladen; b++) {
    const blad = doc.addPage([2384, 1684]);
    blad.drawRectangle({ x: 40, y: 40, width: 2304, height: 1604, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    blad.drawText(`Blad ${b + 1}`, { x: 2000, y: 80, size: 24 });
    const refs = [];
    for (let i = 0; i < perBlad; i++) {
      const x = 80 + (i % 40) * 55;
      const y = 120 + Math.floor(i / 40) * 60;
      const soort = ['Square', 'Line', 'FreeText', 'Text'][i % 4];
      const rect = [x, y, x + 40, y + 30];
      const ap = ctx.register(ctx.stream('1 0 0 RG 1 w 0.5 0.5 39 29 re S', {
        Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 40, 30], Resources: ctx.obj({}),
      }));
      const dict = ctx.obj({
        Type: 'Annot', Subtype: soort, Rect: rect, F: 4, C: [1, 0, 0],
        NM: PDFString.of(`set-${b + 1}-${i + 1}`), T: PDFHexString.fromText('Controleur'),
        Subj: PDFHexString.fromText(soort), Contents: PDFHexString.fromText(`Opmerking ${i + 1} € ² °`),
        M: datum, CreationDate: datum, AP: ctx.obj({ N: ap }),
        ...(soort === 'Line' ? { L: [x, y, x + 40, y + 30] } : {}),
        ...(soort === 'FreeText' ? { DA: PDFString.of('/Helv 10 Tf 0 g') } : {}),
      });
      dict.set(N('P'), blad.ref);
      refs.push(ctx.register(dict));
    }
    blad.node.set(N('Annots'), ctx.obj(refs));
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, perBlad, objecten: ctx.largestObjectNumber };
}

const mediaan = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/**
 * Laden en opslaan meten. `rondes` keer per scenario; geeft de mediaan en
 * alle losse tijden in ms terug.
 */
export async function meet({ bladen = 150, objecten = 100000, rondes = 3, log = () => {} } = {}) {
  const t0 = performance.now();
  const set = await bouwSet({ bladen, objecten });
  log(`set gebouwd: ${bladen} bladen, ${set.perBlad} markeringen per blad, ${set.objecten} objecten, `
    + `${(set.bytes.length / 1048576).toFixed(1)} MB (${Math.round(performance.now() - t0)} ms)`);

  // Zoals main.js: pdf-lib in partijen van 5000 objecten (#581).
  await import('../js/pdf/pdf-lib-snelheid.js');
  const { laadAlles, state } = await import('../js/pdf/rondgang.testhulp.mjs');
  const { savePDF } = await import('../js/pdf/saver.js');
  const { applyMove } = await import('../js/annotations/transforms.js');
  const t1 = performance.now();
  const modellen = await laadAlles(set.bytes);
  const laadMs = performance.now() - t1;
  log(`geladen: ${modellen.length} annotaties (${Math.round(laadMs)} ms)`);
  const alleBladen = new Set(Array.from({ length: bladen }, (_, i) => i + 1));

  /**
   * Zoals rondgang.testhulp.mjs opslaan(), maar alleen savePDF zelf telt:
   * in de app staat het document al in de state-store.
   */
  async function opslaanGemeten(lijst) {
    let uit = null;
    globalThis.__saverTest = {
      impl: {
        getCachedPdfBytes: () => set.bytes,
        writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
        writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
      },
    };
    state.documents = [{
      id: 'meting', filePath: 'C:/meting/set.pdf', pdfDoc: {}, annotations: lijst,
      pageRotations: {}, _annotationPagesReady: alleBladen, textEdits: [],
    }];
    state.activeDocumentIndex = 0;
    const t = performance.now();
    const gelukt = await savePDF('C:/meting/uit.pdf', { zonderHandtekeningVraag: true });
    const ms = performance.now() - t;
    if (gelukt !== true || !uit) throw new Error('opslaan mislukt');
    return { ms, uit };
  }

  const kloon = () => modellen.map((m) => structuredClone(m));
  const scenarios = {
    zonderBewerking: () => kloon(),
    bewerktPerBlad: () => {
      const lijst = kloon();
      const gehad = new Set();
      for (const m of lijst) {
        if (gehad.has(m.page) || m.type !== 'box') continue;
        gehad.add(m.page);
        applyMove(m, 15, 10);
      }
      for (let p = 1; p <= bladen; p++) {
        lijst.push({
          id: `nieuw-${p}`, page: p, type: 'box', x: 300, y: 300, width: 120, height: 80, rotation: 0,
          color: '#0000ff', strokeColor: '#0000ff', fillColor: null, lineWidth: 2, borderStyle: 'solid', opacity: 1,
          author: 'Meting',
        });
      }
      return lijst;
    },
  };

  const resultaat = {
    bladen, markeringen: modellen.length, objecten: set.objecten, megabytes: +(set.bytes.length / 1048576).toFixed(1),
    ladenMs: Math.round(laadMs), scenarios: {},
  };
  for (const [naam, maak] of Object.entries(scenarios)) {
    const tijden = [];
    let grootte = 0;
    for (let r = 0; r < rondes; r++) {
      const { ms, uit } = await opslaanGemeten(maak());
      tijden.push(Math.round(ms));
      grootte = uit.length;
    }
    resultaat.scenarios[naam] = { mediaanMs: mediaan(tijden), tijdenMs: tijden, megabytes: +(grootte / 1048576).toFixed(1) };
    log(`${naam}: mediaan ${mediaan(tijden)} ms (${tijden.join(', ')})`);
  }
  return resultaat;
}

function argumenten(argv) {
  const a = { bladen: 150, objecten: 100000, rondes: 3, grensMs: 6000, json: null };
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i + 1];
    if (argv[i] === '--bladen') a.bladen = +w;
    else if (argv[i] === '--objecten') a.objecten = +w;
    else if (argv[i] === '--rondes') a.rondes = +w;
    else if (argv[i] === '--grens-ms') a.grensMs = +w;
    else if (argv[i] === '--json') a.json = w;
    else continue;
    i++;
  }
  return a;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = argumenten(process.argv.slice(2));
  const r = await meet({ ...a, log: (s) => console.log(s) });
  r.grensMs = a.grensMs;
  r.node = process.version;
  r.datum = new Date().toISOString();
  if (a.json) fs.writeFileSync(a.json, JSON.stringify(r, null, 2));
  const te = Object.entries(r.scenarios).filter(([, s]) => s.mediaanMs > a.grensMs);
  for (const [naam, s] of te) console.error(`TE TRAAG: ${naam} ${s.mediaanMs} ms > ${a.grensMs} ms`);
  process.exitCode = te.length ? 1 : 0;
}
