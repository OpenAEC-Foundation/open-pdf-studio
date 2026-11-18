// Een pagina in de doorlopende weergave krijgt haar muis-events zodra haar
// canvassen bestaan (#1174). Voorheen pas aan het einde van een geslaagde
// eerste render: werd die ingehaald door een nieuwere (fitPage direct na het
// maken van een nieuw document), dan kreeg de pagina ze nooit en nam ze geen
// enkel gereedschap meer aan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eenmaalPerElement } from './doorlopend-pagina-events.js';

test('een container krijgt zijn luisteraars één keer', () => {
  const gezien = new WeakSet();
  const a = {};
  const b = {};
  assert.equal(eenmaalPerElement(gezien, a), true);
  assert.equal(eenmaalPerElement(gezien, a), false, 'tweede render van dezelfde pagina koppelt niet opnieuw');
  assert.equal(eenmaalPerElement(gezien, b), true, 'een andere pagina wel');
  assert.equal(eenmaalPerElement(gezien, null), false);
});

const bron = readFileSync(new URL('./renderer.js', import.meta.url), 'utf8');
const start = bron.indexOf('async function renderContinuousPage(');
const eind = bron.indexOf('\nexport async function reRenderVisibleContinuousPages', start);
const fn = bron.slice(start, eind);

test('renderContinuousPage koppelt de events vóór de render, niet erna', () => {
  assert.ok(start >= 0 && eind > start, 'renderContinuousPage gevonden');
  const koppel = fn.indexOf('setupContinuousPageEvents(annotationCanvasEl, pageNum)');
  assert.ok(koppel >= 0, 'de pagina wordt gekoppeld');
  // Vóór alles wat de functie voortijdig kan laten terugkeren nadat de
  // canvassen zijn gemaakt: de render zelf en de controles erna.
  for (const later of ['renderPdfPage(', 'tekenPaginaMetPdfJs(', '_contPageRenderGen.get(pageNum) !== myRenderGen', 'werkScherpeUitsnedeBij(']) {
    const plek = fn.indexOf(later);
    assert.ok(plek >= 0, `${later} gevonden`);
    assert.ok(koppel < plek, `koppelen staat vóór ${later}`);
  }
  // En na het aanmaken van het annotatiecanvas, zonder await ertussen.
  const canvas = fn.indexOf("annotationCanvasEl.className = 'annotation-canvas'");
  assert.ok(canvas >= 0 && canvas < koppel);
  assert.doesNotMatch(fn.slice(canvas, koppel), /\bawait\b/);
  // Niet meer afhankelijk van "nieuwe pagina": dat was de val.
  assert.doesNotMatch(fn, /if \(isNewPage\)\s*\{?\s*setupContinuousPageEvents/);
});

test('setupContinuousPageEvents is herhaalbaar', () => {
  const s = bron.indexOf('function setupContinuousPageEvents(');
  const lijf = bron.slice(s, bron.indexOf('\n}', s));
  assert.match(lijf, /eenmaalPerElement\(/);
  assert.ok(lijf.indexOf('eenmaalPerElement(') < lijf.indexOf('addEventListener'), 'de bewaking staat vóór het koppelen');
});
