import assert from 'node:assert/strict';
import test from 'node:test';
import { controleerWachtwoorden } from './protect-pdf-regels.js';

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
