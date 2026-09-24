// Constructieplan: van een compacte opgave naar annotatie-opgaven + staat.
import assert from 'node:assert/strict';
import test from 'node:test';

import { MM_TO_PX, mmNaarPunten } from './raster.js';
import { STANDAARD_TEKST_MM, bouwConstructieplan, normaliseerOpgave } from './constructieplan.js';

const bijna = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const BASIS = {
  pagina: 2,
  oorsprong: { x: 120, y: 160 },
  veldenX: '2x5400',
  veldenY: [6000],
  schaal: '1:100',
};

const plan = (extra = {}, opts = {}) => bouwConstructieplan({ ...BASIS, ...extra }, opts);
const rollen = (r, rol) => r.annotaties.filter(a => a.rol === rol);

test('een volledig plan levert stramien, kolommen, balken, pijlen en tags', () => {
  const r = plan({
    kolommen: { profiel: '300x300', peilMm: 3000 },
    balken: { profiel: '300x500', richting: 'beide', peilMm: 3000 },
    vloeren: { dikteMm: 260, peilMm: 3000 },
  });
  assert.equal(r.ok, true);
  assert.equal(rollen(r, 'stramien').length, 3 + 2);
  assert.equal(rollen(r, 'kolom').length, 6);
  assert.equal(rollen(r, 'balk').length, 4 + 3);
  assert.equal(rollen(r, 'vloerpijl').length, 2);
  assert.equal(rollen(r, 'peilmaat').length, 2);
  assert.equal(r.samenvatting.aantallen.annotaties, r.annotaties.length);
  assert.equal(r.samenvatting.schaal, '1:100');
});

test('elke annotatie-opgave draagt de gevraagde pagina', () => {
  const r = plan({ kolommen: { profiel: 'HE200B' } });
  assert.ok(r.annotaties.every(a => a.props.page === 2));
});

test('het plan levert de meetschaal-ijking die bij de tekeningschaal hoort', () => {
  const r = plan({ schaal: '1:50' });
  assert.equal(r.meetschaal.unit, 'mm');
  bijna(r.meetschaal.pixelsPerUnit, MM_TO_PX / 50);
});

test('een stramienlijn krijgt zijn label, richting en uitloop mee', () => {
  const r = plan({ uitloopMm: 1000, kolommen: false, balken: false, vloeren: false });
  const verticaal = rollen(r, 'stramien').filter(a => a.props.params.orientation === 'verticaal');
  assert.deepEqual(verticaal.map(a => a.props.params.label), ['A', 'B', 'C']);
  assert.equal(verticaal[0].props.symbolId, 'stramien');
  assert.equal(verticaal[0].props.ifcCategory, 'IfcGrid');
  // De bol zit aan het begin (bovenaan) en de lijn is streep-punt.
  assert.equal(verticaal[0].props.params.bollen, 'begin');
  assert.equal(verticaal[0].props.params.dashed, true);
  // De lijn loopt van de uitloop boven tot de uitloop onder.
  bijna(verticaal[0].props.height, mmNaarPunten(6000 + 2000, '1:100'));
  // De bol staat gecentreerd op de rasterlijn.
  bijna(verticaal[0].props.x + verticaal[0].props.width / 2, 120);
});

test('een betonnen balk wordt een betonbalk met doorsnede en tag', () => {
  const r = plan({ balken: { profiel: '300x500', richting: 'x', peilMm: 3000 }, kolommen: false, vloeren: false });
  const balk = rollen(r, 'balk')[0];
  assert.equal(balk.type, 'betonbalk');
  assert.equal(balk.props.breedteMm, 300);
  assert.equal(balk.props.hoogteMm, 500);
  assert.equal(balk.props.tagTonen, true);
  assert.equal(balk.props.tagTekst, 'L1 300x500 +3.000');
  assert.equal(balk.props.ifcCategory, 'IfcBeam');
  bijna(balk.props.startX, 120);
  bijna(balk.props.endX, 120 + mmNaarPunten(5400, '1:100'));
});

test('zonder tags blijft de betonbalk-tag uit', () => {
  const r = plan({ tags: false, balken: { profiel: '300x500', richting: 'x' }, kolommen: false, vloeren: false });
  assert.equal(rollen(r, 'balk')[0].props.tagTonen, false);
  assert.equal(rollen(r, 'tag').length, 0);
});

test('een stalen ligger wordt een aslijn met een los tekstlabel', () => {
  const r = plan({ balken: { profiel: 'IPE300', richting: 'x' }, kolommen: false, vloeren: false });
  const balk = rollen(r, 'balk')[0];
  assert.equal(balk.type, 'line');
  assert.equal(balk.props.ifcCategory, 'IfcBeam');
  const tag = rollen(r, 'tag')[0];
  assert.equal(tag.type, 'textbox');
  assert.equal(tag.props.text, 'L1\nIPE 300');
  bijna(tag.props.fontSize, STANDAARD_TEKST_MM * MM_TO_PX);
});

test('een betonnen kolom wordt een gevuld vlak op werkelijke maat', () => {
  const r = plan({ kolommen: { profiel: '300x400' }, balken: false, vloeren: false });
  const kolom = rollen(r, 'kolom')[0];
  assert.equal(kolom.type, 'box');
  bijna(kolom.props.width, mmNaarPunten(300, '1:100'));
  bijna(kolom.props.height, mmNaarPunten(400, '1:100'));
  // Het vlak staat gecentreerd op de knoop.
  bijna(kolom.props.x + kolom.props.width / 2, 120);
  bijna(kolom.props.y + kolom.props.height / 2, 160);
  assert.equal(kolom.props.ifcCategory, 'IfcColumn');
});

test('een stalen kolom krijgt zijn werkelijke maat als de bibliotheek die levert', () => {
  const r = plan(
    { kolommen: { profiel: 'HE200B' }, balken: false, vloeren: false },
    { maatVanProfiel: (id, maat) => (id === 'staal-heb' && maat === 'HEB 200' ? { breedteMm: 200, hoogteMm: 200 } : null) },
  );
  const kolom = rollen(r, 'kolom')[0];
  assert.equal(kolom.type, 'parametricSymbol');
  assert.equal(kolom.props.symbolId, 'staal-heb');
  assert.equal(kolom.props.params.maat, 'HEB 200');
  bijna(kolom.props.width, mmNaarPunten(200, '1:100'));
  bijna(kolom.props.x + kolom.props.width / 2, 120);
});

test('zonder maatbron krijgt het profielsymbool alleen een invoegpunt', () => {
  const r = plan({ kolommen: { profiel: 'HE200B' }, balken: false, vloeren: false });
  const kolom = rollen(r, 'kolom')[0];
  assert.equal(kolom.props.x, 120);
  assert.equal(kolom.props.y, 160);
  assert.equal(kolom.props.width, undefined);
});

test('een maat die het symbool niet kent wordt geweigerd, niet vervangen', () => {
  const r = plan(
    { kolommen: { profiel: 'HEB 999' }, balken: false, vloeren: false },
    { kentMaat: () => false },
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, 'profiel');
  assert.match(r.fout, /HEB 999/);
});

test('de overspanningspijl wijst de goede kant op en draagt de overspanning', () => {
  const r = plan({ vloeren: { dikteMm: 260 }, kolommen: false, balken: false });
  const pijl = rollen(r, 'vloerpijl')[0];
  assert.equal(pijl.props.symbolId, 'overspanningspijl-vloer');
  assert.equal(pijl.props.params.lengte, 5400);
  assert.equal(pijl.props.params.tekst, 'V1 - 5400 mm');
  assert.equal(pijl.props.rotation, 0);
  assert.equal(pijl.props.ifcCategory, 'IfcSlab');

  const dwars = plan({ vloeren: { richting: 'y' }, kolommen: false, balken: false });
  const pijlY = rollen(dwars, 'vloerpijl')[0];
  assert.equal(pijlY.props.rotation, 90);
  assert.equal(pijlY.props.params.lengte, 6000);
});

test('de tekst bij de pijl is een sjabloon met invulplekken', () => {
  const r = plan({
    vloeren: { dikteMm: 260, peilMm: 3000, tekst: '{veld}: {dikte} mm, bk {peil}' },
    kolommen: false, balken: false,
  });
  assert.equal(rollen(r, 'vloerpijl')[0].props.params.tekst, 'A1: 260 mm, bk +3.000');
});

test('de peilmaat zet zijn punt in het vloerveld en toont het peil', () => {
  const r = plan({ vloeren: { peilMm: 3250 }, kolommen: false, balken: false });
  const peil = rollen(r, 'peilmaat')[0];
  assert.equal(peil.props.symbolId, 'peilmaat');
  assert.equal(peil.props.params.value, '+3.250');
  // De top van het driehoekje ligt op de onderrand van het symboolkader.
  const apex = peil.props.y + peil.props.height;
  const veldBoven = 160;
  const veldOnder = 160 + mmNaarPunten(6000, '1:100');
  assert.ok(apex > veldBoven && apex < veldOnder);
});

test('zonder peil komt er geen peilmaat', () => {
  const r = plan({ vloeren: { dikteMm: 260 }, kolommen: false, balken: false });
  assert.equal(rollen(r, 'peilmaat').length, 0);
});

test('peilmaten kunnen los uitgezet worden', () => {
  const r = plan({ vloeren: { peilMm: 3000 }, peilmaten: false, kolommen: false, balken: false });
  assert.equal(rollen(r, 'peilmaat').length, 0);
  assert.equal(rollen(r, 'vloerpijl').length, 2);
});

test('de staat groepeert op IFC-categorie en staat onder het raster', () => {
  const r = plan({ kolommen: { profiel: '300x300' } });
  assert.equal(r.staat.templateId, 'full');
  assert.equal(r.staat.name, 'Constructiestaat');
  assert.equal(r.staat.page, 2);
  assert.deepEqual(r.staat.config.sort, [
    { field: 'ifcCategory', dir: 'asc', group: true, header: true, footer: true },
  ]);
  assert.ok(r.staat.config.fields.includes('ifcCategory'));
  assert.ok(r.staat.y > r.plan.raster.maat.y1);
});

test('de staat kan uitgezet worden', () => {
  assert.equal(plan({ staat: false }).staat, null);
});

test('elke annotatie draagt het positienummer als label, zodat de staat het toont', () => {
  const r = plan({ kolommen: { profiel: '300x300' }, balken: { profiel: '300x500', richting: 'x' } });
  assert.equal(rollen(r, 'kolom')[0].props.label, 'K1');
  assert.equal(rollen(r, 'balk')[0].props.label, 'L1');
  assert.equal(rollen(r, 'vloerpijl')[0].props.label, 'V1');
});

test('een fout in de opgave komt terug als code en tekst, niet als uitzondering', () => {
  const r = bouwConstructieplan({ ...BASIS, veldenX: '5,4' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'veldmaat');
  assert.match(r.fout, /millimeters/);
});

test('een tweede doorloop levert exact hetzelfde plan op', () => {
  const opgave = {
    kolommen: { profiel: 'HE200B', peilMm: 3000 },
    balken: { profiel: '300x500', richting: 'beide' },
    vloeren: { dikteMm: 260, peilMm: 3000 },
  };
  assert.deepEqual(plan(opgave).annotaties, plan(opgave).annotaties);
});

test('een Engelse opgave wordt vertaald naar de interne vorm', () => {
  assert.deepEqual(normaliseerOpgave({
    page: 3, origin: { x: 1, y: 2 }, scale: '1:50',
    baysX: '2x5400', baysY: [6000],
    labelStyleX: 'letters', labelStyleY: 'numbers',
    labelsYFromBottom: false, gridExtensionMm: 1000,
    textHeightMm: 3, gridBubbleMm: 5,
    columns: { profile: 'HE200B', prefix: 'K', levelMm: 3000, skip: ['A-1'] },
    beams: { profile: '300x500', direction: 'both', edgeOnly: true },
    floors: { direction: 'shortest', thicknessMm: 260, text: '{id}' },
    levelMarkers: false, schedule: { name: 'Staat' },
  }), {
    pagina: 3, oorsprong: { x: 1, y: 2 }, schaal: '1:50',
    veldenX: '2x5400', veldenY: [6000],
    labelStijlX: 'letters', labelStijlY: 'cijfers',
    labelsYVanOnder: false, uitloopMm: 1000,
    tekstMm: 3, bolMm: 5,
    kolommen: { profiel: 'HE200B', voorvoegsel: 'K', peilMm: 3000, overslaan: ['A-1'] },
    balken: { profiel: '300x500', richting: 'beide', alleenRand: true },
    vloeren: { richting: 'kortste', dikteMm: 260, tekst: '{id}' },
    peilmaten: false, staat: { naam: 'Staat' },
  });
});

test('uitzetten met false blijft false, en Nederlandse sleutels blijven staan', () => {
  assert.deepEqual(normaliseerOpgave({ columns: false, balken: { profiel: 'IPE300' } }),
    { kolommen: false, balken: { profiel: 'IPE300' } });
});

test('het plan werkt even goed met een Engelse opgave', () => {
  const r = bouwConstructieplan({
    page: 1, origin: { x: 0, y: 0 }, scale: '1:100',
    baysX: [5400], baysY: [6000],
    columns: { profile: '300x300' }, beams: false,
    floors: { direction: 'y', thicknessMm: 260 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.plan.kolommen.length, 4);
  assert.equal(r.plan.vloervelden[0].overspanningsrichting, 'y');
});

test('de staat blijft binnen het blad als het raster tegen de rand ligt', () => {
  const r = bouwConstructieplan({
    oorsprong: { x: 5, y: 5 }, veldenX: [5000], veldenY: [5000], schaal: '1:100',
  });
  assert.ok(r.staat.x >= 0);
  assert.ok(r.staat.y >= 0);
});
