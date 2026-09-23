// De volgorde binnen renderPage(): eerst de pagina, dan pas de lagen — en het
// laadscherm hoort bij de PAGINA, niet bij de lagen (#456).
//
// De test speelt renderPage() na met een tekstlaag die blijft hangen, zoals in
// de webversie gebeurt wanneer PDF.js eerst de miniaturen afwerkt. Blijft het
// laadscherm dan staan, dan kijkt de gebruiker naar "Loading PDF…" over een
// pagina die al lang zichtbaar is.

import assert from 'node:assert/strict';
import test from 'node:test';

const { paginaGetekend } = await import('./pagina-getekend.js');
const { bepaalOverlayMaat } = await import('./overlay-canvas-size.js');

/** Canvas-nabootsing; een vers <canvas> staat op 300×150. */
function nepCanvas() {
  let w = 300, h = 150;
  return {
    get width() { return w; }, set width(v) { w = Math.trunc(v); },
    get height() { return h; }, set height(v) { h = Math.trunc(v); },
    style: { width: '', height: '' },
  };
}

/** renderPage() in het klein: pagina tekenen, stap, dan de trage lagen. */
async function renderPageNaspelen({ laagDuurt, canvassen = [], maat = null }) {
  const log = [];
  const scherm = { zichtbaar: true };

  log.push('pagina getekend');
  paginaGetekend({
    overlayCanvassen: canvassen,
    overlayMaat: maat,
    verbergLaadscherm: () => { scherm.zichtbaar = false; log.push('laadscherm weg'); },
  });

  const halverwege = {
    zichtbaar: scherm.zichtbaar,
    log: [...log],
    maten: canvassen.map((c) => [c.width, c.height]),
  };

  await laagDuurt;
  log.push('tekstlaag klaar');
  return { log, scherm, halverwege };
}

test('het laadscherm gaat weg zodra de pagina er staat, niet pas na de lagen', async () => {
  let laatLaagLos;
  const traag = new Promise((r) => { laatLaagLos = r; });
  const bezig = renderPageNaspelen({ laagDuurt: traag });

  // Even doorademen: de tekstlaag is nog niet klaar.
  await Promise.resolve();
  laatLaagLos();
  const { halverwege, log } = await bezig;

  assert.equal(halverwege.zichtbaar, false, 'laadscherm hangt nog over de pagina');
  assert.deepEqual(halverwege.log, ['pagina getekend', 'laadscherm weg']);
  assert.deepEqual(log, ['pagina getekend', 'laadscherm weg', 'tekstlaag klaar']);
});

test('de overlay-canvassen krijgen hun maat al bij de pagina, niet pas na de lagen', async () => {
  // Webversie: PDF.js tekent de pagina zelf, dus paginamaat × dpr.
  // tracemonkey op fit-width: 918×1188 CSS-px bij dpr 1,5 → 1377×1782.
  const maat = bepaalOverlayMaat({
    viewportActief: false, heeftBestandspad: true,
    paginaCssW: 918, paginaCssH: 1188, dpr: 1.5,
  });
  assert.deepEqual(maat, {
    bron: 'pagina', width: 1377, height: 1782, cssWidth: '918px', cssHeight: '1188px',
  });

  const ann = nepCanvas();
  const hl = nepCanvas();
  let laatLos;
  const traag = new Promise((r) => { laatLos = r; });
  const bezig = renderPageNaspelen({ laagDuurt: traag, canvassen: [ann, hl], maat });
  await Promise.resolve();
  laatLos();
  const { halverwege } = await bezig;

  // Zonder deze stap stonden beide nog op 300×150 terwijl de pagina er stond:
  // een markering landde dan op 300/1377 van zijn plek.
  assert.deepEqual(halverwege.maten, [[1377, 1782], [1377, 1782]]);
  assert.equal(halverwege.zichtbaar, false);
});

test('een maat die al klopt wordt niet opnieuw gezet (dat zou het canvas wissen)', () => {
  const maat = { bron: 'pagina', width: 1377, height: 1782, cssWidth: '918px', cssHeight: '1188px' };
  const ann = nepCanvas();
  assert.equal(paginaGetekend({ overlayCanvassen: [ann], overlayMaat: maat }), true);
  assert.equal(paginaGetekend({ overlayCanvassen: [ann], overlayMaat: maat }), false);
});

test('zonder haak of maat gebeurt er niets, en het valt niet om', () => {
  assert.doesNotThrow(() => paginaGetekend());
  assert.doesNotThrow(() => paginaGetekend({}));
  const ann = nepCanvas();
  // Geen geldige maat (viewport bezit de pagina maar de maat is onbekend):
  // de canvassen blijven ongemoeid in plaats van op een gokmaat te gaan.
  assert.equal(paginaGetekend({ overlayCanvassen: [ann, null], overlayMaat: null }), false);
  assert.deepEqual([ann.width, ann.height], [300, 150]);
});
