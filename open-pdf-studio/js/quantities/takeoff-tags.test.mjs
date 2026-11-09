// Kenmerken van een staat heen en terug via CSV (#629): export met ID-kolom,
// bewerken zoals een rekenblad dat doet, weer inlezen en toepassen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule } from './engine.js';
import { scheduleResultToCsv } from './schedule-csv.js';
import {
  parseCsv, mapHeaders, readTagUpdates, planTagChanges, applyTagChange, rowAnnotationId, TAG_ID_HEADER,
} from './takeoff-tags.js';

const annotaties = () => ([
  { id: 'a1', type: 'measureArea', page: 1, measureValue: 20, measureUnit: 'm²', measureName: 'Woonkamer', ifcCategory: 'IfcSpace' },
  { id: 'a2', type: 'measureArea', page: 2, measureValue: 12.5, measureUnit: 'm²', subject: 'Keuken' },
  { id: 'l1', type: 'measureDistance', page: 1, measureValue: 4, measureUnit: 'm', label: 'Wand A' },
  { id: 'c1', type: 'count', page: 1, x: 1, y: 1, categoryId: 'cat-1', __countCatName: 'Stopcontact' },
]);

const cfg = {
  categories: ['area', 'line-based', 'count'],
  fields: ['label', 'type', 'area', 'ifcCategory', 'countCat'],
  sort: [{ field: 'type', group: true }],
  itemize: true,
};

function exporteer(anns = annotaties()) {
  const r = buildSchedule(anns, cfg);
  return { r, csv: scheduleResultToCsv(r, { ids: true }) };
}

test('de export met ids zet het annotatie-id in een laatste ID-kolom, alleen op elementregels', () => {
  const { csv } = exporteer();
  const rijen = parseCsv(csv);
  assert.deepEqual(rijen[0], ['Label', 'Type', 'Area (m²)', 'IFC category', 'Count category', TAG_ID_HEADER]);
  const ids = rijen.slice(1).map((r) => r[5]).filter(Boolean).sort();
  assert.deepEqual(ids, ['a1', 'a2', 'c1', 'l1']);
  // Subtotaal en eindtotaal hebben geen id.
  assert.ok(rijen.some((r) => r[0] === 'Subtotal' && !r[5]));
  assert.ok(rijen.some((r) => r[0] === 'Grand total' && !r[5]));
});

test('zonder ids blijft de export zoals hij was', () => {
  const r = buildSchedule(annotaties(), cfg);
  assert.ok(!scheduleResultToCsv(r).split('\n')[0].includes(TAG_ID_HEADER));
});

test('pseudo-elementen (buigstaat, eigen tekst) krijgen geen id', () => {
  assert.equal(rowAnnotationId({ el: { id: 'rebar-1-0', __category: 'reinforcement' } }), '');
  assert.equal(rowAnnotationId({ el: { id: 7 } }), '7');
  assert.equal(rowAnnotationId({}), '');
});

test('heen en terug: bewerkte kenmerken komen op de juiste annotatie en in het veld dat de staat toont', () => {
  const anns = annotaties();
  const { r, csv } = exporteer(anns);
  // Bewerken zoals een gebruiker in een rekenblad doet.
  const rijen = parseCsv(csv);
  for (const rij of rijen) {
    if (rij[5] === 'a1') { rij[0] = 'Woonkamer + suite'; rij[3] = 'IfcSpace'; }
    if (rij[5] === 'a2') { rij[0] = 'Keuken (nieuw)'; rij[3] = 'IfcSlab'; }
    if (rij[5] === 'l1') { rij[3] = ''; }
    if (rij[5] === 'c1') { rij[4] = 'Lichtpunt'; }
  }
  const terug = rijen.map((rij) => rij.map((c) => (/[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
  const gelezen = readTagUpdates(terug, r.columns);
  assert.equal(gelezen.ok, true);
  assert.deepEqual(gelezen.fields.sort(), ['countCat', 'ifcCategory', 'label']);

  const plan = planTagChanges(anns, gelezen.updates, {
    countCategoryName: (id) => (id === 'cat-1' ? 'Stopcontact' : id),
    countCategoryId: (naam) => (naam === 'Lichtpunt' ? 'cat-2' : null),
  });
  for (const c of plan.changes) applyTagChange(c.ann, c.set);
  const opId = Object.fromEntries(anns.map((a) => [a.id, a]));
  assert.equal(opId.a1.measureName, 'Woonkamer + suite');
  assert.equal(opId.a1.ifcCategory, 'IfcSpace');
  assert.equal(opId.a2.subject, 'Keuken (nieuw)');
  assert.equal(opId.a2.ifcCategory, 'IfcSlab');
  assert.equal(opId.l1.label, 'Wand A');
  assert.equal(opId.c1.categoryId, 'cat-2');
  assert.equal(plan.changes.length, 3, 'l1 had geen IFC-categorie en hield er geen: geen wijziging');

  // Opnieuw exporteren toont de nieuwe kenmerken.
  const na = parseCsv(exporteer(anns.map((a) => (a.id === 'c1' ? { ...a, __countCatName: 'Lichtpunt' } : a))).csv);
  const labels = na.slice(1).filter((rij) => rij[5]).map((rij) => rij[0]).sort();
  assert.deepEqual(labels, ['', 'Keuken (nieuw)', 'Wand A', 'Woonkamer + suite']);
});

test('een ongewijzigd bestand wijzigt niets', () => {
  const anns = annotaties();
  const { r, csv } = exporteer(anns);
  const gelezen = readTagUpdates('\uFEFF' + csv, r.columns);
  const plan = planTagChanges(anns, gelezen.updates, { countCategoryName: () => 'Stopcontact' });
  assert.deepEqual(plan.changes, []);
});

test('onbekende ids, vergrendelde markeringen en onbekende telcategorieën worden gemeld, niet toegepast', () => {
  const anns = annotaties();
  anns[0].locked = true;
  const plan = planTagChanges(anns, [
    { id: 'a1', fields: { label: 'Nieuw' } },
    { id: 'weg', fields: { label: 'X' } },
    { id: 'c1', fields: { countCat: 'Bestaat niet' } },
  ], { countCategoryName: () => 'Stopcontact', countCategoryId: () => null });
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.notFound, ['weg']);
  assert.deepEqual(plan.locked, ['a1']);
  assert.deepEqual(plan.unknownCountCategories, ['Bestaat niet']);
  assert.equal(anns[0].measureName, 'Woonkamer');
});

test('een locatie wordt een handmatige locatie, alleen als hij verschilt', () => {
  const ann = { id: 'x', type: 'box', page: 1 };
  const plan = planTagChanges([ann], [{ id: 'x', fields: { location: 'Begane grond / Hal' } }], { location: () => 'Begane grond' });
  assert.deepEqual(plan.changes[0].set, { locationOverride: 'Begane grond / Hal' });
  const zelfde = planTagChanges([ann], [{ id: 'x', fields: { location: 'Begane grond' } }], { location: () => 'Begane grond' });
  assert.equal(zelfde.changes.length, 0);
  const leeg = planTagChanges([ann], [{ id: 'x', fields: { location: '' } }], { location: () => 'Begane grond' });
  assert.equal(leeg.changes.length, 0);
});

test('een formulecel met het schild van de export komt zonder schild terug', () => {
  const r = { columns: [{ key: 'label', label: 'Label' }] };
  const gelezen = readTagUpdates(`Label,ID\n"'=SOM(A1)",a1\n`, r.columns);
  assert.deepEqual(gelezen.updates, [{ id: 'a1', fields: { label: '=SOM(A1)' } }]);
});

test('koppen herkennen: exportkop, label zonder eenheid, veldsleutel; ID verplicht', () => {
  const kolommen = [{ key: 'label', label: 'Naam' }, { key: 'area', label: 'Oppervlakte', unit: 'm²' }];
  const m = mapHeaders(['naam', 'Oppervlakte (m²)', 'ifcCategory', 'id'], kolommen);
  assert.equal(m.id, 3);
  assert.deepEqual([...m.velden], [['label', 0], ['ifcCategory', 2]]);
  assert.deepEqual(readTagUpdates('Naam\nx\n', kolommen), { ok: false, error: 'no-id-column' });
  assert.deepEqual(readTagUpdates('Oppervlakte,ID\n1,a\n', kolommen), { ok: false, error: 'no-tag-columns' });
  assert.deepEqual(readTagUpdates('', kolommen), { ok: false, error: 'empty' });
});

test('CSV lezen: aanhalingstekens, regeleinde in een cel, puntkomma en tab', () => {
  assert.deepEqual(parseCsv('a,"b ""c""","d\ne"\r\n1,2,3'), [['a', 'b "c"', 'd\ne'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2\n\n'), [['a', 'b'], ['1', '2']]);
});
