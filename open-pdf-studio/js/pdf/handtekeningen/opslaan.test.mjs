import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handtekeningenInGevaar, wachtOpVerificatie, beslisOpslaanVraag, moetOpnieuwVerifieren,
  moetOpslaanVoorVerzenden, voorgesteldeBestandsnaam, opslaanAlsStandaardPad, actiefNaSluiten,
  uitkomstSleutel,
} from './opslaan.js';

const intact = { integriteit: { uitkomst: 'intact' }, status: { code: 'geldig' } };
const gewijzigd = { integriteit: { uitkomst: 'gewijzigd' }, status: { code: 'gewijzigd-na-ondertekenen' } };

test('handtekeningenInGevaar per toestand', () => {
  assert.equal(handtekeningenInGevaar(null), false);
  assert.equal(handtekeningenInGevaar({}), false);
  assert.equal(handtekeningenInGevaar({ handtekeningToestand: 'geen' }), false);
  assert.equal(handtekeningenInGevaar({ handtekeningToestand: 'klaar', handtekeningen: [intact] }), true);
  assert.equal(handtekeningenInGevaar({ handtekeningToestand: 'klaar', handtekeningen: [gewijzigd] }), false);
  // Velden bekend, uitkomst onbekend: voor de zekerheid vragen.
  assert.equal(handtekeningenInGevaar({ handtekeningToestand: 'bezig' }), true);
  assert.equal(handtekeningenInGevaar({ handtekeningToestand: 'fout', handtekeningen: [] }), true);
});

test('wachtOpVerificatie: zonder belofte direct, anders tot klaar of time-out', async () => {
  assert.equal(await wachtOpVerificatie({}), 'klaar');
  assert.equal(await wachtOpVerificatie({ _handtekeningBelofte: Promise.resolve() }, 50), 'klaar');
  assert.equal(await wachtOpVerificatie({ _handtekeningBelofte: Promise.reject(new Error('x')) }, 50), 'klaar');
  assert.equal(await wachtOpVerificatie({ _handtekeningBelofte: new Promise(() => {}) }, 20), 'time-out');
});

test('opslaan tijdens lopende verificatie wacht op de uitkomst en vraagt dan', async () => {
  const doc = { handtekeningToestand: 'bezig' };
  doc._handtekeningBelofte = new Promise((r) => setTimeout(() => {
    doc.handtekeningToestand = 'klaar';
    doc.handtekeningen = [intact];
    r();
  }, 10));
  let vragen = 0;
  const uit = await beslisOpslaanVraag(doc, async () => { vragen++; return false; }, { wachttijdMs: 1000 });
  assert.equal(uit, false);
  assert.equal(vragen, 1);
});

test('lopende verificatie zonder intacte handtekening: niet vragen', async () => {
  const doc = { handtekeningToestand: 'bezig' };
  doc._handtekeningBelofte = new Promise((r) => setTimeout(() => {
    doc.handtekeningToestand = 'klaar';
    doc.handtekeningen = [gewijzigd];
    r();
  }, 10));
  let vragen = 0;
  assert.equal(await beslisOpslaanVraag(doc, async () => { vragen++; return false; }, { wachttijdMs: 1000 }), true);
  assert.equal(vragen, 0);
});

test('time-out tijdens verificatie met bekende velden: vragen', async () => {
  const doc = { handtekeningToestand: 'bezig', _handtekeningBelofte: new Promise(() => {}) };
  let vragen = 0;
  assert.equal(await beslisOpslaanVraag(doc, async () => { vragen++; return true; }, { wachttijdMs: 20 }), true);
  assert.equal(vragen, 1);
});

test('fout bij verifiëren: vragen', async () => {
  let vragen = 0;
  const doc = { handtekeningToestand: 'fout', handtekeningen: [] };
  assert.equal(await beslisOpslaanVraag(doc, async () => { vragen++; return false; }), false);
  assert.equal(vragen, 1);
});

test('geen handtekeningen: niet vragen', async () => {
  let vragen = 0;
  assert.equal(await beslisOpslaanVraag({ handtekeningToestand: 'geen' }, async () => { vragen++; return false; }), true);
  assert.equal(await beslisOpslaanVraag(null, async () => { vragen++; return false; }), true);
  assert.equal(vragen, 0);
});

test('twee keer snel opslaan: één vraag per document, beide krijgen hetzelfde antwoord', async () => {
  const doc = { handtekeningToestand: 'klaar', handtekeningen: [intact] };
  let vragen = 0;
  let antwoord;
  const vraag = () => { vragen++; return new Promise((r) => { antwoord = r; }); };
  const a = beslisOpslaanVraag(doc, vraag);
  const b = beslisOpslaanVraag(doc, vraag);
  await new Promise((r) => setTimeout(r, 5));
  antwoord(true);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(vragen, 1);
  assert.equal(doc._handtekeningVraag, null);
  // Een latere, losse opslag vraagt opnieuw.
  const c = beslisOpslaanVraag(doc, async () => { vragen++; return false; });
  assert.equal(await c, false);
  assert.equal(vragen, 2);
});

test('opnieuw verifiëren na opslaan zodra er een toestand is die niet "geen" is', () => {
  assert.equal(moetOpnieuwVerifieren(null), false);
  assert.equal(moetOpnieuwVerifieren({}), false);
  assert.equal(moetOpnieuwVerifieren({ handtekeningToestand: 'geen' }), false);
  assert.equal(moetOpnieuwVerifieren({ handtekeningToestand: 'klaar', handtekeningen: [] }), true);
  assert.equal(moetOpnieuwVerifieren({ handtekeningToestand: 'fout' }), true);
  assert.equal(moetOpnieuwVerifieren({ handtekeningToestand: 'bezig' }), true);
  // Nog lopend maar zonder toestand (velden nog niet bekend): ook opnieuw.
  assert.equal(moetOpnieuwVerifieren({ _handtekeningBelofte: new Promise(() => {}) }), true);
});

test('verzenden per e-mail slaat alleen op als het nodig is', () => {
  assert.equal(moetOpslaanVoorVerzenden({ filePath: 'a.pdf', modified: false }), false);
  assert.equal(moetOpslaanVoorVerzenden({ filePath: 'a.pdf', modified: true }), true);
  assert.equal(moetOpslaanVoorVerzenden({ filePath: 'tmp.pdf', isUntitled: true }), true);
  assert.equal(moetOpslaanVoorVerzenden({ filePath: null }), true);
});

test('voorgestelde bestandsnaam voor opslaan als', () => {
  assert.equal(voorgesteldeBestandsnaam('Untitled 1'), 'Untitled 1.pdf');
  assert.equal(voorgesteldeBestandsnaam('rapport.pdf'), 'rapport.pdf');
  assert.equal(voorgesteldeBestandsnaam('rapport.PDF (ondertekende versie 2)'), 'rapport (ondertekende versie 2).pdf');
  assert.equal(voorgesteldeBestandsnaam('a/b:c*?.pdf'), 'a_b_c__.pdf');
  assert.equal(voorgesteldeBestandsnaam(''), 'document.pdf');
  assert.equal(voorgesteldeBestandsnaam(null), 'document.pdf');
});

test('standaardpad voor opslaan als: naamloos in een normale map, anders het eigen pad', () => {
  assert.equal(
    opslaanAlsStandaardPad({ filePath: 'C:\\Temp\\opds-untitled-1.pdf', isUntitled: true, fileName: 'Untitled 1' }, 'D:\\Docs'),
    'D:\\Docs\\Untitled 1.pdf',
  );
  assert.equal(
    opslaanAlsStandaardPad({ filePath: '/tmp/x.pdf', isUntitled: true, fileName: 'r.pdf (v 1)', _voorgesteldeMap: '/home/u/stukken/' }, '/home/u/Documents'),
    '/home/u/stukken/r (v 1).pdf',
  );
  // Zonder map alleen de naam; het dialoogvenster kiest dan zelf een map.
  assert.equal(opslaanAlsStandaardPad({ filePath: '/tmp/x.pdf', isUntitled: true, fileName: 'n' }, null), 'n.pdf');
  assert.equal(opslaanAlsStandaardPad({ filePath: 'D:\\a\\b.pdf', fileName: 'b.pdf' }, 'D:\\Docs'), 'D:\\a\\b.pdf');
  assert.equal(opslaanAlsStandaardPad({ saveTargetPath: 'D:\\a\\b.pdf', filePath: 'C:\\Temp\\w.pdf', fileName: 'b.pdf' }, 'D:\\Docs'), 'D:\\a\\b.pdf');
});

test('actief tabblad na sluiten van een achtergrondtabblad blijft hetzelfde document', () => {
  const a = { id: 'a' }; const b = { id: 'b' }; const c = { id: 'c' };
  // b gesloten (index 1) terwijl c actief was: c staat nu op index 1.
  assert.equal(actiefNaSluiten([a, c], 1, c), 1);
  // b gesloten terwijl a actief was.
  assert.equal(actiefNaSluiten([a, c], 1, a), 0);
  // Het actieve document zelf gesloten: het vorige tabblad.
  assert.equal(actiefNaSluiten([a, c], 1, b), 0);
  assert.equal(actiefNaSluiten([b, c], 0, a), 0);
  assert.equal(actiefNaSluiten([], 0, a), -1);
});

test('uitkomstsleutel verandert alleen bij een andere uitkomst', () => {
  const k1 = uitkomstSleutel('klaar', [{ nummer: 0, ...intact }], '');
  assert.equal(k1, uitkomstSleutel('klaar', [{ nummer: 0, ...intact, detail: 'anders' }], ''));
  assert.notEqual(k1, uitkomstSleutel('klaar', [{ nummer: 0, ...gewijzigd }], ''));
  assert.notEqual(k1, uitkomstSleutel('klaar', [{ nummer: 0, ...intact, daarnaGewijzigd: true }], ''));
  assert.notEqual(uitkomstSleutel('fout', [], 'a'), uitkomstSleutel('fout', [], 'b'));
  assert.notEqual(k1, uitkomstSleutel('fout', [], ''));
});

test('vraag bij opslaan: ander pad is een kopie, zelfde pad overschrijft', async () => {
  const { opslaanVraagSoort } = await import('./opslaan.js');
  const doc = { filePath: 'D:\\Stukken\\a.pdf' };
  assert.equal(opslaanVraagSoort(doc, null), 'overschrijven');
  assert.equal(opslaanVraagSoort(doc, 'D:\\Stukken\\a.pdf'), 'overschrijven');
  assert.equal(opslaanVraagSoort(doc, 'd:/stukken/A.PDF'), 'overschrijven');
  assert.equal(opslaanVraagSoort(doc, 'D:\\Stukken\\a-kopie.pdf'), 'kopie');
  // Werkkopie: het echte bestand is saveTargetPath.
  const werk = { filePath: 'C:\\Temp\\w.pdf', saveTargetPath: 'D:\\Stukken\\a.pdf' };
  assert.equal(opslaanVraagSoort(werk, 'D:\\Stukken\\a.pdf'), 'overschrijven');
  assert.equal(opslaanVraagSoort(werk, 'C:\\Temp\\w.pdf'), 'kopie');
  // Naamloos (bv. een ondertekende versie in een tijdelijk bestand): geen origineel om te behouden.
  assert.equal(opslaanVraagSoort({ filePath: 'C:\\Temp\\x.pdf', isUntitled: true }, 'D:\\y.pdf'), 'overschrijven');
});
