// Een tekststempel van de app komt bij heropenen terug als tekststempel.
//
// Zo'n stempel heeft een appearance met alleen vectortekst, geen beeld. De
// loader viel dan terug op een uitsnede van de gerenderde pagina: met de
// achtergrond en overlappende annotaties erin, en sinds de doorzichtigheid in
// de appearance staat (#512) ook met die alfa, waarna de app hem nog eens
// doorzichtig tekende. Een symboolstempel zonder tekst blijft wel een beeld.

import assert from 'node:assert/strict';
import test from 'node:test';

import { eigenTekststempel } from './stempel-tekst.js';

test('een tekststempel met opgeslagen tekst komt terug als die tekst, zonder uitsnede', () => {
  assert.deepEqual(eigenTekststempel({ stampName: 'Custom', opsStampText: 'AKKOORD', beeldBron: 'render' }),
    { stampText: 'AKKOORD' });
});

test('een ingebouwde stempel uit een ouder bestand krijgt de tekst van de catalogus', () => {
  assert.deepEqual(eigenTekststempel({ stampName: 'Approved', beeldBron: 'render' }), { stampText: 'APPROVED' });
  assert.deepEqual(eigenTekststempel({ stampName: 'For Review', beeldBron: 'render' }), { stampText: 'FOR REVIEW' });
});

test('een symboolstempel zonder tekst blijft een beeld', () => {
  assert.equal(eigenTekststempel({ stampName: 'nen1414-brandblusser', beeldBron: 'render' }), null);
});

test('een stempel met een echt ingebed beeld blijft dat beeld', () => {
  assert.equal(eigenTekststempel({ stampName: 'Approved', opsStampText: 'APPROVED', beeldBron: 'pdf' }), null);
});

test('zonder eigen stempelnaam (stempel uit een ander programma) verandert er niets', () => {
  assert.equal(eigenTekststempel({ stampName: undefined, beeldBron: 'render' }), null);
});

test('zonder beeld is een tekststempel ook een tekststempel', () => {
  assert.deepEqual(eigenTekststempel({ stampName: 'Draft', beeldBron: null }), { stampText: 'DRAFT' });
});

test('een teruggezette tekststempel houdt zijn kleur uit /C, anders die van de catalogus', async () => {
  const { tekststempelKleur } = await import('./stempel-tekst.js');
  assert.equal(tekststempelKleur({ cKleur: '#22c55e', stampName: 'Approved' }), '#22c55e');
  assert.equal(tekststempelKleur({ cKleur: null, stampName: 'Draft' }), '#3b82f6');
  assert.equal(tekststempelKleur({ cKleur: null, stampName: 'Custom' }), '#ef4444');
});
