// Krommen op een polylijn en een veelhoek over opslaan → heropenen (#1169).
//
// Een /PolyLine of /Polygon kan in /Vertices geen krommen kwijt. De opslag
// schrijft daarom (pdf/curve-pdf.js):
//   - een appearance met echte kromme-operatoren, voor elke PDF-lezer;
//   - /Vertices als het vlakgemaakte pad, voor andere programma's;
//   - de knopen en stuurpunten in /OPS_CurveNodes en /OPS_Curves, zodat de
//     app het pad bewerkbaar heropent.
// Elk geval gaat twee keer door de echte saver en lader
// (rondgang.testhulp.mjs), ook op een gedraaide pagina en een pagina met
// /UserUnit. Een vorm zonder krommen wordt weggeschreven als voorheen, en een
// bestand met alleen /Vertices geladen als voorheen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFNumber, decodePDFRawStream } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';
import { veelhoekUitPunten } from '../annotations/veelhoek-punten.js';
import { padOpScherm, pasPadToe, buigZijde, zetZijdeKrom, heeftKrommen } from '../annotations/curve-shape.js';
import { pathLength, pathArea, flattenPath } from '../annotations/curve-path.js';
import { krommenNaarPdf, krommenUitPdf } from './curve-pdf.js';

const N = (s) => PDFName.of(s);
const getallen = (arr) => arr.asArray().map((v) => v.asNumber());

const stijl = {
  page: 1, color: '#cc0000', strokeColor: '#cc0000', lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'User',
};
const polylijn = () => pasPadToe(
  { id: 'pl', type: 'polyline', ...stijl, points: [{ x: 100, y: 120 }, { x: 300, y: 120 }, { x: 300, y: 300 }, { x: 420, y: 300 }] },
  buigZijde({ type: 'polyline', points: [{ x: 100, y: 120 }, { x: 300, y: 120 }, { x: 300, y: 300 }, { x: 420, y: 300 }] }, 1, 0.4, 45, -10));
function veelhoek(extra = {}) {
  const v = {
    id: 'vh', type: 'polygon', rotation: 0, fillColor: '#ffeeaa', ...stijl,
    ...veelhoekUitPunten([{ x: 150, y: 400 }, { x: 330, y: 400 }, { x: 330, y: 520 }, { x: 150, y: 520 }]),
    ...extra,
  };
  // Een afgeronde hoek (zijde 1) en een gebogen sluitzijde (zijde 3).
  pasPadToe(v, buigZijde(v, 1, 0.5, 25, 5));
  pasPadToe(v, buigZijde(v, 3, 0.3, -30, 12));
  return v;
}

// Het pad op het scherm met absolute stuurpunten, voor het vergelijken.
function absoluut(model) {
  const pad = padOpScherm(model);
  const n = pad.points.length;
  return {
    knopen: pad.points.map((p) => [p.x, p.y]),
    krommen: (pad.curves || []).map((s, i) => {
      if (!s) return null;
      const a = pad.points[i], b = pad.points[(i + 1) % n];
      return [a.x + s.c1x, a.y + s.c1y, b.x + s.c2x, b.y + s.c2y];
    }),
  };
}
function zelfdePad(werkelijk, verwacht, wat, tol = 0.02) {
  const w = absoluut(werkelijk), v = absoluut(verwacht);
  assert.equal(w.knopen.length, v.knopen.length, `${wat}: aantal knopen`);
  w.knopen.forEach((p, i) => p.forEach((c, k) => assert.ok(Math.abs(c - v.knopen[i][k]) <= tol, `${wat}: knoop ${i} [${k}] ${c} i.p.v. ${v.knopen[i][k]}`)));
  assert.equal(w.krommen.length, v.krommen.length, `${wat}: aantal segmenten`);
  w.krommen.forEach((s, i) => {
    assert.equal(!!s, !!v.krommen[i], `${wat}: segment ${i} krom of recht`);
    if (s) s.forEach((c, k) => assert.ok(Math.abs(c - v.krommen[i][k]) <= tol, `${wat}: stuurpunt ${i} [${k}] ${c} i.p.v. ${v.krommen[i][k]}`));
  });
}

async function rondgang(modellen, { keer = 2, rotatie = 0, bron = null, lader = laad } = {}) {
  let bytes = bron || await leegBlad({ rotatie });
  let huidig = modellen;
  for (let i = 0; i < keer; i++) {
    bytes = await opslaan(bytes, huidig);
    huidig = await lader(bytes);
  }
  return { modellen: huidig, bytes };
}

function apTekst(lijst, dict) {
  const ap = lijst.doc.context.lookup(dict.get(N('AP')));
  const stroom = lijst.doc.context.lookup(ap.get(N('N')));
  return Buffer.from(decodePDFRawStream(stroom).decode()).toString('latin1');
}

// ── Puur: curve-pdf.js ─────────────────────────────────────────────────────

test('krommenNaarPdf en krommenUitPdf zijn elkaars tegenhanger', () => {
  const pad = padOpScherm(polylijn());
  const naarPdf = (p) => [p.x + 10, 800 - p.y];
  const uit = krommenNaarPdf(pad, naarPdf);
  assert.equal(uit.nodes.length, 8);
  assert.equal(uit.curves.length, 5);
  assert.equal(uit.curves[0], 1, 'het segmentnummer van de kromme');
  assert.ok(uit.vertices.length > uit.nodes.length, '/Vertices volgt de kromme met extra punten');
  assert.match(uit.padOps, /^110 680 m\n310 680 l\n[\d. -]+ c\n430 500 l\n$/);
  const terug = krommenUitPdf({ nodes: uit.nodes, curves: uit.curves, vertices: uit.vertices, closed: false,
    convertPoint: (x, y) => [x - 10, 800 - y] });
  assert.deepEqual(terug.points, pad.points.map((p) => ({ x: p.x, y: p.y })));
  for (const k of ['c1x', 'c1y', 'c2x', 'c2y']) assert.ok(Math.abs(terug.curves[1][k] - pad.curves[1][k]) < 1e-9);
  // Een gesloten pad met een kromme sluitzijde eindigt met c en h.
  const dicht = krommenNaarPdf(padOpScherm(veelhoek()), naarPdf);
  assert.match(dicht.padOps, / c\nh\n$/);
  // Een rechte sluitzijde tekent h zelf.
  const v = { type: 'polygon', ...veelhoekUitPunten([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]) };
  pasPadToe(v, zetZijdeKrom(v, 0, true));
  assert.match(krommenNaarPdf(padOpScherm(v), naarPdf).padOps, / c\n60 750 l\nh\n$/);
});

test('krommenUitPdf weigert sleutels die niet kloppen of niet meer bij /Vertices horen', () => {
  const pad = padOpScherm(polylijn());
  const uit = krommenNaarPdf(pad, (p) => [p.x, 800 - p.y]);
  const basis = { nodes: uit.nodes, curves: uit.curves, vertices: uit.vertices, closed: false, convertPoint: (x, y) => [x, 800 - y] };
  assert.ok(krommenUitPdf(basis));
  assert.equal(krommenUitPdf({ ...basis, nodes: uit.nodes.slice(1) }), null, 'oneven aantal getallen');
  assert.equal(krommenUitPdf({ ...basis, curves: [9, 1, 2, 3, 4] }), null, 'segment bestaat niet');
  assert.equal(krommenUitPdf({ ...basis, curves: uit.curves.slice(1) }), null, 'geen vijftallen');
  assert.equal(krommenUitPdf({ ...basis, curves: [] }), null, 'geen kromme');
  assert.equal(krommenUitPdf({ ...basis, curves: [...uit.curves, ...uit.curves] }), null, 'hetzelfde segment twee keer');
  // Een ander programma heeft de vorm verschoven: /Vertices geldt.
  assert.equal(krommenUitPdf({ ...basis, vertices: uit.vertices.map((v, i) => v + (i % 2 ? 0 : 25)) }), null);
  assert.equal(krommenUitPdf({ ...basis, nodes: null }), null);
});

// ── Polylijn ───────────────────────────────────────────────────────────────

for (const rotatie of [0, 90, 180, 270]) {
  test(`polylijn met een kromme komt bewerkbaar terug (pagina ${rotatie}°)`, async () => {
    const bron = polylijn();
    const { modellen, bytes } = await rondgang([bron], { rotatie });
    assert.equal(modellen.length, 1, 'één annotatie, geen dubbeling');
    const [m] = modellen;
    assert.equal(m.type, 'polyline');
    assert.equal(m.points.length, 4, 'de knopen, niet de punten van het vlakgemaakte pad');
    assert.equal(m.curves.length, 3);
    zelfdePad(m, bron, `pagina ${rotatie}°`);

    const lijst = await woordenboeken(bytes);
    const [{ dict }] = lijst;
    assert.equal(dict.get(N('Subtype')), N('PolyLine'));
    assert.equal(dict.get(N('OPS_CurveNodes')).size(), 8);
    assert.equal(dict.get(N('OPS_Curves')).size(), 5);
    // /Vertices: het vlakgemaakte pad — meer punten dan knopen, en elk punt
    // ligt op het pad (binnen de tolerantie).
    const vertices = getallen(dict.get(N('Vertices')));
    assert.ok(vertices.length > 8 * 2, `/Vertices volgt de kromme (${vertices.length / 2} punten)`);
    // De appearance tekent een echte kromme.
    const ap = apTekst(lijst, dict);
    assert.match(ap, /\d c\n/, 'kromme-operator in de appearance');
    assert.equal((ap.match(/ c\n/g) || []).length, 1, 'één kromme, geen reeks lijnstukjes');
    // De /Rect omvat de buik van de kromme.
    const rect = getallen(dict.get(N('Rect')));
    for (let i = 0; i < vertices.length; i += 2) {
      assert.ok(vertices[i] >= rect[0] && vertices[i] <= rect[2] && vertices[i + 1] >= rect[1] && vertices[i + 1] <= rect[3],
        'elk punt van het pad ligt binnen de /Rect');
    }
  });
}

test('de lengte van het vlakgemaakte /Vertices-pad wijkt nauwelijks af van de kromme', async () => {
  const bron = polylijn();
  const { bytes } = await rondgang([bron], { keer: 1 });
  const [{ dict }] = await woordenboeken(bytes);
  const v = getallen(dict.get(N('Vertices')));
  let lengte = 0;
  for (let i = 2; i < v.length; i += 2) lengte += Math.hypot(v[i] - v[i - 2], v[i + 1] - v[i - 1]);
  const echt = pathLength(bron.points, bron.curves);
  assert.ok(Math.abs(lengte - echt) < 0.2, `${lengte} vs ${echt}`);
});

// ── Veelhoek ───────────────────────────────────────────────────────────────

for (const [rotatie, hoek] of [[0, 0], [0, 30], [90, 30], [270, 0]]) {
  test(`veelhoek met krommen komt bewerkbaar terug (pagina ${rotatie}°, vorm ${hoek}° gedraaid)`, async () => {
    const bron = veelhoek({ rotation: hoek });
    const { modellen, bytes } = await rondgang([bron], { rotatie });
    assert.equal(modellen.length, 1);
    const [m] = modellen;
    assert.equal(m.type, 'polygon');
    assert.equal(m.points.length, 4);
    assert.equal(m.sides, 4);
    assert.equal(m.rotation || 0, hoek);
    assert.equal(m.fillColor, '#ffeeaa');
    zelfdePad(m, bron, `pagina ${rotatie}°, vorm ${hoek}°`);
    const padVoor = padOpScherm(bron), padNa = padOpScherm(m);
    assert.ok(Math.abs(pathArea(padNa.points, padNa.curves) - pathArea(padVoor.points, padVoor.curves)) < 0.5, 'dezelfde oppervlakte');

    const lijst = await woordenboeken(bytes);
    const [{ dict }] = lijst;
    assert.equal(dict.get(N('Subtype')), N('Polygon'));
    assert.equal(dict.get(N('OPS_CurveNodes')).size(), 8);
    assert.equal(dict.get(N('OPS_Curves')).size(), 10);
    assert.ok(dict.get(N('Vertices')).size() > 8, '/Vertices is het vlakgemaakte pad');
    const ap = apTekst(lijst, dict);
    // Vulling en rand tekenen allebei het pad met twee krommen.
    assert.equal((ap.match(/ c\n/g) || []).length, 4, 'twee krommen in de vulling en twee in de rand');
    assert.match(ap, / c\nh\n/, 'de kromme sluitzijde sluit het pad');
  });
}

test('een veelhoek met krommen en een arcering slaat op en komt terug', async () => {
  const bron = veelhoek({ hatchPattern: 'diagonal-left', hatchColor: '#0000ff', hatchScale: 100, hatchAngle: 0 });
  const { modellen } = await rondgang([bron]);
  assert.equal(modellen[0].hatchPattern, 'diagonal-left');
  zelfdePad(modellen[0], bron, 'met arcering');
});

// ── Zonder krommen, en bestanden van elders ────────────────────────────────

test('zonder krommen: geen eigen sleutels, /Vertices zijn de knopen, het model heeft geen curves-veld', async () => {
  const pl = { id: 'pl', type: 'polyline', ...stijl, points: [{ x: 100, y: 120 }, { x: 300, y: 120 }, { x: 300, y: 300 }] };
  const vh = { id: 'vh', type: 'polygon', rotation: 0, fillColor: null, ...stijl,
    ...veelhoekUitPunten([{ x: 150, y: 400 }, { x: 330, y: 400 }, { x: 330, y: 520 }]) };
  const { modellen, bytes } = await rondgang([pl, vh]);
  assert.equal(modellen.length, 2);
  for (const m of modellen) assert.equal('curves' in m, false, `${m.type}: geen curves-veld`);
  for (const { dict } of await woordenboeken(bytes)) {
    assert.equal(dict.get(N('OPS_CurveNodes')), undefined);
    assert.equal(dict.get(N('OPS_Curves')), undefined);
    assert.equal(dict.get(N('Vertices')).size(), 6);
  }
});

test('een kromme weer recht gemaakt: de eigen sleutels verdwijnen uit het bestand', async () => {
  const { modellen, bytes: eerst } = await rondgang([polylijn()], { keer: 1 });
  assert.ok(heeftKrommen(modellen[0]));
  pasPadToe(modellen[0], zetZijdeKrom(modellen[0], 1, false));
  const bytes = await opslaan(eerst, modellen);
  const [{ dict }] = await woordenboeken(bytes);
  assert.equal(dict.get(N('OPS_Curves')), undefined);
  assert.equal(dict.get(N('Vertices')).size(), 8);
  const weer = await laad(bytes);
  assert.equal('curves' in weer[0], false);
});

test('alleen /Vertices (een ander programma): een polylijn door die punten, zoals voorheen', async () => {
  const { bytes } = await rondgang([polylijn()], { keer: 1 });
  const lijst = await woordenboeken(bytes);
  const [{ dict }] = lijst;
  const aantal = dict.get(N('Vertices')).size() / 2;
  dict.delete(N('OPS_CurveNodes'));
  dict.delete(N('OPS_Curves'));
  const modellen = await laad(await lijst.doc.save());
  assert.equal(modellen.length, 1);
  assert.equal(modellen[0].type, 'polyline');
  assert.equal('curves' in modellen[0], false);
  assert.equal(modellen[0].points.length, aantal, 'de punten van /Vertices');
});

test('door een ander programma verschoven (/Vertices veranderd, eigen sleutels oud): /Vertices geldt', async () => {
  const { bytes } = await rondgang([polylijn()], { keer: 1 });
  const lijst = await woordenboeken(bytes);
  const [{ dict }] = lijst;
  const v = getallen(dict.get(N('Vertices')));
  dict.set(N('Vertices'), lijst.doc.context.obj(v.map((c, i) => c + (i % 2 ? 0 : 40))));
  const modellen = await laad(await lijst.doc.save());
  assert.equal('curves' in modellen[0], false, 'de oude krommen worden niet teruggezet op de oude plek');
  assert.ok(Math.abs(modellen[0].points[0].x - 140) < 0.02, 'de vorm staat waar /Vertices hem zet');
});

// ── /UserUnit ──────────────────────────────────────────────────────────────

test('op een pagina met /UserUnit komen knopen en stuurpunten terug waar ze stonden', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  pagina.node.set(N('UserUnit'), PDFNumber.of(2.5));
  const bron = await doc.save();
  // De lader van de app rekent in pagina-eenheden (paginaViewport), niet in
  // de met /UserUnit vermenigvuldigde viewport van PDF.js.
  const { zetPaginaAnnotatiesOm } = await import('./loader/annotaties-omzetten.js');
  const { extractAnnotationColors } = await import('./loader/color-extraction.js');
  const { paginaViewport } = await import('./pagina-viewport.js');
  const lader = async (bytes) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const d = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
    const p = await d.getPage(1);
    assert.equal(p.userUnit, 2.5);
    const lib = await PDFDocument.load(bytes.slice());
    const kaart = await extractAnnotationColors(1, lib);
    const modellen = await zetPaginaAnnotatiesOm(await p.getAnnotations(), 1, paginaViewport(p), new Map(), kaart);
    await d.loadingTask.destroy();
    return modellen;
  };
  const pl = polylijn();
  const vh = veelhoek({ rotation: 20 });
  const { modellen } = await rondgang([pl, vh], { bron, lader });
  assert.equal(modellen.length, 2);
  zelfdePad(modellen.find((m) => m.type === 'polyline'), pl, 'polylijn met /UserUnit');
  zelfdePad(modellen.find((m) => m.type === 'polygon'), vh, 'veelhoek met /UserUnit');
});

test('elk punt van /Vertices ligt op de kromme', async () => {
  const bron = veelhoek();
  const { bytes } = await rondgang([bron], { keer: 1 });
  const [{ dict }] = await woordenboeken(bytes);
  const v = getallen(dict.get(N('Vertices')));
  // Tegen een zeer fijn vlakgemaakt pad in dezelfde (PDF-)ruimte: y omgeklapt.
  const pad = padOpScherm(bron);
  const fijn = flattenPath(pad.points, pad.curves, { closed: true, tolerance: 0.001 }).map((p) => [p.x, 842 - p.y]);
  for (let i = 0; i < v.length; i += 2) {
    let d = Infinity;
    for (let k = 0; k < fijn.length; k++) {
      const a = fijn[k], b = fijn[(k + 1) % fijn.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((v[i] - a[0]) * dx + (v[i + 1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(a[0] + t * dx - v[i], a[1] + t * dy - v[i + 1]));
    }
    assert.ok(d < 0.01, `punt ${i / 2} van /Vertices ligt ${d} van het pad`);
  }
});
