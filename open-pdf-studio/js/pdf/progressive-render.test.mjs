import { test } from 'node:test';
import assert from 'node:assert';
import {
  isHeavyBytes,
  isSceneCandidateBytes,
  computeTileGrid,
  createSceneAttemptCoordinator,
  shouldSpreadPdfiumFallback,
} from './progressive-render.js';
import { createInflightKeyGate } from './inflight-key-gate.js';
import {
  needsVisibleTile,
  prewarmTileRenderScale,
  tileRenderScaleForZoom,
  tileSupportsZoom,
} from './tile-render-policy.js';

test('isHeavyBytes: drempel = 1MB gecomprimeerde content', () => {
  assert.equal(isHeavyBytes(2_000_000), true);
  assert.equal(isHeavyBytes(1_000_001), true);
  assert.equal(isHeavyBytes(1_000_000), false); // strikt groter dan
  assert.equal(isHeavyBytes(500_000), false);
  assert.equal(isHeavyBytes(undefined), false);
  assert.equal(isHeavyBytes(NaN), false);
});

test('scene-kandidaat begint pas boven de extreme-contentgrens', () => {
  assert.equal(isSceneCandidateBytes(6_000_000), false);
  assert.equal(isSceneCandidateBytes(6_000_001), true);
  assert.equal(isSceneCandidateBytes(undefined), false);
});

test('computeTileGrid dekt de hele bitmap aaneensluitend, laatste kolom/rij = rest', () => {
  const tiles = computeTileGrid(843, 596, 256);
  // 843 -> kolommen 0,256,512,768 (4); 596 -> rijen 0,256,512 (3) = 12 tegels
  assert.equal(tiles.length, 12);
  // dekt exact tot 843 x 596, geen gaten voorbij
  const maxX = Math.max(...tiles.map(t => t.px + t.pw));
  const maxY = Math.max(...tiles.map(t => t.py + t.ph));
  assert.equal(maxX, 843);
  assert.equal(maxY, 596);
  // alle tegels positief
  assert.ok(tiles.every(t => t.pw > 0 && t.ph > 0));
  // rest-tegels: rechterkolom pw=75, onderrij ph=84
  assert.ok(tiles.some(t => t.pw === 75));
  assert.ok(tiles.some(t => t.ph === 84));
});

test('computeTileGrid: exact veelvoud levert volle tegels', () => {
  const tiles = computeTileGrid(512, 256, 256);
  assert.equal(tiles.length, 2); // 2 kolommen x 1 rij
  assert.ok(tiles.every(t => t.pw === 256 && t.ph === 256));
});

test('computeTileGrid: kleiner dan één tegel = één tegel', () => {
  const tiles = computeTileGrid(100, 80, 256);
  assert.equal(tiles.length, 1);
  assert.deepEqual(tiles[0], { px: 0, py: 0, pw: 100, ph: 80 });
});

test('scene coordinator voert een falende eerste extractiepoging maar één keer uit', async () => {
  let rejectProbe;
  const probe = new Promise((resolve, reject) => {
    rejectProbe = reject;
  });
  const calls = [];
  const failures = [];
  const render = async (args) => {
    calls.push(args.tile);
    return probe;
  };
  const coordinator = createSceneAttemptCoordinator();

  const first = coordinator.tryRegion('document|0|0', { tile: 1 }, render, (error) => failures.push(error.message));
  const second = coordinator.tryRegion('document|0|0', { tile: 2 }, render, (error) => failures.push(error.message));
  await Promise.resolve();
  assert.deepEqual(calls, [1]);

  rejectProbe(new Error('commandobudget overschreden'));
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.deepEqual(failures, ['commandobudget overschreden']);

  assert.equal(
    await coordinator.tryRegion('document|0|0', { tile: 3 }, render, () => {}),
    null,
  );
  assert.deepEqual(calls, [1]);
});

test('scene coordinator laat na een geslaagde probe de overige regio’s door', async () => {
  let resolveProbe;
  const probe = new Promise((resolve) => {
    resolveProbe = resolve;
  });
  const calls = [];
  const render = async (args) => {
    calls.push(args.tile);
    if (args.tile === 1) return probe;
    return `regio-${args.tile}`;
  };
  const coordinator = createSceneAttemptCoordinator();

  const first = coordinator.tryRegion('document|0|0', { tile: 1 }, render, () => {});
  const second = coordinator.tryRegion('document|0|0', { tile: 2 }, render, () => {});
  await Promise.resolve();
  assert.deepEqual(calls, [1]);

  resolveProbe('regio-1');
  assert.equal(await first, 'regio-1');
  assert.equal(await second, 'regio-2');
  assert.deepEqual(calls, [1, 2]);
});

test('PDFium-fallback spreidt normale pagina’s maar pint extreme scene-fallbacks', () => {
  assert.equal(shouldSpreadPdfiumFallback(false), true);
  assert.equal(shouldSpreadPdfiumFallback(true), false);
});

test('in-flight key gate dedupliceert dezelfde tegel en maakt alleen oudere keys stale', () => {
  const gate = createInflightKeyGate();
  const first = gate.begin('doc|p1|z2|region-a');
  assert.ok(first);
  assert.equal(gate.begin('doc|p1|z2|region-a'), null);
  assert.equal(gate.isCurrent(first), true);

  const second = gate.begin('doc|p1|z3|region-a');
  assert.ok(second);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.finish(first), false);
  assert.equal(gate.isCurrent(second), true);
  assert.equal(gate.finish(second), true);

  const third = gate.begin('doc|p1|z3|region-b');
  gate.cancel();
  assert.equal(gate.isCurrent(third), false);
});

test('tegelcache bewaakt de werkelijke schermresolutie', () => {
  assert.equal(tileRenderScaleForZoom(2, 1.5), 3);
  assert.equal(tileSupportsZoom(3, 2, 1.5), true);
  assert.equal(tileSupportsZoom(2, 2, 1.5), false);
});

test('zichttegelgrens houdt rekening met schermresolutie', () => {
  assert.equal(needsVisibleTile(1, 1.5, 1.215), true);
  assert.equal(needsVisibleTile(0.8, 1.5, 1.215), false);
  assert.equal(needsVisibleTile(1.3, 1, 1.215), true);
  assert.equal(needsVisibleTile(0.81, 1.5, 1.215), false);
});

test('prewarm dekt 200% alleen mee wanneer 150% dezelfde bucket gebruikt', () => {
  assert.equal(prewarmTileRenderScale({
    regionZoom: 1.5,
    supportZoom: 2,
    devicePixelRatio: 1.5,
    zoomBucket: 4,
  }), 3);
  assert.equal(prewarmTileRenderScale({
    regionZoom: 1.5,
    supportZoom: 2,
    devicePixelRatio: 1.25,
    zoomBucket: 2,
  }), 1.875);
});
