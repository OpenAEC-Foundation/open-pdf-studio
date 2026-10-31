// De MCP-opdracht app_watermarks: watermerken en kop-/voetteksten opvragen,
// toevoegen en verwijderen, met de velden en standaardwaarden van de dialogen
// en door dezelfde functies (watermerk-bewerken.js). Undo, tabbladen, tekenen
// en de kop-/voetweergave zijn nagebootst.

import test from 'node:test';
import assert from 'node:assert/strict';

import { watermarks } from './watermerken-mcp.js';
import { toegepastePaginas, vulKopVoetIn, kopVoetWaarden } from './kopvoet-tekst.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

function opstelling({ alleenLezen = false, watermerken = [], kopVoetInBeeld = false } = {}) {
  const doc = { pdfDoc: { numPages: 4 }, watermarks: watermerken.map((w) => ({ ...w })), fileName: 'plan.pdf' };
  const stappen = [];
  const bestanden = new Map([['/beeld/logo.png', PNG], ['/beeld/foto.jpg', JPEG], ['/beeld/nep.png', JPEG]]);
  const o = {
    document: () => doc,
    alleenLezen: () => alleenLezen,
    leesBestand: async (pad) => {
      if (!bestanden.has(pad)) throw new Error('not found');
      return bestanden.get(pad);
    },
    bewerken: {
      document: () => doc,
      legToevoegenVast: (wm) => stappen.push(['add', wm.id]),
      legVerwijderenVast: (wm, idx) => stappen.push(['remove', wm.id, idx]),
      markeerGewijzigd: (d) => { d.modified = true; },
      tekenOpnieuw: () => stappen.push('teken'),
      kopVoetInWeergave: () => kopVoetInBeeld,
      haalKopVoetUitWeergave: async () => { stappen.push('kopvoet-uit-weergave'); },
    },
  };
  return { doc, o, stappen };
}

test('add text: de standaardwaarden van de dialoog, één undo-stap, opnieuw getekend', async () => {
  const { doc, o, stappen } = opstelling();
  const r = await watermarks({ action: 'add', type: 'text', text: 'CONCEPT' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  const wm = doc.watermarks[0];
  assert.equal(wm.type, 'textWatermark');
  assert.match(wm.id, /^wm-/);
  assert.deepEqual(
    { text: wm.text, fontFamily: wm.fontFamily, fontSize: wm.fontSize, color: wm.color, opacity: wm.opacity, rotation: wm.rotation, position: wm.position, layer: wm.layer, pageRange: wm.pageRange, enabled: wm.enabled },
    { text: 'CONCEPT', fontFamily: 'Helvetica', fontSize: 72, color: '#ff0000', opacity: 0.3, rotation: -45, position: 'center', layer: 'behind', pageRange: 'all', enabled: true },
  );
  assert.equal(r.watermark.type, 'text', 'de client ziet de MCP-naam van de soort');
  assert.equal(doc.modified, true);
  assert.deepEqual(stappen, [['add', wm.id], 'teken']);
});

test('add text met pagina\'s: customPages zoals de dialoog die schrijft', async () => {
  const { doc, o } = opstelling();
  const r = await watermarks({ action: 'add', type: 'text', text: 'X', pages: [4, 1], layer: 'infront', color: '#0000FF', opacity: 0.5 }, o);
  assert.equal(r.ok, true);
  const wm = doc.watermarks[0];
  assert.equal(wm.pageRange, 'custom');
  assert.equal(wm.customPages, '1,4');
  assert.equal(wm.layer, 'infront');
  assert.equal(wm.color, '#0000ff');
  assert.deepEqual(toegepastePaginas(wm, 4, (s) => s.split(',').map(Number)), [1, 4]);
});

test('add image: PNG of JPEG van schijf als data-URL; de lijst laat de afbeelding weg', async () => {
  const { doc, o } = opstelling();
  const r = await watermarks({ action: 'add', type: 'image', imagePath: '/beeld/logo.png', scale: 0.5 }, o);
  assert.equal(r.ok, true);
  assert.match(doc.watermarks[0].imageData, /^data:image\/png;base64,/);
  assert.equal(doc.watermarks[0].scale, 0.5);
  assert.equal(doc.watermarks[0].opacity, 0.2);
  assert.equal(doc.watermarks[0].width, 200);
  assert.equal(r.watermark.imageData, undefined);
  assert.equal(r.watermark.hasImage, true);
  const jpg = await watermarks({ action: 'add', type: 'image', imagePath: '/beeld/foto.jpg' }, o);
  assert.equal(jpg.ok, true);
  assert.match(doc.watermarks[1].imageData, /^data:image\/jpeg;base64,/);
  const lijst = await watermarks({ action: 'list' }, o);
  assert.equal(lijst.count, 2);
  assert.ok(lijst.watermarks.every((w) => w.imageData === undefined && w.hasImage === true));
});

test('add image: alleen een bestaande PNG/JPEG op een absoluut pad', async () => {
  const { doc, o } = opstelling();
  const fout = async (imagePath) => (await watermarks({ action: 'add', type: 'image', imagePath }, o)).error;
  assert.match(await fout('logo.png'), /absolute path/);
  assert.match(await fout('/beeld/logo.gif'), /must end in \.png or \.jpg or \.jpeg/);
  assert.match(await fout('/beeld/weg.png'), /could not read imagePath/);
  assert.match(await fout('/beeld/nep.png'), /not a PNG image/);
  assert.match(await fout(undefined), /missing or invalid imagePath/);
  assert.equal(doc.watermarks.length, 0);
});

test('add headerFooter: vakken met variabelen, Bates-nummering, marges', async () => {
  const { doc, o } = opstelling();
  const r = await watermarks({
    action: 'add', type: 'headerFooter', footerCenter: 'Blad {page} van {pages}', headerRight: '{bates}',
    batesPrefix: 'PRJ-', batesDigits: 4, marginBottom: 20,
  }, o);
  assert.equal(r.ok, true);
  const wm = doc.watermarks[0];
  assert.equal(wm.type, 'headerFooter');
  assert.equal(wm.uitBestand, false);
  assert.equal(wm.fontSize, 10);
  assert.equal(wm.color, '#000000');
  assert.equal(wm.marginBottom, 20);
  assert.equal(wm.marginTop, 30);
  assert.equal(wm.headerLeft, '');
  const waarden = kopVoetWaarden(wm, { pagina: 2, paginas: 4, toegepast: [1, 2, 3, 4], bestandsnaam: 'plan.pdf' });
  assert.equal(vulKopVoetIn(wm.footerCenter, waarden), 'Blad 2 van 4');
  assert.equal(vulKopVoetIn(wm.headerRight, waarden), 'PRJ-0002');
});

test('add: argumenten gecontroleerd per soort, niets toegevoegd bij een fout', async () => {
  const { doc, o, stappen } = opstelling();
  const fout = async (p) => (await watermarks({ action: 'add', ...p }, o)).error;
  assert.match(await fout({}), /type must be one of: text, image, headerFooter/);
  assert.match(await fout({ type: 'text' }), /text must be a non-empty string/);
  assert.match(await fout({ type: 'text', text: 'A', opacity: 2 }), /opacity must be a number from 0 to 1/);
  assert.match(await fout({ type: 'text', text: 'A', fontFamily: 'Comic Sans' }), /fontFamily must be one of/);
  // Dezelfde grenzen als het lettergrootteveld van de dialoog (4-288).
  assert.match(await fout({ type: 'text', text: 'A', fontSize: 289 }), /fontSize must be a whole number from 4 to 288/);
  assert.match(await fout({ type: 'text', text: 'A', fontSize: 3 }), /fontSize must be a whole number from 4 to 288/);
  assert.match(await fout({ type: 'text', text: 'A', position: 'middle' }), /position must be one of/);
  assert.match(await fout({ type: 'text', text: 'A', color: 'rood' }), /#rrggbb/);
  assert.match(await fout({ type: 'text', text: 'A', pages: [5] }), /page 5 is out of range/);
  assert.match(await fout({ type: 'text', text: 'A', scale: 2 }), /unknown argument: scale \(not used by type text\)/);
  assert.match(await fout({ type: 'headerFooter' }), /give at least one of headerLeft/);
  assert.match(await fout({ type: 'headerFooter', footerLeft: 'a', fontFamily: 'Georgia' }), /fontFamily must be one of/);
  assert.match(await fout({ type: 'headerFooter', footerLeft: 'a', batesDigits: 13 }), /batesDigits must be a whole number from 1 to 12/);
  assert.equal(doc.watermarks.length, 0);
  assert.deepEqual(stappen, []);
});

test('remove: op id, één undo-stap met de plaats in de lijst', async () => {
  const { doc, o, stappen } = opstelling({ watermerken: [{ id: 'wm-a', type: 'textWatermark', text: 'A' }, { id: 'wm-b', type: 'textWatermark', text: 'B' }] });
  const r = await watermarks({ action: 'remove', id: 'wm-b' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.removed.id, 'wm-b');
  assert.equal(r.remaining, 1);
  assert.deepEqual(doc.watermarks.map((w) => w.id), ['wm-a']);
  assert.deepEqual(stappen, [['remove', 'wm-b', 1], 'teken']);
  assert.match((await watermarks({ action: 'remove', id: 'wm-b' }, o)).error, /unknown watermark id: wm-b/);
  assert.match((await watermarks({ action: 'remove' }, o)).error, /unknown watermark id/);
});

test('remove headerFooter in de weergave: eerst uit de weergave, zoals de beheerdialoog', async () => {
  const { o, stappen } = opstelling({ watermerken: [{ id: 'wm-k', type: 'headerFooter', footerLeft: 'x' }], kopVoetInBeeld: true });
  const r = await watermarks({ action: 'remove', id: 'wm-k' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.removed.type, 'headerFooter');
  assert.deepEqual(stappen, ['kopvoet-uit-weergave', ['remove', 'wm-k', 0], 'teken']);
});

test('alleen-lezen: lijst mag, toevoegen en verwijderen niet', async () => {
  const { doc, o, stappen } = opstelling({ alleenLezen: true, watermerken: [{ id: 'wm-a', type: 'textWatermark', text: 'A' }] });
  assert.equal((await watermarks({ action: 'list' }, o)).count, 1);
  assert.equal((await watermarks({ action: 'add', type: 'text', text: 'X' }, o)).readOnly, true);
  assert.equal((await watermarks({ action: 'remove', id: 'wm-a' }, o)).readOnly, true);
  assert.equal(doc.watermarks.length, 1);
  assert.deepEqual(stappen, []);
});

test('onbekende actie en geen document', async () => {
  const { o } = opstelling();
  assert.match((await watermarks({ action: 'update' }, o)).error, /action must be one of: list, add, remove/);
  o.document = () => null;
  assert.deepEqual(await watermarks({ action: 'list' }, o), { ok: false, error: 'no active document' });
});
