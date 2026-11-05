// Original synthetic fixture; no third-party PDF or font content.
import {PDFDocument,PDFName} from 'pdf-lib';
import {writeFile} from 'node:fs/promises';
const pdf=await PDFDocument.create();
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
const p=pdf.addPage([100,100]);
const x=pdf.context.register(pdf.context.stream('invalid',{Type:'XObject',Subtype:'Unsupported'}));
p.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Bad:x}}));
p.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.stream('0 0 50 50 re f /Bad Do')));
await writeFile(new URL('unsupported-xobject.pdf',import.meta.url),await pdf.save({useObjectStreams:false}));
