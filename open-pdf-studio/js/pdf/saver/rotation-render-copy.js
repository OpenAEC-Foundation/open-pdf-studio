import { PDFDocument, degrees } from 'pdf-lib';

export function hasPageRotations(rotations) {
  return Object.values(rotations || {}).some(angle => angle % 360 !== 0);
}

// The saved file contains the edit, but pageRotations (including undo/redo)
// remains relative to the loaded PDF. Give both renderers a private copy in
// that original coordinate frame instead of applying the edit twice.
export async function rotationRenderCopy(savedBytes, appliedRotations) {
  if (!hasPageRotations(appliedRotations)) return savedBytes;
  const pdf = await PDFDocument.load(savedBytes.slice(), { ignoreEncryption: true, updateMetadata: false });
  for (const [page, angle] of Object.entries(appliedRotations)) {
    if (!angle) continue;
    const sheet = pdf.getPage(Number(page) - 1);
    sheet.setRotation(degrees(((sheet.getRotation().angle - angle) % 360 + 360) % 360));
  }
  return pdf.save();
}
