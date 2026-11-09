// Tool Sets uit XFDF (#629, #311): de markeringen van een XFDF-bestand
// (ISO 19444-1) worden items van een werkkist.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MiniDOMParser } from '../review/mini-xml-dom.testhulp.mjs';
import { toolSetFromXfdf } from './tool-sets-xfdf.js';
import { importToolSet, emptyCatalog } from './tool-sets.js';

const xfdf = (annots) => new MiniDOMParser().parseFromString(
  `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xml:space="preserve"><annots>${annots}</annots></xfdf>`);

const VOORBEELD = `
<line page="0" rect="10,10,200,20" color="#FF0000" width="2" opacity="0.8" head="None" tail="OpenArrow" subject="Leiding" title="Ann" start="10,10" end="200,20"/>
<line page="0" rect="10,40,200,50" color="#0000FF" width="1" intent="LineDimension" head="OpenArrow" tail="OpenArrow" subject="Maat" start="10,40" end="200,50"/>
<polygon page="0" rect="0,0,100,100" color="#00AA00" interior-color="#CCFFCC" width="1.5" intent="PolygonDimension" subject="Vloer"><vertices>0,0;100,0;100,100</vertices></polygon>
<polygon page="0" rect="0,0,100,100" color="#FF8800" style="cloudy" intensity="2" width="1"><vertices>0,0;100,0;100,100</vertices></polygon>
<polyline page="0" rect="0,0,50,50" color="#333333" style="dash" dashes="4,2" width="1" intent="PolyLineDimension" subject="Omtrek"><vertices>0,0;50,0;50,50</vertices></polyline>
<square page="1" rect="0,0,40,40" color="#000000" interior-color="#FFFF00" width="3" subject="Sparing" opslayer="Installaties"/>
<circle page="1" rect="0,0,40,40" color="#000000" style="dash" dashes="1,2" width="1"/>
<text page="0" rect="0,0,20,20" color="#FFFF00"><contents>Notitie</contents></text>
<ink page="0" rect="0,0,20,20" color="#000000" width="1"><inklist><gesture>0,0;5,5</gesture></inklist></ink>
`;

test('elke ondersteunde markering wordt een item met haar instellingen en naam', () => {
  const r = toolSetFromXfdf(xfdf(VOORBEELD), { name: 'Werkset installaties', typeName: (t) => `Type ${t}` });
  assert.equal(r.ok, true);
  assert.equal(r.set.name, 'Werkset installaties');
  assert.equal(r.skipped, 2, 'notitie en inkt hebben geen eigen gereedschap in een werkkist');
  const perNaam = Object.fromEntries(r.set.items.map((i) => [i.name, i]));
  assert.deepEqual(Object.keys(perNaam).sort(), ['Leiding', 'Maat', 'Omtrek', 'Sparing', 'Type circle', 'Type cloud', 'Vloer']);

  assert.equal(perNaam.Leiding.type, 'arrow');
  assert.deepEqual(perNaam.Leiding.props, { color: '#ff0000', strokeColor: '#ff0000', lineWidth: 2, opacity: 0.8, startHead: 'none', endHead: 'open' });
  assert.equal(perNaam.Maat.type, 'measureDistance');
  assert.equal(perNaam.Maat.props.startHead, 'open');
  assert.equal(perNaam.Vloer.type, 'measureArea');
  assert.equal(perNaam.Vloer.props.fillColor, '#ccffcc');
  assert.equal(perNaam['Type cloud'].type, 'cloud');
  assert.equal(perNaam['Type cloud'].props.cloudIntensity, 2);
  assert.equal(perNaam.Omtrek.type, 'measurePerimeter');
  assert.equal(perNaam.Omtrek.props.borderStyle, 'dashed');
  assert.equal('fillColor' in perNaam.Omtrek.props, false);
  assert.equal(perNaam.Sparing.type, 'box');
  assert.deepEqual(perNaam.Sparing.layer, { name: 'Installaties', color: null });
  assert.equal(perNaam['Type circle'].props.borderStyle, 'dotted');
});

test('geen geometrie, auteur of datum in een item', () => {
  const r = toolSetFromXfdf(xfdf(VOORBEELD), { name: 'X' });
  for (const item of r.set.items) {
    for (const k of ['x', 'y', 'startX', 'points', 'author', 'page', 'createdAt']) {
      assert.equal(k in item.props, false, `${item.name}: ${k}`);
    }
  }
});

test('markeringen met dezelfde instellingen geven één item; dubbele namen worden uniek', () => {
  const r = toolSetFromXfdf(xfdf(`
    <square page="0" rect="0,0,1,1" color="#000000" width="1" subject="Vak"/>
    <square page="0" rect="5,5,9,9" color="#000000" width="1" subject="Vak"/>
    <square page="0" rect="5,5,9,9" color="#FF0000" width="1" subject="Vak"/>`), { name: 'S' });
  assert.deepEqual(r.set.items.map((i) => i.name), ['Vak', 'Vak (2)']);
});

test('het resultaat gaat de catalogus in zoals een eigen uitwisselbestand', () => {
  const r = toolSetFromXfdf(xfdf(VOORBEELD), { name: 'Werkset' });
  const { catalog, set } = importToolSet(emptyCatalog(), r.set);
  assert.equal(catalog.sets.length, 1);
  assert.equal(set.items.length, 7);
});

test('foutgevallen: geen XFDF, geen annots, geen bruikbare markeringen', () => {
  assert.deepEqual(toolSetFromXfdf(new MiniDOMParser().parseFromString('<xfdf><annots>'), {}), { ok: false, error: 'not-xfdf' });
  assert.deepEqual(toolSetFromXfdf(new MiniDOMParser().parseFromString('<xfdf></xfdf>'), {}), { ok: false, error: 'not-xfdf' });
  assert.deepEqual(toolSetFromXfdf(null), { ok: false, error: 'not-xfdf' });
  assert.deepEqual(toolSetFromXfdf(xfdf('<text page="0" rect="0,0,1,1"/>'), {}), { ok: false, error: 'no-items' });
});

test('ongeldige waarden vallen weg in plaats van door te lekken', () => {
  const r = toolSetFromXfdf(xfdf('<square page="0" rect="0,0,1,1" color="red" width="-3" opacity="7"/>'), { name: 'S' });
  assert.deepEqual(r.set.items[0].props, {});
});
