// Eén bron voor de reviewstatussen van markeringen (#1076): de vaste statussen
// van het PDF-reviewmodel plus de eigen statussen uit de voorkeuren.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VASTE_STATUSSEN, eigenStatussen, alleStatussen, zoekStatus, statusKleur,
  statusNaam, isAfgerond, afgerondeStatussen, normaliseerEigenStatussen,
} from './status-sets.js';

const t = (sleutel) => `[${sleutel}]`;

test('de vaste statussen staan er in een vaste volgorde, met reviewed erbij', () => {
  assert.deepEqual(VASTE_STATUSSEN.map((s) => s.key), ['none', 'accepted', 'cancelled', 'completed', 'rejected', 'reviewed']);
});

test('eigen statussen komen na de vaste, met een sleutel in kleine letters', () => {
  const lijst = [{ name: 'Approved', color: '#00aa00', closed: true }, { name: ' In progress ', color: '#ffaa00' }];
  const alle = alleStatussen(lijst);
  assert.deepEqual(alle.slice(-2).map((s) => [s.key, s.name, s.color, s.closed, s.eigen]), [
    ['approved', 'Approved', '#00aa00', true, true],
    ['in progress', 'In progress', '#ffaa00', false, true],
  ]);
  assert.equal(alle.length, VASTE_STATUSSEN.length + 2);
});

test('ongeldige, dubbele en botsende eigen statussen vallen weg', () => {
  const lijst = normaliseerEigenStatussen([
    { name: 'Approved', color: '#00AA00' },
    { name: 'approved', color: '#111111' }, // dubbel (hoofdletters tellen niet)
    { name: 'Completed', color: '#222222' }, // botst met een vaste status
    { name: 'mixed' }, // gereserveerd door het eigenschappenpaneel
    { name: '   ' },
    { name: 'x'.repeat(41) },
    null,
    { name: 'Geen kleur', color: 'rood' },
  ]);
  assert.deepEqual(lijst, [
    { name: 'Approved', color: '#00aa00', closed: false },
    { name: 'Geen kleur', color: '#8b5cf6', closed: false },
  ]);
  assert.deepEqual(eigenStatussen('geen lijst'), []);
});

test('zoeken, kleur en naam werken voor vaste, eigen en onbekende statussen', () => {
  const lijst = [{ name: 'Approved', color: '#00aa00', closed: true }];
  assert.equal(zoekStatus('APPROVED', lijst)?.name, 'Approved');
  assert.equal(statusKleur('approved', lijst), '#00aa00');
  assert.equal(statusKleur('completed', lijst), '#3b82f6');
  assert.equal(statusKleur('none', lijst), null);
  assert.equal(statusKleur('van elders', lijst), '#888888', 'onbekende status uit een ander programma');
  assert.equal(statusNaam('approved', lijst, t), 'Approved');
  assert.equal(statusNaam('completed', lijst, t), '[annotation.statusCompleted]');
  assert.equal(statusNaam('', lijst, t), '[annotation.statusNone]');
  assert.equal(statusNaam('van elders', lijst, t), 'Van elders');
});

test('open of afgerond: vaste afgeronde statussen en eigen met closed', () => {
  const lijst = [{ name: 'Approved', closed: true }, { name: 'In progress' }];
  assert.deepEqual([...afgerondeStatussen(lijst)].sort(), ['approved', 'cancelled', 'completed', 'rejected']);
  assert.equal(isAfgerond('none', lijst), false);
  assert.equal(isAfgerond('accepted', lijst), false, 'geaccepteerd = nog te verwerken');
  assert.equal(isAfgerond('in progress', lijst), false);
  assert.equal(isAfgerond('approved', lijst), true);
});
