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

/** renderPage() in het klein: pagina tekenen, stap, dan de trage lagen. */
async function renderPageNaspelen({ laagDuurt }) {
  const log = [];
  const scherm = { zichtbaar: true };

  log.push('pagina getekend');
  paginaGetekend({ verbergLaadscherm: () => { scherm.zichtbaar = false; log.push('laadscherm weg'); } });

  const halverwege = { zichtbaar: scherm.zichtbaar, log: [...log] };

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

test('zonder haak gebeurt er niets, en het valt niet om', () => {
  assert.doesNotThrow(() => paginaGetekend());
  assert.doesNotThrow(() => paginaGetekend({}));
});
