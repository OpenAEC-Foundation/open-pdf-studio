// Zelf gegenereerde minimale PDF (geen externe fixture of gebruikersdata) voor
// #957: één regel met een Type 3-font waarvan de ToUnicode-CMap elke code op
// één teken van `visual` afbeeldt. De glyphs staan in visuele volgorde (van
// links naar rechts getekend), zoals een PDF-producent RTL-tekst schrijft;
// tekstextractie moet de logische volgorde teruggeven.
export function bidiMarksFixture(visual) {
  const chars = Array.isArray(visual) ? visual : [...visual];
  if (!chars.length || chars.length > 200) throw new Error('1..200 characters');
  const hex = n => n.toString(16).padStart(2, '0').toUpperCase();
  const hex4 = n => n.toString(16).padStart(4, '0').toUpperCase();
  const codes = chars.map((_, i) => i + 1);
  const cmap = [
    '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CMapName /OPDS-Bidi def', '/CMapType 2 def',
    '1 begincodespacerange', '<00> <FF>', 'endcodespacerange',
    `${chars.length} beginbfchar`,
    ...chars.map((c, i) => `<${hex(codes[i])}> <${[...c].map(u => hex4(u.charCodeAt(0))).join('')}>`),
    'endbfchar', 'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end',
  ].join('\n');
  const stream = (dict, data) => `<< ${dict}/Length ${data.length} >>\nstream\n${data}\nendstream`;
  const glyph = '500 0 0 0 400 600 d1 0 0 400 600 re f';
  const content = `BT /F1 12 Tf 10 50 Td <${codes.map(hex).join('')}> Tj ET`;
  const names = codes.map(n => `/g${n}`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream('', content),
    `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 500 600] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs 6 0 R /Encoding << /Type /Encoding /Differences [1 ${names}] >> /FirstChar 1 /LastChar ${chars.length} /Widths [${codes.map(() => 500).join(' ')}] /ToUnicode 7 0 R /Resources << >> >>`,
    `<< ${codes.map(n => `/g${n} 8 0 R`).join(' ')} >>`,
    stream('', cmap),
    stream('', glyph),
  ];
  let text = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
