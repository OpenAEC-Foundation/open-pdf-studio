// app_create_annotation met type 'link' (#953): dezelfde link als het venster
// maakt, uit props.uri of props.page (+ view), op een vak of op quads. De
// bouwer (link-mcp.js) is puur en wordt hier getest; de bedrading in
// mcp-bridge.js en het schema in mcp_server.rs en mcp-stdio/tools.json worden
// uit de bron gelezen (in node niet te laden).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';

import { linkUitMcp, LINK_MCP_VASTE_VELDEN } from './link-mcp.js';
import { nieuweLinkVelden } from './link-model.js';
import { buildLinkDict } from '../../pdf/saver/link-opslaan.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const VAK = { x: 10, y: 20, width: 100, height: 14 };

test('a web link on a box is the same link the dialog makes', () => {
  const r = linkUitMcp({ uri: 'openaec.org', ...VAK }, 2, 5);
  assert.equal(r.error, undefined);
  const verwacht = nieuweLinkVelden({ page: 2, vak: VAK, doel: { kind: 'uri', uri: 'https://openaec.org' } });
  assert.deepEqual(r.base, verwacht);
  assert.equal(r.base.type, 'link');
  assert.equal(r.base.page, 2, 'the placement page, not a target');
});

test('a page link: props.page is the target, with view XYZ (default), Fit or an explicit XYZ', () => {
  assert.deepEqual(linkUitMcp({ page: 3, ...VAK }, 1, 5).base.linkTarget,
    { kind: 'page', page: 3, fit: 'xyz', left: null, top: null, zoom: null });
  assert.deepEqual(linkUitMcp({ page: 3, view: 'Fit', ...VAK }, 1, 5).base.linkTarget,
    { kind: 'page', page: 3, fit: 'fit' });
  assert.deepEqual(linkUitMcp({ page: 4, view: { type: 'XYZ', left: 20, top: 700, zoom: 1.5 }, ...VAK }, 1, 5).base.linkTarget,
    { kind: 'page', page: 4, fit: 'xyz', left: 20, top: 700, zoom: 1.5 });
  assert.equal(linkUitMcp({ page: 3, ...VAK }, 1, 5).base.page, 1);
});

test('quads give one rect per text line and the box around them', () => {
  const regel1 = [{ x: 30, y: 100 }, { x: 230, y: 100 }, { x: 30, y: 114 }, { x: 230, y: 114 }];
  const regel2 = [{ x: 30, y: 120 }, { x: 120, y: 120 }, { x: 30, y: 134 }, { x: 120, y: 134 }];
  const { base } = linkUitMcp({ uri: 'https://a.nl', quads: [regel1, regel2], border: 'underline', color: '#ff0000', lineWidth: 2 }, 1, 2);
  assert.deepEqual([base.x, base.y, base.width, base.height], [30, 100, 200, 34]);
  assert.deepEqual(base.rects, [{ x: 30, y: 100, width: 200, height: 14 }, { x: 30, y: 120, width: 90, height: 14 }]);
  assert.equal(base.linkBorder, 'underline');
  assert.equal(base.color, '#ff0000');
  assert.equal(base.strokeColor, '#ff0000');
  assert.equal(base.lineWidth, 2);
});

test('invalid input gives an error and creates nothing', () => {
  const fouten = [
    [{ ...VAK }, /exactly one of props\.uri/],
    [{ uri: 'https://a.nl', page: 2, ...VAK }, /exactly one of props\.uri/],
    [{ uri: 'javascript:alert(1)', ...VAK }, /not a usable web address/],
    [{ page: 9, ...VAK }, /out of range \(doc has 5 pages\)/],
    [{ page: 0, ...VAK }, /out of range/],
    [{ page: 2, view: 'FitH', ...VAK }, /props\.view must be/],
    [{ uri: 'https://a.nl' }, /requires props\.quads or numeric props x, y/],
    [{ uri: 'https://a.nl', x: 1, y: 1, width: 0, height: 5 }, /requires props\.quads/],
    [{ uri: 'https://a.nl', quads: [[{ x: 1, y: 1 }]] }, /props\.quads must be/],
    [{ uri: 'https://a.nl', quads: [[{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }]] }, /must span an area/],
    [{ uri: 'https://a.nl', border: 'dotted', ...VAK }, /props\.border must be one of none, solid, underline/],
  ];
  for (const [props, fout] of fouten) {
    const r = linkUitMcp(props, 1, 5);
    assert.equal(r.base, undefined, JSON.stringify(props));
    assert.match(r.error, fout, JSON.stringify(props));
  }
});

test('the saver writes the MCP link as a standard /Link with /Dest to the page object', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  doc.addPage([400, 500]);
  const { base } = linkUitMcp({ page: 2, view: 'Fit', ...VAK }, 1, 2);
  const dict = buildLinkDict(doc.context, base, {
    map: (x, y) => ({ x, y: 500 - y }), paginas: doc.getPages(), flags: 4,
  });
  const dest = dict.lookup(PDFName.of('Dest')).asArray();
  assert.equal(dest[0].toString(), doc.getPage(1).ref.toString());
  assert.equal(dest[1].toString(), '/Fit');
});

test('mcp-bridge.js builds a link with link-mcp.js; props.page is the target, not the placement', () => {
  const brug = bron('../../mcp-bridge.js');
  assert.match(brug, /case 'link': \{[\s\S]{0,800}linkUitMcp\(p, page, aantal\)/);
  assert.match(brug, /case 'link': \{[\s\S]{0,800}vasteGeometrie: LINK_MCP_VASTE_VELDEN/);
  assert.match(brug, /const pageArg = params\?\.page \?\? \(type === 'link' \? undefined : props\.page\);/);
  // Invoer die geen veld van de link is, blijft niet op de annotatie staan.
  for (const k of ['uri', 'view', 'quads', 'border', 'linkTarget', 'rects']) assert.ok(LINK_MCP_VASTE_VELDEN.includes(k), k);
});

test('the tool schema names link in the type enum and describes uri, page and view', () => {
  const rs = bron('../../../src-tauri/src/mcp_server.rs');
  const blok = rs.slice(rs.indexOf('"name": "app_create_annotation"'), rs.indexOf('"name": "app_list_annotations"'));
  assert.match(blok, /"enum": \[[^\]]*"link"[^\]]*\]/);
  assert.match(blok, /link makes the same hyperlink as the Link tool/);
  const lijst = JSON.parse(bron('../../../../mcp-stdio/tools.json'));
  const tool = lijst.find((t) => t.name === 'app_create_annotation');
  assert.ok(tool.inputSchema.properties.type.enum.includes('link'));
  assert.ok(tool.inputSchema.properties.type.enum.includes('textHighlight'));
  assert.match(tool.description, /either uri \(web or e-mail address/);
  // Dezelfde tekst als in mcp_server.rs (daar met Rust-escapes).
  const m = blok.match(/"description": "((?:[^"\\]|\\.)*)"/);
  assert.equal(JSON.parse(`"${m[1]}"`), tool.description);
});
