import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { textItemsToBoxes, recoverLayout, recoverDrawingLayout, spreadsheetCurrency, spreadsheetNumber } from './office-layout.js';
import { buildOdt, buildXlsx } from './office-files.js';
import { unzip } from '../bcf/bcf-zip.js';

const box = (text, x, y, width = 35) => ({ text, x, y, width, height: 10 });
const fixture = [box('Schedule & quantities', 20, 10, 200),
  box('Code', 20, 40), box('Description', 120, 40, 70), box('Area', 260, 40),
  box('0012', 20, 55), box('Room <A>', 120, 55, 60), box('12,50', 260, 55),
  box('0013', 20, 70), box('25,75', 260, 70),
  box('Notes after table', 20, 110, 200)];
const pages = [{ number: 3, width: 595, height: 842, blocks: recoverLayout(fixture) }];
async function entries(bytes) {
  const files = await unzip(bytes);
  return files;
}
const string = value => new TextDecoder().decode(value);

test('table recovery preserves rows, columns, blank cells and surrounding paragraphs', () => {
  assert.deepEqual(pages[0].blocks, [
    { type: 'paragraph', text: 'Schedule & quantities' },
    { type: 'table', rows: [['Code', 'Description', 'Area'], ['0012', 'Room <A>', '12,50'], ['0013', '', '25,75']] },
    { type: 'paragraph', text: 'Notes after table' },
  ]);
});

test('separated tables do not merge across a large vertical gap', () => {
  const rows = [0, 15, 90, 105].flatMap(y => [box('a', 0, y), box('b', 100, y)]);
  assert.equal(recoverLayout(rows).filter(b => b.type === 'table').length, 2);
});

test('schedule rows keep four columns, wrapped descriptions and section rows', () => {
  const schedule = [
    box('Omschrijving', 157, 10, 70), box('Aantal', 341, 10, 32),
    box('Eenheid', 392, 10, 41), box('Totaal', 450, 10, 40),
    box('00. Algemeen', 157, 35, 75),
    box('Tekenkosten', 157, 60, 64), box('1', 384, 60, 5),
    box('pst', 431, 60, 15), box('€', 466, 60, 7), box('1.200,00', 476, 60, 46),
    box('Afwerken en laswerk waterdicht', 157, 90, 160),
    box('60', 375, 97, 14), box('uur', 430, 97, 17),
    box('€', 465, 97, 7), box('3.960,00', 475, 97, 47),
    box('maken bovenop onderbouw', 157, 104, 140),
  ];
  assert.deepEqual(recoverLayout(schedule).find(block => block.type === 'table').rows, [
    ['Omschrijving', 'Aantal', 'Eenheid', 'Totaal'],
    ['00. Algemeen', '', '', ''],
    ['Tekenkosten', '1', 'pst', '€ 1.200,00'],
    ['Afwerken en laswerk waterdicht maken bovenop onderbouw', '60', 'uur', '€ 3.960,00'],
  ]);
});

test('bullet lists remain text instead of false two-column tables', () => {
  const bullets = [0, 16, 32].flatMap((y, i) => [box('-', 20, y, 4), box(`Item ${i + 1}`, 40, y, 50)]);
  assert.deepEqual(recoverLayout(bullets), [
    { type: 'paragraph', text: '- Item 1' },
    { type: 'paragraph', text: '- Item 2' },
    { type: 'paragraph', text: '- Item 3' },
  ]);
});

test('ODT joins wrapped prose and bullet continuations without merging separate bullets', () => {
  const lines = [
    box('Dank voor uw aanvraag,', 20, 10, 120),
    box('wij sturen de offerte.', 20, 24, 120),
    box('-', 38, 50, 4), box('Waterdicht aansluiten van', 56, 50, 130),
    box('het bestaande casco.', 56, 64, 110),
    box('-', 38, 78, 4), box('Nieuwe alinea.', 56, 78, 100),
  ];
  assert.deepEqual(recoverLayout(lines, { joinParagraphs: true }), [
    { type: 'paragraph', text: 'Dank voor uw aanvraag, wij sturen de offerte.' },
    { type: 'paragraph', text: '- Waterdicht aansluiten van het bestaande casco.' },
    { type: 'paragraph', text: '- Nieuwe alinea.' },
  ]);
});

test('PDF text positions follow the viewport transform', () => {
  const boxes = textItemsToBoxes([{ str: 'Text', transform: [12, 0, 0, 12, 20, 700], width: 30 }],
    { scale: 1, transform: [1, 0, 0, -1, 0, 842] });
  assert.deepEqual(boxes, [{ text: 'Text', x: 20, y: 130, width: 30, height: 12 }]);
});

test('numeric conversion is locale-aware and preserves identifiers and formulas', () => {
  assert.equal(spreadsheetNumber('1.234,50', ','), 1234.5);
  assert.equal(spreadsheetNumber('1,234.50', '.'), 1234.5);
  assert.equal(spreadsheetNumber('-12,5', ','), -12.5);
  for (const text of ['0012', '1234567890123456', '=SUM(A1:A2)', '+cmd', '1,23.45', '1.2.3', '']) {
    assert.equal(spreadsheetNumber(text, '.'), null, text);
  }
  assert.equal(spreadsheetCurrency('€ 94.000,00', ','), 94000);
  assert.equal(spreadsheetCurrency('-€ 1.234,50', ','), -1234.5);
  assert.equal(spreadsheetCurrency('€ =SUM(A1:A2)', ','), null);
});

test('a schedule without a header converts its first row and formats currency', async () => {
  const files = await entries(buildXlsx([{ number: 2, blocks: [{ type: 'table', rows: [
    ['Stalen bak', '1', 'pst', '€ 94.000,00'],
    ['Omloop', '1', 'pst', '€ 9.140,00'],
  ] }] }], { decimal: ',' }));
  const sheet = string(files.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /r="B1" s="0"><v>1<\/v>/);
  assert.match(sheet, /r="D1" s="17"><v>94000<\/v>/);
  assert.match(sheet, /r="D2" s="17"><v>9140<\/v>/);
  assert.ok(!sheet.includes('state="frozen"'));
  assert.ok(!sheet.includes('<autoFilter'));
  assert.match(string(files.get('xl/styles.xml')), /numFmtId="179" formatCode="&quot;€&quot; #,##0.00"/);
});

test('XLSX contains numeric amounts, string identifiers, escaped text and usable formatting', async () => {
  const files = await entries(buildXlsx(pages, { title: 'Test & export', decimal: ',' }));
  const sheet = string(files.get('xl/worksheets/sheet1.xml'));
  assert.match(sheet, /r="C2" s="3"><v>12.5<\/v>/);
  assert.match(sheet, /r="A2"[^>]+t="inlineStr"[^]*?0012/);
  assert.match(sheet, /Room &lt;A&gt;/);
  assert.match(string(files.get('xl/styles.xml')), /numFmtId="165" formatCode="0.00"/);
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /autoFilter ref="A1:C3"/);
  assert.match(string(files.get('xl/worksheets/sheet2.xml')), /Schedule &amp; quantities/);
  assert.match(string(files.get('docProps/core.xml')), /Test &amp; export/);
});

test('spreadsheet text beginning with = stays literal, never executable', async () => {
  const files = await entries(buildXlsx([{ number: 1, blocks: [{ type: 'table', rows: [['Header'], ['=HYPERLINK("https://example.com")']] }] }]));
  const sheet = string(files.get('xl/worksheets/sheet1.xml'));
  assert.ok(sheet.includes('=HYPERLINK'));
  assert.ok(!sheet.includes('<f>'));
  assert.match(sheet, /r="A2"[^>]+t="inlineStr"/);
});

test('ODT has a first, uncompressed mimetype, editable tables and page breaks', async () => {
  const bytes = buildOdt([...pages, { number: 4, blocks: [{ type: 'paragraph', text: 'Second\nline  spaced' }] }]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(string(bytes.slice(30, 38)), 'mimetype');
  const files = await entries(bytes);
  assert.equal(string(files.get('mimetype')), 'application/vnd.oasis.opendocument.text');
  const content = string(files.get('content.xml'));
  assert.match(content, /<table:table-header-rows>/);
  assert.match(content, /Room &lt;A&gt;/);
  assert.match(content, /PageHeading/);
  assert.match(content, /<text:line-break\/>/);
  assert.match(content, /<text:s text:c="2"\/>/);
  assert.match(string(files.get('META-INF/manifest.xml')), /styles.xml/);
});

test('ODT gives descriptions more width and does not bold a data row as a header', async () => {
  const files = await entries(buildOdt([{ number: 1, blocks: [{ type: 'table', rows: [
    ['Stalen bak 27 x 6,5 meter', '1', 'pst', '€ 94.000,00'],
    ['Omloop 3 zijden thermisch verzinkt', '1', 'pst', '€ 9.140,00'],
  ] }] }]));
  const content = string(files.get('content.xml'));
  assert.ok(!content.includes('<table:table-header-rows>'));
  const widths = [...content.matchAll(/style:column-width="([\d.]+)cm"/g)].map(match => Number(match[1]));
  assert.equal(widths.length, 4);
  assert.ok(widths[0] > widths[1] * 2);
  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - 17) < 0.01);
});

test('scan image is included in ODT and its manifest', async () => {
  const files = await entries(buildOdt([{ number: 1, width: 500, height: 800, blocks: [], image: new Uint8Array([1, 2, 3]), emptyMessage: 'Run OCR' }]));
  assert.deepEqual(files.get('Pictures/page-1.png'), new Uint8Array([1, 2, 3]));
  assert.match(string(files.get('META-INF/manifest.xml')), /manifest:media-type="image\/png"/);
  assert.match(string(files.get('content.xml')), /Run OCR/);
});

test('actual PDF text extraction reconstructs a schedule table', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const page = source.addPage([595, 842]);
  for (const item of fixture) page.drawText(item.text, { x: item.x, y: 842 - item.y - 10, size: 10, font });
  const pdf = await getDocument({ data: await source.save(), useSystemFonts: true }).promise;
  try {
    const page = await pdf.getPage(1);
    const text = await page.getTextContent();
    for (const rotation of [0, 90, 180, 270]) {
      const blocks = recoverLayout(textItemsToBoxes(text.items, page.getViewport({ scale: 1, rotation })));
      assert.deepEqual(blocks.find(b => b.type === 'table').rows, pages[0].blocks[1].rows, `rotation ${rotation}`);
    }
  } finally { await pdf.loadingTask.destroy(); }
});

test('ODT export of a real text PDF retains flowing paragraphs and the budget table', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const source = Uint8Array.from(readFileSync(new URL('../../../test pdf-bestanden/Originele bestanden/Tekst.pdf', import.meta.url)));
  const pdf = await getDocument({ data: source, isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const blocks = recoverLayout(textItemsToBoxes(content.items, viewport), { joinParagraphs: true });
    assert.ok(blocks.some(block => block.type === 'paragraph'
      && block.text.includes('bouwen, leveren en assembleren')
      && block.text.endsWith('drijvende woning.')));
    assert.ok(blocks.some(block => block.type === 'paragraph'
      && block.text === '- Waterdicht aansluiten van het bestaande casco op het nieuwe casco.'));
    assert.deepEqual(blocks.find(block => block.type === 'table' && block.rows[0]?.[0] === 'Omschrijving').rows.length, 4);
  } finally { await pdf.loadingTask.destroy(); }
});

test('XLSX isolates a ten-row schedule from unrelated text on a real drawing', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const source = Uint8Array.from(readFileSync(new URL('../../../test pdf-bestanden/Originele bestanden/Technische tekening.pdf', import.meta.url)));
  const pdf = await getDocument({ data: source, isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const blocks = recoverDrawingLayout(textItemsToBoxes(content.items, viewport), viewport.width, viewport.height);
    const schedule = blocks.find(block => block.type === 'table' && block.rows[0]?.[0] === 'Groepsnummer');
    assert.ok(schedule, 'group schedule found');
    assert.deepEqual(schedule.rows, [
      ['Groepsnummer', 'H.O.H.', 'Lengte'],
      ['groep 01.01', '150 mm.', '92 meter'],
      ['groep 01.02', '150 mm.', '99 meter'],
      ['groep 01.03', '150 mm.', '87 meter'],
      ['groep 01.04', '100 mm.', '71 meter'],
      ['groep 01.05', '150 mm.', '42 meter'],
      ['groep 01.06', '150 mm.', '100 meter'],
      ['groep 01.07', '150 mm.', '92 meter'],
      ['groep 01.08', '150 mm.', '96 meter'],
      ['Verdeler 01', 'Totaal:', '679 meter'],
    ]);
    const files = await entries(buildXlsx([{ number: 1, blocks }]));
    const sheets = [...files].filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(([, bytes]) => string(bytes));
    const sheet = sheets.find(xml => xml.includes('Groepsnummer'));
    assert.ok(sheet, 'schedule sheet created');
    assert.match(sheet, /dimension ref="A1:C10"/);
  } finally { await pdf.loadingTask.destroy(); }
});

test('large worksheets do not exceed the JavaScript argument limit while measuring columns', () => {
  const rows = [['Value'], ...Array.from({ length: 150000 }, () => ['1'])];
  const bytes = buildXlsx([{ number: 1, blocks: [{ type: 'table', rows }] }]);
  assert.ok(bytes.length > 150000);
});
