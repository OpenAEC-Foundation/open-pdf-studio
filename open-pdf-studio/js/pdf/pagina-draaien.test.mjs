import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { teDraaienPaginas, draaiPaginas } from './pagina-draaien.js';

test('zonder meervoudige selectie draait de huidige pagina', () => {
  assert.deepEqual(teDraaienPaginas({ huidige: 3, selectie: [], miniaturenZichtbaar: true, aantal: 5 }), [3]);
  assert.deepEqual(teDraaienPaginas({ huidige: 3, selectie: [2], miniaturenZichtbaar: true, aantal: 5 }), [3]);
});

test('meerdere miniaturen geselecteerd en het paneel open: die pagina’s, op volgorde', () => {
  assert.deepEqual(teDraaienPaginas({ huidige: 1, selectie: [4, 2, 4], miniaturenZichtbaar: true, aantal: 5 }), [2, 4]);
});

test('met het miniaturenpaneel dicht telt een selectie die je niet ziet niet mee', () => {
  assert.deepEqual(teDraaienPaginas({ huidige: 1, selectie: [2, 4], miniaturenZichtbaar: false, aantal: 5 }), [1]);
});

test('pagina’s buiten het document vallen weg', () => {
  assert.deepEqual(teDraaienPaginas({ huidige: 2, selectie: [0, 2, 3.5, 9], miniaturenZichtbaar: true, aantal: 5 }), [2]);
  assert.deepEqual(teDraaienPaginas({ huidige: 0, selectie: [], miniaturenZichtbaar: true, aantal: 5 }), []);
});

// Een nagebootste app: draaien verschuift de annotaties van de pagina en de
// meetschalen, zoals rotatePage() dat doet; de vastlegging komt in `stappen`.
function nepApp() {
  const doc = {
    annotations: [
      { id: 'a', page: 1, x: 100, y: 100, width: 120, height: 80 },
      { id: 'b', page: 2, x: 10, y: 20, width: 30, height: 40 },
      { id: 'c', page: 3, x: 5, y: 5, width: 5, height: 5 },
    ],
    pdfViewports: { 2: [{ bbox: [0, 0, 100, 100] }] },
  };
  const rotaties = { 1: 0, 2: 90, 3: 0 };
  const stappen = [];
  const volgorde = [];
  let open = 0;
  const omgeving = {
    document: () => doc,
    paginaRotatie: (p) => rotaties[p] || 0,
    async draaiPagina(delta, p) {
      volgorde.push(`draai ${p}`);
      for (const a of doc.annotations) if (a.page === p) { a.x += 1000; [a.width, a.height] = [a.height, a.width]; }
      if (doc.pdfViewports[p]) doc.pdfViewports[p] = [{ bbox: [0, 0, 100, 100], gedraaid: delta }];
      rotaties[p] = ((rotaties[p] || 0) + delta + 360) % 360;
    },
    legRotatieVast: (p, oud, nieuw, viewports) => stappen.push({ type: 'rotatePage', p, oud, nieuw, viewports }),
    legAnnotatiesVast: (nu, voorheen) => stappen.push({
      type: 'bulkModify', ids: nu.map((a) => a.id), oud: voorheen.map((a) => ({ ...a })), nieuw: nu.map((a) => ({ ...a })),
    }),
    kloon: (a) => ({ ...a }),
    beginTransactie: () => { open += 1; volgorde.push('begin'); },
    eindTransactie: () => { open -= 1; volgorde.push('eind'); },
    tekenOpnieuw: async () => { volgorde.push(`teken (open ${open})`); },
  };
  return { doc, rotaties, stappen, volgorde, omgeving };
}

test('één stap met per pagina de draaihoek, de meetschalen en de annotaties', async () => {
  const app = nepApp();
  assert.equal(await draaiPaginas(90, [1, 2], app.omgeving), true);
  assert.deepEqual(app.volgorde, ['begin', 'draai 1', 'draai 2', 'eind', 'teken (open 0)']);
  assert.deepEqual(app.stappen.map((s) => s.type), ['rotatePage', 'bulkModify', 'rotatePage', 'bulkModify']);

  const [rot1, ann1, rot2, ann2] = app.stappen;
  assert.deepEqual([rot1.p, rot1.oud, rot1.nieuw], [1, 0, 90]);
  assert.deepEqual([rot2.p, rot2.oud, rot2.nieuw], [2, 90, 180]);
  // De meetschalen van vóór en na het draaien, zodat Ctrl+Z ze terugzet.
  assert.deepEqual(rot2.viewports, { oud: [{ bbox: [0, 0, 100, 100] }], nieuw: [{ bbox: [0, 0, 100, 100], gedraaid: 90 }] });
  assert.deepEqual(rot1.viewports, { oud: undefined, nieuw: undefined });
  // De annotaties: de stand van VÓÓR het draaien, en die van erna (#464).
  assert.deepEqual(ann1.ids, ['a']);
  assert.deepEqual(ann1.oud, [{ id: 'a', page: 1, x: 100, y: 100, width: 120, height: 80 }]);
  assert.deepEqual(ann1.nieuw, [{ id: 'a', page: 1, x: 1100, y: 100, width: 80, height: 120 }]);
  assert.deepEqual(ann2.ids, ['b']);
  // Pagina 3 is niet gedraaid.
  assert.deepEqual(app.doc.annotations[2], { id: 'c', page: 3, x: 5, y: 5, width: 5, height: 5 });
});

test('een pagina zonder annotaties legt alleen de draaihoek vast', async () => {
  const app = nepApp();
  app.doc.annotations = [];
  await draaiPaginas(-90, [3], app.omgeving);
  assert.deepEqual(app.stappen.map((s) => [s.type, s.p, s.oud, s.nieuw]), [['rotatePage', 3, 0, 270]]);
});

test('niets te draaien: geen stap en niet opnieuw tekenen', async () => {
  const app = nepApp();
  assert.equal(await draaiPaginas(90, [], app.omgeving), false);
  assert.deepEqual(app.volgorde, []);
  assert.deepEqual(app.stappen, []);
});

test('mislukt het draaien halverwege, dan sluit de stap toch en wordt er getekend', async () => {
  const app = nepApp();
  const draai = app.omgeving.draaiPagina;
  app.omgeving.draaiPagina = async (delta, p) => {
    if (p === 2) throw new Error('pagina 2 kon niet');
    return draai(delta, p);
  };
  await assert.rejects(draaiPaginas(90, [1, 2], app.omgeving), /pagina 2 kon niet/);
  assert.deepEqual(app.volgorde, ['begin', 'draai 1', 'eind', 'teken (open 0)']);
  assert.deepEqual(app.stappen.map((s) => s.type), ['rotatePage', 'bulkModify']);
});

test('lint, sneltoets, mobiele knop en contextmenu draaien via deze module', () => {
  const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  // De knoppen op het tabblad Beeld draaien sinds #200 alleen de weergave
  // (weergave-draaien.js), niet de pagina's; zie weergave-draaien.test.mjs.
  for (const pad of ['../solid/components/ribbon/OrganizeTab.jsx',
    '../tools/keyboard-handlers.js', '../solid/MobileApp.jsx']) {
    assert.match(bron(pad), /draaiVanafKnop\(/, pad);
    assert.doesNotMatch(bron(pad), /\brotatePage\(/, pad);
  }
  const menu = bron('../solid/components/ContextMenu.jsx');
  assert.match(menu, /draaiPaginas\(-90, pages\(\)\)/);
  assert.match(menu, /draaiPaginas\(90, pages\(\)\)/);
  assert.doesNotMatch(menu, /\brotatePage\(/);
});

test('ongedaan maken van een paginarotatie zet de meetschalen terug en tekent de pagina opnieuw', () => {
  const undo = readFileSync(new URL('../core/undo-manager.js', import.meta.url), 'utf8');
  assert.match(undo, /zetViewports\(doc, cmd\.pageNum, cmd\.viewports\.oud\)/);
  assert.match(undo, /zetViewports\(doc, cmd\.pageNum, cmd\.viewports\.nieuw\)/);
  assert.equal((undo.match(/if \(raaktPaginaRotatie\(cmd\)\)/g) || []).length, 2);
});
