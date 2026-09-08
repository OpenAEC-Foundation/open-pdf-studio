import assert from 'node:assert/strict';
import test from 'node:test';

import { hoeklijnTemplate, hoeklijnPts, HOEKLIJN_TABEL } from './staalprofiel.js';

test('tabel: gelijkzijdige én ongelijkzijdige maten, alle rijen geldig', () => {
  const gelijk = HOEKLIJN_TABEL.filter(r => r[1] === r[2]);
  const ongelijk = HOEKLIJN_TABEL.filter(r => r[1] !== r[2]);
  assert.ok(gelijk.length >= 10, 'gelijkzijdig');
  assert.ok(ongelijk.length >= 10, 'ongelijkzijdig');
  for (const [maat, h, b, t, r] of HOEKLIJN_TABEL) {
    assert.match(maat, /^L \d+x\d+x[\d.]+$/, maat);
    assert.ok(h >= b && t > 0 && t < b && r >= 0, `maten van ${maat}`);
  }
  assert.ok(HOEKLIJN_TABEL.some(r => r[0] === 'L 200x110x12'), 'L 200x110 aanwezig');
  assert.ok(HOEKLIJN_TABEL.some(r => r[0] === 'L 150x110x10'), 'L 150x110 aanwezig');
});

test('contour: staande poot links, liggende poot onder, gesloten en binnen b×h', () => {
  const pts = hoeklijnPts(100, 150, 10, 12);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[1], { x: 10, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 0, y: 150 });
  assert.deepEqual(pts[pts.length - 2], { x: 100, y: 150 });
  for (const p of pts) {
    assert.ok(p.x >= -1e-9 && p.x <= 100 + 1e-9 && p.y >= -1e-9 && p.y <= 150 + 1e-9, JSON.stringify(p));
  }
  // De oksel ligt op (t, H - t): met radius zit er een boog tussen.
  assert.ok(pts.some(p => Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - (150 - 10 - 12)) < 1e-9), 'begin van de oksel-boog');
});

test('werkelijke maat: doorsnede b×h, boven- en zijaanzicht als band met vrije lengte', () => {
  const t = hoeklijnTemplate;
  assert.deepEqual(t.realSizeMm({ maat: 'L 200x100x10' }), { width: 100, height: 200 });
  assert.deepEqual(t.realSizeMm({ maat: 'L 200x100x10', aanzicht: 'boven' }), { width: null, height: 100 });
  assert.deepEqual(t.realSizeMm({ maat: 'L 200x100x10', aanzicht: 'zij' }), { width: null, height: 200 });
  assert.equal(t.freeAxis({ aanzicht: 'boven' }), 'x');
  assert.equal(t.freeAxis({}), null);
  // Schaalfactor werkt door.
  assert.deepEqual(t.realSizeMm({ maat: 'L 50x50x5', schaal: 2 }), { width: 100, height: 100 });
});

test('render: doorsnede is één gevulde ring; aanzichten geven een band met één lijn', () => {
  const t = hoeklijnTemplate;
  const bbox = { x: 0, y: 0, width: 100, height: 200 };
  const sec = t.render({ maat: 'L 200x100x10', hartlijn: false }, bbox);
  assert.equal(sec.length, 1);
  assert.equal(sec[0].kind, 'rings');
  assert.equal(sec[0].fill, true);
  const boven = t.render({ maat: 'L 200x100x10', aanzicht: 'boven', hartlijn: false }, { x: 0, y: 0, width: 400, height: 100 });
  assert.equal(boven.filter(c => c.kind === 'line').length, 1);
  assert.equal(boven.find(c => c.kind === 'line').y1, 10); // t = 10 mm op band van 100 mm → 10 px
});
