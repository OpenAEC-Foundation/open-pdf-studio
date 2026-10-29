// Eigen draaipunt (#826): draaien om het punt, schalen met het punt vast.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  kanDraaipunt, heeftEigenDraaipunt, draaipuntOpPagina, draaipuntVoorPunt,
  draaiOmDraaipunt, houdDraaipuntVast,
} from './draaipunt.js';

const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const vak = (o = {}) => ({ type: 'image', x: 100, y: 200, width: 200, height: 100, rotation: 0, ...o });

test('alleen afbeelding, stempel en handtekening; zonder veld het midden', () => {
  assert.equal(kanDraaipunt(vak()), true);
  assert.equal(kanDraaipunt(vak({ type: 'stamp' })), true);
  assert.equal(kanDraaipunt(vak({ type: 'box' })), false);
  assert.equal(heeftEigenDraaipunt(vak()), false);
  assert.equal(heeftEigenDraaipunt(vak({ draaipunt: { u: 0.5, v: 0.5 } })), false);
  const p = draaipuntOpPagina(vak());
  bijna(p.x, 200, 'x'); bijna(p.y, 250, 'y');
});

test('het draaipunt op een punt zetten en terugrekenen, ook gedraaid en buiten het vak', () => {
  for (const rotation of [0, 30, 90, 217]) {
    const a = vak({ rotation });
    for (const [px, py] of [[120, 210], [400, 50], [200, 250]]) {
      const dp = draaipuntVoorPunt(a, px, py);
      const terug = draaipuntOpPagina({ ...a, draaipunt: dp });
      bijna(terug.x, px, `x bij ${rotation}°`); bijna(terug.y, py, `y bij ${rotation}°`);
    }
  }
  assert.equal(draaipuntVoorPunt(vak(), 200, 250), undefined, 'het midden is geen eigen draaipunt');
});

test('draaien om het draaipunt: het punt blijft staan, de hoek is relatief aan het grijppunt', () => {
  const orig = vak({ draaipunt: { u: 0, v: 0 } }); // linksboven = (100, 200)
  // Greep gepakt recht boven het midden; muis een kwartslag verder om het draaipunt.
  const start = { x: 200, y: 140 };
  const p = { x: 100, y: 200 };
  const hoek = Math.atan2(start.y - p.y, start.x - p.x) + Math.PI / 2;
  const muis = { x: p.x + Math.cos(hoek) * 100, y: p.y + Math.sin(hoek) * 100 };
  const uit = draaiOmDraaipunt(orig, start.x, start.y, muis.x, muis.y);
  assert.equal(uit.rotation, 90);
  const na = draaipuntOpPagina({ ...orig, ...uit });
  bijna(na.x, 100, 'draaipunt x'); bijna(na.y, 200, 'draaipunt y');
  // Niet bewogen: geen sprong.
  const stil = draaiOmDraaipunt(orig, start.x, start.y, start.x, start.y);
  assert.equal(stil.rotation, 0);
  bijna(stil.x, orig.x, 'x'); bijna(stil.y, orig.y, 'y');
});

test('draaien snapt binnen 3° naar een veelvoud van 45°, tenzij uitgezet', () => {
  const orig = vak({ draaipunt: { u: 1, v: 1 }, rotation: 0 });
  const p = draaipuntOpPagina(orig);
  const start = { x: p.x + 100, y: p.y };
  const graden = (g) => ({ x: p.x + Math.cos(g * Math.PI / 180) * 100, y: p.y + Math.sin(g * Math.PI / 180) * 100 });
  const m = graden(43);
  assert.equal(draaiOmDraaipunt(orig, start.x, start.y, m.x, m.y).rotation, 45);
  assert.equal(draaiOmDraaipunt(orig, start.x, start.y, m.x, m.y, { snap: false }).rotation, 43);
});

test('schalen met een eigen draaipunt houdt het punt op zijn plek', () => {
  for (const rotation of [0, 25, 90]) {
    const orig = vak({ rotation, draaipunt: { u: 0.25, v: 0.75 } });
    const voor = draaipuntOpPagina(orig);
    // Zoals applyResize met de rechteronderhoek: groter, linksboven blijft.
    const geschaald = { ...orig, width: 300, height: 150 };
    const uit = houdDraaipuntVast(orig, geschaald);
    const na = draaipuntOpPagina({ ...geschaald, ...uit });
    bijna(na.x, voor.x, `x bij ${rotation}°`); bijna(na.y, voor.y, `y bij ${rotation}°`);
  }
});

test('de greep, het tekenen en het slepen zijn aangesloten', () => {
  const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const handles = lees('./handles.js');
  assert.match(handles, /if \(kanDraaipunt\(annotation\)\) \{[\s\S]{0,200}type: HANDLE_TYPES\.PIVOT/);
  assert.match(lees('./rendering/selection.js'), /handle\.type === HANDLE_TYPES\.PIVOT/);
  const kiezen = lees('../tools/tools/select-tool.js');
  assert.match(kiezen, /handleType === 'pivot' && e\.detail === 2[\s\S]{0,200}delete selAnn\.draaipunt/);
  const sleep = lees('../tools/tool-dispatcher.js');
  assert.match(sleep, /draaiOmDraaipunt\(_orig, state\.dragStartX, state\.dragStartY, coords\.x, coords\.y\)/);
  assert.match(sleep, /state\.activeHandle === 'pivot'[\s\S]{0,300}draaipuntVoorPunt\(state\.originalAnnotation, snappedX, snappedY\)/);
  assert.match(sleep, /houdDraaipuntVast\(state\.originalAnnotation, ann\)/);
});
