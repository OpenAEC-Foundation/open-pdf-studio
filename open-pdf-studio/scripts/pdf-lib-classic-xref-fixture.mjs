// Niet-lege synthetische fixture voor #1246; geen gebruikersdocumenten.
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
export async function classicFixture() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) doc.addPage([300, 400]).drawText(`Classic XRef recovery page ${i + 1}`, { x: 20, y: 300, size: 14 });
  const note = PDFRef.of(90, 7);
  doc.context.assign(note, doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [20, 100, 80, 160], C: [1, 0, 0], F: 4 }));
  doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([note]));
  return await doc.save({ useObjectStreams: false });
}
export function damageClassic(bytes, generation = '00000') {
  const text = Buffer.from(bytes).toString('latin1');
  const start = text.lastIndexOf('\nxref\n');
  const table = text.slice(start);
  const entry = new RegExp(`\\d{10} ${generation} n`).exec(table);
  if (!entry) throw new Error('Fixture has no matching classic entry');
  const damaged = table.slice(0, entry.index) + entry[0].slice(0, 11) + '      n' + table.slice(entry.index + entry[0].length);
  return Uint8Array.from(Buffer.from(text.slice(0, start) + damaged, 'latin1'));
}
