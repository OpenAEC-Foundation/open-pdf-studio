import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHERP_MAX_PIXELS, scherpeUitsnedeNodig, zichtbaarDeel, scherpeUitsnede, uitsnedeVolstaat,
  naarOngedraaid, uitsnedeAanvraag, draaiTransform, schaalUitsnede, beeldPastBijAanvraag,
  uitsnedeSleutel, achtergrondMaat, overlapOppervlak,
} from './doorlopend-scherp.js';
import { continuousRenderScale } from './continuous-render-scale.js';

const CAP = 4096;
const venster = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
const vak = (left, top, width, height) => ({ left, top, width, height });

test('uitsnede hoort precies daar waar de hele-paginarender gecapt wordt', () => {
  // A2 liggend (1684 x 1191 pagina-eenheden) op 150% schermschaal.
  for (const zoom of [0.5, 1, 1.5, 1.62, 1.63, 2, 4]) {
    const breedte = 1684 * zoom;
    const hoogte = 1191 * zoom;
    const gecapt = continuousRenderScale({ scale: zoom, dpr: 1.5, viewWidth: breedte, viewHeight: hoogte, maxAxisPx: CAP }) < zoom * 1.5 * (1 - 1e-9);
    assert.equal(scherpeUitsnedeNodig({ breedte, hoogte, dpr: 1.5, maxAs: CAP }), gecapt, `zoom ${zoom}`);
  }
  assert.equal(scherpeUitsnedeNodig({ breedte: 3368, hoogte: 2382, dpr: 1.5, maxAs: CAP }), true);
  assert.equal(scherpeUitsnedeNodig({ breedte: 842, hoogte: 595, dpr: 1.5, maxAs: CAP }), false);
  assert.equal(scherpeUitsnedeNodig({ breedte: NaN, hoogte: 595, dpr: 1.5, maxAs: CAP }), false);
});

test('zichtbaar deel: doorsnede van venster en pagina, in paginacoordinaten', () => {
  // Pagina van 3368 x 2382 begint 500 px boven en 200 px links van het venster.
  const z = zichtbaarDeel(venster(100, 50, 1600, 900), vak(-100, -450, 3368, 2382), 3368, 2382);
  assert.deepEqual(z, { x: 200, y: 500, breedte: 1600, hoogte: 900 });
  // Pagina kleiner dan het venster: de hele pagina.
  assert.deepEqual(zichtbaarDeel(venster(0, 0, 1600, 900), vak(400, 100, 800, 600), 800, 600), { x: 0, y: 0, breedte: 800, hoogte: 600 });
  // Buiten beeld (eronder, erboven, ernaast).
  assert.equal(zichtbaarDeel(venster(0, 0, 1600, 900), vak(0, 900, 800, 600), 800, 600), null);
  assert.equal(zichtbaarDeel(venster(0, 0, 1600, 900), vak(0, -600, 800, 600), 800, 600), null);
  assert.equal(zichtbaarDeel(venster(0, 0, 1600, 900), vak(1600, 0, 800, 600), 800, 600), null);
  assert.equal(zichtbaarDeel(null, vak(0, 0, 800, 600), 800, 600), null);
  assert.equal(zichtbaarDeel(venster(0, 0, 1600, 900), vak(0, 0, 0, 0), 800, 600), null);
});

test('zichtbaar deel rekent om als de pagina net van maat veranderd is', () => {
  // De rechthoek op het scherm is nog de oude (halve) maat; het doel is de nieuwe.
  const z = zichtbaarDeel(venster(0, 0, 1000, 500), vak(-500, -250, 2000, 1000), 4000, 2000);
  assert.deepEqual(z, { x: 1000, y: 500, breedte: 2000, hoogte: 1000 });
});

test('uitsnede: zichtbaar deel plus marge, op volle resolutie en hele apparaatpixels', () => {
  const zichtbaar = { x: 1000.3, y: 700.7, breedte: 1600, hoogte: 900 };
  const u = scherpeUitsnede(zichtbaar, 6736, 4764, { dpr: 1.5, maxAs: CAP });
  assert.equal(u.pxPerCss, 1.5);
  // Dekt het zichtbare deel met marge aan alle kanten.
  assert.ok(u.x <= zichtbaar.x - 160 && u.y <= zichtbaar.y - 90);
  assert.ok(u.x + u.breedte >= zichtbaar.x + zichtbaar.breedte + 160);
  assert.ok(u.y + u.hoogte >= zichtbaar.y + zichtbaar.hoogte + 90);
  // Hele apparaatpixels: plek en maat.
  for (const v of [u.x, u.y, u.breedte, u.hoogte]) assert.ok(Math.abs(v * 1.5 - Math.round(v * 1.5)) < 1e-6, `${v}`);
  assert.equal(u.bitmapB, Math.round(u.breedte * 1.5));
  assert.equal(u.bitmapH, Math.round(u.hoogte * 1.5));
  // Binnen de cap en het pixelbudget.
  assert.ok(u.bitmapB <= CAP && u.bitmapH <= CAP);
  assert.ok(u.bitmapB * u.bitmapH <= SCHERP_MAX_PIXELS * 1.001);
  assert.ok(uitsnedeVolstaat(u, zichtbaar));
});

test('uitsnede blijft binnen de pagina', () => {
  // Linksboven in de pagina: geen marge buiten de rand.
  const u = scherpeUitsnede({ x: 0, y: 0, breedte: 1600, hoogte: 900 }, 6000, 4000, { dpr: 1, maxAs: CAP });
  assert.equal(u.x, 0);
  assert.equal(u.y, 0);
  // Rechtsonder: tot aan de rand en niet verder.
  const v = scherpeUitsnede({ x: 4400, y: 3100, breedte: 1600, hoogte: 900 }, 6000, 4000, { dpr: 1, maxAs: CAP });
  assert.equal(v.x + v.breedte, 6000);
  assert.equal(v.y + v.hoogte, 4000);
  // Een smalle pagina die hoog boven de cap uitkomt: de hele breedte.
  const s = scherpeUitsnede({ x: 0, y: 2000, breedte: 500, hoogte: 900 }, 500, 9000, { dpr: 1, maxAs: CAP });
  assert.equal(s.x, 0);
  assert.equal(s.breedte, 500);
});

test('de marge krimpt eerst; pas daarna daalt de resolutie', () => {
  // Venster van 3840 x 2160 apparaatpixels op 150%: met volle marge te groot.
  const zichtbaar = { x: 2000, y: 2000, breedte: 2560, hoogte: 1440 };
  const u = scherpeUitsnede(zichtbaar, 20000, 14000, { dpr: 1.5, maxAs: CAP });
  assert.equal(u.pxPerCss, 1.5, 'het venster zelf past: volle resolutie');
  assert.ok(u.bitmapB <= CAP && u.bitmapH <= CAP);
  assert.ok(u.bitmapB * u.bitmapH <= SCHERP_MAX_PIXELS * 1.001);
  assert.ok(uitsnedeVolstaat(u, zichtbaar));
  // Een venster dat zelf niet past: lagere resolutie, wel gedekt.
  const groot = { x: 0, y: 0, breedte: 5000, hoogte: 3000 };
  const w = scherpeUitsnede(groot, 20000, 14000, { dpr: 2, maxAs: CAP });
  assert.ok(w.pxPerCss < 2);
  assert.ok(w.bitmapB <= CAP && w.bitmapH <= CAP);
  assert.ok(w.bitmapB * w.bitmapH <= SCHERP_MAX_PIXELS * 1.001);
  assert.ok(uitsnedeVolstaat(w, groot, 1));
});

test('uitsnede zonder zichtbaar deel of met onzinmaten: niets', () => {
  assert.equal(scherpeUitsnede(null, 100, 100, { dpr: 1, maxAs: CAP }), null);
  assert.equal(scherpeUitsnede({ x: 0, y: 0, breedte: 0, hoogte: 10 }, 100, 100, { dpr: 1, maxAs: CAP }), null);
  assert.equal(scherpeUitsnede({ x: 0, y: 0, breedte: 10, hoogte: 10 }, 0, 100, { dpr: 1, maxAs: CAP }), null);
});

test('een uitsnede volstaat zolang ze het zichtbare deel dekt', () => {
  const u = { x: 500, y: 500, breedte: 2000, hoogte: 1500 };
  assert.equal(uitsnedeVolstaat(u, { x: 700, y: 700, breedte: 1600, hoogte: 900 }), true);
  assert.equal(uitsnedeVolstaat(u, { x: 500, y: 500, breedte: 2000, hoogte: 1500 }), true);
  // Gescrold tot voorbij de rand van de uitsnede.
  assert.equal(uitsnedeVolstaat(u, { x: 950, y: 700, breedte: 1600, hoogte: 900 }), false);
  assert.equal(uitsnedeVolstaat(u, { x: 700, y: 1200, breedte: 1600, hoogte: 900 }), false);
  assert.equal(uitsnedeVolstaat(u, { x: 400, y: 700, breedte: 1600, hoogte: 900 }), false);
  assert.equal(uitsnedeVolstaat(null, { x: 0, y: 0, breedte: 1, hoogte: 1 }), false);
  assert.equal(uitsnedeVolstaat(u, null), false);
});

test('gedeeld oppervlak van twee rechthoeken', () => {
  const a = { x: 0, y: 0, breedte: 100, hoogte: 50 };
  assert.equal(overlapOppervlak(a, { x: 50, y: 25, breedte: 100, hoogte: 100 }), 50 * 25);
  assert.equal(overlapOppervlak(a, a), 5000);
  assert.equal(overlapOppervlak(a, { x: 100, y: 0, breedte: 10, hoogte: 10 }), 0);
  assert.equal(overlapOppervlak(a, { x: 0, y: 60, breedte: 10, hoogte: 10 }), 0);
  assert.equal(overlapOppervlak(null, a), 0);
});

// Een punt van de ongedraaide pagina (B x H) op de gedraaide pagina.
function draaiPunt(x, y, rot, B, H) {
  if (rot === 90) return [H - y, x];
  if (rot === 180) return [B - x, H - y];
  if (rot === 270) return [y, B - x];
  return [x, y];
}

test('gedraaide pagina: de uitsnede komt uit de juiste plek van de ongedraaide pagina', () => {
  const B = 1000; // ongedraaid
  const H = 600;
  for (const rot of [0, 90, 180, 270]) {
    const kwart = rot === 90 || rot === 270;
    const gedraaidB = kwart ? H : B;
    const gedraaidH = kwart ? B : H;
    const r = { x: 100, y: 50, breedte: 300, hoogte: 200 };
    const o = naarOngedraaid(r, rot, gedraaidB, gedraaidH);
    // De vier hoeken van de ongedraaide rechthoek landen, gedraaid, op de
    // hoeken van de gevraagde rechthoek.
    const hoeken = [[o.x, o.y], [o.x + o.breedte, o.y], [o.x, o.y + o.hoogte], [o.x + o.breedte, o.y + o.hoogte]]
      .map(([x, y]) => draaiPunt(x, y, rot, B, H));
    const xs = hoeken.map((h) => h[0]);
    const ys = hoeken.map((h) => h[1]);
    assert.deepEqual(
      { x: Math.min(...xs), y: Math.min(...ys), breedte: Math.max(...xs) - Math.min(...xs), hoogte: Math.max(...ys) - Math.min(...ys) },
      r, `rotatie ${rot}`,
    );
    assert.ok(o.x >= 0 && o.y >= 0 && o.x + o.breedte <= B && o.y + o.hoogte <= H, `rotatie ${rot} binnen de pagina`);
  }
});

test('draaitransform zet een pixel van het ongedraaide beeld op de juiste plek', () => {
  const bw = 40; // ongedraaid beeld
  const bh = 30;
  for (const rot of [0, 90, 180, 270]) {
    const t = draaiTransform(rot, bw, bh);
    const [a, b, c, d, e, f] = t.matrix;
    const kwart = rot === 90 || rot === 270;
    assert.equal(t.breedte, kwart ? bh : bw);
    assert.equal(t.hoogte, kwart ? bw : bh);
    for (const [u, v] of [[0, 0], [bw, 0], [0, bh], [bw, bh], [7, 11]]) {
      const [x, y] = [a * u + c * v + e, b * u + d * v + f];
      // Zelfde draaiing als de pagina: het beeld is een stuk pagina van bw x bh.
      assert.deepEqual([x, y], draaiPunt(u, v, rot, bw, bh), `rotatie ${rot} punt ${u},${v}`);
    }
  }
});

test('aanvraag: pagina-eenheden en bitmappixels per eenheid', () => {
  const u = { x: 300, y: 150, breedte: 2000, hoogte: 1000, pxPerCss: 1.5 };
  const a = uitsnedeAanvraag(u, { schaal: 2, rotatie: 0, breedte: 3368, hoogte: 2382 });
  assert.deepEqual(a, { scale: 3, regionXPt: 150, regionYPt: 75, regionWPt: 1000, regionHPt: 500 });
  // De bitmap die terugkomt heeft de maat van de uitsnede.
  assert.equal(a.regionWPt * a.scale, u.breedte * u.pxPerCss);
  // Kwartslag: breedte en hoogte wisselen in de aanvraag.
  const k = uitsnedeAanvraag(u, { schaal: 2, rotatie: 90, breedte: 2382, hoogte: 3368 });
  assert.equal(k.regionWPt, 500);
  assert.equal(k.regionHPt, 1000);
  assert.equal(k.regionXPt, 75);
  assert.equal(k.regionYPt, (2382 - 2300) / 2);
});

test('zoomgebaar: de uitsnede schaalt mee en is daarna niet meer op volle resolutie', () => {
  const u = { x: 100, y: 200, breedte: 1000, hoogte: 500, pxPerCss: 1.5, bitmapB: 1500, bitmapH: 750 };
  const g = schaalUitsnede(u, 2);
  assert.deepEqual(g, { x: 200, y: 400, breedte: 2000, hoogte: 1000, pxPerCss: 0.75, bitmapB: 1500, bitmapH: 750 });
  assert.equal(schaalUitsnede(u, 0), u);
  assert.equal(schaalUitsnede(null, 2), null);
});

test('een beeld van een andere maat dan gevraagd wordt geweigerd', () => {
  assert.equal(beeldPastBijAanvraag(1500, 750, 1500, 750), true);
  assert.equal(beeldPastBijAanvraag(1501, 751, 1500, 750), true);
  assert.equal(beeldPastBijAanvraag(3000, 1500, 1500, 750), false);
  assert.equal(beeldPastBijAanvraag(1500, 700, 1500, 750), false);
});

test('sleutel verandert met zoom, schermschaal, draaiing en lijnstand', () => {
  const basis = { schaal: 2, dpr: 1.5, rotatie: 0, dunneLijnen: false };
  const s = uitsnedeSleutel(basis);
  assert.equal(uitsnedeSleutel({ ...basis }), s);
  for (const anders of [{ schaal: 2.001 }, { dpr: 1.25 }, { rotatie: 90 }, { dunneLijnen: true }]) {
    assert.notEqual(uitsnedeSleutel({ ...basis, ...anders }), s, JSON.stringify(anders));
  }
});

test('achtergrond: hele pagina binnen de grens, nooit vergroot', () => {
  assert.deepEqual(achtergrondMaat(4096, 2896, 2048), { breedte: 2048, hoogte: 1448 });
  assert.deepEqual(achtergrondMaat(800, 600, 2048), { breedte: 800, hoogte: 600 });
  assert.equal(achtergrondMaat(0, 600, 2048), null);
});
