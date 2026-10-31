// Self-authored minimal PDF whose cross-reference section is an uncompressed
// XRef stream (#638). Besides the real objects 1-5 it lists objects 9 and 10
// at the given huge offsets; they do not exist, so the file stays tiny while
// the XRef stream reader still has to decode offsets above 2 GiB.
export const HUGE_OFFSETS = [2 ** 31, 2 ** 32 + 10];

function be(value, width) {
  // Big-endian field without bitwise operations (values can exceed 2^32).
  const out = [];
  for (let i = 0; i < width; i++) {
    out.unshift(value % 256);
    value = Math.floor(value / 256);
  }
  if (value !== 0) throw new Error(`Value does not fit in ${width} bytes`);
  return out;
}

export function xrefOffsetFixture(offsetWidth = 8, hugeOffsets = HUGE_OFFSETS) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
    '<< /Length 5 >>\nstream\nBT ET\nendstream',
  ];
  let text = '%PDF-1.5\n';
  const offsets = [];
  objects.forEach((obj, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xrefPos = text.length;
  const row = (type, offset, gen) => [type, ...be(offset, offsetWidth), ...be(gen, 2)];
  const rows = [
    row(0, 0, 65535),
    ...offsets.map(o => row(1, o, 0)),
    row(1, xrefPos, 0),
    ...hugeOffsets.map(o => row(1, o, 0)),
  ];
  const data = String.fromCharCode(...rows.flat());
  const index = `[0 6 9 ${hugeOffsets.length}]`;
  text += `5 0 obj\n<< /Type /XRef /W [1 ${offsetWidth} 2] /Index ${index} /Size ${9 + hugeOffsets.length}`
    + ` /Root 1 0 R /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`
    + `startxref\n${xrefPos}\n%%EOF\n`;
  return { bytes: Uint8Array.from(text, c => c.charCodeAt(0)), startXRef: xrefPos, hugeObjects: hugeOffsets.map((_, i) => 9 + i) };
}
