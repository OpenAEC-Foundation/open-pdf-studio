// Krommen op een polylijn of veelhoek (#1169): het pad zoals het op de pagina
// staat en de bewerkingen erop (curve-shape.js, veelhoek-punten.js).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  kanKrommen, heeftKrommen, padOpScherm, padOngedraaid, padNaarModel, pasPadToe,
  vlakPadOpScherm, padOmhullende, padDeelBij, isKrommeZijde, zetZijdeKrom,
  buigZijde, voegKnoopIn, verwijderKnoop, stuurpunten, knoopVanStuurpunt,
  isVloeiendeKnoop, verzetStuurpunt, leesKrommenOpgave,
} from './curve-shape.js';
import {
  veelhoekUitPunten, veelhoekPuntenOpScherm, veelhoekKrommen, veelhoekKrommenOpScherm,
  verplaatsVeelhoekHoekpunt, verwijderVeelhoekHoekpunt, voegVeelhoekHoekpuntIn,
  spiegelVeelhoek, veelhoekDeelBij, pasVeelhoekToe,
} from './veelhoek-punten.js';
import { pathLength, pathArea, segmentCubic, cubicPoint } from './curve-path.js';

const bijna = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const polylijn = (extra = {}) => ({
  type: 'polyline',
  points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 90 }],
  ...extra,
});
const veelhoek = (extra = {}) => ({
  type: 'polygon',
  ...veelhoekUitPunten([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]),
  ...extra,
});
// De krommen op het scherm als absolute stuurpunten, voor vergelijken.
function absoluut(pad) {
  const uit = [];
  const n = pad.points.length;
  (pad.curves || []).forEach((s, i) => {
    if (!s) { uit.push(null); return; }
    const a = pad.points[i], b = pad.points[(i + 1) % n];
    uit.push([a.x + s.c1x, a.y + s.c1y, b.x + s.c2x, b.y + s.c2y]);
  });
  return uit;
}

test('alleen een polylijn en een veelhoek met hoekpunten kunnen krommen dragen', () => {
  assert.equal(kanKrommen(polylijn()), true);
  assert.equal(kanKrommen(veelhoek()), true);
  assert.equal(kanKrommen({ type: 'polygon', x: 0, y: 0, width: 10, height: 10, sides: 6 }), false);
  assert.equal(kanKrommen({ type: 'measurePerimeter', points: polylijn().points }), false);
  assert.equal(kanKrommen({ type: 'measureArea', points: polylijn().points }), false);
  assert.equal(kanKrommen(null), false);
  assert.equal(heeftKrommen(polylijn()), false);
  assert.equal(heeftKrommen(polylijn({ curves: [null, { c1x: 0, c1y: 9, c2x: 9, c2y: 0 }] })), true);
});

test('een vorm zonder krommen houdt bij elke bewerking het model van voorheen', () => {
  const p = polylijn();
  const pad = padOpScherm(p);
  assert.equal(pad.curves, undefined);
  assert.equal(pad.closed, false);
  const patch = padNaarModel(p, pad.points, pad.curves);
  assert.deepEqual(Object.keys(patch), ['points']);
  const v = veelhoek();
  const verplaatst = verplaatsVeelhoekHoekpunt(v, 1, 5, 5);
  assert.equal('curves' in verplaatst, false);
  assert.equal('curves' in spiegelVeelhoek(v, 'x'), false);
  assert.equal('curves' in voegVeelhoekHoekpuntIn(v, 0, null), false);
});

test('omzetten naar een kromme en terug; terug haalt het veld weg', () => {
  const p = polylijn();
  pasPadToe(p, zetZijdeKrom(p, 0, true));
  assert.equal(p.curves.length, 2);
  assert.ok(p.curves[0] && !p.curves[1]);
  assert.equal(isKrommeZijde(p, 0), true);
  assert.equal(isKrommeZijde(p, 1), false);
  // De knopen blijven; de kromme buigt licht opzij (zichtbaar omgezet).
  assert.deepEqual(p.points, polylijn().points);
  const top = cubicPoint(segmentCubic(p.points, p.curves, 0, false), 0.5);
  assert.ok(bijna(top.x, 60) && bijna(Math.abs(top.y - 10), 12.5), JSON.stringify(top));
  pasPadToe(p, zetZijdeKrom(p, 0, false));
  assert.equal('curves' in p, false);
  assert.deepEqual(p, polylijn());
  assert.equal(zetZijdeKrom(p, 2, true), null, 'een open polylijn heeft geen sluitende zijde');
  const v = veelhoek();
  pasPadToe(v, zetZijdeKrom(v, 3, true));
  assert.ok(v.curves[3], 'de sluitende zijde van een veelhoek kan krom');
});

test('buigen: het gegrepen punt volgt de muis, ook op een gedraaide veelhoek', () => {
  const p = polylijn();
  pasPadToe(p, buigZijde(p, 1, 0.5, 20, 0));
  const top = cubicPoint(segmentCubic(p.points, p.curves, 1, false), 0.5);
  assert.ok(bijna(top.x, 130) && bijna(top.y, 50));

  const v = veelhoek({ rotation: 90 });
  const voor = veelhoekPuntenOpScherm(v);
  // Zijde 0 loopt op het scherm van (80,-20) naar (80,80): het midden (80,30).
  assert.ok(bijna(voor[0].x, 80) && bijna(voor[0].y, -20) && bijna(voor[1].y, 80));
  pasPadToe(v, buigZijde(v, 0, 0.5, 15, 0));
  const pad = padOpScherm(v);
  const midden = cubicPoint(segmentCubic(pad.points, pad.curves, 0, true), 0.5);
  assert.ok(bijna(midden.x, 95) && bijna(midden.y, 30), JSON.stringify(midden));
  // De hoekpunten staan nog waar ze stonden, de hoek is gebleven.
  pad.points.forEach((q, i) => assert.ok(bijna(q.x, voor[i].x) && bijna(q.y, voor[i].y), `hoekpunt ${i}`));
  assert.equal(v.rotation, 90);
});

test('veelhoek: de krommen rekken mee met het vak en draaien en spiegelen mee', () => {
  const v = veelhoek();
  pasPadToe(v, buigZijde(v, 0, 0.5, 0, -30));
  const model = v.curves[0];
  // Vak twee keer zo breed (eigenschappenpaneel): punten en stuurpunten rekken.
  const breed = { ...v, width: 200 };
  const k = veelhoekKrommen(breed)[0];
  assert.ok(bijna(k.c1x, model.c1x * 2) && bijna(k.c1y, model.c1y));
  // Gedraaid: de stuurpunten draaien mee om het midden.
  const gedraaid = { ...v, rotation: 180 };
  const ks = veelhoekKrommenOpScherm(gedraaid)[0];
  assert.ok(bijna(ks.c1x, -model.c1x) && bijna(ks.c1y, -model.c1y));
  // De omhullende op de pagina neemt de buik mee (boven het vak uit).
  const g = padOmhullende(v);
  assert.ok(g.y < -20 && bijna(g.x, 0) && bijna(g.width, 100));
  // Spiegelen boven-onder: de buik wijst daarna naar beneden, de oppervlakte blijft.
  const opp = pathArea(padOpScherm(v).points, padOpScherm(v).curves);
  const s = pasVeelhoekToe({ ...v }, spiegelVeelhoek(v, 'y'));
  const gs = padOmhullende(s);
  assert.ok(gs.y + gs.height > 80, JSON.stringify(gs));
  assert.ok(bijna(pathArea(padOpScherm(s).points, padOpScherm(s).curves), opp, 1e-6));
});

test('een hoekpunt van een veelhoek verschuiven neemt zijn stuurpunten mee en laat de andere krommen staan', () => {
  const v = veelhoek({ rotation: 30 });
  pasPadToe(v, buigZijde(v, 1, 0.5, 12, 3));
  pasPadToe(v, buigZijde(v, 3, 0.4, -8, 5));
  const voor = { points: veelhoekPuntenOpScherm(v), curves: veelhoekKrommenOpScherm(v) };
  const absVoor = absoluut(voor);
  pasVeelhoekToe(v, verplaatsVeelhoekHoekpunt(v, 0, 25, -10));
  const na = padOpScherm(v);
  const absNa = absoluut(na);
  // Zijde 1 (knopen 1 en 2) raakt knoop 0 niet: onveranderd op het scherm.
  absNa[1].forEach((w, i) => assert.ok(bijna(w, absVoor[1][i], 1e-6), `zijde 1 [${i}]`));
  // Zijde 3 komt uit op knoop 0: zijn tweede stuurpunt is mee verschoven.
  assert.ok(bijna(absNa[3][0], absVoor[3][0]) && bijna(absNa[3][1], absVoor[3][1]), 'eerste stuurpunt blijft');
  assert.ok(bijna(absNa[3][2], absVoor[3][2] + 25) && bijna(absNa[3][3], absVoor[3][3] - 10), 'tweede stuurpunt schuift mee');
  assert.equal(v.rotation, 30);
});

test('knoop invoegen op een kromme laat de vorm gelijk; weghalen geeft hem terug', () => {
  for (const vorm of [polylijn(), veelhoek({ rotation: 45 })]) {
    pasPadToe(vorm, buigZijde(vorm, 1, 0.5, 18, -7));
    const pad0 = padOpScherm(vorm);
    const len0 = pathLength(pad0.points, pad0.curves, { closed: pad0.closed });
    const n0 = vorm.points.length;
    pasPadToe(vorm, voegKnoopIn(vorm, 1, 0.35));
    assert.equal(vorm.points.length, n0 + 1);
    const pad1 = padOpScherm(vorm);
    assert.ok(bijna(pathLength(pad1.points, pad1.curves, { closed: pad1.closed }), len0, 1e-5), vorm.type);
    assert.equal(isVloeiendeKnoop(vorm, 2), true, 'de nieuwe knoop is vloeiend');
    if (vorm.type === 'polygon') assert.equal(vorm.sides, n0 + 1);
    pasPadToe(vorm, verwijderKnoop(vorm, 2));
    assert.equal(vorm.points.length, n0);
    const pad2 = padOpScherm(vorm);
    assert.ok(bijna(pathLength(pad2.points, pad2.curves, { closed: pad2.closed }), len0, 1e-5), vorm.type);
  }
  // Ondergrens: een polylijn houdt twee knopen, een veelhoek drie.
  assert.equal(verwijderKnoop({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, 0), null);
  const drie = { type: 'polygon', ...veelhoekUitPunten([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }]) };
  assert.equal(verwijderKnoop(drie, 0), null);
});

test('de bestaande veelhoekfuncties werken op krommen', () => {
  const v = veelhoek();
  pasPadToe(v, buigZijde(v, 0, 0.5, 0, -30));
  // Raken op de buik van de kromme, ver van de koorde.
  const deel = veelhoekDeelBij(v, 50, -30, 2);
  assert.equal(deel.kind, 'edge');
  assert.equal(deel.edgeIndex, 0);
  assert.equal(deel.curve, true);
  assert.equal(veelhoekDeelBij(v, 50, 0, 2), null, 'de koorde zelf is geen rand meer');
  // Invoegen op de plek van de klik: op de kromme.
  const met = pasVeelhoekToe({ ...v }, voegVeelhoekHoekpuntIn(v, 0, deel.punt));
  assert.equal(met.points.length, 5);
  assert.ok(met.curves[0] && met.curves[1]);
  const nieuw = veelhoekPuntenOpScherm(met)[1];
  assert.ok(bijna(nieuw.x, deel.punt.x, 1e-3) && bijna(nieuw.y, deel.punt.y, 1e-3));
  // Weghalen van een hoekpunt naast een kromme.
  const zonder = pasVeelhoekToe({ ...v }, verwijderVeelhoekHoekpunt(v, 1));
  assert.equal(zonder.points.length, 3);
  assert.equal(zonder.curves.filter(Boolean).length, 1);
});

test('padDeelBij: knoop wint van segment, segment geeft de parameter', () => {
  const p = polylijn();
  pasPadToe(p, buigZijde(p, 0, 0.5, 0, -40));
  assert.deepEqual(padDeelBij(p, 11, 11, 4), { kind: 'vertex', nodeIndex: 0 });
  const zijde = padDeelBij(p, 60, -30, 3);
  assert.equal(zijde.kind, 'edge');
  assert.equal(zijde.edgeIndex, 0);
  assert.equal(zijde.curve, true);
  assert.ok(bijna(zijde.t, 0.5, 1e-3));
  const recht = padDeelBij(p, 111, 50, 3);
  assert.equal(recht.edgeIndex, 1);
  assert.equal(recht.curve, false);
  assert.equal(padDeelBij(p, 60, 10, 3), null, 'de koorde van een kromme raakt niet');
  assert.equal(padDeelBij(p, 300, 300, 3), null);
});

test('stuurpunten: een per krom uiteinde, met hun knoop', () => {
  const p = polylijn();
  assert.deepEqual(stuurpunten(p), []);
  pasPadToe(p, zetZijdeKrom(p, 1, true));
  const s = stuurpunten(p);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].segment, s[0].which, s[0].node], [1, 1, 1]);
  assert.deepEqual([s[1].segment, s[1].which, s[1].node], [1, 2, 2]);
  assert.deepEqual([s[0].nodeX, s[0].nodeY], [110, 10]);
  assert.equal(knoopVanStuurpunt(p, 1, 2), 2);
  const v = veelhoek();
  pasPadToe(v, zetZijdeKrom(v, 3, true));
  assert.equal(knoopVanStuurpunt(v, 3, 2), 0, 'de sluitende zijde eindigt op knoop 0');
});

test('verzetStuurpunt: los, vloeiend en met Shift op 45 graden', () => {
  const p = polylijn();
  pasPadToe(p, zetZijdeKrom(p, 0, true));
  pasPadToe(p, zetZijdeKrom(p, 1, true));
  assert.equal(isVloeiendeKnoop(p, 1), false, 'twee omgezette zijden maken een hoek');
  // Het tweede stuurpunt van zijde 0 (bij knoop 1) recht naar links, vloeiend:
  // het eerste van zijde 1 komt recht naar rechts te liggen, even lang als het was.
  const lengteVoor = Math.hypot(p.curves[1].c1x, p.curves[1].c1y);
  pasPadToe(p, verzetStuurpunt(p, 0, 2, 80, 10, { vloeiend: true }));
  assert.deepEqual([p.curves[0].c2x, p.curves[0].c2y], [-30, 0]);
  assert.ok(bijna(p.curves[1].c1x, lengteVoor) && bijna(p.curves[1].c1y, 0));
  assert.equal(isVloeiendeKnoop(p, 1), true);
  // Los: de overkant blijft staan en de knoop wordt een hoek.
  pasPadToe(p, verzetStuurpunt(p, 0, 2, 100, -20));
  assert.ok(bijna(p.curves[1].c1x, lengteVoor) && bijna(p.curves[1].c1y, 0));
  assert.equal(isVloeiendeKnoop(p, 1), false);
  // Shift: de richting op een veelvoud van 45 graden, de lengte blijft.
  pasPadToe(p, verzetStuurpunt(p, 0, 2, 110 - 30, 10 - 2, { shift: true }));
  assert.ok(bijna(p.curves[0].c2y, 0) && bijna(p.curves[0].c2x, -Math.hypot(30, 2)));
  assert.equal(verzetStuurpunt(polylijn(), 0, 1, 5, 5), null, 'een recht segment heeft geen stuurpunt');
  // Op een gedraaide veelhoek komt het stuurpunt op het gevraagde schermpunt.
  const v = veelhoek({ rotation: 60 });
  pasPadToe(v, zetZijdeKrom(v, 2, true));
  pasPadToe(v, verzetStuurpunt(v, 2, 1, 33, 44));
  const st = stuurpunten(v).find((h) => h.segment === 2 && h.which === 1);
  assert.ok(bijna(st.x, 33) && bijna(st.y, 44), JSON.stringify(st));
});

test('vlakPadOpScherm en padOngedraaid', () => {
  const v = veelhoek({ rotation: 90 });
  pasPadToe(v, buigZijde(v, 0, 0.5, 10, 0));
  const vlak = vlakPadOpScherm(v, 0.1);
  assert.ok(vlak.length > 4);
  const on = padOngedraaid(v);
  assert.equal(on.closed, true);
  assert.ok(bijna(on.points[0].x, 0) && bijna(on.points[0].y, 0));
  assert.equal(vlakPadOpScherm({ type: 'box' }), null);
  assert.deepEqual(padOngedraaid(polylijn()).points, polylijn().points);
});

// ── MCP ────────────────────────────────────────────────────────────────────

test('leesKrommenOpgave: een opgave van buiten nagekeken en in vaste vorm', () => {
  const k = { c1x: 1, c1y: 2, c2x: 3, c2y: 4 };
  assert.deepEqual(leesKrommenOpgave(undefined, 3, false), { ok: true, curves: undefined });
  assert.deepEqual(leesKrommenOpgave(null, 3, false), { ok: true, curves: undefined });
  assert.deepEqual(leesKrommenOpgave([null, null], 3, false), { ok: true, curves: undefined });
  assert.deepEqual(leesKrommenOpgave([k], 3, false), { ok: true, curves: [k, null] }, 'korter mag: de rest is recht');
  assert.deepEqual(leesKrommenOpgave([null, null, { ...k, extra: 1 }], 3, true), { ok: true, curves: [null, null, k] });
  assert.equal(leesKrommenOpgave([null, null, k], 3, false).ok, false, 'een open pad heeft geen sluitend segment');
  assert.equal(leesKrommenOpgave('krom', 3, false).ok, false);
  assert.equal(leesKrommenOpgave([{ c1x: 1 }], 3, false).ok, false);
  assert.equal(leesKrommenOpgave([{ c1x: 1, c1y: 2, c2x: 3, c2y: 'vier' }], 3, false).ok, false);
  assert.equal(leesKrommenOpgave([7], 3, false).ok, false);
});

test('de MCP-brug neemt krommen aan bij maken en bijwerken, en de beschrijvingen noemen ze', () => {
  const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const brug = bron('../mcp-bridge.js');
  assert.ok(brug.includes('await _krommenInOpgave(type, props, merged)'), 'app_create_annotation');
  assert.ok(brug.includes("vorm.leesKrommenOpgave('curves' in patch ? patch.curves : null"), 'app_update_annotation');
  assert.ok(brug.includes("'points', 'holes', 'path', 'controlPoints', 'curves',"), 'krommen tellen als geometrie');
  const zin = 'polyline and polygon (given as points) also take optional curves';
  assert.ok(bron('../../src-tauri/src/mcp_server.rs').includes(zin), 'mcp_server.rs');
  assert.ok(bron('../../../mcp-stdio/tools.json').includes(zin), 'tools.json');
});

test('meetvormen bieden geen krommen aan', () => {
  // Omtrek en oppervlakte meten rekenen (nog) met rechte zijden en de eigen
  // boogsegmenten van het vlak; een kromme zou een verkeerde maat geven.
  const punten = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  for (const type of ['measurePerimeter', 'measureArea', 'cloudPolyline', 'filledArea', 'splineArrow']) {
    const vorm = { type, points: punten };
    assert.equal(kanKrommen(vorm), false, type);
    assert.equal(zetZijdeKrom(vorm, 0, true), null, type);
    assert.equal(buigZijde(vorm, 0, 0.5, 1, 1), null, type);
    assert.equal(padDeelBij(vorm, 5, 0, 2), null, type);
    assert.deepEqual(stuurpunten({ ...vorm, curves: [{ c1x: 1, c1y: 1, c2x: 1, c2y: 1 }] }), [], type);
  }
});
