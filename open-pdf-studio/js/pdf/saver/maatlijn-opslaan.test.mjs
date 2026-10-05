// Opslaan van een maat (measureDistance) als /Line /IT /LineDimension.
//
// Eigen maten en plattegrondmaten worden precies zo opgeslagen als vóór de
// overname van maten uit andere programma's: woordenboek én appearance zijn
// gelijk aan de vastgelegde uitvoer in ../fixtures/maatlijn-eigen-opslag.json.
// Die uitvoer is gemaakt met de ongewijzigde tak voor measureDistance uit
// saver.js (zoals die vóór deze wijziging was), letterlijk uitgevoerd.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';

import { maatlijnAnnotatie } from './maatlijn-opslaan.js';
import { PLATTEGROND_MAATSTIJL } from '../../plattegrond/maatvoering.js';

const VASTGELEGD = JSON.parse(readFileSync(new URL('../fixtures/maatlijn-eigen-opslag.json', import.meta.url), 'utf8'));

/** Woordenboek (zonder /M, de opslagtijd) en appearance als tekstregels. */
function vastleggen(annotDict, context) {
  const opVolgorde = (paren) => paren.map(([k, v]) => [k.toString(), v]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const regels = [];
  for (const [k, v] of opVolgorde(annotDict.entries())) {
    if (k === '/M' || k === '/AP') continue;
    regels.push(`${k} ${v.toString()}`);
  }
  const ap = annotDict.get(PDFName.of('AP'));
  if (ap) {
    const n = context.lookup(context.lookup(ap).get(PDFName.of('N')));
    for (const [k, v] of opVolgorde(n.dict.entries())) regels.push(`AP${k} ${v.toString()}`);
    regels.push(...Buffer.from(n.getContents()).toString('latin1').split('\n').map((r) => `AP| ${r}`));
  }
  return regels;
}

const GEVALLEN = {
  'eigen maat met schaal en hulplijnen': {
    type: 'measureDistance', startX: 100, startY: 200, endX: 300, endY: 200,
    leaderStartX: 100, leaderStartY: 240, leaderEndX: 300, leaderEndY: 240,
    strokeColor: '#ff0000', color: '#ff0000', lineWidth: 1, startHead: 'closed', endHead: 'closed', headSize: 12,
    measureText: '2000 mm', measureScale: 10, measureUnit: 'mm', measurePrecision: 0, author: 'User', opacity: 1,
  },
  'plattegrondmaat': {
    type: 'measureDistance', ...PLATTEGROND_MAATSTIJL,
    startX: 50, startY: 400, endX: 320, endY: 400,
    leaderStartX: 50, leaderStartY: 460, leaderEndX: 320, leaderEndY: 460,
    dimOvershootEnds: 'start', opsKettingId: 'ketting-1', opsMaatRol: 'chain',
    measureText: '1550 mm', measureScale: 5.74, measureUnit: 'mm', author: 'User',
  },
  'staande eigen maat met versleepte tekst': {
    type: 'measureDistance', startX: 400, startY: 100, endX: 400, endY: 300,
    strokeColor: '#0000ff', lineWidth: 0.5, startHead: 'openCircle', endHead: 'openCircle', headSize: 8,
    measureText: '200 mm', textOffsetX: 5, textOffsetY: -3, fontSize: 7, author: 'Tekenaar',
  },
  'schuine maat uit een oud bestand': {
    type: 'measureDistance', startX: 10, startY: 10, endX: 90, endY: 70,
    strokeColor: '#ff0000', lineWidth: 1, headSize: 12, measureText: '100 mm', opacity: 0.8,
  },
  'eigen maat met lijndikte 0 en dimExtension uit': {
    type: 'measureDistance', startX: 100, startY: 500, endX: 250, endY: 500,
    leaderStartX: 100, leaderStartY: 480, leaderEndX: 250, leaderEndY: 480,
    strokeColor: '#00aa00', lineWidth: 0, startHead: 'open', endHead: 'closed', headSize: 10,
    dimExtension: false, measureText: '150', dimShowUnit: false,
  },
};

/** Opslaan zoals saver.js: x ongewijzigd, y omgeklapt op een pagina van 792 hoog. */
async function opgeslagen(ann) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const context = doc.context;
  const annotDict = maatlijnAnnotatie({
    ann, context, convertX: (x) => x, convertY: (y) => 792 - y,
    opacity: ann.opacity !== undefined ? ann.opacity : 1, borderWidth: ann.lineWidth ?? 2,
  });
  return vastleggen(annotDict, context);
}

for (const [naam, ann] of Object.entries(GEVALLEN)) {
  test(`${naam}: opgeslagen zoals altijd`, async () => {
    assert.deepEqual(await opgeslagen(ann), VASTGELEGD[naam]);
  });
}

test('saver.js slaat een maat op met maatlijnAnnotatie', () => {
  const bron = readFileSync(new URL('../saver.js', import.meta.url), 'utf8');
  assert.ok(bron.includes('annotDict = maatlijnAnnotatie({'), 'de tak voor measureDistance');
});
