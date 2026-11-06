import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginaUitlijnVerschuivingen, paginaUitlijnenInPaginaruimte } from './uitlijnen-pagina.js';
import { rectNaarWeergave } from '../pdf/weergave-rotatie.js';

const A4 = { x: 0, y: 0, width: 595, height: 842 };

function verschuif(b, d) { return { ...b, x: b.x + (d.dx ?? d.x), y: b.y + (d.dy ?? d.y) }; }

test('een tekstvak horizontaal centreren op de pagina', () => {
  const vak = { x: 40, y: 100, width: 200, height: 50 };
  const [d] = paginaUitlijnVerschuivingen([vak], A4, 'center');
  const na = verschuif(vak, d);
  assert.equal(na.x + na.width / 2, 595 / 2);
  assert.equal(na.y, 100);
});

test('drie markeringen als groep links: onderlinge afstand blijft', () => {
  const kaders = [
    { x: 100, y: 10, width: 20, height: 20 },
    { x: 150, y: 50, width: 30, height: 10 },
    { x: 220, y: 90, width: 10, height: 40 },
  ];
  const ds = paginaUitlijnVerschuivingen(kaders, A4, 'left');
  const na = kaders.map((b, i) => verschuif(b, ds[i]));
  assert.equal(Math.min(...na.map(b => b.x)), 0);
  assert.equal(na[1].x - na[0].x, 50);
  assert.equal(na[2].x - na[1].x, 70);
  assert.deepEqual(na.map(b => b.y), [10, 50, 90]);
});

test('per stuk: elke markering apart tegen de rand', () => {
  const kaders = [
    { x: 100, y: 10, width: 20, height: 20 },
    { x: 150, y: 50, width: 30, height: 10 },
  ];
  const ds = paginaUitlijnVerschuivingen(kaders, A4, 'right', { perStuk: true });
  const na = kaders.map((b, i) => verschuif(b, ds[i]));
  assert.deepEqual(na.map(b => b.x + b.width), [595, 595]);
});

test('alle zes kanten', () => {
  const b = { x: 10, y: 20, width: 100, height: 40 };
  const kant = (k) => verschuif(b, paginaUitlijnVerschuivingen([b], A4, k)[0]);
  assert.equal(kant('left').x, 0);
  assert.equal(kant('right').x + 100, 595);
  assert.equal(kant('top').y, 0);
  assert.equal(kant('bottom').y + 40, 842);
  assert.equal(kant('middle').y + 20, 421);
  assert.equal(kant('center').x + 50, 297.5);
});

test('markering die buiten de pagina uitsteekt wordt binnen de rand gelegd', () => {
  const b = { x: -30, y: 800, width: 100, height: 100 };
  assert.equal(verschuif(b, paginaUitlijnVerschuivingen([b], A4, 'left')[0]).x, 0);
  assert.equal(verschuif(b, paginaUitlijnVerschuivingen([b], A4, 'bottom')[0]).y, 742);
});

test('ongeldige kaders en onbekende kant schuiven niet', () => {
  assert.deepEqual(paginaUitlijnVerschuivingen([null], A4, 'left'), [{ dx: 0, dy: 0 }]);
  assert.deepEqual(paginaUitlijnVerschuivingen([{ x: 1, y: 1, width: 1, height: 1 }], A4, 'diagonal'), [{ dx: 0, dy: 0 }]);
  const ds = paginaUitlijnVerschuivingen([null, { x: 50, y: 0, width: 10, height: 10 }], A4, 'left');
  assert.deepEqual(ds, [{ dx: 0, dy: 0 }, { dx: -50, dy: 0 }]);
});

test('zonder weergaverotatie: paginaruimte = weergave', () => {
  const maat = { breedte: 595, hoogte: 842 };
  const b = { x: 40, y: 100, width: 200, height: 50 };
  const [d] = paginaUitlijnenInPaginaruimte([b], maat, 0, 'left');
  assert.deepEqual(d, { x: -40, y: 0 });
});

for (const rot of [90, 180, 270]) {
  test(`gedraaide weergave ${rot}: uitgelijnd op de zichtbare pagina`, () => {
    const maat = { breedte: 595, hoogte: 842 };
    const kaders = [
      { x: 100, y: 200, width: 50, height: 30 },
      { x: 300, y: 400, width: 20, height: 60 },
    ];
    for (const kant of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
      const ds = paginaUitlijnenInPaginaruimte(kaders, maat, rot, kant);
      const na = kaders.map((b, i) => verschuif(b, ds[i]));
      // Terug naar het scherm: de groep ligt tegen de zichtbare rand.
      const zicht = na.map(b => rectNaarWeergave(b, maat.breedte, maat.hoogte, rot));
      const zichtB = rot === 180 ? 595 : 842;
      const zichtH = rot === 180 ? 842 : 595;
      const x1 = Math.min(...zicht.map(b => b.x)), x2 = Math.max(...zicht.map(b => b.x + b.width));
      const y1 = Math.min(...zicht.map(b => b.y)), y2 = Math.max(...zicht.map(b => b.y + b.height));
      const voor = kaders.map(b => rectNaarWeergave(b, maat.breedte, maat.hoogte, rot));
      if (kant === 'left') assert.equal(x1, 0);
      if (kant === 'right') assert.equal(x2, zichtB);
      if (kant === 'center') assert.equal((x1 + x2) / 2, zichtB / 2);
      if (kant === 'top') assert.equal(y1, 0);
      if (kant === 'bottom') assert.equal(y2, zichtH);
      if (kant === 'middle') assert.equal((y1 + y2) / 2, zichtH / 2);
      // Horizontaal uitlijnen verandert op het scherm alleen x, verticaal alleen y.
      const horizontaal = ['left', 'center', 'right'].includes(kant);
      for (let i = 0; i < zicht.length; i++) {
        if (horizontaal) assert.equal(zicht[i].y, voor[i].y);
        else assert.equal(zicht[i].x, voor[i].x);
      }
    }
  });
}

test('kwartgedraaide pagina (/Rotate 90): maat is al gewisseld, liggend blad', () => {
  // paginaMaat levert voor een staande A4 met /Rotate 90 een liggende maat.
  const maat = { breedte: 842, hoogte: 595 };
  const b = { x: 10, y: 10, width: 100, height: 100 };
  const [d] = paginaUitlijnenInPaginaruimte([b], maat, 0, 'right');
  assert.equal(b.x + d.x + b.width, 842);
});
