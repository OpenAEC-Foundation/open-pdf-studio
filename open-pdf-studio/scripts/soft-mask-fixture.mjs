// Zelf gegenereerde PDF's voor #1028; geen externe bestanden of gebruikersdata.
// Disjunct rood vlak, deels overlappend rood vlak en eerder getekende kleuren.
// Dezelfde inhoud met/zonder knockout-groep test beide composeSMask-paden.
export function softMaskFixture({ subtype = 'Luminosity', backdrop = 0, knockout = false, earlierBlue = false } = {}) {
  const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}endstream`;
  const content = `${earlierBlue ? '0 0 1 rg 200 200 100 100 re f\n' : ''}`
    + '0 1 0 rg 10 250 40 40 re f\n'
    + 'q /SM gs 1 0 0 rg 200 200 100 100 re f 50 50 100 50 re f Q\n';
  const resources = '/Resources << /ExtGState << /SM 4 0 R >> >>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] ${knockout ? '/Resources << /XObject << /Group 7 0 R >> >>' : resources} /Contents 5 0 R >>`,
    `<< /Type /ExtGState /SMask << /S /${subtype} /G 6 0 R ${subtype === 'Luminosity' ? `/BC [${backdrop}]` : ''} >> >>`,
    stream('', knockout ? '/Group Do\n' : content),
    stream('/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /CS /DeviceGray >>', '1 g 0 0 100 100 re f\n'),
  ];
  if (knockout) objects.push(stream(`/Type /XObject /Subtype /Form /BBox [0 0 400 400] /Group << /S /Transparency /CS /DeviceRGB /I true /K true >> ${resources}`, content));
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export const maskVariants = [
  { name: 'black', subtype: 'Luminosity', backdrop: 0 },
  { name: 'white', subtype: 'Luminosity', backdrop: 1 },
  { name: 'gray', subtype: 'Luminosity', backdrop: 0.5 },
  { name: 'alpha', subtype: 'Alpha' },
];
export const samplePoints = [[250, 250], [75, 75], [125, 75], [30, 270]];
