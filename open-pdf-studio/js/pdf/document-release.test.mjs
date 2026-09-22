// Vrijgeven bij sluiten: welke caches mogen weg, en welke juist niet omdat
// een ander tabblad hetzelfde bestand nog gebruikt.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  padNogInGebruik, vrijgaveplan, sleutelsMetPad, isWerkbestand, onthoudWerkbestand, vergeetWerkbestand,
  losgelatenWerkbestanden, ruimWerkbestandenOp,
} from './document-release.js';

const doc = (id, filePath, extra = {}) => ({ id, filePath, pdfDoc: { id }, ...extra });

test('een gesloten document geeft zijn pad, bytes-sleutel en PDF.js-instantie vrij', () => {
  const dicht = doc(7, 'C:/t/a.pdf');
  const plan = vrijgaveplan(dicht, [doc(8, 'C:/t/b.pdf')]);
  assert.deepEqual(plan.paden, ['C:/t/a.pdf']);
  assert.equal(plan.memoryKey, '__memory__7');
  assert.equal(plan.pdfjsVrijgeven, true);
});

test('hetzelfde bestand in een ander tabblad houdt de caches in leven', () => {
  const dicht = doc(1, 'C:/t/a.pdf');
  const plan = vrijgaveplan(dicht, [doc(2, 'C:/t/a.pdf')]);
  assert.deepEqual(plan.paden, []);
  assert.equal(padNogInGebruik([doc(2, 'C:/t/a.pdf')], 'C:/t/a.pdf'), true);
  // Wel een eigen PDF.js-instantie: die mag dicht.
  assert.equal(plan.pdfjsVrijgeven, true);
});

test('een werkkopie na een save: doel-pad telt als gebruik, werkkopie-pad komt vrij', () => {
  // Document rendert uit een tijdelijke werkkopie, de lock staat op het echte bestand.
  const dicht = doc(3, 'C:/tmp/werk-3.pdf', { saveTargetPath: 'C:/t/echt.pdf' });
  const plan = vrijgaveplan(dicht, [doc(4, 'C:/t/echt.pdf')]);
  assert.deepEqual(plan.paden, ['C:/tmp/werk-3.pdf']);
  // En andersom: een ander tabblad dat uit een werkkopie van hetzelfde bestand
  // werkt, houdt het echte pad vast.
  const plan2 = vrijgaveplan(doc(5, 'C:/t/echt.pdf'), [doc(6, 'C:/tmp/werk-6.pdf', { saveTargetPath: 'C:/t/echt.pdf' })]);
  assert.deepEqual(plan2.paden, []);
});

test('zelfde pad als filePath én saveTargetPath staat één keer in het plan', () => {
  const plan = vrijgaveplan(doc(9, 'C:/t/a.pdf', { saveTargetPath: 'C:/t/a.pdf' }), []);
  assert.deepEqual(plan.paden, ['C:/t/a.pdf']);
});

test('nooit-opgeslagen document: geen pad, wel de bytes-sleutel', () => {
  const plan = vrijgaveplan({ id: 11, filePath: null, isUntitled: true, pdfDoc: {} }, []);
  assert.deepEqual(plan.paden, []);
  assert.equal(plan.memoryKey, '__memory__11');
  assert.equal(plan.pdfjsVrijgeven, true);
});

test('een gedeelde PDF.js-instantie wordt niet afgesloten', () => {
  const gedeeld = {};
  const plan = vrijgaveplan({ id: 1, filePath: 'C:/t/a.pdf', pdfDoc: gedeeld }, [{ id: 2, filePath: 'C:/t/b.pdf', pdfDoc: gedeeld }]);
  assert.equal(plan.pdfjsVrijgeven, false);
});

test('zonder PDF.js-instantie valt er niets af te sluiten', () => {
  assert.equal(vrijgaveplan({ id: 1, filePath: 'C:/t/a.pdf' }, []).pdfjsVrijgeven, false);
  assert.equal(vrijgaveplan(null, []).pdfjsVrijgeven, false);
  assert.deepEqual(vrijgaveplan(undefined, undefined).paden, []);
});

test('sleutels per pad: alleen exact dit pad, niet een pad met hetzelfde begin', () => {
  const sleutels = ['C:/t/a.pdf:1:0', 'C:/t/a.pdf:2:90', 'C:/t/a.pdf.bak:1:0', 'C:/t/b.pdf:1:0'];
  assert.deepEqual(sleutelsMetPad(sleutels, 'C:/t/a.pdf'), ['C:/t/a.pdf:1:0', 'C:/t/a.pdf:2:90']);
  assert.deepEqual(sleutelsMetPad(new Map([['C:/t/a.pdf:3:0', 1]]).keys(), 'C:/t/a.pdf'), ['C:/t/a.pdf:3:0']);
});

// ── Tijdelijke werkbestanden (#400) ────────────────────────────────────────
// Een geïmporteerde tekening opent uit een tijdelijke PDF; na een
// paginabewerking rendert het document uit een nieuw werkbestand. Waar het
// document niet meer naar verwijst, hoort weg, en bij sluiten alles.

test('een werkbestand wordt één keer onthouden, en alleen als het er een van de app is', () => {
  const d = doc(1, 'C:/Temp/opds-import-1700000000000-plan.pdf');
  onthoudWerkbestand(d, 'C:/Temp/opds-import-1700000000000-plan.pdf');
  onthoudWerkbestand(d, 'C:/Temp/opds-import-1700000000000-plan.pdf');
  onthoudWerkbestand(d, 'C:\\Temp\\opds-edit-1700000000001.pdf');
  onthoudWerkbestand(d, '');
  onthoudWerkbestand(null, 'C:/Temp/opds-edit-1.pdf');
  // Een gewoon bestand van de gebruiker komt er nooit in, wat de aanroeper ook doet.
  onthoudWerkbestand(d, 'C:/docs/tekening.pdf');
  onthoudWerkbestand(d, 'C:/docs/opds-import-notitie.pdf');
  assert.deepEqual(d._werkbestanden, ['C:/Temp/opds-import-1700000000000-plan.pdf', 'C:\\Temp\\opds-edit-1700000000001.pdf']);
  assert.equal(isWerkbestand('C:/Temp/opds-import-1700000000000-plan.pdf'), true);
  assert.equal(isWerkbestand('C:/Temp/opds-edit-1700000000001.pdf'), true);
  assert.equal(isWerkbestand('C:/Temp/opds-edit-1700000000001.PDF'), true);
  assert.equal(isWerkbestand('C:/docs/opds-import-notitie.pdf'), false);
  assert.equal(isWerkbestand('C:/Temp/opds-import-17-plan.dwg'), false);
  assert.equal(isWerkbestand(undefined), false);
});

test('na een paginabewerking komt de import-PDF vrij waar het document niet meer naar verwijst', () => {
  const importPdf = 'C:/Temp/opds-import-1700000000000-plan.pdf';
  const edit1 = 'C:/Temp/opds-edit-1700000000001.pdf';
  const edit2 = 'C:/Temp/opds-edit-1700000000002.pdf';
  const d = doc(1, importPdf, { isUntitled: true });
  onthoudWerkbestand(d, importPdf);
  assert.deepEqual(losgelatenWerkbestanden(d, []), [], 'zolang het document eruit rendert, blijft het staan');
  // Paginabewerking: het document verwijst nu naar een nieuw werkbestand.
  d.filePath = edit1;
  onthoudWerkbestand(d, edit1);
  assert.deepEqual(losgelatenWerkbestanden(d, []), [importPdf]);
  // Lukte het verwijderen niet (bestand nog in gebruik), dan blijft het
  // onthouden en komt het bij de volgende bewerking opnieuw aan de beurt.
  d.filePath = edit2;
  onthoudWerkbestand(d, edit2);
  assert.deepEqual(losgelatenWerkbestanden(d, []), [importPdf, edit1]);
  vergeetWerkbestand(d, importPdf);
  assert.deepEqual(losgelatenWerkbestanden(d, []), [edit1]);
  // Opgeslagen onder een echte naam: het werkbestand waar Opslaan naartoe
  // schrijft telt als in gebruik, de rest niet.
  d.saveTargetPath = edit1;
  assert.deepEqual(losgelatenWerkbestanden(d, []), []);
});

test('een werkbestand dat een ander tabblad nog gebruikt, blijft staan', () => {
  const gedeeld = 'C:/Temp/opds-import-1700000000000-plan.pdf';
  const d = doc(1, 'C:/Temp/opds-edit-1700000000001.pdf', { _werkbestanden: [gedeeld, 'C:/Temp/opds-edit-1700000000001.pdf'] });
  assert.deepEqual(losgelatenWerkbestanden(d, [doc(2, gedeeld)]), []);
  assert.deepEqual(losgelatenWerkbestanden(d, [doc(2, 'C:/t/x.pdf', { saveTargetPath: gedeeld })]), []);
  assert.deepEqual(losgelatenWerkbestanden(d, [doc(2, 'C:/t/x.pdf', { _werkbestanden: [gedeeld] })]), []);
  assert.deepEqual(losgelatenWerkbestanden(d, [doc(2, 'C:/t/x.pdf')]), [gedeeld]);
});

test('bij sluiten gaan alle werkbestanden van het document weg, ook dat waar het uit rendert', () => {
  const importPdf = 'C:/Temp/opds-import-1700000000000-plan.pdf';
  const edit = 'C:/Temp/opds-edit-1700000000001.pdf';
  const dicht = doc(1, edit, { isUntitled: true, _werkbestanden: [importPdf, edit] });
  const plan = vrijgaveplan(dicht, [doc(2, 'C:/t/b.pdf')]);
  assert.deepEqual(plan.werkbestanden, [importPdf, edit]);
  // De caches van die paden gaan eerst weg, dan pas de bestanden.
  assert.deepEqual(plan.paden, [edit]);
  // Een ander tabblad op hetzelfde werkbestand houdt het in leven.
  assert.deepEqual(vrijgaveplan(dicht, [doc(2, importPdf)]).werkbestanden, [edit]);
  // Een gewoon document heeft niets op te ruimen, en een echt bestand gaat nooit weg.
  assert.deepEqual(vrijgaveplan(doc(3, 'C:/t/a.pdf'), []).werkbestanden, []);
  assert.deepEqual(vrijgaveplan(doc(4, 'C:/t/a.pdf', { _werkbestanden: ['C:/t/a.pdf'] }), []).werkbestanden, []);
});

// Een nagebootste schijf: een bestand dat de app zelf vergrendeld heeft
// (lock_file bij het openen) is niet te verwijderen tot de vergrendeling eraf is.
function nepSchijf(bestanden, vergrendeld = []) {
  const schijf = {
    bestanden: new Set(bestanden), vergrendeld: new Set(vergrendeld), stappen: [],
    middelen: {
      geefVrij: async (pad) => { schijf.stappen.push(`vrij ${pad}`); },
      ontgrendel: async (pad) => { schijf.stappen.push(`ontgrendel ${pad}`); schijf.vergrendeld.delete(pad); },
      verwijder: async (pad) => {
        schijf.stappen.push(`verwijder ${pad}`);
        if (schijf.vergrendeld.has(pad)) throw new Error('in gebruik');
        if (!schijf.bestanden.delete(pad)) throw new Error('bestaat niet');
      },
      bestaat: async (pad) => schijf.bestanden.has(pad),
    },
  };
  return schijf;
}

test('een werkbestand dat de app bij het openen vergrendelde, gaat bij het opruimen echt weg', async () => {
  // Import als nieuw document (het openen vergrendelt de import-PDF), daarna
  // een paginabewerking: het document rendert uit een werkkopie en niemand
  // haalt de vergrendeling nog van de import-PDF af.
  const importPdf = 'C:/Temp/opds-import-1700000000000-plan.pdf';
  const edit = 'C:/Temp/opds-edit-1700000000001.pdf';
  const d = doc(1, edit, { isUntitled: true, _werkbestanden: [importPdf, edit] });
  const schijf = nepSchijf([importPdf, edit], [importPdf]);
  const weg = await ruimWerkbestandenOp(d, losgelatenWerkbestanden(d, []), schijf.middelen);
  assert.equal(weg, 1);
  assert.equal(schijf.bestanden.has(importPdf), false, 'de import-PDF is van schijf');
  assert.deepEqual(d._werkbestanden, [edit]);
  // Eerst de caches, dan de vergrendeling, dan pas verwijderen.
  assert.deepEqual(schijf.stappen, [`vrij ${importPdf}`, `ontgrendel ${importPdf}`, `verwijder ${importPdf}`]);
  // Bij sluiten gaat ook de werkkopie weg.
  const plan = vrijgaveplan(d, []);
  assert.equal(await ruimWerkbestandenOp(d, plan.werkbestanden, schijf.middelen), 1);
  assert.equal(schijf.bestanden.size, 0);
  assert.deepEqual(d._werkbestanden, []);
});

test('opruimen raakt alleen werkbestanden van de app, en onthoudt wat nog niet weg kon', async () => {
  const echt = 'C:/docs/plan.pdf';
  const edit = 'C:/Temp/opds-edit-1700000000001.pdf';
  const alWeg = 'C:/Temp/opds-edit-1700000000002.pdf';
  const d = doc(1, echt, { _werkbestanden: [edit, alWeg] });
  const schijf = nepSchijf([echt, edit]);
  // Een andere lezer houdt de werkkopie vast: ontgrendelen helpt dan niet.
  schijf.middelen.ontgrendel = async () => {};
  schijf.vergrendeld.add(edit);
  assert.equal(await ruimWerkbestandenOp(d, [echt, edit, alWeg], schijf.middelen), 0);
  assert.equal(schijf.bestanden.has(echt), true, 'een echt bestand gaat nooit weg');
  assert.equal(schijf.stappen.some((s) => s.endsWith(echt)), false, 'en wordt ook niet ontgrendeld');
  assert.deepEqual(d._werkbestanden, [edit], 'wat al weg was is vergeten, wat vastzit blijft onthouden');
  // Een mislukte ontgrendeling houdt het opruimen niet tegen.
  schijf.vergrendeld.clear();
  schijf.middelen.ontgrendel = async () => { throw new Error('geen brug'); };
  assert.equal(await ruimWerkbestandenOp(d, [edit], schijf.middelen), 1);
  // Zonder schijftoegang (webversie, test zonder venster) gebeurt er niets.
  assert.equal(await ruimWerkbestandenOp(d, [edit]), 0);
});

test('de opruiming bij de start neemt oude werkbestanden van import en paginabewerking mee, en niets anders', async () => {
  const { ouderdomWerkbestand } = await import('./document-release.js');
  const nu = 1_800_000_000_000;
  const dag = 24 * 60 * 60 * 1000;
  // De tijd staat in de naam: zo oud is het bestand.
  assert.equal(ouderdomWerkbestand('opds-import-1700000000000-plan.pdf', nu), nu - 1_700_000_000_000);
  assert.equal(ouderdomWerkbestand('opds-edit-1700000000001.pdf', nu), nu - 1_700_000_000_001);
  assert.equal(ouderdomWerkbestand('OPDS-EDIT-1700000000001.PDF', nu), nu - 1_700_000_000_001);
  assert.ok(ouderdomWerkbestand(`opds-edit-${nu - 2 * dag}.pdf`, nu) > dag);
  assert.ok(ouderdomWerkbestand(`opds-edit-${nu - 1000}.pdf`, nu) < dag, 'een werkbestand van nu blijft staan');
  // Geen werkbestand van de app: nooit aankomen.
  for (const naam of ['opds-import-notitie.pdf', 'opds-edit-17.pdf', 'opds-import-1700000000000-plan.dwg', 'mijn-opds-edit-1700000000001.pdf', 'opds-print-1700000000000.pdf', '', null]) {
    assert.equal(ouderdomWerkbestand(naam, nu), null, String(naam));
  }
  // Een tijd in de toekomst (klok verzet) is geen reden om op te ruimen.
  assert.equal(ouderdomWerkbestand(`opds-edit-${nu + dag}.pdf`, nu), -dag);
});
