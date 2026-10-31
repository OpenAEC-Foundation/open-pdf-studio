// Eigen draaipunt op vormen (#826): de echte grepen, transformaties en de
// bijsnij-overlay. De pure rekensommen staan in draaipunt.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { getAnnotationHandles, findHandleAt } = await import('./handles.js');
const { applyResize, applyMove } = await import('./transforms.js');
const { draaipuntOpPagina, draaipuntVoorPunt, schaalDeltaOmDraaipunt, houdDraaipuntVast } =
  await import('./draaipunt.js');
const { maakSnapshot, pasSnapshotToe, pasBijsnijdingToe } = await import('./image-crop-overlay.js');
const { rectNaBijsnijden } = await import('./crop-geometrie.js');

const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const punt = (a, b, msg) => { bijna(a.x, b.x, `${msg} x`); bijna(a.y, b.y, `${msg} y`); };
const vorm = (o = {}) => ({ id: 'v', page: 1, type: 'box', x: 100, y: 200, width: 200, height: 100, rotation: 0, ...o });
const kloon = (a) => JSON.parse(JSON.stringify(a));
const VORMEN = ['image', 'box', 'mask', 'circle', 'highlight', 'polygon', 'cloud'];

// Zoals _handleResize in tool-dispatcher.js met een eigen draaipunt.
function schaal(orig, greep, dx, dy, shift = false) {
  const d = schaalDeltaOmDraaipunt(orig, greep, dx, dy);
  const ann = kloon(orig);
  applyResize(ann, greep, d.dx, d.dy, orig, shift, false, { schaal: 1 });
  const vast = houdDraaipuntVast(orig, ann);
  applyMove(ann, vast.x - ann.x, vast.y - ann.y);
  return ann;
}

test('elke vorm toont het vizier en het is te pakken, op elke zoom en draaiing', () => {
  for (const type of VORMEN) {
    for (const rotation of [0, 40, 90]) {
      for (const zoom of [0.25, 1, 4, 64]) {
        const a = vorm({ type, rotation });
        assert.ok(getAnnotationHandles(a, zoom).some(h => h.type === 'pivot'), `${type} ${rotation}° ${zoom}x`);
        // Het midden draait niet mee: daar staat het standaard-draaipunt.
        assert.equal(findHandleAt(200, 250, a, zoom), 'pivot', `${type} ${rotation}° ${zoom}x`);
      }
    }
  }
  assert.ok(!getAnnotationHandles(vorm({ type: 'textbox' }), 1).some(h => h.type === 'pivot'), 'tekstvak');
  assert.ok(!getAnnotationHandles(vorm({ locked: true }), 1).some(h => h.type === 'pivot'), 'vergrendeld');
});

test('verplaatsgreep: weg zolang het draaipunt in het midden staat, terug als het verplaatst is', () => {
  for (const [type, middengreep] of [['box', 'rect_center'], ['circle', 'circle_center']]) {
    const a = vorm({ type });
    assert.ok(!getAnnotationHandles(a, 1).some(h => h.type === middengreep), `${type}: geen middengreep`);
    a.draaipunt = { u: 0, v: 0 };
    assert.ok(getAnnotationHandles(a, 1).some(h => h.type === middengreep), `${type}: middengreep terug`);
    assert.equal(findHandleAt(200, 250, a, 1), middengreep, `${type}: midden verplaatst weer`);
  }
});

test('een piepkleine vorm houdt zijn verplaatsgreep; een eigen draaipunt blijft zichtbaar', () => {
  const box = vorm({ width: 10, height: 8 });
  const grepen = getAnnotationHandles(box, 1);
  assert.ok(!grepen.some(h => h.type === 'pivot'), 'geen standaard-draaipunt');
  assert.equal(findHandleAt(105, 204, box, 1), 'rect_center', 'midden verplaatst');
  const img = vorm({ type: 'image', width: 10, height: 8 });
  assert.equal(findHandleAt(105, 204, img, 1), null, 'afbeelding: het lijf verplaatst');
  // Ingezoomd is dezelfde vorm groot genoeg voor het vizier.
  assert.ok(getAnnotationHandles(box, 4).some(h => h.type === 'pivot'), 'ingezoomd wel');
  box.draaipunt = { u: 2, v: 0.5 };
  assert.ok(getAnnotationHandles(box, 1).some(h => h.type === 'pivot'), 'eigen draaipunt blijft');
});

test('een draaipunt op een hoekgreep blijft te pakken, de andere grepen blijven werken', () => {
  const a = vorm({ draaipunt: { u: 1, v: 1 } });
  assert.equal(findHandleAt(300, 300, a, 1), 'pivot');
  assert.equal(findHandleAt(100, 200, a, 1), 'tl');
  assert.equal(findHandleAt(200, 200, a, 1), 't');
  assert.equal(findHandleAt(200, 200 - 25, a, 1), 'rotate');
});

test('schalen om het draaipunt: het punt blijft staan en de hoek volgt de muis, ook gedraaid', () => {
  for (const type of ['image', 'box', 'circle', 'cloud', 'highlight']) {
    for (const rotation of [0, 30, 90, 270]) {
      for (const p of [{ x: 150, y: 225 }, { x: -20, y: 400 }]) {
        const basis = vorm({ type, rotation });
        const orig = { ...basis, draaipunt: draaipuntVoorPunt(basis, p.x, p.y) };
        for (const greep of ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']) {
          const uit = schaal(orig, greep, 23, -17);
          punt(draaipuntOpPagina(uit), p, `${type} ${rotation}° ${greep}`);
          assert.ok(uit.width > 0 && uit.height > 0);
        }
      }
    }
  }
  // Rechtsonder, draaipunt in het midden: de hoek ligt precies onder de muis.
  const orig = vorm({ draaipunt: { u: 0.5, v: 0.4 } });
  const uit = schaal(orig, 'br', 60, 30);
  punt({ x: uit.x + uit.width, y: uit.y + uit.height }, { x: 360, y: 330 }, 'hoek onder de muis');
});

test('schalen met vaste verhouding en een draaipunt op de rand van de greep', () => {
  const orig = vorm({ type: 'image', lockAspectRatio: true, draaipunt: { u: 0.25, v: 0.25 } });
  const voor = draaipuntOpPagina(orig);
  const uit = schaal(orig, 'br', 80, 10, true);
  punt(draaipuntOpPagina(uit), voor, 'vast punt');
  bijna(uit.width / uit.height, 2, 'verhouding');
  // Draaipunt op de rechterrand: de rechtergreep kan langs die as niet schalen.
  const rand = vorm({ draaipunt: { u: 1, v: 0.5 } });
  const r = schaal(rand, 'r', 30, 0);
  bijna(r.width, 200, 'breedte'); punt(draaipuntOpPagina(r), { x: 300, y: 250 }, 'rand');
});

test('een veelhoek met eigen hoekpunten schuift zijn punten mee met het vak', () => {
  const pts = [{ x: 100, y: 300 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
  const a = vorm({ type: 'polygon', points: kloon(pts), sides: 3, draaipunt: { u: 0, v: 1 } });
  applyMove(a, 15, -5);
  assert.deepEqual(a.points, pts.map(p => ({ x: p.x + 15, y: p.y - 5 })));
  assert.deepEqual(a.draaipunt, { u: 0, v: 1 }, 'draaipunt gaat mee met verplaatsen');
});

test('bijsnijden: draaipunt blijft op de pagina; snapshot zet het precies terug', () => {
  const a = vorm({ type: 'image', rotation: 30 });
  const vooraf = maakSnapshot(a);
  a.draaipunt = draaipuntVoorPunt(a, 150, 220);
  const nieuw = rectNaBijsnijden(a, { x: a.x + 40, y: a.y, w: 160, h: 100 }, 30);
  pasBijsnijdingToe(a, { l: 0.2, t: 0, r: 0, b: 0 }, nieuw);
  punt(draaipuntOpPagina(a), { x: 150, y: 220 }, 'na bijsnijden');
  bijna(a.cropLeft, 0.2, 'crop');
  const na = maakSnapshot(a);
  pasSnapshotToe(a, vooraf);
  assert.equal('draaipunt' in a, false, 'Escape: geen draaipunt meer');
  pasSnapshotToe(a, na);
  punt(draaipuntOpPagina(a), { x: 150, y: 220 }, 'opnieuw');
  // Zonder eigen draaipunt blijft er ook na bijsnijden geen over.
  const b = vorm({ type: 'image' });
  pasBijsnijdingToe(b, { l: 0.2, t: 0, r: 0, b: 0 }, rectNaBijsnijden(b, { x: 140, y: 200, w: 160, h: 100 }, 0));
  assert.equal('draaipunt' in b, false);
});
