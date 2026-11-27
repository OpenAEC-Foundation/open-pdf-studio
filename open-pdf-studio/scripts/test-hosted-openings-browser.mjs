// Doors and windows hosted by their wall in the real app (Chromium), issue
// #1229: place a door with the ribbon tool, refuse an overlapping one, drag
// the door along and away from its wall with the mouse, move, rotate and
// shorten the wall, delete either side, undo each step, save, check the
// saved appearance and reopen the file.
// Issue #1230: a typed width on the metric sheet, and on a sheet in feet the
// 6" wall, the 36" door and 48" window with the US plan symbol, widths typed
// as `32` and `3'-0"`, sliding, and the symbol after save and reopen.
//   node scripts/test-hosted-openings-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-hosted-openings-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18391, strictPort: false, hmr: false } });
let browser;
const close = (a, b, what, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b}`);
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });

  const pdf = await PDFDocument.create();
  pdf.addPage([1200, 800]);
  await page.evaluate(async (bytes) => {
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const view = await import('/js/pdf/pdf-viewport.js');
    const ruimte = await import('/js/pdf/weergave-ruimte.js');
    const { setTool } = await import('/js/tools/manager.js');
    const { runAppEvent } = await import('/js/mcp-bridge.js');
    const undo = await import('/js/core/undo-manager.js');
    const { hartVanSymbool } = await import('/js/plattegrond/gehoste-opening.js');
    const { setActiveTab } = await import('/js/solid/stores/ribbonStore.js');
    const tab = createTab('/hosted-openings.pdf');
    await loadPDF('/hosted-openings.pdf', tab.index, new Uint8Array(bytes));
    await getActiveDocument()._annotationCompletion;
    window.ho = { state, getActiveDocument, view, ruimte, setTool, runAppEvent, undo, hartVanSymbool, setActiveTab, createTab, loadPDF };
    // 0.1 page point per millimetre: the 1200 pt page is 12 m wide.
    const scale = await runAppEvent('mcp:set-measure-scale', { pixelsPerUnit: 0.1, unit: 'mm' });
    if (!scale.ok) throw new Error(JSON.stringify(scale));
  }, Array.from(await pdf.save()));

  const settle = () => page.waitForTimeout(250);
  // A page point (page units, y down) as a client position.
  const toClient = (x, y) => page.evaluate(([x, y]) => {
    const { getActiveDocument, view, ruimte } = window.ho;
    const doc = getActiveDocument();
    const r = document.getElementById('annotation-canvas').getBoundingClientRect();
    if (view.viewport.active && doc.filePath) {
      const s = view.worldToScreen(x, y);
      return { x: r.left + s.x, y: r.top + s.y };
    }
    const w = ruimte.paginaNaarWeergave(doc.currentPage, x, y, doc);
    return { x: r.left + w.x * doc.scale, y: r.top + w.y * doc.scale };
  }, [x, y]);
  const moveTo = async (x, y, steps = 1) => { const p = await toClient(x, y); await page.mouse.move(p.x, p.y, { steps }); };
  const clickAt = async (x, y) => { await moveTo(x, y); await page.mouse.down(); await page.mouse.up(); await settle(); };
  // What is on the sheet: the wall with its openings and each frame's place.
  const read = () => page.evaluate(() => {
    const { getActiveDocument, hartVanSymbool } = window.ho;
    const doc = getActiveDocument();
    const walls = doc.annotations.filter((a) => a.type === 'wall');
    const frames = doc.annotations.filter((a) => a.type === 'parametricSymbol');
    return {
      count: doc.annotations.length,
      undo: (doc.undoStack || []).length,
      walls: walls.map((w) => ({
        id: w.id, startX: w.startX, startY: w.startY, endX: w.endX, endY: w.endY,
        openings: (w.openingen || []).map((o) => ({ id: o.id, key: o.key, alongMm: o.afstandMm, widthMm: o.breedteMm, side: o.zijde })),
      })),
      frames: frames.map((f) => {
        const wall = walls.find((w) => w.id === f.params?.hostWallId);
        const centre = hartVanSymbool(f, 0.1, wall?.dikteMm || 300);
        return { id: f.id, symbolId: f.symbolId, hostWallId: f.params?.hostWallId, hostKey: f.params?.hostKey, rotation: f.rotation, centre };
      }),
    };
  });
  const app = (event, params) => page.evaluate(([event, params]) => window.ho.runAppEvent(event, params), [event, params]);

  // A hatched wall of 8000 mm, 300 mm thick, along y = 400.
  const wallReply = await app('mcp:floorplan', {
    action: 'wall', start: { x: 100, y: 400 }, end: { x: 900, y: 400 }, thicknessMm: 300, material: 'nen47-metselwerk-baksteen',
  });
  assert.equal(wallReply.ok, true, JSON.stringify(wallReply));
  const wallId = wallReply.wallIds[0];

  // 1. Place a door with the ribbon tool: hover the wall and click.
  await page.evaluate(() => window.ho.setActiveTab('drawing'));
  await page.waitForSelector('#dr-wall-door');
  assert.equal(await page.locator('#dr-wall-window').count(), 1, 'Window button next to Door');
  await page.locator('#dr-wall-door').click();
  await page.waitForFunction(() => window.ho.state.currentTool === 'wallDoor', null, { timeout: 10000 });
  await moveTo(390, 408);
  await clickAt(400, 408);                          // 3000 mm from the start, on the lower side of the wall
  let s = await read();
  assert.equal(s.walls.length, 1, 'placing a door leaves one wall annotation');
  assert.equal(s.count, 2);
  // The click is a screen position: at an arbitrary zoom it lands within a
  // fraction of a millimetre of the page point.
  close(s.walls[0].openings[0].alongMm, 3000, 'door at the clicked point', 0.5);
  assert.deepEqual(s.walls[0].openings.map((o) => [o.widthMm, o.side]), [[900, -1]], 'a 900 mm door swinging to the clicked side');
  const alongPlaced = s.walls[0].openings[0].alongMm;
  assert.equal(s.frames[0].hostWallId, wallId);
  assert.equal(s.frames[0].hostKey, s.walls[0].openings[0].key);
  close(s.frames[0].centre.x, 400, 'door centre x', 0.1);
  close(s.frames[0].centre.y, 400, 'door centre on the wall line');
  const undoAfterPlace = s.undo;

  // 2. A second door that would overlap the first is refused: nothing changes.
  await clickAt(430, 400);
  s = await read();
  assert.equal(s.count, 2, 'overlapping door refused');
  assert.equal(s.undo, undoAfterPlace, 'a refused door is no undo step');
  assert.match(await page.evaluate(() => document.querySelector('.status-bar')?.textContent || ''), /overlap/i, 'the refusal is reported');

  // 3. Drag the door 1 m along the wall and well away from it, with the mouse.
  await page.evaluate(() => window.ho.setTool('select'));
  // Leaving the tool takes its hint and refusal out of the status bar at once.
  assert.equal(await page.evaluate(() => window.ho.state.statusMessage), '', 'the door tool message is cleared when the tool is left');
  await moveTo(400, 400);
  await page.mouse.down();
  await moveTo(450, 430, 4);
  await moveTo(500, 520, 6);                        // +100 pt = 1000 mm along, 120 pt off the wall
  await settle();
  s = await read();                                 // still dragging: the gap follows live
  close(s.walls[0].openings[0].alongMm, alongPlaced + 1000, 'the gap follows while dragging', 1);
  close(s.frames[0].centre.y, 400, 'the door stays on the wall line while dragging');
  await page.mouse.up();
  await settle();
  s = await read();
  close(s.walls[0].openings[0].alongMm, alongPlaced + 1000, 'dragging the door 1 m moves the gap 1 m', 1);
  close(s.frames[0].centre.x, 500, 'the door is in the gap', 0.1);
  close(s.frames[0].centre.y, 400, 'dragged away from the wall, the door stays on the wall line');
  assert.equal(s.undo, undoAfterPlace + 1, 'the drag is one undo step');
  const alongAfterDrag = s.walls[0].openings[0].alongMm;
  await page.evaluate(() => window.ho.undo.undo());
  s = await read();
  assert.equal(s.walls[0].openings[0].alongMm, alongPlaced, 'undo moves the gap back');
  close(s.frames[0].centre.x, 400, 'undo moves the door back', 0.1);
  await page.evaluate(() => window.ho.undo.redo());
  s = await read();
  assert.equal(s.walls[0].openings[0].alongMm, alongAfterDrag);

  // 4. Moving the wall 500 mm moves its door 500 mm; one undo step.
  let before = s;
  let reply = await app('mcp:update-annotation', { id: wallId, props: { startY: 450, endY: 450 } });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  s = await read();
  close(s.frames[0].centre.y - before.frames[0].centre.y, 50, 'the door moved 500 mm with the wall');
  close(s.frames[0].centre.x, before.frames[0].centre.x, 'and not sideways');
  assert.equal(s.undo, before.undo + 1);
  await page.evaluate(() => window.ho.undo.undo());
  s = await read();
  close(s.frames[0].centre.y, 400, 'undo restores the door with the wall');
  assert.equal(s.walls[0].startY, 400);

  // 5. Rotating the wall 90 degrees about its start turns the door with it.
  before = s;
  reply = await app('mcp:update-annotation', { id: wallId, props: { endX: 100, endY: 1200 } });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  s = await read();
  close((((s.frames[0].rotation - before.frames[0].rotation) % 360) + 360) % 360, 90, 'the door turned 90 degrees');
  close(s.frames[0].centre.x, 100, 'the door is on the rotated wall');
  close(s.frames[0].centre.y, 400 + alongAfterDrag * 0.1, 'at the same distance from the wall start', 0.1);
  await page.evaluate(() => window.ho.undo.undo());

  // 6. Shortening the wall past the door slides the door back so it still fits.
  reply = await app('mcp:update-annotation', { id: wallId, props: { endX: 400 } });   // 3000 mm long
  assert.equal(reply.ok, true, JSON.stringify(reply));
  s = await read();
  assert.equal(s.walls[0].openings[0].alongMm, 2550, 'the door slid back to fit');
  close(s.frames[0].centre.x, 100 + 255, 'the frame is where the gap is');
  await page.evaluate(() => window.ho.undo.undo());
  s = await read();
  assert.equal(s.walls[0].openings[0].alongMm, alongAfterDrag);

  // 7. Wall and door selected and dragged together: the door keeps its place.
  await page.evaluate(() => {
    const doc = window.ho.getActiveDocument();
    doc.selectedAnnotations = [...doc.annotations];
    doc.selectedAnnotation = doc.annotations[0];
  });
  await moveTo(220, 400);                           // on the wall, left of the door
  await page.mouse.down();
  await moveTo(240, 430, 4);
  await moveTo(280, 470, 4);
  await page.mouse.up();
  await settle();
  s = await read();
  close(s.walls[0].startY, 470, 'the wall followed the mouse', 1);
  close(s.walls[0].startX, 160, 'in both directions', 1);
  assert.equal(s.walls[0].openings[0].alongMm, alongAfterDrag, 'moved together, the door keeps its place on the wall');
  close(s.frames[0].centre.y, s.walls[0].startY, 'and stays on the wall');
  close(s.frames[0].centre.x, s.walls[0].startX + alongAfterDrag * 0.1, 'at the same distance from the wall start', 0.1);
  await page.evaluate(() => window.ho.undo.undo());
  s = await read();
  assert.equal(s.walls[0].startY, 400, 'one undo step for the pair');
  close(s.frames[0].centre.y, 400, 'the door is back as well');

  // 8. Deleting the door closes the wall; undo brings door and gap back.
  await page.evaluate(() => {
    const doc = window.ho.getActiveDocument();
    const door = doc.annotations.find((a) => a.type === 'parametricSymbol');
    doc.selectedAnnotations = [door];
    doc.selectedAnnotation = door;
  });
  before = await read();
  // Without the "are you sure" question, as with the preference switched off.
  await page.evaluate(() => { window.ho.state.preferences.confirmBeforeDelete = false; });
  await moveTo(650, 600);                           // empty paper: the keyboard goes to the document
  await page.keyboard.press('Delete');
  await settle();
  s = await read();
  assert.equal(s.count, 1, 'the door is deleted');
  assert.deepEqual(s.walls[0].openings, [], 'the wall is closed');
  assert.equal(s.undo, before.undo + 1, 'one undo step');
  await page.evaluate(() => window.ho.undo.undo());
  s = await read();
  assert.equal(s.count, 2, 'undo brings the door back');
  assert.equal(s.walls[0].openings.length, 1, 'and the gap');

  // 9. Deleting the wall also deletes its door; undo restores both.
  before = s;
  reply = await app('mcp:delete-annotation', { id: wallId });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  s = await read();
  assert.equal(s.count, 0, 'the wall took its door along');
  assert.equal(s.undo, before.undo + 1, 'in the same undo step');
  await page.evaluate(() => window.ho.undo.undo());
  s = await read();
  assert.equal(s.count, 2);
  assert.equal(s.walls[0].openings[0].alongMm, alongAfterDrag);
  assert.equal(s.frames[0].hostWallId, s.walls[0].id);

  // A window through MCP in the same wall, for the save.
  reply = await app('mcp:floorplan', { action: 'opening', wallId, kind: 'window', widthMm: 1200, alongMm: 6500 });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const refused = await app('mcp:floorplan', { action: 'opening', wallId, kind: 'door', widthMm: 900, alongMm: 6900 });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'overlap');
  s = await read();
  assert.equal(s.walls.length, 1);
  assert.deepEqual(s.walls[0].openings.map((o) => o.alongMm), [alongAfterDrag, 6500]);

  // 10. Save: the wall keeps its openings and its appearance stops at the jambs.
  const bytes = await page.evaluate(async () => {
    const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(window.ho.getActiveDocument());
    return Array.from(await pdfDocLib.save());
  });
  const saved = await PDFDocument.load(new Uint8Array(bytes));
  const annots = saved.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map((ref) => saved.context.lookup(ref));
  const wallDict = annots.find((d) => d.get(PDFName.of('OPS_Subtype'))?.decodeText?.() === 'wall');
  assert.ok(wallDict, 'the wall is saved');
  assert.equal(annots.filter((d) => d.get(PDFName.of('OPS_Subtype'))?.decodeText?.() === 'wall').length, 1, 'one wall in the file');
  const stored = JSON.parse(wallDict.lookup(PDFName.of('OPS_Openings')).decodeText());
  assert.deepEqual(stored.map((o) => [Math.round(o.afstandMm), o.breedteMm, o.soort]), [[Math.round(alongAfterDrag), 900, 'deur'], [6500, 1200, 'raam']]);
  assert.ok(stored.every((o) => typeof o.key === 'string' && o.key && !('id' in o)), 'keys, no annotation ids');
  const ap = wallDict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const content = Buffer.from(ap instanceof PDFRawStream ? decodePDFRawStream(ap).decode() : ap.getContents()).toString('latin1');
  // Background fill and hatch clip: one closed path per solid piece (three
  // pieces around two openings), never the whole band.
  const fills = (content.match(/h\s+f\b/g) || []).length;
  const clips = (content.match(/h\s+W n/g) || []).length;
  assert.equal(fills, 3, `three filled pieces in the saved appearance, found ${fills}`);
  assert.equal(clips, 3, `the hatch is clipped per solid piece, found ${clips}`);

  // 11. Reopen: the gaps are still there and the door still slides along the wall.
  await page.evaluate(async (bytes) => {
    const { getActiveDocument, createTab, loadPDF } = window.ho;
    const tab = createTab('/hosted-openings-reopened.pdf');
    await loadPDF('/hosted-openings-reopened.pdf', tab.index, new Uint8Array(bytes));
    await getActiveDocument()._annotationCompletion;
    // The app remembers the measurement scale per file; this is a new path.
    const scale = await window.ho.runAppEvent('mcp:set-measure-scale', { pixelsPerUnit: 0.1, unit: 'mm' });
    if (!scale.ok) throw new Error(JSON.stringify(scale));
  }, bytes);
  await settle();
  const reopened = await read();
  assert.equal(reopened.walls.length, 1);
  assert.notEqual(reopened.walls[0].id, wallId, 'a reopened file has new annotation ids');
  assert.deepEqual(reopened.walls[0].openings.map((o) => [Math.round(o.alongMm), o.widthMm]), [[Math.round(alongAfterDrag), 900], [6500, 1200]]);
  assert.equal(reopened.frames.length, 2);
  for (const opening of reopened.walls[0].openings) {
    const frame = reopened.frames.find((f) => f.id === opening.id);
    assert.ok(frame, 'every opening has its frame again');
    assert.equal(frame.hostWallId, reopened.walls[0].id);
  }
  const door = reopened.frames.find((f) => f.symbolId === 'door');
  await page.evaluate(() => window.ho.setTool('select'));
  await moveTo(door.centre.x, door.centre.y);
  await page.mouse.down();
  await moveTo(door.centre.x - 40, door.centre.y + 30, 4);
  await moveTo(door.centre.x - 100, door.centre.y + 90, 6);
  await page.mouse.up();
  await settle();
  s = await read();
  const movedDoor = s.frames.find((f) => f.symbolId === 'door');
  const movedOpening = s.walls[0].openings.find((o) => o.id === movedDoor.id);
  close(movedOpening.alongMm, alongAfterDrag - 1000, 'after reopening, dragging still slides the door along the wall', 1);
  close(movedDoor.centre.y, 400, 'and keeps it on the wall line');

  // ── #1230: typed width on the metric sheet ──────────────────────────────
  const statusText = () => page.evaluate(() => document.querySelector('.status-bar')?.textContent || '');
  const chooseTool = async (button, tool) => {
    // A selection may have brought a contextual tab forward.
    await page.evaluate(() => window.ho.setActiveTab('drawing'));
    await page.waitForSelector(button);
    await page.locator(button).click();
    await page.waitForFunction((t) => window.ho.state.currentTool === t, tool, { timeout: 10000 });
    await settle();
  };
  // The frames of the active sheet: what they are and what their symbol draws.
  const frames = () => page.evaluate(async () => {
    const { getTemplate } = await import('/js/symbols/registry.js');
    const doc = window.ho.getActiveDocument();
    const walls = doc.annotations.filter((a) => a.type === 'wall');
    return {
      walls: walls.map((w) => ({
        id: w.id, thicknessMm: w.dikteMm, hatch: w.hatchPattern,
        openings: (w.openingen || []).map((o) => ({ id: o.id, alongMm: o.afstandMm, widthMm: o.breedteMm, side: o.zijde })),
      })),
      frames: doc.annotations.filter((a) => a.type === 'parametricSymbol').map((f) => ({
        id: f.id, symbolId: f.symbolId, widthMm: f.params.width, style: f.params.symboolStijl || null,
        leafMm: f.params.deurbladDikteMm ?? null, hostWallId: f.params.hostWallId,
        width: f.width, height: f.height, rotation: f.rotation,
        draws: getTemplate(f.symbolId).render(f.params, { x: f.x, y: f.y, width: f.width, height: f.height }).map((c) => c.kind),
      })),
    };
  });
  await chooseTool('#dr-wall-window', 'wallWindow');
  assert.match(await statusText(), /1200 mm/, 'the hint shows the metric default width');
  await moveTo(250, 400);
  assert.equal(await page.getByText('type width + Enter').count(), 1, 'the typed-width field follows the pointer');
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');
  await settle();
  assert.match(await statusText(), /1000 mm/, 'on a metric sheet a bare number is millimetres');
  await clickAt(250, 400);                          // 1500 mm from the wall start
  let f = await frames();
  let typed = f.frames.find((x) => x.widthMm === 1000);
  assert.ok(typed, 'a window of the typed width');
  assert.equal(typed.style, null, 'metric sheet: the frame symbol, as before');
  assert.ok(typed.draws.filter((k) => k === 'polyline').length >= 2, 'with its timber stiles');
  close(f.walls[0].openings.find((o) => o.id === typed.id).alongMm, 1500, 'at the clicked point', 0.5);
  assert.equal(f.walls[0].thicknessMm, 300);

  // ── #1230: a sheet in feet, 1/4" = 1'-0" (18 pt per foot) ──────────────
  await page.evaluate(async (bytes) => {
    const { getActiveDocument, createTab, loadPDF, runAppEvent, setTool } = window.ho;
    setTool('select');
    const tab = createTab('/hosted-openings-feet.pdf');
    await loadPDF('/hosted-openings-feet.pdf', tab.index, new Uint8Array(bytes));
    await getActiveDocument()._annotationCompletion;
    const scale = await runAppEvent('mcp:set-measure-scale', { pixelsPerUnit: 18, unit: 'ft' });
    if (!scale.ok) throw new Error(JSON.stringify(scale));
  }, Array.from(await pdf.save()));
  await settle();
  // A wall of 40 ft without further choices: 6" thick, no hatch.
  const feetWall = await app('mcp:floorplan', { action: 'wall', start: { x: 100, y: 400 }, end: { x: 820, y: 400 } });
  assert.equal(feetWall.ok, true, JSON.stringify(feetWall));
  f = await frames();
  assert.deepEqual([f.walls[0].thicknessMm, f.walls[0].hatch], [152.4, 'none'], 'a plain 6 inch wall on a feet sheet');

  // A door with the ribbon tool: 36", leaf and swing arc only.
  await chooseTool('#dr-wall-door', 'wallDoor');
  assert.match(await statusText(), /36"/, 'the hint shows the US default width');
  await moveTo(180, 403);
  await clickAt(190, 403);                          // 5 ft from the start, lower side of the wall
  f = await frames();
  assert.equal(f.frames.length, 1);
  let usDoor = f.frames[0];
  close(usDoor.widthMm, 914.4, 'a door is 36 inch wide by default', 1e-6);
  assert.equal(usDoor.style, 'us', 'with the US plan symbol');
  assert.deepEqual(usDoor.draws, ['polyline', 'arc'], 'a leaf and its swing arc, no frame stiles');
  close(usDoor.leafMm, 44.45, 'a leaf of 1-3/4 inch', 1e-6);
  close(usDoor.width, 54, 'the symbol is 36 inch wide on the sheet', 1e-6);
  assert.deepEqual(f.walls[0].openings.map((o) => [o.widthMm, o.side]), [[914.4, -1]], 'the gap is 36 inch; the door swings to the clicked side');
  close(f.walls[0].openings[0].alongMm, 5 * 304.8, 'at the clicked point', 2);

  // Typing 32 and Enter: a bare number is inches on a feet sheet.
  await moveTo(330, 397);
  await page.keyboard.type('32');
  await page.keyboard.press('Enter');
  await settle();
  assert.match(await statusText(), /32"/, 'the hint shows the typed width');
  await clickAt(330, 397);
  f = await frames();
  assert.equal(f.frames.length, 2);
  close(f.frames[1].widthMm, 32 * 25.4, 'typing 32 gives a 32 inch door', 1e-6);
  assert.equal(f.frames[1].style, 'us');
  // Typing 3'-0" and Enter: feet and inches.
  await moveTo(470, 403);
  await page.keyboard.type('3\'-0"');
  await page.keyboard.press('Enter');
  await settle();
  assert.match(await statusText(), /36"/, 'the hint shows 3 ft as 36 inch');
  await clickAt(470, 403);
  f = await frames();
  assert.equal(f.frames.length, 3);
  close(f.frames[2].widthMm, 914.4, 'typing 3\'-0" gives a 36 inch door', 1e-6);

  // A window: 48", two wall faces, two jambs and one glass line.
  await chooseTool('#dr-wall-window', 'wallWindow');
  assert.match(await statusText(), /48"/, 'choosing the tool again starts from the default width');
  await moveTo(650, 400);
  await clickAt(660, 400);
  f = await frames();
  const usWindow = f.frames.find((x) => x.symbolId === 'window');
  close(usWindow.widthMm, 1219.2, 'a window is 48 inch wide by default', 1e-6);
  assert.equal(usWindow.style, 'us');
  assert.deepEqual(usWindow.draws, ['line', 'line', 'line', 'line', 'line'], 'two faces, two jambs, a centre glass line');
  close(usWindow.width, 72, 'the window is 48 inch wide on the sheet', 1e-6);
  close(usWindow.height, 9, 'and as deep as the 6 inch wall', 1e-6);
  assert.equal(f.walls.length, 1, 'still one wall');
  assert.equal(f.walls[0].openings.length, 4);

  // The US door slides along its wall like any hosted frame and keeps its symbol.
  await page.evaluate(() => window.ho.setTool('select'));
  const alongUs = f.walls[0].openings.find((o) => o.id === usDoor.id).alongMm;
  await moveTo(190, 400);
  await page.mouse.down();
  await moveTo(200, 430, 4);
  await moveTo(226, 480, 6);                        // 2 ft along the wall, well off it
  await page.mouse.up();
  await settle();
  f = await frames();
  close(f.walls[0].openings.find((o) => o.id === usDoor.id).alongMm, alongUs + 2 * 304.8, 'the US door slid 2 ft along the wall', 3);
  usDoor = f.frames.find((x) => x.id === usDoor.id);
  assert.deepEqual([usDoor.style, usDoor.draws.join()], ['us', 'polyline,arc']);

  // Save and reopen: the symbol style is stored on the frame, so the file
  // shows the same symbols before any scale or preference is applied.
  const feetBytes = await page.evaluate(async () => {
    const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(window.ho.getActiveDocument());
    return Array.from(await pdfDocLib.save());
  });
  await page.evaluate(async (bytes) => {
    const { getActiveDocument, createTab, loadPDF } = window.ho;
    const tab = createTab('/hosted-openings-feet-reopened.pdf');
    await loadPDF('/hosted-openings-feet-reopened.pdf', tab.index, new Uint8Array(bytes));
    await getActiveDocument()._annotationCompletion;
  }, feetBytes);
  await settle();
  const again = await frames();
  assert.equal(again.walls.length, 1);
  assert.deepEqual(again.frames.map((x) => [x.symbolId, x.style, Math.round(x.widthMm * 10) / 10]).sort(),
    [['door', 'us', 812.8], ['door', 'us', 914.4], ['door', 'us', 914.4], ['window', 'us', 1219.2]].sort());
  assert.deepEqual(again.frames.find((x) => x.symbolId === 'window').draws, ['line', 'line', 'line', 'line', 'line']);
  assert.ok(again.frames.filter((x) => x.symbolId === 'door').every((x) => x.draws.join() === 'polyline,arc'));
  assert.ok(again.frames.every((x) => x.hostWallId === again.walls[0].id), 'and they are hosted again');

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({
    passed: true, wall: 1, openings: s.walls[0].openings.map((o) => Math.round(o.alongMm)), savedPieces: fills,
    feetSheet: again.frames.map((x) => `${x.symbolId} ${Math.round(x.widthMm / 25.4 * 100) / 100}"`),
  }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
