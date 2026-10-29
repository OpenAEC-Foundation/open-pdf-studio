// Het tweede paneel van de gesplitste weergave (#715) en de gedeelde
// paginabitmapcache: het paneel mag de bitmap die de viewer toont niet
// verdringen of sluiten, mag met veel zichtbare pagina's niet in een
// renderlus komen, en laat bij sluiten of opheffen geen PDF.js-canvassen
// achter. De echte page-bitmap-cache.js draait hier; alleen het renderen zelf
// (PDFium) is nagebootst.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const pbc = await import('../page-bitmap-cache.js');
const pb = await import('./paneel-bitmaps.js');

function bitmap(naam, w = 100, h = 100) {
  return {
    naam, width: w, height: h, gesloten: false,
    close() { this.gesloten = true; this.width = 0; this.height = 0; },
  };
}

// De echte cache, met een nagebootste render: ensureBitmap zet na een tik een
// nieuwe bitmap onder dezelfde sleutel, zoals de echte na PDFium.
function maakCache() {
  const verzoeken = [];
  const cache = {
    ...pbc,
    ensureBitmap(pad, pagina, rotatie, bucket) {
      verzoeken.push(`${pagina}@${bucket}`);
      return new Promise((klaar) => setTimeout(() => {
        const b = bitmap(`${pad}:${pagina}:${bucket}`);
        pbc.setCachedBitmapEntry(pad, pagina, rotatie, bucket, b, 100, 100, bucket);
        klaar(pbc.getCachedBitmap(pad, pagina, rotatie, bucket));
      }, 0));
    },
  };
  return { cache, verzoeken };
}

// n pagina's onder elkaar in een paneel van W×H (doorlopende weergave, ver
// uitgezoomd): elke pagina 60×80 CSS-px.
function plaatsingen(n, { breedte = 60, hoogte = 80 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    page: i + 1, rotatie: 0, pw: 600, ph: 800, sw: 600, sh: 800,
    z: breedte / 600, tx: 10, ty: 10 + i * (hoogte + 4),
  }));
}

const tik = () => new Promise((r) => setTimeout(r, 2));
// Wachten op de voorwaarde zelf: onder een belaste testrun is de volgorde
// van de nep-render (timer 0) en een vaste tik niet gegarandeerd.
async function wachtTot(voorwaarde, grens = 10000) {
  const einde = Date.now() + grens;
  while (!voorwaarde() && Date.now() < einde) await tik();
}
let getoond = [];
pbc.registreerGetoondeBitmaps(() => getoond);

function schoon() {
  getoond = [];
  pb.laatPaneelBitmapsLos();
  pbc.clearAllBitmaps();
  pbc.ruimUitgesteldOp();
}

test('budget: alleen de grootste pagina\'s in beeld mogen een beeld aanvragen', () => {
  const p = plaatsingen(10);
  p[7].z = 0.5; // pagina 8 staat veel groter in beeld
  const gekozen = pb.kiesBudget(p, 2000, 2000);
  assert.equal(gekozen.size, pb.PANEEL_BUDGET);
  assert.ok(gekozen.has(7), 'de grootste eerst');
  assert.equal(pb.kiesBudget(p.slice(0, 2), 2000, 2000).size, 2);
});

test('het tweede paneel verdringt of sluit de bitmap van de viewer niet, en komt tot rust', async () => {
  schoon();
  // De viewer toont een rasterpagina van een ander document.
  const live = bitmap('live');
  pbc.setCachedBitmapEntry('live.pdf', 1, 0, 2, live, 100, 100, 2);
  getoond = [live];

  // Het tweede paneel: doorlopend, 30 pagina's tegelijk in beeld (meer dan de
  // hele cache houdt). Teken zolang er iets binnenkomt, zoals planTekenen.
  const { cache, verzoeken } = maakCache();
  const W = 400;
  const H = 30 * 84 + 20;
  let hertekenen = 0;
  const p = plaatsingen(30);
  let rondes = 0;
  let laatste;
  do {
    hertekenen = 0;
    laatste = pb.paneelBitmaps(p, { filePath: 'paneel.pdf', dpr: 1, W, H, cache, opKlaar: () => { hertekenen++; } });
    await tik();
    await tik();
    rondes++;
  } while (hertekenen > 0 && rondes < 50);

  assert.ok(rondes < 50, `geen renderlus: na ${rondes} rondes nog steeds nieuwe beelden`);
  assert.equal(verzoeken.length, pb.PANEEL_BUDGET, `elke pagina binnen het budget precies één keer aangevraagd: ${verzoeken}`);
  assert.equal(live.gesloten, false, 'de bitmap van de viewer blijft open');
  assert.equal(pbc.getCachedBitmap('live.pdf', 1, 0, 2)?.bitmap, live, 'en in de cache');

  // De pagina's binnen het budget staan scherp; de rest wacht nergens op.
  assert.ok(laatste.every((b) => b.exact));
  assert.equal(laatste.filter((b) => b.beeld && b.beeld.width > 0).length, pb.PANEEL_BUDGET);

  // Nog eens tekenen vraagt niets nieuws aan.
  const voor = verzoeken.length;
  pb.paneelBitmaps(p, { filePath: 'paneel.pdf', dpr: 1, W, H, cache });
  await tik();
  assert.equal(verzoeken.length, voor);
});

test('scrollen in het tweede paneel (enkele pagina\'s na elkaar) laat de getoonde bitmap van de viewer open', async () => {
  schoon();
  const live = bitmap('live');
  pbc.setCachedBitmapEntry('live.pdf', 3, 0, 1, live, 100, 100, 1);
  getoond = [live];
  const { cache } = maakCache();
  for (let pagina = 1; pagina <= 40; pagina++) {
    const p = [{ page: pagina, rotatie: 0, pw: 600, ph: 800, sw: 600, sh: 800, z: 1, tx: 0, ty: 0 }];
    pb.paneelBitmaps(p, { filePath: 'live.pdf', dpr: 1, W: 600, H: 800, cache });
    await tik();
    assert.equal(live.gesloten, false, `na pagina ${pagina} nog open`);
  }
  assert.ok(pbc.getCachedBitmap('live.pdf', 3, 0, 1));
});

test('opheffen laat de claims van het paneel los', async () => {
  schoon();
  const { cache } = maakCache();
  const p = plaatsingen(3);
  pb.paneelBitmaps(p, { filePath: 'x.pdf', dpr: 1, W: 400, H: 400, cache });
  const vind = () => pbc.getCachedBitmap('x.pdf', 1, 0, pb.bucketVoor(p[0], p[0].z))?.bitmap;
  await wachtTot(vind);
  const b = vind();
  assert.ok(b);
  pb.laatPaneelBitmapsLos();
  for (let i = 1; i <= 20; i++) pbc.setCachedBitmapEntry('y.pdf', i, 0, 1, bitmap(`y${i}`), 1, 1, 1);
  assert.equal(b.gesloten, true, 'zonder claim gewoon verdrongen');
});

// ── PDF.js-pad ────────────────────────────────────────────────────────────

function nepPdfDoc({ vertraging = 0 } = {}) {
  return {
    getPage: async () => ({
      rotate: 0,
      getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: new Promise((r) => setTimeout(r, vertraging)) }),
    }),
  };
}
const maakDoek = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }) });

test('PDF.js: sluiten van het document geeft de canvassen van het paneel vrij', async () => {
  const doc = { id: 'pdfjs-1', pdfDoc: nepPdfDoc() };
  const p = plaatsingen(4);
  pb.paneelPdfjsBeelden(doc, p, { dpr: 1, W: 400, H: 400, maakDoek });
  await tik(); await tik();
  const beelden = pb.paneelPdfjsBeelden(doc, p, { dpr: 1, W: 400, H: 400, maakDoek }).map((b) => b.beeld);
  assert.ok(beelden.every((b) => b && b.width > 0), 'de canvassen staan klaar');
  assert.ok(pb.pdfjsCacheOverzicht().sleutels.some((k) => k.startsWith('pdfjs-1|')));

  pb.vergeetPaneelBeelden(doc);
  assert.ok(!pb.pdfjsCacheOverzicht().sleutels.some((k) => k.startsWith('pdfjs-1|')), 'niets meer van dit document');
  assert.ok(beelden.every((b) => b.width === 0), 'en hun pixels zijn teruggegeven');
});

test('PDF.js: een render die na het sluiten klaar is, komt niet meer in de cache', async () => {
  const doc = { id: 'pdfjs-2', pdfDoc: nepPdfDoc({ vertraging: 10 }) };
  pb.paneelPdfjsBeelden(doc, plaatsingen(2), { dpr: 1, W: 400, H: 400, maakDoek });
  pb.vergeetPaneelBeelden(doc);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(!pb.pdfjsCacheOverzicht().sleutels.some((k) => k.startsWith('pdfjs-2|')));
});

test('PDF.js: aantal en pixels blijven begrensd, ook ver ingezoomd', async () => {
  const doc = { id: 'pdfjs-3', pdfDoc: nepPdfDoc() };
  // Ver ingezoomd: zoomtrap 8, zonder grens een canvas van 4800×6400.
  for (let pagina = 1; pagina <= 20; pagina++) {
    const p = [{ page: pagina, rotatie: 0, pw: 600, ph: 800, sw: 600, sh: 800, z: 5, tx: 0, ty: 0 }];
    pb.paneelPdfjsBeelden(doc, p, { dpr: 1, W: 600, H: 800, maakDoek });
    await tik(); await tik();
  }
  const o = pb.pdfjsCacheOverzicht();
  assert.ok(o.aantal <= pb.PDFJS_MAX_BEELDEN, `hooguit ${pb.PDFJS_MAX_BEELDEN} canvassen, nu ${o.aantal}`);
  assert.ok(o.pixels <= pb.PDFJS_MAX_PIXELS, `pixels binnen het budget: ${o.pixels}`);
  pb.vergeetPaneelBeelden(doc);
});

test('PDF.js: met veel zichtbare pagina\'s geen renderlus', async () => {
  const doc = { id: 'pdfjs-4', pdfDoc: nepPdfDoc() };
  let renders = 0;
  const pdfDoc = doc.pdfDoc;
  doc.pdfDoc = { getPage: async (n) => { renders++; return pdfDoc.getPage(n); } };
  const p = plaatsingen(20);
  for (let i = 0; i < 10; i++) {
    pb.paneelPdfjsBeelden(doc, p, { dpr: 1, W: 400, H: 20 * 84 + 20, maakDoek });
    await tik(); await tik();
  }
  assert.equal(renders, pb.PANEEL_BUDGET, `elke pagina binnen het budget één keer: ${renders}`);
  pb.vergeetPaneelBeelden(doc);
});
