// Bewaren en heropenen van de stramienkoppeling. De koppeling staat in de
// parameters van het symbool en reist dus met OPS_Params (PDF) en opsparams
// (XFDF) mee; er is geen eigen opslagsleutel. Deze test legt vast dat dat ook
// echt zo blijft: echte PDF-bytes erin, heropenen, dezelfde koppeling eruit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { pdfTextString } from '../pdf/saver/pdf-text.js';
import { extractAnnotationColors } from '../pdf/loader/color-extraction.js';
import { bouwConstructieplan } from '../drafting/constructie/constructieplan.js';
import { koppelingVan, zetKoppeling } from './stramien-koppeling.js';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

/** De parameters van de stramienlijnen uit een echt constructieplan. */
function planParams() {
  const r = bouwConstructieplan({
    pagina: 1, oorsprong: { x: 100, y: 100 }, veldenX: '2x5400', veldenY: [6000], schaal: '1:100',
    kolommen: false, balken: false, vloeren: false,
  }, { koppelSleutel: 'sg-rondgang' });
  return r.annotaties.filter(a => a.rol === 'stramien').map(a => a.props.params);
}

/** Schrijf parameters zoals saver.js dat doet, sla op, heropen en lees terug. */
async function rondgang(lijst) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 600]);
  const ctx = doc.context;
  const annots = lijst.map((params, i) => ctx.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [10 + i * 40, 10, 40 + i * 40, 300],
    OPS_Subtype: PDFString.of('parametricSymbol'),
    OPS_SymbolId: pdfTextString('stramien'),
    OPS_Params: pdfTextString(JSON.stringify(params)),
  }));
  pagina.node.set(PDFName.of('Annots'), ctx.obj(annots.map(a => ctx.register(a))));
  const heropend = await PDFDocument.load(await doc.save());
  const kaart = await extractAnnotationColors(1, heropend);
  return lijst.map((_, i) => kaart.get(`${10 + i * 40},10,${40 + i * 40},300`));
}

test('de koppeling uit het constructieplan overleeft opslaan en heropenen', async () => {
  const lijst = planParams();
  assert.ok(lijst.length >= 4);
  const terug = await rondgang(lijst);
  for (let i = 0; i < lijst.length; i++) {
    assert.equal(terug[i]?.opsSubtype, 'parametricSymbol');
    assert.equal(terug[i].opsSymbolId, 'stramien');
    const params = JSON.parse(terug[i].opsParams);
    assert.deepEqual(params, lijst[i]);
    const ann = { type: 'parametricSymbol', symbolId: 'stramien', params };
    assert.deepEqual(koppelingVan(ann, 'begin'), koppelingVan({ ...ann, params: lijst[i] }, 'begin'));
  }
});

test('een losgezet uiteinde blijft na heropenen los, in dezelfde groep', async () => {
  const ann = { type: 'parametricSymbol', symbolId: 'stramien', params: { ...planParams()[0] } };
  zetKoppeling(ann, 'begin', { los: true });
  zetKoppeling(ann, 'einde', { groep: 'sg-onder', los: false });
  const [terug] = await rondgang([ann.params]);
  const params = JSON.parse(terug.opsParams);
  assert.deepEqual(koppelingVan({ ...ann, params }, 'begin'), { groep: 'sg-rondgang-x', los: true });
  assert.deepEqual(koppelingVan({ ...ann, params }, 'einde'), { groep: 'sg-onder', los: false });
});

test('opslaan, laden en XFDF geven de parameters ongefilterd door', () => {
  // De opslagweg zelf is niet aangepast; deze wachters vallen om zodra iemand
  // de parameters gaat filteren en daarmee de koppeling kwijtraakt.
  const saver = lees('../pdf/saver.js');
  assert.match(saver, /OPS_Params: pdfTextString\(JSON\.stringify\(ann\.params \|\| \{\}\)\)/);
  const omzetter = lees('../pdf/loader/annotation-converter.js');
  assert.match(omzetter, /params = JSON\.parse\(extraColors\.opsParams\)/);
  const xfdf = lees('./xfdf.js');
  assert.match(xfdf, /const paramsJson = JSON\.stringify\(ann\.params \|\| \{\}\)/);
  assert.match(xfdf, /params = JSON\.parse\(raw\)/);
});
