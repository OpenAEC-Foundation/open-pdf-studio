// Meting voor incrementeel opslaan (#679): uitvoergrootte en opslagtijd van de
// echte saver, volledig herschrijven tegen incrementeel, op de test-PDF's van
// de repo. Geen test: tijden hangen van de machine af en horen niet in CI.
//
// Gebruik (vanuit open-pdf-studio/):
//   node scripts/meet-incrementeel-opslaan.mjs [map-of-bestand ...] [--keer=3]
// Zonder argumenten: "../test pdf-bestanden" (de originele bestanden).
// Uitvoer: een Markdown-tabel op stdout (docs/incrementeel-opslaan.md).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');
process.chdir(app);

const { state, laad } = await import('../js/pdf/rondgang.testhulp.mjs');
const { savePDF } = await import('../js/pdf/saver.js');
const { DEFAULT_PREFERENCES } = await import('../js/core/constants.js');
const mupdf = await import('mupdf');
const { loadBookmarksFromPdf } = await import('../js/pdf/bladwijzers-lezen.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

/** Bladwijzers zoals de lader ze in doc.bookmarks zet. */
async function bladwijzers(bytes) {
  const d = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try { return await loadBookmarksFromPdf(d); } finally { await d.loadingTask.destroy(); }
}

const argv = process.argv.slice(2);
const keer = Number((argv.find((a) => a.startsWith('--keer=')) || '--keer=3').slice(7));
let paden = argv.filter((a) => !a.startsWith('--'));
if (!paden.length) {
  const basis = path.resolve(app, '..', 'test pdf-bestanden');
  paden = [path.join(basis, 'Originele bestanden'), basis];
}
const bestanden = [];
for (const p of paden) {
  if (!existsSync(p)) continue;
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p).sort()) if (f.toLowerCase().endsWith('.pdf')) bestanden.push(path.join(p, f));
  } else bestanden.push(p);
}

const vak = (id) => ({
  id, type: 'box', page: 1, x: 40, y: 40, width: 120, height: 60, rotation: 0,
  color: '#ff0000', strokeColor: '#ff0000', fillColor: null, lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'Meting',
});

async function sla(bron, incrementeel, bookmarks, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bron,
      writeBinaryFileAtomic: (_p, b) => { uit = b; return true; },
      showMessage: (m) => { throw new Error(m); },
    },
  };
  state.preferences = { ...DEFAULT_PREFERENCES, incrementalSave: incrementeel };
  state.documents = [{
    id: 'meting', filePath: 'C:/meting/bron.pdf', pdfDoc: {}, annotations: [...modellen.map((m) => ({ ...m })), vak('m')],
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
    bookmarks: bookmarks.map((b) => ({ ...b })),
  }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  const t0 = performance.now();
  const gelukt = await savePDF(null, { zonderHandtekeningVraag: true }, doc);
  const ms = performance.now() - t0;
  if (!gelukt) throw new Error('opslaan mislukt');
  return { ms, bytes: uit, wijze: doc.laatsteOpslagWijze };
}

const mediaan = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
const mb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MiB` : kb(n));

const origLog = console.info;
console.info = () => {};
console.log('| Bestand | Bron | Annotaties blad 1 | Volledig: grootte | Volledig: tijd | Incrementeel: grootte (toevoeging) | Incrementeel: tijd | Uitkomst |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
for (const f of bestanden) {
  const bron = new Uint8Array(readFileSync(f));
  const naam = path.relative(path.resolve(app, '..'), f).replace(/^test pdf-bestanden\//, '');
  try {
    const bm = await bladwijzers(bron);
    // Blad 1 zoals de lader het model maakt, plus één nieuw vak: de saver
    // herschrijft dan ook de bestaande annotaties van dat blad, zoals in de app.
    const modellen = await laad(bron);
    const vol = [];
    const inc = [];
    let v, i;
    for (let k = 0; k < keer; k++) {
      v = await sla(bron, false, bm, modellen); vol.push(v.ms);
      i = await sla(bron, true, bm, modellen); inc.push(i.ms);
    }
    let uitkomst = i.wijze.wijze === 'incrementeel' ? 'incrementeel' : `volledig (${i.wijze.reden}${i.wijze.detail ? `: ${String(i.wijze.detail).slice(0, 40)}` : ''})`;
    if (i.wijze.wijze === 'incrementeel') {
      const m = mupdf.Document.openDocument(i.bytes, 'application/pdf').asPDF();
      if (m.wasRepaired()) uitkomst += ', MuPDF HERSTELDE';
    }
    const toevoeging = i.wijze.wijze === 'incrementeel' ? ` (+${kb(i.bytes.length - bron.length)})` : '';
    console.log(`| ${naam} | ${mb(bron.length)} | ${modellen.length} | ${mb(v.bytes.length)} | ${mediaan(vol).toFixed(0)} ms | ${mb(i.bytes.length)}${toevoeging} | ${mediaan(inc).toFixed(0)} ms | ${uitkomst} |`);
  } catch (e) {
    console.log(`| ${naam} | ${mb(bron.length)} | – | – | – | – | – | fout: ${String(e?.message || e).slice(0, 60)} |`);
  }
}
console.info = origLog;
