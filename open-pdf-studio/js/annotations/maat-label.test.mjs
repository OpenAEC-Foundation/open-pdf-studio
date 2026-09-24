import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maatlijnTekst, kopUitsteek, maatTekstMarge, maatTekstStrook, leesbareHoek, maatLabelRuimte,
} from './maat-label.js';

test('zonder eenheid blijft alleen het getal over', () => {
  assert.equal(maatlijnTekst('1550 mm', false), '1550');
  assert.equal(maatlijnTekst('4.36 m', false), '4.36');
  assert.equal(maatlijnTekst('12.50 ft', false), '12.50');
  assert.equal(maatlijnTekst('436mm', false), '436');
  assert.equal(maatlijnTekst('1550', false), '1550', 'al zonder eenheid: ongewijzigd');
  assert.equal(maatlijnTekst('3x 1200 mm', false), '3x 1200', 'alleen de eenheid achteraan');
  assert.equal(maatlijnTekst('vrij', false), 'vrij', 'tekst zonder getal blijft staan');
  assert.equal(maatlijnTekst('', false), '');
  assert.equal(maatlijnTekst(undefined, false), '');
});

test('met eenheid (de standaard) verandert er niets', () => {
  assert.equal(maatlijnTekst('1550 mm', true), '1550 mm');
  assert.equal(maatlijnTekst('1550 mm'), '1550 mm');
  assert.equal(maatlijnTekst('4.36 m', undefined), '4.36 m');
});

test('hoe ver een eindmarkering dwars op de maatlijn uitsteekt', () => {
  assert.equal(kopUitsteek('openCircle', 12), 4, 'het open rondje heeft een vaste straal');
  assert.equal(kopUitsteek('openCircle', 8), 4);
  assert.equal(kopUitsteek('none', 12), 0);
  assert.equal(kopUitsteek('slash', 8), 4 * Math.cos(Math.PI / 6));
  assert.equal(kopUitsteek('butt', 10), 5);
  assert.equal(kopUitsteek('closed', 12), 12 * Math.tan(Math.PI / 6));
  assert.equal(kopUitsteek('circle', 9), 3);
  assert.equal(kopUitsteek(undefined, 12), 4, 'zonder stijl: het standaard open rondje');
});

test('de tekst staat vrij boven de markeringen', () => {
  // 11 pt tekst met open rondjes: de onderkant van de tekst ligt boven de
  // rondjes (straal 4), met lucht ertussen.
  const marge = maatTekstMarge({ fontSize: 11, startHead: 'openCircle', endHead: 'openCircle', headSize: 12 });
  assert.ok(marge >= 4 + 1, `marge ${marge} ligt boven het rondje`);
  // Kleine tekst (maattype 2,5 mm = 7 pt) ook.
  const klein = maatTekstMarge({ fontSize: 7, startHead: 'openCircle', endHead: 'openCircle', headSize: 8 });
  assert.ok(klein >= 5, `marge ${klein}`);
  // Zonder markeringen blijft de oude regel: max(3, 0,35 x tekst).
  assert.equal(maatTekstMarge({ fontSize: 11, startHead: 'none', endHead: 'none' }), 11 * 0.35);
  assert.equal(maatTekstMarge({ fontSize: 6, startHead: 'none', endHead: 'none' }), 3);
  // De grootste van de twee koppen telt.
  assert.equal(
    maatTekstMarge({ fontSize: 7, startHead: 'none', endHead: 'closed', headSize: 12 }),
    maatTekstMarge({ fontSize: 7, startHead: 'closed', endHead: 'closed', headSize: 12 }),
  );
});

test('een tekstregel boven een maatlijn heeft een vaste strook nodig', () => {
  const opties = { fontSize: 7, startHead: 'openCircle', endHead: 'openCircle', headSize: 8 };
  const strook = maatTekstStrook(opties);
  // marge + teksthoogte + ruimte voor de markering van de volgende lijn.
  assert.ok(strook >= maatTekstMarge(opties) + 7 + 4, `strook ${strook}`);
  assert.ok(maatTekstStrook({ ...opties, fontSize: 11 }) > strook, 'grotere tekst, bredere strook');
});

test('maattekst leest van onder of van rechts, nooit op zijn kop', () => {
  const bijna = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≈ ${b}`);
  bijna(leesbareHoek(0), 0);
  bijna(leesbareHoek(0.3), 0.3);
  bijna(leesbareHoek(Math.PI), 0);
  bijna(leesbareHoek(-Math.PI), 0);
  bijna(leesbareHoek(3 * Math.PI / 4), -Math.PI / 4);
  // Een staande maat leest van rechts (van onder naar boven), welke kant hij
  // ook op getekend is.
  bijna(leesbareHoek(Math.PI / 2), -Math.PI / 2);
  bijna(leesbareHoek(-Math.PI / 2), -Math.PI / 2);
});

test('de opgeslagen appearance is ruim genoeg voor de tekst boven de lijn', () => {
  const opties = { fontSize: 7, startHead: 'openCircle', endHead: 'openCircle', headSize: 8 };
  assert.equal(maatLabelRuimte({ ...opties, tekst: '' }), 5, 'zonder tekst de oude rand');
  const r = maatLabelRuimte({ ...opties, tekst: '1550' });
  assert.ok(r >= maatTekstMarge(opties) + 7, `${r} pt reikt tot boven de tekst`);
  // Een lange tekst op een korte maat steekt aan de zijkanten uit.
  assert.ok(maatLabelRuimte({ ...opties, tekst: '12345678901234567890' }) >= 20 * 7 * 0.55 / 2);
});
