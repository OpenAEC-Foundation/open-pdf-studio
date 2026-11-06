// app_create_annotation met type 'textHighlight' en props.quads (#946).
//
// De bouwer in mcp-bridge.js gebruikt tekstMarkeringUitQuads; die is puur en
// wordt hier getest, samen met hoe de saver het resultaat schrijft. De
// bedrading in mcp-bridge.js en het schema in mcp_server.rs worden uit de
// bron gelezen (beide zijn in node niet te laden).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';

import { tekstMarkeringUitQuads, vlakQuad } from './markering-quads.js';
import { makePointMapper } from '../pdf/saver/correction-dicts.js';
import { buildTextMarkupDict } from '../pdf/saver/text-markup-dict.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const RECHT = [{ x: 10, y: 20 }, { x: 60, y: 20 }, { x: 10, y: 28 }, { x: 60, y: 28 }];

test('rechte quad: vakken en leesrichting, geen eigen quads (zoals de selectie)', () => {
  const m = tekstMarkeringUitQuads([RECHT]);
  assert.equal(m.quads, undefined);
  assert.deepEqual(m.rects, [{ x: 10, y: 20, width: 50, height: 8 }]);
  assert.deepEqual(m.quadPoints, [[10, 20, 60, 20, 10, 28, 60, 28]]);
  assert.deepEqual([m.x, m.y, m.width, m.height], [10, 20, 50, 8]);
  assert.equal(m.textDir, 0);
  // Staande tekst, van onder naar boven gelezen.
  const staand = [{ x: 20, y: 60 }, { x: 20, y: 10 }, { x: 28, y: 60 }, { x: 28, y: 10 }];
  assert.equal(tekstMarkeringUitQuads([staand]).textDir, 270);
});

test('gedraaide quad: de quads blijven, vakken zijn de omhullenden', () => {
  const q = vlakQuad({ x: 100, y: 100, width: 60, height: 10, rotation: 30 });
  const m = tekstMarkeringUitQuads([q, RECHT]);
  assert.equal(m.quads.length, 2);
  assert.equal(m.rects.length, 2);
  assert.equal(m.textDir, undefined);
  assert.ok(m.rects[0].height > 10, 'het vak van een schuine quad is groter');
});

test('ongeldige quads geven null', () => {
  for (const fout of [undefined, [], [[]], [RECHT.slice(0, 3)], [[...RECHT, { x: 1, y: 1 }]], [[RECHT[0], RECHT[1], RECHT[2], { x: 'a', y: 1 }]]]) {
    assert.equal(tekstMarkeringUitQuads(fout), null, JSON.stringify(fout));
  }
});

test('de saver schrijft de quads zoals ze binnenkwamen (in PDF-ruimte)', async () => {
  const doc = await PDFDocument.create();
  const map = makePointMapper(0, { x: 0, y: 0, width: 612, height: 792 });
  const q = vlakQuad({ x: 100, y: 100, width: 60, height: 10, rotation: 30 });
  for (const quads of [[RECHT], [q]]) {
    const ann = { type: 'textHighlight', ...tekstMarkeringUitQuads(quads), color: '#FFFF00', opacity: 0.3 };
    const d = buildTextMarkupDict(doc.context, ann, map, { opacity: 0.3, pageRot: 0 });
    const getallen = d.lookup(PDFName.of('QuadPoints')).asArray().map((v) => v.asNumber());
    const verwacht = quads[0].flatMap((p) => [p.x, 792 - p.y]);
    getallen.forEach((v, i) => assert.ok(Math.abs(v - verwacht[i]) < 1e-3, `getal ${i}: ${v} vs ${verwacht[i]}`));
  }
});

test('mcp-bridge.js bouwt textHighlight uit de quads en houdt die geometrie vast', () => {
  const brug = bron('../mcp-bridge.js');
  assert.match(brug, /case 'textHighlight': \{[\s\S]{0,1500}tekstMarkeringUitQuads\(quads\)/);
  assert.match(brug, /case 'textHighlight': \{[\s\S]{0,800}requires props\.quads/);
  // Zowel app_create_annotation als het plaatsen van een uitkomst nemen de
  // geometrie uit de bouwer over.
  assert.equal((brug.match(/if \(built\.vasteGeometrie\) \{/g) || []).length, 2);
});

test('mcp_server.rs noemt textHighlight in het type-enum en beschrijft quads', () => {
  const rs = bron('../../src-tauri/src/mcp_server.rs');
  const blok = rs.slice(rs.indexOf('"name": "app_create_annotation"'), rs.indexOf('"name": "app_list_annotations"'));
  assert.match(blok, /"enum": \[[^\]]*"textHighlight"[^\]]*\]/);
  assert.match(blok, /textHighlight is a real text highlight and needs quads:\[\[ul,ur,ll,lr\],\.\.\.\]/);
});
