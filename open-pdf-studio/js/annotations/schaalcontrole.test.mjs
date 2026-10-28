// Schaalcontrole (#629): de afwijking van een tweede bekende maat, de
// drempels, welke schaalbron de punten hebben, anisotropie van een scan, het
// herkalibreren en de geschiedenis per blad.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STANDAARD_DREMPELS, MAX_CONTROLES_PER_BLAD, normaliseerDrempels, berekenAfwijking, classificeer,
  richtingVan, bronVoorPunten, kanHerkalibreren, herkalibreer, noemerVoorPpu, schaalTekstVoorPpu,
  anisotropie, maakControle, isControle, voegControleToe, laatsteControle,
  schrijfControlesJson, leesControlesJson, herschikControles,
} from './schaalcontrole.js';
import { schaalBronOpPunt, schaalOpPunt } from './schaal-op-punt.js';
import { pixelsPerUnitFor } from './scale-region-scale.js';

const PPU = (n, u = 'mm') => pixelsPerUnitFor(`1:${n}`, u);
const dicht = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('afwijking: gemeten lengte, verschil in eenheden en in procenten', () => {
  // 1:100 in mm: 3600 mm is 36 mm op papier = 102,05 pt.
  const ppu = PPU(100);
  const punten = 3600 * ppu;
  const juist = berekenAfwijking({ punten, bekend: 3600, pixelsPerUnit: ppu });
  dicht(juist.gemeten, 3600, 1e-6);
  dicht(juist.procent, 0, 1e-9);
  dicht(juist.factor, 1, 1e-12);
  // De werkelijke maat is 3580: de schaal meet 20 mm (0,559 %) te lang.
  const te = berekenAfwijking({ punten, bekend: 3580, pixelsPerUnit: ppu });
  dicht(te.verschil, 20, 1e-6);
  dicht(te.procent, (20 / 3580) * 100, 1e-9);
  dicht(te.factor, 3580 / 3600, 1e-12);
  assert.equal(berekenAfwijking({ punten: 0, bekend: 1, pixelsPerUnit: 1 }), null);
  assert.equal(berekenAfwijking({ punten: 10, bekend: -1, pixelsPerUnit: 1 }), null);
  assert.equal(berekenAfwijking({ punten: 10, bekend: 1, pixelsPerUnit: NaN }), null);
});

test('drempels: goed, waarschuwing, fout (in beide richtingen)', () => {
  assert.deepEqual(STANDAARD_DREMPELS, { ok: 0.5, waarschuwing: 2 });
  assert.equal(classificeer(0), 'ok');
  assert.equal(classificeer(0.5), 'ok');
  assert.equal(classificeer(-0.5), 'ok');
  assert.equal(classificeer(0.51), 'warn');
  assert.equal(classificeer(-2), 'warn');
  assert.equal(classificeer(2.01), 'fail');
  assert.equal(classificeer(NaN), 'fail');
  assert.equal(classificeer(0.8, { ok: 1, waarschuwing: 3 }), 'ok');
  // Ongeldige drempels vallen terug; een waarschuwing onder "goed" schuift op.
  assert.deepEqual(normaliseerDrempels({ ok: -1, waarschuwing: 'x' }), STANDAARD_DREMPELS);
  assert.deepEqual(normaliseerDrempels({ ok: 3, waarschuwing: 1 }), { ok: 3, waarschuwing: 3 });
});

test('richting: horizontaal, verticaal of schuin', () => {
  assert.equal(richtingVan({ x: 0, y: 0 }, { x: 100, y: 5 }).as, 'x');
  assert.equal(richtingVan({ x: 0, y: 0 }, { x: -3, y: -100 }).as, 'y');
  assert.equal(richtingVan({ x: 0, y: 0 }, { x: 100, y: 100 }).as, 'schuin');
});

function tekening() {
  return {
    annotations: [
      // Een groot gebied 1:100 met daarin een detail 1:20.
      { id: 'groot', type: 'scaleRegion', page: 1, x: 0, y: 0, width: 500, height: 400, scaleString: '1:100', units: 'mm', label: 'Plattegrond' },
      { id: 'detail', type: 'scaleRegion', page: 1, x: 300, y: 50, width: 150, height: 100, scaleString: '1:20', units: 'mm', label: 'Detail A' },
      { id: 'vp', type: 'viewport', page: 2, x: 0, y: 0, width: 200, height: 200, pixelsPerUnit: PPU(50), unit: 'mm' },
    ],
    pdfViewports: { 3: [{ x: 0, y: 0, width: 300, height: 300, pixelsPerUnit: PPU(200), unit: 'mm', name: 'CAD', ratio: '1:200' }] },
    measureScale: { pixelsPerUnit: PPU(10), unit: 'mm', method: 'ratio', scaleRatio: '1:10' },
  };
}

test('schaalbron per punt: volgorde gelijk aan schaalOpPunt, met de bron erbij', () => {
  const doc = tekening();
  const regio = schaalBronOpPunt(doc, 1, 350, 80, pixelsPerUnitFor);
  assert.equal(regio.method, 'scaleRegion');
  assert.equal(regio.sleutel, 'scaleRegion:detail', 'het binnenste gebied wint');
  dicht(regio.pixelsPerUnit, PPU(20));
  assert.equal(schaalBronOpPunt(doc, 1, 50, 50, pixelsPerUnitFor).sleutel, 'scaleRegion:groot');
  assert.equal(schaalBronOpPunt(doc, 2, 50, 50, pixelsPerUnitFor).sleutel, 'viewport:vp');
  assert.equal(schaalBronOpPunt(doc, 3, 50, 50, pixelsPerUnitFor).sleutel, 'pdfViewport:3:0');
  assert.equal(schaalBronOpPunt(doc, 4, 50, 50, pixelsPerUnitFor).sleutel, 'document');
  assert.equal(schaalBronOpPunt({ annotations: [] }, 1, 1, 1, pixelsPerUnitFor), null);
  // Zonder schaalgebied geeft het dezelfde schaal als schaalOpPunt.
  for (const [p, x, y] of [[2, 50, 50], [3, 50, 50], [4, 1, 1], [2, 250, 250]]) {
    const a = schaalBronOpPunt(doc, p, x, y, pixelsPerUnitFor);
    const b = schaalOpPunt(doc, p, x, y);
    assert.equal(a.pixelsPerUnit, b.pixelsPerUnit);
    assert.equal(a.unit, b.unit);
    assert.equal(a.method, b.method);
  }
});

test('punten in hetzelfde gebied of over een grens heen', () => {
  const doc = tekening();
  const binnen = bronVoorPunten(doc, 1, { x: 310, y: 60 }, { x: 440, y: 60 });
  assert.equal(binnen.gelijk, true);
  assert.equal(binnen.bron.sleutel, 'scaleRegion:detail');
  const over = bronVoorPunten(doc, 1, { x: 100, y: 60 }, { x: 400, y: 60 });
  assert.equal(over.gelijk, false, 'van het grote gebied het detail in');
  assert.equal(over.begin.sleutel, 'scaleRegion:groot');
  assert.equal(over.eind.sleutel, 'scaleRegion:detail');
  assert.equal(over.bron.sleutel, 'scaleRegion:groot', 'de bron op het midden telt');
  const leeg = bronVoorPunten({ annotations: [] }, 1, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.equal(leeg.bron, null);
  assert.equal(leeg.gelijk, true);
});

test('herkalibreren: vervangen of het gemiddelde, en welke bronnen het mogen', () => {
  const ppu = PPU(100);
  const punten = 3600 * ppu;
  // De controlemeting zegt 3580: vervangen maakt die maat exact.
  const vervang = herkalibreer(ppu, punten, 3580, 'vervang');
  dicht(punten / vervang, 3580, 1e-9);
  const gemiddeld = herkalibreer(ppu, punten, 3580, 'gemiddeld');
  dicht(gemiddeld, (ppu + vervang) / 2, 1e-15);
  assert.ok(punten / gemiddeld > 3580 && punten / gemiddeld < 3600);
  // Zonder huidige schaal is het gemiddelde gewoon de meting.
  dicht(herkalibreer(null, punten, 3580, 'gemiddeld'), vervang, 1e-15);
  assert.equal(herkalibreer(ppu, 0, 3580, 'vervang'), null);
  assert.equal(kanHerkalibreren({ method: 'scaleRegion' }), true);
  assert.equal(kanHerkalibreren({ method: 'viewport' }), true);
  assert.equal(kanHerkalibreren({ method: 'document' }), true);
  assert.equal(kanHerkalibreren(null), true, 'zonder schaal zet de meting de schaal');
  assert.equal(kanHerkalibreren({ method: 'scaleBar' }), false);
  assert.equal(kanHerkalibreren({ method: 'pdfViewport' }), false);
});

test('de nieuwe schaal als 1:N, terug te lezen door het schaalgebied', () => {
  dicht(noemerVoorPpu(PPU(100), 'mm'), 100, 1e-9);
  dicht(noemerVoorPpu(PPU(50, 'm'), 'm'), 50, 1e-9);
  assert.equal(schaalTekstVoorPpu(PPU(100), 'mm'), '1:100');
  const ppu = PPU(100) * (3600 / 3580);
  const tekst = schaalTekstVoorPpu(ppu, 'mm');
  assert.equal(tekst, '1:99.4444');
  dicht(pixelsPerUnitFor(tekst, 'mm'), ppu, ppu * 1e-6);
  assert.equal(schaalTekstVoorPpu(0, 'mm'), null);
});

function controle(as, bekend, gemetenPunten, ppu, sleutel = 'scaleRegion:groot') {
  const p2 = as === 'x' ? { x: 100, y: 0 } : { x: 0, y: 100 };
  return maakControle({
    datum: '2026-10-28T10:00:00.000Z', auteur: 'Tester',
    bron: { method: 'scaleRegion', sleutel, label: 'Plattegrond' },
    p1: { x: 0, y: 0 }, p2, punten: gemetenPunten, bekend, eenheid: 'mm', pixelsPerUnit: ppu,
  });
}

test('anisotropie: horizontale en verticale controle van dezelfde bron', () => {
  const ppu = PPU(100);
  // Horizontaal klopt, verticaal is de scan 2 % uitgerekt.
  const x = controle('x', 3600, 3600 * ppu, ppu);
  const y = controle('y', 3600, 3600 * 1.02 * ppu, ppu);
  const a = anisotropie([x, y], 'scaleRegion:groot');
  dicht(a.factorX, 1, 1e-6);
  dicht(a.factorY, 1 / 1.02, 1e-6);
  dicht(a.procent, ((1 - 1 / 1.02) / ((1 + 1 / 1.02) / 2)) * 100, 1e-3);
  assert.ok(a.procent > 1.9 && a.procent < 2.1);
  // Alleen één richting, of een andere bron: niets te melden.
  assert.equal(anisotropie([x], 'scaleRegion:groot'), null);
  assert.equal(anisotropie([x, y], 'scaleRegion:detail'), null);
  // Een schuine meting telt niet mee; de nieuwste per richting wel.
  const schuin = maakControle({
    bron: { method: 'scaleRegion', sleutel: 'scaleRegion:groot' }, p1: { x: 0, y: 0 }, p2: { x: 100, y: 100 },
    punten: 100, bekend: 1000, eenheid: 'mm', pixelsPerUnit: ppu,
  });
  const yNieuw = controle('y', 3600, 3600 * ppu, ppu);
  dicht(anisotropie([x, y, schuin, yNieuw], 'scaleRegion:groot').procent, 0, 1e-6);
});

test('een controleregel: afgerond, met status, drempels en richting', () => {
  const ppu = PPU(100);
  const c = controle('x', 3580, 3600 * ppu, ppu);
  assert.equal(c.status, 'warn');
  assert.equal(c.as, 'x');
  assert.equal(c.schaal, '1:100');
  assert.equal(c.bron.sleutel, 'scaleRegion:groot');
  assert.equal(c.actie, 'none');
  assert.deepEqual(c.drempels, STANDAARD_DREMPELS);
  dicht(c.procent, (20 / 3580) * 100, 1e-4);
  assert.ok(isControle(c));
  assert.equal(maakControle({ p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, punten: 0, bekend: 1, pixelsPerUnit: 1 }), null);
});

test('geschiedenis per blad: nieuwste achteraan, begrensd, origineel ongemoeid', () => {
  const ppu = PPU(100);
  const eerste = controle('x', 3600, 3600 * ppu, ppu);
  let g = voegControleToe(undefined, 2, eerste);
  assert.deepEqual(Object.keys(g), ['2']);
  const voor = g;
  g = voegControleToe(g, 2, controle('y', 3600, 3600 * ppu, ppu));
  assert.equal(voor[2].length, 1, 'het origineel is niet aangepast');
  assert.equal(g[2].length, 2);
  assert.equal(laatsteControle(g, 2).as, 'y');
  assert.equal(laatsteControle(g, 1), null);
  for (let i = 0; i < MAX_CONTROLES_PER_BLAD + 5; i++) g = voegControleToe(g, 2, eerste);
  assert.equal(g[2].length, MAX_CONTROLES_PER_BLAD);
});

test('geschiedenis als JSON: heen en terug, kapotte regels vallen weg', () => {
  const ppu = PPU(100);
  const lijst = [controle('x', 3600, 3600 * ppu, ppu), controle('y', 3580, 3600 * ppu, ppu)];
  const terug = leesControlesJson(schrijfControlesJson(lijst));
  assert.deepEqual(terug, lijst);
  assert.deepEqual(leesControlesJson('geen json'), []);
  assert.deepEqual(leesControlesJson(JSON.stringify({ checks: [{ datum: 'x' }, lijst[0]] })), [lijst[0]]);
  assert.deepEqual(leesControlesJson(JSON.stringify({ version: 1 })), []);
});

test('geschiedenis na het verplaatsen of verwijderen van pagina\'s', () => {
  const g = { 1: ['a'], 2: ['b'], 3: ['c'] };
  assert.deepEqual(herschikControles(g, { 1: 2, 2: null, 3: 1 }), { 1: ['c'], 2: ['a'] });
  assert.equal(herschikControles(null, { 1: 1 }), null);
});
