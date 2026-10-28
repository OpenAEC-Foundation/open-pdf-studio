// Layout arithmetic of the Edit Pages grid (#764): zoom levels, the
// virtualised window and the gap under the pointer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_LEVELS, DEFAULT_ZOOM_INDEX, GUTTER, ROW_GAP, PADDING, LABEL_HEIGHT, clampZoomIndex, zoomStep,
  gridLayout, cellPosition, tilePosition, visibleRange, gapAtPoint, scrollTopFor,
} from './organizer-grid.js';

test('zoom levels grow; steps and the slider are clamped', () => {
  for (let i = 1; i < ZOOM_LEVELS.length; i++) assert.ok(ZOOM_LEVELS[i] > ZOOM_LEVELS[i - 1]);
  assert.equal(clampZoomIndex(-3), 0);
  assert.equal(clampZoomIndex(99), ZOOM_LEVELS.length - 1);
  assert.equal(clampZoomIndex('x'), DEFAULT_ZOOM_INDEX);
  assert.equal(zoomStep(2, 1), 3);
  assert.equal(zoomStep(0, -1), 0);
  assert.equal(zoomStep(ZOOM_LEVELS.length - 1, 1), ZOOM_LEVELS.length - 1);
});

test('columns follow the width and the tile size; the end gap gets a cell', () => {
  const tile = 120;
  const cell = GUTTER + tile;
  const width = 2 * PADDING + 4 * cell + GUTTER;
  const l = gridLayout({ width, tile, count: 10 });
  assert.equal(l.columns, 4);
  assert.equal(l.rowH, tile + LABEL_HEIGHT + ROW_GAP);
  assert.equal(l.rows, 3, '10 tiles + end gap in rows of 4');
  assert.equal(gridLayout({ width: width - 1, tile, count: 10 }).columns, 3);
  assert.equal(gridLayout({ width: 10, tile, count: 10 }).columns, 1, 'always one column');
  // Zooming out gives more columns.
  assert.ok(gridLayout({ width, tile: ZOOM_LEVELS[0], count: 10 }).columns > l.columns);
  assert.equal(gridLayout({ width, tile, count: 8 }).rows, 3, 'a full last row: the end gap starts a new row');
  assert.equal(l.totalHeight, 2 * PADDING + 3 * l.rowH - ROW_GAP);
});

test('cells and tiles: the gutter of a cell lies in front of its tile', () => {
  const l = gridLayout({ width: 2 * PADDING + 3 * (GUTTER + 100) + GUTTER, tile: 100, count: 7 });
  assert.deepEqual(cellPosition(l, 0), { left: PADDING, top: PADDING, row: 0, col: 0 });
  assert.deepEqual(tilePosition(l, 0), { left: PADDING + GUTTER, top: PADDING });
  assert.deepEqual(tilePosition(l, 4), { left: PADDING + (GUTTER + 100) + GUTTER, top: PADDING + l.rowH });
});

test('virtualisation: only the rows in view plus overscan are rendered, also for 1000 pages', () => {
  const l = gridLayout({ width: 2 * PADDING + 5 * (GUTTER + 120) + GUTTER, tile: 120, count: 1000 });
  assert.equal(l.columns, 5);
  const top = visibleRange(l, 0, 600, 2);
  assert.equal(top.start, 0);
  const rowsInView = Math.floor(600 / l.rowH) + 1;
  assert.equal(top.end, (rowsInView + 2) * 5);
  assert.ok(top.end - top.start < 60, 'a few rows, not 1000 tiles');
  // Halfway down: whole rows around the scroll position.
  const mid = visibleRange(l, 50 * l.rowH + PADDING, 600, 2);
  assert.equal(mid.start, 48 * 5);
  assert.equal(mid.start % l.columns, 0);
  assert.ok(mid.end - mid.start <= (rowsInView + 4) * 5);
  // At the bottom the range ends at the last tile.
  assert.equal(visibleRange(l, l.totalHeight, 600, 2).end, 1000);
  assert.deepEqual(visibleRange(gridLayout({ width: 500, tile: 120, count: 0 }), 0, 600), { start: 0, end: 0 });
});

test('the gap under the pointer: gutter and left half before a tile, right half after it', () => {
  const tile = 100;
  const l = gridLayout({ width: 2 * PADDING + 3 * (GUTTER + tile) + GUTTER, tile, count: 5 });
  const y0 = PADDING + 10;
  const x = (col, dx) => PADDING + col * (GUTTER + tile) + dx;
  assert.equal(gapAtPoint(l, x(0, 2), y0), 0, 'in the gutter of tile 0');
  assert.equal(gapAtPoint(l, x(0, GUTTER + 10), y0), 0, 'left half of tile 0');
  assert.equal(gapAtPoint(l, x(0, GUTTER + 80), y0), 1, 'right half of tile 0');
  assert.equal(gapAtPoint(l, x(2, GUTTER + 80), y0), 3, 'right half of the last tile in a row');
  const y1 = PADDING + l.rowH + 10;
  assert.equal(gapAtPoint(l, x(0, 5), y1), 3, 'start of the second row');
  assert.equal(gapAtPoint(l, x(2, 5), y1), 5, 'empty cell after the last tile: the end');
  assert.equal(gapAtPoint(l, 9999, 9999), 5, 'far below: the end');
  assert.equal(gapAtPoint(l, -50, -50), 0, 'above and left: the start');
});

test('scrolling a tile into view', () => {
  const l = gridLayout({ width: 2 * PADDING + 2 * (GUTTER + 100) + GUTTER, tile: 100, count: 40 });
  assert.equal(scrollTopFor(l, 0, 0, 400), null, 'already in view');
  const down = scrollTopFor(l, 30, 0, 400);
  assert.ok(down > 0);
  const { top } = tilePosition(l, 30);
  assert.ok(top >= down && top + l.tile + LABEL_HEIGHT <= down + 400 + PADDING);
  assert.equal(scrollTopFor(l, 0, 1000, 400), 0);
});
