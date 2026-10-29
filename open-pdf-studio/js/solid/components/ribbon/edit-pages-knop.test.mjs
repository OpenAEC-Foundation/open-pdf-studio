// Edit Pages (#764): the button on the Edit & Combine tab, the organizer's
// quick actions, checkboxes, batch bar, insert/split gap controls, zoom,
// virtualised grid, external PDF drops (browser and desktop), the split on
// Apply, and the strings in every locale. Source-level checks: the dialog
// itself runs in the app; its model and layout are tested on their own
// (page-edit-plan.test.mjs, organizer-grid.test.mjs) and Apply with real
// pdf-lib in page-manager-edit-pages.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bereikenUitDelen } from '../../../pdf/splits-logica.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dlg = bron('../dialogs/PageOrganizerDialog.jsx');

test('an Edit Pages button on the Edit & Combine tab opens the organizer', () => {
  const tab = bron('./OrganizeTab.jsx');
  const at = tab.indexOf('id="edit-pages"');
  assert.ok(at >= 0, 'the button exists');
  assert.ok(at < tab.indexOf('id="insert-page"'), 'first in the Pages group: the primary action');
  const knop = tab.slice(at, tab.indexOf('/>', at));
  assert.match(knop, /onClick=\{openEditPages\}/);
  assert.match(knop, /label=\{t\('organize\.editPages'\)\}/);
  assert.match(knop, /disabled=\{ro\(\)\}/);
  const lijf = tab.slice(tab.indexOf('function openEditPages('), tab.indexOf('}', tab.indexOf('function openEditPages(')) + 1);
  assert.match(lijf, /openDialog\('page-organizer'/, 'the same organizer as Reorder');
  const scenario = bron('../../../../../tests/protocol/scenarios/a-organize.json');
  assert.match(scenario, /"clickButton", "id": "edit-pages"/);
});

test('quick actions on every tile: rotate left, rotate right, delete; a selection checkbox', () => {
  const tegel = dlg.slice(dlg.indexOf('class="page-organizer-tile"'), dlg.indexOf('<Show when={insertMenu()}>'));
  assert.match(tegel, /class="page-organizer-actions"/);
  assert.match(tegel, /rotate\(\[e\.key\], -90\)/);
  assert.match(tegel, /rotate\(\[e\.key\], 90\)/);
  assert.match(tegel, /remove\(\[e\.key\]\)/);
  assert.match(tegel, /type="checkbox" class="page-organizer-check"/);
  assert.match(tegel, /toggleKey\(e\.key\)/);
  const css = bron('../../../../styles/page-organizer.css');
  assert.match(css, /\.page-organizer-tile:hover \.page-organizer-actions/, 'shown on hover');
  assert.match(css, /\.page-organizer-tile\.focused \.page-organizer-actions/, 'and on the keyboard focus');
  assert.match(css, /\.page-organizer-tile\.selected \.page-organizer-frame \{[^}]*border-color/, 'highlighted border when selected');
});

test('batch bar: rotate, delete, extract and split the selection; undo/redo of pending edits', () => {
  const balk = dlg.slice(dlg.indexOf('class="page-organizer-toolbar"'), dlg.indexOf('class="page-organizer-hint"'));
  for (const id of ['rotate-left', 'rotate-right', 'delete', 'extract', 'split', 'insert-blank', 'insert-file', 'undo', 'redo']) {
    assert.match(balk, new RegExp(`id="page-organizer-${id}"`), id);
  }
  assert.match(balk, /onClick=\{extract\}/);
  assert.match(balk, /onClick=\{splitSelection\}/);
  assert.match(dlg, /extractPlannedPages\(plan\(\), keys/);
  assert.match(dlg, /splitAroundSelection\(plan\(\), selectedKeys\(\)\)/);
  assert.match(dlg, /undoHistory\(history\(\)\)/);
  assert.match(dlg, /ctrl && lower === 'z'/);
});

test('deleting every page is refused with a warning', () => {
  const lijf = dlg.slice(dlg.indexOf('const remove = (keys) =>'), dlg.indexOf('const moveBy'));
  assert.match(lijf, /deleteEntries\(plan\(\), keys\)/);
  assert.match(lijf, /if \(refused\) \{[\s\S]*showMessage\(tCommon\('cannotDeleteAllPages'\)\)[\s\S]*return;/);
});

test('every gap has an insert (+) control on top and a split (scissors) control below it', () => {
  const gat = dlg.slice(dlg.indexOf('class="page-organizer-gutter"'), dlg.indexOf('<For each={visible()}>'));
  const plus = gat.indexOf('innerHTML={ICON.insert}');
  const schaar = gat.indexOf('innerHTML={ICON.split}');
  assert.ok(plus > 0 && schaar > plus, 'scissors below the plus');
  assert.match(gat, /toggleSplitAt\(g\)/);
  assert.match(gat, /page-organizer-split-mark/);
  assert.match(gat, /page-organizer-drop-mark/);
  assert.match(dlg, /addBlank\(m\(\)\.gap\)/, 'insert menu: blank page');
  assert.match(dlg, /addFromFile\(m\(\)\.gap\)/, 'insert menu: pages from a file');
  const css = bron('../../../../styles/page-organizer.css');
  assert.match(css, /\.page-organizer-gutter \{[^}]*flex-direction: column/, 'stacked vertically');
});

test('zoom: a slider, buttons, Ctrl+wheel and Ctrl+plus/minus', () => {
  assert.match(dlg, /type="range" class="page-organizer-zoom-slider"/);
  assert.match(dlg, /on:wheel=\{handleWheel\}/);
  const wiel = dlg.slice(dlg.indexOf('const handleWheel'), dlg.indexOf('// ── Pending operations'));
  assert.match(wiel, /e\.ctrlKey \|\| e\.metaKey/);
  assert.match(wiel, /e\.preventDefault\(\)/);
  assert.match(wiel, /zoomStep\(/);
  assert.match(dlg, /ZOOM_LEVELS\[zoom\(\)\]/);
});

test('virtualised grid: only the tiles in view are rendered, thumbnails asked for on demand', () => {
  assert.match(dlg, /visibleRange\(layout\(\), scrollTop\(\), viewH\(\)\)/);
  assert.match(dlg, /entries\(\)\.slice\(range\(\)\.start, range\(\)\.end\)/);
  assert.match(dlg, /<For each=\{visible\(\)\}>/);
  assert.doesNotMatch(dlg, /<For each=\{entries\(\)\}>/, 'never all tiles at once');
  assert.match(dlg, /prioritizeThumbnails\(pages\)/);
  const paneel = bron('../../../ui/panels/left-panel.js');
  assert.match(paneel, /export function prioritizeThumbnails\(pageNums\)/);
  assert.match(bron('../../../../styles/page-organizer.css'), /\.page-organizer-tile \{[^}]*position: absolute/);
});

test('an external PDF dropped on the grid is inserted at the drop position', () => {
  // Browser: HTML drop with files.
  const drop = dlg.slice(dlg.indexOf('const handleDrop'), dlg.indexOf('const handleDragLeave'));
  assert.match(drop, /gapAtPoint\(layout\(\), x, y\)/);
  assert.match(drop, /addSource\(f\.name, new Uint8Array\(await f\.arrayBuffer\(\)\), at\)/);
  assert.match(dlg, /insertSource\(plan\(\), gap, id, pdf\.numPages\)/);
  // Desktop: setup.js routes the webview's file drop to the organizer.
  assert.match(dlg, /setPageDropTarget\(\{/);
  const setup = bron('../../../ui/setup.js');
  const tauri = setup.slice(setup.indexOf('function setupTauriDragDrop'), setup.indexOf('function updateDockHighlight'));
  const route = tauri.indexOf('const organizer = pageDropTarget();');
  assert.ok(route > 0 && route < tauri.indexOf('createTab(filePath)'), 'before a dropped PDF opens in a tab');
  assert.match(tauri, /organizer\.drop\(event\.payload\.paths \|\| \[\], x, y\);\n\s*return;/);
});

test('Apply: one applyPageEdits call, then the split marks are written as separate files', () => {
  const apply = dlg.slice(dlg.indexOf('const apply = async'), dlg.indexOf('// ── Selection'));
  assert.match(apply, /splitRanges\(p\)/);
  assert.match(apply, /openFolderDialog\(/);
  assert.match(apply, /splitsDocument\(\{ modus: 'ranges', delen: ranges/);
  assert.ok(apply.indexOf('applyPageEdits(') < apply.indexOf('splitsDocument('), 'parts of the edited document');
  const app = bron('../../../pdf/splits-app.js');
  assert.match(app, /delen: gekozen,/);
});

test('split ranges from the marks are checked before the parts are made', () => {
  assert.deepEqual(bereikenUitDelen([{ start: 1, eind: 2 }, { start: 3, eind: 5 }], 5), [{ start: 1, eind: 2 }, { start: 3, eind: 5 }]);
  assert.deepEqual(bereikenUitDelen([{ start: 0, eind: 2 }, { start: 2, eind: 1 }, { start: 4, eind: 9 }, { start: 3, eind: 3 }], 5), [{ start: 3, eind: 3 }]);
  assert.deepEqual(bereikenUitDelen([{ start: 1, eind: 3 }, { start: 2, eind: 4 }], 5), [{ start: 1, eind: 3 }], 'no overlap');
  assert.deepEqual(bereikenUitDelen(null, 5), []);
  assert.match(bron('../../../pdf/splits-document.js'), /if \(modus === 'ranges'\) return bereikenUitDelen\(delen, totaal\);/);
});

test('organizer styles: squared corners, default cursor, no animations', () => {
  const css = bron('../../../../styles/page-organizer.css');
  assert.doesNotMatch(css, /border-radius:\s*[1-9]/);
  assert.doesNotMatch(css, /cursor:\s*(pointer|move|grab)/);
  assert.doesNotMatch(css, /\b(transition|animation)\s*:/);
});

test('every locale has real translations of the Edit Pages strings', () => {
  const map = new URL('../../../i18n/locales/', import.meta.url);
  const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, map), 'utf8').replace(/\r\n/g, '\n'));
  const en = lees('en', 'dialogs').pageOrganizer;
  const enRibbon = lees('en', 'ribbon').organize;
  const sleutels = ['title', 'hint', 'rotateLeft', 'rotateRight', 'split', 'splitTitle', 'splitHere', 'extractTitle',
    'blankPage', 'pagesFromFile', 'insertHere', 'select', 'zoom', 'parts', 'chooseFolder', 'fileFailed',
    'applyFailed', 'extractFailed'];
  for (const s of sleutels) assert.ok(en[s], `en.${s}`);
  for (const s of new Set([...dlg.matchAll(/t\('pageOrganizer\.(\w+)'/g)].map((m) => m[1]))) {
    assert.ok(en[s], `the dialog uses pageOrganizer.${s}, which exists`);
  }
  assert.equal(en.title, 'Edit Pages');
  assert.equal(enRibbon.editPages, 'Edit Pages');
  const talen = readdirSync(map);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const po = lees(taal, 'dialogs').pageOrganizer;
    const org = lees(taal, 'ribbon').organize;
    for (const s of sleutels) assert.ok(typeof po[s] === 'string' && po[s].trim(), `${taal}.${s}`);
    assert.ok(org.editPages?.trim() && org.editPagesTitle?.trim(), `${taal} ribbon`);
    assert.match(po.parts, /\{\{count\}\}/, `${taal}.parts`);
    for (const s of ['fileFailed']) assert.match(po[s], /\{\{name\}\}.*\{\{error\}\}|\{\{error\}\}.*\{\{name\}\}/, `${taal}.${s}`);
    for (const s of ['applyFailed', 'extractFailed']) assert.match(po[s], /\{\{error\}\}/, `${taal}.${s}`);
    if (taal !== 'en') {
      for (const s of ['title', 'hint', 'splitHere', 'blankPage', 'pagesFromFile', 'insertHere', 'chooseFolder']) {
        assert.notEqual(po[s], en[s], `${taal}.${s} is translated`);
      }
      assert.notEqual(org.editPagesTitle, enRibbon.editPagesTitle, `${taal} ribbon title is translated`);
    }
  }
});
