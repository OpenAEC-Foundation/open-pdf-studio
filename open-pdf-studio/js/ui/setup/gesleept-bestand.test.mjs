// Slepen en neerzetten in de webversie (#456).
//
// De oude terugval las `file.path`. Dat veld bestaat in een browser niet, dus
// een gesleepte PDF verdween zonder melding. Deze test legt vast dat de bytes
// gelezen worden en dat het bestand onder zijn NAAM opengaat — dezelfde
// in-geheugenroute als de bestandskiezer.

import assert from 'node:assert/strict';
import test from 'node:test';

const { bestandsExtensie, soortVanBestand, openGesleepteBestanden } =
  await import('./gesleept-bestand.js');

/** Een File zoals de browser hem geeft: een naam en bytes, GEEN `path`. */
function nepBestand(naam, bytes = [37, 80, 68, 70]) {
  return {
    name: naam,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

function haken() {
  const geopend = { pdf: [], afbeelding: [], melding: [] };
  return {
    geopend,
    openPdf: async (naam, bytes) => { geopend.pdf.push([naam, Array.from(bytes)]); },
    openAfbeelding: async (b) => { geopend.afbeelding.push(b.name); },
    geenWebvariant: (f) => { geopend.melding.push(f); },
  };
}

test('extensie en soort', () => {
  assert.equal(bestandsExtensie('C:/map/Blad.PDF'), '.pdf');
  assert.equal(bestandsExtensie('zonderpunt'), '');
  assert.equal(soortVanBestand('Blad.pdf'), 'pdf');
  assert.equal(soortVanBestand('foto.JPEG'), 'afbeelding');
  assert.equal(soortVanBestand('tekening.dwg'), 'tekening');
  assert.equal(soortVanBestand('notities.txt'), 'onbekend');
});

test('een gesleepte PDF gaat open op zijn naam, met zijn bytes', async () => {
  const h = haken();
  const uit = await openGesleepteBestanden([nepBestand('Blad.pdf', [1, 2, 3])], h);
  assert.deepEqual(h.geopend.pdf, [['Blad.pdf', [1, 2, 3]]]);
  assert.deepEqual(uit, [{ naam: 'Blad.pdf', soort: 'pdf', gelukt: true }]);
});

test('geen enkel pad nodig: het File-object heeft er ook geen', async () => {
  const bestand = nepBestand('Blad.pdf');
  assert.equal('path' in bestand, false);
  const h = haken();
  await openGesleepteBestanden([bestand], h);
  assert.equal(h.geopend.pdf.length, 1);
});

test('meerdere bestanden in één drop, elk op zijn eigen manier', async () => {
  const h = haken();
  const uit = await openGesleepteBestanden(
    [nepBestand('a.pdf'), nepBestand('b.png'), nepBestand('c.dwg'), nepBestand('d.txt')], h);
  assert.deepEqual(h.geopend.pdf.map(([n]) => n), ['a.pdf']);
  assert.deepEqual(h.geopend.afbeelding, ['b.png']);
  assert.deepEqual(h.geopend.melding, ['cadImport'], 'CAD zegt dat het hier niet kan');
  assert.deepEqual(uit.map((r) => r.gelukt), [true, true, false, false]);
});

test('een bestand dat niet te lezen is houdt de rest niet tegen', async () => {
  const h = haken();
  const stuk = { name: 'stuk.pdf', arrayBuffer: async () => { throw new Error('leesfout'); } };
  const uit = await openGesleepteBestanden([stuk, nepBestand('goed.pdf')], h);
  assert.deepEqual(uit.map((r) => r.gelukt), [false, true]);
  assert.deepEqual(h.geopend.pdf.map(([n]) => n), ['goed.pdf']);
});

test('niets gesleept is geen fout', async () => {
  const h = haken();
  assert.deepEqual(await openGesleepteBestanden(null, h), []);
  assert.deepEqual(await openGesleepteBestanden([], h), []);
});
