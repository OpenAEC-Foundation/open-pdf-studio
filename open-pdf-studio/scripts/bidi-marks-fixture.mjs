import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

export const ARABIC_CGJ = '\u0645\u064e\u034f\u0631\u0652\u062d\u064e\u0628\u064b\u0627';

// Generated extraction fixture, MIT (project license). Glyph codes appear in
// visual order, like a shaped RTL PDF. Each code maps to its own source scalar
// through ToUnicode; no ActualText or expected-result metadata is used.
// Helvetica glyphs are intentional placeholders: this tests ordering, NOT shaping.
export async function bidiMarksFixture(visualText = [...ARABIC_CGJ].reverse().join('')) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const page = pdf.addPage([400, 200]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  await font.embed();
  const chars = [...visualText];
  if (chars.length > 26 || chars.some(c => c.length !== 1)) throw new Error('BMP fixture limited to 26 glyphs');
  const hex = (n, width) => n.toString(16).padStart(width, '0');
  const pairs = chars.map((c, i) => `<${hex(65 + i, 2)}> <${hex(c.charCodeAt(0), 4)}>`).join('\n');
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /FixtureUnicode def /CMapType 2 def
1 begincodespacerange <00> <ff> endcodespacerange
${chars.length} beginbfchar\n${pairs}\nendbfchar
endcmap CMapName currentdict /CMap defineresource pop end end`;
  pdf.context.lookup(font.ref).set(PDFName.of('ToUnicode'), pdf.context.register(pdf.context.flateStream(cmap)));
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
  const codes = chars.map((_, i) => hex(65 + i, 2)).join('');
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(`BT /F1 18 Tf 30 100 Td <${codes}> Tj ET`)));
  return pdf.save({ useObjectStreams: false });
}
