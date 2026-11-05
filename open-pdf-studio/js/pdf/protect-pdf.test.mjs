import assert from 'node:assert/strict';
import test from 'node:test';
import {
  controleerWachtwoorden, bereidWachtwoordVoor, wachtwoordBytes, MAX_WACHTWOORD_BYTES, foutMelding,
} from './protect-pdf-regels.js';

const leeg = { gebruiker: '', gebruikerHerhaald: '', eigenaar: '', eigenaarHerhaald: '' };

test('controleerWachtwoorden: minstens één wachtwoord', () => {
  assert.equal(controleerWachtwoorden(leeg), 'protectPdf.needPassword');
});

test('controleerWachtwoorden: een open-wachtwoord alleen is genoeg', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, gebruiker: 'abcdef', gebruikerHerhaald: 'abcdef' }), null);
});

test('controleerWachtwoorden: een rechten-wachtwoord alleen is genoeg', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, eigenaar: 'abcdef', eigenaarHerhaald: 'abcdef' }), null);
});

test('controleerWachtwoorden: herhaling moet kloppen', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, gebruiker: 'abcdef', gebruikerHerhaald: 'abcdeg' }), 'protectPdf.userMismatch');
  assert.equal(controleerWachtwoorden({ ...leeg, eigenaar: 'abcdef', eigenaarHerhaald: '' }), 'protectPdf.ownerMismatch');
});

test('controleerWachtwoorden: twee gelijke wachtwoorden zijn niet toegestaan', () => {
  assert.equal(
    controleerWachtwoorden({ gebruiker: 'abcdef', gebruikerHerhaald: 'abcdef', eigenaar: 'abcdef', eigenaarHerhaald: 'abcdef' }),
    'protectPdf.samePassword');
});

test('controleerWachtwoorden: een te kort wachtwoord wordt geweigerd', () => {
  assert.equal(controleerWachtwoorden({ ...leeg, gebruiker: 'abc', gebruikerHerhaald: 'abc' }), 'protectPdf.tooShort');
  assert.equal(controleerWachtwoorden({ ...leeg, eigenaar: 'ab', eigenaarHerhaald: 'ab' }), 'protectPdf.tooShort');
});

// Wat het programma bij openen zelf niet voorbereidt (PDFium), moet al bij het
// instellen gelijk zijn aan wat de gebruiker typt.
const goed = (w) => ({ gebruiker: w, gebruikerHerhaald: w, eigenaar: '', eigenaarHerhaald: '' });

test('controleerWachtwoorden: hoogstens 127 UTF-8-bytes, ook voor het rechtenwachtwoord', () => {
  assert.equal(controleerWachtwoorden(goed('L'.repeat(127))), null);
  assert.equal(controleerWachtwoorden(goed('L'.repeat(128))), 'protectPdf.tooLong');
  // 42 Chinese tekens = 126 bytes; 43 = 129 bytes.
  assert.equal(controleerWachtwoorden(goed('密'.repeat(42))), null);
  assert.equal(controleerWachtwoorden(goed('密'.repeat(43))), 'protectPdf.tooLong');
  const e = 'x'.repeat(130);
  assert.equal(controleerWachtwoorden({ gebruiker: '', gebruikerHerhaald: '', eigenaar: e, eigenaarHerhaald: e }), 'protectPdf.tooLong');
  assert.equal(wachtwoordBytes('\u{1F512}ab'), 6);
  assert.equal(MAX_WACHTWOORD_BYTES, 127);
});

test('controleerWachtwoorden: tekens die de voorbereiding verandert worden geweigerd', () => {
  for (const w of [
    'Ｐａｓｓ密码', // volle breedte (IME)
    'wacht²woord', // superscript
    'café-geheim', // ontbonden accent
    'geheim woord', // vaste spatie
    'geheim­woord', // zacht afbreekstreepje
    'geheim​woord', // spatie zonder breedte
    'geheim\twoord', // stuurteken
  ]) {
    assert.equal(controleerWachtwoorden(goed(w)), 'protectPdf.notPortable', JSON.stringify(w));
  }
});

test('controleerWachtwoorden: gewone wachtwoorden in elk schrift blijven toegestaan', () => {
  for (const w of [
    'Wachtwoörd-é', // gecomponeerde accenten
    '密码测试安全', // Chinees
    'סיסמה123', // Hebreeuws met cijfers
    'كلمةسر 2026', // Arabisch met cijfers
    'slot\u{1F512}abc', // emoji
    'met spatie erin',
  ]) {
    assert.equal(controleerWachtwoorden(goed(w)), null, JSON.stringify(w));
  }
});

test('bereidWachtwoordVoor: toewijzing en NFKC zoals de Rust-kant en pdf.js', () => {
  assert.equal(bereidWachtwoordVoor('a b­c'), 'a bc');
  assert.equal(bereidWachtwoordVoor('Ｐa²'), 'Pa2');
  assert.equal(bereidWachtwoordVoor('café'), 'café');
});

test('foutMelding: vaste foutcodes van de Rust-kant worden vertaalsleutels', () => {
  assert.deepEqual(foutMelding('ALREADY_ENCRYPTED'), { sleutel: 'protectPdf.errorEncrypted', opties: {} });
  assert.deepEqual(foutMelding('NEED_PASSWORD'), { sleutel: 'protectPdf.needPassword', opties: {} });
  assert.deepEqual(foutMelding('INCOMPLETE: 2'), { sleutel: 'protectPdf.errorIncomplete', opties: {} });
  assert.deepEqual(foutMelding('READ_FAILED: invalid file header'),
    { sleutel: 'protectPdf.errorRead', opties: { detail: 'invalid file header' } });
  assert.deepEqual(foutMelding(new Error('WRITE_FAILED: Access is denied. (os error 5)')),
    { sleutel: 'protectPdf.errorWrite', opties: { detail: 'Access is denied. (os error 5)' } });
  assert.deepEqual(foutMelding('iets onbekends'), { sleutel: 'protectPdf.failed', opties: { error: 'iets onbekends' } });
});
