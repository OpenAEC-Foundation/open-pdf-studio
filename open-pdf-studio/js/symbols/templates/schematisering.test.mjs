// Structural schematization symbols: member, node, supports, point load,
// distributed load and moment — parameters, layout, snapping, old ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  staafTemplate, knoopTemplate, opleggingTemplate, puntlastTemplate,
  verdeeldeLastTemplate, momentTemplate, OPLEGGING_TYPEN,
  nlGetal, tekstBreedte, omhullende, verdeeldeLastPijlen, verdeeldeLastWaarden,
  puntlastLabel, momentLabel, staafLengteLabel,
} from './schematisering.js';
import {
  opleggingTemplate as opleggingViaConstructie,
  puntlastTemplate as puntlastViaConstructie,
  qlastTemplate,
} from './constructie-symbolen.js';
import { defaultParams, getTemplate } from '../registry.js';
import { syncTwoPointGeometry, resizeTwoPointGeometry, syncTwoPointLengthParam } from '../two-point.js';
import { assertBinnenBbox, teksten } from './binnen-bbox.testhulp.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);
const VAK = [opleggingTemplate, puntlastTemplate, momentTemplate, knoopTemplate];

/** Box of a node-centred symbol at default height, node at (nx, ny). */
function vakOm(t, params, nx = 100, ny = 200, hoogte = t.defaultSize.height) {
  const w = t.breedteBijHoogte(params, hoogte);
  return { x: nx - w / 2, y: ny - hoogte / 2, width: w, height: hoogte };
}

function metDefaults(t, extra = {}) {
  return { ...defaultParams(t), ...extra };
}

/** Two-point band along +x from (x0, y) with the template's band height. */
function bandVan(t, lengte, x0 = 50, y = 300) {
  const a = {};
  syncTwoPointGeometry(a, x0, y, x0 + lengte, y, t.defaultSize.height);
  return { x: a.x, y: a.y, width: a.width, height: a.height };
}

// ── Registry and defaults ───────────────────────────────────────────────────

test('alle schematiseringssymbolen staan in het register, oude ids blijven', () => {
  for (const t of [staafTemplate, knoopTemplate, verdeeldeLastTemplate, momentTemplate, opleggingTemplate, puntlastTemplate]) {
    assert.equal(getTemplate(t.id), t, t.id);
  }
  // De oude constructie-module levert dezelfde (opgewaardeerde) templates.
  assert.equal(opleggingViaConstructie, opleggingTemplate);
  assert.equal(puntlastViaConstructie, puntlastTemplate);
  assert.equal(getTemplate('q-last'), qlastTemplate);
  assert.ok(getTemplate('scharnier-verbinding'));
});

test('standaardwaarden', () => {
  assert.deepEqual(defaultParams(staafTemplate), {
    begin: 'star', eind: 'star', label: '', labelZijde: 'onder', lengteTonen: false, lengte: 6000,
  });
  assert.deepEqual(defaultParams(verdeeldeLastTemplate), {
    symbool: 'q', verloop: 'gelijkmatig', q1: 5, q2: 5, eenheid: 'kN/m', labelTonen: true, lengte: 6000,
  });
  assert.deepEqual(defaultParams(opleggingTemplate), {
    type: 'scharnier', rolStijl: 'rollen', scharnierTonen: false, opzet: 'knoop',
  });
  assert.deepEqual(defaultParams(puntlastTemplate), {
    symbool: 'F', kracht: 10, eenheid: 'kN', labelTonen: true, opzet: 'knoop',
  });
  assert.deepEqual(defaultParams(momentTemplate), {
    symbool: 'M', waarde: 10, eenheid: 'kNm', richting: 'rechtsom', labelTonen: true, opzet: 'knoop',
  });
  assert.deepEqual(defaultParams(knoopTemplate), {
    type: 'knoop', naam: '', naamPositie: 'rechtsboven', opzet: 'knoop',
  });
  assert.deepEqual(OPLEGGING_TYPEN.map((t) => t.value), ['scharnier', 'rol', 'inklemming', 'veer', 'rotatieveer']);
  // De opzet is verborgen: geen veld in het paneel, geen gereedschapsstandaard.
  for (const t of VAK) assert.equal(t.params.find((p) => p.key === 'opzet').hidden, true, t.id);
  // Elk invoerveld heeft een Nederlands en een Engels label.
  for (const t of [...VAK, staafTemplate, verdeeldeLastTemplate]) {
    for (const p of t.params) assert.ok(p.label && p.labelEn, `${t.id}.${p.key}`);
  }
});

test('labels: decimale komma, symbool en eenheid instelbaar', () => {
  assert.equal(nlGetal(7.5), '7,5');
  assert.equal(nlGetal(10), '10');
  assert.equal(nlGetal(1 / 3), '0,333');
  assert.equal(puntlastLabel({ kracht: 12.5 }), 'F = 12,5 kN');
  assert.equal(puntlastLabel({ symbool: 'Q', kracht: 800, eenheid: 'N' }), 'Q = 800 N');
  assert.equal(momentLabel({ waarde: 22.5 }), 'M = 22,5 kNm');
  assert.equal(momentLabel({ symbool: 'Ma', waarde: 3, eenheid: 'Nm' }), 'Ma = 3 Nm');
  assert.equal(staafLengteLabel({ lengte: 7200 }), 'L = 7,20 m');
  const q = (p) => teksten(verdeeldeLastTemplate.render(metDefaults(verdeeldeLastTemplate, p), bandVan(verdeeldeLastTemplate, 300)));
  assert.deepEqual(q({ q1: 7.5 }), ['q = 7,5 kN/m']);
  assert.deepEqual(q({ symbool: 'g', q1: 2, eenheid: 'kN/m²' }), ['g = 2 kN/m²']);
  assert.deepEqual(q({ labelTonen: false }), []);
});

// ── Node-centred box symbols ────────────────────────────────────────────────

test('vaksymbolen: knoop in het midden van het vak, snappunt op de knoop', () => {
  const varianten = [
    ...OPLEGGING_TYPEN.map((t) => [opleggingTemplate, { type: t.value }]),
    [opleggingTemplate, { type: 'rol', rolStijl: 'lijn' }],
    [opleggingTemplate, { type: 'scharnier', scharnierTonen: true }],
    [puntlastTemplate, {}], [puntlastTemplate, { kracht: 1250.75 }], [puntlastTemplate, { labelTonen: false }],
    [momentTemplate, {}], [momentTemplate, { richting: 'linksom' }],
    [knoopTemplate, {}], [knoopTemplate, { type: 'scharnier', naam: 'B' }],
    ...['linksboven', 'rechtsonder', 'linksonder'].map((naamPositie) => [knoopTemplate, { naam: 'C1', naamPositie }]),
  ];
  for (const [t, extra] of varianten) {
    const params = metDefaults(t, extra);
    const bbox = vakOm(t, params);
    const naam = `${t.id} ${JSON.stringify(extra)}`;
    assertBinnenBbox(t.render(params, bbox), bbox, naam);
    const knoop = t.knoopPunt(params, bbox);
    near(knoop.x, 100, 1e-9, `${naam} knoop x`);
    near(knoop.y, 200, 1e-9, `${naam} knoop y`);
    const snap = t.snapPoints(params, bbox);
    assert.ok(snap.some((p) => p.kind === 'endpoint' && p.x === knoop.x && p.y === knoop.y), `${naam}: snappunt op de knoop`);
  }
});

test('vaksymbolen: tekening vult het vak (hoogte = schaal, breedte = inhoud)', () => {
  // Oplegging: ±12 breed, knoop + 20 hoog → grondlijn over de volle breedte.
  const opl = metDefaults(opleggingTemplate);
  const bo = vakOm(opleggingTemplate, opl);
  const eo = omhullende(opleggingTemplate.render(opl, bo));
  near(eo.x0, bo.x, 1e-6, 'oplegging links');
  near(eo.x1, bo.x + bo.width, 1e-6, 'oplegging rechts');
  near(eo.y0, bo.y + bo.height / 2, 1e-6, 'oplegging begint op de knoop');
  assert.ok(eo.y1 <= bo.y + bo.height + 1e-6);
  // Puntlast: de pijlpunt raakt de knoop, het label vult de breedte.
  for (const kracht of [5, 125.5, 12000]) {
    const p = metDefaults(puntlastTemplate, { kracht });
    const b = vakOm(puntlastTemplate, p);
    const cmds = puntlastTemplate.render(p, b);
    const e = omhullende(cmds);
    const S = b.height / puntlastTemplate.defaultSize.height;
    near(e.x0, b.x + 0.5 * S, 1e-6, `puntlast ${kracht} links`);
    near(e.x1, b.x + b.width - 0.5 * S, 1e-6, `puntlast ${kracht} rechts`);
    near(e.y0, b.y, 1e-6, `puntlast ${kracht} boven`);
    near(e.y1, b.y + b.height / 2, 1e-6, `puntlast ${kracht}: punt op de knoop`);
  }
});

test('vaksymbolen: breedte volgt het label, hoogte (schaal) blijft', () => {
  const h = puntlastTemplate.defaultSize.height;
  const kort = puntlastTemplate.breedteBijHoogte(metDefaults(puntlastTemplate, { kracht: 5 }), h);
  const lang = puntlastTemplate.breedteBijHoogte(metDefaults(puntlastTemplate, { kracht: 12500.25 }), h);
  assert.ok(lang > kort);
  near(lang - kort, tekstBreedte('12500,25', 8) - tekstBreedte('5', 8), 1e-9, 'verschil = extra tekst');
  // Twee keer zo hoog = twee keer zo breed (zelfde verhouding).
  near(puntlastTemplate.breedteBijHoogte(metDefaults(puntlastTemplate), 2 * h),
    2 * puntlastTemplate.breedteBijHoogte(metDefaults(puntlastTemplate), h), 1e-9, 'evenredig');
  // Oude opzet: het vak blijft zoals het is.
  assert.equal(puntlastTemplate.breedteBijHoogte({ kracht: 5 }, h), null);
  // Standaardmaat = inhoud van de standaardwaarden.
  near(puntlastTemplate.breedteBijHoogte(metDefaults(puntlastTemplate), puntlastTemplate.defaultSize.height),
    puntlastTemplate.defaultSize.width, 1, 'puntlast standaardmaat');
  near(opleggingTemplate.breedteBijHoogte(metDefaults(opleggingTemplate), opleggingTemplate.defaultSize.height),
    opleggingTemplate.defaultSize.width, 1e-9, 'oplegging standaardmaat');
});

test('opleggingen: elk type eigen geometrie, rol op rollen of met dubbele lijn', () => {
  const vorm = (extra) => {
    const p = metDefaults(opleggingTemplate, extra);
    return opleggingTemplate.render(p, vakOm(opleggingTemplate, p));
  };
  const json = OPLEGGING_TYPEN.map((t) => JSON.stringify(vorm({ type: t.value })));
  assert.equal(new Set(json).size, json.length);
  const rollen = vorm({ type: 'rol' });
  assert.equal(rollen.filter((c) => c.kind === 'circle' && c.role === 'rol').length, 2);
  const lijn = vorm({ type: 'rol', rolStijl: 'lijn' });
  assert.equal(lijn.filter((c) => c.role === 'rol').length, 0);
  const driehoek = lijn.find((c) => c.role === 'driehoek');
  const grond = lijn.find((c) => c.role === 'grond');
  assert.ok(grond.y1 > Math.max(...driehoek.points.map((p) => p.y)), 'grondlijn los onder de driehoek');
  // Inklemming: dikke lijn door de knoop.
  const inkl = vorm({ type: 'inklemming' });
  const klem = inkl.find((c) => c.role === 'grond');
  assert.equal(klem.lineWidthFactor, 2);
  near(klem.y1, 200, 1e-9, 'inklemming door de knoop');
  // Veer: zigzag; rotatieveer: spiraal om de knoop.
  assert.ok(vorm({ type: 'veer' }).some((c) => c.role === 'veer' && c.points.length > 8));
  const spiraal = vorm({ type: 'rotatieveer' }).find((c) => c.role === 'veer' && c.kind === 'polyline');
  const afstanden = spiraal.points.map((p) => Math.hypot(p.x - 100, p.y - 200));
  assert.ok(afstanden[0] < afstanden[afstanden.length - 1], 'spiraal loopt naar buiten');
  // Arcering dun, scharniercirkel alleen op verzoek (en alleen bij scharnier/rol).
  assert.ok(vorm({}).filter((c) => c.role === 'arcering').every((c) => c.lineWidthFactor === 0.5));
  assert.ok(!vorm({}).some((c) => c.role === 'scharnier'));
  assert.ok(vorm({ scharnierTonen: true }).some((c) => c.role === 'scharnier'));
  assert.ok(!vorm({ type: 'inklemming', scharnierTonen: true }).some((c) => c.role === 'scharnier'));
});

test('moment: pijlpunt aan het eind van de draairichting', () => {
  const punt = (richting) => {
    const p = metDefaults(momentTemplate, { richting });
    return momentTemplate.render(p, vakOm(momentTemplate, p)).find((c) => c.role === 'pijlpunt').points[0];
  };
  const rechts = punt('rechtsom');
  const links = punt('linksom');
  assert.ok(rechts.x > 100 && rechts.y > 200, 'rechtsom eindigt rechtsonder');
  assert.ok(links.x < 100 && links.y > 200, 'linksom eindigt linksonder');
});

test('oude opzet (zonder opzet-param) houdt de knoop aan de rand van het vak', () => {
  const vak = { x: 10, y: 20, width: 64, height: 64 };
  for (const type of ['scharnier', 'rol', 'inklemming']) {
    const cmds = opleggingTemplate.render({ type }, vak);
    assertBinnenBbox(cmds, vak, `oplegging oud ${type}`);
    const e = omhullende(cmds);
    near(e.x0, vak.x, 1e-6, `${type}: vult de breedte`);
    near(e.x1, vak.x + vak.width, 1e-6, `${type}: vult de breedte`);
  }
  const top = opleggingTemplate.knoopPunt({ type: 'scharnier' }, vak);
  near(top.x, 42, 1e-9, 'knoop midden boven');
  assert.ok(top.y < vak.y + vak.height * 0.15, 'knoop bovenaan, zoals voorheen');
  const pl = { x: 10, y: 20, width: 90, height: 90 };
  const cmds = puntlastTemplate.render({ kracht: 25 }, pl);
  assertBinnenBbox(cmds, pl, 'puntlast oud');
  assert.deepEqual(teksten(cmds), ['F = 25 kN']);
  const tip = puntlastTemplate.knoopPunt({ kracht: 25 }, pl);
  near(tip.y, omhullende(cmds).y1, 1e-6, 'knoop = onderkant van de tekening');
  assert.ok(tip.y > pl.y + pl.height * 0.85, 'pijlpunt onderaan, zoals voorheen');
  // q-last (vak) rendert ongewijzigd.
  assert.deepEqual(teksten(qlastTemplate.render({ q: 7.5, lengte: 3000 }, { x: 0, y: 0, width: 220, height: 90 })), ['q = 7.5 kN/m']);
});

test('bewerkbaar label: kracht en moment', () => {
  for (const [t, veld] of [[puntlastTemplate, 'kracht'], [momentTemplate, 'waarde']]) {
    const p = metDefaults(t);
    const b = vakOm(t, p);
    const [label] = t.editableLabels(p, b);
    assert.deepEqual(label.fields, [veld]);
    const tekst = t.render(p, b).find((c) => c.role === 'label');
    assert.ok(tekst.x > label.rect.x && tekst.x < label.rect.x + label.rect.width);
    assert.ok(tekst.y > label.rect.y && tekst.y < label.rect.y + label.rect.height);
    assert.deepEqual(t.editableLabels({ ...p, labelTonen: false }, b), []);
  }
  assert.deepEqual(knoopTemplate.editableLabels(metDefaults(knoopTemplate, { naam: 'A' }), vakOm(knoopTemplate, {})), []);
});

// ── Line symbols (two-point) ────────────────────────────────────────────────

test('staaf en q-last: werkelijke lengte = lengte, bandhoogte is papiermaat', () => {
  for (const t of [staafTemplate, verdeeldeLastTemplate]) {
    assert.equal(t.placement, 'two-point');
    assert.deepEqual(t.realSizeMm({ lengte: 4500 }), { width: 4500, height: null });
    assert.deepEqual(t.realSizeMm({}), { width: 6000, height: null });
    // Lengte wijzigen in het paneel: de lijn wordt lengte × schaal lang en
    // de band behoudt zijn hoogte (zo past real-size.js het toe).
    const ann = {};
    syncTwoPointGeometry(ann, 0, 0, 100, 60, t.defaultSize.height);
    const k = 0.05; // 1:50 → 0,05 pt per mm (vereenvoudigd)
    resizeTwoPointGeometry(ann, t.realSizeMm({ lengte: 4500 }).width * k, ann.height);
    near(Math.hypot(ann.endX - ann.startX, ann.endY - ann.startY), 225, 1e-9, `${t.id} lengte`);
    near(ann.height, t.defaultSize.height, 1e-9, `${t.id} band`);
    syncTwoPointLengthParam(ann, k);
    near(ann.params.lengte, 4500, 0.01, `${t.id} lengte terug`);
  }
  const bron = readFileSync(new URL('../real-size.js', import.meta.url), 'utf8');
  assert.match(bron, /tpl\.placement === 'two-point' && mm && mm\.width > 0 && !\(mm\.height > 0\)/);
  assert.match(bron, /tpl\.breedteBijHoogte\(ann\.params \|\| \{\}, ann\.height\)/);
});

test('staaf: lijn van knoop tot knoop, scharnier als cirkel op de knoop', () => {
  const b = bandVan(staafTemplate, 240);
  const yA = b.y + b.height / 2;
  const star = staafTemplate.render(metDefaults(staafTemplate), b);
  const lijn = star.find((c) => c.role === 'staaf');
  assert.deepEqual([lijn.x1, lijn.x2, lijn.y1, lijn.y2], [b.x, b.x + b.width, yA, yA]);
  assert.equal(lijn.lineWidthFactor, 2);
  assertBinnenBbox(star, b, 'staaf star');
  // Snappunten: beide knopen en het midden, op de systeemlijn.
  assert.deepEqual(staafTemplate.snapPoints({}, b).map((p) => [p.kind, p.x, p.y]), [
    ['endpoint', b.x, yA], ['endpoint', b.x + b.width, yA], ['midpoint', b.x + b.width / 2, yA],
  ]);
  const vw = staafTemplate.render(metDefaults(staafTemplate, { begin: 'scharnier', eind: 'scharnier' }), b);
  const cirkels = vw.filter((c) => c.role === 'scharnier');
  assert.equal(cirkels.length, 2);
  const middens = cirkels.map((c) => omhullende([c])).map((e) => [(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2]);
  near(middens[0][0], b.x, 1e-6, 'scharnier op de beginknoop');
  near(middens[1][0], b.x + b.width, 1e-6, 'scharnier op de eindknoop');
  near(middens[0][1], yA, 1e-6, 'scharnier op de as');
  assert.equal(cirkels[0].fill, '#ffffff');
  const vwLijn = vw.find((c) => c.role === 'staaf');
  const r = (omhullende([cirkels[0]]).x1 - omhullende([cirkels[0]]).x0) / 2;
  near(vwLijn.x1, b.x + r, 1e-6, 'lijn stopt aan de rand');
  // Alles behalve de halve scharniercirkels ligt in de band.
  assertBinnenBbox(vw.filter((c) => c.role !== 'scharnier'), b, 'vakwerkstaaf');
  // Naam onder (standaard) of boven, lengte aan de andere kant.
  const metNaam = staafTemplate.render(metDefaults(staafTemplate, { label: 'HEA 200', lengteTonen: true }), b);
  const naam = metNaam.find((c) => c.role === 'label');
  const lengte = metNaam.find((c) => c.role === 'lengte');
  assert.ok(naam.y > yA && lengte.y < yA);
  assert.equal(lengte.text, 'L = 6,00 m');
  const boven = staafTemplate.render(metDefaults(staafTemplate, { label: 'S1', labelZijde: 'boven' }), b);
  assert.ok(boven.find((c) => c.role === 'label').y < yA);
  assertBinnenBbox(metNaam, b, 'staaf met teksten');
});

test('q-last: pijlafstand volgt de lengte, pijlen aan beide uiteinden', () => {
  const S = 1;
  const posities = verdeeldeLastPijlen(180, S);
  assert.equal(posities.length, 21);                 // 180 / 9 = 20 vakken
  near(posities[1] - posities[0], 9, 1e-9, 'afstand');
  assert.equal(posities[0], 0);
  assert.equal(posities[posities.length - 1], 180);
  // Langer → meer pijlen, afstand blijft dicht bij 9.
  let vorige = 0;
  for (const L of [20, 60, 100, 240, 600, 1200]) {
    const p = verdeeldeLastPijlen(L, S);
    assert.ok(p.length >= vorige, `aantal groeit met de lengte (${L})`);
    vorige = p.length;
    const stap = p[1] - p[0];
    assert.ok(stap >= 6 && stap <= 18, `afstand ${stap} bij ${L}`);
    for (let i = 1; i < p.length; i++) near(p[i] - p[i - 1], stap, 1e-9, 'gelijke afstand');
  }
  // Dubbele bandhoogte (symboolschaal 2) = dubbele afstand.
  assert.equal(verdeeldeLastPijlen(360, 2).length, 21);
  // In de render: aantal pijlpunten = aantal posities over de pijlzone.
  const b = bandVan(verdeeldeLastTemplate, 240);
  const cmds = verdeeldeLastTemplate.render(metDefaults(verdeeldeLastTemplate), b);
  assertBinnenBbox(cmds, b, 'q-last');
  const koppen = cmds.filter((c) => c.role === 'pijlpunt');
  const inset = koppen[0].points[0].x - b.x;
  assert.equal(koppen.length, verdeeldeLastPijlen(240 - 2 * inset, 1).length);
  // De punten raken de as (net erboven), de pijlen hangen eraan.
  const yA = b.y + b.height / 2;
  for (const k of koppen) near(k.points[0].y, yA - 1, 1e-9, 'punt op de staaf');
  assert.ok(cmds.filter((c) => c.role === 'pijl').every((c) => c.y1 < c.y2 && c.y2 < yA));
  // Snappunten: begin, eind en midden van de belaste zone op de as.
  assert.deepEqual(verdeeldeLastTemplate.snapPoints({}, b).map((p) => p.y), [yA, yA, yA]);
});

test('q-last trapezium en driehoek: pijllengte lineair tussen q1 en q2', () => {
  assert.deepEqual(verdeeldeLastWaarden({ q1: 3 }), { q1: 3, q2: 3 });
  assert.deepEqual(verdeeldeLastWaarden({ q1: 3, q2: 9 }), { q1: 3, q2: 3 });
  assert.deepEqual(verdeeldeLastWaarden({ verloop: 'trapezium', q1: 3, q2: 9 }), { q1: 3, q2: 9 });
  const b = bandVan(verdeeldeLastTemplate, 300);
  const yTip = b.y + b.height / 2 - 1;
  const lengtes = (params) => {
    const cmds = verdeeldeLastTemplate.render(metDefaults(verdeeldeLastTemplate, params), b);
    assertBinnenBbox(cmds, b, JSON.stringify(params));
    return { cmds, koppen: cmds.filter((c) => c.role === 'pijlpunt') };
  };
  const { cmds, koppen } = lengtes({ verloop: 'trapezium', q1: 2, q2: 6 });
  const contour = cmds.find((c) => c.role === 'contour');
  near((yTip - contour.y1) / (yTip - contour.y2), 2 / 6, 1e-9, 'hoogte begin/eind = q1/q2');
  // Elke pijl reikt tot de contour.
  for (const pijl of cmds.filter((c) => c.role === 'pijl')) {
    const t = (pijl.x1 - contour.x1) / (contour.x2 - contour.x1);
    near(pijl.y1, contour.y1 + (contour.y2 - contour.y1) * t, 1e-9, 'pijl tot de contour');
  }
  assert.ok(koppen.length > 10);
  assert.deepEqual(teksten(cmds), ['q1 = 2 kN/m', 'q2 = 6 kN/m']);
  const velden = verdeeldeLastTemplate.editableLabels(metDefaults(verdeeldeLastTemplate, { verloop: 'trapezium', q1: 2, q2: 6 }), b);
  assert.deepEqual(velden.map((l) => l.fields), [['q1'], ['q2']]);
  // Driehoek: geen pijl en geen label aan het nul-einde.
  const driehoek = lengtes({ verloop: 'trapezium', q1: 0, q2: 8 });
  assert.deepEqual(teksten(driehoek.cmds), ['q2 = 8 kN/m']);
  assert.ok(driehoek.koppen[0].points[0].x > b.x + 10, 'eerste pijl niet op het nul-einde');
  near(driehoek.cmds.find((c) => c.role === 'contour').y1, yTip, 1e-9, 'contour begint op de as');
  // Te kort voor twee labels: één gecombineerd label.
  const kort = bandVan(verdeeldeLastTemplate, 80);
  assert.deepEqual(teksten(verdeeldeLastTemplate.render(
    metDefaults(verdeeldeLastTemplate, { verloop: 'trapezium', q1: 2, q2: 6 }), kort)), ['q = 2 – 6 kN/m']);
});
