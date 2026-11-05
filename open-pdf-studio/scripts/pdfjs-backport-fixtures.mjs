// Zelf gegenereerde minimale PDF's (geen externe fixture of gebruikersdata)
// voor de PDF.js-backports van #636 (herhaalde Form XObjects) en #637
// (knockout-groepen).
import { deflateSync } from 'node:zlib';

function buildPdf(objects) {
  // `objects`: strings of Uint8Arrays (stream-inhoud al ingevuld).
  const parts = [];
  let length = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? Uint8Array.from(chunk, c => c.charCodeAt(0)) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  push('%PDF-1.7\n');
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(length);
    push(`${i + 1} 0 obj\n`);
    for (const piece of Array.isArray(obj) ? obj : [obj]) push(piece);
    push('\nendobj\n');
  });
  const xref = length;
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(tail);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const plain = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
const flate = (dict, data) => {
  const packed = deflateSync(Buffer.from(data, 'latin1'));
  return [`<< ${dict} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, new Uint8Array(packed), '\nendstream'];
};

/**
 * #636: twee pagina's die elk `uses` keer dezelfde Flate-gecomprimeerde Form
 * XObject (een markering met tekst en een pad) tekenen, plus een tweede form
 * die maar één keer voorkomt.
 */
export function repeatedFormFixture(uses = 400) {
  let marker = 'BT /F1 3 Tf 0 0 Td (m) Tj ET 0.2 0.4 0.6 rg ';
  // Genoeg inhoud dat het uitpakken iets kost en de stream echt Flate is.
  for (let i = 0; i < 40; i++) marker += `${i % 4} ${(i * 7) % 4} 0.5 0.5 re `;
  marker += 'f';
  const once = 'BT /F1 6 Tf 0 0 Td (once) Tj ET';
  const page = (shift) => {
    let content = '';
    for (let i = 0; i < uses; i++) {
      content += `q 1 0 0 1 ${(i * 13 + shift) % 590} ${Math.floor(i / 45) * 9 + 5} cm /Fm0 Do Q\n`;
    }
    return `${content}q 1 0 0 1 20 780 cm /Fm1 Do Q\n`;
  };
  const resources = '/Resources << /XObject << /Fm0 5 0 R /Fm1 6 0 R >> /Font << /F1 7 0 R >> >>';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] ${resources} /Contents 8 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] ${resources} /Contents 9 0 R >>`,
    flate('/Type /XObject /Subtype /Form /BBox [0 0 4 4] /Resources << /Font << /F1 7 0 R >> >>', marker),
    flate('/Type /XObject /Subtype /Form /BBox [0 0 100 10] /Resources << /Font << /F1 7 0 R >> >>', once),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    flate('', page(0)),
    flate('', page(5)),
  ]);
}

/**
 * #637: knockout-groepen met elkaar overlappende vullingen, vullingen met
 * alpha, een geknipte vulling, een vulling die buiten de /BBox van de groep
 * valt, een lijn en een patroonvulling (die beide nog over het hele canvas
 * componeren). Eén isolated en één non-isolated groep (backdrop-pad), op een
 * gekleurde achtergrond en met een verschoven groep-/Matrix.
 */
export function knockoutFixture() {
  let fills = '';
  for (let i = 0; i < 24; i++) {
    const x = (i * 11) % 90, y = Math.floor(i / 8) * 25;
    fills += `${(i % 3) / 2} ${(i % 5) / 4} ${(i % 7) / 6} rg ${i % 4 === 0 ? '/A1 gs ' : '/A0 gs '}${x} ${y} 30 22 re f\n`;
  }
  const group = `${fills}`
    + 'q 10 10 40 30 re W n 0 0 1 rg -20 -20 200 200 re f Q\n'      // geknipt
    + '/A1 gs 1 0 0 rg 100 70 60 50 re f\n'                         // buiten /BBox
    + '0 g 4 w 5 5 m 110 85 l S\n'                                   // lijn
    + '/Pattern cs /P0 scn 60 40 30 30 re f\n'                       // patroon
    + '/A0 gs 0 1 0 rg 15 15 m 70 18 l 40 60 l h f\n';               // driehoek
  const groupDict = (isolated) => `/Type /XObject /Subtype /Form /BBox [0 0 120 90] /Matrix [1 0 0 1 30 25]`
    + ` /Group << /S /Transparency /K true /I ${isolated} >>`
    + ' /Resources << /ExtGState << /A0 << /ca 1 >> /A1 << /ca 0.5 >> >> /Pattern << /P0 7 0 R >> >>';
  const content = '0.9 0.8 0.3 rg 0 0 200 260 re f 0.3 0.7 0.9 rg 40 40 90 40 re f\n'
    + '/G0 Do\nq 1 0 0 1 0 130 cm /G1 Do Q\n';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 260] /Resources << /XObject << /G0 5 0 R /G1 6 0 R >> >> /Contents 4 0 R >>',
    plain('', content),
    plain(groupDict(true), group),
    plain(groupDict(false), group),
    plain('/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 6 6] /XStep 6 /YStep 6 /Resources << >>',
      '1 0 1 rg 0 0 3 3 re f 0 0.5 0 rg 3 3 3 3 re f'),
  ]);
}
