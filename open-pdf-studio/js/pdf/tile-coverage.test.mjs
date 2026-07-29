import assert from 'node:assert/strict';
import test from 'node:test';

import { findBestCoveringTile, visiblePdfRegion } from './tile-coverage.js';

test('reuses a high-resolution tile when zooming out to a covered viewport', () => {
  const entries = [{
    id: 'wide-high-res',
    regionMeta: {
      regionXpt: 0,
      regionYpt: 0,
      regionWpt: 1000,
      regionHpt: 700,
      renderScale: 4.5,
    },
  }];

  const hit = findBestCoveringTile(entries, {
    regionXpt: 100,
    regionYpt: 100,
    regionWpt: 800,
    regionHpt: 500,
    requiredScale: 2.25,
  });

  assert.equal(hit?.id, 'wide-high-res');
});

test('rejects a sharp tile that does not cover the complete viewport', () => {
  const entries = [{
    id: 'narrow',
    regionMeta: {
      regionXpt: 200,
      regionYpt: 100,
      regionWpt: 400,
      regionHpt: 500,
      renderScale: 8,
    },
  }];

  const hit = findBestCoveringTile(entries, {
    regionXpt: 100,
    regionYpt: 100,
    regionWpt: 800,
    regionHpt: 500,
    requiredScale: 2.25,
  });

  assert.equal(hit, null);
});

test('rejects a covering tile below the physical screen resolution', () => {
  const entries = [{
    id: 'blurry',
    regionMeta: {
      regionXpt: 0,
      regionYpt: 0,
      regionWpt: 1000,
      regionHpt: 700,
      renderScale: 2,
    },
  }];

  const hit = findBestCoveringTile(entries, {
    regionXpt: 100,
    regionYpt: 100,
    regionWpt: 800,
    regionHpt: 500,
    requiredScale: 2.25,
  });

  assert.equal(hit, null);
});

test('chooses the least oversampled covering tile', () => {
  const entries = [
    {
      id: 'scale-8',
      regionMeta: {
        regionXpt: 0,
        regionYpt: 0,
        regionWpt: 1000,
        regionHpt: 700,
        renderScale: 8,
      },
    },
    {
      id: 'scale-4',
      regionMeta: {
        regionXpt: 0,
        regionYpt: 0,
        regionWpt: 1000,
        regionHpt: 700,
        renderScale: 4,
      },
    },
  ];

  const hit = findBestCoveringTile(entries, {
    regionXpt: 100,
    regionYpt: 100,
    regionWpt: 800,
    regionHpt: 500,
    requiredScale: 3,
  });

  assert.equal(hit?.id, 'scale-4');
});

test('chooses the smallest covering area when render scales match', () => {
  const entries = [
    {
      id: 'whole-page',
      regionMeta: {
        regionXpt: 0,
        regionYpt: 0,
        regionWpt: 1200,
        regionHpt: 800,
        renderScale: 4,
      },
    },
    {
      id: 'viewport',
      regionMeta: {
        regionXpt: 50,
        regionYpt: 50,
        regionWpt: 1000,
        regionHpt: 650,
        renderScale: 4,
      },
    },
  ];

  const hit = findBestCoveringTile(entries, {
    regionXpt: 100,
    regionYpt: 100,
    regionWpt: 800,
    regionHpt: 500,
    requiredScale: 3,
  });

  assert.equal(hit?.id, 'viewport');
});

test('computes the larger PDF cover after zooming out around the same center', () => {
  const region = visiblePdfRegion({
    pageW: 1200,
    pageH: 800,
    zoom: 1.5,
    offsetX: -300,
    offsetY: -150,
  }, 1200, 750);

  assert.deepEqual(region, {
    x: 200,
    y: 100,
    w: 800,
    h: 500,
  });
});

test('clips the visible PDF region to the page bounds', () => {
  const region = visiblePdfRegion({
    pageW: 1000,
    pageH: 600,
    zoom: 2,
    offsetX: 100,
    offsetY: 50,
  }, 1200, 800);

  assert.deepEqual(region, {
    x: 0,
    y: 0,
    w: 550,
    h: 375,
  });
});
