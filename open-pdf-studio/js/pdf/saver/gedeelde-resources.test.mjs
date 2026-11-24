import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFRef, StandardFonts } from 'pdf-lib';
import { schrijfKopVoeten, verwijderKopVoetStromen } from './kopvoet.js';
import { writeWatermarkContent } from './watermark-content.js';
import { deelResourcesWeer, vasteResourceSleutel } from './gedeelde-resources.js';

const RESOURCES = PDFName.of('Resources');
const alles = (_tekst, totaal) => Array.from({ length: totaal }, (_, i) => i + 1);

const kopVoet = (extra = {}) => ({
  id: 'kv-1', type: 'headerFooter', enabled: true, pageRange: 'all', customPages: '',
  headerLeft: '', headerCenter: '', headerRight: '', footerLeft: '{filename}', footerCenter: '', footerRight: 'Page {page} of {pages}',
  fontFamily: 'Helvetica', fontSize: 9, color: '#000000', marginTop: 20, marginBottom: 20, marginLeft: 30, marginRight: 30,
  ...extra,
});

// A drawing set as CAD publishing writes it: every page points at ONE
// /Resources dictionary, by reference or inherited from the page tree.
async function tekeningenset(aantal, wijze) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const paginas = [];
  for (let i = 0; i < aantal; i++) {
    const p = pdf.addPage([1191, 842]);
    p.drawText(`Sheet ${i + 1}`, { x: 100, y: 400, size: 30, font });
    paginas.push(p);
  }
  const ref = pdf.context.register(paginas[0].node.Resources());
  for (const p of paginas) {
    if (wijze === 'reference') p.node.set(RESOURCES, ref);
    else p.node.delete(RESOURCES);
  }
  if (wijze === 'inherited') pdf.catalog.Pages().set(RESOURCES, ref);
  return PDFDocument.load(await pdf.save());
}

function fontSleutels(pdf, index = 0) {
  const res = pdf.context.lookup(pdf.getPage(index).node.getInheritableAttribute(RESOURCES), PDFDict);
  return res.lookup(PDFName.of('Font'), PDFDict).keys().map((k) => k.asString());
}

for (const wijze of ['reference', 'inherited']) {
  test(`header/footer on pages with ${wijze} shared /Resources: one font name, one shared dictionary`, async () => {
    const pdf = await tekeningenset(40, wijze);
    const voor = fontSleutels(pdf).length;
    const { streams } = await schrijfKopVoeten(pdf, [kopVoet()], { bestandsnaam: 'set.pdf', paginaBereik: alles });
    assert.equal(streams, 40);
    const opnieuw = await PDFDocument.load(await pdf.save());
    // One added name for all 40 pages, not one per page.
    assert.deepEqual(fontSleutels(opnieuw).filter((k) => k.startsWith('/OPSKV')), ['/OPSKV_kv-1']);
    assert.equal(fontSleutels(opnieuw, 39).length, voor + 1);
    // Every page still refers to one dictionary instead of carrying a copy.
    const refs = new Set(opnieuw.getPages().map((p) => {
      const r = p.node.get(RESOURCES);
      assert.ok(r instanceof PDFRef, 'Resources is a reference');
      return r.toString();
    }));
    assert.equal(refs.size, 1);
  });
}

test('the file grows linearly with the number of pages, also when saved again', async () => {
  const groei = async (aantal) => {
    const pdf = await tekeningenset(aantal, 'reference');
    const voor = (await pdf.save()).length;
    await schrijfKopVoeten(pdf, [kopVoet()], { bestandsnaam: 'set.pdf', paginaBereik: alles });
    const weer = await PDFDocument.load(await pdf.save());
    verwijderKopVoetStromen(weer, new Set(['kv-1']));
    await schrijfKopVoeten(weer, [kopVoet()], { bestandsnaam: 'set.pdf', paginaBereik: alles });
    return ((await weer.save()).length - voor) / aantal;
  };
  const perPaginaKlein = await groei(50);
  const perPaginaGroot = await groei(800);
  // Quadratic growth would make each page of the large set several times as expensive.
  assert.ok(perPaginaGroot < perPaginaKlein * 1.5, `${perPaginaKlein.toFixed(0)} vs ${perPaginaGroot.toFixed(0)} bytes per page`);
});

test('a watermark on a shared-resources set adds each resource name once', async () => {
  const pdf = await tekeningenset(30, 'reference');
  await writeWatermarkContent(pdf, [{ id: 'wm 1', type: 'textWatermark', text: 'DRAFT', fontFamily: 'Helvetica', fontSize: 40,
    color: '#ff0000', opacity: 0.3, rotation: 45, position: 'center', layer: 'behind', pageRange: 'all', enabled: true }],
  { pageRange: alles });
  const opnieuw = await PDFDocument.load(await pdf.save());
  const res = opnieuw.context.lookup(opnieuw.getPage(0).node.get(RESOURCES), PDFDict);
  assert.deepEqual(fontSleutels(opnieuw).filter((k) => k.startsWith('/OPSWM')), ['/OPSWMF_wm_1']);
  assert.deepEqual(res.lookup(PDFName.of('ExtGState'), PDFDict).keys().map((k) => k.asString()), ['/OPSWMGS_wm_1']);
  assert.equal(new Set(opnieuw.getPages().map((p) => p.node.get(RESOURCES).toString())).size, 1);
});

test('pages with their own /Resources keep them', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage();
  const eigen = pdf.getPages().map((p) => p.node.Resources());
  for (const p of pdf.getPages()) p.node.normalize();
  assert.equal(deelResourcesWeer(pdf), 0);
  pdf.getPages().forEach((p, i) => assert.equal(p.node.get(RESOURCES), eigen[i]));
});

test('resource names are valid and stable for any id', () => {
  assert.equal(vasteResourceSleutel('OPSKV', 'wm-1').asString(), '/OPSKV_wm-1');
  assert.equal(vasteResourceSleutel('OPSKV', 'a b/c#(d)').asString(), '/OPSKV_a_b_c__d_');
});
