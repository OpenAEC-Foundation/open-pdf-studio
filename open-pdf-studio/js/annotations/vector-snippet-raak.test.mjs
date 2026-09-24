// Een vectorknipsel is met de muis te pakken: klikken selecteert, slepen
// verplaatst, en de grepen schalen zoals bij een afbeelding (#400).
//
// De echte bronnen draaien hier, met alleen hun imports vervangen: die trekken
// de DOM, de state en SolidJS mee. Zo bewaakt de test de functies die het
// selectiegereedschap werkelijk aanroept.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let _nr = 0;

/**
 * Laadt een bronbestand met elke import vervangen door een stub. Namen zonder
 * eigen stub worden een functie die niets doet.
 */
async function laadMetStubs(relPad, stubs = {}) {
  const namen = new Set();
  const bron = readFileSync(new URL(relPad, import.meta.url), 'utf8')
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, (_, wat) => {
      const binnen = wat.replace(/[{}]/g, ' ');
      for (const deel of binnen.split(',')) {
        const naam = deel.trim().split(/\s+as\s+/).pop().trim();
        if (naam) namen.add(naam);
      }
      return '';
    });
  const sleutel = `__opdsKnipselRaakStubs${_nr++}`;
  globalThis[sleutel] = stubs;
  const kop = [...namen]
    .map((n) => `const ${n} = globalThis.${sleutel}.${n} ?? (() => undefined);`)
    .join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(`${kop}\n${bron}`, 'utf8').toString('base64'));
}

// De echte greepnamen, uit de bron van de constanten gelezen.
const constanten = readFileSync(new URL('../core/constants.ts', import.meta.url), 'utf8');
const HANDLE_TYPES = new Function(
  `return ${constanten.match(/export const HANDLE_TYPES = (\{[\s\S]*?\}) as const;/)[1]};`,
)();
const HANDLE_SIZE = Number(constanten.match(/export const HANDLE_SIZE = (\d+);/)[1]);

const doc = { scale: 1, currentPage: 1, annotations: [] };
const state = { preferences: {}, shiftKeyPressed: false };

// De pure rekenregels voor maat, raakmarge en greepkeuze draaien echt mee:
// een lege stub zou elke raaktest en elke greep laten mislukken.
const minimummaat = await import('./minimummaat.js');
const greepKeuze = await import('./greep-keuze.js');

const geometrie = await laadMetStubs('./geometry.js', {
  ...minimummaat,
  state,
  getActiveDocument: () => doc,
  // Wat verborgen is (of op een vergrendelde laag staat) is niet raakbaar.
  isAnnotationPickableInView: (ann) => ann.hidden !== true,
  getAnnotationType: () => null,
});
const grepen = await laadMetStubs('./handles.js', { ...minimummaat, ...greepKeuze, HANDLE_SIZE, HANDLE_TYPES, state });
const vervormen = await laadMetStubs('./transforms.js', { ...minimummaat, HANDLE_TYPES, state });

const knipsel = (extra = {}) => ({
  id: 'k1', type: 'vectorSnippet', page: 1,
  x: 100, y: 200, width: 400, height: 100,
  snippetKey: 'abc', srcBox: { left: 0, bottom: 0, right: 400, top: 100 },
  lockAspectRatio: true,
  ...extra,
});

test('a click inside the frame of a vector snippet hits it, a click beside it does not', () => {
  const ann = knipsel();
  doc.annotations = [ann];
  assert.equal(geometrie.findAnnotationAt(300, 250), ann, 'midden in het kader');
  assert.equal(geometrie.findAnnotationAt(101, 201), ann, 'net binnen de hoek');
  assert.equal(geometrie.findAnnotationAt(499, 299), ann);
  // Ernaast klikken raakt niets: het selectiegereedschap deselecteert dan.
  assert.equal(geometrie.findAnnotationAt(99, 250), null, 'links ervan');
  assert.equal(geometrie.findAnnotationAt(300, 301), null, 'eronder');
  assert.equal(geometrie.findAnnotationAt(600, 250), null);
  assert.equal(geometrie.isPointInsideAnnotation(300, 250, ann), true);
  assert.equal(geometrie.isPointInsideAnnotation(600, 250, ann), false);
});

test('a rotated vector snippet is hit on its rotated frame', () => {
  // Een kwartslag om het midden (300, 250): het kader van 400 x 100 staat dan
  // rechtop, van x 250..350 en y 50..450.
  const ann = knipsel({ rotation: 90 });
  doc.annotations = [ann];
  assert.equal(geometrie.findAnnotationAt(300, 60), ann, 'boven het ongedraaide kader, binnen het gedraaide');
  assert.equal(geometrie.findAnnotationAt(300, 440), ann);
  assert.equal(geometrie.findAnnotationAt(120, 250), null, 'binnen het ongedraaide kader, buiten het gedraaide');
  assert.equal(geometrie.findAnnotationAt(480, 250), null);
  assert.equal(geometrie.isPointInsideAnnotation(300, 60, ann), true);
  assert.equal(geometrie.isPointInsideAnnotation(120, 250, ann), false);
  // Een schuine stand: het midden blijft raak, de hoek van het rechte kader niet.
  const schuin = knipsel({ rotation: 45 });
  doc.annotations = [schuin];
  assert.equal(geometrie.findAnnotationAt(300, 250), schuin);
  assert.equal(geometrie.findAnnotationAt(105, 205), null);
});

test('a flattened, hidden or other-page vector snippet is not hit', () => {
  doc.annotations = [knipsel({ flattened: true })];
  assert.equal(geometrie.findAnnotationAt(300, 250), null, 'vastgezet is pagina-inhoud');
  doc.annotations = [knipsel({ gebakkenIn: true })];
  assert.equal(geometrie.findAnnotationAt(300, 250), null);
  doc.annotations = [knipsel({ hidden: true })];
  assert.equal(geometrie.findAnnotationAt(300, 250), null);
  doc.annotations = [knipsel({ page: 2 })];
  assert.equal(geometrie.findAnnotationAt(300, 250), null);
  assert.equal(geometrie.findAnnotationAt(300, 250, 2)?.id, 'k1');
});

test('the topmost object wins, and a snippet below the content still hits where nothing covers it', () => {
  const onder = knipsel({ id: 'onder', belowContent: true });
  const boven = { id: 'boven', type: 'image', page: 1, x: 150, y: 220, width: 50, height: 50 };
  doc.annotations = [onder, boven];
  assert.equal(geometrie.findAnnotationAt(160, 230)?.id, 'boven');
  assert.equal(geometrie.findAnnotationAt(400, 250)?.id, 'onder');
});

test('a vector snippet has the scaling grips of an image, and no rotation grip', () => {
  const ann = knipsel();
  const lijst = grepen.getAnnotationHandles(ann, 1);
  const soorten = lijst.map((h) => h.type).sort();
  assert.deepEqual(soorten, [
    HANDLE_TYPES.TOP_LEFT, HANDLE_TYPES.TOP_RIGHT, HANDLE_TYPES.BOTTOM_LEFT, HANDLE_TYPES.BOTTOM_RIGHT,
    HANDLE_TYPES.TOP, HANDLE_TYPES.BOTTOM, HANDLE_TYPES.LEFT, HANDLE_TYPES.RIGHT,
  ].sort());
  // De draaiing van een los knipsel komt niet in het bestand: geen draaigreep.
  assert.equal(soorten.includes(HANDLE_TYPES.ROTATE), false);
  assert.equal(grepen.findHandleAt(500, 300, ann, 1), HANDLE_TYPES.BOTTOM_RIGHT);
  assert.equal(grepen.findHandleAt(100, 200, ann, 1), HANDLE_TYPES.TOP_LEFT);
  assert.equal(grepen.findHandleAt(300, 250, ann, 1), null, 'midden in het kader is geen greep');
  // Gedraaid draaien de grepen mee om het midden.
  const gedraaid = grepen.getAnnotationHandles(knipsel({ rotation: 90 }), 1);
  const linksboven = gedraaid.find((h) => h.type === HANDLE_TYPES.TOP_LEFT);
  assert.ok(Math.abs(linksboven.x + HANDLE_SIZE / 2 - 350) < 1e-6);
  assert.ok(Math.abs(linksboven.y + HANDLE_SIZE / 2 - 50) < 1e-6);
});

test('dragging a grip scales a vector snippet and keeps its proportions', () => {
  const origineel = knipsel();
  const ann = { ...origineel };
  vervormen.applyResize(ann, HANDLE_TYPES.BOTTOM_RIGHT, 200, 10, origineel);
  assert.equal(ann.width, 600);
  assert.equal(ann.height, 150, 'de verhouding 4:1 blijft');
  assert.equal(ann.x, 100);
  assert.equal(ann.y, 200);
  // Zonder vergrendelde verhouding rekt een randgreep vrij.
  const vrij = knipsel({ lockAspectRatio: false });
  const rek = { ...vrij };
  vervormen.applyResize(rek, HANDLE_TYPES.RIGHT, 50, 0, vrij);
  assert.equal(rek.width, 450);
  assert.equal(rek.height, 100);
  // Vergrendeld beweegt en schaalt niets.
  const vast = knipsel({ locked: true });
  const blijft = { ...vast };
  vervormen.applyResize(blijft, HANDLE_TYPES.BOTTOM_RIGHT, 200, 10, vast);
  assert.equal(blijft.width, 400);
  vervormen.applyMove(blijft, 10, 10);
  assert.equal(blijft.x, 100);
});

test('dragging moves a vector snippet', () => {
  const ann = knipsel();
  vervormen.applyMove(ann, 25, -40);
  assert.equal(ann.x, 125);
  assert.equal(ann.y, 160);
  assert.equal(ann.width, 400);
});
