// Verificatie issue #209: afbeeldingen/stempels als rijen mét thumbnail-kolom,
// engine-doorvoer, tabel-omzetting (canvas-cel = data-URL) en CSV-placeholder.
import { fieldByKey, fieldsForCategories } from './categories.js';
import { buildSchedule } from './engine.js';
import { scheduleResultToTable, formatCell, isImageCell } from './schedule-templates.js';
import { scheduleResultToCsv } from './schedule-csv.js';

let ok = true;
function check(cond, msg) { if (!cond) { ok = false; console.error('FAIL:', msg); } else { console.log('ok  :', msg); } }
function eq(a, b, msg) { check(a === b, `${msg} (verwacht ${JSON.stringify(b)}, kreeg ${JSON.stringify(a)})`); }

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA',  // korte fake data-URL
      SVG = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

const els = [
  { type: 'image', page: 1, imageData: PNG, linkedPath: 'C:/tekeningen/gevel.png', originalWidth: 200, originalHeight: 120 },
  { type: 'image', page: 2, imageData: PNG, linkedPath: 'detail.png', originalWidth: 50, originalHeight: 50 },
  { type: 'stamp', page: 1, imageData: SVG, stampName: 'Goedgekeurd' },
  { type: 'measureArea', page: 1, measureValue: 5 }, // andere categorie: mag NIET meekomen
];

// A. thumbnail-veld bestaat voor beide beeld-categorieën en levert de data-URL
const thumbImg = fieldByKey(['image'], 'thumbnail');
const thumbSym = fieldByKey(['symbol'], 'thumbnail');
check(!!thumbImg, 'thumbnail-veld bestaat voor image');
check(!!thumbSym, 'thumbnail-veld bestaat voor symbol');
eq(thumbImg.kind, 'image', 'thumbnail kind = image');
eq(thumbImg.get(els[0]), PNG, 'thumbnail image → imageData data-URL');
eq(thumbSym.get(els[2]), SVG, 'thumbnail stamp → imageData data-URL');
eq(fieldByKey(['image'], 'imageName').get(els[0]), 'gevel.png', 'imageName uit linkedPath-basename');
eq(fieldByKey(['symbol'], 'imageName') ? null : 'n/a', 'n/a', 'imageName is image-only (symbol gebruikt symbolId)');

// B. engine neemt de beeldrijen mee en beeldkolom telt niet mee
const r = buildSchedule(els, {
  categories: ['image', 'symbol'],
  fields: ['thumbnail', 'imageName', 'page', 'count'],
  sort: [{ field: 'page', dir: 'asc', group: true, header: true, footer: true }],
  itemize: true,
});
eq(r.count, 3, '3 beeld/stempel-rijen (measureArea uitgesloten)');
const thumbCol = r.columns.find(c => c.key === 'thumbnail');
check(!!thumbCol, 'thumbnail is een kolom in het resultaat');
eq(thumbCol.total, false, 'beeldkolom telt niet mee in totalen');
const firstRow = r.groups.flatMap(g => g.rows).find(x => x.el.type === 'image');
eq(firstRow.vals.thumbnail, PNG, 'rij bevat data-URL als thumbnail-waarde');

// C. tabel-omzetting: canvas-cel voor thumbnail = rauwe data-URL (renderer detecteert data:)
const table = scheduleResultToTable(r, 'Beelden');
const thumbIdx = r.columns.findIndex(c => c.key === 'thumbnail');
const bodyRow = table.rows.find(row => row.cells && isImageCell(row.cells[thumbIdx]));
check(!!bodyRow, 'tabel bevat minstens één beeld-cel (data-URL) voor de canvas-renderer');
eq(formatCell(PNG, thumbCol), PNG, 'formatCell geeft beeldkolom rauw door');

// D. CSV: geen enorme data-URL maar een placeholder
const csv = scheduleResultToCsv(r);
// Zonder geïnjecteerde vertaal-resolver valt de placeholder terug op Engels.
check(csv.includes('[image]'), 'CSV bevat [image]-placeholder');
check(!csv.includes('data:image'), 'CSV bevat GEEN rauwe data-URL');
check(csv.includes('gevel.png'), 'CSV bevat de bestandsnaam-kolom');

console.log(ok ? '\nOK — alle schedule-image-checks geslaagd' : '\nGEFAALD');
process.exit(ok ? 0 : 1);
