import assert from 'node:assert/strict';
import test from 'node:test';
import { posterIndeling } from './print-poster.js';
import { posterGrid, posterSheetOverlaps } from './print-poster-grid.js';

const layout = (options = {}, page = [594, 841], orientation = 'portrait') => posterIndeling({
  papier: { breedteMm: 297, hoogteMm: 420 }, orientatie: orientation,
  pagina: { breedtePt: page[0] * 72 / 25.4, hoogtePt: page[1] * 72 / 25.4 },
  opties: { schaal: 100, overlap: 10, snijtekens: true, labels: true, alleenGroot: true, ...options },
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('composite follows every printed tile at several scales and orientations', () => {
  for (const orientation of ['portrait', 'landscape', 'auto']) {
    for (const scale of [10, 75, 100, 400]) {
      const l = layout({ schaal: scale, alleenGroot: false }, [594, 841], orientation);
      const g = posterGrid(l);
      assert.equal(g.tiles.length, l.vellen.length);
      for (let i = 0; i < g.tiles.length; i++) {
        const tile = g.tiles[i], sheet = l.vellen[i];
        assert.equal(tile.number, i + 1);
        near(tile.x, sheet.tegel.x); near(tile.y, sheet.tegel.y);
        near(tile.width, sheet.venster.breedte); near(tile.height, sheet.venster.hoogte);
        // The source page origin in each physical sheet maps back to 0,0.
        near(tile.x + sheet.plaatsing.pagina.x - sheet.venster.x, 0);
        near(tile.y + sheet.plaatsing.pagina.y - sheet.venster.y, 0);
        assert.ok(tile.x >= g.bounds.x && tile.y >= g.bounds.y);
        assert.ok(tile.x + tile.width <= g.bounds.x + g.bounds.width + 1e-8);
      }
    }
  }
});

test('detail highlights exactly the repeated strips in the adjacent printed sheets', () => {
  const l = layout();
  const g = posterGrid(l);
  assert.ok(g.overlaps.length > 0);
  const middle = l.vellen.find(v => v.rij === 2 && v.kol === 2);
  assert.equal(posterSheetOverlaps(l, middle).length, 4);
  for (const sheet of l.vellen) {
    for (const r of posterSheetOverlaps(l, sheet)) {
      assert.ok(r.x >= sheet.venster.x - 1e-8 && r.y >= sheet.venster.y - 1e-8);
      assert.ok(Math.abs(r.width - l.overlap) < 1e-8 || Math.abs(r.height - l.overlap) < 1e-8);
      const x = r.x + sheet.tegel.x - sheet.venster.x;
      const y = r.y + sheet.tegel.y - sheet.venster.y;
      assert.ok(g.overlaps.some(o => Math.abs(o.x - x) < 1e-8 && Math.abs(o.y - y) < 1e-8
        && Math.abs(o.width - r.width) < 1e-8 && Math.abs(o.height - r.height) < 1e-8));
    }
  }
});

test('zero overlap has no highlighted strips, even at ISO rounding boundaries', () => {
  const l = layout({ overlap: 0, snijtekens: false, labels: false });
  assert.equal(l.vellen.length, 4);
  assert.deepEqual(posterGrid(l).overlaps, []);
  for (const sheet of l.vellen) assert.deepEqual(posterSheetOverlaps(l, sheet), []);
  // Full page remains visible in overview, including the fraction outside the grid.
  near(posterGrid(l).bounds.height, 841);
});

test('small and rotated single-sheet pages keep physical paper placement', () => {
  for (const page of [[210, 297], [297, 210]]) {
    const l = layout({}, page);
    assert.equal(l.getegeld, false);
    const g = posterGrid(l), p = l.vellen[0].plaatsing.pagina;
    near(g.page.x, p.x); near(g.page.y, p.y);
    near(g.page.width, p.breedte); near(g.page.height, p.hoogte);
    assert.equal(g.tiles.length, 1);
    near(g.bounds.width, l.vel.breedteMm); near(g.bounds.height, l.vel.hoogteMm);
    assert.deepEqual(g.overlaps, []);
    assert.deepEqual(posterSheetOverlaps(l, l.vellen[0]), []);
  }
  assert.equal(posterGrid(null), null);
});
