import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rechtenNaarP, rechtenUitP, allesToegestaan, beveiligingUitSessie, onbekendeBeveiliging,
  kanBeveiligingSchrijven, magBeveiligingWijzigen, beperktDoorRechten, magPrinten, bepaalWijziging,
  beschrijfBeveiliging, RECHTEN_LIJST, RECHT_BITS,
} from './document-beveiliging.js';
import { opslaanGeweigerd, isAlleenLezen, markeerBeveiligd, heeftBeveiligdeInhoud, heeftWerkkopie } from './wachtwoord-pdf.js';
import { STANDAARD_RECHTEN } from './protect-pdf-regels.js';

const geen = Object.fromEntries(Object.keys(RECHT_BITS).map((k) => [k, false]));

// Dezelfde waarden als Rechten::bits in open-pdf-security.
test('rechtenNaarP: alles aan, alles uit en losse rechten', () => {
  assert.equal(rechtenNaarP(STANDAARD_RECHTEN) >>> 0, 0xFFFFFFFC);
  assert.equal(rechtenNaarP(geen) >>> 0, 0xFFFFF0C0);
  assert.equal(rechtenNaarP({ ...geen, print: true }) >>> 0, 0xFFFFF0C4);
  assert.equal(rechtenNaarP({ ...geen, kopieren: true, toegankelijkheid: true }) >>> 0, 0xFFFFF2D0);
  // Een 32-bits getal met teken, zoals /P in het bestand staat.
  assert.equal(rechtenNaarP(geen), -3904);
});

test('rechtenUitP is het omgekeerde van rechtenNaarP', () => {
  for (const r of [STANDAARD_RECHTEN, geen, { ...geen, annoteren: true, formulieren: true }, { ...STANDAARD_RECHTEN, kopieren: false }]) {
    assert.deepEqual(rechtenUitP(rechtenNaarP(r)), { ...r });
  }
  assert.ok(allesToegestaan(rechtenUitP(-4)));
  assert.ok(!allesToegestaan(rechtenUitP(-3904)));
  assert.ok(!allesToegestaan(null));
});

test('RECHTEN_LIJST noemt elk recht één keer, ook toegankelijkheid', () => {
  assert.deepEqual(RECHTEN_LIJST.map(([k]) => k).sort(), Object.keys(RECHT_BITS).sort());
  assert.deepEqual(Object.keys(STANDAARD_RECHTEN).sort(), Object.keys(RECHT_BITS).sort());
});

const sessie = (over = {}) => beveiligingUitSessie({
  handle: 'abc', methode: 'AES-256', revisie: 6, p: -3904, rechten: { ...geen },
  eigenaarToegang: false, openWachtwoord: true, magWijzigen: false, ...over,
});

test('beveiligingUitSessie: van het Rust-antwoord naar doc.beveiliging', () => {
  const b = sessie();
  assert.equal(b.versleuteld, true);
  assert.equal(b.sessie, 'abc');
  assert.equal(b.methode, 'AES-256');
  assert.equal(b.inAfwachting, false);
  assert.equal(beveiligingUitSessie(null), null);
  // Zonder rechten-object: uit P.
  assert.deepEqual(beveiligingUitSessie({ handle: null, p: -4 }).rechten, { ...STANDAARD_RECHTEN });
  assert.equal(beveiligingUitSessie({ handle: null, p: -4 }).sessie, null);
  assert.equal(beveiligingUitSessie({ handle: 'x', eigenaarToegang: true }).magWijzigen, true);
});

test('opslaan: met een sessie mag het, een oudere methode of onleesbare beveiliging niet', () => {
  assert.equal(opslaanGeweigerd({ beveiliging: sessie() }), false);
  assert.equal(opslaanGeweigerd({ passwordProtected: true, beveiliging: sessie() }), false);
  assert.equal(opslaanGeweigerd({ passwordProtected: true, beveiliging: sessie({ handle: null, methode: 'RC4 128-bit' }) }), true);
  assert.equal(opslaanGeweigerd({ passwordProtected: true, beveiliging: onbekendeBeveiliging({ openWachtwoord: true }) }), true);
  // Browser: met een wachtwoord geopend zonder sessie.
  assert.equal(opslaanGeweigerd({ passwordProtected: true }), true);
  // Beveiliging verwijderd (nog niet opgeslagen): gewoon schrijven.
  assert.equal(opslaanGeweigerd({ passwordProtected: true, beveiliging: { versleuteld: false } }), false);
  assert.equal(kanBeveiligingSchrijven({}), true);
});

test('alleen-lezen: rechten zonder wijzigen en annoteren, tenzij met het rechtenwachtwoord', () => {
  const doc = { beveiliging: sessie() };
  assert.equal(beperktDoorRechten(doc), true);
  assert.equal(isAlleenLezen(doc), true);
  doc.beveiliging = sessie({ rechten: { ...geen, annoteren: true } });
  assert.equal(isAlleenLezen(doc), false, 'annoteren mag: bewerkbaar');
  doc.beveiliging = sessie({ eigenaarToegang: true });
  assert.equal(isAlleenLezen(doc), false, 'met het rechtenwachtwoord mag alles');
  doc.beveiliging = sessie({ handle: null, rechten: { ...STANDAARD_RECHTEN } });
  assert.equal(isAlleenLezen(doc), true, 'oudere methode: niet terug te schrijven');
});

test('printen volgt het printrecht', () => {
  assert.equal(magPrinten({}), true);
  assert.equal(magPrinten({ beveiliging: sessie() }), false);
  assert.equal(magPrinten({ beveiliging: sessie({ rechten: { ...geen, print: true } }) }), true);
  assert.equal(magPrinten({ beveiliging: sessie({ eigenaarToegang: true }) }), true);
  assert.equal(magPrinten({ beveiliging: { versleuteld: false } }), true);
});

test('wijzigen: rechtenwachtwoord, of een bestand zonder beperkingen', () => {
  assert.equal(magBeveiligingWijzigen(null), true);
  assert.equal(magBeveiligingWijzigen(sessie()), false);
  assert.equal(magBeveiligingWijzigen(sessie({ eigenaarToegang: true })), true);
  assert.equal(magBeveiligingWijzigen(sessie({ rechten: { ...STANDAARD_RECHTEN } })), true);
  assert.equal(magBeveiligingWijzigen(sessie({ magWijzigen: true })), true);
});

test('bepaalWijziging: nieuw, verwijderen, alleen rechten, niets en de fouten', () => {
  const alles = { ...STANDAARD_RECHTEN };
  // Onbeveiligd document.
  assert.deepEqual(bepaalWijziging({ huidig: null, keuze: 'geen', gebruiker: '', eigenaar: '', rechten: alles }), { soort: 'niets' });
  assert.deepEqual(bepaalWijziging({ huidig: null, keuze: 'wachtwoord', gebruiker: 'abcdef', eigenaar: '', rechten: alles }), { soort: 'nieuw' });
  assert.deepEqual(bepaalWijziging({ huidig: null, keuze: 'wachtwoord', gebruiker: '', eigenaar: '', rechten: alles }), { fout: 'protectPdf.needPassword' });
  // Beveiligd, met het rechtenwachtwoord geopend.
  const eigen = sessie({ eigenaarToegang: true });
  assert.deepEqual(bepaalWijziging({ huidig: eigen, keuze: 'geen', gebruiker: '', eigenaar: '', rechten: alles }), { soort: 'verwijder' });
  assert.deepEqual(bepaalWijziging({ huidig: eigen, keuze: 'wachtwoord', gebruiker: '', eigenaar: '', rechten: { ...geen } }), { soort: 'niets' });
  assert.deepEqual(bepaalWijziging({ huidig: eigen, keuze: 'wachtwoord', gebruiker: '', eigenaar: '', rechten: alles }), { soort: 'rechten' });
  assert.deepEqual(bepaalWijziging({ huidig: eigen, keuze: 'wachtwoord', gebruiker: '', eigenaar: 'nieuw1', rechten: alles }), { soort: 'nieuw' });
  // Alleen het openwachtwoord en wel beperkingen: het rechtenwachtwoord is nodig.
  const gebruiker = sessie();
  assert.deepEqual(bepaalWijziging({ huidig: gebruiker, keuze: 'geen', gebruiker: '', eigenaar: '', rechten: alles }), { fout: 'protectPdf.ownerPasswordHint' });
  assert.deepEqual(bepaalWijziging({ huidig: gebruiker, keuze: 'wachtwoord', gebruiker: 'nieuw1', eigenaar: '', rechten: alles }), { fout: 'protectPdf.ownerPasswordHint' });
  // Niets veranderd vraagt geen wachtwoord.
  assert.deepEqual(bepaalWijziging({ huidig: gebruiker, keuze: 'wachtwoord', gebruiker: '', eigenaar: '', rechten: { ...geen } }), { soort: 'niets' });
  // Oudere methode: alleen rechten wijzigen kan niet.
  const oud = sessie({ handle: null, eigenaarToegang: true, methode: 'RC4 128-bit' });
  assert.deepEqual(bepaalWijziging({ huidig: oud, keuze: 'wachtwoord', gebruiker: '', eigenaar: '', rechten: alles }), { fout: 'protectPdf.olderMethodInfo' });
  assert.deepEqual(bepaalWijziging({ huidig: oud, keuze: 'geen', gebruiker: '', eigenaar: '', rechten: alles }), { soort: 'verwijder' });
});

test('beschrijfBeveiliging: wat de documenteigenschappen tonen', () => {
  assert.deepEqual(beschrijfBeveiliging(null).versleuteld, false);
  const b = beschrijfBeveiliging(sessie({ rechten: { ...geen, print: true, toegankelijkheid: true } }));
  assert.equal(b.methode, 'AES-256');
  assert.equal(b.openWachtwoord, true);
  assert.deepEqual(b.rechten, ['print', 'toegankelijkheid']);
  assert.equal(b.alles, false);
  assert.equal(b.volledigeToegang, false);
  assert.equal(beschrijfBeveiliging(sessie({ rechten: { ...STANDAARD_RECHTEN } })).alles, true);
  const weg = beschrijfBeveiliging({ versleuteld: false, inAfwachting: true });
  assert.equal(weg.versleuteld, false);
  assert.equal(weg.inAfwachting, true);
});

test('markeerBeveiligd: met een beveiliging schrijft opslaan naar het origineel', () => {
  const doc = { filePath: 'C:/Temp/opds-beveiligd/1-0123456789abcdef.pdf' };
  markeerBeveiligd(doc, 'D:/Projecten/geheim.pdf', { gevraagd: false, beveiliging: sessie({ rechten: { ...STANDAARD_RECHTEN } }) });
  assert.equal(doc.passwordProtected, false, 'zonder openwachtwoord geopend');
  assert.equal(doc.originalFilePath, 'D:/Projecten/geheim.pdf');
  assert.equal(doc.saveTargetPath, 'D:/Projecten/geheim.pdf');
  assert.equal(heeftWerkkopie(doc), true);
  assert.equal(heeftBeveiligdeInhoud(doc), true);
  assert.equal(opslaanGeweigerd(doc), false);
  assert.equal(isAlleenLezen(doc), false);
  // Zonder beveiliging (browser): zoals vroeger, alleen-lezen.
  const web = { filePath: 'geheim.pdf' };
  markeerBeveiligd(web, 'geheim.pdf');
  assert.equal(web.saveTargetPath, undefined);
  assert.equal(opslaanGeweigerd(web), true);
});
