// Paginaminiaturen (#579): ze groeien mee met het paneel, lopen bij een breed
// paneel over in kolommen en blijven scherp, ook op bezochte (gemarkeerde)
// bladen en op een hoge-dpi-scherm.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_KOLOM, KOLOM_GAP, MIN_RENDER, MAX_RENDER,
  kolomBreedte, aantalKolommen, renderBreedte, renderBreedteVoorLijst,
  halveerStappen, maxPaneelBreedte, dropPositie,
} from './miniatuur-maat.js';

const hier = dirname(fileURLToPath(import.meta.url));
const app = join(hier, '../../..');
const lees = (pad) => readFileSync(join(app, pad), 'utf8');

// Binnenbreedte van de lijst bij een paneelbreedte: tabstrook 32 px + rand 1,
// padding 2x4 en de vaste scrollbalkgoot (scrollbar-gutter: stable).
const binnen = (paneel, goot) => paneel - 33 - 8 - goot;

test('vier pagina’s naast elkaar in een paneel van 330 px', () => {
  for (const goot of [8, 11, 17]) {
    assert.equal(aantalKolommen(binnen(330, goot)), 4);
    assert.equal(aantalKolommen(binnen(500, goot)), 6);
    assert.equal(aantalKolommen(binnen(200, goot)), 2);
  }
});

test('de kolomgrens houdt rekening met de ruimte tussen de miniaturen', () => {
  assert.equal(kolomBreedte(131), 131);
  assert.equal(kolomBreedte(132), 64);
  assert.equal(kolomBreedte(0), 0);
  assert.equal(aantalKolommen(0), 1);
});

test('renderbreedte: getoonde breedte maal devicePixelRatio, in stappen, begrensd', () => {
  assert.equal(renderBreedte(139, 1), MIN_RENDER, 'standaardpaneel: 280 px');
  assert.equal(renderBreedte(139, 1.5), MIN_RENDER);
  assert.equal(renderBreedte(269, 1), 320, 'breed paneel, gewoon scherm');
  assert.equal(renderBreedte(269, 1.25), 400, '125% schaal');
  assert.equal(renderBreedte(269, 2), 560, 'hoge-dpi-scherm');
  assert.equal(renderBreedte(269, 3), MAX_RENDER, 'nooit groter dan de bovengrens');
  assert.equal(renderBreedte(269, 0), 320, 'onzinnige dpr telt als 1');
  assert.equal(renderBreedte(269, NaN), 320);
  // Een paar pixels breder: zelfde stap, dus geen nieuwe render.
  assert.equal(renderBreedte(250, 1), renderBreedte(255, 1));
});

test('renderbreedte uit de lijstbreedte: de kolom min rand en padding van het item', () => {
  assert.equal(renderBreedteVoorLijst(binnen(330, 8), 1), MIN_RENDER);
  assert.equal(renderBreedteVoorLijst(binnen(200, 8), 1), MIN_RENDER);
  assert.equal(renderBreedteVoorLijst(binnen(330, 8), 2), MIN_RENDER);
});

test('verkleinen in halveringsstappen: nooit meer dan een factor 2 per stap', () => {
  const stappen = halveerStappen(4000, 2828, 300, 212);
  assert.deepEqual(stappen.at(-1), [300, 212], 'eindigt op de doelmaat');
  assert.ok(stappen.length >= 4, 'grote bitmap: meerdere tussenstappen');
  let [w, h] = [4000, 2828];
  for (const [nw, nh] of stappen) {
    assert.ok(w / nw <= 2.01 && h / nh <= 2.01, `${w}x${h} -> ${nw}x${nh} te grote stap`);
    assert.ok(nw >= 300 && nh >= 212, 'nooit kleiner dan het doel');
    [w, h] = [nw, nh];
  }
  assert.deepEqual(halveerStappen(500, 354, 300, 212), [[300, 212]], 'klein genoeg: in een keer');
  for (const [bw, bh] of [[601, 425], [1200, 848], [8000, 300]]) {
    const s = halveerStappen(bw, bh, 300, 212);
    assert.deepEqual(s.at(-1), [300, 212]);
    assert.equal(new Set(s.map(String)).size, s.length, 'geen dubbele stappen');
  }
});

test('linkerpaneel mag tot 60% van het venster, minstens 500 px', () => {
  assert.equal(maxPaneelBreedte(1920), 1152);
  assert.equal(maxPaneelBreedte(1366), 820);
  assert.equal(maxPaneelBreedte(700), 500);
  assert.equal(maxPaneelBreedte(undefined), 500);
});

test('slepen: in kolommen ervoor of erachter, in een kolom erboven of eronder', () => {
  const rect = { left: 100, top: 50, width: 160, height: 220 };
  assert.equal(dropPositie(rect, 120, 260, true), 'before', 'links van het midden');
  assert.equal(dropPositie(rect, 240, 60, true), 'after', 'rechts van het midden');
  assert.equal(dropPositie(rect, 240, 60, false), 'before', 'boven het midden');
  assert.equal(dropPositie(rect, 120, 260, false), 'after', 'onder het midden');
});

test('CSS, paneel en renderpaden zijn aangesloten', () => {
  const css = lees('styles/layout.css');
  assert.match(css, new RegExp(`grid-template-columns: repeat\\(auto-fill, minmax\\(${MIN_KOLOM}px, 1fr\\)\\)`));
  assert.match(css, new RegExp(`\\.thumbnails-container \\{[^}]*gap: ${KOLOM_GAP}px`));
  assert.match(css, /scrollbar-gutter: stable/);
  assert.match(css, /\.thumbnail-canvas \{\s*width: 100%;/);

  const item = lees('js/solid/components/left-panel/ThumbnailItem.jsx');
  assert.doesNotMatch(item, /imageData\(\)\.width \+ 'px'/, 'geen vaste beeldbreedte meer');
  assert.match(item, /'aspect-ratio'/);

  const lp = lees('js/ui/panels/left-panel.js');
  assert.doesNotMatch(lp, /THUMBNAIL_SCALE/);
  assert.doesNotMatch(lp, /targetW = 140|maxWidth: 140/, 'geen vaste 140 px meer');
  assert.equal((lp.match(/tekenVerkleind\(ctx, (best\.bitmap|src),/g) || []).length, 2, 'bitmap- en poolpad verkleinen in stappen');
  assert.match(lp, /new ResizeObserver\(planBreedteCheck\)/);
  assert.doesNotMatch(lp, /removeThumbnailImage\(pageNum\)/, 'verversen zonder flits naar de laadcirkel');

  assert.match(lees('js/ui/setup.js'), /maxPaneelBreedte\(window\.innerWidth\)/);

  const undo = lees('js/core/undo-manager.js');
  const flush = undo.slice(undo.indexOf('export function flushPropertyChange'));
  assert.match(flush.slice(0, flush.indexOf('\n}\n')), /scheduleThumbnailRefresh\(cmd\)/,
    'een wijziging uit het eigenschappenpaneel ververst de miniatuur');
});
