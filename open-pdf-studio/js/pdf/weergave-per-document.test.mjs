// Weergavestand per document (#539). De enkelpagina-viewport is één gedeelde
// singleton: bij elke tabwissel maakte hij het nieuwe document opnieuw
// passend, dus zoom en verschuiving van het vorige document waren weg. Wie met
// Ctrl+Tab twee tekeningen op elkaar legt om verschillen te zien, heeft juist
// nodig dat elk document precies zo terugkomt als hij het verliet.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maakWeergaveStand,
  standPastBij,
  herstelWaarden,
  maakStandGeheugen,
  wisselWeergave,
} from './weergave-per-document.js';

const viewportVan = (filePath, extra = {}) => ({
  filePath,
  pageNum: 3,
  rotation: 0,
  viewRotation: 0,
  pageW: 842,
  pageH: 595,
  zoom: 2.5,
  offsetX: -400,
  offsetY: -120,
  pageType: 'raster',
  fitMode: 'page',
  ...extra,
});

const canvas = { cssW: 1200, cssH: 800 };

test('de stand bewaart wat nodig is om het beeld exact terug te zetten', () => {
  const stand = maakWeergaveStand(viewportVan('a.pdf'), { verankerd: true, strikt: true, ...canvas });
  assert.deepEqual(stand, {
    filePath: 'a.pdf', pageNum: 3, rotation: 0, viewRotation: 0, pageW: 842, pageH: 595,
    fitMode: 'page', zoom: 2.5, offsetX: -400, offsetY: -120, pageType: 'raster',
    verankerd: true, strikt: true, cssW: 1200, cssH: 800,
  });
});

test('zonder bruikbare viewport valt er niets te bewaren', () => {
  assert.equal(maakWeergaveStand(viewportVan(null), canvas), null, 'geen bestand');
  assert.equal(maakWeergaveStand(viewportVan('a.pdf', { zoom: 0 }), canvas), null, 'geen zoom');
  assert.equal(maakWeergaveStand(viewportVan('a.pdf', { zoom: NaN }), canvas), null);
  assert.equal(maakWeergaveStand(viewportVan('a.pdf', { pageW: 0 }), canvas), null, 'geen pagina');
  assert.equal(maakWeergaveStand(viewportVan('a.pdf'), { cssW: 0, cssH: 800 }), null, 'geen canvas');
  assert.equal(maakWeergaveStand(null, canvas), null);
});

test('een stand past alleen bij hetzelfde bestand, dezelfde pagina en dezelfde stand', () => {
  const stand = maakWeergaveStand(viewportVan('a.pdf'), canvas);
  const zelfde = { filePath: 'a.pdf', pageNum: 3, rotation: 0, viewRotation: 0, pageW: 842, pageH: 595 };
  assert.equal(standPastBij(stand, zelfde), true);
  assert.equal(standPastBij(stand, { ...zelfde, rotation: 360 }), true, 'rotatie genormaliseerd');
  assert.equal(standPastBij(stand, { ...zelfde, filePath: 'b.pdf' }), false);
  assert.equal(standPastBij(stand, { ...zelfde, pageNum: 4 }), false);
  assert.equal(standPastBij(stand, { ...zelfde, rotation: 90 }), false);
  assert.equal(standPastBij(stand, { ...zelfde, viewRotation: 270 }), false);
  assert.equal(standPastBij(stand, { ...zelfde, pageW: 595, pageH: 842 }), false, 'andere paginamaat');
  assert.equal(standPastBij(null, zelfde), false);
  const gedraaid = maakWeergaveStand(viewportVan('a.pdf', { rotation: 270, viewRotation: 90 }), canvas);
  assert.equal(standPastBij(gedraaid, { ...zelfde, rotation: -90, viewRotation: 450 }), true);
});

test('bij een gelijk canvas komen zoom en verschuiving exact terug', () => {
  const stand = maakWeergaveStand(viewportVan('a.pdf'), { verankerd: true, strikt: false, ...canvas });
  assert.deepEqual(herstelWaarden(stand, canvas), {
    fitMode: 'page', zoom: 2.5, offsetX: -400, offsetY: -120, verankerd: true, strikt: false, opnieuwPassend: false,
  });
  // Ook een passend gemaakt beeld (niet verankerd) komt exact terug, zodat
  // "breedte passend" niet in "pagina passend" verandert.
  const passend = maakWeergaveStand(viewportVan('a.pdf', { zoom: 1.4, offsetX: 0, offsetY: 12 }), canvas);
  assert.deepEqual(herstelWaarden(passend, canvas), {
    fitMode: 'page', zoom: 1.4, offsetX: 0, offsetY: 12, verankerd: false, strikt: false, opnieuwPassend: false,
  });
});

test('is het canvas intussen van maat veranderd, dan blijft het midden van het beeld staan', () => {
  const stand = maakWeergaveStand(viewportVan('a.pdf'), { verankerd: true, ...canvas });
  const w = herstelWaarden(stand, { cssW: 1000, cssH: 700 });
  assert.equal(w.opnieuwPassend, false);
  assert.equal(w.zoom, 2.5);
  // Wereldpunt in het midden: ((600 + 400) / 2.5, (400 + 120) / 2.5) = (400, 208).
  assert.equal(w.offsetX, 500 - 400 * 2.5);
  assert.equal(w.offsetY, 350 - 208 * 2.5);
  // Een passend beeld wordt bij een andere maat opnieuw passend gemaakt,
  // net als bij een gewone venstermaatwijziging.
  const passend = maakWeergaveStand(viewportVan('a.pdf'), { verankerd: false, ...canvas });
  assert.deepEqual(herstelWaarden(passend, { cssW: 1000, cssH: 700 }), { opnieuwPassend: true, fitMode: 'page' });
});

test('het geheugen geeft een stand één keer terug, per bestand', () => {
  const geheugen = maakStandGeheugen();
  const a = maakWeergaveStand(viewportVan('a.pdf'), canvas);
  const b = maakWeergaveStand(viewportVan('b.pdf', { zoom: 0.5 }), canvas);
  geheugen.bewaar(a);
  geheugen.bewaar(b);
  geheugen.bewaar(null);
  assert.deepEqual(geheugen.neem('a.pdf'), a);
  assert.equal(geheugen.neem('a.pdf'), null, 'opgenomen stand is weg');
  geheugen.vergeet('b.pdf');
  assert.equal(geheugen.neem('b.pdf'), null, 'vergeten bij sluiten');
  assert.equal(geheugen.neem(null), null);
});

test('tabwissel A → B → A: A komt terug zoals hij werd verlaten, B is nieuw en past', () => {
  const geheugen = maakStandGeheugen();
  const vertrekA = maakWeergaveStand(viewportVan('a.pdf'), { verankerd: true, ...canvas });
  const aankomstB = { filePath: 'b.pdf', pageNum: 1, rotation: 0, viewRotation: 0, pageW: 595, pageH: 842 };
  assert.equal(
    wisselWeergave(geheugen, { vertrek: vertrekA, openPaden: ['a.pdf', 'b.pdf'], aankomst: aankomstB, canvas }),
    null,
    'B is nooit eerder getoond: opnieuw passend maken',
  );
  const vertrekB = maakWeergaveStand(viewportVan('b.pdf', { pageNum: 1, pageW: 595, pageH: 842, zoom: 0.8 }), canvas);
  const aankomstA = { filePath: 'a.pdf', pageNum: 3, rotation: 0, viewRotation: 0, pageW: 842, pageH: 595 };
  assert.deepEqual(
    wisselWeergave(geheugen, { vertrek: vertrekB, openPaden: ['a.pdf', 'b.pdf'], aankomst: aankomstA, canvas }),
    { fitMode: 'page', zoom: 2.5, offsetX: -400, offsetY: -120, verankerd: true, strikt: false, opnieuwPassend: false },
  );
  // En B weer terug: ook B houdt zijn eigen zoom.
  const terugNaarB = wisselWeergave(geheugen, {
    vertrek: maakWeergaveStand(viewportVan('a.pdf'), canvas),
    openPaden: ['a.pdf', 'b.pdf'],
    aankomst: aankomstB,
    canvas,
  });
  assert.equal(terugNaarB.zoom, 0.8);
});

test('een gesloten document laat geen stand achter', () => {
  const geheugen = maakStandGeheugen();
  // A is net gesloten; de viewport toont het nog als de wissel naar B loopt.
  const vertrekA = maakWeergaveStand(viewportVan('a.pdf'), canvas);
  wisselWeergave(geheugen, {
    vertrek: vertrekA,
    openPaden: ['b.pdf'],
    aankomst: { filePath: 'b.pdf', pageNum: 1, rotation: 0, viewRotation: 0, pageW: 595, pageH: 842 },
    canvas,
  });
  assert.equal(geheugen.neem('a.pdf'), null, 'opnieuw openen begint gewoon passend');
});

test('een niet-passende stand wordt niet teruggezet', () => {
  const geheugen = maakStandGeheugen();
  geheugen.bewaar(maakWeergaveStand(viewportVan('a.pdf'), canvas));
  const resultaat = wisselWeergave(geheugen, {
    vertrek: null,
    openPaden: ['a.pdf'],
    aankomst: { filePath: 'a.pdf', pageNum: 3, rotation: 90, viewRotation: 0, pageW: 842, pageH: 595 },
    canvas,
  });
  assert.equal(resultaat, null);
});
