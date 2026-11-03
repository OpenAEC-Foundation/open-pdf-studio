// Self-authored PDF: the same Type 0 function drives an axial gray shading
// and a Separation tint transform. ASCIIHex keeps byte offsets reproducible.
export function sampledFunctionFixture(bits = 32, tint = false) {
  const sample = (2 ** (bits - 1)).toString(16).padStart(bits / 4, '0');
  const data = sample + 'f'.repeat(bits / 4) + '>';
  const stream = (body, dict = '') => `<< ${dict} /Length ${body.length} >>\nstream\n${body}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S 5 0 R >> /ColorSpace << /C [/Separation /Test /DeviceGray 6 0 R] >> >> /Contents 4 0 R >>',
    stream(tint ? '/C cs 0.1 scn 0 0 33 100 re f 0.5 scn 33 0 34 100 re f 0.9 scn 67 0 33 100 re f' : '/S sh'),
    '<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>',
    stream(data, `/FunctionType 0 /Domain [0 1] /Range [0 1] /Size [2] /BitsPerSample ${bits} /Filter /ASCIIHexDecode`),
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
