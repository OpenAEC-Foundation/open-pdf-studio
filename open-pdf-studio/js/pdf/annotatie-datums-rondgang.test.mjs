// #1189: de popup in een PDF-lezer moet echte PDF-datums kunnen lezen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFName } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';
const { PDFDateString } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const gemaakt = '2026-11-18T09:10:11.000Z';
const gewijzigd = '2026-11-19T12:13:14.000Z';
const basis = { page: 1, author: 'Test', createdAt: gemaakt, modifiedAt: gewijzigd,
  strokeColor: '#0000ff', color: '#0000ff', opacity: 1, lineWidth: 1 };
const soorten = [
  { type: 'measureArea', points: [{x:40,y:40},{x:180,y:40},{x:180,y:140},{x:40,y:140}], measureText: '0.01 m²' },
  { type: 'box', x:40,y:40,width:140,height:100 },
  { type: 'comment', x:40,y:40,width:24,height:24, text:'Opmerking' },
];
for (const vorm of soorten) {
  test(`${vorm.type}: standaarddatums in opgeslagen PDF, ook na heropenen en opnieuw opslaan`, async()=>{
    let bytes=await opslaan(await leegBlad(), [{...basis,...vorm,id:'datum',nm:'datum'}]);
    for (let ronde=0;ronde<2;ronde++) {
      const dict=(await woordenboeken(bytes))[0].dict;
      for (const [key,expected] of [['M',gewijzigd],['CreationDate',gemaakt]]) {
        const raw=dict.get(PDFName.of(key))?.decodeText();
        assert.equal(PDFDateString.toDateObject(raw)?.toISOString(),expected,`${key}: ${raw}`);
      }
      const modellen=await laad(bytes);
      assert.equal(modellen[0].createdAt,gemaakt);
      assert.equal(modellen[0].modifiedAt,gewijzigd);
      if(!ronde) bytes=await opslaan(bytes,modellen);
    }
  });
}

test('ontbrekende of ongeldige wijzigingsdatum wordt een geldige huidige PDF-datum', async()=>{
  for(const modifiedAt of [undefined,null,'','geen datum']) {
    const begin=Math.floor(Date.now()/1000)*1000;
    const bytes=await opslaan(await leegBlad(),[{...basis,...soorten[0],id:'terugval',modifiedAt}]);
    const dict=(await woordenboeken(bytes))[0].dict;
    const datum=PDFDateString.toDateObject(dict.get(PDFName.of('M')).decodeText());
    assert.ok(datum && datum.getTime()>=begin && datum.getTime()<=Date.now());
  }
});

test('een modeldatum met tijdzone wordt als hetzelfde tijdstip geschreven', async()=>{
  const bytes=await opslaan(await leegBlad(),[{...basis,...soorten[0],id:'tijdzone',createdAt:'2026-11-18T10:10:11+01:00',modifiedAt:'2026-11-19T13:13:14+01:00'}]);
  const dict=(await woordenboeken(bytes))[0].dict;
  assert.equal(PDFDateString.toDateObject(dict.get(PDFName.of('CreationDate')).decodeText()).toISOString(),gemaakt);
  assert.equal(PDFDateString.toDateObject(dict.get(PDFName.of('M')).decodeText()).toISOString(),gewijzigd);
});
