import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, decodePDFRawStream } from 'pdf-lib';
import { opslaan, laad, woordenboeken, state } from './rondgang.testhulp.mjs';
import { veelhoekUitPunten, veelhoekPuntenOpScherm } from '../annotations/veelhoek-punten.js';

const nodes = [
  { x: 80, y: 180, outgoing: { x: 95, y: 10 } },
  { x: 320, y: 170, incoming: { x: 280, y: 35 }, outgoing: { x: 360, y: 210 } },
  { x: 220, y: 330, incoming: { x: 260, y: 290 } },
  { x: 70, y: 300, outgoing: { x: 0, y: 240 } },
];
const common = { id: 'bezier', page: 1, color: '#ff0000', strokeColor: '#ff0000',
  lineWidth: 3, borderStyle: 'solid', opacity: 1, author: 'User', fillColor: null };
function same(actual, expected) {
  assert.equal(actual.length, expected.length, 'the editable nodes, not sampled fallback vertices');
  actual.forEach((a, i) => {
    for (const key of [null, 'incoming', 'outgoing']) {
      const p = key ? a[key] : a, q = key ? expected[i][key] : expected[i];
      assert.equal(!!p, !!q, `node ${i}: ${key}`);
      if (p) for (const axis of ['x','y']) assert.ok(Math.abs(p[axis]-q[axis])<0.002, `${i}.${key}.${axis}: ${p[axis]} != ${q[axis]}`);
    }
  });
}
for (const type of ['polyline','polygon']) for (const rotation of [0,90,180,270]) {
  test(`${type} cubic handles survive two saves on CropBox/page rotation ${rotation}`, async () => {
    const pdf = await PDFDocument.create(); const page=pdf.addPage([700,900]);
    page.setCropBox(40,30,600,800); page.node.set(PDFName.of('Rotate'),pdf.context.obj(rotation));
    let bytes=await pdf.save();
    let model = type==='polygon' ? { ...common, type, ...veelhoekUitPunten(nodes), rotation: 31, fillColor:'#00ff00' }
      : { ...common, type, points:structuredClone(nodes) };
    const expected = type==='polygon' ? veelhoekPuntenOpScherm(model) : model.points;
    for(let round=0;round<2;round++) {
      bytes=await opslaan(bytes,[model]);
      const ds=await woordenboeken(bytes); assert.equal(ds.length,1);
      const dict=ds[0].dict;
      assert.ok(dict.lookup(PDFName.of('Vertices')).size()>nodes.length*2,'standard vertices approximate the curve for other editors');
      const ap=dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
      const text=new TextDecoder().decode(decodePDFRawStream(ap).decode());
      assert.match(text,/ c\s/,'exact cubic PDF appearance');
      const loaded=await laad(bytes); assert.equal(loaded.length,1);model=loaded[0];
      assert.equal(model.type,type);
      same(type==='polygon'?veelhoekPuntenOpScherm(model):model.points,expected);
    }
    // Editing only a handle must invalidate reuse of the original appearance.
    const before=type==='polygon'?veelhoekPuntenOpScherm(model):structuredClone(model.points);
    model.points[0].outgoing.x+=17;
    bytes=await opslaan(bytes,[model]);
    const [edited]=await laad(bytes);
    const after=type==='polygon'?veelhoekPuntenOpScherm(edited):edited.points;
    assert.ok(Math.abs(after[0].outgoing.x-before[0].outgoing.x)>1,'a control-only edit is saved');
  });
}

for (const mutation of ['malformed','version','nonfinite','wrong-closure','changed-vertices','oversized']) {
  test(`untrusted ${mutation} metadata falls back to standard vertices`, async () => {
    const pdf=await PDFDocument.create();pdf.addPage([600,800]);
    let bytes=await opslaan(await pdf.save(),[{...common,type:'polyline',points:structuredClone(nodes)}]);
    const ds=await woordenboeken(bytes);const dict=ds[0].dict;
    const name=PDFName.of('OPS_BezierContour');const meta=JSON.parse(dict.lookup(name).decodeText());
    let raw;
    if(mutation==='malformed')raw='{';
    if(mutation==='version')raw=JSON.stringify({...meta,version:999});
    if(mutation==='nonfinite'){meta.nodes[0].incoming={x:'Infinity',y:0};raw=JSON.stringify(meta);}
    if(mutation==='wrong-closure')raw=JSON.stringify({...meta,closed:true});
    if(mutation==='changed-vertices'){
      const vertices=dict.lookup(PDFName.of('Vertices'));vertices.set(0,ds.doc.context.obj(vertices.lookup(0).asNumber()+10));
      raw=JSON.stringify(meta);
    }
    if(mutation==='oversized')raw=' '.repeat(2_000_001);
    dict.set(name,PDFString.of(raw));bytes=await ds.doc.save();
    const [loaded]=await laad(bytes);
    assert.equal(loaded.type,'polyline');assert.ok(loaded.points.length>nodes.length);
    assert.ok(loaded.points.every(p=>!p.incoming&&!p.outgoing));
  });
}

test('closed polygon endpoint handles, reflection and hatch clipping retain exact cubics',async()=>{
  const pts=structuredClone(nodes);pts[0].incoming={x:40,y:110};
  const pdf=await PDFDocument.create();pdf.addPage([600,800]);
  const model={...common,type:'polygon',...veelhoekUitPunten(pts),rotation:23,flipX:true,
    fillColor:'#00ff00',fillOpacity:0.3,hatchPattern:'ansi31',hatchScale:100};
  const expected=veelhoekPuntenOpScherm(model);
  const bytes=await opslaan(await pdf.save(),[model]);const [loaded]=await laad(bytes);
  same(veelhoekPuntenOpScherm(loaded),expected);
  const ds=await woordenboeken(bytes);const stream=ds[0].dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const ap=new TextDecoder().decode(decodePDFRawStream(stream).decode());
  assert.match(ap,/ c\s[\s\S]*?h\s+W n/,'the hatch clips to the curved closed path');
});

for (const type of ['polyline','polygon']) {
  test(`${type}: incremental save appends the edited handles and preserves private source keys`, async () => {
    const pdf=await PDFDocument.create();pdf.addPage([600,800]);
    const model=type==='polygon'?{...common,type,...veelhoekUitPunten(nodes)}:{...common,type,points:structuredClone(nodes)};
    let bytes=await opslaan(await pdf.save(),[model]);
    const ds=await woordenboeken(bytes);ds[0].dict.set(PDFName.of('VendorNote'),PDFString.of('keep this'));
    bytes=await ds.doc.save();
    const [loaded]=await laad(bytes);loaded.points[0].outgoing.y+=21;
    const expected=type==='polygon'?veelhoekPuntenOpScherm(loaded):structuredClone(loaded.points);
    const old=state.preferences.incrementalSave;
    try {
      state.preferences.incrementalSave=true;
      const saved=await opslaan(bytes,[loaded]);
      assert.deepEqual(saved.slice(0,bytes.length),bytes,'original bytes are unchanged');
      const [again]=await laad(saved);same(type==='polygon'?veelhoekPuntenOpScherm(again):again.points,expected);
      const dictionaries=await woordenboeken(saved);assert.equal(dictionaries.length,1);
      assert.equal(dictionaries[0].dict.lookup(PDFName.of('VendorNote')).decodeText(),'keep this');
    } finally {state.preferences.incrementalSave=old;}
  });
}

test('mirrored curve uses the same boundary for solid fill and hatch clipping',async()=>{
  const pdf=await PDFDocument.create();pdf.addPage([600,800]);
  const model={...common,type:'polygon',...veelhoekUitPunten(nodes),flipX:true,
    fillColor:'#00ff00',hatchPattern:'ansi31',hatchScale:100};
  const bytes=await opslaan(await pdf.save(),[model]);const ds=await woordenboeken(bytes);
  const stream=ds[0].dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const ap=new TextDecoder().decode(decodePDFRawStream(stream).decode());
  const paths=ap.match(/[+-]?[\d.]+ [+-]?[\d.]+ m\n(?:[^\n]*\n)*?h\n/g);
  assert.ok(paths.length>=2);assert.equal(paths[0],paths[1]);
});
