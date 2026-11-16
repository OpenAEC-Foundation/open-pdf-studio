// Tabwissel tussen een document in de doorlopende weergave en een document in
// de enkelpagina-weergave: de indeling (welke container zichtbaar is) hoort bij
// het document dat voorkomt. De containers worden door alle tabbladen gedeeld;
// zonder deze stap bleef na een doorlopend document diens container met zijn
// pagina's staan en tekende renderPage in een verborgen canvas van 0 x 0. Het
// beeld leek bevroren op het vorige document, ook na bladeren of zoomen.
//
// renderer.js en tabs.js laden in node niet (webview-afhankelijk); de koppeling
// wordt op de bron gecontroleerd en applyViewModeLayout zelf draait tegen een
// nagemaakte DOM.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const js = join(hier, '../..');
const bron = (pad) => readFileSync(join(js, pad), 'utf8').replace(/\r\n/g, '\n');

const blok = (tekst, begin, eind) => {
  const start = tekst.indexOf(begin);
  assert.ok(start >= 0, `"${begin}" niet gevonden`);
  const stop = tekst.indexOf(eind, start + begin.length);
  return tekst.slice(start, stop >= 0 ? stop + eind.length : undefined);
};

test('een tabwissel zet eerst de indeling van het nieuwe document, dan pas renderen', () => {
  const tabs = bron('ui/chrome/tabs.js');
  assert.match(tabs, /import \{[^}]*applyViewModeLayout[^}]*\} from '\.\.\/\.\.\/pdf\/renderer\.js'/);
  // switchToTab geeft het werk aan toonTab, waar het document gerenderd wordt.
  assert.match(blok(tabs, 'export function switchToTab', '\n}\n'), /toonTab\(index\)/);
  const wissel = blok(tabs, 'function toonTab(', '\n}\n');
  const indeling = wissel.indexOf('applyViewModeLayout(newDoc)');
  const render = wissel.indexOf("const firstRender = newDoc.viewMode === 'continuous'");
  assert.ok(indeling >= 0, 'toonTab roept applyViewModeLayout(newDoc) aan');
  assert.ok(render >= 0, 'toonTab rendert het nieuwe document');
  assert.ok(indeling < render, 'de indeling komt vóór renderPage/renderContinuous');
});

test('setViewMode gebruikt dezelfde indeling vóór het renderen', () => {
  const r = bron('pdf/renderer.js');
  const zet = blok(r, 'export async function setViewMode', '\n}\n');
  const indeling = zet.indexOf('applyViewModeLayout(doc)');
  assert.ok(indeling >= 0);
  assert.ok(indeling < zet.indexOf('await renderPage('), 'vóór renderPage');
  assert.ok(indeling < zet.indexOf('await renderContinuous('), 'vóór renderContinuous');
});

// applyViewModeLayout uit de bron, uitgevoerd met een nagemaakte DOM.
function laadIndeling() {
  const r = bron('pdf/renderer.js');
  const fn = blok(r, 'export function applyViewModeLayout', '\n}\n').replace(/^export /, '');
  const els = {
    'canvas-container': { style: { display: 'inline-block' } },
    'continuous-container': { style: { display: 'none' } },
    'pdf-container': { style: { overflow: 'hidden' } },
    'canvas-wrapper': { klassen: new Set(), classList: null },
  };
  els['canvas-wrapper'].classList = {
    toggle: (k, aan) => (aan ? els['canvas-wrapper'].klassen.add(k) : els['canvas-wrapper'].klassen.delete(k)),
  };
  const document = { getElementById: (id) => els[id] || null };
  const _setContinuousLayoutActive = (on) => document.getElementById('canvas-wrapper')?.classList.toggle('continuous-mode', !!on);
  const applyViewModeLayout = new Function('document', '_setContinuousLayoutActive', `${fn}\nreturn applyViewModeLayout;`)(document, _setContinuousLayoutActive);
  return { applyViewModeLayout, els };
}

test('doorlopend → enkelpagina: de doorlopende container verdwijnt, het canvas komt terug', () => {
  const { applyViewModeLayout, els } = laadIndeling();
  // Het vorige tabblad stond in de doorlopende weergave.
  applyViewModeLayout({ viewMode: 'continuous' });
  assert.equal(els['canvas-container'].style.display, 'none');
  assert.equal(els['continuous-container'].style.display, 'flex');
  assert.equal(els['pdf-container'].style.overflow, '', 'doorlopend scrolt via #pdf-container');
  assert.ok(els['canvas-wrapper'].klassen.has('continuous-mode'));

  // Het nieuwe tabblad staat in de enkelpagina-weergave.
  applyViewModeLayout({ viewMode: 'single' });
  assert.equal(els['canvas-container'].style.display, 'inline-block');
  assert.equal(els['continuous-container'].style.display, 'none');
  assert.ok(!els['canvas-wrapper'].klassen.has('continuous-mode'));
});

test('boek- en spreadweergave tonen de doorlopende container als raster', () => {
  const { applyViewModeLayout, els } = laadIndeling();
  applyViewModeLayout({ viewMode: 'continuous', bookSpread: true });
  assert.equal(els['continuous-container'].style.display, 'grid');
  applyViewModeLayout({ viewMode: 'continuous', facingSpread: true });
  assert.equal(els['continuous-container'].style.display, 'grid');
  // Zonder viewMode (nog niet gezet): enkelpagina, zoals de standaard.
  applyViewModeLayout({});
  assert.equal(els['canvas-container'].style.display, 'inline-block');
});
