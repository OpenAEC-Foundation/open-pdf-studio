// Zelf gegenereerde minimale PDF (geen externe fixture of gebruikersdata):
// een DeviceGray-axiaal verloop en een Separation-kleur die allebei dezelfde
// Type 0 (sampled) functie gebruiken met twee samples van `bps` bits:
// 2^(bps-1) (ongeveer 0,5) en 2^bps - 1 (precies 1). Voor bps = 32 zijn dat
// 0x80000000 en 0xffffffff, de waarden uit #949.
export function sampledFunctionSamples(bps) {
  return [2 ** (bps - 1), 2 ** bps - 1];
}

export function sampledFunctionFixture(bps = 32) {
  const bytesPerSample = bps / 8;
  if (!Number.isInteger(bytesPerSample)) throw new Error('bps must be a multiple of 8');
  let samples = '';
  for (const value of sampledFunctionSamples(bps)) {
    for (let b = bytesPerSample - 1; b >= 0; b--) samples += String.fromCharCode(Math.floor(value / 2 ** (8 * b)) % 256);
  }
  const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
  const content = '/S sh /CS0 cs 0 scn 0 0 10 10 re f /CS0 cs 1 scn 20 0 10 10 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Shading << /S 5 0 R >> /ColorSpace << /CS0 [/Separation /Tint /DeviceGray 6 0 R] >> >> /Contents 4 0 R >>',
    stream('', content),
    '<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 100 0] /Function 6 0 R /Extend [true true] >>',
    stream(`/FunctionType 0 /Domain [0 1] /Range [0 1] /Size [2] /BitsPerSample ${bps}`, samples),
  ];
  let text = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(text, c => c.charCodeAt(0));
}
