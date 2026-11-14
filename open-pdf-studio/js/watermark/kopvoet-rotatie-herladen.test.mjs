// Kop-/voettekst op een gedraaid document: na opslaan herlaadt de saver de
// weergave (de draaiing staat dan in /Rotate, #1072). Het scherm tekent de
// kop-/voettekst zelf, dus de bytes van de weergave mogen hem niet bevatten,
// ook niet vanaf de tweede keer opslaan, wanneer het document op een
// werkkopie draait en het opgeslagen bestand een ander pad heeft. Met de
// echte saver; alleen het herladen zelf is een stub die de bytes vastlegt.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('../pdf/saver.js');

const DOEL = 'C:/werk/tekening.pdf';
const WERKKOPIE = 'C:/temp/werkkopie-1.pdf';

async function bron() {
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]).drawText('BODY', { x: 50, y: 400 });
  return pdf.save();
}

async function teksten(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  try {
    return (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).filter((s) => s.trim());
  } finally { await doc.loadingTask.destroy(); }
}

async function slaOp({ weergavePad }) {
  const bronBytes = await bron();
  let geschreven = null;
  let herladen = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { geschreven = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { geschreven = bytes; return true; },
      reloadFromBytes: (bytes) => { herladen = bytes; },
    },
  };
  state.documents = [{
    id: 'kopvoet-rotatie', filePath: weergavePad, saveTargetPath: DOEL, fileName: 'tekening.pdf',
    pdfDoc: { numPages: 1 }, currentPage: 1, annotations: [], textEdits: [], bookmarks: [],
    pageRotations: { 1: 90 }, _annotationPagesReady: new Set([1]),
    watermarks: [{ id: 'hf', type: 'headerFooter', enabled: true, headerCenter: 'KOPTEKST', pageRange: 'all' }],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF(DOEL, { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return { geschreven, herladen, doc: state.documents[0] };
}

test('het opgeslagen bestand heeft de koptekst, de herladen weergave niet (tweede keer opslaan, op een werkkopie)', async () => {
  const { geschreven, herladen } = await slaOp({ weergavePad: WERKKOPIE });
  assert.ok((await teksten(geschreven)).includes('KOPTEKST'), 'de koptekst staat in het bestand');
  assert.ok(herladen, 'een gedraaid document wordt na opslaan herladen');
  const inWeergave = await teksten(herladen);
  assert.ok(inWeergave.includes('BODY'));
  assert.equal(inWeergave.includes('KOPTEKST'), false, 'het scherm tekent de koptekst zelf: niet ook in de weergavebytes');
});

test('na het herladen geldt de weergave als vrij van ingebakken kop-/voetteksten', async () => {
  const { doc } = await slaOp({ weergavePad: WERKKOPIE });
  assert.equal(doc._kopVoetBron ?? null, null);
  assert.equal(doc.watermarks[0].uitBestand, true, 'de koptekst staat wel in het opgeslagen bestand');
});
