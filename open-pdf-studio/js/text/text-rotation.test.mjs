import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, degrees } from 'pdf-lib';
import * as mupdf from 'mupdf';
import { textEditScreenRotation, textEditLineAnchor, applyPageRotation } from './text-edit-appearance.js';
register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('../pdf/saver/text-edits.js');
const near = (a,b) => assert.ok(Math.abs(a-b)<0.001, `${a} != ${b}`);

for (const pageAngle of [0, 90, 180, 270]) {
  for (const textAngle of [0, 90, 270, 37.5, -22.5]) {
    test(`save/reopen preserves ${textAngle} degrees on /Rotate ${pageAngle}`, async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([595,842]).setRotation(degrees(pageAngle));
      const edit = { id:'rotation', page:1, originalText:'', newText:'Angle\nNext',
        pdfX:250, pdfY:420, fontSize:16, lineSpacing:20, fontFamily:'Helvetica',
        color:'#000000', textAngle };
      await saveTextEditsToPages(pdf,pdf.getPages(),{textEdits:[edit]});
      const bytes = await pdf.save();
      const reopened = mupdf.Document.openDocument(bytes,'application/pdf');
      const page = reopened.loadPage(0);
      const text = page.toStructuredText();
      assert.match(text.asText(), /Angle/);
      const lines=[], origins=[];
      text.walk({beginLine: (_bbox,_wmode,dir) => lines.push(dir),
        onChar: (c,origin) => { if (c==='A' || c==='N') origins.push(origin); } });
      for (let i=0;i<2;i++) {
        const anchor=textEditLineAnchor(250,420,i,20,textAngle);
        const point=applyPageRotation(anchor.x,842-anchor.y,595,842,pageAngle);
        near(origins[i][0],point.x);near(origins[i][1],point.y);
      }
      const expected=(pageAngle-textAngle)*Math.PI/180;
      near(lines[0][0],Math.cos(expected));
      near(lines[0][1],Math.sin(expected));
      assert.equal(lines.length,2);
      text.destroy();page.destroy();reopened.destroy();
      const rotation=textEditScreenRotation(pageAngle,textAngle);
      near(rotation.rotationC,-Math.sin(expected));near(rotation.rotationD,Math.cos(expected));
      const anchor=textEditLineAnchor(edit.pdfX,edit.pdfY,0,20,textAngle);
      assert.deepEqual(anchor,{x:250,y:420});
    });
  }
}
