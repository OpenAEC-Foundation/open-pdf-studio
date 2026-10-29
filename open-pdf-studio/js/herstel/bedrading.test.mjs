import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// De herstelbewaking hangt aan een paar plekken in de rest van de app. Deze
// test bewaakt die aansluitingen in de bron (de modules zelf hebben een DOM
// en Tauri nodig).
const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..', '..');
// Regeleinden gelijktrekken: een Windows-checkout heeft CRLF.
const lees = (rel) => readFileSync(path.join(app, rel), 'utf8').replace(/\r\n/g, '\n');

test('saver: momentopname schrijft niets weg en markeert niets als opgeslagen', () => {
  const s = lees('js/pdf/saver.js');
  const begin = s.indexOf('if (momentopname) {\n      return new Uint8Array(await pdfDocLib.save(');
  assert.ok(begin > 0, 'momentopname keert terug met de bytes');
  const schrijf = s.indexOf('await writeBinaryFileAtomic(outputPath');
  const gemarkeerd = s.indexOf('markDocumentSaved(activeDoc);');
  assert.ok(begin < schrijf && begin < gemarkeerd, 'terug vóór het wegschrijven en markeren');
  assert.match(s, /if \(alleenAnnotaties \|\| momentopname\) throw error;/, 'geen melding aan de gebruiker');
  // Geen voortgangsvenster, dus ook geen Annuleren (#766); nooit te annuleren.
  assert.match(s, /const eigenVenster = !momentopname && !alleenAnnotaties;/);
  assert.match(s, /if \(eigenVenster\) toonVoortgang\(\);/);
  assert.match(s, /const annulering = momentopname \? GEEN_ANNULERING :/);
  assert.match(s, /if \(opslaanGeweigerd\(doc\)\) throw new Error\('password-protected/, 'beveiligd = nooit');
});

test('saver: na een geslaagde save gaat de momentopname weg; save wacht op een lopende momentopname', () => {
  const s = lees('js/pdf/saver.js');
  assert.match(s, /if \(gelukt && activeDoc\) meldOpgeslagen\(activeDoc\);/);
  assert.match(s, /if \(_momentopnameBezig\) await _momentopnameBezig\.catch/);
});

test('tabbladen: sluiten meldt het, ook bij "niet opslaan"', () => {
  const s = lees('js/ui/chrome/tabs.js');
  const splice = s.indexOf('state.documents.splice(index, 1);');
  const melding = s.indexOf('meldGesloten(doc);');
  assert.ok(splice > 0 && melding > splice && melding - splice < 200);
  assert.match(s, /savedUndoStackLength = -1;\n\s+meldWijziging\(doc\);/);
});

test('afsluiten: schoon afsluiten pas als alle tabbladen dicht zijn', () => {
  const m = lees('js/main.js');
  const lus = m.indexOf('const closed = await closeActiveTab();');
  const schoon = m.indexOf('await meldSchoonAfsluiten();');
  assert.ok(lus > 0 && schoon > lus, 'na de sluitlus (annuleren = return, geen schone afsluiting)');
  const menu = lees('js/solid/components/app-menu/AppMenu.jsx');
  assert.ok(menu.indexOf('await meldSchoonAfsluiten();') < menu.indexOf('closeWindow();'));
});

test('alleen de hoofdinstantie biedt herstel aan', async () => {
  const { taakToegestaan } = await import('../core/instantie-rol.js');
  assert.equal(taakToegestaan('herstel-aanbieden', { tweede: false }), true);
  assert.equal(taakToegestaan('herstel-aanbieden', { tweede: true }), false);
  assert.match(lees('js/main.js'), /startHerstel\(\{ hoofd: taakToegestaan\('herstel-aanbieden', rol\) \}\)/);
});

test('headless: geen venster, het aanbod gaat naar het logboek', () => {
  const s = lees('js/herstel/herstel.js');
  const tak = s.indexOf('if (info.headless || isHeadless()) {');
  assert.ok(tak > 0);
  const venster = s.indexOf("openDialog('recovery')");
  const log = s.indexOf('recovery offer (headless, no dialog)');
  assert.ok(log > tak && venster > log, 'de headless-tak komt vóór het venster');
});

test('vertalingen: elke taal heeft alle teksten van het herstelvenster', () => {
  const map = path.join(app, 'js', 'i18n', 'locales');
  const en = JSON.parse(readFileSync(path.join(map, 'en', 'dialogs.json'), 'utf8')).recovery;
  const sleutels = Object.keys(en);
  assert.ok(sleutels.length >= 20);
  const talen = readdirSync(map);
  assert.ok(talen.length >= 40);
  for (const taal of talen) {
    const r = JSON.parse(readFileSync(path.join(map, taal, 'dialogs.json'), 'utf8')).recovery;
    assert.ok(r, `${taal}: geen recovery`);
    for (const k of sleutels) {
      assert.equal(typeof r[k], 'string', `${taal}.${k}`);
      assert.ok(r[k].trim(), `${taal}.${k} leeg`);
      for (const p of en[k].match(/\{\{\w+\}\}/g) || []) assert.ok(r[k].includes(p), `${taal}.${k} mist ${p}`);
    }
  }
  const nl = JSON.parse(readFileSync(path.join(map, 'nl', 'dialogs.json'), 'utf8')).recovery;
  assert.equal(nl.title, 'Niet-opgeslagen werk herstellen');
  assert.equal(nl.open, 'Openen');
  assert.equal(nl.deleteAll, 'Alles verwijderen');
  assert.equal(nl.later, 'Later');
});
