// Self-authored minimal axial shading PDF; no external fixture or user data.
export function postscriptFixture(program = '{ 0 0 }') {
  const stream = data => `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S 5 0 R >> >> /Contents 4 0 R >>',
    stream('/S sh'),
    '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>',
    stream(program).replace('<< /Length', '<< /FunctionType 4 /Domain [0 1] /Range [0 1 0 1 0 1] /Length'),
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
