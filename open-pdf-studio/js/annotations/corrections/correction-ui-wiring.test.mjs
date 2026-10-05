// Bewaakt de bedrading van proefleescorrecties (#508) in de modules die in
// node niet te laden zijn (canvas, pdf.js, Solid-componenten): tekenen,
// raken, selecteren, slepen, verwijderen, draaien en de lijst. Het gedrag van
// de pure helpers staat in correction-ui.test.mjs, caret.test.mjs en
// correction-app.test.mjs; hier staat dat de app ze ook gebruikt.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// De oude, losse lijst met tekstmarkeringen: kende geen invoegteken.
const OUDE_LIJST = /\[\s*'textHighlight',\s*'textStrikethrough',\s*'textUnderline'\s*\]/;

/** Het stuk broncode van `case '<soort>':` tot de volgende `case '...':` op dezelfde inspringing. */
function caseBlok(tekst, soort, inspringing) {
  const kop = `\n${inspringing}case '${soort}':`;
  const begin = tekst.indexOf(kop);
  assert.ok(begin >= 0, `case '${soort}' gevonden`);
  const rest = tekst.slice(begin + kop.length);
  const volgende = rest.search(new RegExp(`\\n${inspringing}(case '|default:)`));
  return rest.slice(0, volgende < 0 ? undefined : volgende);
}

test('rendering.js tekent het invoegteken en de doorhaling langs verticale tekst', () => {
  const r = bron('../rendering.js');
  assert.match(r, /import \{[^}]*drawCaret[^}]*\} from '\.\/rendering\/caret\.js'/);
  assert.match(r, /import \{[^}]*strikeLine[^}]*\} from '\.\/rendering\/caret\.js'/);
  assert.match(caseBlok(r, 'caret', '    '), /drawCaret\(ctx, annotation, /);
  const door = caseBlok(r, 'textStrikethrough', '    ');
  assert.match(door, /strikeLine\(rect, annotation\.textDir\)/);
  assert.match(door, /strikeLine\(annotation, annotation\.textDir\)/);
  assert.match(door, /replaceStrikeColor\(annotation, /, 'de doorhaling van een vervanging in de kleur van haar invoegteken');
  assert.match(r, /import \{[^}]*replaceStrikeColor[^}]*\} from '\.\/rendering\/caret\.js'/);
});

test('selectie en grepen: het invoegteken hoort bij de tekstmarkeringen', () => {
  const sel = bron('../rendering/selection.js');
  assert.match(sel, /case 'textUnderline':\n\s*case 'caret': \{/);
  const grepen = bron('../handles.js');
  assert.match(grepen, /case 'textUnderline':\n\s*case 'caret':\n\s*return \{/);
  assert.match(grepen, /case 'textUnderline':\n\s*case 'caret':\n\s*\/\/ Text markup/);
});

test('raken: het vak van een invoegteken groeit met de tolerantie', () => {
  const g = bron('../geometry.js');
  assert.match(g, /from '\.\/corrections\/geometry\.js'/);
  assert.match(caseBlok(g, 'caret', '      '), /caretHit\(ann, x, y, tol\)/, 'findAnnotationAt');
  assert.match(caseBlok(g, 'caret', '    '), /caretHit\(annotation, x, y, /, 'isPointInsideAnnotation');
});

test('het annotatietype kent invoegteken en golflijn met hun velden', () => {
  const t = bron('../../types/annotation.ts');
  const soort = /export type AnnotationType =([\s\S]*?);/.exec(t)[1];
  assert.match(soort, /'caret'/);
  assert.match(soort, /'textSquiggly'/);
  for (const veld of ['textDir', 'intent', 'inReplyTo', 'replyType', 'symbol', 'markedText', 'nm', 'pdfSubject', 'groupId']) {
    assert.match(t, new RegExp(`\\n\\s+${veld}\\?: `), `veld ${veld}`);
  }
});

test('niet slepen, niet verschuiven, niet verplaatsen: overal isTextAnchored in plaats van de oude lijst', () => {
  for (const pad of ['../../tools/tools/select-tool.js', '../../tools/keyboard-handlers.js',
    '../../tools/edit-ops.js', '../../solid/stores/propertiesStore.js']) {
    const tekst = bron(pad);
    assert.doesNotMatch(tekst, OUDE_LIJST, `${pad}: geen losse lijst meer`);
    assert.doesNotMatch(tekst, /new Set\(\['textHighlight', 'textStrikethrough', 'textUnderline'\]\)/, `${pad}: geen losse set meer`);
    assert.match(tekst, /isTextAnchored\(/, `${pad} gebruikt isTextAnchored`);
    assert.match(tekst, /from '[./]*\/annotations\/corrections\/model\.js'|from '\.\.\/\.\.\/annotations\/corrections\/model\.js'/, `${pad} importeert het model`);
  }
  const kiezen = bron('../../tools/tools/select-tool.js');
  assert.match(kiezen, /const isTextMarkup = isTextAnchored\(clickedAnnotation\)/);
});

test('select-tool: een vervanging selecteert als geheel en toont het invoegteken', () => {
  const kiezen = bron('../../tools/tools/select-tool.js');
  assert.match(kiezen, /expandCorrectionGroups\(doc\.annotations, toSelect\)/);
  assert.match(kiezen, /replaceParentOf\(toSelect, doc\.annotations\)/);
  assert.match(kiezen, /ctx\.showProperties\(correctieOuder\)/);
  assert.match(kiezen, /bevatCorrectie\(/, 'geen Ctrl-sleepkopie van een correctie');
});

test('verwijderen en knippen nemen de hele vervanging mee, met één ongedaan-stap', () => {
  const toetsen = bron('../../tools/keyboard-handlers.js');
  assert.match(toetsen, /deleteAnnotationsWithUndo\(getActiveDocument\(\), selected\)/, 'Delete');
  assert.match(toetsen, /expandCorrectionGroups\(cutDoc\.annotations, /, 'Ctrl+X knipt beide helften');
  assert.match(toetsen, /deleteAnnotationsWithUndo\(cutDoc, cutSel\)/);

  const menu = bron('../../solid/components/ContextMenu.jsx');
  assert.equal((menu.match(/deleteAnnotationsWithUndo\(/g) || []).length, 4, 'knippen en verwijderen, enkel en meervoudig');
  assert.doesNotMatch(menu, /recordDelete\(a, idx\)/);

  const paneel = bron('../../solid/components/left-panel/panels/AnnotationsPanel.jsx');
  assert.equal((paneel.match(/deleteAnnotationsWithUndo\(/g) || []).length, 2, 'knippen en verwijderen uit de lijst');
});

test('ontbinden geeft een vervanging haar eigen groep terug', () => {
  const ops = bron('../segment-ops.js');
  const ontbind = ops.slice(ops.indexOf('export function explodeCollection'));
  assert.match(ontbind, /a\.groupId !== eigenGroep\(a\)/);
  assert.match(ontbind, /a\.groupId = eigenGroep\(a\);/);
});

test('pagina draaien draait ook de leesrichting', () => {
  const r = bron('../../pdf/renderer.js');
  const draai = r.slice(r.indexOf('function rotateAnnotation('), r.indexOf('function rotateAnnotationsForPage('));
  assert.match(draai, /ann\.textDir = rotateTextDir\(ann\.textDir, normDelta\)/);
  assert.match(draai, /isTextAnchored\(ann\)/);
});

test('de lijst vouwt vervangingen en toont naam en voorvertoning van de correctie', () => {
  const lijst = bron('../../ui/panels/annotations-list.js');
  assert.match(lijst, /withoutFoldedChildren\(filteredAnnotations, byId\)/);
  assert.match(lijst, /typeLabel: getAnnotationDisplayName\(ann, byId\)/);
  assert.match(lijst, /listPreview\(ann, byId\)/);
  const kiezen = lijst.slice(lijst.indexOf('export async function selectAnnotationItem'));
  assert.match(kiezen, /expandCorrectionGroups\(/);
  assert.match(kiezen, /replaceParentOf\(/);
  const helpers = bron('../../utils/helpers.js');
  assert.match(helpers, /export function getAnnotationDisplayName\(ann, annotations\)/);
  assert.match(helpers, /displayKey\(ann, annotations\)/);
});

test('verwijderen en knippen: een vervanging met een vergrendelde helft telt als vergrendeld', () => {
  const toetsen = bron('../../tools/keyboard-handlers.js');
  assert.match(toetsen, /import \{[^}]*replaceParentOf[^}]*\} from '\.\.\/annotations\/corrections\/model\.js'/);
  assert.match(toetsen,
    /if \(\(selected\.length === 1 \|\| replaceParentOf\(selected, getActiveDocument\(\)\.annotations\)\) && selected\.some\(a => a\.locked\)\) return;/,
    'Delete-toets: het paar als één annotatie');
  const menu = bron('../../solid/components/ContextMenu.jsx');
  assert.match(menu,
    /const isPaarVergrendeld = \(\) => \{[^}]*expandCorrectionGroups\(getActiveDocument\(\)\?\.annotations, \[a\]\)\.some\(x => x\.locked\)/,
    'contextmenu: vergrendeld als de partner vergrendeld is');
  for (const item of ["label={tCommon('cut')}", "label={tCommon('delete')}", "label={tCommon('flatten')}"]) {
    const regel = menu.split('\n').find((r) => r.includes(item));
    assert.match(regel, /disabled=\{isPaarVergrendeld\(\)\}/, item);
  }
  assert.match(menu, /if \(_sel\.some\(a => a\.locked && !_d\.selectedAnnotations\.includes\(a\)\)\) return;\n\s*copyAnnotations\(_sel\);/,
    'meervoudig knippen');
  const paneel = bron('../../solid/components/left-panel/panels/AnnotationsPanel.jsx');
  assert.match(paneel, /const weg = expandCorrectionGroups\(doc\.annotations, \[ann\]\);[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if \(weg\.some\(a => a\.locked && a !== ann\)\) return;/,
    'lijst: knippen slaat een paar met een vergrendelde andere helft over');
});
