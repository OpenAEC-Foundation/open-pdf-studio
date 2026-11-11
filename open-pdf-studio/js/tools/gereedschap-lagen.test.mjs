import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canvasOnderTekst, pasCanvasLagenToe, pasTekstlagenToe, pasGereedschapLagenToe,
} from './gereedschap-lagen.js';

// Nep-DOM: genoeg voor querySelectorAll op de twee selectors en een inline stijl.
function el(klasse, kinderen = []) {
  return {
    klasse,
    style: {},
    kinderen,
    querySelectorAll(sel) {
      const uit = [];
      const loop = (k) => {
        for (const c of k.kinderen) {
          if (pastBij(c, sel)) uit.push(c);
          loop(c);
        }
      };
      loop(this);
      return uit;
    },
  };
}

function pastBij(e, sel) {
  return sel.split(',').map((s) => s.trim()).some((s) => {
    if (s === 'span') return e.klasse === 'span';
    if (s === '#annotation-canvas') return e.klasse === '#annotation-canvas';
    return s === '.' + e.klasse;
  });
}

// Een pagina zoals renderContinuousPage hem bouwt: pdf-canvas, annotatiecanvas
// (zonder inline z-index) en een tekstlaag met spans.
function nieuwePagina() {
  const span = el('span');
  const tekstlaag = el('textLayer', [span]);
  const canvas = el('annotation-canvas');
  const pagina = el('canvas-container-cont', [el('pdf-canvas'), canvas, tekstlaag]);
  return { pagina, canvas, tekstlaag, span };
}

// Welke laag krijgt een klik midden op de pagina? Zelfde regel als de browser
// (gecontroleerd in Chromium): de tekstlaag heeft in de CSS z-index 5 en
// pointer-events auto, het annotatiecanvas heeft in de CSS geen z-index.
function klikDoel({ canvas, tekstlaag }) {
  const z = (v, standaard) => (v === undefined || v === '' ? standaard : Number(v));
  const kandidaten = [
    { naam: 'canvas', z: z(canvas.style.zIndex, 0), pe: canvas.style.pointerEvents || 'auto', volgorde: 1 },
    { naam: 'tekstlaag', z: z(tekstlaag.style.zIndex, 5), pe: tekstlaag.style.pointerEvents || 'auto', volgorde: 2 },
  ].filter((k) => k.pe !== 'none');
  kandidaten.sort((a, b) => (b.z - a.z) || (b.volgorde - a.volgorde));
  return kandidaten[0]?.naam ?? 'container';
}

test('#1013: een pagina die na de keuze van de hand gebouwd wordt, krijgt de klik op het canvas', () => {
  const p = nieuwePagina();
  // Zonder de regel: de tekstlaag ligt bovenop en de paginacontainer negeert
  // de klik — met de hand gebeurt er niets.
  assert.equal(klikDoel(p), 'tekstlaag');

  pasGereedschapLagenToe(p.pagina, 'hand');
  assert.equal(klikDoel(p), 'canvas');
  assert.equal(p.canvas.style.zIndex, '6');
  assert.equal(p.canvas.style.pointerEvents, 'auto');
  assert.equal(p.tekstlaag.style.pointerEvents, 'none');
  assert.equal(p.span.style.pointerEvents, 'none');
});

test('tekengereedschappen volgen dezelfde stapeling als de hand', () => {
  const p = nieuwePagina();
  pasGereedschapLagenToe(p.pagina, 'box');
  assert.equal(klikDoel(p), 'canvas');
  assert.equal(p.tekstlaag.style.pointerEvents, 'none');
});

test('selecteren: canvas boven, tekstlaag bereikbaar voor de doorval', () => {
  const p = nieuwePagina();
  pasGereedschapLagenToe(p.pagina, 'select');
  assert.equal(p.canvas.style.zIndex, '6');
  assert.equal(p.tekstlaag.style.pointerEvents, 'auto');
  assert.equal(p.span.style.pointerEvents, 'auto');
  assert.equal(p.span.style.cursor, 'text');
});

test('tekst bewerken: canvas onder de tekstlaag, tekstlaag niet aangeraakt', () => {
  const p = nieuwePagina();
  p.tekstlaag.style.pointerEvents = 'auto';
  pasGereedschapLagenToe(p.pagina, 'editText');
  assert.equal(canvasOnderTekst('editText'), true);
  assert.equal(p.canvas.style.zIndex, '2');
  assert.equal(p.canvas.style.pointerEvents, 'none');
  assert.equal(p.tekstlaag.style.pointerEvents, 'auto');
  assert.equal(klikDoel(p), 'tekstlaag');
});

test('losse regels en een ontbrekende wortel', () => {
  const p = nieuwePagina();
  pasCanvasLagenToe(p.pagina, 'hand');
  assert.equal(p.canvas.style.zIndex, '6');
  assert.equal(p.tekstlaag.style.pointerEvents, undefined);
  pasTekstlagenToe(p.pagina, 'hand');
  assert.equal(p.tekstlaag.style.pointerEvents, 'none');
  assert.doesNotThrow(() => pasGereedschapLagenToe(null, 'hand'));
  assert.doesNotThrow(() => pasGereedschapLagenToe({}, 'hand'));
});
